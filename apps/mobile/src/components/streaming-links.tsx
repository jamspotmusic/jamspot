import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { ExternalLink } from '@/components/external-link';
import { SkeletonBar } from '@/components/skeleton';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type ProviderLinkState = {
  url: string | null;
  isLoading: boolean;
};

/** Apple requires use of its unmodified, hosted badge artwork. */
const APPLE_MUSIC_BADGE_URL =
  'https://marketing.services.apple/api/storage/images/6408fd8630506600073b0d7e/en-us-large%401x.png';

/**
 * `ExternalLink` renders an expo-router `Link`, and cloning the child with
 * `asChild` drops that child's own `style` prop — so every one of these
 * carries its styling on an inner `View` the clone can't reach.
 */

/**
 * The branded Apple Music badge and Spotify pill from
 * apps/web/components/StreamingServiceLinks.tsx. The Spotify mark is the
 * same artwork the web app serves from /streaming/spotify-icon.svg,
 * extracted to a PNG so React Native can render it without an SVG loader.
 */
export function StreamingLinks({
  artistName,
  spotify,
  appleMusic,
}: {
  artistName: string;
  spotify: ProviderLinkState;
  appleMusic: ProviderLinkState;
}) {
  return (
    <View style={styles.row}>
      <AppleMusicLink artistName={artistName} {...appleMusic} />
      <SpotifyLink artistName={artistName} {...spotify} />
    </View>
  );
}

function AppleMusicLink({
  artistName,
  url,
  isLoading,
}: ProviderLinkState & { artistName: string }) {
  if (isLoading) return <ProviderSkeleton width={118} />;
  if (!url) return <UnavailableLink label="Apple Music" />;

  return (
    <ExternalLink href={url as `${string}:${string}`} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Listen to ${artistName} on Apple Music`}>
        {({ pressed }) => (
          <View style={[styles.appleBadgeWrapper, pressed && styles.pressed]}>
            <Image
              source={{ uri: APPLE_MUSIC_BADGE_URL }}
              style={styles.appleBadge}
              contentFit="contain"
              accessibilityLabel="Listen on Apple Music"
            />
          </View>
        )}
      </Pressable>
    </ExternalLink>
  );
}

function SpotifyLink({ artistName, url, isLoading }: ProviderLinkState & { artistName: string }) {
  if (isLoading) return <ProviderSkeleton width={166} />;
  if (!url) return <UnavailableLink label="Spotify" />;

  return (
    // Cast: ExternalLink's href type requires a literal-looking external
    // URL shape (`${string}:${string}`), which a runtime string variable
    // can't satisfy structurally even though it's always a real https:// URL.
    <ExternalLink href={url as `${string}:${string}`} asChild>
      <Pressable accessibilityRole="link" accessibilityLabel={`Listen to ${artistName} on Spotify`}>
        {({ pressed }) => (
          <View style={[styles.spotifyPill, pressed && styles.pressed]}>
            {/* Web crops the 44px mark inside a 32px circle; same here. */}
            <View style={styles.spotifyIconMask}>
              <Image
                source={require('@/assets/images/streaming/spotify-icon.png')}
                style={styles.spotifyIcon}
                contentFit="cover"
              />
            </View>
            <ThemedText style={styles.spotifyLabel}>Listen on Spotify</ThemedText>
          </View>
        )}
      </Pressable>
    </ExternalLink>
  );
}

function ProviderSkeleton({ width }: { width: number }) {
  const theme = useTheme();

  return (
    <View style={[styles.placeholder, { width, borderColor: theme.border }]}>
      <SkeletonBar height={48} width={width} style={styles.placeholderFill} />
    </View>
  );
}

function UnavailableLink({ label }: { label: string }) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.placeholder,
        styles.unavailable,
        { borderColor: theme.border, backgroundColor: theme.backgroundElement },
      ]}>
      <ThemedText type="monoSmall" themeColor="textSecondary">
        {label} unavailable
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + Spacing.one,
    flexWrap: 'wrap',
  },
  appleBadgeWrapper: {
    height: 48,
    justifyContent: 'center',
    padding: Spacing.one,
  },
  appleBadge: {
    height: 40,
    // Apple's large US badge lockup; `contain` letterboxes rather than
    // distorts if the hosted artwork's ratio ever changes.
    aspectRatio: 156 / 40,
  },
  spotifyPill: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.pill,
    backgroundColor: '#000000',
    paddingLeft: Spacing.three - Spacing.one,
    paddingRight: Spacing.four + Spacing.one,
  },
  spotifyIconMask: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spotifyIcon: {
    width: 44,
    height: 44,
  },
  spotifyLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  placeholder: {
    height: 48,
    borderRadius: Radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  unavailable: {
    paddingHorizontal: Spacing.three,
    opacity: 0.7,
  },
  placeholderFill: {
    borderRadius: 0,
  },
  pressed: {
    opacity: 0.7,
  },
});
