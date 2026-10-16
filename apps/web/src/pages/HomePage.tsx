import { Link } from 'react-router-dom';
import { useT } from '../i18n/i18n';

/** Public landing page shown at `/`. */
export function HomePage() {
  const t = useT();
  const features = [
    { title: t('home.features.git.title'), description: t('home.features.git.description') },
    { title: t('home.features.issues.title'), description: t('home.features.issues.description') },
    { title: t('home.features.mr.title'), description: t('home.features.mr.description') },
    { title: t('home.features.orgs.title'), description: t('home.features.orgs.description') },
    { title: t('home.features.notifications.title'), description: t('home.features.notifications.description') },
    { title: t('home.features.security.title'), description: t('home.features.security.description') },
  ] as const;

  return (
    <div className="mx-auto max-w-6xl px-4 py-16">
      <section className="mx-auto max-w-2xl text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          FlyGit — <span className="text-accent">{t('home.tagline')}</span>
        </h1>
        <p className="mt-4 text-lg text-text-muted">{t('home.subtitle')}</p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            to="/register"
            className="rounded-[var(--radius)] bg-accent px-5 py-2.5 font-medium text-white transition-colors hover:bg-accent-hover"
          >
            {t('home.ctaPrimary')}
          </Link>
          <Link
            to="/repositories"
            className="rounded-[var(--radius)] border border-border px-5 py-2.5 font-medium text-text-muted transition-colors hover:border-border-strong hover:text-text"
          >
            {t('home.ctaSecondary')}
          </Link>
        </div>
      </section>

      <section className="mt-20 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <div key={f.title} className="rounded-[var(--radius-md)] border border-border bg-surface p-5">
            <h3 className="font-semibold">{f.title}</h3>
            <p className="mt-2 text-sm text-text-muted">{f.description}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
