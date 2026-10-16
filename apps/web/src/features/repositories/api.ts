import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CommitSummary,
  CreateRepositoryInput,
  FileContent,
  FileEntry,
  GitRef,
  Paginated,
  RepositorySummary,
  RepositoryDetail,
} from '@flygit/shared';
import { api } from '../../lib/api';

/** Envelope returned by the tree endpoint. */
export interface TreeResponse {
  ref: string;
  path: string;
  entries: FileEntry[];
}

/** Envelope returned by the commits endpoint. */
export interface CommitsResponse {
  commits: CommitSummary[];
  total: number;
  page: number;
  pageSize: number;
}

interface RepoListParams {
  q?: string;
  ownerType?: 'user' | 'organization';
  ownerSlug?: string;
  visibility?: 'public' | 'private';
  sort?: 'updated' | 'created' | 'name' | 'stars';
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

export function useRepositories(params: RepoListParams = {}) {
  return useQuery({
    queryKey: ['repositories', params],
    queryFn: () => api.get<Paginated<RepositorySummary>>(`/repositories${buildQuery(params)}`),
  });
}

export function useRepository(owner: string, repo: string) {
  return useQuery({
    queryKey: ['repository', owner, repo],
    queryFn: () => api.get<RepositoryDetail>(`/repositories/${owner}/${repo}`),
    enabled: Boolean(owner && repo),
  });
}

export function useBranches(owner: string, repo: string) {
  return useQuery({
    queryKey: ['branches', owner, repo],
    queryFn: () => api.get<GitRef[]>(`/repositories/${owner}/${repo}/branches`),
    enabled: Boolean(owner && repo),
  });
}

export function useTree(owner: string, repo: string, ref?: string, path?: string) {
  return useQuery({
    queryKey: ['tree', owner, repo, ref, path],
    queryFn: () =>
      api.get<TreeResponse>(
        `/repositories/${owner}/${repo}/content${buildQuery({ ref, path })}`,
      ),
    enabled: Boolean(owner && repo),
  });
}

export function useFile(owner: string, repo: string, path: string, ref?: string) {
  return useQuery({
    queryKey: ['file', owner, repo, path, ref],
    queryFn: () =>
      api.get<FileContent>(`/repositories/${owner}/${repo}/content${buildQuery({ ref, path })}`),
    enabled: Boolean(owner && repo && path),
  });
}

export function useReadme(owner: string, repo: string, ref?: string) {
  return useQuery({
    queryKey: ['readme', owner, repo, ref],
    queryFn: () =>
      api.get<{ ref: string; content: FileContent | null }>(
        `/repositories/${owner}/${repo}/readme${buildQuery({ ref })}`,
      ),
    enabled: Boolean(owner && repo),
  });
}

export function useCommits(owner: string, repo: string, ref?: string, page = 1) {
  return useQuery({
    queryKey: ['commits', owner, repo, ref, page],
    queryFn: () =>
      api.get<CommitsResponse>(
        `/repositories/${owner}/${repo}/commits${buildQuery({ ref, page })}`,
      ),
    enabled: Boolean(owner && repo),
  });
}

export function useCreateRepository() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRepositoryInput) => api.post<RepositoryDetail>('/repositories', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['repositories'] });
    },
  });
}

export function useToggleStar(owner: string, repo: string, starred: boolean) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      starred
        ? api.delete<void>(`/repositories/${owner}/${repo}/star`)
        : api.post<void>(`/repositories/${owner}/${repo}/star`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['repository', owner, repo] });
    },
  });
}
