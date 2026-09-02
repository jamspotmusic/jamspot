import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import {
  GradientOverlay,
  HeroHorizontalGradient,
  HeroVerticalGradient,
} from '@/components/gradient-overlay';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

/**
 * The landing state of apps/web/app/page.tsx: a dimmed concert photo under
 * two gradients with the "Find your next Jam" headline centred on top.
 * Shown until the first search, exactly as on web.
 */
const HERO_IMAGE_URL =
  'https://images.unsplash.com/photo-1470229538611-16ba8c7ffbd7?q=80&w=1470&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D';

export function Hero() {
  return (
    <View style={styles.hero}>
      <Image
        source={{ uri: HERO_IMAGE_URL }}
        style={[StyleSheet.absoluteFill, styles.image]}
        contentFit="cover"
        transition={300}
        accessibilityLabel="Massive Attack"
      />

      {/* Same two overlays web stacks: a bottom-up fade into the page
          background, then a left-to-right fade for the headline. */}
      <GradientOverlay direction="to top" stops={HeroVerticalGradient} />
      <GradientOverlay direction="to right" stops={HeroHorizontalGradient} />

      <View style={styles.headlineWrapper}>
        <ThemedText type="display" style={styles.headline}>
          FIND YOUR NEXT JAM
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    height: 480,
    overflow: 'hidden',
    backgroundColor: '#07070f',
    justifyContent: 'center',
  },
  image: {
    opacity: 0.6,
  },
  headlineWrapper: {
    paddingHorizontal: Spacing.four,
  },
  headline: {
    color: '#ffffff',
    textAlign: 'center',
  },
});
