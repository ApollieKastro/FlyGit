import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Issue, IssueComment, Paginated } from '@flygit/shared';
import { api } from '../../lib/api';

interface IssueListParams {
  status?: 'open' | 'closed' | 'all';
  q?: string;
  sort?: 'created' | 'updated' | 'comments';
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

export function useIssues(owner: string, repo: string, params: IssueListParams = {}) {
  return useQuery({
    queryKey: ['issues', owner, repo, params],
    queryFn: () =>
      api.get<Paginated<Issue>>(`/repositories/${owner}/${repo}/issues${buildQuery(params)}`),
    enabled: Boolean(owner && repo),
  });
}

export function useIssue(owner: string, repo: string, number: number | string) {
  return useQuery({
    queryKey: ['issue', owner, repo, number],
    queryFn: () => api.get<Issue>(`/repositories/${owner}/${repo}/issues/${number}`),
    enabled: Boolean(owner && repo && number),
  });
}

export function useIssueComments(owner: string, repo: string, number: number | string) {
  return useQuery({
    queryKey: ['issue-comments', owner, repo, number],
    queryFn: () =>
      api.get<IssueComment[]>(`/repositories/${owner}/${repo}/issues/${number}/comments`),
    enabled: Boolean(owner && repo && number),
  });
}

function useInvalidateIssue(owner: string, repo: string, number: number | string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['issue', owner, repo, number] });
    void qc.invalidateQueries({ queryKey: ['issue-comments', owner, repo, number] });
    void qc.invalidateQueries({ queryKey: ['issues', owner, repo] });
  };
}

/** Close or reopen an issue depending on its current status. */
export function useToggleIssueStatus(owner: string, repo: string, number: number | string) {
  const invalidate = useInvalidateIssue(owner, repo, number);
  return useMutation({
    mutationFn: (status: 'open' | 'closed') =>
      api.patch<Issue>(`/repositories/${owner}/${repo}/issues/${number}`, { status }),
    onSuccess: invalidate,
  });
}

export function useAddIssueComment(owner: string, repo: string, number: number | string) {
  const invalidate = useInvalidateIssue(owner, repo, number);
  return useMutation({
    mutationFn: (body: string) =>
      api.post<IssueComment>(`/repositories/${owner}/${repo}/issues/${number}/comments`, { body }),
    onSuccess: invalidate,
  });
}

export function useCreateIssue(owner: string, repo: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; body?: string | null }) =>
      api.post<Issue>(`/repositories/${owner}/${repo}/issues`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['issues', owner, repo] });
    },
  });
}
