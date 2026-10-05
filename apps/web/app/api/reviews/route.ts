import { NextRequest, NextResponse } from "next/server";
import { describeReviewErrors, validateNewReview } from "@jamspot/shared";

import { resolveDisplayName, resolveRequestIdentity } from "@/lib/api-auth";
import { createReview, getReviews, ReviewsError } from "@/lib/reviews";

/**
 * GET /api/reviews
 *
 * Returns every review, most recent first. Open to anonymous callers.
 */
export async function GET() {
  try {
    const reviews = await getReviews();
    return NextResponse.json({ reviews });
  } catch (err) {
    if (err instanceof ReviewsError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json(
      { error: "Unexpected error while fetching reviews" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/reviews
 *
 * Body: { musician, venue, concertDate, rating, reviewText, aspectRatings? }
 *
 * Requires a signed-in user, supplied either as the web app's session cookie
 * or as a `Authorization: Bearer <jwt>` header from the mobile app.
 *
 * The review's owner is taken from that session and is not readable from the
 * body: there is no request that can create a review attributed to anyone but
 * the caller. Sending `user_id` or `user_name` is rejected outright rather
 * than ignored, so a client doing it finds out.
 */
export async function POST(request: NextRequest) {
  const identity = await resolveRequestIdentity(request);

  if (!identity) {
    return NextResponse.json(
      { error: "You must be signed in to write a review." },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 }
    );
  }

  const validation = validateNewReview(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: describeReviewErrors(validation.errors), fields: validation.errors },
      { status: 400 }
    );
  }

  try {
    const userName = await resolveDisplayName(identity);
    const review = await createReview(identity.supabase, validation.value, {
      id: identity.user.id,
      userName,
    });

    return NextResponse.json({ review }, { status: 201 });
  } catch (err) {
    if (err instanceof ReviewsError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json(
      { error: "Unexpected error while creating review" },
      { status: 500 }
    );
  }
}
