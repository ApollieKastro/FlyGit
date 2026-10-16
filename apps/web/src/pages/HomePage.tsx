import { Link } from 'react-router-dom';

/** Public landing page shown at `/`. */
export function HomePage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16">
      <section className="mx-auto max-w-2xl text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          FlyGit — <span className="text-accent">self-hosted</span> Git-платформа
        </h1>
        <p className="mt-4 text-lg text-text-muted">
          Репозитории, issues, merge requests, организации и уведомления. Полный контроль над вашим кодом.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            to="/register"
            className="rounded-[var(--radius)] bg-accent px-5 py-2.5 font-medium text-white transition-colors hover:bg-accent-hover"
          >
            Начать
          </Link>
          <Link
            to="/repositories"
            className="rounded-[var(--radius)] border border-border px-5 py-2.5 font-medium text-text-muted transition-colors hover:border-border-strong hover:text-text"
          >
            Смотреть репозитории
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

const features = [
  { title: 'Git-транспорт', description: 'Smart HTTP и SSH, ветки, теги, blame, сравнение и чтение файлов.' },
  { title: 'Issues и метки', description: 'Задачи, назначенные, метки, вехи, комментарии и реакции.' },
  { title: 'Merge requests', description: 'Диффы, ревью, аппрувы и стратегии слияния merge/squash/rebase.' },
  { title: 'Организации', description: 'Команды, роли, приглашения и аудит действий.' },
  { title: 'Уведомления', description: 'События репозиториев и почтовые шаблоны на трёх языках.' },
  { title: 'Безопасность', description: '2FA, PAT, SSH-ключи, защищённые ветки и rate limiting.' },
] as const;
