import type { SupabaseClient } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";
import type { Review, NewReview, ReviewUpdate, ReviewAuthor } from "@jamspot/shared";

export type { Review, NewReview, ReviewUpdate, ReviewAuthor };

export class ReviewsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewsError";
  }
}

/**
 * `select("*")` already returns the embedded `profiles` author object - it is
 * not a separate embed that has to be asked for. Spelling it out as
 * `"*, profiles(id, username)"` actually emits a duplicate `profiles` key in
 * the response, so leave this alone.
 */
const SELECT_ALL = "*";

/**
 * Fetch all reviews, most recent first.
 *
 * Reads are public: this uses the anonymous client, which is what Row Level
 * Security allows an unauthenticated visitor to do.
 */
export async function getReviews(): Promise<Review[]> {
  const { data, error } = await supabase
    .from("reviews")
    .select(SELECT_ALL)
    .order("created_at", { ascending: false });

  if (error) {
    throw new ReviewsError(`Failed to fetch reviews: ${error.message}`);
  }

  return (data ?? []) as Review[];
}

/**
 * Fetch a single review by id. Returns null if no review has that id
 * (rather than throwing), since "not found" is an expected outcome here.
 */
export async function getReviewById(id: string): Promise<Review | null> {
  const { data, error } = await supabase
    .from("reviews")
    .select(SELECT_ALL)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new ReviewsError(`Failed to fetch review ${id}: ${error.message}`);
  }

  return (data ?? null) as Review | null;
}

/**
 * Insert a new review. Returns the created row, including the
 * database-generated `id`, `created_at`, and `updated_at`.
 *
 * Unlike the read helpers, this takes the Supabase client to use rather than
 * reaching for the module-level anonymous one. Writes are governed by Row
 * Level Security, which requires `author_id` to match the signed-in user, so
 * the caller must pass a client carrying that user's session (see
 * lib/supabase-server.ts) together with their id. `authorId` is a separate
 * argument for the same reason it is absent from `NewReview`: it must come
 * from the verified session, never from request input.
 */
export async function createReview(
  client: SupabaseClient,
  authorId: string,
  input: NewReview,
): Promise<Review> {
  const { data, error } = await client
    .from("reviews")
    .insert({
      short_description: input.shortDescription,
      description: input.description,
      star_rating: input.starRating,
      location: input.location,
      review_date: input.reviewDate,
      author_id: authorId,
    })
    .select(SELECT_ALL)
    .single();

  if (error) {
    throw new ReviewsError(`Failed to create review: ${error.message}`);
  }

  return data as Review;
}
