import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { UserPrivate } from '@flygit/shared';
import { api, ApiError, setAccessToken, getAccessToken } from '../../lib/api';

interface LoginResult {
  user: UserPrivate;
  accessToken: string;
  expiresIn: number;
}

interface TwoFactorChallenge {
  requiresTwoFactor: true;
  challengeToken: string;
}

type LoginResponse = LoginResult | TwoFactorChallenge;

export interface RegisterInput {
  username: string;
  email: string;
  password: string;
  acceptTerms: true;
  locale?: string;
}

interface AuthContextValue {
  user: UserPrivate | null;
  /** True while the initial session restore (silent refresh) is in flight. */
  initializing: boolean;
  login: (identifier: string, password: string, totpCode?: string) => Promise<UserPrivate>;
  loginWith2FA: (challengeToken: string, code: string) => Promise<UserPrivate>;
  register: (input: RegisterInput) => Promise<UserPrivate>;
  logout: () => Promise<void>;
  /** Re-fetch the current user (e.g. after a profile update). */
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserPrivate | null>(null);
  const [initializing, setInitializing] = useState(true);

  // Restore the session on mount via the httpOnly refresh cookie.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // tryRefresh inside api.ts sets the access token on success.
        const res = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' });
        if (res.ok) {
          const data = (await res.json()) as { accessToken?: string };
          if (data.accessToken) {
            setAccessToken(data.accessToken);
            const me = await api.get<UserPrivate>('/users/me');
            if (!cancelled) setUser(me);
          }
        }
      } catch {
        // Not signed in — stay anonymous.
      } finally {
        if (!cancelled) setInitializing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyLogin = useCallback((result: LoginResult): UserPrivate => {
    setAccessToken(result.accessToken);
    setUser(result.user);
    return result.user;
  }, []);

  const login = useCallback(
    async (identifier: string, password: string, totpCode?: string): Promise<UserPrivate> => {
      const body: Record<string, unknown> = { identifier, password };
      if (totpCode) body.totpCode = totpCode;
      const result = await api.post<LoginResponse>('/auth/login', body);
      if ('requiresTwoFactor' in result) {
        throw new TwoFactorRequiredError(result.challengeToken);
      }
      return applyLogin(result);
    },
    [applyLogin],
  );

  const loginWith2FA = useCallback(
    async (challengeToken: string, code: string): Promise<UserPrivate> => {
      const result = await api.post<LoginResult>('/auth/2fa/login', { challengeToken, code });
      return applyLogin(result);
    },
    [applyLogin],
  );

  const register = useCallback(async (input: RegisterInput): Promise<UserPrivate> => {
    return api.post<UserPrivate>('/auth/register', input);
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await api.post<void>('/auth/logout');
    } catch {
      // Ignore — clear local state regardless.
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  const refreshUser = useCallback(async (): Promise<void> => {
    if (!getAccessToken()) return;
    const me = await api.get<UserPrivate>('/users/me');
    setUser(me);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, initializing, login, loginWith2FA, register, logout, refreshUser }),
    [user, initializing, login, loginWith2FA, register, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Thrown when a password login requires a TOTP code. */
export class TwoFactorRequiredError extends Error {
  constructor(public readonly challengeToken: string) {
    super('2FA_REQUIRED');
    this.name = 'TwoFactorRequiredError';
  }
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/** Helper for translating API validation errors in forms. */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
