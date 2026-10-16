import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useRepository } from '../features/repositories/api';
import {
  useRepoMembers,
  useAddRepoMember,
  useRemoveRepoMember,
  useRepoWebhooks,
  useCreateWebhook,
  useDeleteWebhook,
  useProtectedBranches,
  useAddProtectedBranch,
  useDeleteProtectedBranch,
  useUpdateRepository,
  useDeleteRepository,
} from '../features/repo-settings/api';
import { useT } from '../i18n/i18n';
import { Button } from '../components/ui/Button';
import { TextField, TextArea } from '../components/ui/Field';
import { isApiError } from '../features/auth/AuthContext';

type Section = 'general' | 'members' | 'webhooks' | 'branches' | 'danger';

const REPO_ROLES = ['admin', 'maintainer', 'developer', 'reporter', 'guest'] as const;
const WEBHOOK_EVENTS = ['push', 'issue', 'merge_request', 'release', 'member'] as const;

/** Repository settings at `/repositories/:owner/:repo/settings`. */
export function RepoSettingsPage() {
  const { owner = '', repo = '' } = useParams();
  const t = useT();
  const { data: repoData } = useRepository(owner, repo);
  const [section, setSection] = useState<Section>('general');

  const sections: Array<{ id: Section; label: string }> = [
    { id: 'general', label: t('repoSettings.general') },
    { id: 'members', label: t('repoSettings.members') },
    { id: 'webhooks', label: t('repoSettings.webhooks') },
    { id: 'branches', label: t('repoSettings.protectedBranches') },
    { id: 'danger', label: t('repoSettings.dangerZone') },
  ];

  const canManage = repoData?.yourRole === 'admin' || repoData?.yourRole === 'maintainer';

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <nav className="text-sm text-text-muted">
        <Link to={`/repositories/${owner}/${repo}`} className="hover:text-text">
          {owner}/{repo}
        </Link>
        <span className="mx-1">/</span>
        <span className="text-text">{t('repoSettings.title')}</span>
      </nav>

      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{t('repoSettings.title')}</h1>

      {!canManage ? (
        <p className="mt-4 text-sm text-danger">{t('repoSettings.noPermission')}</p>
      ) : null}

      <nav className="mt-4 flex flex-wrap gap-1 border-b border-border text-sm">
        {sections.map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={`border-b-2 px-3 py-2 transition-colors ${
              section === s.id
                ? 'border-accent text-text'
                : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div className="mt-6">
        {section === 'general' && <GeneralSection owner={owner} repo={repo} disabled={!canManage} />}
        {section === 'members' && <MembersSection owner={owner} repo={repo} />}
        {section === 'webhooks' && <WebhooksSection owner={owner} repo={repo} />}
        {section === 'branches' && <ProtectedBranchesSection owner={owner} repo={repo} />}
        {section === 'danger' && <DangerSection owner={owner} repo={repo} disabled={!canManage} />}
      </div>
    </div>
  );
}

function GeneralSection({ owner, repo, disabled }: { owner: string; repo: string; disabled: boolean }) {
  const t = useT();
  const { data } = useRepository(owner, repo);
  const update = useUpdateRepository(owner, repo);
  const [description, setDescription] = useState<string | undefined>(undefined);
  const [visibility, setVisibility] = useState<'public' | 'private' | undefined>(undefined);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!data) return <p className="text-sm text-text-muted">{t('common.loading')}</p>;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await update.mutateAsync({
        ...(description !== undefined ? { description: description || null } : {}),
        ...(visibility !== undefined ? { visibility } : {}),
      });
      setSaved(true);
    } catch (err) {
      setError(isApiError(err) ? err.message : t('common.error'));
    }
  }

  return (
    <form onSubmit={submit} className="flex max-w-lg flex-col gap-4">
      <TextField label={t('repo.name')} value={data.name} disabled hint={t('repoSettings.renameHint')} />
      <TextArea
        label={t('repo.descriptionLabel')}
        value={description ?? data.description ?? ''}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
      />
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-text">{t('repo.visibility')}</span>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={(visibility ?? data.visibility) === 'private'}
              onChange={() => setVisibility('private')}
              disabled={disabled}
              className="accent-[var(--accent)]"
            />
            {t('common.private')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={(visibility ?? data.visibility) === 'public'}
              onChange={() => setVisibility('public')}
              disabled={disabled}
              className="accent-[var(--accent)]"
            />
            {t('common.public')}
          </label>
        </div>
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {saved ? <p className="text-sm text-success">{t('settings.saved')}</p> : null}
      <div>
        <Button type="submit" loading={update.isPending} disabled={disabled}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}

function MembersSection({ owner, repo }: { owner: string; repo: string }) {
  const t = useT();
  const { data: members, isLoading } = useRepoMembers(owner, repo);
  const addMember = useAddRepoMember(owner, repo);
  const removeMember = useRemoveRepoMember(owner, repo);
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<string>('developer');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await addMember.mutateAsync({ username, role });
      setUsername('');
    } catch (err) {
      setError(isApiError(err) ? err.message : t('common.error'));
    }
  }

  return (
    <div>
      <form onSubmit={submit} className="mb-6 flex max-w-lg flex-wrap items-end gap-3">
        <div className="min-w-[180px] flex-1">
          <TextField label={t('repoSettings.username')} value={username} onChange={(e) => setUsername(e.target.value)} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text">{t('repoSettings.role')}</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="rounded-[var(--radius)] border border-border bg-bg-subtle px-3 py-2 text-sm focus:border-accent focus:outline-none"
          >
            {REPO_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" loading={addMember.isPending} disabled={!username.trim()}>
          {t('repoSettings.addMember')}
        </Button>
      </form>
      {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}

      <div className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
        {isLoading ? (
          <p className="px-4 py-6 text-center text-sm text-text-muted">{t('common.loading')}</p>
        ) : !members?.length ? (
          <p className="px-4 py-6 text-center text-sm text-text-muted">{t('repoSettings.noMembers')}</p>
        ) : (
          members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 px-4 py-3">
              <Link to={`/users/${m.username}`} className="min-w-0 flex-1 truncate font-medium hover:text-accent">
                {m.displayName || m.username}
              </Link>
              <span className="rounded-full border border-border px-2 py-0.5 text-xs text-text-muted">{m.role}</span>
              <Button variant="danger" onClick={() => removeMember.mutate(m.username)} loading={removeMember.isPending}>
                {t('repoSettings.remove')}
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function WebhooksSection({ owner, repo }: { owner: string; repo: string }) {
  const t = useT();
  const { data: hooks, isLoading } = useRepoWebhooks(owner, repo);
  const createHook = useCreateWebhook(owner, repo);
  const deleteHook = useDeleteWebhook(owner, repo);
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [events, setEvents] = useState<string[]>(['push']);
  const [error, setError] = useState<string | null>(null);

  function toggleEvent(ev: string) {
    setEvents((prev) => (prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createHook.mutateAsync({ url, secret: secret || undefined, events, active: true });
      setUrl('');
      setSecret('');
    } catch (err) {
      setError(isApiError(err) ? err.message : t('common.error'));
    }
  }

  return (
    <div>
      <form onSubmit={submit} className="mb-6 flex max-w-lg flex-col gap-4">
        <TextField label={t('repoSettings.webhookUrl')} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hook" required />
        <TextField label={t('repoSettings.webhookSecret')} value={secret} onChange={(e) => setSecret(e.target.value)} hint={t('repoSettings.webhookSecretHint')} />
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-text">{t('repoSettings.events')}</span>
          <div className="flex flex-wrap gap-3">
            {WEBHOOK_EVENTS.map((ev) => (
              <label key={ev} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={events.includes(ev)} onChange={() => toggleEvent(ev)} className="accent-[var(--accent)]" />
                <code className="text-xs">{ev}</code>
              </label>
            ))}
          </div>
        </div>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <div>
          <Button type="submit" loading={createHook.isPending} disabled={!url.trim() || !events.length}>
            {t('repoSettings.addWebhook')}
          </Button>
        </div>
      </form>

      <div className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
        {isLoading ? (
          <p className="px-4 py-6 text-center text-sm text-text-muted">{t('common.loading')}</p>
        ) : !hooks?.length ? (
          <p className="px-4 py-6 text-center text-sm text-text-muted">{t('repoSettings.noWebhooks')}</p>
        ) : (
          hooks.map((h) => (
            <div key={h.id} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-sm">{h.url}</p>
                <p className="mt-0.5 text-xs text-text-muted">{h.events.join(', ')}</p>
              </div>
              <Button variant="danger" onClick={() => deleteHook.mutate(h.id)} loading={deleteHook.isPending}>
                {t('common.delete')}
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ProtectedBranchesSection({ owner, repo }: { owner: string; repo: string }) {
  const t = useT();
  const { data: rules, isLoading } = useProtectedBranches(owner, repo);
  const addRule = useAddProtectedBranch(owner, repo);
  const deleteRule = useDeleteProtectedBranch(owner, repo);
  const [pattern, setPattern] = useState('');
  const [approvals, setApprovals] = useState(1);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await addRule.mutateAsync({ pattern, requireApprovals: approvals });
      setPattern('');
    } catch (err) {
      setError(isApiError(err) ? err.message : t('common.error'));
    }
  }

  return (
    <div>
      <form onSubmit={submit} className="mb-6 flex max-w-lg flex-wrap items-end gap-3">
        <div className="min-w-[180px] flex-1">
          <TextField label={t('repoSettings.pattern')} value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="main" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text">{t('repoSettings.approvals')}</label>
          <input
            type="number"
            min={0}
            max={10}
            value={approvals}
            onChange={(e) => setApprovals(Number(e.target.value))}
            className="w-20 rounded-[var(--radius)] border border-border bg-bg-subtle px-3 py-2 text-sm focus:border-accent focus:outline-none"
          />
        </div>
        <Button type="submit" loading={addRule.isPending} disabled={!pattern.trim()}>
          {t('repoSettings.addRule')}
        </Button>
      </form>
      {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}

      <div className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
        {isLoading ? (
          <p className="px-4 py-6 text-center text-sm text-text-muted">{t('common.loading')}</p>
        ) : !rules?.length ? (
          <p className="px-4 py-6 text-center text-sm text-text-muted">{t('repoSettings.noRules')}</p>
        ) : (
          rules.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3">
              <code className="min-w-0 flex-1 truncate rounded bg-bg-subtle px-2 py-0.5 text-sm">{r.pattern}</code>
              <span className="text-xs text-text-muted">
                {r.requireApprovals} {t('repoSettings.approvals')}
              </span>
              <Button variant="danger" onClick={() => deleteRule.mutate(r.id)} loading={deleteRule.isPending}>
                {t('common.delete')}
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function DangerSection({ owner, repo, disabled }: { owner: string; repo: string; disabled: boolean }) {
  const t = useT();
  const navigate = useNavigate();
  const deleteRepo = useDeleteRepository(owner, repo);
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const expected = `${owner}/${repo}`;

  async function handleDelete() {
    setError(null);
    try {
      await deleteRepo.mutateAsync();
      navigate('/repositories');
    } catch (err) {
      setError(isApiError(err) ? err.message : t('common.error'));
    }
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-danger/40 p-4">
      <h3 className="font-semibold text-danger">{t('repoSettings.deleteRepo')}</h3>
      <p className="mt-1 text-sm text-text-muted">{t('repoSettings.deleteWarning')}</p>
      <div className="mt-4 flex max-w-md flex-col gap-3">
        <TextField
          label={t('repoSettings.typeToConfirm')}
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={expected}
          hint={expected}
        />
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <div>
          <Button variant="danger" onClick={handleDelete} loading={deleteRepo.isPending} disabled={disabled || confirmText !== expected}>
            {t('repoSettings.deleteRepo')}
          </Button>
        </div>
      </div>
    </div>
  );
}
