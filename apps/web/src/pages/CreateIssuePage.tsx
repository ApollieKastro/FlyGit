import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext';
import { useCreateIssue } from '../features/issues/api';
import { useT } from '../i18n/i18n';
import { TextField, TextArea } from '../components/ui/Field';
import { Button } from '../components/ui/Button';
import { isApiError } from '../features/auth/AuthContext';

/** New issue form at `/repositories/:owner/:repo/issues/new`. */
export function CreateIssuePage() {
  const { owner = '', repo = '' } = useParams();
  const t = useT();
  const { user } = useAuth();
  const navigate = useNavigate();
  const createIssue = useCreateIssue(owner, repo);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!user) {
    navigate(`/repositories/${owner}/${repo}/issues`, { replace: true });
    return null;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const issue = await createIssue.mutateAsync({ title, body: body || null });
      navigate(`/repositories/${owner}/${repo}/issues/${issue.number}`);
    } catch (err) {
      setError(isApiError(err) ? err.message : t('common.error'));
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <nav className="text-sm text-text-muted">
        <Link to={`/repositories/${owner}/${repo}/issues`} className="hover:text-text">
          {t('issues.title')}
        </Link>
        <span className="mx-1">/</span>
        <span className="text-text">{t('issues.new')}</span>
      </nav>

      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{t('issues.new')}</h1>

      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        <TextField
          label={t('issues.createTitle')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          required
        />
        <TextArea
          label={t('issues.createBody')}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
        />
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <div className="flex gap-2">
          <Button type="submit" loading={createIssue.isPending} disabled={!title.trim()}>
            {t('issues.createSubmit')}
          </Button>
          <Link
            to={`/repositories/${owner}/${repo}/issues`}
            className="inline-flex items-center rounded-[var(--radius)] px-4 py-2 text-sm text-text-muted hover:text-text"
          >
            {t('common.cancel')}
          </Link>
        </div>
      </form>
    </div>
  );
}
