import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useRepositories } from '../features/repositories/api';
import { useT } from '../i18n/i18n';
import { Button } from '../components/ui/Button';

/** Public repository browser at `/repositories`. */
export function RepositoriesPage() {
  const t = useT();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'updated' | 'created' | 'name' | 'stars'>('updated');
  const { data, isLoading, isError } = useRepositories({ q: query || undefined, sort });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{t('nav.repositories')}</h1>
        <div className="ml-auto flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('common.search')}
            className="w-56 rounded-[var(--radius)] border border-border bg-bg-subtle px-3 py-1.5 text-sm placeholder:text-text-faint focus:border-accent focus:outline-none"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="rounded-[var(--radius)] border border-border bg-bg-subtle px-2 py-1.5 text-sm text-text-muted focus:border-accent focus:outline-none"
          >
            <option value="updated">Updated</option>
            <option value="created">Created</option>
            <option value="name">Name</option>
            <option value="stars">Stars</option>
          </select>
        </div>
      </div>

      <div className="mt-6 divide-y divide-border rounded-[var(--radius-md)] border border-border">
        {isLoading ? (
          <p className="px-4 py-8 text-center text-sm text-text-muted">{t('common.loading')}</p>
        ) : isError ? (
          <p className="px-4 py-8 text-center text-sm text-danger">{t('common.error')}</p>
        ) : !data?.items.length ? (
          <p className="px-4 py-8 text-center text-sm text-text-muted">{t('issues.empty')}</p>
        ) : (
          data.items.map((repo) => (
            <Link
              key={repo.id}
              to={`/repositories/${repo.owner.username}/${repo.slug}`}
              className="flex items-start gap-3 px-4 py-4 transition-colors hover:bg-surface-hover"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">
                    <span className="text-text-muted">{repo.owner.username}/</span>
                    {repo.name}
                  </span>
                  <span
                    className={
                      repo.visibility === 'public'
                        ? 'rounded-full border border-success/40 px-2 py-0.5 text-xs text-success'
                        : 'rounded-full border border-border px-2 py-0.5 text-xs text-text-muted'
                    }
                  >
                    {repo.visibility === 'public' ? t('common.public') : t('common.private')}
                  </span>
                </div>
                {repo.description ? (
                  <p className="mt-1 truncate text-sm text-text-muted">{repo.description}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-4 text-xs text-text-muted">
                {repo.language ? <span>{repo.language}</span> : null}
                <span>★ {repo.starsCount}</span>
                <span>⑂ {repo.forksCount}</span>
              </div>
            </Link>
          ))
        )}
      </div>

      {data && data.total > data.pageSize ? (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary">{`${data.page} / ${Math.ceil(data.total / data.pageSize)}`}</Button>
        </div>
      ) : null}
    </div>
  );
}
