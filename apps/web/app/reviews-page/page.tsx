'use client';

import { useEffect, useState } from "react";
import Link from "next/link";
import { Music2, PenLine, Search } from "lucide-react";
import { isReviewOwner, type Review } from "@jamspot/shared";

import ReviewCard from "@/components/ReviewCard";
import ReviewCardSkeleton from "@/components/ReviewCardSkeleton";
import ReviewForm from "@/components/ReviewForm";
import AuthNav from "@/components/AuthNav";
import { useAuth } from "@/components/AuthProvider";
import { ReviewRequestError, fetchReviews, removeReview } from "@/lib/reviews-client";

/**
 * Matches the mobile screen's filter (apps/mobile/src/app/reviews.tsx): artist,
 * venue, and author are searchable, but the review body deliberately is not -
 * otherwise a common word matches nearly every review.
 */
function describeError(err: unknown, fallback: string) {
    return err instanceof ReviewRequestError ? err.message : fallback;
}

export function filterReviews(reviews: Review[], query: string) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return reviews;
    return reviews.filter((review) =>
        [review.musician, review.venue, review.user_name]
            .join(" ")
            .toLowerCase()
            .includes(normalized),
    );
}

export default function ReviewsPage() {
    const { user, status } = useAuth();

    const [searchInput, setSearchInput] = useState("");
    const [query, setQuery] = useState("");
    const [isLoading, setIsLoading] = useState(true);
    const [reviews, setReviews] = useState<Review[]>([]);
    const [error, setError] = useState<string | null>(null);

    // Which form is open: nothing, a new review, or an existing one.
    const [composing, setComposing] = useState(false);
    const [editing, setEditing] = useState<Review | null>(null);
    // The review awaiting an explicit confirmation before it is removed.
    const [pendingDelete, setPendingDelete] = useState<Review | null>(null);
    const [deleting, setDeleting] = useState(false);

    // State is only ever written from a .then()/.catch()/.finally() callback,
    // never synchronously in the effect body - the same shape
    // apps/mobile/src/app/reviews.tsx uses, and what this project's
    // react-hooks/set-state-in-effect rule requires.
    useEffect(() => {
        let cancelled = false;

        fetchReviews()
            .then((data) => {
                if (cancelled) return;
                setReviews(data);
                setError(null);
            })
            .catch((err) => {
                if (cancelled) return;
                setError(describeError(err, "Something went wrong loading reviews."));
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, []);

    function handleSaved(saved: Review) {
        setReviews((previous) => {
            const existing = previous.findIndex((review) => review.id === saved.id);
            if (existing === -1) return [saved, ...previous];
            return previous.map((review) => (review.id === saved.id ? saved : review));
        });
        setComposing(false);
        setEditing(null);
    }

    async function confirmDelete() {
        if (!pendingDelete) return;
        setDeleting(true);
        try {
            await removeReview(pendingDelete.id);
            setReviews((previous) => previous.filter((review) => review.id !== pendingDelete.id));
            setPendingDelete(null);
        } catch (err) {
            setError(describeError(err, "Something went wrong deleting your review."));
            setPendingDelete(null);
        } finally {
            setDeleting(false);
        }
    }

    const visible = filterReviews(reviews, query);
    const formOpen = composing || editing !== null;

    return (
        <>
            <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
                <div className="mx-auto max-w-7xl px-4 sm:px-6 py-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        {/* Top row */}
                        <div className="flex items-center gap-6">
                            <Link
                                href="/"
                                className="flex items-center gap-2 shrink-0"
                            >
                                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
                                    <Music2 size={14} className="text-white" />
                                </div>

                                <span
                                    className="text-sm font-bold uppercase tracking-widest text-foreground"
                                    style={{
                                        fontFamily: "'Unbounded', sans-serif",
                                        letterSpacing: "0.12em",
                                    }}
                                >
                                    JAMSPOT
                                </span>
                            </Link>

                            {/* Active Page */}
                            <nav>
                                <Link
                                    href="/reviews-page"
                                    className="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-white"
                                >
                                    Reviews
                                </Link>
                            </nav>

                            <AuthNav />
                        </div>

                        {/* Search */}
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                setQuery(searchInput);
                            }}
                            className="w-full sm:w-auto"
                        >
                            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 sm:w-96">
                                <Search size={15} className="text-muted-foreground shrink-0" />

                                <input
                                    type="text"
                                    name="review-search"
                                    value={searchInput}
                                    onChange={(e) => setSearchInput(e.target.value)}
                                    placeholder="Search by artist, venue, or reviewer..."
                                    className="w-full bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
                                    />
                            </div>
                        </form>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-3xl space-y-6 p-6 text-foreground">
                {/* Reviews heading */}
                <div className="flex items-baseline justify-between gap-4">
                    <h1
                        className="text-lg font-bold text-foreground"
                        style={{
                            fontFamily: "'Unbounded', sans-serif",
                            fontSize: "1rem",
                        }}
                    >
                        Reviews
                    </h1>

                    <div className="flex items-center gap-4">
                        <span
                            className="text-sm text-muted-foreground"
                            style={{ fontFamily: "'DM Mono', monospace" }}
                        >
                            {visible.length} review{visible.length !== 1 ? "s" : ""}
                        </span>

                        {/* Writing needs an account, so signed-out visitors are
                            pointed at sign-in rather than shown a form that
                            would fail on submit. */}
                        {status === "authenticated" ? (
                            <button
                                type="button"
                                onClick={() => {
                                    setEditing(null);
                                    setComposing(true);
                                }}
                                className="flex items-center gap-2 rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 cursor-pointer"
                            >
                                <PenLine size={14} />
                                Write a review
                            </button>
                        ) : status === "unauthenticated" ? (
                            <Link
                                href="/sign-in"
                                className="flex items-center gap-2 rounded-full border border-border bg-muted px-4 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                            >
                                <PenLine size={14} />
                                Sign in to review
                            </Link>
                        ) : null}
                    </div>
                </div>

                {error && (
                    <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                        {error}
                    </p>
                )}

                {formOpen && (
                    <div className="rounded-xl border border-border bg-card p-6">
                        <ReviewForm
                            review={editing ?? undefined}
                            onSaved={handleSaved}
                            onCancel={() => {
                                setComposing(false);
                                setEditing(null);
                            }}
                        />
                    </div>
                )}

                {/* Reviews Cards */}
                <div className="space-y-4">
                    {isLoading ? (
                        Array.from({ length: 3 }).map((_, index) => (
                            <ReviewCardSkeleton key={index} />
                        ))
                    ) : visible.length > 0 ? (
                        visible.map((review) => (
                            <ReviewCard
                                key={review.id}
                                review={review}
                                canManage={isReviewOwner(review, user?.id)}
                                onEdit={(target) => {
                                    setComposing(false);
                                    setEditing(target);
                                }}
                                onDelete={setPendingDelete}
                            />
                        ))
                    ) : (
                        <p className="text-center text-review-muted">
                            No reviews found.
                        </p>
                    )}
                </div>
            </main>

            {/* Deleting is permanent, so it takes a second, explicit action. */}
            {pendingDelete && (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="delete-review-title"
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
                >
                    <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 text-foreground">
                        <h2 id="delete-review-title" className="text-lg font-bold">
                            Delete this review?
                        </h2>
                        <p className="mt-2 text-sm text-muted-foreground">
                            Your review of {pendingDelete.musician} at {pendingDelete.venue} will be
                            permanently removed. This cannot be undone.
                        </p>
                        <div className="mt-6 flex justify-end gap-3">
                            <button
                                type="button"
                                onClick={() => setPendingDelete(null)}
                                disabled={deleting}
                                className="rounded-full border border-border bg-muted px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50 cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={confirmDelete}
                                disabled={deleting}
                                className="rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 cursor-pointer"
                            >
                                {deleting ? "Deleting…" : "Delete review"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}
