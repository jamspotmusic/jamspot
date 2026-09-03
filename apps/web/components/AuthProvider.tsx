"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Session } from "@supabase/supabase-js";
import {
  requestEmailOtp,
  signOut as sharedSignOut,
  verifyEmailOtp,
  type AuthResult,
  type AuthStatus,
  type AuthUser,
} from "@jamspot/shared";

import { createClient } from "@/lib/supabase-browser";

/**
 * Auth state for the web app, held in React context.
 *
 * Context rather than a new global-state library: this app has no Redux,
 * Zustand, or similar today, and one session object read by a header and a
 * sign-in page does not justify introducing one.
 */

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  session: Session | null;
  requestCode: (email: string) => Promise<AuthResult>;
  verifyCode: (email: string, token: string) => Promise<AuthResult>;
  signOut: () => Promise<AuthResult>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function toAuthUser(session: Session | null): AuthUser | null {
  if (!session?.user) return null;
  return { id: session.user.id, email: session.user.email ?? null };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  useEffect(() => {
    let active = true;

    // getSession() reads the persisted cookie session, which is what makes an
    // authenticated state survive a reload. onAuthStateChange then keeps this
    // in step with token refreshes, sign-outs, and sign-ins in other tabs.
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setSession(data.session);
        setStatus(data.session ? "authenticated" : "unauthenticated");
      })
      .catch(() => {
        if (!active) return;
        setSession(null);
        setStatus("unauthenticated");
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setStatus(nextSession ? "authenticated" : "unauthenticated");
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const requestCode = useCallback(
    (email: string) => requestEmailOtp(supabase.auth, email),
    [supabase],
  );

  // No setSession here: onAuthStateChange fires on a successful verify and is
  // the single place session state is written, so the two can't disagree.
  const verifyCode = useCallback(
    (email: string, token: string) => verifyEmailOtp(supabase.auth, email, token),
    [supabase],
  );

  const signOut = useCallback(() => sharedSignOut(supabase.auth), [supabase]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user: toAuthUser(session),
      session,
      requestCode,
      verifyCode,
      signOut,
    }),
    [status, session, requestCode, verifyCode, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside an AuthProvider");
  }
  return context;
}
