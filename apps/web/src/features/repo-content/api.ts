import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GitRef, Release, CommitSummary, FileDiff, RepositoryDetail } from '@flygit/shared';
import { api } from '../../lib/api';

export interface CompareResult {
  from: string;
  to: string;
  baseCommit: string | null;
  commits: CommitSummary[];
  files: FileDiff[];
  totalAdditions: number;
  totalDeletions: number;
}

export function useTags(owner: string, repo: string) {
  return useQuery({
    queryKey: ['tags', owner, repo],
    queryFn: () => api.get<GitRef[]>(`/repositories/${owner}/${repo}/tags`),
    enabled: Boolean(owner && repo),
  });
}

function useInvalidateRepoContent(owner: string, repo: string) {
  const qc = useQueryClient();
  return (keys: string[]) => {
    for (const key of keys) void qc.invalidateQueries({ queryKey: [key, owner, repo] });
  };
}

export function useCreateBranch(owner: string, repo: string) {
  const invalidate = useInvalidateRepoContent(owner, repo);
  return useMutation({
    mutationFn: (input: { name: string; from?: string }) =>
      api.post<GitRef>(`/repositories/${owner}/${repo}/branches`, input),
    onSuccess: () => invalidate(['branches']),
  });
}

export function useDeleteBranch(owner: string, repo: string) {
  const invalidate = useInvalidateRepoContent(owner, repo);
  return useMutation({
    mutationFn: (name: string) => api.delete(`/repositories/${owner}/${repo}/branches/${encodeURIComponent(name)}`),
    onSuccess: () => invalidate(['branches']),
  });
}

export function useReleases(owner: string, repo: string) {
  return useQuery({
    queryKey: ['releases', owner, repo],
    queryFn: () => api.get<Release[]>(`/repositories/${owner}/${repo}/releases`),
    enabled: Boolean(owner && repo),
  });
}

export function useCreateRelease(owner: string, repo: string) {
  const invalidate = useInvalidateRepoContent(owner, repo);
  return useMutation({
    mutationFn: (input: { tagName: string; name: string; description?: string | null; draft?: boolean; prerelease?: boolean }) =>
      api.post<Release>(`/repositories/${owner}/${repo}/releases`, input),
    onSuccess: () => invalidate(['releases']),
  });
}

export function useDeleteRelease(owner: string, repo: string) {
  const invalidate = useInvalidateRepoContent(owner, repo);
  return useMutation({
    mutationFn: (id: string) => api.delete(`/repositories/${owner}/${repo}/releases/${id}`),
    onSuccess: () => invalidate(['releases']),
  });
}

export function useCompare(owner: string, repo: string, from: string, to: string) {
  return useQuery({
    queryKey: ['compare', owner, repo, from, to],
    queryFn: () =>
      api.get<CompareResult>(
        `/repositories/${owner}/${repo}/compare?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
    enabled: Boolean(owner && repo && from && to),
  });
}

export function useFork(owner: string, repo: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (targetOrgSlug?: string) =>
      api.post<RepositoryDetail>(`/repositories/${owner}/${repo}/forks`, { targetOrgSlug }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['repositories'] });
    },
  });
}
