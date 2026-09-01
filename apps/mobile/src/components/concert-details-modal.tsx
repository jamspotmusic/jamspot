import { Image } from 'expo-image';
import { Calendar, Clock, MapPin, Ticket, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ExternalLink } from '@/components/external-link';
import { CardImageGradient, GradientOverlay } from '@/components/gradient-overlay';
import { SkeletonBar } from '@/components/skeleton';
import { StreamingLinks } from '@/components/streaming-links';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  getAppleMusicArtist,
  getArtistBio,
  getSpotifyArtist,
  type CardEvent,
} from '@/lib/concerts';
import type {
  NormalizedAppleMusicArtist,
  NormalizedArtistBio,
  NormalizedSpotifyArtist,
} from '@jamspot/shared';

type FetchState<T> = {
  data: T | null;
  isLoading: boolean;
  error: string | null;
};

const initialFetchState = <T,>(): FetchState<T> => ({ data: null, isLoading: true, error: null });

/** The mobile twin of apps/web/app/page.tsx's `EventDetailsModal`. */
export function ConcertDetailsModal({ event, onClose }: { event: CardEvent; onClose: () => void }) {
  const theme = useTheme();
  const [isBioExpanded, setIsBioExpanded] = useState(false);
  const [bio, setBio] = useState<FetchState<NormalizedArtistBio>>(initialFetchState);
  const [spotify, setSpotify] = useState<FetchState<NormalizedSpotifyArtist>>(initialFetchState);
  const [appleMusic, setAppleMusic] =
    useState<FetchState<NormalizedAppleMusicArtist>>(initialFetchState);

  const artistName = event.artist;

  // Three independent requests, each with its own state, so one provider
  // being slow or down never blocks the others from rendering — same
  // approach as apps/web/app/page.tsx's EventDetailsModal.
  useEffect(() => {
    let cancelled = false;

    getArtistBio(artistName)
      .then((data) => {
        if (!cancelled) setBio({ data, isLoading: false, error: null });
      })
      .catch((err) => {
        if (!cancelled) {
          setBio({
            data: null,
            isLoading: false,
            error: describeError(err, 'Failed to load artist bio'),
          });
        }
      });

    getSpotifyArtist(artistName)
      .then((data) => {
        if (!cancelled) setSpotify({ data, isLoading: false, error: null });
      })
      .catch((err) => {
        if (!cancelled) {
          setSpotify({
            data: null,
            isLoading: false,
            error: describeError(err, 'Failed to load Spotify artist'),
          });
        }
      });

    getAppleMusicArtist(artistName)
      .then((data) => {
        if (!cancelled) setAppleMusic({ data, isLoading: false, error: null });
      })
      .catch((err) => {
        if (!cancelled) {
          setAppleMusic({
            data: null,
            isLoading: false,
            error: describeError(err, 'Failed to load Apple Music artist'),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [artistName]);

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
      onRequestClose={onClose}>
      <ScrollView style={{ backgroundColor: theme.card }} contentContainerStyle={styles.scroll}>
        <View style={styles.imageWrapper}>
          <Image
            source={{ uri: event.image }}
            style={styles.image}
            contentFit="cover"
            transition={200}
            accessibilityLabel={event.artist}
          />
          <GradientOverlay direction="to top" stops={CardImageGradient} />

          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close concert details"
            style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
            <X size={18} color="#ffffff" />
          </Pressable>

          <View style={styles.imageOverlay}>
            <View style={styles.genreBadge}>
              <ThemedText type="monoSmall" style={styles.genreBadgeText}>
                {event.genre}
              </ThemedText>
            </View>
            <ThemedText style={styles.titleOverlayText}>{event.artist}</ThemedText>
          </View>
        </View>

        <View style={styles.content}>
          <View style={styles.metaRow}>
            <Calendar size={16} color={theme.primary} />
            <ThemedText type="small">{event.date}</ThemedText>
          </View>
          <View style={styles.metaRow}>
            <Clock size={16} color={theme.primary} />
            <ThemedText type="small">{event.time}</ThemedText>
          </View>
          <View style={styles.metaRow}>
            <MapPin size={16} color={theme.primary} />
            <ThemedText type="small">
              {event.venue}
              {'\n'}
              {event.city}, {event.state}
            </ThemedText>
          </View>

          {event.priceRange && (
            <Section title="Price">
              <ThemedText style={styles.price}>{event.priceRange}</ThemedText>
            </Section>
          )}

          <Section title={`About ${event.artist}`}>
            {bio.isLoading ? (
              <View style={styles.bioSkeleton}>
                <SkeletonBar height={12} width="100%" />
                <SkeletonBar height={12} width="100%" />
                <SkeletonBar height={12} width="66%" />
              </View>
            ) : bio.error ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.bioText}>
                Bio unavailable right now.
              </ThemedText>
            ) : bio.data?.summary ? (
              <View>
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  style={styles.bioText}
                  numberOfLines={isBioExpanded ? undefined : 5}>
                  {bio.data.summary}
                </ThemedText>
                <Pressable
                  onPress={() => setIsBioExpanded((prev) => !prev)}
                  accessibilityRole="button">
                  <ThemedText type="small" style={[styles.readMore, { color: theme.primary }]}>
                    {isBioExpanded ? 'Show less' : 'Read more'}
                  </ThemedText>
                </Pressable>
              </View>
            ) : (
              <ThemedText type="small" themeColor="textSecondary" style={styles.bioText}>
                No biography found for this artist.
              </ThemedText>
            )}
          </Section>

          <Section title="Listen">
            <StreamingLinks
              artistName={artistName}
              spotify={{ url: spotify.data?.url ?? null, isLoading: spotify.isLoading }}
              appleMusic={{ url: appleMusic.data?.url ?? null, isLoading: appleMusic.isLoading }}
            />
          </Section>

          {event.ticketUrl && (
            // Styling lives on the inner View: `asChild` clones the
            // Pressable and drops its own `style` prop.
            <ExternalLink href={event.ticketUrl as `${string}:${string}`} asChild>
              <Pressable accessibilityRole="link">
                {({ pressed }) => (
                  <View
                    style={[
                      styles.ticketButton,
                      { backgroundColor: theme.primary },
                      pressed && styles.pressed,
                    ]}>
                    <Ticket size={16} color={theme.primaryForeground} />
                    <ThemedText
                      style={[styles.ticketButtonText, { color: theme.primaryForeground }]}>
                      Get Tickets
                    </ThemedText>
                  </View>
                )}
              </Pressable>
            </ExternalLink>
          )}
        </View>
      </ScrollView>
    </Modal>
  );
}

/** Web's `border-t border-border pt-4` blocks with a mono uppercase label. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();

  return (
    <View style={[styles.section, { borderTopColor: theme.border }]}>
      <ThemedText type="monoSmall" themeColor="textSecondary" style={styles.sectionTitle}>
        {title.toUpperCase()}
      </ThemedText>
      {children}
    </View>
  );
}

function describeError(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
  },
  imageWrapper: {
    // web: `h-56`
    height: 224,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  closeButton: {
    position: 'absolute',
    top: Spacing.three,
    right: Spacing.three,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: Radius.pill,
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageOverlay: {
    position: 'absolute',
    bottom: Spacing.three,
    left: Spacing.three,
    right: Spacing.three,
    alignItems: 'flex-start',
  },
  genreBadge: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: Radius.badge,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  genreBadgeText: {
    color: '#ffffff',
  },
  titleOverlayText: {
    marginTop: Spacing.two,
    color: '#ffffff',
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '900',
  },
  content: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  price: {
    fontWeight: '600',
  },
  section: {
    marginTop: Spacing.two,
    paddingTop: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.two,
  },
  sectionTitle: {
    letterSpacing: 0.5,
  },
  bioSkeleton: {
    gap: Spacing.two,
  },
  bioText: {
    lineHeight: 24,
  },
  readMore: {
    marginTop: Spacing.two,
  },
  ticketButton: {
    marginTop: Spacing.three,
    flexDirection: 'row',
    gap: Spacing.two,
    borderRadius: Radius.control,
    paddingVertical: Spacing.three - Spacing.one,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ticketButtonText: {
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.7,
  },
});
