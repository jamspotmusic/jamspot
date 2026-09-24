import { cache } from "react";

import { getArtistBio } from "@/lib/lastfm";
import { getSpotifyArtist } from "@/lib/spotify";
import { getAppleMusicArtist } from "@/lib/apple-music";
import type {
  NormalizedAppleMusicArtist,
  NormalizedArtistBio,
  NormalizedSpotifyArtist,
} from "@jamspot/shared";

/**
 * Artist enrichment for the server-rendered artist pages (TEA-67).
 *
 * The concert modal fetches these three providers from the browser, through
 * /api/artist/*, which is right for a modal: nothing is on screen until the
 * user opens one. An artist *page* is different - the bio and the streaming
 * links are the page's content, so they have to be in the initial HTML rather
 * than appearing after hydration.
 *
 * Same libraries, called directly instead of through our own API routes: a
 * server component calling its own HTTP endpoint would be a pointless round
 * trip through the network stack for data it can fetch in-process. The Data
 * Cache entries are shared with the modal's requests either way, because both
 * paths end in the same provider URLs.
 */

export type ArtistEnrichment = {
  bio: NormalizedArtistBio | null;
  spotify: NormalizedSpotifyArtist | null;
  appleMusic: NormalizedAppleMusicArtist | null;
};

/**
 * Swallow a provider failure into `null`.
 *
 * Each provider is independent, and any of them can be rate-limited, missing
 * a key in this environment, or simply have no entry for the artist. One being
 * unavailable must not take the page down or blank out the other two - it just
 * means that section doesn't render.
 */
async function optional<T>(load: () => Promise<T | null>): Promise<T | null> {
  try {
    return await load();
  } catch {
    return null;
  }
}

/**
 * Fetch all three providers for an artist, in parallel.
 *
 * Cached per render so the page body and `generateMetadata` share one set of
 * requests. Three calls, fixed - the count doesn't grow with the number of
 * events on the page.
 */
export const getArtistEnrichment = cache(
  async (artistName: string): Promise<ArtistEnrichment> => {
    const [bio, spotify, appleMusic] = await Promise.all([
      optional(() => getArtistBio(artistName)),
      optional(() => getSpotifyArtist(artistName)),
      optional(() => getAppleMusicArtist(artistName)),
    ]);

    return { bio, spotify, appleMusic };
  }
);
