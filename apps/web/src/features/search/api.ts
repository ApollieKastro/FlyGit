import { useQuery } from '@tanstack/react-query';
import type { UserPublic } from '@flygit/shared';
import { api } from '../../lib/api';

export interface UserSearchResult {
  items: UserPublic[];
  total: number;
  page: number;
  pageSize: number;
}

/** Global user search at `/users/search`. */
export function useUserSearch(q: string) {
  return useQuery({
    queryKey: ['user-search', q],
    queryFn: () => api.get<UserSearchResult>(`/users/search?q=${encodeURIComponent(q)}&pageSize=20`),
    enabled: q.trim().length > 0,
  });
}
