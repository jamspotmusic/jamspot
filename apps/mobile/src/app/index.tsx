import { MapPin, Music2, Search } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { openBrowserAsync } from 'expo-web-browser';

import { AuthButton } from '@/components/auth-button';
import { BrandHeader } from '@/components/brand-header';
import { ConcertCard } from '@/components/concert-card';
import { ConcertCardSkeleton } from '@/components/concert-card-skeleton';
import { ConcertDetailsModal } from '@/components/concert-details-modal';
import { Hero } from '@/components/hero';
import { LunaSearch } from '@/components/luna-search';
import { SearchField } from '@/components/search-field';
import { SiteFooter } from '@/components/site-footer';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  BottomTabInset,
  CardsPerLoad,
  InitialCardLimit,
  Radius,
  Spacing,
} from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api';
import type { NormalizedConcert } from '@jamspot/shared';
import {
  buildConcertSearchParams,
  filterCardEvents,
  isCompleteCardEvent,
  searchConcerts,
  toCardEvent,
  type CardEvent,
} from '@/lib/concerts';

function describeError(err: unknown) {
  return err instanceof ApiError ? err.message : 'Failed to load concerts.';
}

/**
 * The mobile twin of apps/web/app/page.tsx: the hero until a search has been
 * submitted, then genre chips, a result count, and the paged card list.
 */
