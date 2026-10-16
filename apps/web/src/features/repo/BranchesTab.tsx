import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useBranches } from '../repositories/api';
import { useCreateBranch, useDeleteBranch } from '../repo-content/api';
import { useT } from '../../i18n/i18n';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/Field';
import { isApiError } from '../auth/AuthContext';

/** Branches tab: list branches, create a new one, delete (non-default). */
export function BranchesTab({ owner, repo, defaultBranch }: { owner: string; repo: string; defaultBranch: string }) {
  const t = useT();
  const { data: branches, isLoading } = useBranches(owner, repo);
  const createBranch = useCreateBranch(owner, repo);
  const deleteBranch = useDeleteBranch(owner, repo);
  const [name, setName] = useState('');
  const [from, setFrom] = useState(defaultBranch);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createBranch.mutateAsync({ name, from });
      setName('');
    } catch (err) {
      setError(isApiError(err) ? err.message : t('common.error'));
    }
  }

  return (
    <div>
      <form onSubmit={submit} className="mb-6 flex max-w-lg flex-wrap items-end gap-3">
        <div className="min-w-[160px] flex-1">
          <TextField label={t('branches.newName')} value={name} onChange={(e) => setName(e.target.value)} placeholder="feature-x" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text">{t('branches.from')}</label>
          <select
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-[var(--radius)] border border-border bg-bg-subtle px-3 py-2 text-sm focus:border-accent focus:outline-none"
          >
            {(branches ?? []).map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" loading={createBranch.isPending} disabled={!name.trim()}>
          {t('branches.create')}
        </Button>
      </form>
      {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}

      <div className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
        {isLoading ? (
          <p className="px-4 py-6 text-center text-sm text-text-muted">{t('common.loading')}</p>
        ) : !branches?.length ? (
          <p className="px-4 py-6 text-center text-sm text-text-muted">{t('branches.empty')}</p>
        ) : (
          branches.map((b) => (
            <div key={b.name} className="flex items-center gap-3 px-4 py-3">
              <Link
                to={`/repositories/${owner}/${repo}?ref=${encodeURIComponent(b.name)}`}
                className="min-w-0 flex-1 truncate font-medium hover:text-accent"
              >
                {b.name}
              </Link>
              {b.isDefault ? (
                <span className="rounded-full border border-accent/40 px-2 py-0.5 text-xs text-accent">{t('branches.default')}</span>
              ) : null}
              {b.protected ? (
                <span className="rounded-full border border-border px-2 py-0.5 text-xs text-text-muted">{t('branches.protected')}</span>
              ) : null}
              {!b.isDefault ? (
                <Button variant="danger" onClick={() => deleteBranch.mutate(b.name)} loading={deleteBranch.isPending}>
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
