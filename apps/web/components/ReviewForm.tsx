"use client";

import { useState } from "react";
import { Loader2, X } from "lucide-react";
import {
  REVIEW_ASPECTS,
  todayIsoDate,
  validateNewReview,
  type AspectRatings,
  type Review,
  type ReviewAspect,
  type ReviewFieldError,
} from "@jamspot/shared";

import StarRatingInput from "@/components/StarRatingInput";
import { ReviewRequestError, patchReview, postReview } from "@/lib/reviews-client";

/**
 * The create/edit form, used for both because the fields and the rules are
 * identical - the ticket requires every creation rule to hold on update too,
 * and one component is the most direct way to guarantee that.
 *
 * Validation calls the same `validateNewReview` the API route calls. The
 * point is not to save a round trip (though it does); it is that the message
 * a user sees before submitting is produced by the same code that would
 * reject them afterwards, so the two cannot word things differently or
 * disagree about what is allowed.
 */

type FormState = {
  musician: string;
  venue: string;
  concertDate: string;
  rating: number | null;
  reviewText: string;
  aspectRatings: AspectRatings;
};

function initialState(review?: Review): FormState {
  if (!review) {
    return {
      musician: "",
      venue: "",
      concertDate: "",
      rating: null,
      reviewText: "",
      aspectRatings: {},
    };
  }

  const aspectRatings: AspectRatings = {};
  for (const aspect of REVIEW_ASPECTS) {
    aspectRatings[aspect.key] = review[`rating_${aspect.key}`];
  }

  return {
    musician: review.musician,
    venue: review.venue,
    concertDate: review.concert_date,
    rating: review.rating,
    reviewText: review.review_text,
    aspectRatings,
  };
}

function fieldErrorMap(errors: ReviewFieldError[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const error of errors) {
    map[error.field] ??= error.message;
  }
  return map;
}

export default function ReviewForm({
  review,
  onSaved,
  onCancel,
}: {
  /** Absent when writing a new review, present when editing an existing one. */
  review?: Review;
  onSaved: (review: Review) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => initialState(review));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isEdit = Boolean(review);
  // The picker cannot offer a future date in the first place. This is a
  // convenience, not the rule: the same check runs in validate below, in the
  // API route, and in a database trigger.
  const today = todayIsoDate();

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
    // Clearing on edit keeps a message from lingering next to a field the
    // user has already fixed.
    setErrors((previous) => {
      if (!(key in previous)) return previous;
      const next = { ...previous };
      delete next[key as string];
      return next;
    });
  }

  function setAspect(aspect: ReviewAspect, value: number | null) {
    setForm((previous) => ({
      ...previous,
      aspectRatings: { ...previous.aspectRatings, [aspect]: value },
    }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    const payload = {
      musician: form.musician,
      venue: form.venue,
      concertDate: form.concertDate,
      rating: form.rating,
      reviewText: form.reviewText,
      aspectRatings: form.aspectRatings,
    };

    const validation = validateNewReview(payload, today);
    if (!validation.ok) {
      setErrors(fieldErrorMap(validation.errors));
      return;
    }

    setErrors({});
    setSaving(true);

    try {
      const saved = isEdit
        ? await patchReview(review!.id, validation.value)
        : await postReview(validation.value);
      onSaved(saved);
    } catch (err) {
      if (err instanceof ReviewRequestError) {
        // The server may reject something the client accepted - a stale
        // session, or midnight UTC passing between render and submit.
        if (err.fields.length > 0) setErrors(fieldErrorMap(err.fields));
        setFormError(
          err.isAuthError ? "Your session has expired. Please sign in again." : err.message,
        );
      } else {
        setFormError("Something went wrong saving your review. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  const fieldClass = (field: string) =>
    `w-full rounded-lg border bg-muted px-3 py-2 text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary ${
      errors[field] ? "border-red-500" : "border-border"
    }`;

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-lg font-bold" style={{ fontFamily: "'Unbounded', sans-serif" }}>
          {isEdit ? "Edit your review" : "Write a review"}
        </h2>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close"
          className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
        >
          <X size={18} />
        </button>
      </div>

      {formError && (
        <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {formError}
        </p>
      )}

      <Field label="Artist or musician" error={errors.musician} htmlFor="review-musician">
        <input
          id="review-musician"
          value={form.musician}
          onChange={(e) => update("musician", e.target.value)}
          placeholder="Nova Bloom"
          aria-invalid={Boolean(errors.musician)}
          className={fieldClass("musician")}
        />
      </Field>

      <Field label="Venue" error={errors.venue} htmlFor="review-venue">
        <input
          id="review-venue"
          value={form.venue}
          onChange={(e) => update("venue", e.target.value)}
          placeholder="The Granada"
          aria-invalid={Boolean(errors.venue)}
          className={fieldClass("venue")}
        />
      </Field>

      <Field
        label="Concert date"
        error={errors.concertDate}
        htmlFor="review-date"
        hint="You can only review a concert that has already happened."
      >
        <input
          id="review-date"
          type="date"
          value={form.concertDate}
          max={today}
          onChange={(e) => update("concertDate", e.target.value)}
          aria-invalid={Boolean(errors.concertDate)}
          className={fieldClass("concertDate")}
        />
      </Field>

      <Field label="Overall rating" error={errors.rating} hint="Required.">
        <StarRatingInput
          label="Overall rating"
          value={form.rating}
          onChange={(value) => update("rating", value)}
          disabled={saving}
        />
      </Field>

      <fieldset className="rounded-lg border border-border p-4">
        <legend className="px-1 text-sm font-medium text-muted-foreground">
          Rate the details (optional)
        </legend>
        <div className="space-y-3">
          {REVIEW_ASPECTS.map((aspect) => (
            <div
              key={aspect.key}
              className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <span className="text-sm font-medium text-foreground">{aspect.label}</span>
                <span className="ml-2 text-xs text-muted-foreground">{aspect.hint}</span>
              </div>
              <StarRatingInput
                label={aspect.label}
                value={form.aspectRatings[aspect.key] ?? null}
                onChange={(value) => setAspect(aspect.key, value)}
                clearable
                size={18}
                disabled={saving}
              />
            </div>
          ))}
        </div>
        {errors.aspectRatings && (
          <p role="alert" className="mt-2 text-sm text-red-400">
            {errors.aspectRatings}
          </p>
        )}
      </fieldset>

      <Field label="Your review" error={errors.reviewText} htmlFor="review-text">
        <textarea
          id="review-text"
          value={form.reviewText}
          onChange={(e) => update("reviewText", e.target.value)}
          rows={5}
          placeholder="What was the show like?"
          aria-invalid={Boolean(errors.reviewText)}
          className={`${fieldClass("reviewText")} resize-y`}
        />
      </Field>

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-full border border-border bg-muted px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50 cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 cursor-pointer"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          {isEdit ? "Save changes" : "Publish review"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