export default function HomeScreen() {
  const [keywordInput, setKeywordInput] = useState('');
  const [locationInput, setLocationInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [location, setLocation] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [activeGenre, setActiveGenre] = useState('All');
  const [visibleCount, setVisibleCount] = useState(InitialCardLimit);

  const [events, setEvents] = useState<CardEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CardEvent | null>(null);
  
  // Luna's one-line description of the search it built (TEA-47), shown above
  // the results so the user can see how their words were read.
  const [lunaInterpretation, setLunaInterpretation] = useState<string | null>(null);
  const theme = useTheme();

  // Fetches whenever a search is submitted. Only ever sets state inside
  // .then()/.catch() (never synchronously in the effect body) to satisfy
  // this project's react-hooks/set-state-in-effect rule.
  useEffect(() => {
    if (!hasSearched) return;
    if (!keyword && !location) return;

    let cancelled = false;
    searchConcerts(buildConcertSearchParams(keyword, location))
      .then((concerts) => {
        if (!cancelled) {
          setEvents(concerts.map(toCardEvent));
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setFetchError(describeError(err));
          setEvents([]);
          setIsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [hasSearched, keyword, location]);

  // Genres available, derived from the fetched events so the chips only ever
  // show options that actually have results.
  const genres = useMemo(
    () => ['All', ...new Set(events.map((e) => e.genre).filter(Boolean))],
    [events],
  );

  const handleSearch = useCallback(() => {
    const query = keywordInput.trim();
    const loc = locationInput.trim();

    setKeyword(query);
    setLocation(loc);
    setHasSearched(true);
    setVisibleCount(InitialCardLimit);
    setIsLoading(true);
    setFetchError(null);
    setLunaInterpretation(null);
    // Web pre-selects a genre chip when the query names one of the genres
    // it already knows about, so "jazz" lands on the Jazz filter.
    const matchedGenre = genres.find(
      (genre) => genre !== 'All' && query.toLowerCase().includes(genre.toLowerCase()),
    );
    setActiveGenre(matchedGenre ?? 'All');
  }, [genres, keywordInput, locationInput]);

  const onRefresh = useCallback(async () => {
    if (!keyword && !location) return;
    setRefreshing(true);
    try {
      const concerts = await searchConcerts(buildConcertSearchParams(keyword, location));
      setEvents(concerts.map(toCardEvent));
      setFetchError(null);
    } catch (err) {
      setFetchError(describeError(err));
    }
    setRefreshing(false);
  }, [keyword, location]);

  const handleTicketPress = useCallback((event: CardEvent) => {
    if (!event.ticketUrl) return;
    openBrowserAsync(event.ticketUrl);
  }, []);

  const handleGenrePress = useCallback((genre: string) => {
    setActiveGenre(genre);
    setVisibleCount(InitialCardLimit);
  }, []);

  const handleLoadMore = useCallback(() => {
    setIsLoadingMore(true);
    // Future API pagination here — for now the extra cards are already
    // in memory, same as web.
    setVisibleCount((prev) => prev + CardsPerLoad);
    setIsLoadingMore(false);
  }, []);
  // Luna drives the same state the keyword search does, so results render
  // through the existing FlatList, skeletons, and empty/error states. The
  // keyword/location inputs are cleared so the local filterCardEvents pass
  // can't narrow Luna's results by stale text.
  const handleLunaStart = useCallback((interpretation?: string) => {
    setKeywordInput('');
    setLocationInput('');
    setKeyword('');
    setLocation('');
    setActiveGenre('All');
    setVisibleCount(InitialCardLimit);
    setEvents([]);
    setFetchError(null);
    setLunaInterpretation(interpretation ?? null);
    setHasSearched(true);
    setIsLoading(true);
  }, []);

  const handleLunaSuccess = useCallback((concerts: NormalizedConcert[]) => {
    setEvents(concerts.map(toCardEvent));
    setIsLoading(false);
  }, []);

  const handleLunaError = useCallback((message: string) => {
    setFetchError(message);
    setEvents([]);
    setIsLoading(false);
  }, []);

  const filtered = useMemo(
    () => filterCardEvents(events, keyword, location, activeGenre),
    [events, keyword, location, activeGenre],
  );

  // Web only renders cards it can fill in completely, so a half-populated
  // Ticketmaster record never shows up as a card with holes in it.
  const visibleCards = useMemo(
    () => filtered.slice(0, visibleCount).filter(isCompleteCardEvent),
    [filtered, visibleCount],
  );

  const showResults = hasSearched && !isLoading && !fetchError;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.headerBar}>
          <BrandHeader>
            <AuthButton />
          </BrandHeader>
          <LunaSearch
            onSearchStart={handleLunaStart}
            onSearchSuccess={handleLunaSuccess}
            onSearchError={handleLunaError}
          />
          <View style={styles.searchRow}>
            <SearchField
              icon={Search}
              value={keywordInput}
              onChangeText={setKeywordInput}
              onSubmitEditing={handleSearch}
              placeholder="Artist, venue, event, or genre..."
            />
            <SearchField
              icon={MapPin}
              value={locationInput}
              onChangeText={setLocationInput}
              onSubmitEditing={handleSearch}
              placeholder="City or state"
            />
            <Pressable
              onPress={handleSearch}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.searchButton,
                { backgroundColor: theme.primary },
                pressed && styles.pressed,
              ]}>
              <ThemedText style={[styles.searchButtonText, { color: theme.primaryForeground }]}>
                Search
              </ThemedText>
            </Pressable>
          </View>
        </View>

        {!hasSearched ? (
          <ScrollView contentContainerStyle={styles.heroScroll}>
            <Hero />
            <View style={styles.gutter}>
              <SiteFooter />
            </View>
          </ScrollView>
        ) : (
          <FlatList
            data={showResults ? visibleCards : []}
            keyExtractor={(event) => event.id}
            renderItem={({ item }) => (
              <ConcertCard
                event={item}
                onPress={setSelectedEvent}
                onTicketPress={handleTicketPress}
              />
            )}
            ItemSeparatorComponent={() => <View style={styles.cardSeparator} />}
            contentContainerStyle={styles.listContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            ListHeaderComponent={
              showResults && events.length > 0 ? (
                <View style={styles.resultsHeader}>
                  <View style={styles.genreRow}>
                    {genres.map((genre) => {
                      const active = activeGenre === genre;
                      return (
                        <Pressable
                          key={genre}
                          onPress={() => handleGenrePress(genre)}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          style={({ pressed }) => [
                            styles.genreChip,
                            {
                              backgroundColor: active ? theme.primary : theme.backgroundElement,
                              borderColor: active ? theme.primary : theme.border,
                            },
                            pressed && styles.pressed,
                          ]}>
                          <ThemedText
                            type="monoSmall"
                            style={active ? { color: theme.primaryForeground } : undefined}
                            themeColor={active ? undefined : 'textSecondary'}>
                            {genre}
                          </ThemedText>
                        </Pressable>
                      );
                    })}
                  </View>

                  <View style={styles.resultsTitleRow}>
                    <ThemedText type="heading">
                      {activeGenre === 'All' ? 'Upcoming Shows' : activeGenre}
                    </ThemedText>
                    <ThemedText type="mono" themeColor="textSecondary">
                      {filtered.length} event{filtered.length !== 1 ? 's' : ''}
                    </ThemedText>
                  </View>

                  {lunaInterpretation && (
                    <ThemedText type="small" themeColor="textSecondary">
                      {lunaInterpretation}
                    </ThemedText>
                  )}
                </View>
              ) : null
            }
            ListEmptyComponent={
              isLoading ? (
                <View style={styles.skeletonList}>
                  {Array.from({ length: InitialCardLimit }).map((_, index) => (
                    <ConcertCardSkeleton key={index} />
                  ))}
                </View>
              ) : fetchError ? (
                <EmptyState message={fetchError} />
              ) : filtered.length === 0 ? (
                <EmptyState message="No shows found. Try a different search." />
              ) : (
                // Matches are in hand but none of them survived
                // isCompleteCardEvent. Web renders an empty grid here rather
                // than the "no shows" message, since it keys that message off
                // the filtered count too.
                null
              )
            }
            ListFooterComponent={
              <View>
                {isLoadingMore && (
                  <View style={styles.skeletonList}>
                    <ConcertCardSkeleton />
                  </View>
                )}
                {showResults && visibleCount < filtered.length && (
                  <View style={styles.loadMoreRow}>
                    <Pressable
                      onPress={handleLoadMore}
                      disabled={isLoadingMore}
                      accessibilityRole="button"
                      style={({ pressed }) => [
                        styles.loadMoreButton,
                        {
                          backgroundColor: pressed ? theme.primary : theme.backgroundElement,
                          borderColor: pressed ? theme.primary : 'rgba(139, 92, 246, 0.4)',
                        },
                      ]}>
                      <ThemedText type="small">
                        {isLoadingMore ? 'Loading...' : 'Show more'}
                      </ThemedText>
                    </Pressable>
                  </View>
                )}
                <SiteFooter />
              </View>
            }
          />
        )}
      </SafeAreaView>

      {selectedEvent && (
        <ConcertDetailsModal
          key={selectedEvent.id}
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </ThemedView>
  );
}

/** Web's centred Music2 glyph over a one-line message. */
function EmptyState({ message }: { message: string }) {
  const theme = useTheme();

  return (
    <View style={styles.emptyState}>
      <Music2 size={40} color={theme.textSecondary} style={styles.emptyIcon} />
      <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
        {message}
      </ThemedText>
    </View>
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
  searchRow: {
    gap: Spacing.two,
  },
  searchButton: {
    borderRadius: Radius.control,
    paddingVertical: Spacing.two + Spacing.half,
    alignItems: 'center',
  },
  searchButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  gutter: {
    paddingHorizontal: Spacing.three,
  },
  heroScroll: {
    paddingBottom: BottomTabInset + Spacing.three,
  },
  listContent: {
    paddingHorizontal: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.three,
  },
  resultsHeader: {
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
    gap: Spacing.three,
  },
  genreRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  genreChip: {
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + Spacing.half,
  },
  resultsTitleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  cardSeparator: {
    height: Spacing.two + Spacing.one,
  },
  skeletonList: {
    gap: Spacing.two + Spacing.one,
    paddingTop: Spacing.three,
  },
  loadMoreRow: {
    marginTop: Spacing.four,
    alignItems: 'center',
  },
  loadMoreButton: {
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two + Spacing.half,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: Spacing.six,
    gap: Spacing.three,
  },
  emptyIcon: {
    opacity: 0.4,
  },
  emptyText: {
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
