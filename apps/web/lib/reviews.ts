import type { SupabaseClient } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";
import {
  REVIEW_ASPECTS,
  aspectColumn,
  type AspectRatings,
  type NewReview,
  type Review,
  type ReviewUpdate,
  type ValidatedNewReview,
} from "@jamspot/shared";

export type { Review, NewReview, ReviewUpdate };

export class ReviewsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewsError";
  }
}

/** Raised when a review exists but belongs to somebody else. */
export class ReviewOwnershipError extends Error {
  constructor(message = "You can only change your own reviews") {
    super(message);
    this.name = "ReviewOwnershipError";
  }
}

/** Raised when the targeted review does not exist at all. */
export class ReviewNotFoundError extends Error {
  constructor(message = "Review not found") {
    super(message);
    this.name = "ReviewNotFoundError";
  }
}

/**
 * Every column the clients render. Listed explicitly rather than `*` so that
 * adding a column to the table is a deliberate change to the API's shape.
 */
const REVIEW_COLUMNS =
  "id, user_id, user_name, musician, venue, concert_date, rating, " +
  REVIEW_ASPECTS.map((aspect) => aspectColumn(aspect.key)).join(", ") +
  ", review_text, created_at, updated_at";

/** Spread camelCase aspect ratings onto their `rating_<aspect>` columns. */
function aspectColumns(aspectRatings: AspectRatings | undefined): Record<string, number | null> {
  if (!aspectRatings) return {};
  const row: Record<string, number | null> = {};
  for (const aspect of REVIEW_ASPECTS) {
    if (aspect.key in aspectRatings) {
      row[aspectColumn(aspect.key)] = aspectRatings[aspect.key] ?? null;
    }
  }
  return row;
}

/**
 * Fetch all reviews, most recent first.
 *
 * Reads go through the anonymous client on purpose: browsing reviews needs no
 * account, and the SELECT policy is `using (true)`.
 */
export async function getReviews(): Promise<Review[]> {
  const { data, error } = await supabase
    .from("reviews")
    .select(REVIEW_COLUMNS)
    .order("created_at", { ascending: false });

  if (error) {
    throw new ReviewsError(`Failed to fetch reviews: ${error.message}`);
  }

  return (data ?? []) as unknown as Review[];
}

/**
 * Fetch a single review by id. Returns null if no review has that id
 * (rather than throwing), since "not found" is an expected outcome here.
 */
export async function getReviewById(id: string): Promise<Review | null> {
  const { data, error } = await supabase
    .from("reviews")
    .select(REVIEW_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new ReviewsError(`Failed to fetch review ${id}: ${error.message}`);
  }

  return data as unknown as Review | null;
}

/**
 * Insert a review owned by `owner`.
 *
 * `client` must be one that carries the owner's JWT (see lib/api-auth.ts), so
 * the INSERT policy's `auth.uid() = user_id` check passes only when the id
 * written here really is the caller's. The owner is a parameter rather than
 * part of `input` so that there is no code path where a request body could
 * supply it.
 */
export async function createReview(
  client: SupabaseClient,
  input: ValidatedNewReview,
  owner: { id: string; userName: string },
): Promise<Review> {
  const { data, error } = await client
    .from("reviews")
    .insert({
      user_id: owner.id,
      user_name: owner.userName,
      musician: input.musician,
      venue: input.venue,
      concert_date: input.concertDate,
      rating: input.rating,
      review_text: input.reviewText,
      ...aspectColumns(input.aspectRatings),
    })
    .select(REVIEW_COLUMNS)
    .single();

  if (error) {
    throw new ReviewsError(`Failed to create review: ${error.message}`);
  }

  return data as unknown as Review;
}

/**
 * Apply `input` to the review with `id`, provided `userId` owns it.
 *
 * The `.eq("user_id", userId)` filter is belt to RLS's braces. RLS is what
 * actually stops the write; the explicit filter is what lets this tell "no
 * such review" apart from "not yours", so the route can answer 404 or 403
 * rather than a blanket failure. `user_id` is never in the patch, so an edit
 * cannot change ownership - and the database's trigger refuses it too.
 */
export async function updateReview(
  client: SupabaseClient,
  id: string,
  input: Partial<ValidatedNewReview>,
  userId: string,
): Promise<Review> {
  const patch: Record<string, unknown> = {};

  if (input.musician !== undefined) patch.musician = input.musician;
  if (input.venue !== undefined) patch.venue = input.venue;
  if (input.concertDate !== undefined) patch.concert_date = input.concertDate;
  if (input.rating !== undefined) patch.rating = input.rating;
  if (input.reviewText !== undefined) patch.review_text = input.reviewText;
  Object.assign(patch, aspectColumns(input.aspectRatings));

  const { data, error } = await client
    .from("reviews")
    .update(patch)
    .eq("id", id)
    .eq("user_id", userId)
    .select(REVIEW_COLUMNS)
    .maybeSingle();

  if (error) {
    throw new ReviewsError(`Failed to update review ${id}: ${error.message}`);
  }

  if (!data) {
    await assertMissingRatherThanForbidden(id);
  }

  return data as unknown as Review;
}

/**
 * Delete the review with `id`, provided `userId` owns it.
 *
 * Same split as updateReview: RLS enforces it, and the returned rows tell us
 * which of the two "nothing happened" cases we are in.
 */
export async function deleteReview(
  client: SupabaseClient,
  id: string,
  userId: string,
): Promise<void> {
  const { data, error } = await client
    .from("reviews")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new ReviewsError(`Failed to delete review ${id}: ${error.message}`);
  }

  if (!data) {
    await assertMissingRatherThanForbidden(id);
  }
}

/**
 * A write that matched no rows is either "there is no such review" or "it is
 * not yours". Reviews are world-readable, so a plain read distinguishes them.
 * Always throws.
 */
async function assertMissingRatherThanForbidden(id: string): Promise<never> {
  const existing = await getReviewById(id);
  if (existing) throw new ReviewOwnershipError();
  throw new ReviewNotFoundError();
}
