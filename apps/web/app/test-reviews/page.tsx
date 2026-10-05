import { createReview, getReviewById, getReviews, ReviewsError } from "@/lib/reviews";
import { createClient, getServerUser } from "@/lib/supabase-server";

/**
 * Temporary connection-test route for the reviews table, following the
 * same pattern as /test-db and /test-concerts.
 *
 * The read check always runs. The write check only runs for a signed-in
 * visitor, because `reviews.author_id` is now NOT NULL and RLS requires it to
 * match the caller - an anonymous insert is rejected outright.
 *
 * When it does run, it WRITES a real row to `reviews` and cannot clean up
 * after itself (RLS grants no DELETE), so the row stays in the table. Delete
 * this route, or clear rows whose short_description is
 * 'test-reviews route check', before sharing the app publicly.
 */
export default async function TestReviewsPage() {
  let created: Awaited<ReturnType<typeof createReview>> | null = null;
  let fetched: Awaited<ReturnType<typeof getReviewById>> | null = null;
  let readCount: number | null = null;
  let error: string | null = null;
  let signedIn = false;

  try {
    readCount = (await getReviews()).length;

    const user = await getServerUser();
    signedIn = user !== null;

    if (user) {
      const client = await createClient();

      created = await createReview(client, user.id, {
        shortDescription: "test-reviews route check",
        description: `Automated read/write check at ${new Date().toISOString()}`,
        starRating: 5,
        location: "Automated Test Venue",
        reviewDate: new Date().toISOString().slice(0, 10),
      });

      fetched = await getReviewById(created.id);

      if (!fetched) {
        error = "Review was created but could not be read back by id";
      }
    }
  } catch (err) {
    error = err instanceof ReviewsError ? err.message : "Unexpected error";
  }

  const readOk = !error && readCount !== null;
  const writeOk = !error && created !== null && fetched !== null;
  const success = signedIn ? readOk && writeOk : readOk;

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">
        {success
          ? signedIn
            ? "JamSpot can read and write reviews"
            : "JamSpot can read reviews"
          : "Reviews connection test failed"}
      </h1>

      <p className="mt-2 text-sm text-gray-600">
        {signedIn
          ? "This route writes a real row to the reviews table on every load and cannot delete it (RLS blocks deletes by design). Remove this route, or periodically clear test rows, before sharing this app publicly."
          : "Sign in to also exercise the write path: reviews.author_id must match the signed-in user, so an anonymous insert is rejected."}
      </p>

      {error ? (
        <pre className="mt-4 whitespace-pre-wrap">{error}</pre>
      ) : (
        <>
          <h2 className="mt-4 font-semibold">Read result:</h2>
          <pre className="mt-2 whitespace-pre-wrap">
            {readCount} review{readCount === 1 ? "" : "s"} returned by getReviews()
          </pre>

          {created && (
            <>
              <h2 className="mt-4 font-semibold">Write result (created row):</h2>
              <pre className="mt-2 whitespace-pre-wrap">
                {JSON.stringify(created, null, 2)}
              </pre>

              <h2 className="mt-4 font-semibold">
                Read result (same row, fetched back by id):
              </h2>
              <pre className="mt-2 whitespace-pre-wrap">
                {JSON.stringify(fetched, null, 2)}
              </pre>
            </>
          )}
        </>
      )}
    </main>
  );
}
