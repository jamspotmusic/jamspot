import { Star, X } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { RATING_MAX, RATING_MIN } from '@jamspot/shared';

import { Radius, ReviewColors, Spacing } from '@/constants/theme';

/**
 * The mobile twin of apps/web/components/StarRatingInput.tsx: a 1-5 picker
 * used for both the required overall rating and the optional aspect ones.
 *
 * Tapping the already-selected star clears it when `clearable` is set, which
 * is how an optional aspect returns to "not rated" - a state distinct from
 * rating it 1. The explicit clear button beside it does the same thing
 * discoverably, since "tap it again" is not obvious.
 */
export function StarRatingInput({
  value,
  onChange,
  label,
  clearable = false,
  size = 28,
  disabled = false,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  label: string;
  clearable?: boolean;
  size?: number;
  disabled?: boolean;
}) {
  const stars = Array.from({ length: RATING_MAX - RATING_MIN + 1 }, (_, i) => RATING_MIN + i);

  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {stars.map((star) => {
        const filled = star <= (value ?? 0);
        return (
          <Pressable
            key={star}
            disabled={disabled}
            onPress={() => onChange(clearable && value === star ? null : star)}
            accessibilityRole="radio"
            accessibilityState={{ selected: value === star, disabled }}
            accessibilityLabel={`${label}: ${star} ${star === 1 ? 'star' : 'stars'}`}
            hitSlop={4}
            style={({ pressed }) => [styles.star, pressed && styles.pressed]}>
            <Star
              size={size}
              color={filled ? ReviewColors.star : ReviewColors.starEmpty}
              fill={filled ? ReviewColors.star : 'none'}
            />
          </Pressable>
        );
      })}

      <Text style={styles.label}>{value ? `${value}/${RATING_MAX}` : '–'}</Text>

      {clearable && value !== null && !disabled && (
        <Pressable
          onPress={() => onChange(null)}
          accessibilityRole="button"
          accessibilityLabel={`Clear ${label}`}
          hitSlop={8}
          style={({ pressed }) => [styles.clear, pressed && styles.pressed]}>
          <X size={14} color={ReviewColors.muted} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
  },
  star: {
    padding: Spacing.half,
  },
  label: {
    marginLeft: Spacing.two,
    minWidth: 34,
    fontSize: 14,
    color: ReviewColors.ratingLabel,
  },
  clear: {
    padding: Spacing.one,
    borderRadius: Radius.badge,
  },
  pressed: {
    opacity: 0.6,
  },
});
