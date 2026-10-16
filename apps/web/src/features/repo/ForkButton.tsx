import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFork } from '../repo-content/api';
import { useT } from '../../i18n/i18n';
import { Button } from '../../components/ui/Button';
import { isApiError } from '../auth/AuthContext';

/** Fork button: forks the repo into the current user and navigates to it. */
export function ForkButton({ owner, repo }: { owner: string; repo: string }) {
  const t = useT();
  const navigate = useNavigate();
  const fork = useFork(owner, repo);
  const [error, setError] = useState<string | null>(null);

  async function handleFork() {
    setError(null);
    try {
      const result = await fork.mutateAsync();
      navigate(`/repositories/${result.owner.username}/${result.slug}`);
    } catch (err) {
      setError(isApiError(err) ? err.message : t('common.error'));
    }
  }

  return (
    <span className="inline-flex flex-col">
      <Button onClick={handleFork} loading={fork.isPending}>
        {t('repo.fork')}
      </Button>
      {error ? <span className="mt-1 text-xs text-danger">{error}</span> : null}
    </span>
  );
}
