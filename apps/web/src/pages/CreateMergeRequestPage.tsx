import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext';
import { useCreateMergeRequest } from '../features/merge-requests/api';
import { useBranches } from '../features/repositories/api';
import { useT } from '../i18n/i18n';
import { TextField, TextArea } from '../components/ui/Field';
import { Button } from '../components/ui/Button';
import { isApiError } from '../features/auth/AuthContext';

/** New merge request form at `/repositories/:owner/:repo/merge-requests/new`. */
export function CreateMergeRequestPage() {
  const { owner = '', repo = '' } = useParams();
  const t = useT();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: branches } = useBranches(owner, repo);
  const createMr = useCreateMergeRequest(owner, repo);

  const [sourceBranch, setSourceBranch] = useState('');
  const [targetBranch, setTargetBranch] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const branchNames = branches?.map((b) => b.name) ?? [];

  if (!user) {
    navigate(`/repositories/${owner}/${repo}/merge-requests`, { replace: true });
    return null;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const mr = await createMr.mutateAsync({
        sourceBranch,
        targetBranch,
        title,
        description: description || null,
      });
      navigate(`/repositories/${owner}/${repo}/merge-requests/${mr.number}`);
    } catch (err) {
      setError(isApiError(err) ? err.message : t('common.error'));
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <nav className="text-sm text-text-muted">
        <Link to={`/repositories/${owner}/${repo}/merge-requests`} className="hover:text-text">
          {t('mr.title')}
        </Link>
        <span className="mx-1">/</span>
        <span className="text-text">{t('mr.new')}</span>
      </nav>

      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{t('mr.new')}</h1>

      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <BranchField
            label={t('mr.sourceBranch')}
            value={sourceBranch}
            onChange={setSourceBranch}
            options={branchNames}
            required
          />
          <BranchField
            label={t('mr.targetBranch')}
            value={targetBranch}
            onChange={setTargetBranch}
            options={branchNames}
            required
          />
        </div>
        <TextField
          label={t('mr.createTitle')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <TextArea
          label={t('mr.createDescription')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={6}
        />
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <div className="flex gap-2">
          <Button
            type="submit"
            loading={createMr.isPending}
            disabled={!sourceBranch || !targetBranch || !title.trim() || sourceBranch === targetBranch}
          >
            {t('mr.createSubmit')}
          </Button>
          <Link
            to={`/repositories/${owner}/${repo}/merge-requests`}
            className="inline-flex items-center rounded-[var(--radius)] px-4 py-2 text-sm text-text-muted hover:text-text"
          >
            {t('common.cancel')}
          </Link>
        </div>
      </form>
    </div>
  );
}

function BranchField({
  label,
  value,
  onChange,
  options,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-text">{label}</label>
      <input
        list={`branches-${label}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="rounded-[var(--radius)] border border-border bg-bg-subtle px-3 py-2 text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
      />
      <datalist id={`branches-${label}`}>
        {options.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>
    </div>
  );
}
