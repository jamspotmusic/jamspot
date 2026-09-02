import { StyleSheet, View } from 'react-native';

import { SkeletonBar } from '@/components/skeleton';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Mirrors apps/web/app/page.tsx's `EventCardSkeleton`. */
export function ConcertCardSkeleton() {
  const theme = useTheme();

  return (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <SkeletonBar height={176} width="100%" style={styles.image} />

      <View style={styles.body}>
        <SkeletonBar height={16} width="75%" />
        <SkeletonBar height={12} width="100%" />
        <SkeletonBar height={12} width="66%" />

        <View style={styles.footer}>
          <SkeletonBar height={16} width={80} />
          <SkeletonBar height={32} width={112} style={styles.button} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  image: {
    borderRadius: 0,
  },
  body: {
    padding: Spacing.three,
    gap: Spacing.three,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing.two,
  },
  button: {
    borderRadius: Radius.control,
  },
});
