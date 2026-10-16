import { useQuery } from '@tanstack/react-query';
import type { MergeRequest, MergeRequestDetail, MergeRequestDiff, Paginated } from '@flygit/shared';
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
