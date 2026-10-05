import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { GET } from "../../app/api/reviews/[id]/route";
import * as reviewsLib from "../../lib/reviews";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
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

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

test("GET /api/reviews/[id] returns the matching review", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    jsonResponse(reviewRow());
  try {
    const response = await GET(new NextRequest("http://localhost/api/reviews/1"), context("1"));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).review.id, "1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GET /api/reviews/[id] returns 404 when there is no match", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse([]);
  try {
    const response = await GET(new NextRequest("http://localhost/api/reviews/missing"), context("missing"));
    assert.equal(response.status, 404);
    assert.match((await response.json()).error, /Review not found/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GET /api/reviews/[id] maps a ReviewsError to 502", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({ message: "timeout" }, 500);
  try {
    const response = await GET(new NextRequest("http://localhost/api/reviews/1"), context("1"));
    assert.equal(response.status, 502);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GET /api/reviews/[id] returns 500 for a non-ReviewsError", async () => {
  const original = reviewsLib.getReviewById;
  Object.assign(reviewsLib, {
    getReviewById: async () => {
      throw new Error("boom");
    },
  });
  try {
    const response = await GET(new NextRequest("http://localhost/api/reviews/1"), context("1"));
    assert.equal(response.status, 500);
    assert.match((await response.json()).error, /Unexpected error while fetching review/);
  } finally {
    Object.assign(reviewsLib, { getReviewById: original });
  }
});
