import { Clock, MapPin, Pencil, Star, ThumbsDown, ThumbsUp, Trash2, User } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type TextLayoutEventData } from 'react-native';

import { RATING_MAX, ratedAspects } from '@jamspot/shared';

import { Radius, ReviewColors, Spacing } from '@/constants/theme';
import type { Review } from '@/lib/api';

// web: `line-clamp-7 sm:line-clamp-5` — a phone gets the 7-line clamp.
const CLAMP_LINES = 7;
// web pairs that clamp with `min-h-[7lh]`, so a card is never shorter than the
// clamp allows and a one-line review doesn't collapse into a stub. `body`'s
// lineHeight is the `lh` unit here.
const BODY_LINE_HEIGHT = 24;
const BODY_MIN_HEIGHT = CLAMP_LINES * BODY_LINE_HEIGHT;

function formatDate(isoDate: string) {
  // isoDate is a date-only string ("2026-08-07"); parsing it directly with
  // `new Date()` treats it as UTC midnight, which renders as the previous
  // day in timezones behind UTC. Building from local components avoids that.
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * The mobile twin of apps/web/components/ReviewCard.tsx. Unlike the rest of
 * the (dark) app, review cards render as a light "paper" card floating on
 * the dark page, and carry the same bands web does: rating + date, a bordered
 * event-info block, the aspect ratings that were scored, the clamped body with
 * a Show more/less toggle, and a footer with the author, the vote buttons, and
 * - for your own reviews - edit and delete.
 *
 * `canManage` only decides whether those two controls are drawn. The API route
 * re-checks ownership on every write and the database's RLS policies refuse it
 * independently, so this is about not offering an action that would fail.
 */
export function ReviewCard({
  review,
  canManage = false,
  onEdit,
  onDelete,
}: {
  review: Review;
  canManage?: boolean;
  onEdit?: (review: Review) => void;
  onDelete?: (review: Review) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [isClamped, setIsClamped] = useState(false);
  // Same three-way toggle web runs: pressing the active side clears the
  // vote, pressing the other side moves it across, and the counts follow.
  const [vote, setVote] = useState<'up' | 'down' | null>(null);
  const [upvotes, setUpvotes] = useState(0);
  const [downvotes, setDownvotes] = useState(0);

  const handleVote = (type: 'up' | 'down') => {
    const counters = { up: setUpvotes, down: setDownvotes };
    const other = type === 'up' ? 'down' : 'up';

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

  const rating = Math.max(0, Math.min(RATING_MAX, Math.round(review.rating)));
  const aspects = ratedAspects(review);
  const edited = review.updated_at !== review.created_at;

  // Web decides whether to show the toggle by comparing the clamped
  // paragraph's scrollHeight to its clientHeight. React Native has no
  // equivalent, so an invisible unclamped copy reports the true line count.
  const measureLines = (event: { nativeEvent: TextLayoutEventData }) => {
    setIsClamped(event.nativeEvent.lines.length > CLAMP_LINES);
  };

  return (
    <View style={styles.card}>
      {/* Rating + date */}
      <View style={styles.header}>
        <View style={styles.stars}>
          {Array.from({ length: RATING_MAX }).map((_, index) => (
            <Star
              key={index}
              size={18}
              color={index < rating ? ReviewColors.star : ReviewColors.starEmpty}
              fill={index < rating ? ReviewColors.star : 'none'}
            />
          ))}
          <Text style={styles.ratingLabel}>
            {review.rating}/{RATING_MAX}
          </Text>
        </View>

        <View style={styles.metaRow}>
          <Clock size={16} color={ReviewColors.muted} />
          <Text style={styles.metaText}>{formatDate(review.concert_date)}</Text>
        </View>
      </View>

      {/* Event info */}
      <View style={styles.eventInfo}>
        <Text style={styles.title}>{review.musician}</Text>
        <View style={[styles.metaRow, styles.eventMeta]}>
          <MapPin size={14} color={ReviewColors.muted} />
          <Text style={styles.metaText}>{review.venue}</Text>
        </View>
      </View>

      {/* Aspect ratings — only the ones this reviewer actually scored */}
      {aspects.length > 0 && (
        <View style={styles.aspects}>
          {aspects.map(({ aspect, label, rating: aspectRating }) => (
            <View
              key={aspect}
              style={styles.aspectRow}
              accessibilityLabel={`${label}: ${aspectRating} out of ${RATING_MAX}`}>
              <Text style={styles.aspectLabel}>{label}</Text>
              <View style={styles.aspectStars}>
                {Array.from({ length: RATING_MAX }).map((_, index) => (
                  <Star
                    key={index}
                    size={13}
                    color={index < aspectRating ? ReviewColors.star : ReviewColors.starEmpty}
                    fill={index < aspectRating ? ReviewColors.star : 'none'}
                  />
                ))}
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Body */}
      <View style={styles.bodyBlock}>
        <Text
          style={[styles.body, !expanded && styles.bodyClamped]}
          numberOfLines={expanded ? undefined : CLAMP_LINES}>
          {review.review_text}
        </Text>

        <Text
          style={[styles.body, styles.measure]}
          onTextLayout={measureLines}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          // The two native props above don't map to anything on react-native-web,
          // so without this the Expo web build announces the body text twice.
          aria-hidden
          pointerEvents="none">
          {review.review_text}
        </Text>

        {isClamped && (
          <Pressable onPress={() => setExpanded((prev) => !prev)} accessibilityRole="button">
            <Text style={styles.showMore}>{expanded ? 'Show less' : 'Show more'}</Text>
          </Pressable>
        )}
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <View style={[styles.metaRow, styles.authorRow]}>
          <User size={18} color={ReviewColors.muted} />
          <Text style={styles.authorText}>{review.user_name}</Text>
          {edited && <Text style={styles.editedText}>· edited</Text>}
        </View>

        <View style={styles.votes}>
          <VoteButton kind="up" count={upvotes} active={vote === 'up'} onPress={() => handleVote('up')} />
          <VoteButton
            kind="down"
            count={downvotes}
            active={vote === 'down'}
            onPress={() => handleVote('down')}
          />

          {canManage && (
            <>
              <Pressable
                onPress={() => onEdit?.(review)}
                accessibilityRole="button"
                accessibilityLabel="Edit review"
                style={({ pressed }) => [
                  styles.voteButton,
                  styles.voteButtonIdle,
                  pressed && styles.pressed,
                ]}>
                <Pencil size={16} color={ReviewColors.muted} />
              </Pressable>

              <Pressable
                onPress={() => onDelete?.(review)}
                accessibilityRole="button"
                accessibilityLabel="Delete review"
                style={({ pressed }) => [
                  styles.voteButton,
                  styles.voteButtonIdle,
                  pressed && styles.pressed,
                ]}>
                <Trash2 size={16} color={ReviewColors.downvoteForeground} />
              </Pressable>
            </>
          )}
        </View>
      </View>
    </View>
  );
}

/**
 * Votes are presentational on both clients: web toggles counts seeded from
 * its mock array and never persists them, and the live `/api/reviews` rows
 * mobile reads carry no vote columns, so these start at zero rather than
 * showing a number the database doesn't have.
 */
function VoteButton({
  kind,
  count,
  active,
  onPress,
}: {
  kind: 'up' | 'down';
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  const Icon = kind === 'up' ? ThumbsUp : ThumbsDown;
  const activeStyle =
    kind === 'up'
      ? { borderColor: ReviewColors.upvoteBorder, backgroundColor: ReviewColors.upvoteBackground }
      : {
          borderColor: ReviewColors.downvoteBorder,
          backgroundColor: ReviewColors.downvoteBackground,
        };
  const activeColor =
    kind === 'up' ? ReviewColors.upvoteForeground : ReviewColors.downvoteForeground;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={kind === 'up' ? 'Upvote review' : 'Downvote review'}
      style={({ pressed }) => [
        styles.voteButton,
        active ? activeStyle : styles.voteButtonIdle,
        pressed && styles.pressed,
      ]}>
      <Icon size={18} color={active ? activeColor : ReviewColors.muted} />
      <Text style={[styles.voteCount, { color: active ? activeColor : ReviewColors.muted }]}>
        {count}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: ReviewColors.background,
    borderColor: ReviewColors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.card,
    padding: Spacing.four,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.three,
  },
  stars: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
  },
  ratingLabel: {
    marginLeft: Spacing.one,
    fontSize: 14,
    fontWeight: '500',
    color: ReviewColors.ratingLabel,
  },
  eventInfo: {
    marginBottom: Spacing.three,
    paddingBottom: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: ReviewColors.border,
  },
  eventMeta: {
    marginTop: Spacing.one,
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    color: ReviewColors.foreground,
  },
  bodyBlock: {
    marginBottom: Spacing.three,
  },
  body: {
    fontSize: 16,
    lineHeight: BODY_LINE_HEIGHT,
    color: ReviewColors.foreground,
  },
  bodyClamped: {
    minHeight: BODY_MIN_HEIGHT,
  },
  measure: {
    position: 'absolute',
    opacity: 0,
    left: 0,
    right: 0,
    top: 0,
  },
  showMore: {
    marginTop: Spacing.two,
    fontSize: 14,
    fontWeight: '500',
    color: ReviewColors.link,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  metaText: {
    fontSize: 14,
    color: ReviewColors.muted,
  },
  authorRow: {
    // web: `gap-2` here, against `gap-1` on the rows inside the card body.
    gap: Spacing.two,
  },
  authorText: {
    fontSize: 16,
    color: ReviewColors.muted,
  },
  editedText: {
    fontSize: 13,
    fontStyle: 'italic',
    color: ReviewColors.muted,
  },
  aspects: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
    marginBottom: Spacing.three,
    paddingBottom: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: ReviewColors.border,
  },
  aspectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  aspectLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: ReviewColors.muted,
  },
  aspectStars: {
    flexDirection: 'row',
  },
  footer: {
    paddingTop: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: ReviewColors.border,
    gap: Spacing.three,
  },
  votes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  voteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  voteButtonIdle: {
    borderColor: ReviewColors.border,
  },
  voteCount: {
    fontSize: 16,
  },
  pressed: {
    opacity: 0.7,
  },
});
