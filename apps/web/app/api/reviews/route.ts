import { NextRequest, NextResponse } from "next/server";

import { createReview, getReviews, ReviewsError } from "@/lib/reviews";
import * as supabaseServer from "@/lib/supabase-server";
import type { NewReview } from "@jamspot/shared";

/**
 * GET /api/reviews
 *
 * Returns every review, most recent first. Public - no session required.
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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A trimmed non-empty string, or null if `value` is not one. */
function requiredText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

type ValidationResult =
  | { ok: true; input: NewReview }
  | { ok: false; error: string };

function validate(body: Record<string, unknown>): ValidationResult {
  const shortDescription = requiredText(body.shortDescription);
  const description = requiredText(body.description);
  const location = requiredText(body.location);
  const reviewDate = requiredText(body.reviewDate);

  if (!shortDescription || !description || !location || !reviewDate) {
    return {
      ok: false,
      error:
        "shortDescription, description, location, and reviewDate are required non-empty strings",
    };
  }

  if (!ISO_DATE.test(reviewDate)) {
    return { ok: false, error: "reviewDate must be an ISO date, e.g. 2026-08-07" };
  }

  const starRating = body.starRating;
  if (
    typeof starRating !== "number" ||
    !Number.isInteger(starRating) ||
    starRating < 1 ||
    starRating > 5
  ) {
    return { ok: false, error: "starRating must be an integer from 1 to 5" };
  }

  return {
    ok: true,
    input: { shortDescription, description, starRating, location, reviewDate },
  };
}

/**
 * POST /api/reviews
 *
 * Body: { shortDescription, description, starRating, location, reviewDate }
 *
 * Requires a signed-in user. `author_id` is taken from the verified session,
 * not the request body, because Row Level Security requires it to match the
 * caller and a client-supplied value would be spoofable.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 }
    );
  }

  const validated = validate(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  try {
    const user = await supabaseServer.getServerUser();
    if (!user) {
      return NextResponse.json(
        { error: "You must be signed in to post a review" },
        { status: 401 }
      );
    }

    const client = await supabaseServer.createClient();
    const review = await createReview(client, user.id, validated.input);

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
