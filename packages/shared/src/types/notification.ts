import type { NotificationType } from '../constants';
import type { UserPublic } from './auth';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  /** Deep link inside FlyGit (e.g. `/org/repo/issues/12`). */
  url: string;
  isRead: boolean;
  actor: UserPublic | null;
  createdAt: string;
}

export interface NotificationPreferences {
  inApp: Record<NotificationType, boolean>;
  email: Record<NotificationType, boolean>;
}
