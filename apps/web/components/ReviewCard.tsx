"use client";

import { useEffect, useRef, useState } from "react";
import { ThumbsUp, ThumbsDown, MapPin, Clock, User, Star } from "lucide-react";

import type { Review } from "@jamspot/shared";

/**
 * `review_date` is a date-only string ("2026-08-07"). Passing it straight to
 * `new Date()` parses it as UTC midnight, which renders as the previous day
 * in any timezone behind UTC, so build the date from local components instead.
 * apps/mobile/src/components/review-card.tsx does the same.
 */
function formatDate(isoDate: string) {
    const [year, month, day] = isoDate.split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
    });
}

export default function ReviewCard({ review }: { review: Review }) {
    const [expanded, setExpanded] = useState(false);
    const [showButton, setShowButton] = useState(false);

    const [vote, setVote] = useState<"up" | "down" | null>(null);
    // The `reviews` table has no vote columns, so these start at zero and are
    // never persisted - the toggle is presentational on both clients.
    const [upvotes, setUpvotes] = useState(0);
    const [downvotes, setDownvotes] = useState(0);

    const contentRef = useRef<HTMLParagraphElement>(null);

    const author = review.profiles?.username ?? "Anonymous";
    const rating = Math.max(0, Math.min(5, Math.round(review.star_rating)));

    useEffect(() => {
        const checkOverflow = () => {
            if (!contentRef.current) return;

            // Wait for the browser to apply the clamp
            requestAnimationFrame(() => {
                const el = contentRef.current!;
                setShowButton(el.scrollHeight > el.clientHeight);
            });
        };

        checkOverflow();

        window.addEventListener("resize", checkOverflow);
        return () => window.removeEventListener("resize", checkOverflow);
    }, [review.description]);

    const handleVote = (type: "up" | "down") => {
        if (type === "up") {
            if (vote === "up") {
                setVote(null);
                setUpvotes((prev) => prev - 1);
            } else if (vote === "down") {
                setVote("up");
                setUpvotes((prev) => prev + 1);
                setDownvotes((prev) => prev - 1)
            } else {
                setVote("up");
                setUpvotes((prev) => prev + 1);
            }
        }

        if (type === "down") {
            if (vote === "down") {
                setVote(null);
                setDownvotes((prev) => prev - 1);
            } else if (vote === "up") {
                setVote("down");
                setDownvotes((prev) => prev + 1);
                setUpvotes((prev) => prev - 1);
            } else {
                setVote("down");
                setDownvotes((prev) => prev + 1);
            }
        }
    };

    return (
        <article className="rounded-xl border border-review-border bg-review-background p-6 shadow-sm">
            {/* Header */}
            <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-1">
                    {[...Array(5)].map((_, index) => (
                        <Star
                            key={index}
                            size={18}
                            className={
                                index < rating
                                    ? "fill-yellow-400 text-yellow-400"
                                    : "fill-none text-gray-300"
                            }
                        />
                    ))}

                    <span className="text-sm font-medium text-gray-600">
                        {review.star_rating}/5
                    </span>
                </div>
                
                <div className="flex items-center text-sm text-review-muted">
                    <Clock className="mr-1 h-4 w-4" />
                    {formatDate(review.review_date)}
                </div>
            </div>

            {/* Event Info */}
            <div className="mb-4 border-b pb-4">
                <h2 className="text-lg font-bold text-gray-900">
                    {review.short_description}
                </h2>

                <div className="mt-1 flex items-center gap-1 text-sm text-review-muted">
                    <MapPin size={14} />
                    <span>{review.location}</span>
                </div>
            </div>

            {/* Content */}
            <div className="mb-4">
               <p 
                   ref={contentRef}
                   className={`
                    text-review-foreground overflow-hidden min-h-[7lh] sm:min-h-[5lh]
                    ${expanded 
                        ? '' 
                        : "line-clamp-7 sm:line-clamp-5"}
                    `}
               >
                   {review.description}
               </p>

               {showButton && (
                    <button
                        onClick={() => setExpanded((prev) => !prev)}
                     className="mt-2 text-sm font-medium text-blue-600 hover:underline cursor-pointer"
                   >
                        {expanded ? 'Show less' : 'Show more'}
                   </button>
               )}
            </div>

            {/* Footer */}
            <div className="flex flex-col gap-4 border-t pt-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-2 text-review-muted">
                    <User size={18} />
                    <span>{author}</span>
                </div>

                <div className="flex gap-4">
                    <button
                        onClick={() => handleVote("up")}
                        aria-label="Upvote review"
                        aria-pressed={vote === "up"}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors cursor-pointer ${
                            vote === "up"
                                ? "border-green-500 bg-green-50 text-green-600"
                                : "text-review-muted hover:bg-gray-100"
                        }`}
                    >
                        <ThumbsUp size={18} />
                        {upvotes}
                    </button>

                    <button 
                        onClick={() => handleVote("down")}
                        aria-label="Downvote review"
                        aria-pressed={vote === "down"}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors cursor-pointer ${
                            vote === "down"
                                ? "border-red-500 bg-red-50 text-red-600"
                                : "text-review-muted hover:gb-gray-100"
                        }`}
                    >
                        <ThumbsDown size={18} />
                        {downvotes}
                    </button>
                </div>
            </div>
        </article>
    )
}
