import { Platform, StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?:
    | 'default'
    | 'title'
    | 'small'
    | 'smallBold'
    | 'subtitle'
    | 'link'
    | 'linkPrimary'
    | 'code'
    | 'display'
    | 'heading'
    | 'mono'
    | 'monoSmall'
    | 'monoTiny';
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return (
    <Text
      style={[
        { color: theme[themeColor ?? 'text'] },
        type === 'default' && styles.default,
        type === 'title' && styles.title,
        type === 'small' && styles.small,
        type === 'smallBold' && styles.smallBold,
        type === 'subtitle' && styles.subtitle,
        type === 'link' && styles.link,
        type === 'linkPrimary' && styles.linkPrimary,
        type === 'code' && styles.code,
        type === 'display' && styles.display,
        type === 'heading' && styles.heading,
        type === 'mono' && styles.mono,
        type === 'monoSmall' && styles.monoSmall,
        type === 'monoTiny' && styles.monoTiny,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  small: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 500,
  },
  smallBold: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 700,
  },
  default: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: 500,
  },
  title: {
    fontSize: 48,
    fontWeight: 600,
    lineHeight: 52,
  },
  subtitle: {
    fontSize: 32,
    lineHeight: 44,
    fontWeight: 600,
  },
  link: {
    lineHeight: 30,
    fontSize: 14,
  },
  linkPrimary: {
    lineHeight: 30,
    fontSize: 14,
    color: '#3c87f7',
  },
  code: {
    fontFamily: Fonts.mono,
    fontWeight: Platform.select({ android: 700 }) ?? 500,
    fontSize: 12,
  },
  /**
   * The web app's hero headline: `text-4xl lg:text-6xl uppercase` with
   * `leading-none tracking-tight` (apps/web/app/page.tsx).
   */
  display: {
    fontSize: 36,
    lineHeight: 38,
    fontWeight: 800,
    letterSpacing: -0.5,
  },
  /**
   * Section headings — web renders these at a flat 1rem/bold regardless of
   * the `text-lg` class, because of the inline `fontSize: "1rem"` override.
   */
  heading: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: 800,
  },
  // Web sets `fontFamily: "'DM Mono', monospace"` on every piece of event
  // metadata — dates, times, prices, genre chips, result counts. Neither
  // app loads DM Sans/DM Mono/Unbounded as a webfont, so both fall back to
  // the platform's default sans and monospace faces; using Fonts.mono here
  // reproduces what the browser actually renders.
  mono: {
    fontFamily: Fonts.mono,
    fontSize: 14,
    lineHeight: 20,
  },
  monoSmall: {
    fontFamily: Fonts.mono,
    fontSize: 12,
    lineHeight: 16,
  },
  monoTiny: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    lineHeight: 14,
  },
});
