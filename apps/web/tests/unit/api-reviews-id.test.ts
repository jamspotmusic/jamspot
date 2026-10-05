import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { DELETE, GET, PATCH } from "../../app/api/reviews/[id]/route";
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

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

function patchRequest(body: string) {
  return new NextRequest("http://localhost/api/reviews/r1", {
    method: "PATCH",
    body,
    headers: { "content-type": "application/json" },
  });
}

function deleteRequest() {
  return new NextRequest("http://localhost/api/reviews/r1", { method: "DELETE" });
}

async function withIdentity(userId: string | null, fn: () => Promise<void>) {
  const original = apiAuth.resolveRequestIdentity;
  Object.assign(apiAuth, {
    resolveRequestIdentity: async () =>
      userId === null
        ? null
        : {
            user: { id: userId, email: `${userId}@example.com` },
            supabase: createClient("https://example.supabase.co", "sb_publishable_test"),
          },
  });
  try {
    await fn();
  } finally {
    Object.assign(apiAuth, { resolveRequestIdentity: original });
  }
}

/**
 * Route a stubbed fetch by HTTP method, which is what lets these tests set up
 * the "write matched nothing, but the row exists" state that separates a 403
 * from a 404.
 */
async function withFetch(
  handler: (method: string) => Response,
  fn: () => Promise<void>,
) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) =>
    handler(init?.method ?? "GET");
  try {
    await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "r1",
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

test("GET /api/reviews/[id] returns the matching review", async () => {
  await withFetch(
    () => jsonResponse(row()),
    async () => {
      const response = await GET(new NextRequest("http://localhost/api/reviews/r1"), context("r1"));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).review.id, "r1");
    },
  );
});

test("GET /api/reviews/[id] returns 404 when there is no match", async () => {
  await withFetch(
    () => jsonResponse([]),
    async () => {
      const response = await GET(
        new NextRequest("http://localhost/api/reviews/missing"),
        context("missing"),
      );
      assert.equal(response.status, 404);
      assert.match((await response.json()).error, /Review not found/);
    },
  );
});

test("GET /api/reviews/[id] maps a ReviewsError to 502", async () => {
  await withFetch(
    () => jsonResponse({ message: "timeout" }, 500),
    async () => {
      const response = await GET(new NextRequest("http://localhost/api/reviews/r1"), context("r1"));
      assert.equal(response.status, 502);
    },
  );
});

test("GET /api/reviews/[id] returns 500 for a non-ReviewsError", async () => {
  const original = reviewsLib.getReviewById;
  Object.assign(reviewsLib, {
    getReviewById: async () => {
      throw new Error("boom");
    },
  });
  try {
    const response = await GET(new NextRequest("http://localhost/api/reviews/r1"), context("r1"));
    assert.equal(response.status, 500);
    assert.match((await response.json()).error, /Unexpected error while fetching review/);
  } finally {
    Object.assign(reviewsLib, { getReviewById: original });
  }
});

// ---------------------------------------------------------------------------
// PATCH - authentication and ownership
// ---------------------------------------------------------------------------

test("PATCH rejects an unauthenticated caller", async () => {
  await withIdentity(null, async () => {
    const response = await PATCH(patchRequest(JSON.stringify({ reviewText: "x" })), context("r1"));
    assert.equal(response.status, 401);
    assert.match((await response.json()).error, /must be signed in/);
  });
});

test("PATCH lets the owner edit their own review", async () => {
  await withIdentity(OWNER, async () => {
    await withFetch(
      () => jsonResponse(row({ review_text: "edited" })),
      async () => {
        const response = await PATCH(
          patchRequest(JSON.stringify({ reviewText: "edited" })),
          context("r1"),
        );
        assert.equal(response.status, 200);
        assert.equal((await response.json()).review.review_text, "edited");
      },
    );
  });
});

test("PATCH refuses to edit another user's review with 403", async () => {
  await withIdentity(OTHER, async () => {
    await withFetch(
      // The PATCH matches no row (RLS + the user_id filter); the follow-up
      // read finds it, so this is "not yours" rather than "not there".
      (method) => (method === "PATCH" ? jsonResponse([]) : jsonResponse(row())),
      async () => {
        const response = await PATCH(
          patchRequest(JSON.stringify({ reviewText: "hijack" })),
          context("r1"),
        );
        assert.equal(response.status, 403);
        assert.match((await response.json()).error, /only change your own reviews/);
      },
    );
  });
});

test("PATCH returns 404 when the review does not exist", async () => {
  await withIdentity(OWNER, async () => {
    await withFetch(
      () => jsonResponse([]),
      async () => {
        const response = await PATCH(
          patchRequest(JSON.stringify({ reviewText: "edited" })),
          context("missing"),
        );
        assert.equal(response.status, 404);
      },
    );
  });
});

test("PATCH refuses to change the review's owner", async () => {
  await withIdentity(OWNER, async () => {
    const response = await PATCH(
      patchRequest(JSON.stringify({ reviewText: "edited", user_id: OTHER })),
      context("r1"),
    );
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /cannot be set or changed/);
  });
});

