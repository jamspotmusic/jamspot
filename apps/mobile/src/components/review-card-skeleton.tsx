import { StyleSheet, View } from 'react-native';

import { SkeletonBar } from '@/components/skeleton';
import { Radius, ReviewColors, Spacing } from '@/constants/theme';

const PLACEHOLDER = '#e5e7eb';

/** Mirrors apps/web/components/ReviewCardSkeleton.tsx. */
export function ReviewCardSkeleton() {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <SkeletonBar height={20} width={112} color={PLACEHOLDER} />
        <SkeletonBar height={16} width={96} color={PLACEHOLDER} />
      </View>

      <View style={styles.eventInfo}>
        <SkeletonBar height={24} width={192} color={PLACEHOLDER} />
        <SkeletonBar height={16} width={224} color={PLACEHOLDER} style={styles.eventMeta} />
      </View>

      <View style={styles.body}>
        <SkeletonBar height={16} width="100%" color={PLACEHOLDER} />
        <SkeletonBar height={16} width="100%" color={PLACEHOLDER} />
        <SkeletonBar height={16} width="75%" color={PLACEHOLDER} />
      </View>

      <View style={styles.footer}>
        <SkeletonBar height={16} width={128} color={PLACEHOLDER} />
        <View style={styles.votes}>
          <SkeletonBar height={36} width={80} color={PLACEHOLDER} style={styles.voteButton} />
          <SkeletonBar height={36} width={80} color={PLACEHOLDER} style={styles.voteButton} />
        </View>
      </View>
    </View>
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
    justifyContent: 'space-between',
    marginBottom: Spacing.three,
  },
  eventInfo: {
    marginBottom: Spacing.three,
    paddingBottom: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: ReviewColors.border,
  },
  eventMeta: {
    marginTop: Spacing.two,
  },
  body: {
    gap: Spacing.two,
  },
  footer: {
    marginTop: Spacing.four,
    paddingTop: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: ReviewColors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  votes: {
    flexDirection: 'row',
    gap: Spacing.two + Spacing.one,
  },
  voteButton: {
    borderRadius: Radius.control,
  },
});
