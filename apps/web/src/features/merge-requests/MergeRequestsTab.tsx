import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMergeRequests } from './api';
import { useT } from '../../i18n/i18n';

type StatusFilter = 'open' | 'merged' | 'closed';

/** Merge requests list tab at `/repositories/:owner/:repo/merge-requests`. */
export function MergeRequestsTab({ owner, repo }: { owner: string; repo: string }) {
  const t = useT();
  const [status, setStatus] = useState<StatusFilter>('open');
  const [query, setQuery] = useState('');
  const { data, isLoading, isError } = useMergeRequests(owner, repo, { status, q: query || undefined });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">{t('mr.title')}</h2>
        <div className="flex items-center gap-1 rounded-[var(--radius)] border border-border p-0.5 text-sm">
          {(['open', 'merged', 'closed'] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`rounded-[6px] px-2.5 py-1 transition-colors ${
                status === s ? 'bg-accent text-white' : 'text-text-muted hover:text-text'
              }`}
            >
              {s === 'open' ? t('mr.open') : s === 'merged' ? t('mr.merged') : t('mr.closed')}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('common.search')}
          className="ml-auto w-56 rounded-[var(--radius)] border border-border bg-bg-subtle px-3 py-1.5 text-sm placeholder:text-text-faint focus:border-accent focus:outline-none"
        />
        <Link
          to={`/repositories/${owner}/${repo}/merge-requests/new`}
          className="rounded-[var(--radius)] bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
        >
          {t('mr.new')}
        </Link>
      </div>

      <div className="mt-4 divide-y divide-border rounded-[var(--radius-md)] border border-border">
        {isLoading ? (
          <p className="px-4 py-8 text-center text-sm text-text-muted">{t('common.loading')}</p>
        ) : isError ? (
          <p className="px-4 py-8 text-center text-sm text-danger">{t('common.error')}</p>
        ) : !data?.items.length ? (
          <p className="px-4 py-8 text-center text-sm text-text-muted">{t('mr.empty')}</p>
        ) : (
          data.items.map((mr) => (
            <Link
              key={mr.id}
              to={`/repositories/${owner}/${repo}/merge-requests/${mr.number}`}
              className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-hover"
            >
              <span
                aria-hidden
                className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                  mr.status === 'open'
                    ? 'bg-success'
                    : mr.status === 'merged'
                      ? 'bg-purple-400'
                      : 'bg-text-faint'
                }`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">
                    {mr.title} <span className="text-text-muted">#{mr.number}</span>
                  </span>
                  {mr.draft ? (
                    <span className="rounded-full border border-border px-2 py-0.5 text-xs text-text-muted">
                      Draft
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-text-muted">
                  {mr.sourceBranch} → {mr.targetBranch} · {t('issues.by')} {mr.author.username} ·{' '}
                  {new Date(mr.createdAt).toLocaleDateString()}
                </p>
              </div>
              <div className="shrink-0 text-xs">
                <span className="text-success">+{mr.additions}</span>{' '}
                <span className="text-danger">-{mr.deletions}</span>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
