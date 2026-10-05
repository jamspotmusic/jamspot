import { NextRequest, NextResponse } from "next/server";
import { describeReviewErrors, validateReviewUpdate } from "@jamspot/shared";

import { resolveRequestIdentity } from "@/lib/api-auth";
import {
  deleteReview,
  getReviewById,
  ReviewNotFoundError,
  ReviewOwnershipError,
  ReviewsError,
  updateReview,
} from "@/lib/reviews";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Both writes fail the same handful of ways, so the mapping lives in one
 * place. The ownership case is a 403 rather than a 404: the review is
 * world-readable, so pretending it does not exist would be a fiction the
 * very next GET would expose.
 */
function errorResponse(err: unknown, action: string) {
  if (err instanceof ReviewNotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof ReviewOwnershipError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err instanceof ReviewsError) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
  return NextResponse.json(
    { error: `Unexpected error while ${action} review` },
    { status: 500 }
  );
}

function unauthenticated(action: string) {
  return NextResponse.json(
    { error: `You must be signed in to ${action} a review.` },
    { status: 401 }
  );
}

/**
 * GET /api/reviews/[id]
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const review = await getReviewById(id);

    if (!review) {
      return NextResponse.json({ error: "Review not found" }, { status: 404 });
    }

    return NextResponse.json({ review });
  } catch (err) {
    if (err instanceof ReviewsError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json(
      { error: "Unexpected error while fetching review" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/reviews/[id]
 *
 * Body: any subset of { musician, venue, concertDate, rating, reviewText,
 * aspectRatings }. Only the review's owner may edit it, and the same
 * validation that governs creation governs the result.
 *
 * The owner cannot be reassigned: `user_id` is refused by validation, never
 * written by updateReview, and blocked by a database trigger even if a request
 * reached PostgREST directly.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const identity = await resolveRequestIdentity(request);
  if (!identity) return unauthenticated("edit");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 }
    );
  }

  const validation = validateReviewUpdate(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: describeReviewErrors(validation.errors), fields: validation.errors },
      { status: 400 }
    );
  }

  try {
    const review = await updateReview(
      identity.supabase,
      id,
      validation.value,
      identity.user.id
    );
    return NextResponse.json({ review });
  } catch (err) {
    return errorResponse(err, "updating");
  }
}

/**
 * DELETE /api/reviews/[id]
 *
 * Only the review's owner may delete it. The clients ask for confirmation
 * before calling this; the check that matters is the ownership one below and
 * the RLS policy behind it.
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const identity = await resolveRequestIdentity(request);
  if (!identity) return unauthenticated("delete");

  try {
    await deleteReview(identity.supabase, id, identity.user.id);
    return NextResponse.json({ id, deleted: true });
  } catch (err) {
    return errorResponse(err, "deleting");
  }
}
