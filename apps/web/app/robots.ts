import type { MetadataRoute } from "next";

import { absoluteUrl, SITE_URL } from "@/lib/discovery/site";

/**
 * robots.txt (TEA-67).
 *
 * Deliberately permissive at this level: which discovery pages get indexed is
 * decided per page, by the `robots` metadata each route returns, because only
 * the route knows whether it found any events. A path-shaped rule here could
 * not make that distinction - it would either block a whole route segment
 * including the pages worth indexing, or block none of it.
 *
 * What is blocked are the paths that are never a search result: the API
 * surface, and the scratch pages under /test-*.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/test-artist", "/test-concert-query", "/test-concerts", "/test-reviews"],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
    host: SITE_URL,
  };
}
