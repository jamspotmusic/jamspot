'use client';

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Music2, Search } from "lucide-react";
import ReviewCard from "@/components/ReviewCard";
import ReviewCardSkeleton from "@/components/ReviewCardSkeleton";
import AuthNav from "@/components/AuthNav";
import type { Review } from "@jamspot/shared";

/**
 * Matches apps/mobile/src/app/reviews.tsx's `filterReviews`, so both clients
 * search the same fields. The live rows carry a free-text `location` and a
 * `short_description` rather than separate artist/venue/city/state columns.
 * The review body is deliberately excluded: matching on it would make a
 * common word hit nearly every review.
 */
export function filterReviews(reviews: Review[], query: string) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return reviews;
    return reviews.filter((review) =>
        [review.short_description, review.location]
            .join(" ")
            .toLowerCase()
            .includes(normalized),
    );
}

export default function ReviewsPage() {
    const [searchInput, setSearchInput] = useState("");
    const [query, setQuery] = useState("");
    const [reviews, setReviews] = useState<Review[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        async function loadReviews() {
            try {
                const response = await fetch("/api/reviews");
                const body = await response.json();

                if (!response.ok) {
                    throw new Error(body?.error ?? "Failed to load reviews");
                }

                if (!cancelled) {
                    setReviews(body.reviews ?? []);
                    setError(null);
                }
            } catch (err) {
                console.error("Failed to load reviews:", err);
                if (!cancelled) {
                    setError(
                        err instanceof Error
                            ? err.message
                            : "Something went wrong loading reviews.",
                    );
                }
            }
        }

        loadReviews();

        return () => {
            cancelled = true;
        };
    }, []);

    // Searching filters the rows already loaded rather than refetching, which
    // is what the mobile screen does and keeps the count below in step.
    const filtered = useMemo(
        () => (reviews ? filterReviews(reviews, query) : []),
        [reviews, query],
    );

    const isLoading = !reviews && !error;

    const handleSearch = (e: React.SyntheticEvent<HTMLFormElement>) => {
        e.preventDefault();
        setQuery(searchInput);
    };

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
                            onSubmit={handleSearch}
                            className="w-full sm:w-auto"
                        >
                            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 sm:w-96">
                                <Search size={15} className="text-muted-foreground shrink-0" />

                                <input 
                                    type="text"
                                    name="review-search"
                                    value={searchInput}
                                    onChange={(e) => setSearchInput(e.target.value)}
                                    placeholder="Search by artist, venue, or location..."
                                    className="w-full bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
                                    /> 
                            </div>
                        </form>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-3xl space-y-6 p-6 text-foreground">
                {/* Reviews heading */}
                <div className="flex items-baseline justify-between">
                    <h1
                        className="text-lg font-bold text-foreground"
                        style={{
                            fontFamily: "'Unbounded', sans-serif",
                            fontSize: "1rem",
                        }}
                    >
                        Reviews
                    </h1>

                    <span
                        className="text-sm text-muted-foreground"
                        style={{ fontFamily: "'DM Mono', monospace" }}
                    >
                        {filtered.length} review{filtered.length !== 1 ? "s" : ""}
                    </span>
                </div>

                {/* Reviews Cards */}
                <div className="space-y-4">
                    {isLoading ? (
                        Array.from({ length: 3 }).map((_, index) => (
                            <ReviewCardSkeleton key={index} />
                        ))
                    ) : error ? (
                        <p className="text-center text-review-muted">{error}</p>
                    ) : filtered.length > 0 ? (
                        filtered.map((review) => (
                            <ReviewCard
                                key={review.id}
                                review={review}
                            />
                        ))
                    ) : (
                        <p className="text-center text-review-muted">
                            No reviews found.
                        </p>
                    )}
                </div>
            </main>
        </>
    )
}
