import { getReviewById, getReviews, ReviewsError } from "@/lib/reviews";

/**
 * Temporary connection-test route for the reviews table, following the same
 * pattern as /test-db and /test-concerts.
 *
 * This used to write a real row on every load, which worked only because the
 * old RLS policy let anonymous callers INSERT. Authenticated reviews removed
 * that policy on purpose - writing now requires a signed-in user who owns the
 * row - so the check is read-only: it lists reviews and reads the first one
 * back by id, which is enough to confirm the table is reachable and shaped the
 * way the app expects. Creating a review is covered by the automated tests and
 * by the reviews page itself.
 */
// A connection check is only useful if it runs now, not at build time.
export const dynamic = "force-dynamic";

export default async function TestReviewsPage() {
  let reviews: Awaited<ReturnType<typeof getReviews>> = [];
  let fetched: Awaited<ReturnType<typeof getReviewById>> = null;
  let error: string | null = null;

  try {
    reviews = await getReviews();
    if (reviews.length > 0) {
      fetched = await getReviewById(reviews[0].id);
      if (!fetched) {
        error = "A review was listed but could not be read back by id";
      }
    }
  } catch (err) {
    error = err instanceof ReviewsError ? err.message : "Unexpected error";
  }

  const success = !error;

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">
        {success ? "JamSpot can read reviews" : "Reviews read test failed"}
      </h1>

      <p className="mt-2 text-sm text-gray-600">
        Read-only. Writing a review requires an authenticated owner, so this
        route no longer creates rows and leaves nothing behind.
      </p>

      {error ? (
        <pre className="mt-4 whitespace-pre-wrap">{error}</pre>
      ) : (
        <>
          <h2 className="mt-4 font-semibold">
            List result ({reviews.length} review{reviews.length === 1 ? "" : "s"}):
          </h2>
          <pre className="mt-2 whitespace-pre-wrap">
            {JSON.stringify(reviews.slice(0, 3), null, 2)}
          </pre>

          <h2 className="mt-4 font-semibold">
            Read result (first row, fetched back by id):
          </h2>
          <pre className="mt-2 whitespace-pre-wrap">
            {JSON.stringify(fetched, null, 2)}
          </pre>
        </>
      )}
    </main>
  );
}
