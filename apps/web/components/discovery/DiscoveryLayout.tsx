import Link from "next/link";
import { Music2 } from "lucide-react";

import AuthNav from "@/components/AuthNav";

/**
 * The JamSpot frame around every discovery page (TEA-67).
 *
 * A Server Component on purpose. The nav, the heading, the breadcrumb, and the
 * footer are part of the "meaningful HTML in the initial response" the
 * acceptance criteria ask for, so none of it is allowed to depend on the
 * client app having booted. Only AuthNav - which genuinely needs the session -
 * is a client island inside it.
 */

export type Breadcrumb = { label: string; href?: string };

export default function DiscoveryLayout({
  breadcrumbs,
  children,
}: {
  breadcrumbs: Breadcrumb[];
  children: React.ReactNode;
}) {
  const currentYear = new Date().getFullYear();

  return (
    <div
      className="min-h-screen bg-background text-foreground flex flex-col"
      style={{ fontFamily: "'DM Sans', sans-serif" }}
    >
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 flex items-center gap-6 h-16">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <div className="flex w-7 h-7 rounded-md bg-primary items-center justify-center">
              <Music2 size={14} className="text-white" />
            </div>
            <span
              className="text-sm font-bold tracking-widest uppercase"
              style={{
                fontFamily: "'Unbounded', sans-serif",
                letterSpacing: "0.12em",
              }}
            >
              JAMSPOT
            </span>
          </Link>

          <nav className="flex items-center gap-6">
            <Link
              href="/reviews-page"
              className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors"
            >
              Reviews
            </Link>
          </nav>

          <div className="flex flex-1 justify-end">
            {/* The search field deliberately isn't here. A discovery page's
                result set is defined by its URL alone, and a field that could
                replace those results in place would make the page show
                something other than what it was indexed for. Searching starts
                from the home page. */}
            <Link
              href="/"
              className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors"
            >
              Search
            </Link>
          </div>

          <AuthNav />
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-10">
        <nav aria-label="Breadcrumb" className="mb-6">
          <ol
            className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
            style={{ fontFamily: "'DM Mono', monospace" }}
          >
            {breadcrumbs.map((crumb, index) => (
              <li key={`${crumb.label}-${index}`} className="flex items-center gap-2">
                {index > 0 && <span aria-hidden="true">/</span>}
                {crumb.href ? (
                  <Link href={crumb.href} className="hover:text-primary transition-colors">
                    {crumb.label}
                  </Link>
                ) : (
                  <span aria-current="page" className="text-foreground">
                    {crumb.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>

        {children}
      </main>

      <footer className="border-t border-border py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-primary/30 flex items-center justify-center">
              <Music2 size={10} className="text-primary" />
            </div>
            <span
              className="text-xs tracking-widest text-muted-foreground uppercase"
              style={{ fontFamily: "'Unbounded', sans-serif" }}
            >
              JAMSPOT
            </span>
          </div>
          <p
            className="text-xs text-muted-foreground"
            style={{ fontFamily: "'DM Mono', monospace" }}
          >
            &copy; {currentYear} · Events are updated daily
          </p>
        </div>
      </footer>
    </div>
  );
}
