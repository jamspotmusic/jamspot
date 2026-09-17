/*
 * Unit tests for the `concert-query` Edge Function.
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
  type CallerLocation,
  DEFAULT_RADIUS_MILES,
  encodeGeohash,
  extractOutputText,
  geoFromHeaders,
  handleConcertQuery,
  hasNamedLocation,
  MAX_GENRES,
  MAX_RADIUS_MILES,
  nationwideFallback,
  normalizeCountryCode,
  normalizeCriteria,
  normalizeDateTime,
  normalizeGenres,
  normalizeOptionalString,
  normalizePrice,
  normalizeRadiusMiles,
  normalizeSort,
  normalizeStateCode,
  OPENAI_MODEL,
  parseCallerLocation,
  type RawConcertCriteria,
  resolveLocation,
  type ResolvedLocation,
  toPriceFilter,
  toTicketmasterParams,
} from "./handler.ts";

import {
  InMemoryRateLimitStore,
  LunaRateLimiter,
  type RateLimitStore,
} from "./rate-limit.ts";

/* -------------------------------------------------------------------------
 * Test helpers
 * ---------------------------------------------------------------------- */

/**
 * A criteria object with everything empty, so tests only spell out the fields
 * they care about. With no location named, the search geolocates.
 */
function criteria(
  overrides: Partial<RawConcertCriteria> = {},
): RawConcertCriteria {
  return {
    city: null,
    stateCode: null,
    postalCode: null,
    countryCode: null,
    keyword: null,
    genres: null,
    startDateTime: null,
    endDateTime: null,
    minPrice: null,
    maxPrice: null,
    radiusMiles: null,
    sort: null,
    interpretation: "Searching Ticketmaster.",
    ...overrides,
  };
}

function callerLocation(
  overrides: Partial<CallerLocation> = {},
): CallerLocation {
  return {
    latitude: null,
    longitude: null,
    city: null,
    stateCode: null,
    postalCode: null,
    countryCode: null,
    ...overrides,
  };
}

