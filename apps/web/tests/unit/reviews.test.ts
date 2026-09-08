import assert from "node:assert/strict";
import test from "node:test";

import { supabase } from "../../lib/supabase";
import { getReviews, getReviewById, createReview, ReviewsError, type NewReview } from "../../lib/reviews";

function jsonResponse(body: unknown, status = 200): Response {
  // supabase-js reads both .json() and, on some code paths, .text() - use a
  // real Response so both are implemented correctly.
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
    description: "Amazing performance, the visuals were incredible.",
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

test("getReviews returns rows ordered most-recent-first", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = async (url: RequestInfo | URL) => {
    requestedUrl = String(url);
    return jsonResponse([reviewRow()]);
  };
  try {
    const reviews = await getReviews();
    assert.equal(reviews.length, 1);
    assert.equal(reviews[0].short_description, "Massive Attack at Golden 1 Center");
    assert.equal(reviews[0].star_rating, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.match(requestedUrl, /order=created_at\.desc/);
});

test("getReviews returns an empty array when there is no data", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse(null);
  try {
    assert.deepEqual(await getReviews(), []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getReviews throws a ReviewsError on failure", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({ message: "relation does not exist" }, 500);
  try {
    await assert.rejects(getReviews(), (err) => {
      assert.ok(err instanceof ReviewsError);
      assert.match(err.message, /Failed to fetch reviews: relation does not exist/);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getReviews carries the embedded author through", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    jsonResponse([reviewRow({ profiles: { id: "author-1", username: "sarah" } })]);
  try {
    const reviews = await getReviews();
    assert.equal(reviews[0].profiles?.username, "sarah");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getReviewById returns the matching review", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse(reviewRow());
  try {
    const review = await getReviewById("1");
    assert.equal(review?.id, "1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getReviewById returns null when there is no match", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse([]);
  try {
    assert.equal(await getReviewById("missing"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getReviewById throws a ReviewsError on failure", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({ message: "timeout" }, 500);
  try {
    await assert.rejects(getReviewById("1"), (err) => {
      assert.ok(err instanceof ReviewsError);
      assert.match(err.message, /Failed to fetch review 1: timeout/);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const newReview: NewReview = {
  shortDescription: "Massive Attack at Golden 1 Center",
  description: "Amazing performance, the visuals were incredible.",
  starRating: 4,
  location: "Golden 1 Center, Sacramento, CA",
  reviewDate: "2026-07-30",
};

test("createReview inserts snake_cased columns plus the author id", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: unknown = null;
  globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
    requestBody = init?.body ? JSON.parse(String(init.body)) : null;
    return jsonResponse(reviewRow({ id: "new-1" }), 201);
  };
  try {
    const review = await createReview(supabase, "author-1", newReview);
    assert.equal(review.id, "new-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(requestBody, {
    short_description: "Massive Attack at Golden 1 Center",
    description: "Amazing performance, the visuals were incredible.",
    star_rating: 4,
    location: "Golden 1 Center, Sacramento, CA",
    review_date: "2026-07-30",
    author_id: "author-1",
  });
});

test("createReview takes author_id from its argument, never from the input", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
    requestBody = init?.body ? JSON.parse(String(init.body)) : null;
    return jsonResponse(reviewRow({ id: "new-2" }), 201);
  };
  try {
    // A caller trying to smuggle an author_id through the input object must
    // not be able to override the id the route derived from the session.
    await createReview(supabase, "real-author", {
      ...newReview,
      author_id: "spoofed",
    } as NewReview);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(requestBody!.author_id, "real-author");
});

test("createReview throws a ReviewsError on failure", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({ message: "constraint violation" }, 400);
  try {
    await assert.rejects(createReview(supabase, "author-1", newReview), (err) => {
      assert.ok(err instanceof ReviewsError);
      assert.match(err.message, /Failed to create review: constraint violation/);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
