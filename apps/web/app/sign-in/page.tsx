"use client";

import Link from "next/link";
import { Music2 } from "lucide-react";

import AuthNav from "@/components/AuthNav";
import SignInPanel from "@/components/SignInPanel";
import { useAuth } from "@/components/AuthProvider";

/**
 * Sign-in route. Header markup mirrors app/reviews-page/page.tsx so the page
 * sits inside the existing JamSpot chrome rather than reading as a standalone
 * screen.
 */
export default function SignInPage() {
  const { status, user } = useAuth();

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3 sm:px-6">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
              <Music2 size={14} className="text-white" />
            </div>
            <span
              className="text-sm font-bold uppercase tracking-widest text-foreground"
              style={{
                fontFamily: "'Unbounded', sans-serif",
                letterSpacing: "0.12em",
              }}
            >
              JAMSPOT
            </span>
          </Link>

          <div className="ml-auto">
            <AuthNav />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-md space-y-6 p-6 text-foreground">
        <div>
          <h1
            className="text-lg font-bold text-foreground"
            style={{
              fontFamily: "'Unbounded', sans-serif",
              fontSize: "1rem",
            }}
          >
            {status === "authenticated" ? "You're signed in" : "Sign in"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {status === "authenticated"
              ? "Your session is active on this device."
              : "Passwordless — we email you a code."}
          </p>
        </div>

        {status === "loading" && (
          <div className="space-y-3" aria-hidden="true">
            <div className="h-10 w-full animate-pulse rounded-lg bg-muted" />
            <div className="h-12 w-full animate-pulse rounded-lg bg-muted" />
          </div>
        )}

        {status === "unauthenticated" && (
          <div className="rounded-xl border border-border bg-card p-6">
            <SignInPanel />
          </div>
        )}

        {status === "authenticated" && (
          <div className="space-y-4 rounded-xl border border-border bg-card p-6">
            <p className="text-sm text-muted-foreground">
              Signed in as{" "}
              <span className="text-foreground">{user?.email}</span>
            </p>
            <Link
              href="/"
              className="flex w-full items-center justify-center rounded-lg bg-primary px-4 py-3 font-medium text-primary-foreground hover:opacity-90"
            >
              Find your next jam
            </Link>
          </div>
        )}
      </main>
    </>
  );
}
