import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, ApiError, type User } from '../lib/api';

interface AuthState {
  /** undefined while the session is being checked on first load. */
  user: User | null | undefined;
  /** True after the user signs out in this tab, so guards can send them home, not to sign-in. */
  signedOut: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [signedOut, setSignedOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then(({ user }) => !cancelled && setUser(user))
      .catch((err: unknown) => {
        if (cancelled) return;
        // 401 just means "not signed in". Anything else: treat as signed out too,
        // the landing page shows API status.
        if (!(err instanceof ApiError) || err.status !== 401) console.warn(err);
        setUser(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    setUser((await api.login({ email, password })).user);
    setSignedOut(false);
  }, []);

  const signUp = useCallback(async (name: string, email: string, password: string) => {
    setUser((await api.register({ name, email, password })).user);
    setSignedOut(false);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
      setSignedOut(true);
    }
  }, []);

  const value = useMemo(
    () => ({ user, signedOut, signIn, signUp, signOut }),
    [user, signedOut, signIn, signUp, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
