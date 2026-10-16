import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext';
import { useMyOrganizations, useCreateOrganization } from '../features/organizations/api';
import { useT } from '../i18n/i18n';
import { Button } from '../components/ui/Button';
import { TextField, TextArea } from '../components/ui/Field';
import { isApiError } from '../features/auth/AuthContext';

/** Organizations list at `/organizations`. */
export function OrganizationsPage() {
  const t = useT();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, isLoading } = useMyOrganizations();
  const createOrg = useCreateOrganization();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const org = await createOrg.mutateAsync({ name, slug, description: description || null });
      navigate(`/organizations/${org.slug}`);
    } catch (err) {
      setError(isApiError(err) ? err.message : t('common.error'));
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('nav.organizations')}</h1>
        {user ? (
          <Button className="ml-auto" onClick={() => setShowForm((v) => !v)}>
            {t('orgs.new')}
          </Button>
        ) : null}
      </div>

      {showForm ? (
        <form onSubmit={submit} className="mt-6 flex max-w-lg flex-col gap-4 rounded-[var(--radius-md)] border border-border p-4">
          <TextField label={t('orgs.name')} value={name} onChange={(e) => setName(e.target.value)} required />
          <TextField label={t('orgs.slug')} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="my-org" hint={t('orgs.slugHint')} required />
          <TextArea label={t('orgs.description')} value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <div>
            <Button type="submit" loading={createOrg.isPending} disabled={!name.trim() || !slug.trim()}>
              {t('orgs.createSubmit')}
            </Button>
          </div>
        </form>
      ) : null}

      <div className="mt-6 divide-y divide-border rounded-[var(--radius-md)] border border-border">
        {isLoading ? (
          <p className="px-4 py-8 text-center text-sm text-text-muted">{t('common.loading')}</p>
        ) : !data?.items.length ? (
          <p className="px-4 py-8 text-center text-sm text-text-muted">{t('orgs.empty')}</p>
        ) : (
          data.items.map((org) => (
            <Link key={org.id} to={`/organizations/${org.slug}`} className="flex items-start gap-3 px-4 py-4 transition-colors hover:bg-surface-hover">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-surface font-semibold text-text-muted">
                {org.name[0]?.toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{org.name}</p>
                {org.description ? <p className="mt-0.5 truncate text-sm text-text-muted">{org.description}</p> : null}
              </div>
              <div className="shrink-0 text-xs text-text-muted">
                {org.membersCount} {t('orgs.members').toLowerCase()} · {org.repositoriesCount} {t('nav.repositories').toLowerCase()}
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
