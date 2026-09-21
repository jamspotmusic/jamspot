import assert from "node:assert/strict";
import test from "node:test";

import {
  RATING_MAX,
  RATING_MIN,
  REVIEW_ASPECTS,
  isFutureConcertDate,
  isReviewOwner,
  isValidIsoDate,
  isValidRating,
  ratedAspects,
  todayIsoDate,
  validateNewReview,
  validateReviewUpdate,
  type Review,
} from "@jamspot/shared";

/**
 * The shared validation rules, which both apps and both API routes run.
 *
 * "Today" is pinned everywhere rather than taken from the clock, so these
 * cannot start failing at midnight UTC - the one class of flake this file
 * would otherwise be prone to.
 */
const TODAY = "2026-09-21";
const YESTERDAY = "2026-09-20";
const TOMORROW = "2026-09-22";

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    musician: "Nova Bloom",
    venue: "The Granada",
    concertDate: YESTERDAY,
    rating: 4,
    reviewText: "Great show",
    ...overrides,
  };
}

/** The first message produced for `field`, or undefined. */
function errorFor(result: ReturnType<typeof validateNewReview>, field: string) {
  return result.ok ? undefined : result.errors.find((e) => e.field === field)?.message;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

test("todayIsoDate reports the UTC calendar day", () => {
  // 00:30 UTC on the 21st is still the 20th in every zone behind UTC; the
  // shared rule is deliberately UTC so the DB trigger agrees with it.
  assert.equal(todayIsoDate(new Date("2026-09-21T00:30:00Z")), "2026-09-21");
  assert.equal(todayIsoDate(new Date("2026-09-21T23:59:59Z")), "2026-09-21");
});

test("isValidIsoDate rejects malformed and impossible dates", () => {
  assert.ok(isValidIsoDate("2026-09-21"));
  assert.ok(isValidIsoDate("2024-02-29"), "2024 is a leap year");
  assert.equal(isValidIsoDate("2026-02-31"), false, "February has no 31st");
  assert.equal(isValidIsoDate("2025-02-29"), false, "2025 is not a leap year");
  assert.equal(isValidIsoDate("21-09-2026"), false);
  assert.equal(isValidIsoDate("2026-9-1"), false);
  assert.equal(isValidIsoDate(""), false);
});

test("isFutureConcertDate treats today as not future", () => {
  assert.equal(isFutureConcertDate(YESTERDAY, TODAY), false);
  assert.equal(isFutureConcertDate(TODAY, TODAY), false);
  assert.equal(isFutureConcertDate(TOMORROW, TODAY), true);
});

// ---------------------------------------------------------------------------
// Rating helpers
// ---------------------------------------------------------------------------

test("isValidRating accepts only whole numbers 1-5", () => {
  for (let rating = RATING_MIN; rating <= RATING_MAX; rating++) {
    assert.ok(isValidRating(rating), `${rating} should be valid`);
  }
  for (const bad of [0, 6, -1, 3.5, Number.NaN, Infinity, "4", null, undefined]) {
    assert.equal(isValidRating(bad), false, `${String(bad)} should be invalid`);
  }
});

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

test("validateNewReview accepts a valid review and trims its text", () => {
  const result = validateNewReview(
    validBody({ musician: "  Nova Bloom  ", reviewText: "  Great show  " }),
    TODAY,
  );
  assert.ok(result.ok);
  assert.equal(result.value.musician, "Nova Bloom");
  assert.equal(result.value.reviewText, "Great show");
  assert.deepEqual(result.value.aspectRatings, {});
});

test("validateNewReview accepts a concert dated today", () => {
  assert.ok(validateNewReview(validBody({ concertDate: TODAY }), TODAY).ok);
});

test("validateNewReview rejects a concert dated tomorrow", () => {
  const result = validateNewReview(validBody({ concertDate: TOMORROW }), TODAY);
  assert.equal(result.ok, false);
  assert.match(errorFor(result, "concertDate")!, /already happened/);
});

test("validateNewReview rejects ratings outside 1-5 and fractional ratings", () => {
  for (const rating of [0, 6, 3.5, -2]) {
    const result = validateNewReview(validBody({ rating }), TODAY);
    assert.equal(result.ok, false, `rating ${rating} should be rejected`);
    assert.match(errorFor(result, "rating")!, /whole number from 1 to 5/);
  }
});

test("validateNewReview accepts the boundary ratings", () => {
  assert.ok(validateNewReview(validBody({ rating: 1 }), TODAY).ok);
  assert.ok(validateNewReview(validBody({ rating: 5 }), TODAY).ok);
});

test("validateNewReview requires a rating", () => {
  for (const rating of [undefined, null, ""]) {
    const result = validateNewReview(validBody({ rating }), TODAY);
    assert.equal(result.ok, false);
    assert.match(errorFor(result, "rating")!, /required/);
  }
});

test("validateNewReview rejects blank and missing required fields", () => {
  for (const field of ["musician", "venue", "reviewText"]) {
    for (const value of [undefined, "", "   ", null, 42]) {
      const result = validateNewReview(validBody({ [field]: value }), TODAY);
      assert.equal(result.ok, false, `${field}=${String(value)} should be rejected`);
      assert.match(errorFor(result, field)!, /required/);
    }
  }
});

test("validateNewReview reports every problem at once", () => {
  const result = validateNewReview(
    { musician: "", venue: "", concertDate: TOMORROW, rating: 9, reviewText: "" },
    TODAY,
  );
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.errors.length >= 5, "each bad field should be reported");
});

