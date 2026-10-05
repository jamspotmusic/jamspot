import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { GET, POST } from "../../app/api/reviews/route";
import * as reviewsLib from "../../lib/reviews";
import * as supabaseServer from "../../lib/supabase-server";
import { supabase } from "../../lib/supabase";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function postRequest(body: string) {
  return new NextRequest("http://localhost/api/reviews", {
    method: "POST",
    body,
    headers: { "content-type": "application/json" },
  });
}

/** A row in the shape the live `reviews` table actually returns. */
function reviewRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "1",
    short_description: "Massive Attack at Golden 1 Center",
    description: "Amazing performance.",
    star_rating: 4,
    location: "Golden 1 Center, Sacramento, CA",
    review_date: "2026-07-30",
    created_at: "2026-07-31T00:00:00Z",
    updated_at: "2026-07-31T00:00:00Z",
    author_id: "author-1",
    profiles: null,
    ...overrides,
  };
}

const validBody = {
  shortDescription: "Massive Attack at Golden 1 Center",
  description: "Amazing performance.",
  starRating: 4,
  location: "Golden 1 Center, Sacramento, CA",
  reviewDate: "2026-07-30",
};

/**
 * The route reads the caller through lib/supabase-server, which needs real
 * request cookies. Swap both of its exports for the duration of a test: the
 * anonymous client is enough here because the outbound fetch is stubbed too.
 */
async function withUser(
  user: { id: string } | null,
  run: () => Promise<void>,
) {
  const original = {
    getServerUser: supabaseServer.getServerUser,
    createClient: supabaseServer.createClient,
  };
  Object.assign(supabaseServer, {
    getServerUser: async () => user,
    createClient: async () => supabase,
  });
  try {
    await run();
  } finally {
    Object.assign(supabaseServer, original);
  }
}

test("GET /api/reviews returns the review list", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse([reviewRow()]);
  try {
    const response = await GET();
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.reviews.length, 1);
    assert.equal(body.reviews[0].star_rating, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GET /api/reviews maps a ReviewsError to 502", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({ message: "db down" }, 500);
  try {
    const response = await GET();
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /db down/);
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test("POST /api/reviews rejects invalid JSON", async () => {
  const response = await POST(postRequest("{not valid json"));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /must be valid JSON/);
});

test("POST /api/reviews rejects a body missing required fields", async () => {
  const response = await POST(postRequest(JSON.stringify({ description: "just this" })));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /are required non-empty strings/);
});

test("POST /api/reviews rejects whitespace-only text", async () => {
  const response = await POST(
    postRequest(JSON.stringify({ ...validBody, shortDescription: "   " })),
  );
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /are required non-empty strings/);
});

test("POST /api/reviews rejects a malformed reviewDate", async () => {
  const response = await POST(
    postRequest(JSON.stringify({ ...validBody, reviewDate: "July 30, 2026" })),
  );
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /must be an ISO date/);
});

test("POST /api/reviews rejects an out-of-range starRating", async () => {
  for (const starRating of [0, 6, 3.5, "4"]) {
    const response = await POST(postRequest(JSON.stringify({ ...validBody, starRating })));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /integer from 1 to 5/);
  }
});

test("POST /api/reviews returns 401 when nobody is signed in", async () => {
  await withUser(null, async () => {
    const response = await POST(postRequest(JSON.stringify(validBody)));
    assert.equal(response.status, 401);
    assert.match((await response.json()).error, /must be signed in/);
  });
});

test("POST /api/reviews creates a review for the signed-in user", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
    requestBody = init?.body ? JSON.parse(String(init.body)) : null;
    return jsonResponse(reviewRow({ id: "new-1" }), 201);
  };
  try {
    await withUser({ id: "author-1" }, async () => {
      const response = await POST(postRequest(JSON.stringify(validBody)));
      assert.equal(response.status, 201);
      assert.equal((await response.json()).review.id, "new-1");
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(requestBody!.author_id, "author-1");
  assert.equal(requestBody!.star_rating, 4);
});

test("POST /api/reviews ignores an author_id supplied by the client", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
    requestBody = init?.body ? JSON.parse(String(init.body)) : null;
    return jsonResponse(reviewRow({ id: "new-2" }), 201);
  };
  try {
    await withUser({ id: "real-author" }, async () => {
      const response = await POST(
        postRequest(JSON.stringify({ ...validBody, author_id: "spoofed", authorId: "spoofed" })),
      );
      assert.equal(response.status, 201);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(requestBody!.author_id, "real-author");
});

test("POST /api/reviews maps a ReviewsError to 502", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({ message: "constraint violation" }, 400);
  try {
    await withUser({ id: "author-1" }, async () => {
      const response = await POST(postRequest(JSON.stringify(validBody)));
      assert.equal(response.status, 502);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("POST /api/reviews returns 500 for a non-ReviewsError", async () => {
  const original = reviewsLib.createReview;
  Object.assign(reviewsLib, {
    createReview: async () => {
      throw new Error("boom");
    },
  });
  try {
    await withUser({ id: "author-1" }, async () => {
      const response = await POST(postRequest(JSON.stringify(validBody)));
      assert.equal(response.status, 500);
      assert.match((await response.json()).error, /Unexpected error while creating review/);
    });
  } finally {
    Object.assign(reviewsLib, { createReview: original });
  }
});
