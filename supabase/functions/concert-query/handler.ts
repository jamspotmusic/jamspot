/*
 * Core request handling for the `concert-query` Edge Function.
 *
 * Kept free of the `withSupabase` wrapper (and therefore of any npm/jsr
 * imports) so it can be unit tested directly with `deno test`. index.ts is
 * the deployable entry point and does nothing but apply the wrapper.
 */

export const OPENAI_MODEL = "gpt-5.6-luna";

type RequestBody = {
  query?: unknown;
  timeZone?: unknown;
};

export type RawConcertCriteria = {
  city: string | null;
  stateCode: string | null;
  postalCode: string | null;
  keyword: string | null;
  startDateTime: string | null;
  endDateTime: string | null;
};

export type TicketmasterParams = {
  city?: string;
  stateCode?: string;
  postalCode?: string;
  keyword?: string;
  startDateTime?: string;
  endDateTime?: string;
};

type OpenAIResponse = {
  model?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
};

const outputSchema = {
  type: "object",
  properties: {
    city: {
      type: ["string", "null"],
      description:
        "City explicitly specified by the user. Null when no city was supplied.",
    },
    stateCode: {
      type: ["string", "null"],
      description:
        "Two-letter US state code explicitly specified by the user, normalized from a state name when necessary.",
    },
    postalCode: {
      type: ["string", "null"],
      description:
        "Postal or ZIP code explicitly specified by the user.",
    },
    keyword: {
      type: ["string", "null"],
      description:
        "Artist, genre, venue, festival, event name, or other useful Ticketmaster search keyword.",
    },
    startDateTime: {
      type: ["string", "null"],
      description:
        "Start of the requested date range as an ISO-8601 UTC timestamp.",
    },
    endDateTime: {
      type: ["string", "null"],
      description:
        "End of the requested date range as an ISO-8601 UTC timestamp.",
    },
  },
  required: [
    "city",
    "stateCode",
    "postalCode",
    "keyword",
    "startDateTime",
    "endDateTime",
  ],
  additionalProperties: false,
} as const;

const instructions = `
You translate natural-language concert discovery requests into
Ticketmaster Discovery API search parameters for JamSpot.

You do NOT provide concert listings.
Ticketmaster is the authoritative source for actual events.

Return only the fields required by the supplied JSON schema.

LOCATION RULES

- Populate city only when the user explicitly supplies a city.
- Populate stateCode only when the user explicitly supplies a state
  or state abbreviation.
- Convert explicit state names such as "California" to "CA".
- Populate postalCode only when the user explicitly supplies a ZIP
  or postal code.
- Do not guess a user's city, state, ZIP code, coordinates, or location.
- Do not infer location from the supplied timeZone.
- timeZone exists only to resolve relative dates.
- Do not perform geolocation.
- Do not manufacture a location when none was supplied.

KEYWORD RULES

- Artist names should normally become keyword.
- Genres such as jazz, metal, punk, indie, EDM, country, rock,
  classical, hip-hop, etc. should normally become keyword.
- Venue names may become keyword.
- Festival or event names may become keyword.
- Do not include location or date language in keyword.
- If no useful keyword was supplied, return null.

DATE RULES

- Resolve phrases such as "tonight", "tomorrow", "Friday",
  "this weekend", "next weekend", and "next month" relative to
  currentDateTime and timeZone.
- Return UTC ISO-8601 timestamps ending in Z.
- If the user supplied no date restriction, return null for both
  startDateTime and endDateTime.
- Never use your knowledge cutoff as the current date.

GENERAL RULES

- Do not claim an artist is actually touring.
- Do not claim a concert exists.
- Do not invent venues, artists, genres, or locations.
- Null means the information was not supplied or cannot safely
  be determined.
`;

export function normalizeOptionalString(
  value: string | null,
): string | null {
  if (value === null) {
    return null;
  }

  const normalized = value.trim();

  return normalized.length > 0 ? normalized : null;
}

export function normalizeStateCode(
  value: string | null,
): string | null {
  const normalized = normalizeOptionalString(value);

  if (!normalized) {
    return null;
  }

  const stateCode = normalized.toUpperCase();

  if (!/^[A-Z]{2}$/.test(stateCode)) {
    throw new Error("Invalid stateCode returned by model");
  }

  return stateCode;
}

export function normalizeDateTime(
  value: string | null,
  fieldName: string,
): string | null {
  const normalized = normalizeOptionalString(value);

  if (!normalized) {
    return null;
  }

  const timestamp = Date.parse(normalized);

  if (!Number.isFinite(timestamp)) {
    throw new Error(
      `Invalid ${fieldName} returned by model`,
    );
  }

  // Ticketmaster examples use UTC timestamps ending in Z.
  // Strip milliseconds for a compact, predictable representation.
  return new Date(timestamp)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
}

export function extractOutputText(
  response: OpenAIResponse,
): string | null {
  for (const item of response.output ?? []) {
    if (item.type !== "message") {
      continue;
    }

    for (const content of item.content ?? []) {
      if (
        content.type === "output_text" &&
        typeof content.text === "string"
      ) {
        return content.text;
      }
    }
  }

  return null;
}

