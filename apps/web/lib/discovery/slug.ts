/**
 * URL-safe slugs for JamSpot's discovery pages (TEA-67).
 *
 * Every indexable discovery URL is built from one of these, and every incoming
 * route param is read back through them, so a page has exactly one spelling:
 * `/concerts/San-Diego`, `/concerts/san diego`, and `/concerts/san-diego/`
 * all resolve to the same canonical `/concerts/san-diego`.
 *
 * Slugs are deliberately lossy. `toSlug` is for *building* a URL from a name we
 * already hold; it is not an encoding you can reverse. Going the other way -
 * slug to entity - always goes through a registry (lib/discovery/taxonomy.ts)
 * or an exact-match lookup against Ticketmaster (lib/discovery/entities.ts),
 * never through un-slugging a display string.
 */

/**
 * Turn a display name into a slug: lowercase, ASCII, hyphen-separated.
 *
 *   toSlug("San Diego")  // "san-diego"
 *   toSlug("R&B")        // "r-and-b"
 *   toSlug("Hip-Hop/Rap")// "hip-hop-rap"
 *   toSlug("Café Tacvba")// "cafe-tacvba"
 *
 * "&" becomes "and" rather than disappearing, so "R&B" and "RB" don't collide.
 */
export function toSlug(value: string): string {
  return (
    value
      .normalize("NFKD")
      // Strip combining marks left behind by NFKD, so "é" -> "e" not "e" + U+0301.
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      // Curly and straight apostrophes close up: "Levi's" -> "levis", not "levi-s".
      .replace(/['‘’ʼ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
  );
}

/**
 * The canonical form of a slug that arrived in a route param.
 *
 * Runs the param back through `toSlug` so capitalization, stray whitespace,
 * percent-encoded spaces, and repeated or trailing hyphens all collapse onto
 * one spelling. Returns null when nothing usable is left, which the routes
 * treat as an invalid param rather than as an open-ended search.
 */
export function normalizeSlugParam(raw: string | undefined): string | null {
  if (typeof raw !== "string") return null;

  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // A malformed escape sequence is not a slug we can resolve; fall through
    // with the raw value, which toSlug will reject or clean up.
  }

  const slug = toSlug(decoded);
  return slug === "" ? null : slug;
}

/**
 * True when `raw` is already exactly its own canonical slug.
 *
 * The routes use this to decide between rendering and redirecting: an
 * equivalent-but-differently-spelled URL is redirected to the canonical one so
 * only one of them is ever served a 200, and only one is ever indexed.
 */
export function isCanonicalSlug(raw: string | undefined): boolean {
  return typeof raw === "string" && raw !== "" && toSlug(raw) === raw;
}
