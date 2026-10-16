import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

export interface AdminStats {
  users: number;
  organizations: number;
  repositories: number;
  issues: number;
  mergeRequests: number;
  activeSessions: number;
}

export interface AdminUser {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: 'admin' | 'user';
  isActive: boolean;
  emailConfirmed: boolean;
  totpEnabled: boolean;
  sessionsCount: number;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AdminUserList {
  items: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminUserParams {
  q?: string;
  role?: string;
  active?: string;
  page?: number;
  pageSize?: number;
}

function buildQuery(params: AdminUserParams): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') sp.set(k, String(v));
  }
  const str = sp.toString();
  return str ? `?${str}` : '';
}

export function useAdminStats() {
  return useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => api.get<AdminStats>('/admin/stats'),
  });
}

export function useAdminUsers(params: AdminUserParams) {
  return useQuery({
    queryKey: ['admin-users', params],
    queryFn: () => api.get<AdminUserList>(`/admin/users${buildQuery({ pageSize: 20, ...params })}`),
  });
}

function useInvalidateAdmin() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['admin-users'] });
    void qc.invalidateQueries({ queryKey: ['admin-stats'] });
  };
}

export function useSetUserActive() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/admin/users/${id}/active`, { isActive }),
    onSuccess: invalidate,
  });
}

export function useSetUserRole() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: 'admin' | 'user' }) =>
      api.patch(`/admin/users/${id}/role`, { role }),
    onSuccess: invalidate,
  });
}

export function useDeleteUser() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/admin/users/${id}`),
    onSuccess: invalidate,
  });
}
