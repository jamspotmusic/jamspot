import assert from "node:assert/strict";
import test from "node:test";

import {
  buildConcertsQuery,
  describeConcertQueryError,
  interpretConcertQuery,
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