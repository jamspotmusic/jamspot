import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { GET, POST } from "../../app/api/reviews/route";
import * as apiAuth from "../../lib/api-auth";
import * as reviewsLib from "../../lib/reviews";
import { todayIsoDate } from "@jamspot/shared";

const OWNER = "0d6638c2-1340-4b79-8722-e378bade9f82";
const OTHER = "11111111-1111-1111-1111-111111111111";
const TODAY = todayIsoDate();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function postRequest(body: string, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/reviews", {
    method: "POST",
    body,
    headers: { "content-type": "application/json", ...headers },
  });
}

/**
 * Run `fn` with the route's identity resolution replaced.
 *
 * `null` stands in for an anonymous caller. Patching the module's exports is
 * how the rest of this suite substitutes collaborators (see the reviewsLib
 * patches below), and it works because tsc's CommonJS output calls through the
 * module object rather than capturing the binding.
 */
async function withIdentity(userId: string | null, fn: () => Promise<void>) {
  const originalResolve = apiAuth.resolveRequestIdentity;
  const originalName = apiAuth.resolveDisplayName;

  Object.assign(apiAuth, {
    resolveRequestIdentity: async () =>
      userId === null
        ? null
        : {
            user: { id: userId, email: `${userId}@example.com` },
            supabase: createClient("https://example.supabase.co", "sb_publishable_test"),
          },
    resolveDisplayName: async () => "jamfan",
  });

  try {
    await fn();
  } finally {
    Object.assign(apiAuth, {
      resolveRequestIdentity: originalResolve,
      resolveDisplayName: originalName,
    });
  }
}

async function withFetch(handler: () => Response, fn: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => handler();
  try {
    await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function validBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    musician: "Nova Bloom",
    venue: "The Granada",
    concertDate: "2026-05-01",
    rating: 4,
    reviewText: "Great show",
    ...overrides,
  });
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "new-1",
    user_id: OWNER,
    user_name: "jamfan",
    musician: "Nova Bloom",
    venue: "The Granada",
    concert_date: "2026-05-01",
    rating: 4,
    rating_performance: null,
    rating_sound: null,
    rating_venue: null,
    rating_crowd: null,
    rating_value: null,
    review_text: "Great show",
    created_at: "2026-05-02T00:00:00Z",
    updated_at: "2026-05-02T00:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// GET - open to everyone
// ---------------------------------------------------------------------------

test("GET /api/reviews returns the review list", async () => {
  await withFetch(
    () => jsonResponse([row()]),
    async () => {
      const response = await GET();
      assert.equal(response.status, 200);
      assert.equal((await response.json()).reviews.length, 1);
    },
  );
});

test("GET /api/reviews maps a ReviewsError to 502", async () => {
  await withFetch(
    () => jsonResponse({ message: "db down" }, 500),
    async () => {
      const response = await GET();
      assert.equal(response.status, 502);
      assert.match((await response.json()).error, /db down/);
    },
  );
});

test("GET /api/reviews returns 500 for a non-ReviewsError", async () => {
  const original = reviewsLib.getReviews;
  Object.assign(reviewsLib, {
    getReviews: async () => {
      throw new Error("boom");
    },
  });
  try {
    const response = await GET();
    assert.equal(response.status, 500);
    assert.match((await response.json()).error, /Unexpected error while fetching reviews/);
  } finally {
    Object.assign(reviewsLib, { getReviews: original });
  }
});

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

test("POST /api/reviews rejects an unauthenticated caller", async () => {
  await withIdentity(null, async () => {
    const response = await POST(postRequest(validBody()));
    assert.equal(response.status, 401);
    assert.match((await response.json()).error, /must be signed in/);
  });
});

test("POST /api/reviews checks authentication before reading the body", async () => {
  // An anonymous caller should get 401 rather than "your JSON is malformed",
  // which would otherwise leak that the body was even looked at.
  await withIdentity(null, async () => {
    const response = await POST(postRequest("{not valid json"));
    assert.equal(response.status, 401);
  });
});

