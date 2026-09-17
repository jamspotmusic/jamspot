import assert from "node:assert/strict";
import test from "node:test";

import {
  buildConcertsQuery,
  createLunaSessionId,
  describeConcertQueryError,
  getOrCreateLunaSessionId,
  interpretConcertQuery,
  LUNA_RATE_LIMIT_CODE,
  LUNA_RATE_LIMIT_MESSAGE,
  LUNA_SESSION_ID_HEADER,
  LUNA_SESSION_ID_STORAGE_KEY,
  type ConcertQueryBody,
  type DeviceLocation,
} from "@jamspot/shared";

/**
 * The Edge Function invocation is faked rather than driven through a real
 * Supabase client, so no test touches the network or spends an OpenAI call.
 * `ConcertQueryInvoker` is the structural contract the shared helper accepts,
 * which is what makes that substitution type-safe.
 *
 * Supabase's own error classes are matched on `.name` (see
 * describeConcertQueryError), so the fakes below reproduce that shape instead
 * of importing @supabase/supabase-js.
 */
function httpError(body: unknown) {
  return {
    name: "FunctionsHttpError",
    message: "Edge Function returned a non-2xx status code",
    context: { json: async () => body },
  };
}

const noLocation = async (): Promise<DeviceLocation | null> => null;
const someLocation = async (): Promise<DeviceLocation> => ({
  latitude: 32.78,
  longitude: -96.8,
});

// --- buildConcertsQuery --------------------------------------------------

test("buildConcertsQuery includes every populated param and price filter", () => {
  const search = new URLSearchParams(
    buildConcertsQuery(
      { keyword: "jazz", city: "Dallas", stateCode: "TX", radius: 25 },
      { minPrice: 10, maxPrice: 60, currency: "USD" },
    ),
  );

  assert.equal(search.get("keyword"), "jazz");
  assert.equal(search.get("city"), "Dallas");
  assert.equal(search.get("stateCode"), "TX");
  assert.equal(search.get("radius"), "25");
  assert.equal(search.get("minPrice"), "10");
  assert.equal(search.get("maxPrice"), "60");
});

test("buildConcertsQuery drops undefined, null, and empty values", () => {
  const search = new URLSearchParams(
    buildConcertsQuery({
      keyword: "",
      city: undefined,
      // @ts-expect-error - exercising the runtime guard for null too
      stateCode: null,
      geoPoint: "9q9p1dhfd",
    }),
  );

  assert.equal(search.has("keyword"), false);
  assert.equal(search.has("city"), false);
  assert.equal(search.has("stateCode"), false);
  assert.equal(search.get("geoPoint"), "9q9p1dhfd");
});

test("buildConcertsQuery omits price params when no filter is given", () => {
  const search = new URLSearchParams(buildConcertsQuery({ keyword: "jazz" }));
  assert.equal(search.has("minPrice"), false);
  assert.equal(search.has("maxPrice"), false);
});

// --- describeConcertQueryError -------------------------------------------

test("describeConcertQueryError reads the message and code from the function's body", async () => {
  const result = await describeConcertQueryError(
    httpError({ error: "Share your location", code: "location_required" }),
  );

  assert.equal(result.message, "Share your location");
  assert.equal(result.code, "location_required");
});

test("describeConcertQueryError falls back to the error's own message for an unexpected body", async () => {
  const result = await describeConcertQueryError(httpError({ unexpected: true }));
  assert.equal(result.message, "Edge Function returned a non-2xx status code");
  assert.equal(result.code, undefined);
});

test("describeConcertQueryError survives a body that isn't JSON", async () => {
  const result = await describeConcertQueryError({
    name: "FunctionsHttpError",
    message: "Edge Function returned a non-2xx status code",
    context: {
      json: async () => {
        throw new Error("not json");
      },
    },
  });

  assert.equal(result.message, "Edge Function returned a non-2xx status code");
});

test("describeConcertQueryError labels relay and transport failures distinctly", async () => {
  const relay = await describeConcertQueryError({
    name: "FunctionsRelayError",
    message: "Relay Error invoking the Edge Function",
  });
  assert.match(relay.message, /Supabase relay error/);

  const transport = await describeConcertQueryError({
    name: "FunctionsFetchError",
    message: "Failed to send a request to the Edge Function",
  });
  assert.match(transport.message, /Unable to reach the concert query service/);
});

