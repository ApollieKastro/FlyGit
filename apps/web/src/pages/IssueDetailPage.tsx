import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext';
import {
  useIssue,
  useIssueComments,
  useToggleIssueStatus,
  useAddIssueComment,
} from '../features/issues/api';
import { useT } from '../i18n/i18n';
import { Button } from '../components/ui/Button';
import { TextArea } from '../components/ui/Field';

/** Issue detail at `/repositories/:owner/:repo/issues/:number`. */
export function IssueDetailPage() {
  const { owner = '', repo = '', number = '' } = useParams();
  const t = useT();
  const { user } = useAuth();
  const { data: issue, isLoading, isError } = useIssue(owner, repo, number);
  const { data: comments } = useIssueComments(owner, repo, number);
  const toggleStatus = useToggleIssueStatus(owner, repo, number);
  const addComment = useAddIssueComment(owner, repo, number);
  const [draft, setDraft] = useState('');

  if (isLoading) return <Status>{t('common.loading')}</Status>;
  if (isError || !issue) return <Status tone="danger">{t('common.notFound')}</Status>;

  const isOpen = issue.status === 'open';

  async function handleToggle() {
    if (!issue) return;
    await toggleStatus.mutateAsync(isOpen ? 'closed' : 'open');
  }

  async function handleComment(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    await addComment.mutateAsync(draft.trim());
    setDraft('');
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <nav className="text-sm text-text-muted">
        <Link to={`/repositories/${owner}/${repo}/issues`} className="hover:text-text">
          {t('issues.title')}
        </Link>
        <span className="mx-1">/</span>
        <span className="text-text">#{issue.number}</span>
      </nav>

      <header className="mt-3 border-b border-border pb-4">
        <div className="flex flex-wrap items-start gap-3">
          <h1 className="min-w-0 flex-1 text-2xl font-semibold tracking-tight">{issue.title}</h1>
          <span
            className={
              isOpen
                ? 'rounded-full border border-success/40 px-3 py-1 text-sm text-success'
                : 'rounded-full border border-purple-400/40 px-3 py-1 text-sm text-purple-300'
            }
          >
            {isOpen ? t('issues.open') : t('issues.closed')}
          </span>
        </div>
        <p className="mt-2 text-sm text-text-muted">
          {issue.author.username} {t('issues.opened')} {new Date(issue.createdAt).toLocaleString()}
          {issue.commentsCount > 0 ? ` · ${issue.commentsCount} ${t('issues.commented')}` : ''}
        </p>
        {issue.labels.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {issue.labels.map((label) => (
              <span
                key={label.id}
                className="rounded-full px-2 py-0.5 text-xs"
                style={{ backgroundColor: `${label.color}33`, color: label.color }}
              >
                {label.name}
              </span>
            ))}
          </div>
        ) : null}
      </header>

      {issue.body ? (
        <article className="mt-4 rounded-[var(--radius-md)] border border-border bg-surface p-4 text-sm leading-relaxed whitespace-pre-wrap">
          {issue.body}
        </article>
      ) : null}

      {user ? (
        <div className="mt-4">
          <Button
            variant={isOpen ? 'danger' : 'secondary'}
            onClick={handleToggle}
            loading={toggleStatus.isPending}
          >
            {isOpen ? t('issues.close') : t('issues.reopen')}
          </Button>
        </div>
      ) : null}

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-text-muted">
          {comments?.length ?? 0} {t('issues.commented')}
        </h2>
        <div className="flex flex-col gap-3">
          {comments?.length ? (
            comments.map((c) => (
              <div key={c.id} className="rounded-[var(--radius-md)] border border-border bg-surface">
                <div className="border-b border-border px-3 py-2 text-xs text-text-muted">
                  <span className="font-medium text-text">{c.author.username}</span> ·{' '}
                  {new Date(c.createdAt).toLocaleString()}
                </div>
                <div className="px-3 py-3 text-sm whitespace-pre-wrap">{c.body}</div>
              </div>
            ))
          ) : (
            <p className="text-sm text-text-muted">{t('issues.noComments')}</p>
          )}
        </div>
      </section>

      {user ? (
        <form onSubmit={handleComment} className="mt-6">
          <TextArea
            label={t('issues.commentSubmit')}
            placeholder={t('issues.commentPlaceholder')}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
          />
          <div className="mt-2">
            <Button type="submit" loading={addComment.isPending} disabled={!draft.trim()}>
              {t('issues.commentSubmit')}
            </Button>
          </div>
        </form>
      ) : (
        <p className="mt-6 text-sm text-text-muted">
          <Link to="/login" className="text-accent hover:underline">
            {t('nav.login')}
          </Link>{' '}
          — {t('issues.commentPlaceholder')}
        </p>
      )}
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
