import { Image } from 'expo-image';
import { MapPin, Ticket } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

import { CardImageGradient, GradientOverlay } from '@/components/gradient-overlay';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { CardEvent } from '@/lib/concerts';

/**
 * The mobile twin of apps/web/app/page.tsx's `EventCard`: image with a
 * genre badge and a date/time overlay fading into the card body, then the
 * artist, venue line, price, and a "Get Tickets" button.
 */
export function ConcertCard({
  event,
  onPress,
  onTicketPress,
}: {
  event: CardEvent;
  onPress: (event: CardEvent) => void;
  onTicketPress: (event: CardEvent) => void;
}) {
  const theme = useTheme();

  return (
    <Pressable onPress={() => onPress(event)}>
      {({ pressed }) => (
        <View
          style={[
            styles.card,
            { backgroundColor: theme.card, borderColor: theme.border },
            pressed && styles.pressed,
          ]}>
          <View style={styles.imageWrapper}>
            <Image
              source={{ uri: event.image }}
              style={[styles.image, styles.imageDimmed]}
              contentFit="cover"
              transition={200}
              accessibilityLabel={`${event.artist} live`}
            />
            <GradientOverlay direction="to top" stops={CardImageGradient} />

            <View style={styles.genreBadge}>
              <ThemedText type="monoTiny" style={styles.genreBadgeText}>
                {event.genre}
              </ThemedText>
            </View>

            <View style={styles.dateOverlay}>
              <ThemedText type="monoTiny" style={styles.dateOverlayText}>
                {event.date}
              </ThemedText>
              <ThemedText type="monoSmall" style={styles.timeOverlayText}>
                {event.time}
              </ThemedText>
            </View>
          </View>

          <View style={styles.body}>
            <ThemedText style={styles.artist}>{event.artist}</ThemedText>

            <View style={styles.venueRow}>
              <MapPin size={11} color={theme.text} />
              <ThemedText type="small" style={styles.venueText}>
                {event.venue} · {event.city}, {event.state}
              </ThemedText>
            </View>

            <View style={styles.footer}>
              <ThemedText type="mono" style={styles.price}>
                {event.priceRange ?? ''}
              </ThemedText>

              <Pressable
                onPress={() => onTicketPress(event)}
                disabled={!event.ticketUrl}
                accessibilityRole="button"
                style={({ pressed: ticketPressed }) => [
                  styles.ticketButton,
                  {
                    backgroundColor: 'rgba(139, 92, 246, 0.1)',
                    borderColor: 'rgba(139, 92, 246, 0.2)',
                  },
                  !event.ticketUrl && styles.ticketButtonDisabled,
                  ticketPressed && event.ticketUrl && styles.ticketButtonPressed,
                ]}>
                <Ticket size={12} color={theme.primary} />
                <ThemedText type="monoSmall" style={{ color: theme.primary }}>
                  {event.ticketUrl ? 'Get Tickets' : 'Unavailable'}
                </ThemedText>
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  pressed: {
    opacity: 0.7,
  },
  imageWrapper: {
    // web: `h-44`
    height: 176,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imageDimmed: {
    // web: `opacity-70`
    opacity: 0.7,
  },
  genreBadge: {
    position: 'absolute',
    top: Spacing.two + Spacing.one,
    left: Spacing.two + Spacing.one,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: Radius.badge,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  genreBadgeText: {
    color: 'rgba(255, 255, 255, 0.8)',
  },
  dateOverlay: {
    position: 'absolute',
    bottom: Spacing.two + Spacing.one,
    left: Spacing.two + Spacing.one,
    right: Spacing.two + Spacing.one,
  },
  dateOverlayText: {
    color: 'rgba(139, 92, 246, 0.8)',
  },
  timeOverlayText: {
    color: 'rgba(255, 255, 255, 0.6)',
  },
  body: {
    padding: Spacing.three,
  },
  artist: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '900',
    marginBottom: Spacing.one,
  },
  venueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    marginBottom: Spacing.three,
  },
  venueText: {
    flexShrink: 1,
  },
  price: {
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ticketButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half + Spacing.one,
    borderRadius: Radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two - Spacing.half,
  },
  ticketButtonDisabled: {
    opacity: 0.4,
  },
  ticketButtonPressed: {
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
  },
});
