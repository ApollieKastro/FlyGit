import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  useOrganization,
  useOrgMembers,
  useUpdateMemberRole,
  useRemoveMember,
  useOrgInvitations,
  useInviteMember,
  useRevokeInvitation,
  useOrgTeams,
  useCreateTeam,
  useDeleteTeam,
} from '../features/organizations/api';
import { useT } from '../i18n/i18n';
import { Button } from '../components/ui/Button';
import { TextField } from '../components/ui/Field';
import { isApiError } from '../features/auth/AuthContext';

type Tab = 'members' | 'teams' | 'invitations';
const ORG_ROLES = ['owner', 'maintainer', 'member', 'viewer'] as const;

/** Organization detail at `/organizations/:slug`. */
export function OrganizationDetailPage() {
  const { slug = '' } = useParams();
  const t = useT();
  const { data: org, isLoading } = useOrganization(slug);
  const [tab, setTab] = useState<Tab>('members');

  if (isLoading) {
    return <p className="px-4 py-10 text-center text-sm text-text-muted">{t('common.loading')}</p>;
  }
  if (!org) {
    return <p className="px-4 py-10 text-center text-sm text-text-muted">{t('common.error')}</p>;
  }

  const canManage = org.yourRole === 'owner' || org.yourRole === 'maintainer';
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'members', label: t('orgs.members') },
    { id: 'teams', label: t('orgs.teams') },
    { id: 'invitations', label: t('orgs.invitations') },
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <header className="flex items-start gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-2xl font-semibold text-text-muted">
          {org.name[0]?.toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{org.name}</h1>
          <p className="text-sm text-text-muted">@{org.slug}</p>
          {org.description ? <p className="mt-2 text-sm text-text">{org.description}</p> : null}
          {org.website ? (
            <a href={org.website} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm text-accent hover:underline">
              {org.website}
            </a>
          ) : null}
          <p className="mt-2 text-xs text-text-muted">
            {org.membersCount} {t('orgs.members').toLowerCase()} · {org.repositoriesCount} {t('nav.repositories').toLowerCase()}
            {org.yourRole ? ` · ${t('orgs.yourRole')}: ${org.yourRole}` : ''}
          </p>
        </div>
        <Link to={`/repositories?org=${org.slug}`} className="shrink-0 text-sm text-accent hover:underline">
          {t('orgs.viewRepos')}
        </Link>
      </header>

      <nav className="mt-6 flex gap-1 border-b border-border text-sm">
        {tabs.map((x) => (
          <button
            key={x.id}
            onClick={() => setTab(x.id)}
            className={`border-b-2 px-3 py-2 transition-colors ${
              tab === x.id ? 'border-accent text-text' : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            {x.label}
          </button>
        ))}
      </nav>

      <div className="mt-6">
        {tab === 'members' && <MembersTab slug={slug} canManage={canManage} />}
        {tab === 'teams' && <TeamsTab slug={slug} canManage={canManage} />}
        {tab === 'invitations' && <InvitationsTab slug={slug} canManage={canManage} />}
      </div>
    </div>
  );
}

function MembersTab({ slug, canManage }: { slug: string; canManage: boolean }) {
  const t = useT();
  const { data: members, isLoading } = useOrgMembers(slug);
  const updateRole = useUpdateMemberRole(slug);
  const removeMember = useRemoveMember(slug);

  return (
    <div className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
      {isLoading ? (
        <p className="px-4 py-6 text-center text-sm text-text-muted">{t('common.loading')}</p>
      ) : !members?.length ? (
        <p className="px-4 py-6 text-center text-sm text-text-muted">{t('orgs.noMembers')}</p>
      ) : (
        members.map((m) => (
          <div key={m.user.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Link to={`/users/${m.user.username}`} className="min-w-0 flex-1 truncate font-medium hover:text-accent">
              {m.user.displayName || m.user.username}
            </Link>
            <span className="text-xs text-text-muted">@{m.user.username}</span>
            {canManage ? (
              <select
                value={m.role}
                onChange={(e) => updateRole.mutate({ username: m.user.username, role: e.target.value })}
                className="rounded-[var(--radius)] border border-border bg-bg-subtle px-2 py-1 text-xs focus:border-accent focus:outline-none"
              >
                {ORG_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            ) : (
              <span className="rounded-full border border-border px-2 py-0.5 text-xs text-text-muted">{m.role}</span>
            )}
            {canManage && m.role !== 'owner' ? (
              <Button variant="danger" onClick={() => removeMember.mutate(m.user.username)} loading={removeMember.isPending}>
                {t('repoSettings.remove')}
              </Button>
            ) : null}
          </div>
        ))
      )}
    </div>
  );
}

function TeamsTab({ slug, canManage }: { slug: string; canManage: boolean }) {
  const t = useT();
  const { data: teams, isLoading } = useOrgTeams(slug);
  const createTeam = useCreateTeam(slug);
  const deleteTeam = useDeleteTeam(slug);
  const [name, setName] = useState('');
  const [teamSlug, setTeamSlug] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createTeam.mutateAsync({ name, slug: teamSlug });
      setName('');
      setTeamSlug('');
    } catch (err) {
      setError(isApiError(err) ? err.message : t('common.error'));
    }
  }

  return (
    <div>
      {canManage ? (
        <form onSubmit={submit} className="mb-6 flex max-w-lg flex-wrap items-end gap-3">
          <div className="min-w-[160px] flex-1">
            <TextField label={t('orgs.teamName')} value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="min-w-[140px] flex-1">
            <TextField label={t('orgs.teamSlug')} value={teamSlug} onChange={(e) => setTeamSlug(e.target.value)} placeholder="backend" required />
          </div>
          <Button type="submit" loading={createTeam.isPending} disabled={!name.trim() || !teamSlug.trim()}>
            {t('orgs.createTeam')}
          </Button>
        </form>
      ) : null}
      {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}

      <div className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
        {isLoading ? (
          <p className="px-4 py-6 text-center text-sm text-text-muted">{t('common.loading')}</p>
        ) : !teams?.length ? (
          <p className="px-4 py-6 text-center text-sm text-text-muted">{t('orgs.noTeams')}</p>
        ) : (
          teams.map((team) => (
            <div key={team.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{team.name}</p>
                <p className="text-xs text-text-muted">
                  @{team.slug} · {team.membersCount} {t('orgs.members').toLowerCase()}
                </p>
                {team.description ? <p className="mt-0.5 text-xs text-text-muted">{team.description}</p> : null}
              </div>
              {canManage ? (
                <Button variant="danger" onClick={() => deleteTeam.mutate(team.id)} loading={deleteTeam.isPending}>
                  {t('common.delete')}
                </Button>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function InvitationsTab({ slug, canManage }: { slug: string; canManage: boolean }) {
  const t = useT();
  const { data: invitations, isLoading } = useOrgInvitations(slug);
  const invite = useInviteMember(slug);
  const revoke = useRevokeInvitation(slug);
  const [identifier, setIdentifier] = useState('');
  const [role, setRole] = useState<string>('member');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await invite.mutateAsync({ identifier, role });
      setIdentifier('');
    } catch (err) {
      setError(isApiError(err) ? err.message : t('common.error'));
    }
  }

  return (
    <div>
      {canManage ? (
        <form onSubmit={submit} className="mb-6 flex max-w-lg flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1">
            <TextField label={t('orgs.inviteIdentifier')} value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="user@example.com" hint={t('orgs.inviteHint')} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text">{t('repoSettings.role')}</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="rounded-[var(--radius)] border border-border bg-bg-subtle px-3 py-2 text-sm focus:border-accent focus:outline-none"
            >
              {ORG_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" loading={invite.isPending} disabled={!identifier.trim()}>
            {t('orgs.sendInvite')}
          </Button>
        </form>
      ) : null}
      {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}

      <div className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
        {isLoading ? (
          <p className="px-4 py-6 text-center text-sm text-text-muted">{t('common.loading')}</p>
        ) : !invitations?.length ? (
          <p className="px-4 py-6 text-center text-sm text-text-muted">{t('orgs.noInvitations')}</p>
        ) : (
          invitations.map((inv) => (
            <div key={inv.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{inv.user?.displayName || inv.email || inv.user?.username || '—'}</p>
                <p className="text-xs text-text-muted">
                  {t('orgs.invitedBy')} {inv.invitedBy?.username} · {new Date(inv.expiresAt).toLocaleDateString()}
                </p>
              </div>
              <span className="rounded-full border border-border px-2 py-0.5 text-xs text-text-muted">{inv.role}</span>
              {canManage ? (
                <Button variant="danger" onClick={() => revoke.mutate(inv.id)} loading={revoke.isPending}>
                  {t('orgs.revoke')}
                </Button>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
