import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext';
import { useT } from '../i18n/i18n';
import { Button } from '../components/ui/Button';
import { TextField } from '../components/ui/Field';
import {
  useAdminStats,
  useAdminUsers,
  useSetUserActive,
  useSetUserRole,
  useDeleteUser,
  type AdminUser,
} from '../features/admin/api';

/** Platform admin panel at `/admin`. */
export function AdminPage() {
  const t = useT();
  const { user } = useAuth();
  const { data: stats } = useAdminStats();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [active, setActive] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useAdminUsers({ q, role, active, page });

  if (user?.role !== 'admin') {
    return <p className="px-4 py-10 text-center text-sm text-text-muted">{t('admin.forbidden')}</p>;
  }

  const cards = stats
    ? [
        { label: t('admin.users'), value: stats.users },
        { label: t('admin.organizations'), value: stats.organizations },
        { label: t('admin.repositories'), value: stats.repositories },
        { label: t('admin.issues'), value: stats.issues },
        { label: t('admin.mergeRequests'), value: stats.mergeRequests },
        { label: t('admin.activeSessions'), value: stats.activeSessions },
      ]
    : [];

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t('admin.title')}</h1>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <div key={c.label} className="rounded-[var(--radius-md)] border border-border p-4">
            <p className="text-2xl font-semibold">{c.value}</p>
            <p className="mt-0.5 text-xs text-text-muted">{c.label}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <TextField label={t('admin.search')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="username, email…" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text">{t('repoSettings.role')}</label>
          <select value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} className="rounded-[var(--radius)] border border-border bg-bg-subtle px-3 py-2 text-sm focus:border-accent focus:outline-none">
            <option value="">{t('common.all')}</option>
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text">{t('admin.status')}</label>
          <select value={active} onChange={(e) => { setActive(e.target.value); setPage(1); }} className="rounded-[var(--radius)] border border-border bg-bg-subtle px-3 py-2 text-sm focus:border-accent focus:outline-none">
            <option value="">{t('common.all')}</option>
            <option value="true">{t('admin.active')}</option>
            <option value="false">{t('admin.inactive')}</option>
          </select>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-[var(--radius-md)] border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface text-left text-xs text-text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">{t('admin.user')}</th>
              <th className="px-3 py-2 font-medium">{t('repoSettings.role')}</th>
              <th className="px-3 py-2 font-medium">{t('admin.status')}</th>
              <th className="px-3 py-2 font-medium">{t('admin.registered')}</th>
              <th className="px-3 py-2 font-medium">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-text-muted">{t('common.loading')}</td></tr>
            ) : !data?.items.length ? (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-text-muted">{t('admin.noUsers')}</td></tr>
            ) : (
              data.items.map((u) => <UserRow key={u.id} u={u} />)
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <Button variant="ghost" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            {t('common.previous')}
          </Button>
          <span className="text-text-muted">
            {page} / {totalPages}
          </span>
          <Button variant="ghost" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
            {t('common.next')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function UserRow({ u }: { u: AdminUser }) {
  const t = useT();
  const setActive = useSetUserActive();
  const setRole = useSetUserRole();
  const remove = useDeleteUser();
  const [confirming, setConfirming] = useState(false);

  return (
    <tr className="hover:bg-surface-hover">
      <td className="px-3 py-2">
        <Link to={`/users/${u.username}`} className="font-medium hover:text-accent">
          {u.displayName || u.username}
        </Link>
        <p className="text-xs text-text-muted">{u.email}</p>
      </td>
      <td className="px-3 py-2">
        <select
          value={u.role}
          onChange={(e) => setRole.mutate({ id: u.id, role: e.target.value as 'admin' | 'user' })}
          className="rounded-[var(--radius)] border border-border bg-bg-subtle px-2 py-1 text-xs focus:border-accent focus:outline-none"
        >
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
      </td>
      <td className="px-3 py-2">
        {u.isActive ? (
          <span className="rounded-full border border-success/40 px-2 py-0.5 text-xs text-success">{t('admin.active')}</span>
        ) : (
          <span className="rounded-full border border-danger/40 px-2 py-0.5 text-xs text-danger">{t('admin.inactive')}</span>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-text-muted">{new Date(u.createdAt).toLocaleDateString()}</td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          <Button variant="ghost" onClick={() => setActive.mutate({ id: u.id, isActive: !u.isActive })} loading={setActive.isPending}>
            {u.isActive ? t('admin.deactivate') : t('admin.activate')}
          </Button>
          {confirming ? (
            <Button variant="danger" onClick={() => remove.mutate(u.id)} loading={remove.isPending}>
              {t('admin.confirmDelete')}
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => setConfirming(true)}>
              {t('common.delete')}
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}