export function normalizeCriteria(
  criteria: RawConcertCriteria,
): RawConcertCriteria {
  const normalized: RawConcertCriteria = {
    city: normalizeOptionalString(criteria.city),
    stateCode: normalizeStateCode(criteria.stateCode),
    postalCode: normalizeOptionalString(
      criteria.postalCode,
    ),
    keyword: normalizeOptionalString(criteria.keyword),
    startDateTime: normalizeDateTime(
      criteria.startDateTime,
      "startDateTime",
    ),
    endDateTime: normalizeDateTime(
      criteria.endDateTime,
      "endDateTime",
    ),
  };

  if (
    normalized.startDateTime &&
    normalized.endDateTime &&
    Date.parse(normalized.startDateTime) >
      Date.parse(normalized.endDateTime)
  ) {
    throw new Error(
      "startDateTime is after endDateTime",
    );
  }

  return normalized;
}

export function hasSearchAnchor(
  criteria: RawConcertCriteria,
): boolean {
  return Boolean(
    criteria.city ||
      criteria.stateCode ||
      criteria.postalCode ||
      criteria.keyword,
  );
}

export function toTicketmasterParams(
  criteria: RawConcertCriteria,
): TicketmasterParams {
  return {
    ...(criteria.city
      ? { city: criteria.city }
      : {}),
    ...(criteria.stateCode
      ? { stateCode: criteria.stateCode }
      : {}),
    ...(criteria.postalCode
      ? { postalCode: criteria.postalCode }
      : {}),
    ...(criteria.keyword
      ? { keyword: criteria.keyword }
      : {}),
    ...(criteria.startDateTime
      ? { startDateTime: criteria.startDateTime }
      : {}),
    ...(criteria.endDateTime
      ? { endDateTime: criteria.endDateTime }
      : {}),
  };
}

export async function handleConcertQuery(
  req: Request,
): Promise<Response> {
  if (req.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      {
        status: 405,
        headers: {
          Allow: "POST",
        },
      },
    );
  }

  const apiKey = Deno.env.get("OPENAI_API_KEY");

  if (!apiKey) {
    console.error(
      "OPENAI_API_KEY is not configured",
    );

    return Response.json(
      {
        error:
          "Concert query service is not configured",
      },
      { status: 500 },
    );
  }

  let body: RequestBody;

  try {
    body = await req.json();
  } catch {
    return Response.json(
      {
        error:
          "Request body must contain valid JSON",
      },
      { status: 400 },
    );
  }

  const query =
    typeof body.query === "string"
      ? body.query.trim()
      : "";

  const timeZone =
    typeof body.timeZone === "string" &&
    body.timeZone.trim()
      ? body.timeZone.trim()
      : "UTC";

  if (!query) {
    return Response.json(
      {
        error: "query is required",
      },
      { status: 400 },
    );
  }

  if (query.length > 500) {
    return Response.json(
      {
        error:
          "query must be 500 characters or fewer",
      },
      { status: 400 },
    );
  }

  const currentDateTime =
    new Date().toISOString();

  let openAIResponse: Response;

  try {
    openAIResponse = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,

          // This is extraction, not a reasoning-heavy task.
          reasoning: {
            effort: "none",
          },

          store: false,

          max_output_tokens: 300,

          instructions,

          input: JSON.stringify({
            query,
            currentDateTime,
            timeZone,
          }),

          text: {
            format: {
              type: "json_schema",
              name: "ticketmaster_search_parameters",
              strict: true,
              schema: outputSchema,
            },
          },
        }),
      },
    );
  } catch (error) {
    console.error(
      "Failed to reach OpenAI",
      error,
    );

    return Response.json(
      {
        error:
          "Unable to interpret concert query",
      },
      { status: 502 },
    );
  }

  const requestId =
    openAIResponse.headers.get("x-request-id");

  let payload: OpenAIResponse;

  try {
    payload =
      (await openAIResponse.json()) as OpenAIResponse;
  } catch {
    console.error(
      "OpenAI returned an invalid JSON response",
      {
        status: openAIResponse.status,
        requestId,
      },
    );

    return Response.json(
      {
        error:
          "Unable to interpret concert query",
      },
      { status: 502 },
    );
  }

  if (!openAIResponse.ok) {
    console.error("OpenAI request failed", {
      status: openAIResponse.status,
      requestId,
    });

    return Response.json(
      {
        error:
          "Unable to interpret concert query",
      },
      { status: 502 },
    );
  }

  const outputText =
    extractOutputText(payload);

  if (!outputText) {
    console.error(
      "OpenAI response contained no output text",
      {
        requestId,
      },
    );

    return Response.json(
      {
        error:
          "Unable to interpret concert query",
      },
      { status: 502 },
    );
  }

  let criteria: RawConcertCriteria;

  try {
    const parsed = JSON.parse(
      outputText,
    ) as RawConcertCriteria;

    criteria = normalizeCriteria(parsed);
  } catch (error) {
    console.error(
      "Invalid structured output from OpenAI",
      {
        requestId,
        error:
          error instanceof Error
            ? error.message
            : "unknown error",
      },
    );

    return Response.json(
      {
        error:
          "Unable to interpret concert query",
      },
      { status: 502 },
    );
  }

  /*
   * Keep this aligned with the current validation in
   * apps/web/app/api/concerts/route.ts.
   *
   * "jazz this weekend" is valid because keyword=jazz.
   *
   * "concerts this weekend" is deliberately rejected:
   * no location and no keyword were supplied, and we
   * do not invent either.
   */
  if (!hasSearchAnchor(criteria)) {
    return Response.json(
      {
        error:
          "Include an artist, genre, venue, event, city, state, or ZIP code.",
      },
      { status: 422 },
    );
  }

  return Response.json({
    query,
    ticketmasterParams:
      toTicketmasterParams(criteria),
    meta: {
      model:
        payload.model ?? OPENAI_MODEL,
      timeZone,
      currentDateTime,
    },
  });
}
