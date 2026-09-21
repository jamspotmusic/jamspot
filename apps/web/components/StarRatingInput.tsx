"use client";

import { Star, X } from "lucide-react";
import { useId, useState } from "react";
import { RATING_MAX, RATING_MIN } from "@jamspot/shared";

/**
 * An interactive 1-5 star picker, used for both the required overall rating
 * and the optional per-aspect ones.
 *
 * Built as a radiogroup rather than a row of buttons so it behaves the way a
 * single-choice control is expected to: one tab stop for the whole group,
 * arrow keys to move between values, and a name screen readers announce.
 * `onChange` receives null only when `clearable` is set, which is what lets an
 * optional aspect go back to "not rated" - a state distinct from rating it 1.
 */
export default function StarRatingInput({
  value,
  onChange,
  label,
  describedBy,
  clearable = false,
  size = 24,
  disabled = false,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  label: string;
  describedBy?: string;
  clearable?: boolean;
  size?: number;
  disabled?: boolean;
}) {
  // Hover preview is presentational only; the committed value is `value`.
  const [hovered, setHovered] = useState<number | null>(null);
  const groupId = useId();

  const shown = hovered ?? value ?? 0;
  const stars = Array.from({ length: RATING_MAX - RATING_MIN + 1 }, (_, i) => RATING_MIN + i);

  function moveBy(delta: number) {
    const next = Math.min(RATING_MAX, Math.max(RATING_MIN, (value ?? RATING_MIN - delta) + delta));
    onChange(next);
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-describedby={describedBy}
      className="flex items-center gap-1"
      onMouseLeave={() => setHovered(null)}
    >
      {stars.map((star) => {
        const selected = value === star;
        return (
          <button
            key={star}
            type="button"
            role="radio"
            id={`${groupId}-${star}`}
            aria-checked={selected}
            aria-label={`${star} ${star === 1 ? "star" : "stars"}`}
            disabled={disabled}
            // Roving tabindex: the group is one tab stop, landing on the
            // current value (or the first star when nothing is chosen yet).
            tabIndex={selected || (value === null && star === RATING_MIN) ? 0 : -1}
            onClick={() => onChange(clearable && value === star ? null : star)}
            onMouseEnter={() => setHovered(star)}
            onFocus={() => setHovered(star)}
            onBlur={() => setHovered(null)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowUp") {
                event.preventDefault();
                moveBy(1);
              } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
                event.preventDefault();
                moveBy(-1);
              } else if (clearable && (event.key === "Backspace" || event.key === "Delete")) {
                event.preventDefault();
                onChange(null);
              }
            }}
            className="rounded p-0.5 transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            <Star
              size={size}
              className={
                star <= shown ? "fill-yellow-400 text-yellow-400" : "fill-none text-gray-400"
              }
            />
          </button>
        );
      })}

      <span className="ml-2 min-w-[4.5ch] text-sm text-muted-foreground" aria-hidden="true">
        {value ? `${value}/${RATING_MAX}` : "–"}
      </span>

      {clearable && value !== null && !disabled && (
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label={`Clear ${label}`}
          className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary cursor-pointer"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
