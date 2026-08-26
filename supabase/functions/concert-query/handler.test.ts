/*
 * Unit tests for the `concert-query` Edge Function (v0.3.0).
 *
 * Run with `deno test` from supabase/functions/concert-query, or
 * `npm run test:functions` from the repo root.
 *
 * No network access is required or permitted: every test stubs
 * globalThis.fetch, so a test that accidentally reached OpenAI would fail
 * rather than silently spend tokens.
 */

import {
  assert,
  assertEquals,
  assertMatch,
  assertObjectMatch,
  assertThrows,
} from "jsr:@std/assert@^1";

import {
  extractOutputText,
  handleConcertQuery,
  hasSearchAnchor,
  normalizeCriteria,
  normalizeDateTime,
  normalizeOptionalString,
  normalizeStateCode,
  OPENAI_MODEL,
  type RawConcertCriteria,
  toTicketmasterParams,
} from "./handler.ts";

/* -------------------------------------------------------------------------
 * Test helpers
 * ---------------------------------------------------------------------- */

/** A fully-null criteria object, so tests only spell out what they care about. */
function criteria(
  overrides: Partial<RawConcertCriteria> = {},
): RawConcertCriteria {
  return {
    city: null,
    stateCode: null,
    postalCode: null,
    keyword: null,
    startDateTime: null,
    endDateTime: null,
    ...overrides,
  };
}

/** Shapes a payload the way the OpenAI Responses API returns structured output. */
function openAIPayload(
  output: unknown,
  { model = OPENAI_MODEL }: { model?: string } = {},
) {
  return {
    model,
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: typeof output === "string"
              ? output
              : JSON.stringify(output),
          },
        ],
      },
    ],
  };
}

type CapturedRequest = {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
};

type RunOptions = {
  method?: string;
  /** Raw request body. Objects are JSON-stringified; strings are sent as-is. */
  body?: unknown;
  /** Pass null to simulate an unconfigured function. */
  apiKey?: string | null;
  /** What the stubbed fetch does. Defaults to a successful OpenAI response. */
  openAI?: () => Response | Promise<Response>;
};

type RunResult = {
  response: Response;
  json: Record<string, unknown>;
  requests: CapturedRequest[];
  errors: unknown[][];
};

/**
 * Invokes the handler with OPENAI_API_KEY, globalThis.fetch and console.error
 * all stubbed, and restores them afterwards.
 */
