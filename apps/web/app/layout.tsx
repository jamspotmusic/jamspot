import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import { SITE_NAME, SITE_URL } from "@/lib/discovery/site";

export const metadata: Metadata = {
  /**
   * Every relative URL in a child route's metadata - canonicals, Open Graph
   * `url`, OG images - is resolved against this. Without it, Next refuses
   * relative metadata URLs at build time, and the discovery pages (TEA-67)
   * lean on them throughout.
   */
  metadataBase: new URL(SITE_URL),
  title: {
    default: "JamSpot — Find your next jam",
    /**
     * Only applied to routes that set a bare string title. The discovery
     * pages build their own "… | JamSpot" titles so they can control the
     * whole string, and they are unaffected by this.
     */
    template: `%s | ${SITE_NAME}`,
  },
  description:
    "Discover upcoming concerts and live music near you, and get tickets through JamSpot.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
