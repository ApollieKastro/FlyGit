import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

export interface NotificationActor {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  url: string | null;
  isRead: boolean;
  actor: NotificationActor | null;
  createdAt: string;
}

export interface NotificationListResponse {
  items: NotificationItem[];
  total: number;
  unread: number;
  page: number;
  pageSize: number;
}

export function useNotifications(unreadOnly: boolean) {
  return useQuery({
    queryKey: ['notifications', unreadOnly],
    queryFn: () =>
      api.get<NotificationListResponse>(
        `/notifications?pageSize=50${unreadOnly ? '&unread=true' : ''}`,
      ),
  });
}

export function useUnreadCount(enabled = true) {
  return useQuery({
    queryKey: ['unread-count'],
    queryFn: () => api.get<{ count: number }>('/notifications/unread-count'),
    enabled,
    refetchInterval: 60_000,
  });
}

function useInvalidateNotifications() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['notifications'] });
    void qc.invalidateQueries({ queryKey: ['unread-count'] });
  };
}

export function useMarkNotificationsRead() {
  const invalidate = useInvalidateNotifications();
  return useMutation({
    mutationFn: (ids: string[] | 'all') => api.post('/notifications/read', { ids }),
    onSuccess: invalidate,
  });
}

export function useMarkNotificationsUnread() {
  const invalidate = useInvalidateNotifications();
  return useMutation({
    mutationFn: (ids: string[]) => api.post('/notifications/unread', { ids }),
    onSuccess: invalidate,
  });
}

export function useDeleteNotifications() {
  const invalidate = useInvalidateNotifications();
  return useMutation({
    mutationFn: (ids: string[]) => api.delete(`/notifications?ids=${ids.join(',')}`),
    onSuccess: invalidate,
  });
}
