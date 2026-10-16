import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useRepositories } from '../features/repositories/api';
import { useUserSearch } from '../features/search/api';
import { useT } from '../i18n/i18n';
import { TextField } from '../components/ui/Field';
import { Button } from '../components/ui/Button';

type Tab = 'repositories' | 'users';

/** Global search at `/search?q=` with repositories and users tabs. */
export function SearchPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [input, setInput] = useState(q);
  const [tab, setTab] = useState<Tab>('repositories');

  const { data: repos, isLoading: reposLoading } = useRepositories(q ? { q } : {});
  const { data: users, isLoading: usersLoading } = useUserSearch(q);

  function submit(e: FormEvent) {
    e.preventDefault();
    const next = new URLSearchParams(params);
    if (input.trim()) next.set('q', input.trim());
    else next.delete('q');
    setParams(next);
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'repositories', label: t('search.repositories') },
    { id: 'users', label: t('search.users') },
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t('search.title')}</h1>

      <form onSubmit={submit} className="mt-4 flex gap-2">
        <div className="flex-1">
          <TextField
            label={t('search.title')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('search.placeholder')}
            aria-label={t('search.placeholder')}
          />
        </div>
        <Button type="submit">{t('common.search')}</Button>
      </form>

      {!q ? (
        <p className="mt-8 text-sm text-text-muted">{t('search.hint')}</p>
      ) : (
        <>
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

          <div className="mt-4">
            {tab === 'repositories' ? (
              reposLoading ? (
                <p className="py-8 text-center text-sm text-text-muted">{t('common.loading')}</p>
              ) : !repos?.items.length ? (
                <p className="py-8 text-center text-sm text-text-muted">{t('search.noResults')}</p>
              ) : (
                <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
                  {repos.items.map((r) => (
                    <li key={r.id}>
                      <Link to={`/repositories/${r.owner.username}/${r.slug}`} className="block px-4 py-3 transition-colors hover:bg-surface-hover">
                        <p className="font-medium">
                          <span className="text-text-muted">{r.owner.username} / </span>
                          {r.name}
                        </p>
                        {r.description ? <p className="mt-0.5 truncate text-sm text-text-muted">{r.description}</p> : null}
                        <p className="mt-0.5 text-xs text-text-muted">★ {r.starsCount} · {r.language ?? '—'}</p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )
            ) : usersLoading ? (
              <p className="py-8 text-center text-sm text-text-muted">{t('common.loading')}</p>
            ) : !users?.items.length ? (
              <p className="py-8 text-center text-sm text-text-muted">{t('search.noResults')}</p>
            ) : (
              <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
                {users.items.map((u) => (
                  <li key={u.id}>
                    <Link to={`/users/${u.username}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-sm font-semibold text-text-muted">
                        {(u.displayName || u.username)[0]?.toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{u.displayName || u.username}</p>
                        <p className="text-sm text-text-muted">@{u.username}</p>
                      </div>
                      {u.bio ? <p className="hidden max-w-[50%] truncate text-sm text-text-muted sm:block">{u.bio}</p> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
