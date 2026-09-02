import { useId } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

export type GradientStop = {
  /** 0 = start of the gradient, 1 = end. */
  offset: number;
  color: string;
  opacity: number;
};

/**
 * A gradient laid over an image, the way the web app's cards, modal, and
 * hero do it (`bg-gradient-to-t from-card via-card/30 to-transparent`).
 *
 * Drawn with react-native-svg rather than `experimental_backgroundImage`
 * so it renders identically on iOS, Android, and the Expo web build —
 * react-native-web has no support for that style property.
 */
export function GradientOverlay({
  direction,
  stops,
  style,
}: {
  direction: 'to top' | 'to right';
  stops: GradientStop[];
  style?: ViewStyle;
}) {
  // useId's output contains ":" characters, which aren't valid in an SVG
  // fragment identifier.
  const gradientId = `gradient-${useId().replace(/:/g, '')}`;
  const axis =
    direction === 'to top'
      ? { x1: '0', y1: '1', x2: '0', y2: '0' }
      : { x1: '0', y1: '0', x2: '1', y2: '0' };

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={gradientId} {...axis}>
            {stops.map((stop) => (
              <Stop
                key={stop.offset}
                offset={stop.offset}
                stopColor={stop.color}
                stopOpacity={stop.opacity}
              />
            ))}
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${gradientId})`} />
      </Svg>
    </View>
  );
}

/**
 * `from-card via-card/30 to-transparent`, the fade every concert image
 * uses to blend into the card body underneath it.
 */
export const CardImageGradient: GradientStop[] = [
  { offset: 0, color: '#0f0f1e', opacity: 1 },
  { offset: 0.5, color: '#0f0f1e', opacity: 0.3 },
  { offset: 1, color: '#0f0f1e', opacity: 0 },
];

/** `from-background via-background/60 to-transparent` on the hero. */
export const HeroVerticalGradient: GradientStop[] = [
  { offset: 0, color: '#07070f', opacity: 1 },
  { offset: 0.5, color: '#07070f', opacity: 0.6 },
  { offset: 1, color: '#07070f', opacity: 0 },
];

/** `from-background/90 via-transparent to-transparent` on the hero. */
export const HeroHorizontalGradient: GradientStop[] = [
  { offset: 0, color: '#07070f', opacity: 0.9 },
  { offset: 0.5, color: '#07070f', opacity: 0 },
  { offset: 1, color: '#07070f', opacity: 0 },
];
