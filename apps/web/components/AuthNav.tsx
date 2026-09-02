"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, User } from "lucide-react";

import { useAuth } from "@/components/AuthProvider";

/**
 * The auth affordance in the site header: a "Sign in" link when signed out,
 * the signed-in address plus a sign-out button when signed in.
 *
 * Both app/page.tsx and app/reviews-page/page.tsx hand-roll their own header,
 * so this exists to avoid a third copy of the same markup diverging from the
 * other two.
 */
export default function AuthNav() {
  const { status, user, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  // Render nothing rather than a "Sign in" link that would flip to the user's
  // email a moment later — the persisted session resolves quickly and the
  // flash reads as a bug.
  if (status === "loading") {
    return <div className="h-7 w-20 shrink-0" aria-hidden="true" />;
  }

  if (status === "unauthenticated") {
    return (
      <Link
        href="/sign-in"
        className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
          pathname === "/sign-in"
            ? "bg-primary text-white"
            : "border border-border bg-muted text-muted-foreground hover:border-primary/40 hover:text-foreground"
        }`}
      >
        Sign in
      </Link>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <span
        className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex"
        style={{ fontFamily: "'DM Mono', monospace" }}
        title={user?.email ?? undefined}
      >
        <User size={12} className="shrink-0" />
        <span className="max-w-[14ch] truncate">{user?.email}</span>
      </span>
      <button
        type="button"
        onClick={async () => {
          await signOut();
          router.refresh();
        }}
        aria-label="Sign out"
        className="flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground cursor-pointer"
      >
        <LogOut size={13} />
        Sign out
      </button>
    </div>
  );
}
