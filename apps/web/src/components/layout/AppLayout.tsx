import { useState, type FormEvent } from 'react';
import { Outlet, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../features/auth/AuthContext';
import { useUnreadCount } from '../../features/notifications/api';
import { useTheme } from '../../theme/theme';
import { useI18n, LOCALES, LOCALE_LABELS, type Locale } from '../../i18n/i18n';
import { Button } from '../ui/Button';

/**
 * Global app shell: sticky top bar + routed content area.
 * Dark-first styling driven by the CSS tokens from `index.css`.
 */
export function AppLayout() {
  const { user, initializing, logout } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const navigate = useNavigate();
  const { data: unread } = useUnreadCount(Boolean(user));
  const unreadCount = unread?.count ?? 0;
  const { theme, setTheme } = useTheme();
  const [searchQuery, setSearchQuery] = useState('');

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    const q = searchQuery.trim();
    if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
  }

  async function handleLogout() {
    await logout();
    navigate('/');
  }

  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <header className="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <LogoMark />
            {t('app.name')}
          </Link>
          <nav className="ml-4 flex items-center gap-4 text-sm text-text-muted">
            <Link to="/repositories" className="hover:text-text">
              {t('nav.repositories')}
            </Link>
            {user ? (
              <>
                <Link to="/organizations" className="hover:text-text">
                  {t('nav.organizations')}
                </Link>
                <Link to="/repositories/new" className="hover:text-text">
                  {t('repo.new')}
                </Link>
              </>
            ) : null}
            <form onSubmit={handleSearch} className="ml-2 hidden sm:block" role="search">
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('search.placeholder')}
                aria-label={t('search.placeholder')}
                className="w-44 rounded-[var(--radius)] border border-border bg-bg-subtle px-2.5 py-1 text-sm text-text-muted transition-all placeholder:text-text-faint focus:w-60 focus:border-accent focus:text-text focus:outline-none"
              />
            </form>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark')}
              aria-label={`${t('theme.label')}: ${t(`theme.${theme}`)}`}
              title={`${t('theme.label')}: ${t(`theme.${theme}`)}`}
              className="rounded-[var(--radius)] border border-border px-2 py-1.5 text-text-muted transition-colors hover:text-text"
            >
              {theme === 'dark' ? <MoonIcon /> : theme === 'light' ? <SunIcon /> : <AutoIcon />}
            </button>
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
              aria-label="Language"
              className="rounded-[var(--radius)] border border-border bg-bg-subtle px-2 py-1 text-sm text-text-muted focus:border-accent focus:outline-none"
            >
              {LOCALES.map((code) => (
                <option key={code} value={code}>
                  {LOCALE_LABELS[code]}
                </option>
              ))}
            </select>

            {initializing ? null : user ? (
              <div className="flex items-center gap-2">
                <Link
                  to="/notifications"
                  aria-label={t('notifications.title')}
                  className="relative rounded-[var(--radius)] px-2 py-1.5 text-text-muted transition-colors hover:text-text"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                  {unreadCount > 0 ? (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-medium leading-none text-white">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  ) : null}
                </Link>
                <Link
                  to="/settings"
                  className="rounded-[var(--radius)] px-3 py-1.5 text-sm text-text-muted transition-colors hover:text-text"
                >
                  {t('nav.settings')}
                </Link>
                {user.role === 'admin' ? (
                  <Link
                    to="/admin"
                    className="rounded-[var(--radius)] px-3 py-1.5 text-sm text-text-muted transition-colors hover:text-text"
                  >
                    {t('nav.admin')}
                  </Link>
                ) : null}
                <Link
                  to={`/users/${user.username}`}
                  className="rounded-[var(--radius)] px-3 py-1.5 text-sm text-text-muted transition-colors hover:text-text"
                >
                  {user.displayName || user.username}
                </Link>
                <Button variant="secondary" onClick={handleLogout}>
                  {t('nav.logout')}
                </Button>
              </div>
            ) : (
              <>
                <Link
                  to="/login"
                  className="rounded-[var(--radius)] px-3 py-1.5 text-sm text-text-muted transition-colors hover:text-text"
                >
                  {t('nav.login')}
                </Link>
                <Link
                  to="/register"
                  className="rounded-[var(--radius)] bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
                >
                  {t('nav.register')}
                </Link>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function AutoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

function LogoMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-surface" />
      <path
        d="M8 22V10l8 6 8-6v12"
        stroke="var(--accent)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
