import { X } from 'lucide-react-native';
import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import {
  REVIEW_ASPECTS,
  todayIsoDate,
  validateNewReview,
  type AspectRatings,
  type Review,
  type ReviewAspect,
  type ReviewFieldError,
} from '@jamspot/shared';

import { StarRatingInput } from '@/components/star-rating-input';
import { ThemedText } from '@/components/themed-text';
import { Radius, ReviewColors, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, createReview, updateReview } from '@/lib/api';

/**
 * The mobile twin of apps/web/components/ReviewForm.tsx, presented as a sheet
 * the way components/auth-modal.tsx and concert-details-modal.tsx are.
 *
 * Create and edit share one component for the same reason they do on web: the
 * ticket requires every creation rule to hold on update too, and one form is
 * the most direct way to guarantee that. Validation calls the same
 * `validateNewReview` the API route calls, so the message shown before
 * submitting is produced by the code that would otherwise reject it.
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
    return { musician: '', venue: '', concertDate: '', rating: null, reviewText: '', aspectRatings: {} };
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
  for (const error of errors) map[error.field] ??= error.message;
  return map;
}

export function ReviewFormModal({
  review,
  onSaved,
  onClose,
}: {
  /** Absent when writing a new review, present when editing an existing one. */
  review?: Review;
  onSaved: (review: Review) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [form, setForm] = useState<FormState>(() => initialState(review));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isEdit = Boolean(review);
  const today = todayIsoDate();

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
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

  const submit = async () => {
    setFormError(null);

    const validation = validateNewReview(
      {
        musician: form.musician,
        venue: form.venue,
        concertDate: form.concertDate,
        rating: form.rating,
        reviewText: form.reviewText,
        aspectRatings: form.aspectRatings,
      },
      today,
    );

    if (!validation.ok) {
      setErrors(fieldErrorMap(validation.errors));
      return;
    }

    setErrors({});
    setSaving(true);

    try {
      const saved = isEdit
        ? await updateReview(review!.id, validation.value)
        : await createReview(validation.value);
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError) {
        // The server may reject something the client accepted - a lapsed
        // session, or midnight UTC passing between render and submit.
        if (err.fields.length > 0) setErrors(fieldErrorMap(err.fields));
        setFormError(err.isAuthError ? 'Your session has expired. Please sign in again.' : err.message);
      } else {
        setFormError('Something went wrong saving your review. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible
      animationType="slide"
      transparent={Platform.OS === 'ios'}
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
      onRequestClose={onClose}>
      <View style={[styles.sheet, { backgroundColor: theme.background }]}>
        <View style={styles.header}>
          <ThemedText type="heading">{isEdit ? 'Edit your review' : 'Write a review'}</ThemedText>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={8}
            style={({ pressed }) => pressed && styles.pressed}>
            <X size={22} color={theme.textSecondary} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {formError && (
            <View style={styles.errorBanner}>
              <ThemedText style={styles.errorText}>{formError}</ThemedText>
            </View>
          )}

          <Field label="Artist or musician" error={errors.musician}>
            <TextInput
              value={form.musician}
              onChangeText={(text) => update('musician', text)}
              placeholder="Nova Bloom"
              placeholderTextColor={theme.textSecondary}
              editable={!saving}
              style={[
                styles.input,
                { color: theme.text, backgroundColor: theme.backgroundElement },
                errors.musician ? styles.inputInvalid : { borderColor: theme.border },
              ]}
            />
          </Field>

          <Field label="Venue" error={errors.venue}>
            <TextInput
              value={form.venue}
              onChangeText={(text) => update('venue', text)}
              placeholder="The Granada"
              placeholderTextColor={theme.textSecondary}
              editable={!saving}
              style={[
                styles.input,
                { color: theme.text, backgroundColor: theme.backgroundElement },
                errors.venue ? styles.inputInvalid : { borderColor: theme.border },
              ]}
            />
          </Field>

          {/* A plain text field rather than a picker: React Native has no
              built-in date input, and the rule that matters is enforced by
              shared validation, the API route, and a database trigger. */}
          <Field
            label="Concert date"
            error={errors.concertDate}
            hint={`YYYY-MM-DD. You can only review a concert that has already happened (on or before ${today}).`}>
            <TextInput
              value={form.concertDate}
              onChangeText={(text) => update('concertDate', text)}
              placeholder={today}
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
              editable={!saving}
              style={[
                styles.input,
                { color: theme.text, backgroundColor: theme.backgroundElement },
                errors.concertDate ? styles.inputInvalid : { borderColor: theme.border },
              ]}
            />
          </Field>

          <Field label="Overall rating" error={errors.rating} hint="Required.">
            <StarRatingInput
              label="Overall rating"
              value={form.rating}
              onChange={(value) => update('rating', value)}
              disabled={saving}
            />
          </Field>

          <View style={[styles.aspectBlock, { borderColor: theme.border }]}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.aspectLegend}>
              Rate the details (optional)
            </ThemedText>
            {REVIEW_ASPECTS.map((aspect) => (
              <View key={aspect.key} style={styles.aspectRow}>
                <View style={styles.aspectLabels}>
                  <ThemedText>{aspect.label}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {aspect.hint}
                  </ThemedText>
                </View>
                <StarRatingInput
                  label={aspect.label}
                  value={form.aspectRatings[aspect.key] ?? null}
                  onChange={(value) => setAspect(aspect.key, value)}
                  clearable
                  size={20}
                  disabled={saving}
                />
              </View>
            ))}
          </View>

          <Field label="Your review" error={errors.reviewText}>
            <TextInput
              value={form.reviewText}
              onChangeText={(text) => update('reviewText', text)}
              placeholder="What was the show like?"
              placeholderTextColor={theme.textSecondary}
              multiline
              numberOfLines={6}
              editable={!saving}
              style={[
                styles.input,
                styles.textArea,
                { color: theme.text, backgroundColor: theme.backgroundElement },
                errors.reviewText ? styles.inputInvalid : { borderColor: theme.border },
              ]}
            />
          </Field>

          <Pressable
            onPress={submit}
            disabled={saving}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.submit,
              { backgroundColor: theme.primary },
              (pressed || saving) && styles.pressed,
            ]}>
            {saving ? (
              <ActivityIndicator color={theme.primaryForeground} />
            ) : (
              <ThemedText style={{ color: theme.primaryForeground }}>
                {isEdit ? 'Save changes' : 'Publish review'}
              </ThemedText>
            )}
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <ThemedText>{label}</ThemedText>
      {children}
      {error ? (
        <ThemedText type="small" style={styles.errorText}>
          {error}
        </ThemedText>
      ) : hint ? (
        <ThemedText type="small" themeColor="textSecondary">
          {hint}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.four,
    paddingBottom: Spacing.three,
  },
  body: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.six,
    gap: Spacing.four,
  },
  field: {
    gap: Spacing.two,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  inputInvalid: {
    borderColor: ReviewColors.downvoteBorder,
  },
  textArea: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
  aspectBlock: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.card,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  aspectLegend: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  aspectRow: {
    gap: Spacing.two,
  },
  aspectLabels: {
    gap: Spacing.half,
  },
  errorBanner: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: ReviewColors.downvoteBorder,
    borderRadius: Radius.control,
    padding: Spacing.three,
  },
  errorText: {
    color: ReviewColors.downvoteForeground,
  },
  submit: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    paddingVertical: Spacing.three,
    minHeight: 48,
  },
  pressed: {
    opacity: 0.7,
  },
});
