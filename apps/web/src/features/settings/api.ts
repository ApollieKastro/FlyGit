import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdateProfileInput, UserPrivate } from '@flygit/shared';
import { api } from '../../lib/api';

export interface SshKey {
  id: string;
  title: string;
  publicKey: string;
  fingerprint: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface TwoFactorSetup {
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
  backupCodes: string[];
}

// ───────────────────────── Profile ─────────────────────────

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<UserPrivate>('/users/me'),
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProfileInput) => api.patch('/users/me', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

// ───────────────────────── SSH keys ─────────────────────────

export function useSshKeys() {
  return useQuery({
    queryKey: ['ssh-keys'],
    queryFn: () => api.get<SshKey[]>('/users/me/ssh-keys'),
  });
}

export function useAddSshKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; key: string }) => api.post<SshKey>('/users/me/ssh-keys', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ssh-keys'] });
    },
  });
}

export function useRemoveSshKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/users/me/ssh-keys/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ssh-keys'] });
    },
  });
}

// ───────────────────────── API tokens ─────────────────────────

export function useTokens() {
  return useQuery({
    queryKey: ['tokens'],
    queryFn: () => api.get<ApiToken[]>('/users/me/tokens'),
  });
}

export function useCreateToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; scopes: string[]; expiresAt?: string | null }) =>
      api.post<ApiToken & { token?: string }>('/users/me/tokens', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tokens'] });
    },
  });
}

export function useRevokeToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/users/me/tokens/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tokens'] });
    },
  });
}

// ───────────────────────── Password ─────────────────────────

export function useChangePassword() {
  return useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      api.post('/auth/password', input),
  });
}

// ───────────────────────── Two-factor ─────────────────────────

export function useSetupTwoFactor() {
  return useMutation({
    mutationFn: () => api.post<TwoFactorSetup>('/auth/2fa/setup'),
  });
}

export function useEnableTwoFactor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => api.post<{ enabled: true; backupCodes: string[] }>('/auth/2fa/enable', { code }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export function useDisableTwoFactor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => api.post('/auth/2fa/disable', { code }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}