test("describeConcertQueryError handles plain errors and non-errors", async () => {
  assert.equal((await describeConcertQueryError(new Error("boom"))).message, "boom");
  assert.equal(
    (await describeConcertQueryError("not an error")).message,
    "Concert query failed.",
  );
  assert.equal(
    (await describeConcertQueryError(null)).message,
    "Concert query failed.",
  );
});

// --- interpretConcertQuery -----------------------------------------------

test("interpretConcertQuery returns the response and never asks for a location when none is needed", async () => {
  const bodies: ConcertQueryBody[] = [];
  let locationRequests = 0;

  const result = await interpretConcertQuery(
    async (body) => {
      bodies.push(body);
      return {
        data: {
          query: "jazz in Dallas",
          ticketmasterParams: { keyword: "jazz", city: "Dallas" },
        },
        error: null,
      };
    },
    "jazz in Dallas",
    "America/Chicago",
    async () => {
      locationRequests += 1;
      return null;
    },
  );

  assert.deepEqual(result.ticketmasterParams, { keyword: "jazz", city: "Dallas" });
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].timeZone, "America/Chicago");
  assert.equal("location" in bodies[0], false, "first call carries no location");
  assert.equal(locationRequests, 0, "never prompts when the query names a place");
});

test("interpretConcertQuery retries with device coordinates when the function asks for a location", async () => {
  const bodies: ConcertQueryBody[] = [];

  const result = await interpretConcertQuery(
    async (body) => {
      bodies.push(body);
      if (bodies.length === 1) {
        return {
          data: null,
          error: httpError({ error: "Share your location", code: "location_required" }),
        };
      }
      return { data: { ticketmasterParams: { geoPoint: "9q9p1dhfd" } }, error: null };
    },
    "something chill tonight",
    "UTC",
    someLocation,
  );

  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[1].location, { latitude: 32.78, longitude: -96.8 });
  assert.deepEqual(result.ticketmasterParams, { geoPoint: "9q9p1dhfd" });
});

test("interpretConcertQuery reports geolocationDenied when coordinates can't be had", async () => {
  const bodies: ConcertQueryBody[] = [];

  const result = await interpretConcertQuery(
    async (body) => {
      bodies.push(body);
      if (bodies.length === 1) {
        return {
          data: null,
          error: httpError({ error: "Share your location", code: "location_required" }),
        };
      }
      return { data: { ticketmasterParams: { classificationName: "Jazz" } }, error: null };
    },
    "something chill",
    "UTC",
    noLocation,
  );

  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].geolocationDenied, true);
  assert.equal("location" in bodies[1], false);
  assert.deepEqual(result.ticketmasterParams, { classificationName: "Jazz" });
});

test("interpretConcertQuery surfaces the retry's own error, not the original", async () => {
  let calls = 0;

  await assert.rejects(
    interpretConcertQuery(
      async () => {
        calls += 1;
        if (calls === 1) {
          return {
            data: null,
            error: httpError({
              error: "Share your location",
              code: "location_required",
            }),
          };
        }
        // anchor_required: no location AND nothing to match on.
        return {
          data: null,
          error: httpError({
            error: "Include an artist, genre, venue, event, city, state, or ZIP code.",
            code: "anchor_required",
          }),
        };
      },
      "concerts tonight",
      "UTC",
      noLocation,
    ),
    /Include an artist, genre, venue, event, city, state, or ZIP code\./,
  );

  assert.equal(calls, 2);
});

test("interpretConcertQuery does not retry for errors other than location_required", async () => {
  let calls = 0;
  let locationRequests = 0;

  await assert.rejects(
    interpretConcertQuery(
      async () => {
        calls += 1;
        return {
          data: null,
          error: httpError({ error: "Concert query service is not configured" }),
        };
      },
      "jazz",
      "UTC",
      async () => {
        locationRequests += 1;
        return null;
      },
    ),
    /Concert query service is not configured/,
  );

  assert.equal(calls, 1, "a configuration failure is not retried");
  assert.equal(locationRequests, 0, "and never prompts for a location");
});

test("interpretConcertQuery rejects a response missing ticketmasterParams", async () => {
  await assert.rejects(
    interpretConcertQuery(
      async () => ({ data: { query: "jazz" }, error: null }),
      "jazz",
      "UTC",
      noLocation,
    ),
    /Concert query returned an invalid response/,
  );
});
// --- Luna rate limiting (TEA-52) -----------------------------------------

test("buildConcertsQuery tags the handoff as a Luna search", () => {
  const search = new URLSearchParams(buildConcertsQuery({ keyword: "jazz" }));
  assert.equal(search.get("source"), "luna");
});

