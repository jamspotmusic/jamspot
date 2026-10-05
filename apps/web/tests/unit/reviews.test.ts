import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

import {
  createReview,
  deleteReview,
  getReviewById,
  getReviews,
  ReviewNotFoundError,
  ReviewOwnershipError,
  ReviewsError,
  updateReview,
} from "../../lib/reviews";

/**
 * These drive a real supabase-js client with `fetch` stubbed, rather than a
 * hand-written fake of the query builder. That is deliberate: the thing most
 * worth checking here is that the ownership filter actually reaches the wire
 * as `user_id=eq.<caller>`, and only the real client builds that URL.
 */

const OWNER = "0d6638c2-1340-4b79-8722-e378bade9f82";
const OTHER = "11111111-1111-1111-1111-111111111111";

function jsonResponse(body: unknown, status = 200): Response {
  // supabase-js reads both .json() and, on some code paths, .text() - use a
  // real Response so both are implemented correctly.
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Capture = { url: string; method: string; body: unknown };

/**
 * Install a fetch stub, run `run`, and always restore. Returns everything the
 * stub saw so assertions can be made after the fact.
 */
async function withFetch(
  handler: (capture: Capture) => Response,
  run: () => Promise<void>,
): Promise<Capture[]> {
  const originalFetch = globalThis.fetch;
  const captures: Capture[] = [];

  globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
    const capture: Capture = {
      url: String(url),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : null,
    };
    captures.push(capture);
    return handler(capture);
  };

  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }

  return captures;
}

function authedClient() {
  return createClient("https://example.supabase.co", "sb_publishable_test");
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
// Reads
// ---------------------------------------------------------------------------

test("getReviews returns rows ordered most-recent-first", async () => {
  let reviews: Awaited<ReturnType<typeof getReviews>> = [];
  const captures = await withFetch(
    () => jsonResponse([row({ musician: "Nova Bloom" })]),
    async () => {
      reviews = await getReviews();
    },
  );

  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].musician, "Nova Bloom");
  assert.match(captures[0].url, /order=created_at\.desc/);
});

test("getReviews selects every column the clients render", async () => {
  const captures = await withFetch(
    () => jsonResponse([]),
    async () => {
      await getReviews();
    },
  );

  const url = decodeURIComponent(captures[0].url);
  for (const column of [
    "user_id",
    "user_name",
    "musician",
    "venue",
    "concert_date",
    "rating",
    "rating_performance",
    "rating_sound",
    "rating_venue",
    "rating_crowd",
    "rating_value",
    "review_text",
    "updated_at",
  ]) {
    assert.ok(url.includes(column), `select should request ${column}`);
  }
});

test("getReviews returns an empty array when there is no data", async () => {
  let reviews: unknown = null;
  await withFetch(
    () => jsonResponse(null),
    async () => {
      reviews = await getReviews();
    },
  );
  assert.deepEqual(reviews, []);
});

test("getReviews throws a ReviewsError on failure", async () => {
  await withFetch(
    () => jsonResponse({ message: "relation does not exist" }, 500),
    async () => {
      await assert.rejects(getReviews(), (err) => {
        assert.ok(err instanceof ReviewsError);
        assert.match((err as Error).message, /Failed to fetch reviews: relation does not exist/);
        return true;
      });
    },
  );
});

test("getReviewById returns the matching review", async () => {
  let review: Awaited<ReturnType<typeof getReviewById>> = null;
  await withFetch(
    () => jsonResponse(row()),
    async () => {
      review = await getReviewById("r1");
    },
  );
  assert.equal(review!.id, "r1");
});

test("getReviewById returns null when there is no match", async () => {
  let review: unknown = "unset";
  await withFetch(
    () => jsonResponse([]),
    async () => {
      review = await getReviewById("missing");
    },
  );
  assert.equal(review, null);
});

test("getReviewById throws a ReviewsError on failure", async () => {
  await withFetch(
    () => jsonResponse({ message: "timeout" }, 500),
    async () => {
      await assert.rejects(getReviewById("r1"), (err) => err instanceof ReviewsError);
    },
  );
});

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

test("createReview stamps the owner from its parameter, not from the input", async () => {
  const captures = await withFetch(
    () => jsonResponse(row(), 201),
    async () => {
      await createReview(
        authedClient(),
        {
          musician: "Nova Bloom",
          venue: "The Granada",
          concertDate: "2026-05-01",
          rating: 4,
          reviewText: "Great show",
          aspectRatings: {},
        },
        { id: OWNER, userName: "jamfan" },
      );
    },
  );

  const body = captures[0].body as Record<string, unknown>;
  assert.equal(captures[0].method, "POST");
  assert.equal(body.user_id, OWNER);
  assert.equal(body.user_name, "jamfan");
  assert.equal(body.concert_date, "2026-05-01");
  assert.equal(body.review_text, "Great show");
  assert.equal(body.rating, 4);
});

test("createReview writes only the aspect ratings that were supplied", async () => {
  const captures = await withFetch(
    () => jsonResponse(row(), 201),
    async () => {
      await createReview(
        authedClient(),
        {
          musician: "Nova Bloom",
          venue: "The Granada",
          concertDate: "2026-05-01",
          rating: 4,
          reviewText: "Great show",
          aspectRatings: { sound: 5, crowd: 2 },
        },
        { id: OWNER, userName: "jamfan" },
      );
    },
  );

  const body = captures[0].body as Record<string, unknown>;
  assert.equal(body.rating_sound, 5);
  assert.equal(body.rating_crowd, 2);
  assert.ok(!("rating_venue" in body), "an unrated aspect should not be written at all");
});

