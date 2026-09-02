import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  requestEmailOtp,
  signOut as sharedSignOut,
  verifyEmailOtp,
  type AuthResult,
  type AuthStatus,
  type AuthUser,
} from '@jamspot/shared';

import { supabase } from '@/lib/supabase';

/**
 * Auth state for the mobile app, held in React context — the same shape
 * apps/web/components/AuthProvider.tsx exposes, so the two apps reason about
 * auth identically.
 *
 * Context rather than a global state library: this app uses plain hooks and
 * context today (see hooks/use-theme.ts), and one session object doesn't
 * warrant adding Redux or Zustand.
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  // Only ever sets state inside .then()/.catch() or a subscription callback,
  // never synchronously in the effect body, to satisfy this project's
  // react-hooks/set-state-in-effect rule.
  useEffect(() => {
    let active = true;

    // Reads the AsyncStorage-persisted session, which is what carries an
    // authenticated state across app restarts.
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setSession(data.session);
        setStatus(data.session ? 'authenticated' : 'unauthenticated');
      })
      .catch(() => {
        if (!active) return;
        setSession(null);
        setStatus('unauthenticated');
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setStatus(nextSession ? 'authenticated' : 'unauthenticated');
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const requestCode = useCallback(
    (email: string) => requestEmailOtp(supabase.auth, email),
    [],
  );

  // No setSession here: onAuthStateChange is the single writer of session
  // state, so the two can never disagree.
  const verifyCode = useCallback(
    (email: string, token: string) => verifyEmailOtp(supabase.auth, email, token),
    [],
  );

  const signOut = useCallback(() => sharedSignOut(supabase.auth), []);

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
    throw new Error('useAuth must be used inside an AuthProvider');
  }
  return context;
}
