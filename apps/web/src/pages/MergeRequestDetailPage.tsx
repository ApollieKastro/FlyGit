import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext';
import {
  useMergeRequest,
  useMergeRequestDiff,
  useMergeRequestCommits,
  useMergeRequestActions,
} from '../features/merge-requests/api';
import { useT } from '../i18n/i18n';
import { Button } from '../components/ui/Button';

/** Merge request detail at `/repositories/:owner/:repo/merge-requests/:number`. */
export function MergeRequestDetailPage() {
  const { owner = '', repo = '', number = '' } = useParams();
  const t = useT();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: mr, isLoading, isError } = useMergeRequest(owner, repo, number);
  const { data: diff } = useMergeRequestDiff(owner, repo, number);
  const { data: commits } = useMergeRequestCommits(owner, repo, number);
  const { merge, close, reopen } = useMergeRequestActions(owner, repo, number);
  const [confirming, setConfirming] = useState(false);

  if (isLoading) return <Status>{t('common.loading')}</Status>;
  if (isError || !mr) return <Status tone="danger">{t('common.notFound')}</Status>;

  const isOpen = mr.status === 'open';
  const isMerged = mr.status === 'merged';

  async function handleMerge() {
    await merge.mutateAsync({});
    setConfirming(false);
    navigate(`/repositories/${owner}/${repo}/merge-requests`);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <nav className="text-sm text-text-muted">
        <Link to={`/repositories/${owner}/${repo}/merge-requests`} className="hover:text-text">
          {t('mr.title')}
        </Link>
        <span className="mx-1">/</span>
        <span className="text-text">#{mr.number}</span>
      </nav>

      <header className="mt-3 border-b border-border pb-4">
        <div className="flex flex-wrap items-start gap-3">
          <h1 className="min-w-0 flex-1 text-2xl font-semibold tracking-tight">{mr.title}</h1>
          <span
            className={
              isMerged
                ? 'rounded-full border border-purple-400/40 px-3 py-1 text-sm text-purple-300'
                : isOpen
                  ? 'rounded-full border border-success/40 px-3 py-1 text-sm text-success'
                  : 'rounded-full border border-border px-3 py-1 text-sm text-text-muted'
            }
          >
            {isMerged ? t('mr.merged') : isOpen ? t('mr.open') : t('mr.closed')}
          </span>
        </div>
        <p className="mt-2 text-sm text-text-muted">
          <code className="rounded bg-surface px-1.5 py-0.5 text-xs">{mr.sourceBranch}</code>
          {' → '}
          <code className="rounded bg-surface px-1.5 py-0.5 text-xs">{mr.targetBranch}</code>
          {' · '}
          {mr.author.username} {t('issues.opened')} {new Date(mr.createdAt).toLocaleString()}
        </p>
        {mr.description ? (
          <article className="mt-3 rounded-[var(--radius-md)] border border-border bg-surface p-3 text-sm whitespace-pre-wrap">
            {mr.description}
          </article>
        ) : null}
      </header>

      {user ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {isMerged ? (
            <p className="text-sm text-purple-300">{t('mr.mergedNotice')}</p>
          ) : isOpen ? (
            <>
              <Button
                onClick={() => setConfirming(true)}
                loading={merge.isPending}
                disabled={!mr.mergeable}
                title={mr.mergeable ? undefined : t('mr.conflicts')}
              >
                {t('mr.merge')}
              </Button>
              <Button variant="secondary" onClick={() => close.mutate()} loading={close.isPending}>
                {t('mr.close')}
              </Button>
              {!mr.mergeable ? (
                <span className="text-sm text-danger">{t('mr.conflicts')}</span>
              ) : null}
            </>
          ) : (
            <Button variant="secondary" onClick={() => reopen.mutate()} loading={reopen.isPending}>
              {t('mr.reopen')}
            </Button>
          )}
        </div>
      ) : null}

      {confirming ? (
        <div className="mt-4 rounded-[var(--radius-md)] border border-accent/40 bg-surface p-4">
          <p className="text-sm font-medium">{t('mr.confirmMerge')}</p>
          <div className="mt-3 flex gap-2">
            <Button onClick={handleMerge} loading={merge.isPending}>
              {t('mr.merge')}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div className="min-w-0">
          <section className="overflow-hidden rounded-[var(--radius-md)] border border-border">
            <div className="border-b border-border bg-surface px-3 py-2 text-sm font-medium">
              {t('mr.filesChanged')} · {diff?.files.length ?? 0}
            </div>
            {diff?.files.map((file) => (
              <div key={file.path} className="border-b border-border last:border-0">
                <div className="flex items-center gap-2 bg-bg-subtle px-3 py-2 text-sm">
                  <span className="truncate font-mono">{file.path}</span>
                  <span className="ml-auto shrink-0 text-xs">
                    <span className="text-success">+{file.additions}</span>{' '}
                    <span className="text-danger">-{file.deletions}</span>
                  </span>
                </div>
                {!file.binary ? (
                  <pre className="overflow-x-auto text-xs leading-relaxed">
                    {file.hunks.map((hunk) =>
                      hunk.lines.map((line, i) => (
                        <div
                          key={`${hunk.header}-${i}`}
                          className={
                            line.type === 'add'
                              ? 'bg-success/10 px-3'
                              : line.type === 'del'
                                ? 'bg-danger/10 px-3'
                                : 'px-3'
                          }
                        >
                          <span className="mr-2 select-none text-text-faint">
                            {line.newNumber ?? line.oldNumber ?? ''}
                          </span>
                          <span className="whitespace-pre">
                            {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                            {line.content}
                          </span>
                        </div>
                      )),
                    )}
                  </pre>
                ) : (
                  <p className="px-3 py-2 text-xs text-text-muted">{t('common.empty')}</p>
                )}
              </div>
            ))}
            {!diff?.files.length ? (
              <p className="px-3 py-6 text-center text-sm text-text-muted">{t('common.empty')}</p>
            ) : null}
          </section>
        </div>

        <aside className="text-sm">
          <h3 className="mb-2 font-semibold text-text-muted">{t('mr.commits')}</h3>
          <ul className="flex flex-col gap-1.5">
            {commits?.map((c) => (
              <li key={c.sha} className="truncate text-xs">
                <span className="font-mono text-text-faint">{c.shortSha}</span>{' '}
                <span className="text-text-muted">{c.message.split('\n')[0]}</span>
              </li>
            ))}
            {!commits?.length ? <li className="text-text-muted">{t('common.empty')}</li> : null}
          </ul>
        </aside>
      </div>
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
