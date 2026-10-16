import { Outlet, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../features/auth/AuthContext';
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
          </nav>

          <div className="ml-auto flex items-center gap-2">
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
