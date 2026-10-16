import { useQuery } from '@tanstack/react-query';
import type { Issue, Paginated } from '@flygit/shared';
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