// ---------------------------------------------------------------------------
// PATCH - validation still applies on update
// ---------------------------------------------------------------------------

test("PATCH accepts ratings of 1 and 5", async () => {
  await withIdentity(OWNER, async () => {
    for (const rating of [1, 5]) {
      await withFetch(
        () => jsonResponse(row({ rating })),
        async () => {
          const response = await PATCH(patchRequest(JSON.stringify({ rating })), context("r1"));
          assert.equal(response.status, 200, `rating ${rating} should be accepted`);
        },
      );
    }
  });
});

test("PATCH rejects out-of-range and fractional ratings", async () => {
  await withIdentity(OWNER, async () => {
    for (const rating of [0, 6, 3.5]) {
      const response = await PATCH(patchRequest(JSON.stringify({ rating })), context("r1"));
      assert.equal(response.status, 400, `rating ${rating} should be rejected`);
    }
  });
});

test("PATCH rejects an update to a future concert date", async () => {
  await withIdentity(OWNER, async () => {
    const tomorrow = new Date(`${TODAY}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const response = await PATCH(
      patchRequest(JSON.stringify({ concertDate: tomorrow.toISOString().slice(0, 10) })),
      context("r1"),
    );
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /already happened/);
  });
});

test("PATCH accepts an update to today's date", async () => {
  await withIdentity(OWNER, async () => {
    await withFetch(
      () => jsonResponse(row({ concert_date: TODAY })),
      async () => {
        const response = await PATCH(
          patchRequest(JSON.stringify({ concertDate: TODAY })),
          context("r1"),
        );
        assert.equal(response.status, 200);
      },
    );
  });
});

test("PATCH rejects blanking a required field", async () => {
  await withIdentity(OWNER, async () => {
    const response = await PATCH(patchRequest(JSON.stringify({ venue: "   " })), context("r1"));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /cannot be blank/);
  });
});

test("PATCH rejects an empty patch", async () => {
  await withIdentity(OWNER, async () => {
    const response = await PATCH(patchRequest(JSON.stringify({})), context("r1"));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /No changes/);
  });
});

test("PATCH rejects invalid JSON", async () => {
  await withIdentity(OWNER, async () => {
    const response = await PATCH(patchRequest("{not json"), context("r1"));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /must be valid JSON/);
  });
});

test("PATCH updates aspect ratings", async () => {
  await withIdentity(OWNER, async () => {
    await withFetch(
      () => jsonResponse(row({ rating_sound: 2 })),
      async () => {
        const response = await PATCH(
          patchRequest(JSON.stringify({ aspectRatings: { sound: 2 } })),
          context("r1"),
        );
        assert.equal(response.status, 200);
        assert.equal((await response.json()).review.rating_sound, 2);
      },
    );
  });
});

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

test("DELETE rejects an unauthenticated caller", async () => {
  await withIdentity(null, async () => {
    const response = await DELETE(deleteRequest(), context("r1"));
    assert.equal(response.status, 401);
    assert.match((await response.json()).error, /must be signed in/);
  });
});

test("DELETE lets the owner remove their own review", async () => {
  await withIdentity(OWNER, async () => {
    await withFetch(
      () => jsonResponse({ id: "r1" }),
      async () => {
        const response = await DELETE(deleteRequest(), context("r1"));
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { id: "r1", deleted: true });
      },
    );
  });
});

test("DELETE refuses to remove another user's review with 403", async () => {
  await withIdentity(OTHER, async () => {
    await withFetch(
      (method) => (method === "DELETE" ? jsonResponse([]) : jsonResponse(row())),
      async () => {
        const response = await DELETE(deleteRequest(), context("r1"));
        assert.equal(response.status, 403);
        assert.match((await response.json()).error, /only change your own reviews/);
      },
    );
  });
});

test("DELETE returns 404 when the review does not exist", async () => {
  await withIdentity(OWNER, async () => {
    await withFetch(
      () => jsonResponse([]),
      async () => {
        const response = await DELETE(deleteRequest(), context("missing"));
        assert.equal(response.status, 404);
      },
    );
  });
});

test("DELETE maps a ReviewsError to 502", async () => {
  await withIdentity(OWNER, async () => {
    await withFetch(
      () => jsonResponse({ message: "db down" }, 500),
      async () => {
        const response = await DELETE(deleteRequest(), context("r1"));
        assert.equal(response.status, 502);
      },
    );
  });
});

test("DELETE returns 500 for a non-ReviewsError", async () => {
  const original = reviewsLib.deleteReview;
  Object.assign(reviewsLib, {
    deleteReview: async () => {
      throw new Error("boom");
    },
  });
  try {
    await withIdentity(OWNER, async () => {
      const response = await DELETE(deleteRequest(), context("r1"));
      assert.equal(response.status, 500);
      assert.match((await response.json()).error, /Unexpected error while deleting review/);
    });
  } finally {
    Object.assign(reviewsLib, { deleteReview: original });
  }
});
