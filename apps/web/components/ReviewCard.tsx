"use client";

import { useEffect, useRef, useState } from "react";
import { Clock, MapPin, Pencil, Star, ThumbsDown, ThumbsUp, Trash2, User } from "lucide-react";
import { RATING_MAX, ratedAspects, type Review } from "@jamspot/shared";

/**
 * One review.
 *
 * `canManage` drives whether the edit and delete controls render. That is a
 * convenience only: the API route re-checks ownership on every write and the
 * database's RLS policies refuse it independently, so hiding the buttons is
 * about not offering an action that would fail, not about preventing it.
 */
interface ReviewCardProps {
    review: Review;
    canManage?: boolean;
    onEdit?: (review: Review) => void;
    onDelete?: (review: Review) => void;
}

function formatConcertDate(isoDate: string) {
    // A date-only string parsed with `new Date()` is treated as UTC midnight,
    // which renders as the previous day anywhere behind UTC. Build from parts.
    const [year, month, day] = isoDate.split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
    });
}

function Stars({ rating, size = 18 }: { rating: number; size?: number }) {
    return (
        <>
            {Array.from({ length: RATING_MAX }).map((_, index) => (
                <Star
                    key={index}
                    size={size}
                    className={
                        index < rating
                            ? "fill-yellow-400 text-yellow-400"
                            : "fill-none text-gray-300"
                    }
                />
            ))}
        </>
    );
}

export default function ReviewCard({ review, canManage = false, onEdit, onDelete }: ReviewCardProps) {
    const [expanded, setExpanded] = useState(false);
    const [showButton, setShowButton] = useState(false);

    // Votes stay presentational, exactly as on mobile: the `reviews` table has
    // no vote columns, so these start at zero and are not persisted. They are
    // left in place because persisting them is its own piece of work, not part
    // of authenticated reviews.
    const [vote, setVote] = useState<"up" | "down" | null>(null);
    const [upvotes, setUpvotes] = useState(0);
    const [downvotes, setDownvotes] = useState(0);

    const handleVote = (type: "up" | "down") => {
        const counters = { up: setUpvotes, down: setDownvotes };
        const other = type === "up" ? "down" : "up";

        if (vote === type) {
            setVote(null);
            counters[type]((prev) => prev - 1);
            return;
        }

        if (vote === other) {
            counters[other]((prev) => prev - 1);
        }
        setVote(type);
        counters[type]((prev) => prev + 1);
    };

    const contentRef = useRef<HTMLParagraphElement>(null);

    const aspects = ratedAspects(review);
    const edited = review.updated_at !== review.created_at;

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
    }, [review.review_text]);

    return (
        <article className="rounded-xl border border-review-border bg-review-background p-6 shadow-sm">
            {/* Header */}
            <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-1">
                    <Stars rating={review.rating} />

                    <span className="text-sm font-medium text-gray-600">
                        {review.rating}/{RATING_MAX}
                    </span>
                </div>

                <div className="flex items-center text-sm text-review-muted">
                    <Clock className="mr-1 h-4 w-4" />
                    {formatConcertDate(review.concert_date)}
                </div>
            </div>

            {/* Event Info */}
            <div className="mb-4 border-b pb-4">
                <h2 className="text-lg font-bold text-gray-900">
                    {review.musician}
                </h2>

                <div className="mt-1 flex items-center gap-1 text-sm text-review-muted">
                    <MapPin size={14} />
                    <span>{review.venue}</span>
                </div>
            </div>

            {/* Aspect ratings — only the ones this reviewer actually scored */}
            {aspects.length > 0 && (
                <ul className="mb-4 flex flex-wrap gap-x-5 gap-y-2 border-b pb-4">
                    {aspects.map(({ aspect, label, rating }) => (
                        <li key={aspect} className="flex items-center gap-1.5">
                            <span className="text-xs font-medium uppercase tracking-wide text-review-muted">
                                {label}
                            </span>
                            <span className="flex items-center gap-0.5" aria-hidden="true">
                                <Stars rating={rating} size={13} />
                            </span>
                            <span className="sr-only">{`${rating} out of ${RATING_MAX}`}</span>
                        </li>
                    ))}
                </ul>
            )}

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
                   {review.review_text}
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
                    <span>{review.user_name}</span>
                    {edited && (
                        <span className="text-xs italic text-review-muted">· edited</span>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    <button
                        onClick={() => handleVote("up")}
                        aria-label="Upvote review"
                        aria-pressed={vote === "up"}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors cursor-pointer ${
                            vote === "up"
                                ? "border-green-500 bg-green-50 text-green-600"
                                : "border-review-border text-review-muted hover:bg-gray-100"
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
                                : "border-review-border text-review-muted hover:bg-gray-100"
                        }`}
                    >
                        <ThumbsDown size={18} />
                        {downvotes}
                    </button>

                    {canManage && (
                        <>
                            <button
                                type="button"
                                onClick={() => onEdit?.(review)}
                                className="flex items-center gap-2 rounded-lg border border-review-border px-3 py-2 text-review-muted transition-colors hover:bg-gray-100 cursor-pointer"
                            >
                                <Pencil size={16} />
                                Edit
                            </button>

                            <button
                                type="button"
                                onClick={() => onDelete?.(review)}
                                className="flex items-center gap-2 rounded-lg border border-review-border px-3 py-2 text-red-600 transition-colors hover:bg-red-50 cursor-pointer"
                            >
                                <Trash2 size={16} />
                                Delete
                            </button>
                        </>
                    )}
                </div>
            </div>
        </article>
    )
}