function resolved(
  overrides: Partial<ResolvedLocation> = {},
): ResolvedLocation {
  return {
    source: "query",
    geoPoint: null,
    radiusMiles: null,
    city: null,
    stateCode: null,
    postalCode: null,
    countryCode: null,
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
  /** Edge geo headers on the inbound request. */
  headers?: Record<string, string>;
  /** Pass null to simulate an unconfigured function. */
  apiKey?: string | null;
  /** What the stubbed fetch does. Defaults to a successful OpenAI response. */
  openAI?: () => Response | Promise<Response>;
  /** Verified Supabase user ID, as index.ts would pass it. */
  userId?: string | null;
  /**
   * Defaults to a fresh in-memory limiter with the default limits, so tests
   * that aren't about rate limiting are never throttled.
   */
  rateLimiter?: LunaRateLimiter;
};

type RunResult = {
  response: Response;
  json: Record<string, unknown>;
  requests: CapturedRequest[];
  errors: unknown[][];
  /** Parsed structured log lines written with console.info. */
  events: Record<string, unknown>[];
  /** Everything written to any console method, for leak checks. */
  logText: string;
};

/** The default model output: an explicit, fully-anchored Oakland search. */
function oaklandJazz() {
  return criteria({
    city: "Oakland",
    stateCode: "CA",
    genres: ["Jazz"],
  });
}

/**
 * Invokes the handler with OPENAI_API_KEY, globalThis.fetch and console.error
 * all stubbed, and restores them afterwards.
 */
async function run(
  {
    method = "POST",
    body = { query: "jazz in Oakland" },
    headers = {},
    apiKey = "test-openai-key",
    openAI = () => Response.json(openAIPayload(oaklandJazz())),
    userId = null,
    rateLimiter = new LunaRateLimiter(
      new InMemoryRateLimitStore(),
      () => undefined,
    ),
  }: RunOptions = {},
): Promise<RunResult> {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const originalKey = Deno.env.get("OPENAI_API_KEY");

  const requests: CapturedRequest[] = [];
  const errors: unknown[][] = [];
  const events: Record<string, unknown>[] = [];
  const logLines: string[] = [];

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

  const stringify = (args: unknown[]) =>
    args.map((arg) => typeof arg === "string" ? arg : JSON.stringify(arg))
      .join(" ");

  console.error = (...args: unknown[]) => {
    errors.push(args);
    logLines.push(stringify(args));
  };

  console.warn = (...args: unknown[]) => {
    logLines.push(stringify(args));
  };

  console.info = (...args: unknown[]) => {
    logLines.push(stringify(args));
    try {
      events.push(JSON.parse(String(args[0])));
    } catch {
      // Not a structured event.
    }
  };

  try {
    const request = new Request("http://localhost/concert-query", {
      method,
      ...(method === "GET" || body === undefined ? { headers } : {
        headers: { "Content-Type": "application/json", ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    });

    const response = await handleConcertQuery(request, {
      userId,
      rateLimiter,
    });
    const json = await response.clone().json() as Record<string, unknown>;

    return {
      response,
      json,
      requests,
      errors,
      events,
      logText: logLines.join("\n"),
    };
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    console.info = originalInfo;
    console.warn = originalWarn;
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
 * normalizeStateCode / normalizeCountryCode
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

Deno.test("normalizeCountryCode uppercases and validates a country code", () => {
  assertEquals(normalizeCountryCode("us"), "US");
  assertEquals(normalizeCountryCode(null), null);

  assertThrows(
    () => normalizeCountryCode("USA"),
    Error,
    "Invalid countryCode returned by model",
  );
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
 * normalizeGenres
 * ---------------------------------------------------------------------- */

Deno.test("normalizeGenres keeps known Ticketmaster genres in order", () => {
  assertEquals(
    normalizeGenres(["Jazz", "Folk", "Alternative"]),
    ["Jazz", "Folk", "Alternative"],
  );
});

Deno.test("normalizeGenres canonicalizes casing and whitespace", () => {
  assertEquals(normalizeGenres([" jazz ", "HIP-HOP/RAP"]), [
    "Jazz",
    "Hip-Hop/Rap",
  ]);
});

Deno.test("normalizeGenres drops genres Ticketmaster does not have", () => {
  // A silently wrong classificationName returns zero events with no error,
  // so "chill" must never survive as a genre.
  assertEquals(normalizeGenres(["chill", "vibey", "Jazz"]), ["Jazz"]);
  assertEquals(normalizeGenres(["chill"]), null);
});

Deno.test("normalizeGenres de-duplicates and caps the list", () => {
  assertEquals(normalizeGenres(["Jazz", "jazz", "JAZZ"]), ["Jazz"]);

  assertEquals(
    normalizeGenres(["Jazz", "Folk", "Rock", "Pop", "Metal"])?.length,
    MAX_GENRES,
  );
});

Deno.test("normalizeGenres treats a non-array or empty array as absent", () => {
  assertEquals(normalizeGenres(null), null);
  assertEquals(normalizeGenres([]), null);
});

/* -------------------------------------------------------------------------
 * normalizePrice / normalizeRadiusMiles / normalizeSort / hasNamedLocation
 * ---------------------------------------------------------------------- */

Deno.test("normalizePrice rounds to whole cents", () => {
  assertEquals(normalizePrice(60, "maxPrice"), 60);
  assertEquals(normalizePrice(59.999, "maxPrice"), 60);
  assertEquals(normalizePrice(0, "minPrice"), 0);
  assertEquals(normalizePrice(null, "maxPrice"), null);
});

Deno.test("normalizePrice rejects negative and non-finite prices", () => {
  for (const invalid of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assertThrows(
      () => normalizePrice(invalid, "maxPrice"),
      Error,
      "Invalid maxPrice returned by model",
    );
  }
});

Deno.test("normalizeRadiusMiles rounds to an integer and clamps the top end", () => {
  assertEquals(normalizeRadiusMiles(19.6), 20);
  assertEquals(normalizeRadiusMiles(0.2), 1);
  assertEquals(normalizeRadiusMiles(99_999), MAX_RADIUS_MILES);
  assertEquals(normalizeRadiusMiles(null), null);
});

Deno.test("normalizeRadiusMiles rejects a non-positive radius", () => {
  for (const invalid of [0, -5]) {
    assertThrows(
      () => normalizeRadiusMiles(invalid),
      Error,
      "Invalid radiusMiles returned by model",
    );
  }
});

Deno.test("normalizeSort accepts only Ticketmaster sort values", () => {
  assertEquals(normalizeSort("date,asc"), "date,asc");
  assertEquals(normalizeSort("distance,asc"), "distance,asc");
  assertEquals(normalizeSort(null), null);

  assertThrows(
    () => normalizeSort("price,asc"),
    Error,
    "Invalid sort returned by model",
  );
});

Deno.test("hasNamedLocation is true for any place the user named", () => {
  for (
    const field of ["city", "stateCode", "postalCode", "countryCode"] as const
  ) {
    assert(
      hasNamedLocation(criteria({ [field]: "value" })),
      `${field} alone counts as a named place`,
    );
  }
});

Deno.test("hasNamedLocation is false when only a keyword or genre was named", () => {
  // The rule geolocation hangs off: naming an artist is not naming a place.
  assertEquals(hasNamedLocation(criteria({ keyword: "Radiohead" })), false);
  assertEquals(hasNamedLocation(criteria({ genres: ["Jazz"] })), false);
  assertEquals(hasNamedLocation(criteria()), false);
});

/* -------------------------------------------------------------------------
 * normalizeCriteria
 * ---------------------------------------------------------------------- */

Deno.test("normalizeCriteria normalizes every field at once", () => {
  assertEquals(
    normalizeCriteria(criteria({
      city: "  Oakland  ",
      stateCode: "ca",
      postalCode: " 94607 ",
      countryCode: "us",
      keyword: "  The Bad Plus ",
      genres: [" jazz "],
      startDateTime: "2026-08-29T00:00:00.000Z",
      endDateTime: "2026-08-31T23:59:59.999Z",
      minPrice: 20,
      maxPrice: 59.999,
      radiusMiles: 24.6,
      sort: "date,asc",
      interpretation: "  Jazz around Oakland this weekend.  ",
    })),
    criteria({
      city: "Oakland",
      stateCode: "CA",
      postalCode: "94607",
      countryCode: "US",
      keyword: "The Bad Plus",
      genres: ["Jazz"],
      startDateTime: "2026-08-29T00:00:00Z",
      endDateTime: "2026-08-31T23:59:59Z",
      minPrice: 20,
      maxPrice: 60,
      radiusMiles: 25,
      sort: "date,asc",
      interpretation: "Jazz around Oakland this weekend.",
    }),
  );
});

Deno.test("normalizeCriteria rejects a start date after the end date", () => {
  assertThrows(
    () =>
      normalizeCriteria(criteria({
        genres: ["Jazz"],
        startDateTime: "2026-08-31T00:00:00Z",
        endDateTime: "2026-08-29T00:00:00Z",
      })),
    Error,
    "startDateTime is after endDateTime",
  );
});

Deno.test("normalizeCriteria rejects a price floor above the ceiling", () => {
  assertThrows(
    () => normalizeCriteria(criteria({ minPrice: 100, maxPrice: 60 })),
    Error,
    "minPrice is above maxPrice",
  );
});

Deno.test("normalizeCriteria allows a zero-length date range", () => {
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
 * parseCallerLocation
 * ---------------------------------------------------------------------- */

Deno.test("parseCallerLocation reads device coordinates", () => {
  assertObjectMatch(
    parseCallerLocation({ latitude: 37.8044, longitude: -122.2712 }),
    { latitude: 37.8044, longitude: -122.2712 },
  );
});

Deno.test("parseCallerLocation drops out-of-range or partial coordinates", () => {
  for (
    const invalid of [
      { latitude: 91, longitude: 0 },
      { latitude: 0, longitude: 181 },
      { latitude: 37.8 },
      { longitude: -122.3 },
      { latitude: "37.8", longitude: "-122.3" },
    ]
  ) {
    const parsed = parseCallerLocation(invalid);

    assertEquals(parsed.latitude, null, JSON.stringify(invalid));
    assertEquals(parsed.longitude, null, JSON.stringify(invalid));
  }
});

Deno.test("parseCallerLocation drops a malformed state or country code", () => {
  // Unlike the model's output, this is untrusted client input: ignore the bad
  // field rather than failing the whole request.
  const parsed = parseCallerLocation({
    city: " Oakland ",
    stateCode: "California",
    countryCode: "USA",
    postalCode: "94607",
  });

  assertEquals(parsed.city, "Oakland");
  assertEquals(parsed.stateCode, null);
  assertEquals(parsed.countryCode, null);
  assertEquals(parsed.postalCode, "94607");
});

Deno.test("parseCallerLocation treats anything that is not an object as absent", () => {
  for (const value of [undefined, null, "Oakland", 42, ["Oakland"]]) {
    assertEquals(parseCallerLocation(value), callerLocation());
  }
});

/* -------------------------------------------------------------------------
 * geoFromHeaders
 * ---------------------------------------------------------------------- */

Deno.test("geoFromHeaders reads Vercel-style geo headers", () => {
  const geo = geoFromHeaders(
    new Headers({
      "x-vercel-ip-latitude": "37.8044",
      "x-vercel-ip-longitude": "-122.2712",
      "x-vercel-ip-city": "San%20Francisco",
      "x-vercel-ip-country-region": "CA",
      "x-vercel-ip-postal-code": "94103",
      "x-vercel-ip-country": "US",
    }),
  );

  assertEquals(geo, {
    latitude: 37.8044,
    longitude: -122.2712,
    city: "San Francisco",
    stateCode: "CA",
    postalCode: "94103",
    countryCode: "US",
  });
});

Deno.test("geoFromHeaders reads Cloudflare-style geo headers", () => {
  const geo = geoFromHeaders(
    new Headers({
      "cf-iplatitude": "37.8044",
      "cf-iplongitude": "-122.2712",
      "cf-ipcity": "Oakland",
      "cf-region-code": "ca",
      "cf-ipcountry": "us",
    }),
  );

  assertObjectMatch(geo, {
    latitude: 37.8044,
    city: "Oakland",
    stateCode: "CA",
    countryCode: "US",
  });
});

Deno.test("geoFromHeaders returns nothing when the edge supplies no geo", () => {
  assertEquals(
    geoFromHeaders(new Headers({ "user-agent": "jamspot-tests" })),
    callerLocation(),
  );
});

Deno.test("geoFromHeaders ignores unparseable coordinates", () => {
  const geo = geoFromHeaders(
    new Headers({
      "x-vercel-ip-latitude": "unknown",
      "x-vercel-ip-longitude": "-122.2712",
      "x-vercel-ip-city": "Oakland",
    }),
  );

  assertEquals(geo.latitude, null);
  assertEquals(geo.longitude, null);
  assertEquals(geo.city, "Oakland");
});

/* -------------------------------------------------------------------------
 * encodeGeohash
 * ---------------------------------------------------------------------- */

Deno.test("encodeGeohash matches the reference vectors", () => {
  // The canonical example from the geohash literature.
  assertEquals(encodeGeohash(57.64911, 10.40744, 11), "u4pruydqqvj");
  assertEquals(encodeGeohash(0, 0, 9), "s00000000");
  assertEquals(encodeGeohash(37.8044, -122.2712), "9q9p1dhfd");
});

Deno.test("encodeGeohash honours the requested precision", () => {
  // Shorter hashes are prefixes of longer ones: the same point, a coarser cell.
  const full = encodeGeohash(37.8044, -122.2712, 9);

  for (let precision = 1; precision <= 9; precision++) {
    assertEquals(
      encodeGeohash(37.8044, -122.2712, precision),
      full.slice(0, precision),
      `precision ${precision}`,
    );
  }
});

Deno.test("encodeGeohash separates the hemispheres", () => {
  // First character encodes the quadrant, so these must not collide.
  const hashes = new Set([
    encodeGeohash(37.8, -122.3),
    encodeGeohash(37.8, 122.3),
    encodeGeohash(-37.8, -122.3),
    encodeGeohash(-37.8, 122.3),
  ]);

  assertEquals(hashes.size, 4);
});

/* -------------------------------------------------------------------------
 * resolveLocation
 * ---------------------------------------------------------------------- */

const noHeaders = new Headers();

Deno.test("resolveLocation uses the place the user named", () => {
  assertEquals(
    resolveLocation(
      criteria({ city: "Oakland", stateCode: "CA" }),
      // Present, and deliberately ignored: the query wins.
      callerLocation({ latitude: 40.7, longitude: -74 }),
      noHeaders,
    ),
    resolved({ source: "query", city: "Oakland", stateCode: "CA" }),
  );
});

Deno.test("resolveLocation geolocates a named artist with no place", () => {
  // The behaviour this rework exists for: naming Radiohead is not naming a
  // place, so the search runs near the caller rather than nationwide.
  assertEquals(
    resolveLocation(
      criteria({ keyword: "Radiohead" }),
      callerLocation({ latitude: 37.8, longitude: -122.3 }),
      noHeaders,
    ),
    resolved({
      source: "device",
      geoPoint: encodeGeohash(37.8, -122.3),
      radiusMiles: DEFAULT_RADIUS_MILES,
    }),
  );
});

Deno.test("resolveLocation prefers device coordinates for a nearby search", () => {
  assertEquals(
    resolveLocation(
      criteria({ genres: ["Jazz"] }),
      callerLocation({
        latitude: 37.8044,
        longitude: -122.2712,
        city: "Somewhere Stale",
        countryCode: "US",
      }),
      new Headers({ "cf-ipcity": "Ashburn" }),
      ),
    resolved({
      source: "device",
      geoPoint: "9q9p1dhfd",
      radiusMiles: DEFAULT_RADIUS_MILES,
      countryCode: "US",
    }),
  );
});

Deno.test("resolveLocation honours a radius the user implied", () => {
  const location = resolveLocation(
    criteria({ radiusMiles: 20 }),
    callerLocation({ latitude: 37.8, longitude: -122.3 }),
    noHeaders,
  );

  assertEquals(location?.radiusMiles, 20);
});

Deno.test("resolveLocation falls back to a place the caller already knew", () => {
  assertEquals(
    resolveLocation(
      criteria(),
      callerLocation({ city: "Oakland", stateCode: "CA" }),
      noHeaders,
    ),
    resolved({ source: "caller-place", city: "Oakland", stateCode: "CA" }),
  );
});

Deno.test("resolveLocation falls back to the edge network's approximate geo", () => {
  assertEquals(
    resolveLocation(
      criteria(),
      callerLocation(),
      new Headers({
        "cf-iplatitude": "37.8044",
        "cf-iplongitude": "-122.2712",
        "cf-ipcountry": "US",
      }),
    ),
    resolved({
      source: "ip",
      geoPoint: "9q9p1dhfd",
      radiusMiles: DEFAULT_RADIUS_MILES,
      countryCode: "US",
    }),
  );
});

Deno.test("resolveLocation uses an IP-derived city when there are no coordinates", () => {
  assertEquals(
    resolveLocation(
      criteria(),
      callerLocation(),
      new Headers({ "cf-ipcity": "Oakland", "cf-region-code": "CA" }),
    ),
    resolved({ source: "ip", city: "Oakland", stateCode: "CA" }),
  );
});

Deno.test("resolveLocation gives up rather than guessing a city", () => {
  assertEquals(
    resolveLocation(
      criteria({ genres: ["Jazz"] }),
      callerLocation(),
      noHeaders,
    ),
    null,
  );
});

Deno.test("resolveLocation only attaches a radius Ticketmaster would honour", () => {
  // Ticketmaster ignores radius next to a bare city or state.
  const city = resolveLocation(
    criteria({ radiusMiles: 20 }),
    callerLocation({ city: "Oakland" }),
    noHeaders,
  );

  assertEquals(city?.radiusMiles, null);

  const zip = resolveLocation(
    criteria({ radiusMiles: 20 }),
    callerLocation({ postalCode: "94607" }),
    noHeaders,
  );

  assertEquals(zip?.radiusMiles, 20);
});

/* -------------------------------------------------------------------------
 * nationwideFallback
 * ---------------------------------------------------------------------- */

Deno.test("nationwideFallback needs something to match on", () => {
  assertEquals(
    nationwideFallback(criteria({ keyword: "Radiohead" })),
    resolved({ source: "nationwide" }),
  );

  assertEquals(
    nationwideFallback(criteria({ genres: ["Jazz"] })),
    resolved({ source: "nationwide" }),
  );
});

Deno.test("nationwideFallback refuses a search with nothing to match on", () => {
  // Every music event in the country is not an answer to "concerts tonight".
  assertEquals(
    nationwideFallback(criteria({
      startDateTime: "2026-08-29T00:00:00Z",
      endDateTime: "2026-08-31T00:00:00Z",
    })),
    null,
  );
});

/* -------------------------------------------------------------------------
 * toTicketmasterParams
 * ---------------------------------------------------------------------- */

Deno.test("toTicketmasterParams defaults to the music classification", () => {
  assertEquals(
    toTicketmasterParams(
      criteria({ keyword: "Radiohead" }),
      resolved({ city: "Oakland" }),
    ),
    { keyword: "Radiohead", classificationName: "music", city: "Oakland" },
  );
});

Deno.test("toTicketmasterParams ORs genres instead of the music default", () => {
  // Ticketmaster ORs repeated classification values, so a mood becomes a
  // union of genres. Keeping "music" in the list would widen it back out.
  assertEquals(
    toTicketmasterParams(
      criteria({ genres: ["Jazz", "Folk", "Alternative"] }),
      resolved({ city: "Oakland" }),
    ).classificationName,
    "Jazz,Folk,Alternative",
  );
});

Deno.test("toTicketmasterParams maps a geolocated search to geoPoint and radius", () => {
  assertEquals(
    toTicketmasterParams(
      criteria({ genres: ["Jazz"] }),
      resolved({
        source: "device",
        geoPoint: "9q9p1dhfd",
        radiusMiles: 50,
      }),
    ),
    {
      classificationName: "Jazz",
      geoPoint: "9q9p1dhfd",
      radius: 50,
      unit: "miles",
    },
  );
});

Deno.test("toTicketmasterParams drops a radius with no point to measure from", () => {
  const params = toTicketmasterParams(
    criteria(),
    resolved({ source: "query", city: "Oakland", radiusMiles: 25 }),
  );

  assertEquals(params.radius, undefined);
  assertEquals(params.unit, undefined);
});

Deno.test("toTicketmasterParams downgrades distance sorting without coordinates", () => {
  assertEquals(
    toTicketmasterParams(
      criteria({ sort: "distance,asc" }),
      resolved({ source: "query", city: "Oakland" }),
    ).sort,
    "date,asc",
  );

  assertEquals(
    toTicketmasterParams(
      criteria({ sort: "distance,asc" }),
      resolved({ source: "device", geoPoint: encodeGeohash(37.8, -122.3) }),
    ).sort,
    "distance,asc",
  );
});

Deno.test("toTicketmasterParams maps every supplied field", () => {
  assertEquals(
    toTicketmasterParams(
      criteria({
        keyword: "The Bad Plus",
        genres: ["Jazz"],
        startDateTime: "2026-08-29T00:00:00Z",
        endDateTime: "2026-08-31T23:59:59Z",
        sort: "relevance,desc",
      }),
      resolved({
        source: "query",
        city: "Oakland",
        stateCode: "CA",
        postalCode: "94607",
        countryCode: "US",
        radiusMiles: 25,
      }),
    ),
    {
      keyword: "The Bad Plus",
      classificationName: "Jazz",
      city: "Oakland",
      stateCode: "CA",
      postalCode: "94607",
      countryCode: "US",
      radius: 25,
      unit: "miles",
      startDateTime: "2026-08-29T00:00:00Z",
      endDateTime: "2026-08-31T23:59:59Z",
      sort: "relevance,desc",
    },
  );
});

/* -------------------------------------------------------------------------
 * toPriceFilter
 * ---------------------------------------------------------------------- */

Deno.test("toPriceFilter returns null when the user set no limit", () => {
  assertEquals(toPriceFilter(criteria()), null);
});

Deno.test("toPriceFilter carries each supplied bound", () => {
  assertEquals(toPriceFilter(criteria({ maxPrice: 60 })), {
    maxPrice: 60,
    currency: "USD",
  });

  assertEquals(toPriceFilter(criteria({ minPrice: 20, maxPrice: 60 })), {
    minPrice: 20,
    maxPrice: 60,
    currency: "USD",
  });
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
  for (
    const body of [{}, { query: "" }, { query: "   " }, { query: 42 }, {
      query: null,
    }]
  ) {
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
    // Extraction plus a little mood-to-genre inference.
    reasoning: { effort: "low" },
    store: false,
    max_output_tokens: 700,
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
    "countryCode",
    "keyword",
    "genres",
    "startDateTime",
    "endDateTime",
    "minPrice",
    "maxPrice",
    "radiusMiles",
    "sort",
    "interpretation",
  ]);
});

Deno.test("handleConcertQuery constrains genres to Ticketmaster's own list", async () => {
  const { requests } = await run();

  const schema = (requests[0].body.text as {
    format: {
      schema: {
        properties: { genres: { items: { enum: string[] } } };
      };
    };
  }).format.schema;

  assert(schema.properties.genres.items.enum.includes("Jazz"));
  assertEquals(schema.properties.genres.items.enum.includes("Chill"), false);
});

Deno.test("handleConcertQuery never sends the caller's location to the model", async () => {
  const { requests } = await run({
    body: {
      query: "  chill concert under $60  ",
      timeZone: "America/Los_Angeles",
      // The handler uses this; the model must never see it.
      location: { latitude: 37.8044, longitude: -122.2712, city: "Oakland" },
      userId: "user-123",
    },
    headers: {
      "cf-iplatitude": "37.8044",
      "cf-iplongitude": "-122.2712",
      "cf-ipcity": "Oakland",
    },
  });

  // `input` is the only part of the request that carries anything
  // per-caller; `instructions` is a static prompt.
  const input = JSON.parse(requests[0].body.input as string);

  assertEquals(String(input).includes("37.8044"), false);
  assertEquals(String(requests[0].body.input).includes("Oakland"), false);

  assertEquals(Object.keys(input).sort(), [
    "currentDateTime",
    "query",
    "timeZone",
  ]);
  assertEquals(input.query, "chill concert under $60", "query is trimmed");
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

Deno.test("handleConcertQuery instructs the model to delegate geolocation, not perform it", async () => {
  const { requests } = await run();

  const instructions = String(requests[0].body.instructions);

  assertMatch(instructions, /You never guess where the user is/);
  assertMatch(instructions, /Do not guess a user's city, state, ZIP code/);
  assertMatch(instructions, /Do not infer location from the supplied timeZone/);
  assertMatch(
    instructions,
    /Every such search runs near the user,\s+including one that names an artist/,
  );
  assertMatch(instructions, /Never manufacture a location the user did not give you/);
  assertMatch(instructions, /Do not claim a concert exists/);
  assertMatch(
    instructions,
    /Never use your knowledge cutoff as the current date/,
  );
});

/* -------------------------------------------------------------------------
 * handleConcertQuery - success
 * ---------------------------------------------------------------------- */

Deno.test("handleConcertQuery returns the parameters for an explicit search", async () => {
  const { response, json } = await run({
    body: {
      query: "jazz in Oakland this weekend",
      timeZone: "America/Los_Angeles",
    },
    openAI: () =>
      Response.json(openAIPayload(criteria({
        city: " Oakland ",
        stateCode: "ca",
        genres: ["Jazz"],
        startDateTime: "2026-08-29T07:00:00.000Z",
        endDateTime: "2026-08-31T06:59:59.999Z",
        sort: "date,asc",
        interpretation: "Jazz shows around Oakland this weekend.",
      }))),
  });

  assertEquals(response.status, 200);
  assertEquals(json.query, "jazz in Oakland this weekend");
  assertEquals(json.interpretation, "Jazz shows around Oakland this weekend.");
  assertEquals(json.ticketmasterParams, {
    classificationName: "Jazz",
    city: "Oakland",
    stateCode: "CA",
    startDateTime: "2026-08-29T07:00:00Z",
    endDateTime: "2026-08-31T06:59:59Z",
    sort: "date,asc",
  });
  assertEquals(json.filters, undefined, "no price limit was asked for");

  const meta = json.meta as Record<string, string>;
  assertEquals(meta.model, OPENAI_MODEL);
  assertEquals(meta.timeZone, "America/Los_Angeles");
  assertEquals(meta.locationSource, "query");
  assertMatch(meta.currentDateTime, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
});

Deno.test('handleConcertQuery geolocates "chill concert under $60"', async () => {
  // The example this rework exists for: no artist, no city, a mood and a
  // price ceiling. The model asks for the caller's location; the handler
  // supplies it and turns the mood into real Ticketmaster genres.
  const { response, json } = await run({
    body: {
      query: "chill concert under $60",
      timeZone: "America/Los_Angeles",
      location: { latitude: 37.8044, longitude: -122.2712 },
    },
    openAI: () =>
      Response.json(openAIPayload(criteria({
        genres: ["Jazz", "Folk", "Alternative"],
        maxPrice: 60,
        sort: "distance,asc",
        interpretation: "Laid-back shows near you with tickets under $60.",
      }))),
  });

  assertEquals(response.status, 200);
  assertEquals(json.ticketmasterParams, {
    classificationName: "Jazz,Folk,Alternative",
    geoPoint: "9q9p1dhfd",
    radius: DEFAULT_RADIUS_MILES,
    unit: "miles",
    sort: "distance,asc",
  });
  // Ticketmaster has no price parameter, so the ceiling comes back as a
  // filter for the caller to apply to the events it gets.
  assertEquals(json.filters, { maxPrice: 60, currency: "USD" });
  assertEquals(json.interpretation, "Laid-back shows near you with tickets under $60.");

  assertObjectMatch(json.meta as Record<string, unknown>, {
    locationSource: "device",
  });
});

Deno.test("handleConcertQuery geolocates from edge headers when the caller sends none", async () => {
  const { response, json } = await run({
    body: { query: "something fun tonight" },
    headers: {
      "x-vercel-ip-latitude": "37.8044",
      "x-vercel-ip-longitude": "-122.2712",
    },
    openAI: () =>
      Response.json(openAIPayload(criteria({ genres: ["Pop"] }))),
  });

  assertEquals(response.status, 200);
  assertObjectMatch(json.ticketmasterParams as Record<string, unknown>, {
    geoPoint: "9q9p1dhfd",
    radius: DEFAULT_RADIUS_MILES,
  });
  assertObjectMatch(json.meta as Record<string, unknown>, {
    locationSource: "ip",
  });
});

Deno.test("handleConcertQuery geolocates a named-artist search too", async () => {
  // Naming an artist is not naming a place, so this runs near the caller
  // rather than nationwide.
  const { response, json } = await run({
    body: {
      query: "Radiohead tickets",
      location: { latitude: 37.8044, longitude: -122.2712 },
    },
    openAI: () =>
      Response.json(openAIPayload(criteria({
        keyword: "Radiohead",
        sort: "relevance,desc",
      }))),
  });

  assertEquals(response.status, 200);
  assertEquals(json.ticketmasterParams, {
    keyword: "Radiohead",
    classificationName: "music",
    geoPoint: "9q9p1dhfd",
    radius: DEFAULT_RADIUS_MILES,
    unit: "miles",
    sort: "relevance,desc",
  });
  assertObjectMatch(json.meta as Record<string, unknown>, {
    locationSource: "device",
  });
});

Deno.test("handleConcertQuery reports the model the API actually served", async () => {
  const { json } = await run({
    openAI: () =>
      Response.json(
        openAIPayload(oaklandJazz(), {
          model: "gpt-5.6-luna-2026-07-01",
        }),
      ),
  });

  assertEquals(
    (json.meta as Record<string, string>).model,
    "gpt-5.6-luna-2026-07-01",
  );
});

Deno.test("handleConcertQuery falls back to the configured model name in meta", async () => {
  const { json } = await run({
    openAI: () =>
      Response.json({
        output: [{
          type: "message",
          content: [{
            type: "output_text",
            text: JSON.stringify(oaklandJazz()),
          }],
        }],
      }),
  });

  assertEquals((json.meta as Record<string, string>).model, OPENAI_MODEL);
});

/* -------------------------------------------------------------------------
 * handleConcertQuery - when the caller cannot be located
 * ---------------------------------------------------------------------- */

Deno.test("handleConcertQuery asks for a location instead of guessing one", async () => {
  const { response, json } = await run({
    // No caller location, no edge geo headers.
    body: { query: "chill concert under $60" },
    openAI: () =>
      Response.json(openAIPayload(criteria({
        genres: ["Jazz", "Folk"],
        maxPrice: 60,
        interpretation: "Laid-back shows near you with tickets under $60.",
      }))),
  });

  assertEquals(response.status, 422);
  assertEquals(json.code, "location_required");
  assertEquals(
    json.error,
    "Share your location or name a city to find shows near you.",
  );
  // The client needs this to explain what it is asking permission for.
  assertEquals(
    json.interpretation,
    "Laid-back shows near you with tickets under $60.",
  );
});

Deno.test("handleConcertQuery asks for a location even when an artist was named", async () => {
  // The client hasn't reported a refusal yet, so it is asked to try.
  const { response, json } = await run({
    body: { query: "Radiohead tickets" },
    openAI: () =>
      Response.json(openAIPayload(criteria({ keyword: "Radiohead" }))),
  });

  assertEquals(response.status, 422);
  assertEquals(json.code, "location_required");
});

Deno.test("handleConcertQuery searches nationwide once the caller refuses a location", async () => {
  const { response, json } = await run({
    body: { query: "Radiohead tickets", geolocationDenied: true },
    openAI: () =>
      Response.json(openAIPayload(criteria({
        keyword: "Radiohead",
        sort: "relevance,desc",
      }))),
  });

  assertEquals(response.status, 200);
  assertEquals(json.ticketmasterParams, {
    keyword: "Radiohead",
    classificationName: "music",
    sort: "relevance,desc",
  });
  assertObjectMatch(json.meta as Record<string, unknown>, {
    locationSource: "nationwide",
  });
});

Deno.test("handleConcertQuery widens a genre search nationwide too", async () => {
  const { response, json } = await run({
    body: { query: "chill concert under $60", geolocationDenied: true },
    openAI: () =>
      Response.json(openAIPayload(criteria({
        genres: ["Jazz", "Folk"],
        maxPrice: 60,
        // Only meaningful with coordinates; downgraded on the way out.
        sort: "distance,asc",
      }))),
  });

  assertEquals(response.status, 200);
  assertEquals(json.ticketmasterParams, {
    classificationName: "Jazz,Folk",
    sort: "date,asc",
  });
  assertEquals(json.filters, { maxPrice: 60, currency: "USD" });
});

Deno.test("handleConcertQuery still prefers a real location over the fallback", async () => {
  // The flag only matters when nothing else can locate the caller.
  const { response, json } = await run({
    body: {
      query: "Radiohead tickets",
      geolocationDenied: true,
      location: { latitude: 37.8044, longitude: -122.2712 },
    },
    openAI: () =>
      Response.json(openAIPayload(criteria({ keyword: "Radiohead" }))),
  });

  assertEquals(response.status, 200);
  assertObjectMatch(json.meta as Record<string, unknown>, {
    locationSource: "device",
  });
});

Deno.test("handleConcertQuery refuses a refused-location search with nothing to match on", async () => {
  const { response, json } = await run({
    body: { query: "concerts tonight", geolocationDenied: true },
    openAI: () =>
      Response.json(openAIPayload(criteria({
        startDateTime: "2026-08-29T00:00:00Z",
        endDateTime: "2026-08-30T06:59:59Z",
      }))),
  });

  assertEquals(response.status, 422);
  assertEquals(json.code, "anchor_required");
  assertEquals(
    json.error,
    "Include an artist, genre, venue, event, city, state, or ZIP code.",
  );
});

Deno.test("handleConcertQuery treats a whitespace-only place as no place", async () => {
  // Blank is not a location, so this geolocates rather than sending
  // Ticketmaster an empty city.
  const { response, json } = await run({
    body: {
      query: "concerts",
      location: { latitude: 37.8044, longitude: -122.2712 },
    },
    openAI: () =>
      Response.json(openAIPayload(criteria({ city: "   ", stateCode: "  " }))),
  });

  assertEquals(response.status, 200);
  assertObjectMatch(json.ticketmasterParams as Record<string, unknown>, {
    geoPoint: "9q9p1dhfd",
  });
  assertObjectMatch(json.meta as Record<string, unknown>, {
    locationSource: "device",
  });
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
    [
      "bad stateCode",
      criteria({ city: "Oakland", stateCode: "California" }),
    ],
    ["bad countryCode", criteria({ countryCode: "USA" })],
    ["bad date", criteria({ genres: ["Jazz"], startDateTime: "this weekend" })],
    [
      "inverted date range",
      criteria({
        genres: ["Jazz"],
        startDateTime: "2026-08-31T00:00:00Z",
        endDateTime: "2026-08-29T00:00:00Z",
      }),
    ],
    ["inverted price range", criteria({ minPrice: 100, maxPrice: 60 })],
    ["negative price", criteria({ maxPrice: -1 })],
    ["unknown sort", criteria({ genres: ["Jazz"], sort: "price,asc" })],
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

/* -------------------------------------------------------------------------
 * handleConcertQuery - Luna rate limiting (TEA-52)
 * ---------------------------------------------------------------------- */

const RATE_LIMIT_BODY = {
  type: "rate_limit_error",
  code: "luna_rate_limit_exceeded",
  message: "Too many AI-powered searches. Please try again shortly.",
};

/** A controllable clock, starting at the beginning of a 60-second window. */
function fakeClock(start = Date.UTC(2026, 8, 16, 12, 0, 0)) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

/** Wraps a store so tests can count how often capacity was consumed. */
function spyStore(inner: RateLimitStore) {
  const calls: number[] = [];
  const store: RateLimitStore = {
    consume(buckets, windowSeconds) {
      calls.push(buckets.length);
      return inner.consume(buckets, windowSeconds);
    },
  };
  return { store, calls };
}

function limiterWith(
  {
    max = "2",
    window = "60",
    ipMax,
    clock = fakeClock(),
    store,
  }: {
    max?: string;
    window?: string;
    ipMax?: string;
    clock?: ReturnType<typeof fakeClock>;
    store?: RateLimitStore;
  } = {},
) {
  const memory = new InMemoryRateLimitStore(clock.now);
  const spy = spyStore(store ?? memory);
  const env: Record<string, string | undefined> = {
    LUNA_RATE_LIMIT_MAX_REQUESTS: max,
    LUNA_RATE_LIMIT_WINDOW_SECONDS: window,
    LUNA_RATE_LIMIT_IP_MAX_REQUESTS: ipMax,
  };
  return {
    limiter: new LunaRateLimiter(spy.store, (name) => env[name]),
    consumed: spy.calls,
    clock,
    env,
  };
}

const ANON_HEADERS = {
  "x-jamspot-session-id": "3f1c2b8e-9d4a-4c1e-8f7a-2b6d5e4c3a21",
  "x-forwarded-for": "203.0.113.7, 10.0.0.1",
};

Deno.test("rate limit: requests under the limit reach Luna and are logged as allowed", async () => {
  const { limiter } = limiterWith({ max: "2" });

  for (let i = 0; i < 2; i++) {
    const { response, requests, events } = await run({
      rateLimiter: limiter,
      headers: ANON_HEADERS,
    });

    assertEquals(response.status, 200);
    assertEquals(requests.length, 1);
    assertObjectMatch(
      events.find((e) => e.event === "luna_rate_limit")!,
      {
        outcome: "allowed",
        identityType: "session",
        limit: 2,
        windowSeconds: 60,
      },
    );
  }
});

Deno.test("rate limit: a request over the limit gets 429 and never calls the LLM", async () => {
  const { limiter } = limiterWith({ max: "2" });

  await run({ rateLimiter: limiter, headers: ANON_HEADERS });
  await run({ rateLimiter: limiter, headers: ANON_HEADERS });

  const { response, json, requests, events } = await run({
    rateLimiter: limiter,
    headers: ANON_HEADERS,
  });

  assertEquals(response.status, 429);
  assertEquals(json, RATE_LIMIT_BODY);
  assertEquals(requests.length, 0, "OpenAI must not be called");
  assertEquals(response.headers.get("Retry-After"), "60");
  assertObjectMatch(
    events.find((e) => e.event === "luna_rate_limit")!,
    { outcome: "rejected", identityType: "session" },
  );
});

Deno.test("rate limit: the 429 body exposes no counters or infrastructure details", async () => {
  const { limiter } = limiterWith({ max: "1" });

  await run({ rateLimiter: limiter, headers: ANON_HEADERS });
  const { json } = await run({ rateLimiter: limiter, headers: ANON_HEADERS });

  assertEquals(Object.keys(json).sort(), ["code", "message", "type"]);
  const text = JSON.stringify(json);
  for (const leak of ["203.0.113.7", "luna:v1", "supabase", "remaining", "count", "window"]) {
    assertEquals(text.toLowerCase().includes(leak), false, leak);
  }
});

Deno.test("rate limit: capacity comes back when the window resets", async () => {
  const clock = fakeClock();
  const { limiter } = limiterWith({ max: "1", window: "60", clock });

  assertEquals(
    (await run({ rateLimiter: limiter, headers: ANON_HEADERS })).response
      .status,
    200,
  );

  clock.advance(30_000);
  const blocked = await run({ rateLimiter: limiter, headers: ANON_HEADERS });
  assertEquals(blocked.response.status, 429);
  assertEquals(blocked.response.headers.get("Retry-After"), "30");

  clock.advance(30_000);
  const reset = await run({ rateLimiter: limiter, headers: ANON_HEADERS });
  assertEquals(reset.response.status, 200);
  assertEquals(reset.requests.length, 1);
});

Deno.test("rate limit: requests rejected before Luna do not consume capacity", async () => {
  const { limiter, consumed } = limiterWith({ max: "1" });

  const rejected: RunOptions[] = [
    { method: "GET" },
    { body: "{not json" },
    { body: null },
    { body: ["jazz"] },
    { body: {} },
    { body: { query: "   " } },
    { body: { query: 42 } },
    { body: { query: "x".repeat(501) } },
  ];

  for (const options of rejected) {
    const { response, requests, events } = await run({
      ...options,
      rateLimiter: limiter,
      headers: ANON_HEADERS,
    });

    assert(response.status >= 400 && response.status < 500);
    assert(response.status !== 429, "routing rejections are not rate limited");
    assertEquals(requests.length, 0);
    assertObjectMatch(events.find((e) => e.event === "luna_route")!, {
      route: "rejected",
    });
  }

  assertEquals(consumed.length, 0, "the limiter was never consulted");

  // The single allowed Luna request is still available.
  const { response } = await run({ rateLimiter: limiter, headers: ANON_HEADERS });
  assertEquals(response.status, 200);
});

Deno.test("rate limit: an unconfigured function does not consume capacity", async () => {
  const { limiter, consumed } = limiterWith({ max: "1" });

  const { response } = await run({ rateLimiter: limiter, apiKey: null });

  assertEquals(response.status, 500);
  assertEquals(consumed.length, 0);
});

Deno.test("rate limit: a failed Luna request still counts once the provider was called", async () => {
  const { limiter } = limiterWith({ max: "1" });

  const failed = await run({
    rateLimiter: limiter,
    headers: ANON_HEADERS,
    openAI: () => Response.json({ error: {} }, { status: 500 }),
  });
  assertEquals(failed.response.status, 502);
  assertEquals(failed.requests.length, 1);

  const next = await run({ rateLimiter: limiter, headers: ANON_HEADERS });
  assertEquals(next.response.status, 429);
  assertEquals(next.requests.length, 0);
});

Deno.test("rate limit: a network failure reaching the provider still counts", async () => {
  const { limiter } = limiterWith({ max: "1" });

  const failed = await run({
    rateLimiter: limiter,
    headers: ANON_HEADERS,
    openAI: () => {
      throw new TypeError("network down");
    },
  });
  assertEquals(failed.response.status, 502);

  const next = await run({ rateLimiter: limiter, headers: ANON_HEADERS });
  assertEquals(next.response.status, 429);
});

Deno.test("rate limit: a location_required round trip counts each Luna call", async () => {
  const { limiter } = limiterWith({ max: "1" });

  // No place named, nothing to geolocate from: Luna runs, then asks for a location.
  const first = await run({
    rateLimiter: limiter,
    headers: ANON_HEADERS,
    body: { query: "concerts tonight" },
    openAI: () => Response.json(openAIPayload(criteria())),
  });
  assertEquals(first.response.status, 422);
  assertEquals(first.json.code, "location_required");

  // The retry would call Luna again, so it is limited like any other call.
  const retry = await run({
    rateLimiter: limiter,
    headers: ANON_HEADERS,
    body: { query: "concerts tonight", geolocationDenied: true },
  });
  assertEquals(retry.response.status, 429);
  assertEquals(retry.requests.length, 0);
});

Deno.test("rate limit: fails closed with 503 when the counter store is unavailable", async () => {
  const broken: RateLimitStore = {
    consume: () => Promise.reject(new Error("connection refused")),
  };
  const { limiter } = limiterWith({ store: broken });

  const { response, json, requests } = await run({
    rateLimiter: limiter,
    headers: ANON_HEADERS,
  });

  assertEquals(response.status, 503);
  assertEquals(json.type, "rate_limit_error");
  assertEquals(json.code, "luna_rate_limit_unavailable");
  assertEquals(requests.length, 0, "no fallback path may reach the LLM");
});

Deno.test("rate limit: authenticated users are limited by their verified user ID", async () => {
  const { limiter } = limiterWith({ max: "1" });
  const userId = "7b0a4e6c-1d2f-4a3b-9c8d-5e6f7a8b9c0d";

  const first = await run({
    rateLimiter: limiter,
    userId,
    headers: { ...ANON_HEADERS, "x-jamspot-session-id": "a".repeat(32) },
  });
  assertEquals(first.response.status, 200);
  assertObjectMatch(first.events.find((e) => e.event === "luna_rate_limit")!, {
    identityType: "user",
  });

  // A new session ID or IP address doesn't give the same user more capacity.
  const second = await run({
    rateLimiter: limiter,
    userId,
    headers: {
      "x-jamspot-session-id": "b".repeat(32),
      "x-forwarded-for": "198.51.100.1",
    },
  });
  assertEquals(second.response.status, 429);

  // A different user, or an anonymous caller, has their own capacity.
  const other = await run({
    rateLimiter: limiter,
    userId: "00000000-0000-4000-8000-000000000000",
  });
  assertEquals(other.response.status, 200);

  const anonymous = await run({ rateLimiter: limiter, headers: ANON_HEADERS });
  assertEquals(anonymous.response.status, 200);
});

Deno.test("rate limit: a user ID in the request body is ignored", async () => {
  const { limiter } = limiterWith({ max: "1" });

  await run({ rateLimiter: limiter, headers: ANON_HEADERS });

  const spoofed = await run({
    rateLimiter: limiter,
    headers: ANON_HEADERS,
    body: {
      query: "jazz in Oakland",
      userId: "7b0a4e6c-1d2f-4a3b-9c8d-5e6f7a8b9c0d",
      user_id: "7b0a4e6c-1d2f-4a3b-9c8d-5e6f7a8b9c0d",
    },
  });

  assertEquals(spoofed.response.status, 429);
});

Deno.test("rate limit: anonymous sessions are separate, but share an IP address ceiling", async () => {
  const { limiter } = limiterWith({ max: "1", ipMax: "3" });
  const ip = { "x-forwarded-for": "203.0.113.7" };
  const session = (n: number) => ({
    ...ip,
    "x-jamspot-session-id": `session-${n}`.padEnd(24, "x"),
  });

  // The same session is stable across requests.
  assertEquals(
    (await run({ rateLimiter: limiter, headers: session(1) })).response.status,
    200,
  );
  assertEquals(
    (await run({ rateLimiter: limiter, headers: session(1) })).response.status,
    429,
  );

  // Other sessions on the same network each get their own capacity...
  assertEquals(
    (await run({ rateLimiter: limiter, headers: session(2) })).response.status,
    200,
  );
  assertEquals(
    (await run({ rateLimiter: limiter, headers: session(3) })).response.status,
    200,
  );

  // ...until the IP address ceiling stops a client that keeps making up new IDs.
  const rotated = await run({ rateLimiter: limiter, headers: session(4) });
  assertEquals(rotated.response.status, 429);
  assertEquals(rotated.requests.length, 0);

  // A different IP address is unaffected.
  const elsewhere = await run({
    rateLimiter: limiter,
    headers: {
      "x-forwarded-for": "198.51.100.1",
      "x-jamspot-session-id": "session-4".padEnd(24, "x"),
    },
  });
  assertEquals(elsewhere.response.status, 200);
});

Deno.test("rate limit: configuration is read at request time", async () => {
  const { limiter, env } = limiterWith({ max: "1" });

  await run({ rateLimiter: limiter, headers: ANON_HEADERS });
  assertEquals(
    (await run({ rateLimiter: limiter, headers: ANON_HEADERS })).response
      .status,
    429,
  );

  // Raising the secret takes effect on the next request, with no redeploy.
  env.LUNA_RATE_LIMIT_MAX_REQUESTS = "3";
  const { response, events } = await run({
    rateLimiter: limiter,
    headers: ANON_HEADERS,
  });
  assertEquals(response.status, 200);
  assertObjectMatch(events.find((e) => e.event === "luna_rate_limit")!, {
    limit: 3,
  });
});

Deno.test("rate limit: logs never contain tokens, session IDs, IP addresses, or bucket keys", async () => {
  const { limiter } = limiterWith({ max: "1" });
  const headers = {
    ...ANON_HEADERS,
    Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.secret-payload.signature",
    apikey: "sb_publishable_supersecret",
  };

  const allowed = await run({ rateLimiter: limiter, headers });
  const rejected = await run({ rateLimiter: limiter, headers });
  const routed = await run({ rateLimiter: limiter, headers, method: "GET" });

  for (const { logText } of [allowed, rejected, routed]) {
    for (
      const secret of [
        "eyJhbGciOiJIUzI1NiJ9",
        "sb_publishable_supersecret",
        "test-openai-key",
        ANON_HEADERS["x-jamspot-session-id"],
        "203.0.113.7",
        "luna:v1",
      ]
    ) {
      assertEquals(logText.includes(secret), false, secret);
    }
  }
});