test("validateNewReview rejects a body that is not an object", () => {
  for (const body of ["a string", 42, null, ["array"]]) {
    assert.equal(validateNewReview(body, TODAY).ok, false);
  }
});

// ---------------------------------------------------------------------------
// Owner fields are never accepted from a client
// ---------------------------------------------------------------------------

test("validateNewReview refuses a client-supplied owner", () => {
  for (const field of ["user_id", "userId", "user_name", "userName", "author_id", "authorId"]) {
    const result = validateNewReview(
      validBody({ [field]: "11111111-1111-1111-1111-111111111111" }),
      TODAY,
    );
    assert.equal(result.ok, false, `${field} should be refused`);
    assert.match(errorFor(result, field)!, /taken from your session/);
  }
});

test("validateReviewUpdate refuses an attempt to reassign the owner", () => {
  const result = validateReviewUpdate(
    { reviewText: "edited", user_id: "11111111-1111-1111-1111-111111111111" },
    TODAY,
  );
  assert.equal(result.ok, false);
  assert.match(errorFor(result, "user_id")!, /cannot be set or changed/);
});

// ---------------------------------------------------------------------------
// Aspect ratings
// ---------------------------------------------------------------------------

test("validateNewReview accepts every aspect rating in range", () => {
  const aspectRatings = Object.fromEntries(REVIEW_ASPECTS.map((a, i) => [a.key, (i % 5) + 1]));
  const result = validateNewReview(validBody({ aspectRatings }), TODAY);
  assert.ok(result.ok);
  assert.deepEqual(result.value.aspectRatings, aspectRatings);
});

test("validateNewReview accepts a partial set of aspect ratings", () => {
  const result = validateNewReview(validBody({ aspectRatings: { sound: 5 } }), TODAY);
  assert.ok(result.ok);
  assert.deepEqual(result.value.aspectRatings, { sound: 5 });
});

test("validateNewReview accepts omitted aspect ratings", () => {
  const result = validateNewReview(validBody(), TODAY);
  assert.ok(result.ok);
  assert.deepEqual(result.value.aspectRatings, {});
});

test("validateNewReview rejects out-of-range and fractional aspect ratings", () => {
  for (const rating of [0, 6, 2.5]) {
    const result = validateNewReview(validBody({ aspectRatings: { crowd: rating } }), TODAY);
    assert.equal(result.ok, false, `crowd=${rating} should be rejected`);
    assert.match(errorFor(result, "aspectRatings.crowd")!, /whole number from 1 to 5/);
  }
});