async function run(
  {
    method = "POST",
    body = { query: "jazz in Oakland" },
    apiKey = "test-openai-key",
    openAI = () =>
      Response.json(
        openAIPayload(criteria({ keyword: "jazz", city: "Oakland" })),
      ),
  }: RunOptions = {},
): Promise<RunResult> {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const originalKey = Deno.env.get("OPENAI_API_KEY");

  const requests: CapturedRequest[] = [];
  const errors: unknown[][] = [];

  if (apiKey === null) {
    Deno.env.delete("OPENAI_API_KEY");
  } else {
    Deno.env.set("OPENAI_API_KEY", apiKey);
  }

  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    let parsedBody: Record<string, unknown> = {};
    try {
      parsedBody = JSON.parse(String(init?.body ?? "{}"));
    } catch {
      // Leave parsedBody empty; a test asserting on it will fail loudly.
    }
    requests.push({ url: String(url), init: init ?? {}, body: parsedBody });
    return Promise.resolve(openAI());
  }) as typeof fetch;

  console.error = (...args: unknown[]) => {
    errors.push(args);
  };

  try {
    const request = new Request("http://localhost/concert-query", {
      method,
      ...(method === "GET" || body === undefined ? {} : {
        headers: { "Content-Type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    });

    const response = await handleConcertQuery(request);
    const json = await response.clone().json() as Record<string, unknown>;

    return { response, json, requests, errors };
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    if (originalKey === undefined) {
      Deno.env.delete("OPENAI_API_KEY");
    } else {
      Deno.env.set("OPENAI_API_KEY", originalKey);
    }
  }
}

/* -------------------------------------------------------------------------
 * normalizeOptionalString
 * ---------------------------------------------------------------------- */

Deno.test("normalizeOptionalString passes null through", () => {
  assertEquals(normalizeOptionalString(null), null);
});

Deno.test("normalizeOptionalString trims surrounding whitespace", () => {
  assertEquals(normalizeOptionalString("  Oakland \n"), "Oakland");
});

Deno.test("normalizeOptionalString treats a blank string as absent", () => {
  assertEquals(normalizeOptionalString(""), null);
  assertEquals(normalizeOptionalString("   "), null);
});

/* -------------------------------------------------------------------------
 * normalizeStateCode
 * ---------------------------------------------------------------------- */

Deno.test("normalizeStateCode uppercases a two-letter code", () => {
  assertEquals(normalizeStateCode("ca"), "CA");
  assertEquals(normalizeStateCode(" tx "), "TX");
});

Deno.test("normalizeStateCode returns null for absent values", () => {
  assertEquals(normalizeStateCode(null), null);
  assertEquals(normalizeStateCode("  "), null);
});

Deno.test("normalizeStateCode rejects anything that is not two letters", () => {
  // The model is instructed to convert "California" itself; if it doesn't,
  // we fail rather than send Ticketmaster a bogus stateCode.
  for (const invalid of ["California", "C", "CAL", "C1", "1234"]) {
    assertThrows(
      () => normalizeStateCode(invalid),
      Error,
      "Invalid stateCode returned by model",
    );
  }
});

/* -------------------------------------------------------------------------
 * normalizeDateTime
 * ---------------------------------------------------------------------- */

Deno.test("normalizeDateTime strips milliseconds and keeps the Z suffix", () => {
  assertEquals(
    normalizeDateTime("2026-08-29T00:00:00.123Z", "startDateTime"),
    "2026-08-29T00:00:00Z",
  );
});

Deno.test("normalizeDateTime converts an offset timestamp to UTC", () => {
  assertEquals(
    normalizeDateTime("2026-08-29T00:00:00-07:00", "startDateTime"),
    "2026-08-29T07:00:00Z",
  );
});

Deno.test("normalizeDateTime returns null for absent values", () => {
  assertEquals(normalizeDateTime(null, "startDateTime"), null);
  assertEquals(normalizeDateTime("   ", "endDateTime"), null);
});

Deno.test("normalizeDateTime throws, naming the field, on an unparseable date", () => {
  assertThrows(
    () => normalizeDateTime("this weekend", "startDateTime"),
    Error,
    "Invalid startDateTime returned by model",
  );

  assertThrows(
    () => normalizeDateTime("2026-13-45T99:99:99Z", "endDateTime"),
    Error,
    "Invalid endDateTime returned by model",
  );
});

/* -------------------------------------------------------------------------
 * normalizeCriteria
 * ---------------------------------------------------------------------- */

Deno.test("normalizeCriteria normalizes every field at once", () => {
  assertEquals(
    normalizeCriteria({
      city: "  Oakland  ",
      stateCode: "ca",
      postalCode: " 94607 ",
      keyword: "  jazz ",
      startDateTime: "2026-08-29T00:00:00.000Z",
      endDateTime: "2026-08-31T23:59:59.999Z",
    }),
    {
      city: "Oakland",
      stateCode: "CA",
      postalCode: "94607",
      keyword: "jazz",
      startDateTime: "2026-08-29T00:00:00Z",
      endDateTime: "2026-08-31T23:59:59Z",
    },
  );
});

Deno.test("normalizeCriteria keeps an all-null result all-null", () => {
  assertEquals(normalizeCriteria(criteria()), criteria());
});

Deno.test("normalizeCriteria rejects a start date after the end date", () => {
  assertThrows(
    () =>
      normalizeCriteria(criteria({
        keyword: "jazz",
        startDateTime: "2026-08-31T00:00:00Z",
        endDateTime: "2026-08-29T00:00:00Z",
      })),
    Error,
    "startDateTime is after endDateTime",
  );
});

Deno.test("normalizeCriteria allows a zero-length range", () => {
  const result = normalizeCriteria(criteria({
    startDateTime: "2026-08-29T00:00:00Z",
    endDateTime: "2026-08-29T00:00:00Z",
  }));

  assertEquals(result.startDateTime, "2026-08-29T00:00:00Z");
  assertEquals(result.endDateTime, "2026-08-29T00:00:00Z");
});

Deno.test("normalizeCriteria does not compare against a missing bound", () => {
  // Only one end of the range supplied - nothing to contradict.
  assertEquals(
    normalizeCriteria(criteria({ startDateTime: "2026-08-31T00:00:00Z" }))
      .endDateTime,
    null,
  );
});

/* -------------------------------------------------------------------------
 * hasSearchAnchor
 * ---------------------------------------------------------------------- */

Deno.test("hasSearchAnchor accepts any single location or keyword field", () => {
  for (
    const field of
      ["city", "stateCode", "postalCode", "keyword"] as const
  ) {
    assert(
      hasSearchAnchor(criteria({ [field]: "value" })),
      `${field} alone should anchor the search`,
    );
  }
});

Deno.test("hasSearchAnchor rejects a dates-only query", () => {
  // "concerts this weekend" - no location, no keyword, and we never invent one.
  assertEquals(
    hasSearchAnchor(criteria({
      startDateTime: "2026-08-29T00:00:00Z",
      endDateTime: "2026-08-31T00:00:00Z",
    })),
    false,
  );
});

Deno.test("hasSearchAnchor rejects an entirely empty result", () => {
  assertEquals(hasSearchAnchor(criteria()), false);
});

/* -------------------------------------------------------------------------
 * toTicketmasterParams
 * ---------------------------------------------------------------------- */

Deno.test("toTicketmasterParams omits null fields entirely", () => {
  const params = toTicketmasterParams(criteria({ keyword: "jazz" }));

  assertEquals(params, { keyword: "jazz" });
  assertEquals(Object.keys(params), ["keyword"]);
});

Deno.test("toTicketmasterParams maps every supplied field", () => {
  assertEquals(
    toTicketmasterParams({
      city: "Oakland",
      stateCode: "CA",
      postalCode: "94607",
      keyword: "jazz",
      startDateTime: "2026-08-29T00:00:00Z",
      endDateTime: "2026-08-31T23:59:59Z",
    }),
    {
      city: "Oakland",
      stateCode: "CA",
      postalCode: "94607",
      keyword: "jazz",
      startDateTime: "2026-08-29T00:00:00Z",
      endDateTime: "2026-08-31T23:59:59Z",
    },
  );
});

/* -------------------------------------------------------------------------
 * extractOutputText
 * ---------------------------------------------------------------------- */

Deno.test("extractOutputText returns the first output_text of a message", () => {
  assertEquals(extractOutputText(openAIPayload("{}")), "{}");
});

Deno.test("extractOutputText skips non-message output items", () => {
  assertEquals(
    extractOutputText({
      output: [
        { type: "reasoning", content: [{ type: "output_text", text: "nope" }] },
        {
          type: "message",
          content: [
            { type: "refusal", text: "also nope" },
            { type: "output_text", text: "yes" },
          ],
        },
      ],
    }),
    "yes",
  );
});

Deno.test("extractOutputText returns null when there is nothing to read", () => {
  assertEquals(extractOutputText({}), null);
  assertEquals(extractOutputText({ output: [] }), null);
  assertEquals(extractOutputText({ output: [{ type: "message" }] }), null);
  assertEquals(
    extractOutputText({
      output: [{
        type: "message",
        content: [{ type: "output_text" }],
      }],
    }),
    null,
  );
});

/* -------------------------------------------------------------------------
 * handleConcertQuery - request validation
 * ---------------------------------------------------------------------- */

Deno.test("handleConcertQuery rejects non-POST methods with an Allow header", async () => {
  for (const method of ["GET", "PUT", "DELETE", "PATCH"]) {
    const { response, json, requests } = await run({ method, body: undefined });

    assertEquals(response.status, 405);
    assertEquals(response.headers.get("Allow"), "POST");
    assertEquals(json.error, "Method not allowed");
    assertEquals(requests.length, 0, "must not call OpenAI");
  }
});

Deno.test("handleConcertQuery returns 500 when OPENAI_API_KEY is unset", async () => {
  const { response, json, requests, errors } = await run({ apiKey: null });

  assertEquals(response.status, 500);
  assertEquals(json.error, "Concert query service is not configured");
  assertEquals(requests.length, 0, "must not call OpenAI without a key");
  assertEquals(errors.length, 1);
});

Deno.test("handleConcertQuery returns 400 for a body that is not JSON", async () => {
  const { response, json, requests } = await run({ body: "not json at all" });

  assertEquals(response.status, 400);
  assertEquals(json.error, "Request body must contain valid JSON");
  assertEquals(requests.length, 0);
});

Deno.test("handleConcertQuery returns 400 for a missing, blank, or non-string query", async () => {
  for (const body of [{}, { query: "" }, { query: "   " }, { query: 42 }, { query: null }]) {
    const { response, json, requests } = await run({ body });

    assertEquals(response.status, 400, `body: ${JSON.stringify(body)}`);
    assertEquals(json.error, "query is required");
    assertEquals(requests.length, 0);
  }
});

Deno.test("handleConcertQuery accepts a 500-character query but rejects 501", async () => {
  const atLimit = await run({ body: { query: "a".repeat(500) } });
  assertEquals(atLimit.response.status, 200);

  const overLimit = await run({ body: { query: "a".repeat(501) } });
  assertEquals(overLimit.response.status, 400);
  assertEquals(overLimit.json.error, "query must be 500 characters or fewer");
  assertEquals(overLimit.requests.length, 0);
});

Deno.test("handleConcertQuery measures the length limit after trimming", async () => {
  // 500 characters of content plus padding is still a 500-character query.
  const { response } = await run({
    body: { query: `   ${"a".repeat(500)}   ` },
  });

  assertEquals(response.status, 200);
});

/* -------------------------------------------------------------------------
 * handleConcertQuery - the OpenAI request
 * ---------------------------------------------------------------------- */

Deno.test("handleConcertQuery calls the Responses API with the documented settings", async () => {
  const { requests } = await run({ body: { query: "jazz in Oakland" } });

  assertEquals(requests.length, 1);

  const [request] = requests;
  assertEquals(request.url, "https://api.openai.com/v1/responses");
  assertEquals(request.init.method, "POST");

  const headers = request.init.headers as Record<string, string>;
  assertEquals(headers.Authorization, "Bearer test-openai-key");
  assertEquals(headers["Content-Type"], "application/json");

  assertObjectMatch(request.body, {
    model: "gpt-5.6-luna",
    // Parameter extraction, not a reasoning task.
    reasoning: { effort: "none" },
    store: false,
    max_output_tokens: 300,
  });
});

Deno.test("handleConcertQuery requests strict JSON-schema structured output", async () => {
  const { requests } = await run();

  const format = (requests[0].body.text as {
    format: {
      type: string;
      name: string;
      strict: boolean;
      schema: { required: string[]; additionalProperties: boolean };
    };
  }).format;

  assertEquals(format.type, "json_schema");
  assertEquals(format.name, "ticketmaster_search_parameters");
  assertEquals(format.strict, true);
  assertEquals(format.schema.additionalProperties, false);
  assertEquals(format.schema.required, [
    "city",
    "stateCode",
    "postalCode",
    "keyword",
    "startDateTime",
    "endDateTime",
  ]);
});

Deno.test("handleConcertQuery sends the model only the query, timestamp, and time zone", async () => {
  const { requests } = await run({
    body: {
      query: "  jazz in Oakland  ",
      timeZone: "America/Los_Angeles",
      // Anything else the caller sends must not reach the model.
      userId: "user-123",
      latitude: 37.8,
      longitude: -122.27,
    },
  });

  const input = JSON.parse(requests[0].body.input as string);

  assertEquals(Object.keys(input).sort(), [
    "currentDateTime",
    "query",
    "timeZone",
  ]);
  assertEquals(input.query, "jazz in Oakland", "query is trimmed");
  assertEquals(input.timeZone, "America/Los_Angeles");
  assertMatch(input.currentDateTime, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
});

Deno.test("handleConcertQuery defaults the time zone to UTC", async () => {
  for (const timeZone of [undefined, "", "   ", 42, null]) {
    const { requests } = await run({
      body: { query: "jazz in Oakland", timeZone },
    });

    assertEquals(JSON.parse(requests[0].body.input as string).timeZone, "UTC");
  }
});

Deno.test("handleConcertQuery instructs the model not to guess a location", async () => {
  const { requests } = await run();

  const instructions = String(requests[0].body.instructions);

  assertMatch(instructions, /Do not guess a user's city, state, ZIP code/);
  assertMatch(instructions, /Do not infer location from the supplied timeZone/);
  assertMatch(instructions, /Do not perform geolocation/);
  assertMatch(instructions, /Do not claim a concert exists/);
  assertMatch(instructions, /Never use your knowledge cutoff as the current date/);
});

/* -------------------------------------------------------------------------
 * handleConcertQuery - success
 * ---------------------------------------------------------------------- */

Deno.test("handleConcertQuery returns the extracted Ticketmaster parameters", async () => {
  const { response, json } = await run({
    body: { query: "jazz in Oakland this weekend", timeZone: "America/Los_Angeles" },
    openAI: () =>
      Response.json(openAIPayload(criteria({
        city: " Oakland ",
        stateCode: "ca",
        keyword: "jazz",
        startDateTime: "2026-08-29T07:00:00.000Z",
        endDateTime: "2026-08-31T06:59:59.999Z",
      }))),
  });

  assertEquals(response.status, 200);
  assertEquals(json.query, "jazz in Oakland this weekend");
  assertEquals(json.ticketmasterParams, {
    city: "Oakland",
    stateCode: "CA",
    keyword: "jazz",
    startDateTime: "2026-08-29T07:00:00Z",
    endDateTime: "2026-08-31T06:59:59Z",
  });

  const meta = json.meta as Record<string, string>;
  assertEquals(meta.model, OPENAI_MODEL);
  assertEquals(meta.timeZone, "America/Los_Angeles");
  assertMatch(meta.currentDateTime, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
});

Deno.test("handleConcertQuery returns a keyword-only query with no location", async () => {
  // "jazz this weekend" is valid: keyword anchors the search, and we do not
  // manufacture a city the user never supplied.
  const { response, json } = await run({
    body: { query: "jazz this weekend" },
    openAI: () =>
      Response.json(openAIPayload(criteria({
        keyword: "jazz",
        startDateTime: "2026-08-29T00:00:00Z",
        endDateTime: "2026-08-31T00:00:00Z",
      }))),
  });

  assertEquals(response.status, 200);
  assertEquals(json.ticketmasterParams, {
    keyword: "jazz",
    startDateTime: "2026-08-29T00:00:00Z",
    endDateTime: "2026-08-31T00:00:00Z",
  });
});

Deno.test("handleConcertQuery reports the model the API actually served", async () => {
  const { json } = await run({
    openAI: () =>
      Response.json(
        openAIPayload(criteria({ keyword: "jazz" }), {
          model: "gpt-5.6-luna-2026-07-01",
        }),
      ),
  });

  assertEquals((json.meta as Record<string, string>).model, "gpt-5.6-luna-2026-07-01");
});

Deno.test("handleConcertQuery falls back to the configured model name in meta", async () => {
  const { json } = await run({
    openAI: () =>
      Response.json({
        output: [{
          type: "message",
          content: [{
            type: "output_text",
            text: JSON.stringify(criteria({ keyword: "jazz" })),
          }],
        }],
      }),
  });

  assertEquals((json.meta as Record<string, string>).model, OPENAI_MODEL);
});

/* -------------------------------------------------------------------------
 * handleConcertQuery - rejection of un-anchored queries
 * ---------------------------------------------------------------------- */

Deno.test("handleConcertQuery returns 422 when nothing anchors the search", async () => {
  const { response, json } = await run({
    body: { query: "concerts this weekend" },
    openAI: () =>
      Response.json(openAIPayload(criteria({
        startDateTime: "2026-08-29T00:00:00Z",
        endDateTime: "2026-08-31T00:00:00Z",
      }))),
  });

  assertEquals(response.status, 422);
  assertEquals(
    json.error,
    "Include an artist, genre, venue, event, city, state, or ZIP code.",
  );
});

Deno.test("handleConcertQuery treats whitespace-only model output as absent", async () => {
  const { response } = await run({
    openAI: () =>
      Response.json(openAIPayload(criteria({ city: "   ", keyword: "  " }))),
  });

  assertEquals(response.status, 422);
});

/* -------------------------------------------------------------------------
 * handleConcertQuery - OpenAI failures
 * ---------------------------------------------------------------------- */

Deno.test("handleConcertQuery returns 502 when OpenAI is unreachable", async () => {
  const { response, json, errors } = await run({
    openAI: () => {
      throw new TypeError("connection refused");
    },
  });

  assertEquals(response.status, 502);
  assertEquals(json.error, "Unable to interpret concert query");
  assertEquals(errors[0][0], "Failed to reach OpenAI");
});

Deno.test("handleConcertQuery returns 502 when OpenAI responds with an error status", async () => {
  for (const status of [400, 401, 429, 500, 503]) {
    const { response, json } = await run({
      openAI: () =>
        Response.json({ error: { message: "upstream detail" } }, { status }),
    });

    assertEquals(response.status, 502, `upstream status ${status}`);
    assertEquals(json.error, "Unable to interpret concert query");
  }
});

Deno.test("handleConcertQuery returns 502 when OpenAI returns unparseable JSON", async () => {
  const { response, json, errors } = await run({
    openAI: () => new Response("<html>gateway timeout</html>", { status: 504 }),
  });

  assertEquals(response.status, 502);
  assertEquals(json.error, "Unable to interpret concert query");
  assertEquals(errors[0][0], "OpenAI returned an invalid JSON response");
});

Deno.test("handleConcertQuery returns 502 when the response has no output text", async () => {
  const { response, json, errors } = await run({
    openAI: () => Response.json({ model: OPENAI_MODEL, output: [] }),
  });

  assertEquals(response.status, 502);
  assertEquals(json.error, "Unable to interpret concert query");
  assertEquals(errors[0][0], "OpenAI response contained no output text");
});

Deno.test("handleConcertQuery returns 502 when the output text is not JSON", async () => {
  const { response, errors } = await run({
    openAI: () => Response.json(openAIPayload("Sorry, I can't help with that.")),
  });

  assertEquals(response.status, 502);
  assertEquals(errors[0][0], "Invalid structured output from OpenAI");
});

Deno.test("handleConcertQuery returns 502 when normalization rejects the output", async () => {
  const cases: Array<[string, RawConcertCriteria]> = [
    ["bad stateCode", criteria({ keyword: "jazz", stateCode: "California" })],
    ["bad date", criteria({ keyword: "jazz", startDateTime: "this weekend" })],
    [
      "inverted range",
      criteria({
        keyword: "jazz",
        startDateTime: "2026-08-31T00:00:00Z",
        endDateTime: "2026-08-29T00:00:00Z",
      }),
    ],
  ];

  for (const [label, output] of cases) {
    const { response, json } = await run({
      openAI: () => Response.json(openAIPayload(output)),
    });

    assertEquals(response.status, 502, label);
    assertEquals(json.error, "Unable to interpret concert query");
  }
});

/* -------------------------------------------------------------------------
 * handleConcertQuery - what never reaches the client
 * ---------------------------------------------------------------------- */

Deno.test("handleConcertQuery logs the OpenAI request id but never returns it", async () => {
  const { response, json, errors } = await run({
    openAI: () =>
      Response.json(
        { error: { message: "rate limited" } },
        { status: 429, headers: { "x-request-id": "req_abc123" } },
      ),
  });

  assertEquals(response.status, 502);
  assertEquals(
    JSON.stringify(json).includes("req_abc123"),
    false,
    "the OpenAI request id must not leak to the client",
  );
  assertEquals(response.headers.get("x-request-id"), null);

  assertObjectMatch(errors[0][1] as Record<string, unknown>, {
    status: 429,
    requestId: "req_abc123",
  });
});

Deno.test("handleConcertQuery never echoes upstream error detail or the API key", async () => {
  const { json } = await run({
    apiKey: "sk-super-secret",
    openAI: () =>
      Response.json(
        { error: { message: "Incorrect API key provided: sk-super-secret" } },
        { status: 401 },
      ),
  });

  const serialized = JSON.stringify(json);
  assertEquals(serialized.includes("sk-super-secret"), false);
  assertEquals(serialized.includes("Incorrect API key"), false);
  assertEquals(json.error, "Unable to interpret concert query");
});
