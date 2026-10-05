import type { NewReview, Review, ReviewFieldError, ReviewUpdate } from "@jamspot/shared";

/**
 * Browser-side calls to the review API.
 *
 * These go through /api/reviews rather than straight to Supabase from the
 * browser, so that one server-side implementation of the write rules covers
 * both clients. Credentials ride along in the session cookie, which is why
 * nothing here handles tokens - see lib/api-auth.ts for the mobile equivalent.
 */

export class ReviewRequestError extends Error {
  readonly status: number;
  /** Per-field messages when the API rejected the input; empty otherwise. */
  readonly fields: ReviewFieldError[];

  constructor(message: string, status: number, fields: ReviewFieldError[] = []) {
    super(message);
    this.name = "ReviewRequestError";
    this.status = status;
    this.fields = fields;
  }

  /** True when signing in (or signing in again) is what would fix this. */
  get isAuthError() {
    return this.status === 401;
  }
}

async function readError(response: Response): Promise<never> {
  const body = await response.json().catch(() => null);
  throw new ReviewRequestError(
    typeof body?.error === "string" ? body.error : `Request failed with status ${response.status}`,
    response.status,
    Array.isArray(body?.fields) ? body.fields : [],
  );
}

export async function fetchReviews(): Promise<Review[]> {
  const response = await fetch("/api/reviews", { cache: "no-store" });
  if (!response.ok) await readError(response);
  return (await response.json()).reviews;
}

export async function postReview(input: NewReview): Promise<Review> {
  const response = await fetch("/api/reviews", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) await readError(response);
  return (await response.json()).review;
}

export async function patchReview(id: string, input: ReviewUpdate): Promise<Review> {
  const response = await fetch(`/api/reviews/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) await readError(response);
  return (await response.json()).review;
}

export async function removeReview(id: string): Promise<void> {
  const response = await fetch(`/api/reviews/${id}`, { method: "DELETE" });
  if (!response.ok) await readError(response);
}