test("POST /api/reviews accepts a signed-in caller and returns 201", async () => {
  await withIdentity(OWNER, async () => {
    await withFetch(
      () => jsonResponse(row(), 201),
      async () => {
        const response = await POST(postRequest(validBody()));
        assert.equal(response.status, 201);
        assert.equal((await response.json()).review.id, "new-1");
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

test("POST /api/reviews attributes the review to the session, ignoring the body", async () => {
  let written: Record<string, unknown> = {};

  await withIdentity(OWNER, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
      written = init?.body ? JSON.parse(String(init.body)) : {};
      return jsonResponse(row(), 201);
    };
    try {
      const response = await POST(postRequest(validBody()));
      assert.equal(response.status, 201);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  assert.equal(written.user_id, OWNER, "the owner must come from the session");
  assert.equal(written.user_name, "jamfan");
});

test("POST /api/reviews refuses a review attributed to another user", async () => {
  await withIdentity(OWNER, async () => {
    const response = await POST(postRequest(validBody({ user_id: OTHER })));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /taken from your session/);
  });
});

test("POST /api/reviews refuses a client-supplied display name", async () => {
  await withIdentity(OWNER, async () => {
    const response = await POST(postRequest(validBody({ userName: "someone else" })));
    assert.equal(response.status, 400);
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test("POST /api/reviews rejects invalid JSON from a signed-in caller", async () => {
  await withIdentity(OWNER, async () => {
    const response = await POST(postRequest("{not valid json"));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /must be valid JSON/);
  });
});

test("POST /api/reviews rejects a body missing required fields", async () => {
  await withIdentity(OWNER, async () => {
    const response = await POST(postRequest(JSON.stringify({ musician: "Nova Bloom" })));
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.error, /required/);
    const fields = body.fields.map((f: { field: string }) => f.field);
    assert.ok(fields.includes("venue"));
    assert.ok(fields.includes("reviewText"));
    assert.ok(fields.includes("rating"));
    assert.ok(fields.includes("concertDate"));
  });
});

test("POST /api/reviews rejects a future concert date", async () => {
  await withIdentity(OWNER, async () => {
    const tomorrow = new Date(`${TODAY}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const response = await POST(
      postRequest(validBody({ concertDate: tomorrow.toISOString().slice(0, 10) })),
    );
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /already happened/);
  });
});

test("POST /api/reviews accepts a concert dated today", async () => {
  await withIdentity(OWNER, async () => {
    await withFetch(
      () => jsonResponse(row({ concert_date: TODAY }), 201),
      async () => {
        const response = await POST(postRequest(validBody({ concertDate: TODAY })));
        assert.equal(response.status, 201);
      },
    );
  });
});

test("POST /api/reviews rejects out-of-range and fractional ratings", async () => {
  await withIdentity(OWNER, async () => {
    for (const rating of [0, 6, 3.5]) {
      const response = await POST(postRequest(validBody({ rating })));
      assert.equal(response.status, 400, `rating ${rating} should be rejected`);
      assert.match((await response.json()).error, /whole number from 1 to 5/);
    }
  });
});

test("POST /api/reviews accepts optional aspect ratings", async () => {
  let written: Record<string, unknown> = {};

  await withIdentity(OWNER, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
      written = init?.body ? JSON.parse(String(init.body)) : {};
      return jsonResponse(row({ rating_sound: 5 }), 201);
    };
    try {
      const response = await POST(
        postRequest(validBody({ aspectRatings: { sound: 5, venue: 3 } })),
      );
      assert.equal(response.status, 201);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  assert.equal(written.rating_sound, 5);
  assert.equal(written.rating_venue, 3);
});

test("POST /api/reviews rejects an out-of-range aspect rating", async () => {
  await withIdentity(OWNER, async () => {
    const response = await POST(postRequest(validBody({ aspectRatings: { crowd: 9 } })));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Crowd must be a whole number/);
  });
});

// ---------------------------------------------------------------------------
// Failure mapping
// ---------------------------------------------------------------------------

test("POST /api/reviews maps a ReviewsError to 502", async () => {
  await withIdentity(OWNER, async () => {
    await withFetch(
      () => jsonResponse({ message: "constraint violation" }, 400),
      async () => {
        const response = await POST(postRequest(validBody()));
        assert.equal(response.status, 502);
      },
    );
  });
});

test("POST /api/reviews returns 500 for a non-ReviewsError", async () => {
  const original = reviewsLib.createReview;
  Object.assign(reviewsLib, {
    createReview: async () => {
      throw new Error("boom");
    },
  });
  try {
    await withIdentity(OWNER, async () => {
      const response = await POST(postRequest(validBody()));
      assert.equal(response.status, 500);
      assert.match((await response.json()).error, /Unexpected error while creating review/);
    });
  } finally {
    Object.assign(reviewsLib, { createReview: original });
  }
});
