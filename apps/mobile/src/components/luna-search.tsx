import { Sparkles } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import {
  buildConcertsQuery,
  interpretConcertQuery,
  type ConcertQueryResponse,
  type NormalizedConcert,
} from '@jamspot/shared';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, apiFetch } from '@/lib/api';
import { invokeConcertQuery, requestDeviceLocation } from '@/lib/luna';

/**
 * The mobile twin of apps/web/components/LunaSearch.tsx: a natural-language
 * concert search that goes through the `concert-query` Edge Function and then
 * hands the structured result to the same /api/concerts route the keyword
 * search already uses, so results render through the existing card list.
 *
 * Styling follows components/search-field.tsx so the two inputs read as one
 * search area rather than a bolted-on second control.
 */
export function LunaSearch({
  onSearchStart,
  onSearchSuccess,
  onSearchError,
}: {
  /** Fired before the concert request begins, so the screen can reset its
   *  own filters and show its loading state. */
  onSearchStart: (interpretation?: string) => void;
  onSearchSuccess: (concerts: NormalizedConcert[]) => void;
  onSearchError: (message: string) => void;
}) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [isInterpreting, setIsInterpreting] = useState(false);
  const [interpretError, setInterpretError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = query.trim();

    if (!trimmed) {
      setInterpretError("Describe the kind of show you're looking for.");
      return;
    }

    setIsInterpreting(true);
    setInterpretError(null);

    let result: ConcertQueryResponse;

    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

      result = await interpretConcertQuery(
        invokeConcertQuery,
        trimmed,
        timeZone,
        requestDeviceLocation,
      );
    } catch (error) {
      setIsInterpreting(false);
      setInterpretError(
        error instanceof Error ? error.message : 'Concert query failed.',
      );
      return;
    }

    setIsInterpreting(false);
    onSearchStart(result.interpretation);

    try {
      const search = buildConcertsQuery(result.ticketmasterParams, result.filters);
      const { concerts } = await apiFetch<{ concerts: NormalizedConcert[] }>(
        `/api/concerts?${search}`,
      );
      onSearchSuccess(concerts ?? []);
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
          <Sparkles size={15} color={theme.primary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={submit}
            editable={!isInterpreting}
            placeholder="Ask Luna: chill jazz under $60..."
            placeholderTextColor={theme.textSecondary}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            style={[styles.input, { color: theme.text }]}
          />
        </View>

        <Pressable
          onPress={submit}
          disabled={isInterpreting}
          accessibilityRole="button"
          accessibilityLabel="Ask Luna"
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: theme.primary },
            (pressed || isInterpreting) && styles.pressed,
          ]}>
          {isInterpreting ? (
            <ActivityIndicator size="small" color={theme.primaryForeground} />
          ) : (
            <ThemedText style={[styles.buttonText, { color: theme.primaryForeground }]}>
              Ask
            </ThemedText>
          )}
        </Pressable>
      </View>

      {interpretError && (
        <ThemedText type="small" style={styles.error}>
          {interpretError}
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