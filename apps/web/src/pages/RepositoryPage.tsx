import { type ReactNode } from 'react';
import { Link, NavLink, Route, Routes, useParams, Navigate } from 'react-router-dom';
import { useRepository } from '../features/repositories/api';
import { useT } from '../i18n/i18n';
import { CodeTab } from '../features/repo/CodeTab';
import { IssuesTab } from '../features/issues/IssuesTab';
import { MergeRequestsTab } from '../features/merge-requests/MergeRequestsTab';
import { IssueDetailPage } from './IssueDetailPage';
import { CreateIssuePage } from './CreateIssuePage';
import { MergeRequestDetailPage } from './MergeRequestDetailPage';
import { CreateMergeRequestPage } from './CreateMergeRequestPage';
import { RepoSettingsPage } from './RepoSettingsPage';

/** Repository detail shell at `/repositories/:owner/:repo` with sub-tabs. */
export function RepositoryPage() {
  const { owner = '', repo = '' } = useParams();
  const { data, isLoading, isError } = useRepository(owner, repo);
  const t = useT();

  if (isLoading) {
    return <PageStatus>{t('common.loading')}</PageStatus>;
  }
  if (isError || !data) {
    return <PageStatus tone="danger">{t('common.error')}</PageStatus>;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="border-b border-border pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            <Link to={`/repositories`} className="text-text-muted hover:text-text">
              {data.owner.username}
            </Link>
            <span className="text-text-muted"> / </span>
            {data.name}
          </h1>
          <span
            className={
              data.visibility === 'public'
                ? 'rounded-full border border-success/40 px-2 py-0.5 text-xs text-success'
                : 'rounded-full border border-border px-2 py-0.5 text-xs text-text-muted'
            }
          >
            {data.visibility === 'public' ? t('common.public') : t('common.private')}
          </span>
        </div>
        {data.description ? <p className="mt-2 text-sm text-text-muted">{data.description}</p> : null}
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-text-muted">
          <span>★ {data.starsCount}</span>
          <span>⑂ {data.forksCount}</span>
          <span>
            {data.openIssuesCount} {t('repo.issues').toLowerCase()}
          </span>
          <span>
            {data.openMergeRequestsCount} {t('repo.mergeRequests').toLowerCase()}
          </span>
        </div>
      </header>

      <RepoTabs owner={owner} repo={repo} defaultBranch={data.defaultBranch} />
    </div>
  );
}

function RepoTabs({ owner, repo, defaultBranch }: { owner: string; repo: string; defaultBranch: string }) {
  const t = useT();
  return (
    <>
      <nav className="mt-4 flex gap-1 border-b border-border text-sm">
        <TabLink to={`/repositories/${owner}/${repo}`} end>
          {t('repo.code')}
        </TabLink>
        <TabLink to={`/repositories/${owner}/${repo}/issues`}>{t('repo.issues')}</TabLink>
        <TabLink to={`/repositories/${owner}/${repo}/merge-requests`}>{t('repo.mergeRequests')}</TabLink>
        <TabLink to={`/repositories/${owner}/${repo}/settings`}>{t('repo.settings')}</TabLink>
      </nav>
      <div className="mt-6">
        <Routes>
          <Route index element={<CodeTab owner={owner} repo={repo} defaultBranch={defaultBranch} />} />
          <Route path="issues" element={<IssuesTab owner={owner} repo={repo} />} />
          <Route path="issues/new" element={<CreateIssuePage />} />
          <Route path="issues/:number" element={<IssueDetailPage />} />
          <Route path="merge-requests" element={<MergeRequestsTab owner={owner} repo={repo} />} />
          <Route path="merge-requests/new" element={<CreateMergeRequestPage />} />
          <Route path="merge-requests/:number" element={<MergeRequestDetailPage />} />
          <Route path="settings" element={<RepoSettingsPage />} />
          <Route path="*" element={<Navigate to={`/repositories/${owner}/${repo}`} replace />} />
        </Routes>
      </div>
    </>
  );
}

function TabLink({ to, end, children }: { to: string; end?: boolean; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `border-b-2 px-3 py-2 transition-colors ${
          isActive
            ? 'border-accent text-text'
            : 'border-transparent text-text-muted hover:border-border-strong hover:text-text'
        }`
      }
    >
      {children}
    </NavLink>
  );
}

function PageStatus({ children, tone }: { children: ReactNode; tone?: 'danger' }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 text-center">
      <p className={tone === 'danger' ? 'text-danger' : 'text-text-muted'}>{children}</p>
    </div>
  );
}
