import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext';
import { useCreateRepository } from '../features/repositories/api';
import { useT } from '../i18n/i18n';
import { TextField, TextArea } from '../components/ui/Field';
import { Button } from '../components/ui/Button';
import { isApiError } from '../features/auth/AuthContext';

/** New repository form at `/repositories/new`. */
export function CreateRepositoryPage() {
  const t = useT();
  const { user } = useAuth();
  const navigate = useNavigate();
  const createRepo = useCreateRepository();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [initialize, setInitialize] = useState(true);
  const [error, setError] = useState<string | null>(null);

  if (!user) {
    navigate('/login', { state: { from: '/repositories/new' }, replace: true });
    return null;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const repo = await createRepo.mutateAsync({
        ownerType: 'user',
        name,
        description: description || null,
        visibility,
        initialize,
        defaultBranch: 'main',
      });
      navigate(`/repositories/${repo.owner.username}/${repo.slug}`);
    } catch (err) {
      setError(isApiError(err) ? err.message : t('common.error'));
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{t('repo.new')}</h1>
      <p className="mt-1 text-sm text-text-muted">{t('repo.newHint')}</p>

      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        <TextField
          label={t('repo.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-project"
          autoFocus
          required
        />
        <TextArea
          label={t('repo.descriptionLabel')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          hint={t('repo.descriptionHint')}
        />

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-text">{t('repo.visibility')}</span>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="visibility"
                checked={visibility === 'private'}
                onChange={() => setVisibility('private')}
                className="accent-[var(--accent)]"
              />
              {t('common.private')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="visibility"
                checked={visibility === 'public'}
                onChange={() => setVisibility('public')}
                className="accent-[var(--accent)]"
              />
              {t('common.public')}
            </label>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={initialize}
            onChange={(e) => setInitialize(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          {t('repo.initializeReadme')}
        </label>

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        <Button type="submit" loading={createRepo.isPending} className="mt-2">
          {t('repo.createSubmit')}
        </Button>
      </form>
    </div>
  );
}