test("describeConcertQueryError reads the rate-limit body's message and code", async () => {
  const result = await describeConcertQueryError(
    httpError({
      type: "rate_limit_error",
      code: "luna_rate_limit_exceeded",
      message: "Too many AI-powered searches. Please try again shortly.",
    }),
  );

  assert.equal(result.code, LUNA_RATE_LIMIT_CODE);
  assert.equal(result.message, LUNA_RATE_LIMIT_MESSAGE);
});

test("describeConcertQueryError treats an unreadable 429 as a rate limit", async () => {
  const result = await describeConcertQueryError({
    name: "FunctionsHttpError",
    message: "Edge Function returned a non-2xx status code",
    context: {
      status: 429,
      json: async () => {
        throw new Error("not json");
      },
    },
  });

  assert.equal(result.code, LUNA_RATE_LIMIT_CODE);
  assert.equal(result.message, LUNA_RATE_LIMIT_MESSAGE);
});

test("interpretConcertQuery surfaces a rate limit without asking for a location or retrying", async () => {
  let calls = 0;
  let locationRequested = false;

  await assert.rejects(
    interpretConcertQuery(
      async () => {
        calls += 1;
        return {
          data: null,
          error: httpError({
            type: "rate_limit_error",
            code: "luna_rate_limit_exceeded",
            message: LUNA_RATE_LIMIT_MESSAGE,
          }),
        };
      },
      "jazz tonight",
      "UTC",
      async () => {
        locationRequested = true;
        return null;
      },
    ),
    { message: LUNA_RATE_LIMIT_MESSAGE },
  );

  assert.equal(calls, 1);
  assert.equal(locationRequested, false);
});

test("interpretConcertQuery surfaces a rate limit hit on the location retry", async () => {
  const responses = [
    httpError({ error: "Share your location", code: "location_required" }),
    httpError({
      type: "rate_limit_error",
      code: "luna_rate_limit_exceeded",
      message: LUNA_RATE_LIMIT_MESSAGE,
    }),
  ];

  await assert.rejects(
    interpretConcertQuery(
      async () => ({ data: null, error: responses.shift() }),
      "concerts tonight",
      "UTC",
      someLocation,
    ),
    { message: LUNA_RATE_LIMIT_MESSAGE },
  );
});

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

test("getOrCreateLunaSessionId creates, stores, and then reuses a session ID", async () => {
  const storage = memoryStorage();

  const first = await getOrCreateLunaSessionId(storage);
  assert.match(first, /^[0-9a-f-]{36}$/);
  assert.equal(storage.values.get(LUNA_SESSION_ID_STORAGE_KEY), first);

  assert.equal(await getOrCreateLunaSessionId(storage), first);
});

test("getOrCreateLunaSessionId works with async storage and replaces an invalid stored value", async () => {
  const values = new Map([[LUNA_SESSION_ID_STORAGE_KEY, "bad value"]]);
  const storage = {
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      values.set(key, value);
    },
  };

  const id = await getOrCreateLunaSessionId(storage);
  assert.notEqual(id, "bad value");
  assert.equal(values.get(LUNA_SESSION_ID_STORAGE_KEY), id);
});

test("getOrCreateLunaSessionId falls back to a stable in-memory ID when storage fails", async () => {
  const broken = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("SecurityError");
    },
  };

  const a = await getOrCreateLunaSessionId(broken);
  const b = await getOrCreateLunaSessionId(null);
  assert.match(a, /^[0-9a-f-]{36}$/);
  assert.equal(a, b);
});

test("createLunaSessionId falls back when crypto.randomUUID is unavailable", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", {
    value: {},
    configurable: true,
  });

  try {
    const id = createLunaSessionId();
    assert.match(
      id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  } finally {
    if (original) Object.defineProperty(globalThis, "crypto", original);
  }
});

test("invokeConcertQuery sends the anonymous session ID header", async () => {
  const originalFetch = globalThis.fetch;
  const seen: Headers[] = [];

  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    seen.push(new Headers(init?.headers));
    return new Response(JSON.stringify({ ticketmasterParams: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const { invokeConcertQuery } = await import("@/components/LunaSearch");
    const { error } = await invokeConcertQuery({
      query: "jazz",
      timeZone: "UTC",
    });

    assert.equal(error, null);
    const sent = seen.find((headers) => headers.has(LUNA_SESSION_ID_HEADER));
    assert.ok(sent, "session header was sent");
    assert.match(sent.get(LUNA_SESSION_ID_HEADER)!, /^[0-9a-f-]{36}$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
