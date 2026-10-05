import { PenLine, Search } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { isReviewOwner } from '@jamspot/shared';

import { AuthButton } from '@/components/auth-button';
import { BrandHeader } from '@/components/brand-header';
import { ReviewCard } from '@/components/review-card';
import { ReviewCardSkeleton } from '@/components/review-card-skeleton';
import { ReviewFormModal } from '@/components/review-form-modal';
import { SearchField } from '@/components/search-field';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Radius, ReviewColors, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, deleteReview, getReviews, type Review } from '@/lib/api';

function describeError(err: unknown) {
  return err instanceof ApiError ? err.message : 'Something went wrong loading reviews.';
}

/**
 * Matches apps/web/app/reviews-page/page.tsx's search: artist, venue, and
 * author are searchable, but the review body deliberately is not - otherwise
 * a common word matches nearly every review.
 */
export function filterReviews(reviews: Review[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return reviews;
  return reviews.filter((review) =>
    [review.musician, review.venue, review.user_name].join(' ').toLowerCase().includes(normalized),
  );
}

/** The mobile twin of apps/web/app/reviews-page/page.tsx. */
export default function ReviewsScreen() {
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  // Which form is open: nothing, a new review, or an existing one.
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<Review | null>(null);
  const theme = useTheme();
  const { status, user } = useAuth();

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

  const handleSaved = useCallback((saved: Review) => {
    setReviews((previous) => {
      if (!previous) return [saved];
      const existing = previous.findIndex((review) => review.id === saved.id);
      if (existing === -1) return [saved, ...previous];
      return previous.map((review) => (review.id === saved.id ? saved : review));
    });
    setComposing(false);
    setEditing(null);
  }, []);

  /**
   * Deleting is permanent, so it takes a second, explicit action - the native
   * equivalent of the confirmation dialog the web app opens.
   */
  const confirmDelete = useCallback((review: Review) => {
    Alert.alert(
      'Delete this review?',
      `Your review of ${review.musician} at ${review.venue} will be permanently removed. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteReview(review.id);
              setReviews((previous) =>
                previous ? previous.filter((item) => item.id !== review.id) : previous,
              );
            } catch (err) {
              setError(describeError(err));
            }
          },
        },
      ],
    );
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
            <View style={styles.navGroup}>
              <View style={[styles.navPill, { backgroundColor: theme.primary }]}>
                <ThemedText type="small" style={{ color: theme.primaryForeground }}>
                  Reviews
                </ThemedText>
              </View>
              <AuthButton />
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
          renderItem={({ item }) => (
            <ReviewCard
              review={item}
              canManage={isReviewOwner(item, user?.id)}
              onEdit={(target) => {
                setComposing(false);
                setEditing(target);
              }}
              onDelete={confirmDelete}
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListHeaderComponent={
            <View style={styles.resultsHeader}>
              <ThemedText type="heading">Reviews</ThemedText>
              <View style={styles.resultsActions}>
                <ThemedText type="mono" themeColor="textSecondary">
                  {filtered.length} review{filtered.length !== 1 ? 's' : ''}
                </ThemedText>
                {/* Writing needs an account. Signed-out visitors get no button
                    rather than one that would fail on submit; the header's
                    AuthButton is how they sign in. */}
                {status === 'authenticated' && (
                  <Pressable
                    onPress={() => {
                      setEditing(null);
                      setComposing(true);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Write a review"
                    style={({ pressed }) => [
                      styles.writeButton,
                      { backgroundColor: theme.primary },
                      pressed && styles.pressed,
                    ]}>
                    <PenLine size={14} color={theme.primaryForeground} />
                    <ThemedText type="small" style={{ color: theme.primaryForeground }}>
                      Write
                    </ThemedText>
                  </Pressable>
                )}
              </View>
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

      {(composing || editing) && (
        <ReviewFormModal
          review={editing ?? undefined}
          onSaved={handleSaved}
          onClose={() => {
            setComposing(false);
            setEditing(null);
          }}
        />
      )}
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
  navGroup: {
    flexDirection: 'row',
    alignItems: 'center',
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
  resultsActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  writeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + Spacing.half,
  },
  pressed: {
    opacity: 0.7,
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
