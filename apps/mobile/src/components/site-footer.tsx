import { Music2 } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Mirrors the footer at the bottom of apps/web/app/page.tsx: a dimmed
 * brand mark on the left and the copyright line on the right, separated
 * from the content by a top border.
 */
export function SiteFooter() {
  const theme = useTheme();
  const currentYear = new Date().getFullYear();

  return (
    <View style={[styles.footer, { borderTopColor: theme.border }]}>
      <View style={styles.brand}>
        <View style={[styles.mark, { backgroundColor: 'rgba(139, 92, 246, 0.3)' }]}>
          <Music2 size={10} color={theme.primary} />
        </View>
        <ThemedText type="monoSmall" themeColor="textSecondary" style={styles.wordmark}>
          JAMSPOT
        </ThemedText>
      </View>

      <ThemedText type="monoSmall" themeColor="textSecondary">
        © {currentYear} · Events are updated daily
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    marginTop: Spacing.six,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.four,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    gap: Spacing.three,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  mark: {
    width: 20,
    height: 20,
    borderRadius: Spacing.half,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: {
    letterSpacing: 2,
  },
});
