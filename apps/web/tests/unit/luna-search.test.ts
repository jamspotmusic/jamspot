import assert from "node:assert/strict";
import test from "node:test";

import {
  buildConcertsUrl,
  getFunctionError,
  requestDeviceLocation,
  interpretQuery,
} from "../../components/LunaSearch";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// --- buildConcertsUrl -------------------------------------------------

test("buildConcertsUrl includes every defined param and filter", () => {
  const url = buildConcertsUrl(
    { keyword: "jazz", city: "Dallas", stateCode: "TX" },
    { minPrice: 10, maxPrice: 60, currency: "USD" },
  );

  const parsed = new URL(url, "http://localhost");
  assert.equal(parsed.pathname, "/api/concerts");
  assert.equal(parsed.searchParams.get("keyword"), "jazz");
  assert.equal(parsed.searchParams.get("city"), "Dallas");
  assert.equal(parsed.searchParams.get("stateCode"), "TX");
  assert.equal(parsed.searchParams.get("minPrice"), "10");
  assert.equal(parsed.searchParams.get("maxPrice"), "60");
});

test("buildConcertsUrl omits undefined, null, and empty-string params", () => {
  const url = buildConcertsUrl({
    keyword: "",
    city: undefined,
    // @ts-expect-error - exercising the runtime guard for a null value too
    stateCode: null,
    geoPoint: "9q9p1dh",
  });

  const parsed = new URL(url, "http://localhost");
  assert.equal(parsed.searchParams.has("keyword"), false);
  assert.equal(parsed.searchParams.has("city"), false);
  assert.equal(parsed.searchParams.has("stateCode"), false);
  assert.equal(parsed.searchParams.get("geoPoint"), "9q9p1dh");
});

test("buildConcertsUrl omits filters entirely when none are given", () => {
  const url = buildConcertsUrl({ keyword: "jazz" });
  const parsed = new URL(url, "http://localhost");
  assert.equal(parsed.searchParams.has("minPrice"), false);
  assert.equal(parsed.searchParams.has("maxPrice"), false);
});

// --- getFunctionError ---------------------------------------------------

test("getFunctionError reads the error+code out of a FunctionsHttpError body", async () => {
  const { FunctionsHttpError } = await import("@supabase/supabase-js");
  const error = new FunctionsHttpError(
    jsonResponse({ error: "Share your location", code: "location_required" }, 422),
  );

  const result = await getFunctionError(error);
  assert.equal(result.message, "Share your location");
  assert.equal(result.code, "location_required");
});

test("getFunctionError falls back to the raw error message when the body isn't the expected shape", async () => {
  const { FunctionsHttpError } = await import("@supabase/supabase-js");
  const error = new FunctionsHttpError(jsonResponse({ nothingUseful: true }, 500));

  const result = await getFunctionError(error);
  assert.equal(result.message, "Edge Function returned a non-2xx status code");
  assert.equal(result.code, undefined);
});

test("getFunctionError falls back when the body can't be parsed as JSON", async () => {
  const { FunctionsHttpError } = await import("@supabase/supabase-js");
  const badResponse = new Response("not json", {
    status: 500,
    headers: { "content-type": "application/json" },
  });
  const error = new FunctionsHttpError(badResponse);

  const result = await getFunctionError(error);
  assert.equal(result.message, "Edge Function returned a non-2xx status code");
});

test("getFunctionError maps relay and fetch errors to their fixed, descriptive messages", async () => {
  const { FunctionsRelayError, FunctionsFetchError } = await import("@supabase/supabase-js");

  // These error classes carry a fixed message (not derived from `context`,
  // which is just diagnostic info) - see @supabase/functions-js's types.ts.
  const relay = await getFunctionError(new FunctionsRelayError({ region: "us-east-1" }));
  assert.equal(relay.message, "Supabase relay error: Relay Error invoking the Edge Function");

  const fetchErr = await getFunctionError(new FunctionsFetchError({ requestId: "abc123" }));
  assert.match(
    fetchErr.message,
    /Unable to reach Supabase Edge Function: Failed to send a request to the Edge Function/,
  );
});

test("getFunctionError handles a plain Error and a non-Error throw", async () => {
  const plain = await getFunctionError(new Error("boom"));
  assert.equal(plain.message, "boom");

  const unknown = await getFunctionError("not even an error");
  assert.equal(unknown.message, "Concert query failed.");
});

// --- requestDeviceLocation -----------------------------------------------

// Node ships its own built-in `globalThis.navigator` as a getter-only
// property, so a plain `globalThis.navigator = {...}` throws - redefine it
// instead, and restore the exact original descriptor afterward.
//
// This must `await fn()` inside the try. A non-async version restores
// `navigator` as soon as the callback hits its first `await` rather than
// when it settles, so any geolocation call after that await sees the real
// (mock-free) navigator and silently resolves null.
async function withNavigator<T>(value: unknown, fn: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    value,
    configurable: true,
    writable: true,
  });
  try {
    return await fn();
  } finally {
    if (original) {
      Object.defineProperty(globalThis, "navigator", original);
    } else {
      delete (globalThis as { navigator?: unknown }).navigator;
    }
  }
}