test("validateNewReview rejects an unknown aspect", () => {
  const result = validateNewReview(validBody({ aspectRatings: { merch: 4 } }), TODAY);
  assert.equal(result.ok, false);
  assert.match(errorFor(result, "aspectRatings.merch")!, /not a concert aspect/);
});

test("an explicit null clears an aspect rating, an absent key leaves it alone", () => {
  const cleared = validateReviewUpdate({ aspectRatings: { sound: null } }, TODAY);
  assert.ok(cleared.ok);
  assert.deepEqual(cleared.value.aspectRatings, { sound: null });

  const untouched = validateReviewUpdate({ aspectRatings: { crowd: 3 } }, TODAY);
  assert.ok(untouched.ok);
  assert.deepEqual(untouched.value.aspectRatings, { crowd: 3 });
});

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

test("validateReviewUpdate accepts a single-field change", () => {
  const result = validateReviewUpdate({ venue: "Ace of Spades" }, TODAY);
  assert.ok(result.ok);
  assert.deepEqual(result.value, { venue: "Ace of Spades" });
});

test("validateReviewUpdate does not require untouched fields", () => {
  const result = validateReviewUpdate({ rating: 2 }, TODAY);
  assert.ok(result.ok, "omitting musician/venue/date must not be an error on a patch");
});

test("validateReviewUpdate applies the create rules to fields it does touch", () => {
  assert.equal(validateReviewUpdate({ rating: 0 }, TODAY).ok, false);
  assert.equal(validateReviewUpdate({ rating: 6 }, TODAY).ok, false);
  assert.equal(validateReviewUpdate({ rating: 3.5 }, TODAY).ok, false);
  assert.equal(validateReviewUpdate({ concertDate: TOMORROW }, TODAY).ok, false);
  assert.equal(validateReviewUpdate({ venue: "   " }, TODAY).ok, false);
  assert.ok(validateReviewUpdate({ rating: 1 }, TODAY).ok);
  assert.ok(validateReviewUpdate({ rating: 5 }, TODAY).ok);
  assert.ok(validateReviewUpdate({ concertDate: TODAY }, TODAY).ok);
});

test("validateReviewUpdate rejects an empty patch", () => {
  const result = validateReviewUpdate({}, TODAY);
  assert.equal(result.ok, false);
  assert.match(errorFor(result, "body")!, /No changes/);
});

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function reviewRow(overrides: Partial<Review> = {}): Review {
  return {
    id: "r1",
    user_id: "user-a",
    user_name: "jamfan",
    musician: "Nova Bloom",
    venue: "The Granada",
    concert_date: YESTERDAY,
    rating: 4,
    rating_performance: 5,
    rating_sound: null,
    rating_venue: 3,
    rating_crowd: null,
    rating_value: null,
    review_text: "Great show",
    created_at: "2026-09-20T00:00:00Z",
    updated_at: "2026-09-20T00:00:00Z",
    ...overrides,
  };
}

test("ratedAspects lists only the aspects that were rated, in display order", () => {
  assert.deepEqual(
    ratedAspects(reviewRow()).map((a) => [a.aspect, a.rating]),
    [
      ["performance", 5],
      ["venue", 3],
    ],
  );
});

test("ratedAspects is empty when nothing was rated", () => {
  const unrated = reviewRow({ rating_performance: null, rating_venue: null });
  assert.deepEqual(ratedAspects(unrated), []);
});

test("isReviewOwner matches on user id and never on a null viewer", () => {
  assert.equal(isReviewOwner(reviewRow(), "user-a"), true);
  assert.equal(isReviewOwner(reviewRow(), "user-b"), false);
  assert.equal(isReviewOwner(reviewRow(), null), false);
  assert.equal(isReviewOwner(reviewRow(), undefined), false);
});
