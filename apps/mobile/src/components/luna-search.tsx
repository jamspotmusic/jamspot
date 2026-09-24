import { Search, Sparkles } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import {
  classifySearchQuery,
  resolveConcertSearch,
  type NormalizedConcert,
  type ResolvedConcertSearch,
} from '@jamspot/shared';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, apiFetch } from '@/lib/api';
import { invokeConcertQuery, requestDeviceLocation } from '@/lib/luna';

/** The one search field the app has. */
export const SEARCH_PLACEHOLDER = 'Ask Luna, or type a state...';

/**
 * The mobile twin of apps/web/components/LunaSearch.tsx, and the app's only
 * search field (TEA-51).
 *
 * `resolveConcertSearch` decides what a line of text is: a bare state goes
 * straight to Ticketmaster, anything else goes through the `concert-query`
 * Edge Function, and anything that isn't a search is refused here without a
 * request being sent. All three end at the same /api/concerts route the
 * screen already renders from.
 *
 * Styling follows components/search-field.tsx, so the field looks the same as
 * the two it replaced.
 */
export function LunaSearch({
  value,
  onChangeValue,
  onSearchStart,
  onSearchSuccess,
  onSearchError,
}: {
  value: string;
  onChangeValue: (value: string) => void;
  /** Fired once a search is definitely running, so the screen can reset its
   *  own filters and show its loading state. */
  onSearchStart: (interpretation?: string) => void;
  /** `search` is the /api/concerts query string, kept so pull-to-refresh can
   *  re-run exactly the search that is on screen. */
  onSearchSuccess: (concerts: NormalizedConcert[], search: string) => void;
  onSearchError: (message: string) => void;
}) {
  const theme = useTheme();
  const [isSearching, setIsSearching] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);

  // A bare state skips the Edge Function, so the button shouldn't offer to
  // ask Luna when nothing will be asked of her.
  const isStateSearch = classifySearchQuery(value).kind === 'state';

  const submit = async () => {
    setIsSearching(true);
    setInputError(null);

    let resolved: ResolvedConcertSearch;

    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

      resolved = await resolveConcertSearch(
        value,
        timeZone,
        invokeConcertQuery,
        requestDeviceLocation,
      );
    } catch (error) {
      // Nothing has been searched yet - a refused query, an out-of-scope one,
      // or a Luna failure. It belongs under the field rather than in place of
      // results the user may still be looking at.
      setIsSearching(false);
      setInputError(error instanceof Error ? error.message : 'Concert search failed.');
      return;
    }

    setIsSearching(false);
    onSearchStart(resolved.interpretation);

    try {
      const { concerts } = await apiFetch<{ concerts: NormalizedConcert[] }>(
        `/api/concerts?${resolved.search}`,
      );
      onSearchSuccess(concerts ?? [], resolved.search);
    } catch (error) {
      onSearchError(
        error instanceof ApiError ? error.message : 'Failed to load concerts.',
      );
    }
  };

  return (
    <View style={styles.wrapper}>
      <View style={styles.row}>
        <View
          style={[
            styles.field,
            { backgroundColor: theme.backgroundElement, borderColor: theme.border },
          ]}>
          {isStateSearch ? (
            <Search size={15} color={theme.textSecondary} />
          ) : (
            <Sparkles size={15} color={theme.primary} />
          )}
          <TextInput
            value={value}
            onChangeText={onChangeValue}
            onSubmitEditing={submit}
            editable={!isSearching}
            accessibilityLabel="Search concerts"
            placeholder={SEARCH_PLACEHOLDER}
            placeholderTextColor={theme.textSecondary}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            style={[styles.input, { color: theme.text }]}
          />
        </View>

        <Pressable
          onPress={submit}
          disabled={isSearching}
          accessibilityRole="button"
          accessibilityLabel="Search concerts"
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: theme.primary },
            (pressed || isSearching) && styles.pressed,
          ]}>
          {isSearching ? (
            <ActivityIndicator size="small" color={theme.primaryForeground} />
          ) : (
            <ThemedText style={[styles.buttonText, { color: theme.primaryForeground }]}>
              {isStateSearch ? 'Search' : 'Ask'}
            </ThemedText>
          )}
        </Pressable>
      </View>

      {inputError && (
        <ThemedText type="small" style={styles.error}>
          {inputError}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three - Spacing.one,
    paddingVertical: Spacing.two,
  },
  input: {
    flex: 1,
    fontSize: 14,
    padding: 0,
  },
  button: {
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two + Spacing.half,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 68,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.7,
  },
  error: {
    color: '#fca5a5',
  },
});
