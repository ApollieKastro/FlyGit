import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { UserPublic } from '@flygit/shared';
import { api } from '../lib/api';
import { useT } from '../i18n/i18n';

interface ProfileRepo {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  visibility: string;
  language: string | null;
  starsCount: number;
  updatedAt: string;
}

interface ProfileResponse {
  profile: UserPublic;
  repositories: ProfileRepo[];
  starsCount: number;
  activityCount: number;
}

/** Public user profile at `/users/:username`. */
export function UserProfilePage() {
  const { username = '' } = useParams();
  const t = useT();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['profile', username],
    queryFn: () => api.get<ProfileResponse>(`/users/${username}`),
    enabled: Boolean(username),
  });

  if (isLoading) return <Status>{t('common.loading')}</Status>;
  if (isError || !data) return <Status tone="danger">{t('profile.notFound')}</Status>;

  const { profile, repositories, starsCount } = data;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <header className="flex items-start gap-4 border-b border-border pb-6">
        {profile.avatarUrl ? (
          <img
            src={profile.avatarUrl}
            alt={profile.username}
            className="h-16 w-16 rounded-full border border-border"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full border border-border bg-surface text-2xl font-semibold text-text-muted">
            {profile.username[0]?.toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {profile.displayName || profile.username}
          </h1>
          <p className="text-sm text-text-muted">@{profile.username}</p>
          {profile.bio ? <p className="mt-2 text-sm">{profile.bio}</p> : null}
          {profile.website ? (
            <a
              href={profile.website}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1 inline-block text-sm text-accent hover:underline"
            >
              {profile.website}
            </a>
          ) : null}
          <p className="mt-2 text-xs text-text-muted">
            {t('profile.joined')} {new Date(profile.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div className="shrink-0 text-right text-sm text-text-muted">
          <div>★ {starsCount}</div>
        </div>
      </header>

      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold">
          {t('profile.repositories')} ({repositories.length})
        </h2>
        <div className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
          {repositories.length ? (
            repositories.map((repo) => (
              <Link
                key={repo.id}
                to={`/repositories/${profile.username}/${repo.slug}`}
                className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-hover"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{repo.name}</span>
                    <span className="rounded-full border border-border px-2 py-0.5 text-xs text-text-muted">
                      {repo.visibility === 'public' ? t('common.public') : t('common.private')}
                    </span>
                  </div>
                  {repo.description ? (
                    <p className="mt-1 truncate text-sm text-text-muted">{repo.description}</p>
                  ) : null}
                </div>
                <div className="shrink-0 text-xs text-text-muted">
                  {repo.language ? <span>{repo.language} · </span> : null}★ {repo.starsCount}
                </div>
              </Link>
            ))
          ) : (
            <p className="px-4 py-8 text-center text-sm text-text-muted">{t('common.empty')}</p>
          )}
        </div>
      </section>
    </div>
  );
}

function Status({ children, tone }: { children: React.ReactNode; tone?: 'danger' }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 text-center">
      <p className={tone === 'danger' ? 'text-danger' : 'text-text-muted'}>{children}</p>
    </div>
  );
}
