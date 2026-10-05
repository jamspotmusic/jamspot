import { NextResponse, type NextRequest } from "next/server";

import { toSlug } from "@/lib/discovery/slug";

/**
 * URL normalization for the discovery pages (TEA-67).
 *
 * Canonicalizing a URL is a routing concern, so it happens here rather than
 * inside the routes. Doing it in the page had a concrete problem: the city,
 * city/genre, and venue routes are incrementally regenerated, and a
 * `redirect()` thrown during render is itself cached as that path's prerender
 * - so `/concerts/San-Diego` became a cache entry of its own, served a 307
 * that had lost its Location header. Normalizing before the request reaches
 * the cache means only canonical paths are ever rendered or stored.
 *
 * The rule is the one `toSlug` already encodes, applied per path segment:
 * `/concerts/San-Diego`, `/concerts/san--diego`, and `/concerts/san%20diego`
 * all redirect to `/concerts/san-diego`, permanently, so one URL is served a
 * 200 and one URL is indexed.
 *
 * What this cannot decide is whether a canonical-looking slug names a real
 * entity - that needs Ticketmaster - so unresolvable slugs still fall through
 * to the routes, which 404 them.
 */

/** 308: permanent, and unlike 301 it cannot be downgraded to a GET. */
const PERMANENT_REDIRECT = 308;

export const config = {
  matcher: ["/concerts/:path*", "/artists/:path*", "/venues/:path*"],
};

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const canonical = canonicalizePath(pathname);

  if (canonical === null || canonical === pathname) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = canonical;

  return NextResponse.redirect(url, PERMANENT_REDIRECT);
}

/**
 * The canonical spelling of a discovery path, or null when there isn't one.
 *
 * Null means "leave it alone": a segment that slugifies to nothing has no
 * canonical form to send anyone to, so it goes through to the route and 404s
 * there rather than bouncing between redirects.
 *
 * Exported for the unit tests - the redirect rule is worth pinning down
 * independently of Next's request plumbing.
 */
export function canonicalizePath(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  const canonical: string[] = [];

  for (const segment of segments) {
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      // A malformed escape is not something we can canonicalize; let the
      // route deal with it.
      return null;
    }

    const slug = toSlug(decoded);
    if (!slug) return null;

    canonical.push(slug);
  }

  return `/${canonical.join("/")}`;
}
