import { Outlet, Link } from 'react-router-dom';
import { cn } from '../../lib/cn';

/**
 * Global app shell: sticky top bar + routed content area.
 * Dark-first styling driven by the CSS tokens from `index.css`.
 */
export function AppLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <header className="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <LogoMark />
            FlyGit
          </Link>
          <nav className="ml-4 flex items-center gap-4 text-sm text-text-muted">
            <Link to="/repositories" className="hover:text-text">
              Репозитории
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link
              to="/login"
              className={cn(
                'rounded-[var(--radius)] px-3 py-1.5 text-sm text-text-muted transition-colors hover:text-text',
              )}
            >
              Войти
            </Link>
            <Link
              to="/register"
              className="rounded-[var(--radius)] bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
            >
              Регистрация
            </Link>
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
