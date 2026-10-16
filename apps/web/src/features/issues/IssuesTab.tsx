import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useIssues } from './api';
import { useT } from '../../i18n/i18n';

type StatusFilter = 'open' | 'closed' | 'all';

/** Issues list tab at `/repositories/:owner/:repo/issues`. */
export function IssuesTab({ owner, repo }: { owner: string; repo: string }) {
  const t = useT();
  const [status, setStatus] = useState<StatusFilter>('open');
  const [query, setQuery] = useState('');
  const { data, isLoading, isError } = useIssues(owner, repo, { status, q: query || undefined });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">{t('issues.title')}</h2>
        <div className="flex items-center gap-1 rounded-[var(--radius)] border border-border p-0.5 text-sm">
          {(['open', 'closed', 'all'] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`rounded-[6px] px-2.5 py-1 transition-colors ${
                status === s ? 'bg-accent text-white' : 'text-text-muted hover:text-text'
              }`}
            >
              {s === 'open' ? t('issues.open') : s === 'closed' ? t('issues.closed') : t('common.search')}
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
          to={`/repositories/${owner}/${repo}/issues/new`}
          className="rounded-[var(--radius)] bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
        >
          {t('issues.new')}
        </Link>
      </div>

      <div className="mt-4 divide-y divide-border rounded-[var(--radius-md)] border border-border">
        {isLoading ? (
          <p className="px-4 py-8 text-center text-sm text-text-muted">{t('common.loading')}</p>
        ) : isError ? (
          <p className="px-4 py-8 text-center text-sm text-danger">{t('common.error')}</p>
        ) : !data?.items.length ? (
          <p className="px-4 py-8 text-center text-sm text-text-muted">{t('issues.empty')}</p>
        ) : (
          data.items.map((issue) => (
            <Link
              key={issue.id}
              to={`/repositories/${owner}/${repo}/issues/${issue.number}`}
              className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-hover"
            >
              <span
                aria-hidden
                className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                  issue.status === 'open' ? 'bg-success' : 'bg-purple-400'
                }`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{issue.title}</span>
                  {issue.labels.map((label) => (
                    <span
                      key={label.id}
                      className="rounded-full px-2 py-0.5 text-xs"
                      style={{ backgroundColor: `${label.color}33`, color: label.color }}
                    >
                      {label.name}
                    </span>
                  ))}
                </div>
                <p className="mt-1 text-xs text-text-muted">
                  #{issue.number} {t('issues.opened')} {new Date(issue.createdAt).toLocaleDateString()}{' '}
                  {t('issues.by')} {issue.author.username}
                  {issue.commentsCount > 0 ? ` · 💬 ${issue.commentsCount}` : ''}
                </p>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
