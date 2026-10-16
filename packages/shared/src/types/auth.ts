import type { PlatformRole } from '../constants';

/** Authenticated user session payload (JWT claims). */
export interface JwtPayload {
  sub: string;
  username: string;
  email: string;
  isAdmin: boolean;
  type: 'access' | 'refresh';
  jti?: string;
}

/** Public user profile. */
export interface UserPublic {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  website: string | null;
  createdAt: string;
}

/** Full profile of the authenticated user. */
export interface UserPrivate extends UserPublic {
  email: string;
  role: PlatformRole;
  isActive: boolean;
  emailConfirmedAt: string | null;
  twoFactorEnabled: boolean;
  locale: string;
  theme: 'dark' | 'light' | 'system';
  updatedAt: string;
}

/** Session (device) record. */
export interface SessionInfo {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

/** Credential material for login. */
export interface LoginInput {
  identifier: string;
  password: string;
  totpCode?: string;
}
