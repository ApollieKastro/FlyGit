import { Link } from 'react-router-dom';
import { useT } from '../i18n/i18n';
import { Button } from '../components/ui/Button';
import { useNotifications, useMarkNotificationsRead, useMarkNotificationsUnread, useDeleteNotifications, type NotificationItem } from '../features/notifications/api';
import { useState } from 'react';

/** Notifications list at `/notifications`. */
export function NotificationsPage() {
  const t = useT();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { data, isLoading } = useNotifications(unreadOnly);
  const markRead = useMarkNotificationsRead();
  const markUnread = useMarkNotificationsUnread();
  const remove = useDeleteNotifications();

  const items = data?.items ?? [];

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('notifications.title')}</h1>
        {data && data.unread > 0 ? (
          <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-white">{data.unread}</span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-text-muted">
            <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} className="accent-[var(--accent)]" />
            {t('notifications.unreadOnly')}
          </label>
          <Button variant="ghost" onClick={() => markRead.mutate('all')} loading={markRead.isPending} disabled={!items.length}>
            {t('notifications.markAllRead')}
          </Button>
        </div>
      </div>

      <div className="mt-6 divide-y divide-border rounded-[var(--radius-md)] border border-border">
        {isLoading ? (
          <p className="px-4 py-8 text-center text-sm text-text-muted">{t('common.loading')}</p>
        ) : !items.length ? (
          <p className="px-4 py-8 text-center text-sm text-text-muted">{t('notifications.empty')}</p>
        ) : (
          items.map((n) => (
            <NotificationRow
              key={n.id}
              n={n}
              onToggleRead={() => (n.isRead ? markUnread.mutate([n.id]) : markRead.mutate([n.id]))}
              onDelete={() => remove.mutate([n.id])}
            />
          ))
        )}
      </div>
    </div>
  );
}

function NotificationRow({ n, onToggleRead, onDelete }: { n: NotificationItem; onToggleRead: () => void; onDelete: () => void }) {
  const t = useT();
  const inner = (
    <div className="min-w-0 flex-1">
      <p className={`truncate font-medium ${n.isRead ? 'text-text-muted' : 'text-text'}`}>{n.title}</p>
      {n.body ? <p className="mt-0.5 truncate text-sm text-text-muted">{n.body}</p> : null}
      <p className="mt-0.5 text-xs text-text-muted">{new Date(n.createdAt).toLocaleString()}</p>
    </div>
  );

  return (
    <div className={`flex items-start gap-3 px-4 py-3 ${n.isRead ? 'opacity-70' : ''}`}>
      {!n.isRead ? <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden /> : <span className="mt-1.5 h-2 w-2 shrink-0" aria-hidden />}
      {n.url ? (
        <Link to={n.url} className="min-w-0 flex-1 hover:underline">
          {inner}
        </Link>
      ) : (
        inner
      )}
      <div className="flex shrink-0 gap-1">
        <Button variant="ghost" onClick={onToggleRead} title={n.isRead ? t('notifications.markUnread') : t('notifications.markRead')}>
          {n.isRead ? '○' : '●'}
        </Button>
        <Button variant="ghost" onClick={onDelete} title={t('common.delete')}>
          ✕
        </Button>
      </div>
    </div>
  );
}