test("requestDeviceLocation resolves null when geolocation is unavailable", async () => {
  await withNavigator({}, async () => {
    assert.equal(await requestDeviceLocation(), null);
  });
});

test("requestDeviceLocation resolves coordinates on success and null on decline", async () => {
  await withNavigator(
    {
      geolocation: {
        getCurrentPosition: (success: (pos: unknown) => void) =>
          success({ coords: { latitude: 32.78, longitude: -96.8 } }),
      },
    },
    async () => {
      assert.deepEqual(await requestDeviceLocation(), {
        latitude: 32.78,
        longitude: -96.8,
      });
    },
  );

  await withNavigator(
    {
      geolocation: {
        getCurrentPosition: (
          _success: (pos: unknown) => void,
          error: () => void,
        ) => error(),
      },
    },
    async () => {
      assert.equal(await requestDeviceLocation(), null);
    },
  );
});

// --- interpretQuery -------------------------------------------------------

test("interpretQuery returns the response as-is on a plain success", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    jsonResponse({
      query: "jazz in Dallas",
      ticketmasterParams: { keyword: "jazz", city: "Dallas" },
    });

  try {
    const result = await interpretQuery("jazz in Dallas", "UTC");
    assert.equal(result.query, "jazz in Dallas");
    assert.deepEqual(result.ticketmasterParams, { keyword: "jazz", city: "Dallas" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("interpretQuery retries with a device location on location_required, then succeeds", async () => {
  const originalFetch = globalThis.fetch;

  let callCount = 0;
  let firstBody: Record<string, unknown> | undefined;
  let secondBody: Record<string, unknown> | undefined;

  globalThis.fetch = async (_url, init) => {
    callCount += 1;
    const body = JSON.parse(String(init?.body ?? "{}"));

    if (callCount === 1) {
      firstBody = body;
      return jsonResponse({ error: "Share your location", code: "location_required" }, 422);
    }

    secondBody = body;
    return jsonResponse({ ticketmasterParams: { geoPoint: "9q9p1dh" } });
  };

  try {
    await withNavigator(
      {
        geolocation: {
          getCurrentPosition: (success: (pos: unknown) => void) =>
            success({ coords: { latitude: 32.78, longitude: -96.8 } }),
        },
      },
      async () => {
        const result = await interpretQuery("something chill", "UTC");
        assert.equal(callCount, 2);
        assert.equal("location" in (firstBody ?? {}), false);
        assert.deepEqual(secondBody?.location, { latitude: 32.78, longitude: -96.8 });
        assert.deepEqual(result.ticketmasterParams, { geoPoint: "9q9p1dh" });
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("interpretQuery retries with geolocationDenied when the device won't share a location", async () => {
  const originalFetch = globalThis.fetch;

  let callCount = 0;
  globalThis.fetch = async (_url, init) => {
    callCount += 1;
    const body = JSON.parse(String(init?.body ?? "{}"));

    if (callCount === 1) {
      return jsonResponse({ error: "Share your location", code: "location_required" }, 422);
    }

    assert.equal(body.geolocationDenied, true);
    return jsonResponse({ ticketmasterParams: {} });
  };

  try {
    await withNavigator({}, async () => {
      const result = await interpretQuery("something chill", "UTC");
      assert.equal(callCount, 2);
      assert.deepEqual(result.ticketmasterParams, {});
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("interpretQuery surfaces the retry's own error when the second call also fails", async () => {
  const originalFetch = globalThis.fetch;

  let callCount = 0;
  globalThis.fetch = async () => {
    callCount += 1;

    if (callCount === 1) {
      return jsonResponse({ error: "Share your location", code: "location_required" }, 422);
    }

    // The retry fails for a different reason - the user should see this
    // message, not the original location_required one.
    return jsonResponse(
      { error: "Include an artist, genre, venue, event, city, state, or ZIP code." },
      422,
    );
  };

  try {
    await withNavigator({}, async () => {
      await assert.rejects(
        interpretQuery("something chill", "UTC"),
        /Include an artist, genre, venue, event, city, state, or ZIP code\./,
      );
      assert.equal(callCount, 2);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("interpretQuery does not retry for errors other than location_required", async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount += 1;
    return jsonResponse({ error: "Concert query service is not configured" }, 500);
  };

  try {
    await assert.rejects(
      interpretQuery("jazz", "UTC"),
      /Concert query service is not configured/,
    );
    assert.equal(callCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("interpretQuery rejects when the response has no ticketmasterParams", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({ query: "jazz" });

  try {
    await assert.rejects(
      interpretQuery("jazz", "UTC"),
      /Concert query returned an invalid response/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});