test("createReview throws a ReviewsError on failure", async () => {
  await withFetch(
    () => jsonResponse({ message: "new row violates row-level security policy" }, 401),
    async () => {
      await assert.rejects(
        createReview(
          authedClient(),
          {
            musician: "X",
            venue: "Y",
            concertDate: "2026-01-01",
            rating: 3,
            reviewText: "Z",
            aspectRatings: {},
          },
          { id: OWNER, userName: "jamfan" },
        ),
        (err) => {
          assert.ok(err instanceof ReviewsError);
          assert.match((err as Error).message, /row-level security/);
          return true;
        },
      );
    },
  );
});

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

test("updateReview scopes the write to the caller's own row", async () => {
  const captures = await withFetch(
    () => jsonResponse(row({ review_text: "edited" })),
    async () => {
      await updateReview(authedClient(), "r1", { reviewText: "edited" }, OWNER);
    },
  );

  const url = decodeURIComponent(captures[0].url);
  assert.equal(captures[0].method, "PATCH");
  assert.ok(url.includes("id=eq.r1"), "should target the review by id");
  assert.ok(
    url.includes(`user_id=eq.${OWNER}`),
    "should refuse to touch a row owned by anyone else",
  );
});

test("updateReview never writes the owner column", async () => {
  const captures = await withFetch(
    () => jsonResponse(row()),
    async () => {
      await updateReview(
        authedClient(),
        "r1",
        { reviewText: "edited", rating: 5, venue: "Ace of Spades" },
        OWNER,
      );
    },
  );

  const body = captures[0].body as Record<string, unknown>;
  assert.ok(!("user_id" in body), "an edit must not be able to reassign ownership");
  assert.ok(!("user_name" in body));
  assert.deepEqual(body, { review_text: "edited", rating: 5, venue: "Ace of Spades" });
});

test("updateReview sends only the fields being changed", async () => {
  const captures = await withFetch(
    () => jsonResponse(row()),
    async () => {
      await updateReview(authedClient(), "r1", { rating: 2 }, OWNER);
    },
  );
  assert.deepEqual(captures[0].body, { rating: 2 });
});

test("updateReview clears an aspect rating when it is explicitly null", async () => {
  const captures = await withFetch(
    () => jsonResponse(row()),
    async () => {
      await updateReview(
        authedClient(),
        "r1",
        { aspectRatings: { sound: null, crowd: 4 } },
        OWNER,
      );
    },
  );
  assert.deepEqual(captures[0].body, { rating_sound: null, rating_crowd: 4 });
});

test("updateReview raises an ownership error when the review belongs to someone else", async () => {
  // The PATCH matches nothing because of the user_id filter, then the
  // follow-up read finds the row - which is what distinguishes the two cases.
  await withFetch(
    (capture) => (capture.method === "PATCH" ? jsonResponse([]) : jsonResponse(row({ user_id: OTHER }))),
    async () => {
      await assert.rejects(
        updateReview(authedClient(), "r1", { reviewText: "hijack" }, OTHER),
        (err) => {
          assert.ok(err instanceof ReviewOwnershipError);
          assert.match((err as Error).message, /only change your own reviews/);
          return true;
        },
      );
    },
  );
});

test("updateReview raises a not-found error when no such review exists", async () => {
  await withFetch(
    () => jsonResponse([]),
    async () => {
      await assert.rejects(
        updateReview(authedClient(), "missing", { reviewText: "edited" }, OWNER),
        (err) => err instanceof ReviewNotFoundError,
      );
    },
  );
});

test("updateReview throws a ReviewsError when the database rejects the write", async () => {
  await withFetch(
    () => jsonResponse({ message: "concert_date is in the future" }, 400),
    async () => {
      await assert.rejects(
        updateReview(authedClient(), "r1", { concertDate: "2099-01-01" }, OWNER),
        (err) => {
          assert.ok(err instanceof ReviewsError);
          assert.match((err as Error).message, /in the future/);
          return true;
        },
      );
    },
  );
});

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

test("deleteReview scopes the delete to the caller's own row", async () => {
  const captures = await withFetch(
    () => jsonResponse({ id: "r1" }),
    async () => {
      await deleteReview(authedClient(), "r1", OWNER);
    },
  );

  const url = decodeURIComponent(captures[0].url);
  assert.equal(captures[0].method, "DELETE");
  assert.ok(url.includes("id=eq.r1"));
  assert.ok(url.includes(`user_id=eq.${OWNER}`));
});

test("deleteReview raises an ownership error for someone else's review", async () => {
  await withFetch(
    (capture) =>
      capture.method === "DELETE" ? jsonResponse([]) : jsonResponse(row({ user_id: OWNER })),
    async () => {
      await assert.rejects(
        deleteReview(authedClient(), "r1", OTHER),
        (err) => err instanceof ReviewOwnershipError,
      );
    },
  );
});

test("deleteReview raises a not-found error when no such review exists", async () => {
  await withFetch(
    () => jsonResponse([]),
    async () => {
      await assert.rejects(
        deleteReview(authedClient(), "missing", OWNER),
        (err) => err instanceof ReviewNotFoundError,
      );
    },
  );
});

test("deleteReview throws a ReviewsError on failure", async () => {
  await withFetch(
    () => jsonResponse({ message: "db down" }, 500),
    async () => {
      await assert.rejects(
        deleteReview(authedClient(), "r1", OWNER),
        (err) => err instanceof ReviewsError,
      );
    },
  );
});
