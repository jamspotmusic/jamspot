import { Search } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandHeader } from '@/components/brand-header';
import { ReviewCard } from '@/components/review-card';
import { ReviewCardSkeleton } from '@/components/review-card-skeleton';
import { SearchField } from '@/components/search-field';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Radius, ReviewColors, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, getReviews, type Review } from '@/lib/api';

function describeError(err: unknown) {
  return err instanceof ApiError ? err.message : 'Something went wrong loading reviews.';
}

/**
 * Matches apps/web/app/reviews-page/page.tsx's search, which joins artist,
 * venue, city, and state into one string and matches against that - notably
 * *not* the review body, so typing a common word doesn't match every review.
 * The live `/api/reviews` rows carry a free-text `location` and a
 * `short_description` rather than separate artist/venue/city/state columns,
 * so those two stand in for the same set.
 */
export function filterReviews(reviews: Review[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return reviews;
  return reviews.filter((review) =>
    [review.short_description, review.location].join(' ').toLowerCase().includes(normalized),
  );
}

/** The mobile twin of apps/web/app/reviews-page/page.tsx. */
export default function ReviewsScreen() {
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const theme = useTheme();

  useEffect(() => {
    let cancelled = false;
    getReviews()
      .then((data) => {
        if (!cancelled) {
          setReviews(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(describeError(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setReviews(await getReviews());
      setError(null);
    } catch (err) {
      setError(describeError(err));
    }
    setRefreshing(false);
  }, []);

  const filtered = useMemo(() => (reviews ? filterReviews(reviews, query) : []), [reviews, query]);
  const isLoading = !reviews && !error;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.headerBar}>
          {/* Web marks the current page with a filled pill in the nav; the
              tab bar already does that here, so the header carries just the
              brand and the search field. */}
          <BrandHeader>
            <View style={[styles.navPill, { backgroundColor: theme.primary }]}>
              <ThemedText type="small" style={{ color: theme.primaryForeground }}>
                Reviews
              </ThemedText>
            </View>
          </BrandHeader>

          <SearchField
            icon={Search}
            value={searchInput}
            onChangeText={setSearchInput}
            onSubmitEditing={() => setQuery(searchInput)}
            placeholder="Search by artist, venue, or location..."
          />
        </View>

        <FlatList
          data={isLoading ? [] : filtered}
          keyExtractor={(review) => review.id}
          renderItem={({ item }) => <ReviewCard review={item} />}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListHeaderComponent={
            <View style={styles.resultsHeader}>
              <ThemedText type="heading">Reviews</ThemedText>
              <ThemedText type="mono" themeColor="textSecondary">
                {filtered.length} review{filtered.length !== 1 ? 's' : ''}
              </ThemedText>
            </View>
          }
          ListEmptyComponent={
            isLoading ? (
              <View style={styles.skeletonList}>
                {Array.from({ length: 3 }).map((_, index) => (
                  <ReviewCardSkeleton key={index} />
                ))}
              </View>
            ) : error ? (
              <ThemedView type="backgroundElement" style={styles.errorBox}>
                <ThemedText type="small">{error}</ThemedText>
              </ThemedView>
            ) : (
              <Text style={styles.emptyText}>No reviews found.</Text>
            )
          }
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  headerBar: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
    gap: Spacing.two,
  },
  navPill: {
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + Spacing.half,
  },
  listContent: {
    // web: `main` is `p-6` while the header above it is `px-4`.
    paddingHorizontal: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.three,
  },
  resultsHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingTop: Spacing.four,
    // web: `space-y-6` between the heading row and the card list.
    paddingBottom: Spacing.four,
  },
  separator: {
    // web: `space-y-4`
    height: Spacing.three,
  },
  skeletonList: {
    gap: Spacing.three,
  },
  errorBox: {
    borderRadius: Radius.card,
    padding: Spacing.three,
  },
  emptyText: {
    textAlign: 'center',
    fontSize: 14,
    color: ReviewColors.muted,
  },
});
