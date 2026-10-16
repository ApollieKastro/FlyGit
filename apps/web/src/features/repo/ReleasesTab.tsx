import { useState, type FormEvent } from 'react';
import { useReleases, useCreateRelease, useDeleteRelease } from '../repo-content/api';
import { useT } from '../../i18n/i18n';
import { Button } from '../../components/ui/Button';
import { TextField, TextArea } from '../../components/ui/Field';
import { isApiError } from '../auth/AuthContext';

/** Releases tab: list releases, create, delete. */
export function ReleasesTab({ owner, repo }: { owner: string; repo: string }) {
  const t = useT();
  const { data: releases, isLoading } = useReleases(owner, repo);
  const createRelease = useCreateRelease(owner, repo);
  const deleteRelease = useDeleteRelease(owner, repo);
  const [open, setOpen] = useState(false);
  const [tagName, setTagName] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [prerelease, setPrerelease] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createRelease.mutateAsync({ tagName, name: name || tagName, description: description || null, prerelease });
      setTagName('');
      setName('');
      setDescription('');
      setPrerelease(false);
      setOpen(false);
    } catch (err) {
      setError(isApiError(err) ? err.message : t('common.error'));
    }
  }

  return (
    <div>
      <div className="mb-4">
        <Button onClick={() => setOpen((v) => !v)}>{t('releases.new')}</Button>
      </div>

      {open ? (
        <form onSubmit={submit} className="mb-6 flex max-w-lg flex-col gap-4 rounded-[var(--radius-md)] border border-border p-4">
          <TextField label={t('releases.tagName')} value={tagName} onChange={(e) => setTagName(e.target.value)} placeholder="v1.0.0" required />
          <TextField label={t('releases.name')} value={name} onChange={(e) => setName(e.target.value)} />
          <TextArea label={t('releases.description')} value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={prerelease} onChange={(e) => setPrerelease(e.target.checked)} className="accent-[var(--accent)]" />
            {t('releases.prerelease')}
          </label>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <div>
            <Button type="submit" loading={createRelease.isPending} disabled={!tagName.trim()}>
              {t('releases.publish')}
            </Button>
          </div>
        </form>
      ) : null}

      <div className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
        {isLoading ? (
          <p className="px-4 py-6 text-center text-sm text-text-muted">{t('common.loading')}</p>
        ) : !releases?.length ? (
          <p className="px-4 py-6 text-center text-sm text-text-muted">{t('releases.empty')}</p>
        ) : (
          releases.map((r) => (
            <div key={r.id} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.name}</span>
                  <code className="rounded bg-bg-subtle px-1.5 py-0.5 text-xs">{r.tagName}</code>
                  {r.prerelease ? <span className="rounded-full border border-border px-2 py-0.5 text-xs text-text-muted">{t('releases.prerelease')}</span> : null}
                  {r.draft ? <span className="rounded-full border border-border px-2 py-0.5 text-xs text-text-muted">{t('releases.draft')}</span> : null}
                </div>
                {r.description ? <p className="mt-1 whitespace-pre-wrap text-sm text-text-muted">{r.description}</p> : null}
                <p className="mt-1 text-xs text-text-muted">
                  {r.author?.username} · {r.publishedAt ? new Date(r.publishedAt).toLocaleDateString() : new Date(r.createdAt).toLocaleDateString()}
                </p>
              </div>
              <Button variant="danger" onClick={() => deleteRelease.mutate(r.id)} loading={deleteRelease.isPending}>
                {t('common.delete')}
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
