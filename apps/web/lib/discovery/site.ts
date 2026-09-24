import type { DiscoveryCity, DiscoveryGenre } from "@/lib/discovery/taxonomy";

/**
 * Absolute-URL plumbing for the discovery pages (TEA-67).
 *
 * Canonical tags, Open Graph `url`, JSON-LD, and the sitemap all have to name
 * the same origin, and it has to be the public one - a canonical pointing at a
 * preview deployment tells a crawler the preview is the real page. Everything
 * that needs an absolute URL builds it here.
 */

/** JamSpot's public origin, without a trailing slash. */
export const SITE_URL = normalizeOrigin(
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://jamspot-three.vercel.app"
);

export const SITE_NAME = "JamSpot";

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

/** Turn a site-relative path into the absolute URL that may be published. */
export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * The one canonical path for a city page.
 *
 * Built from the registry entry rather than from the request, so every
 * equivalent spelling of the URL resolves to a single canonical.
 */
export function cityPath(city: DiscoveryCity): string {
  return `/concerts/${city.slug}`;
}

/** The one canonical path for a city + genre page. */
export function cityGenrePath(
  city: DiscoveryCity,
  genre: DiscoveryGenre
): string {
  return `/concerts/${city.slug}/${genre.slug}`;
}

/** The one canonical path for an artist page. */
export function artistPath(slug: string): string {
  return `/artists/${slug}`;
}

/** The one canonical path for a venue page. */
export function venuePath(slug: string): string {
  return `/venues/${slug}`;
}
