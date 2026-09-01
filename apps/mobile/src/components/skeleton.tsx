import { useEffect } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const PULSE_DURATION = 1000;

/**
 * One shimmering placeholder bar. Reproduces Tailwind's `animate-pulse`,
 * which the web app's `EventCardSkeleton` and `ReviewCardSkeleton` use:
 * opacity eased between 1 and 0.5 on a two-second cycle.
 */
export function SkeletonBar({
  width,
  height,
  color,
  style,
}: {
  width?: ViewStyle['width'];
  height: number;
  color?: string;
  style?: ViewStyle;
}) {
  const theme = useTheme();
  const opacity = useSharedValue(1);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(0.5, { duration: PULSE_DURATION, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [opacity]);

  const pulseStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        styles.bar,
        { width, height, backgroundColor: color ?? theme.backgroundElement },
        pulseStyle,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  bar: {
    borderRadius: Radius.badge,
  },
});
