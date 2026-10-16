import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UserPublic } from '@flygit/shared';
import { api } from '../../lib/api';

export interface RepoMember extends UserPublic {
  role: string;
  addedAt: string;
}

export interface RepoWebhook {
  id: string;
  url: string;
  hasSecret: boolean;
  events: string[];
  active: boolean;
  createdAt: string;
}

export interface ProtectedBranch {
  id: string;
  pattern: string;
  requireApprovals: number;
  requireStatusChecks: boolean;
  allowForcePush: boolean;
  allowDeletions: boolean;
  allowMerges: boolean;
  dismissStaleReviews: boolean;
  createdAt: string;
}

function useInvalidateRepo(owner: string, repo: string) {
  const qc = useQueryClient();
  return (keys: string[]) => {
    for (const key of keys) void qc.invalidateQueries({ queryKey: [key, owner, repo] });
    void qc.invalidateQueries({ queryKey: ['repository', owner, repo] });
  };
}

// ───────────────────────── Members ─────────────────────────

export function useRepoMembers(owner: string, repo: string) {
  return useQuery({
    queryKey: ['repo-members', owner, repo],
    queryFn: () => api.get<RepoMember[]>(`/repositories/${owner}/${repo}/members`),
    enabled: Boolean(owner && repo),
  });
}

export function useAddRepoMember(owner: string, repo: string) {
  const invalidate = useInvalidateRepo(owner, repo);
  return useMutation({
    mutationFn: (input: { username: string; role: string }) =>
      api.post<RepoMember>(`/repositories/${owner}/${repo}/members`, input),
    onSuccess: () => invalidate(['repo-members']),
  });
}

export function useRemoveRepoMember(owner: string, repo: string) {
  const invalidate = useInvalidateRepo(owner, repo);
  return useMutation({
    mutationFn: (username: string) => api.delete(`/repositories/${owner}/${repo}/members/${username}`),
    onSuccess: () => invalidate(['repo-members']),
  });
}

// ───────────────────────── Webhooks ─────────────────────────

export function useRepoWebhooks(owner: string, repo: string) {
  return useQuery({
    queryKey: ['repo-webhooks', owner, repo],
    queryFn: () => api.get<RepoWebhook[]>(`/repositories/${owner}/${repo}/webhooks`),
    enabled: Boolean(owner && repo),
  });
}

export function useCreateWebhook(owner: string, repo: string) {
  const invalidate = useInvalidateRepo(owner, repo);
  return useMutation({
    mutationFn: (input: { url: string; secret?: string; events: string[]; active: boolean }) =>
      api.post<RepoWebhook>(`/repositories/${owner}/${repo}/webhooks`, input),
    onSuccess: () => invalidate(['repo-webhooks']),
  });
}

export function useDeleteWebhook(owner: string, repo: string) {
  const invalidate = useInvalidateRepo(owner, repo);
  return useMutation({
    mutationFn: (id: string) => api.delete(`/repositories/${owner}/${repo}/webhooks/${id}`),
    onSuccess: () => invalidate(['repo-webhooks']),
  });
}

// ───────────────────────── Protected branches ─────────────────────────

export function useProtectedBranches(owner: string, repo: string) {
  return useQuery({
    queryKey: ['protected-branches', owner, repo],
    queryFn: () => api.get<ProtectedBranch[]>(`/repositories/${owner}/${repo}/protected-branches`),
    enabled: Boolean(owner && repo),
  });
}

export function useAddProtectedBranch(owner: string, repo: string) {
  const invalidate = useInvalidateRepo(owner, repo);
  return useMutation({
    mutationFn: (input: {
      pattern: string;
      requireApprovals?: number;
      allowForcePush?: boolean;
      allowDeletions?: boolean;
      allowMerges?: boolean;
    }) => api.post<ProtectedBranch>(`/repositories/${owner}/${repo}/protected-branches`, input),
    onSuccess: () => invalidate(['protected-branches']),
  });
}

export function useDeleteProtectedBranch(owner: string, repo: string) {
  const invalidate = useInvalidateRepo(owner, repo);
  return useMutation({
    mutationFn: (id: string) => api.delete(`/repositories/${owner}/${repo}/protected-branches/${id}`),
    onSuccess: () => invalidate(['protected-branches']),
  });
}

// ───────────────────────── General / danger ─────────────────────────

export function useUpdateRepository(owner: string, repo: string) {
  const invalidate = useInvalidateRepo(owner, repo);
  return useMutation({
    mutationFn: (input: { description?: string | null; visibility?: 'public' | 'private' }) =>
      api.patch(`/repositories/${owner}/${repo}`, input),
    onSuccess: () => invalidate(['repository']),
  });
}

export function useDeleteRepository(owner: string, repo: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(`/repositories/${owner}/${repo}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['repositories'] });
    },
  });
}
