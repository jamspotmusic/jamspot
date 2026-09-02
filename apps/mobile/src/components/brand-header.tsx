import { Music2 } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Mirrors the brand mark in apps/web's sticky header (violet rounded square
 * + Music2 icon + "JAMSPOT" wordmark), including the bottom border that
 * separates the header from the page below it.
 */
export function BrandHeader({ children }: { children?: React.ReactNode }) {
  const theme = useTheme();

  return (
    <View style={[styles.header, { borderBottomColor: theme.border }]}>
      <View style={styles.row}>
        <View style={[styles.mark, { backgroundColor: theme.primary }]}>
          <Music2 size={14} color={theme.primaryForeground} />
        </View>
        <ThemedText style={styles.wordmark}>JAMSPOT</ThemedText>
      </View>

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    // web: brand and nav sit together in one `flex items-center gap-6` group.
    gap: Spacing.four,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  mark: {
    width: 28,
    height: 28,
    borderRadius: Radius.mark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: {
    fontSize: 14,
    fontWeight: '700',
    // web: `tracking-widest` overridden to letterSpacing: "0.12em" at 14px.
    letterSpacing: 1.7,
  },
});
