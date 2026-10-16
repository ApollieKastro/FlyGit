import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  MergeRequest,
  MergeRequestCommit,
  MergeRequestDetail,
  MergeRequestDiff,
  Paginated,
} from '@flygit/shared';
import { api } from '../../lib/api';

interface MrListParams {
  status?: 'open' | 'closed' | 'merged' | 'all';
  q?: string;
  author?: string;
  sort?: 'created' | 'updated';
  direction?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

function buildQuery(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const str = search.toString();
  return str ? `?${str}` : '';
}

export function useMergeRequests(owner: string, repo: string, params: MrListParams = {}) {
  return useQuery({
    queryKey: ['merge-requests', owner, repo, params],
    queryFn: () =>
      api.get<Paginated<MergeRequest>>(
        `/repositories/${owner}/${repo}/merge-requests${buildQuery(params)}`,
      ),
    enabled: Boolean(owner && repo),
  });
}

export function useMergeRequest(owner: string, repo: string, number: number | string) {
  return useQuery({
    queryKey: ['merge-request', owner, repo, number],
    queryFn: () =>
      api.get<MergeRequestDetail>(`/repositories/${owner}/${repo}/merge-requests/${number}`),
    enabled: Boolean(owner && repo && number),
  });
}

export function useMergeRequestDiff(owner: string, repo: string, number: number | string) {
  return useQuery({
    queryKey: ['merge-request-diff', owner, repo, number],
    queryFn: () =>
      api.get<MergeRequestDiff>(`/repositories/${owner}/${repo}/merge-requests/${number}/diff`),
    enabled: Boolean(owner && repo && number),
  });
}

export function useMergeRequestCommits(owner: string, repo: string, number: number | string) {
  return useQuery({
    queryKey: ['merge-request-commits', owner, repo, number],
    queryFn: () =>
      api.get<MergeRequestCommit[]>(
        `/repositories/${owner}/${repo}/merge-requests/${number}/commits`,
      ),
    enabled: Boolean(owner && repo && number),
  });
}

function useInvalidateMr(owner: string, repo: string, number?: number | string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['merge-requests', owner, repo] });
    if (number) {
      void qc.invalidateQueries({ queryKey: ['merge-request', owner, repo, number] });
      void qc.invalidateQueries({ queryKey: ['merge-request-diff', owner, repo, number] });
    }
  };
}

export function useMergeRequestActions(owner: string, repo: string, number: number | string) {
  const invalidate = useInvalidateMr(owner, repo, number);
  const merge = useMutation({
    mutationFn: (input: { strategy?: 'merge' | 'squash' | 'rebase'; deleteSourceBranch?: boolean }) =>
      api.post<MergeRequestDetail>(`/repositories/${owner}/${repo}/merge-requests/${number}/merge`, {
        strategy: input.strategy ?? 'merge',
        deleteSourceBranch: input.deleteSourceBranch ?? true,
      }),
    onSuccess: invalidate,
  });
  const close = useMutation({
    mutationFn: () => api.post<MergeRequest>(`/repositories/${owner}/${repo}/merge-requests/${number}/close`),
    onSuccess: invalidate,
  });
  const reopen = useMutation({
    mutationFn: () => api.post<MergeRequest>(`/repositories/${owner}/${repo}/merge-requests/${number}/reopen`),
    onSuccess: invalidate,
  });
  return { merge, close, reopen };
}

export function useCreateMergeRequest(owner: string, repo: string) {
  const invalidate = useInvalidateMr(owner, repo);
  return useMutation({
    mutationFn: (input: {
      sourceBranch: string;
      targetBranch: string;
      title: string;
      description?: string | null;
      draft?: boolean;
    }) =>
      api.post<MergeRequestDetail>(`/repositories/${owner}/${repo}/merge-requests`, {
        ...input,
        autoCloseIssues: true,
      }),
    onSuccess: invalidate,
  });
}
