import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext';
import { useT } from '../i18n/i18n';
import { Button } from '../components/ui/Button';
import { TextField, TextArea } from '../components/ui/Field';
import { isApiError } from '../features/auth/AuthContext';
import {
  useMe,
  useUpdateProfile,
  useSshKeys,
  useAddSshKey,
  useRemoveSshKey,
  useTokens,
  useCreateToken,
  useRevokeToken,
  useChangePassword,
  useSetupTwoFactor,
  useEnableTwoFactor,
  useDisableTwoFactor,
} from '../features/settings/api';

type Tab = 'profile' | 'keys' | 'tokens' | 'security';

/** User settings at `/settings`. */
export function SettingsPage() {
  const t = useT();
  const { user, initializing } = useAuth();
  const [tab, setTab] = useState<Tab>('profile');

  if (!initializing && !user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center text-text-muted">
        <Link to="/login" className="text-accent hover:underline">
          {t('nav.login')}
        </Link>
      </div>
    );
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'profile', label: t('settings.profile') },
    { id: 'keys', label: t('settings.sshKeys') },
    { id: 'tokens', label: t('settings.tokens') },
    { id: 'security', label: t('settings.security') },
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t('settings.title')}</h1>
      <nav className="mt-4 flex gap-1 border-b border-border text-sm">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            className={`border-b-2 px-3 py-2 transition-colors ${
              tab === tb.id
                ? 'border-accent text-text'
                : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            {tb.label}
          </button>
        ))}
      </nav>
      <div className="mt-6">
        {tab === 'profile' && <ProfileSection />}
        {tab === 'keys' && <SshKeysSection />}
        {tab === 'tokens' && <TokensSection />}
        {tab === 'security' && <SecuritySection />}
      </div>
    </div>
  );
}

// ───────────────────────── Profile ─────────────────────────

function ProfileSection() {
  const t = useT();
  const { data: me } = useMe();
  const update = useUpdateProfile();
  const [displayName, setDisplayName] = useState<string | undefined>(undefined);
  const [bio, setBio] = useState<string | undefined>(undefined);
  const [website, setWebsite] = useState<string | undefined>(undefined);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!me) return <p className="text-sm text-text-muted">{t('common.loading')}</p>;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await update.mutateAsync({
        ...(displayName !== undefined ? { displayName } : {}),
        ...(bio !== undefined ? { bio: bio || null } : {}),
        ...(website !== undefined ? { website: website || null } : {}),
      });
      setSaved(true);
    } catch (err) {
      setError(isApiError(err) ? err.message : t('common.error'));
    }
  }

  return (
    <form onSubmit={submit} className="flex max-w-lg flex-col gap-4">
      <TextField label={t('settings.username')} value={me.username} disabled hint={t('settings.usernameLocked')} />
      <TextField label={t('auth.register.email')} value={me.email} disabled />
      <TextField
        label={t('settings.displayName')}
        value={displayName ?? me.displayName ?? ''}
        onChange={(e) => setDisplayName(e.target.value)}
      />
      <TextArea label={t('settings.bio')} value={bio ?? me.bio ?? ''} onChange={(e) => setBio(e.target.value)} rows={3} />
      <TextField
        label={t('settings.website')}
        value={website ?? me.website ?? ''}
        onChange={(e) => setWebsite(e.target.value)}
        placeholder="https://example.com"
      />
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {saved ? <p className="text-sm text-success">{t('settings.saved')}</p> : null}
      <div>
        <Button type="submit" loading={update.isPending}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}

// ───────────────────────── SSH keys ─────────────────────────

function SshKeysSection() {
  const t = useT();
  const { data: keys, isLoading } = useSshKeys();
  const addKey = useAddSshKey();
  const removeKey = useRemoveSshKey();
  const [title, setTitle] = useState('');
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [newKeyId, setNewKeyId] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const created = await addKey.mutateAsync({ title, key });
      setNewKeyId(created.id);
      setTitle('');
      setKey('');
    } catch (err) {
      setError(isApiError(err) ? err.message : t('common.error'));
    }
  }

  return (
    <div>
      <form onSubmit={submit} className="flex max-w-lg flex-col gap-4">
        <TextField label={t('settings.keyTitle')} value={title} onChange={(e) => setTitle(e.target.value)} required />
        <TextArea
          label={t('settings.keyBody')}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          rows={4}
          placeholder="ssh-ed25519 AAAA... user@host"
          hint={t('settings.keyHint')}
          required
        />
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <div>
          <Button type="submit" loading={addKey.isPending} disabled={!title.trim() || !key.trim()}>
            {t('settings.addKey')}
          </Button>
        </div>
      </form>

      <h3 className="mt-8 mb-2 text-sm font-semibold text-text-muted">{t('settings.yourKeys')}</h3>
      <div className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
        {isLoading ? (
          <p className="px-4 py-6 text-center text-sm text-text-muted">{t('common.loading')}</p>
        ) : !keys?.length ? (
          <p className="px-4 py-6 text-center text-sm text-text-muted">{t('settings.noKeys')}</p>
        ) : (
          keys.map((k) => (
            <div key={k.id} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{k.title}</p>
                <p className="mt-0.5 truncate font-mono text-xs text-text-muted">{k.fingerprint}</p>
                <p className="mt-0.5 text-xs text-text-faint">
                  {t('settings.addedOn')} {new Date(k.createdAt).toLocaleDateString()}
                  {k.lastUsedAt
                    ? ` · ${t('settings.lastUsed')} ${new Date(k.lastUsedAt).toLocaleDateString()}`
                    : ''}
                </p>
                {newKeyId === k.id ? (
                  <p className="mt-1 text-xs text-success">{t('settings.keyAdded')}</p>
                ) : null}
              </div>
              <Button
                variant="danger"
                onClick={() => removeKey.mutate(k.id)}
                loading={removeKey.isPending}
              >
                {t('common.delete')}
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ───────────────────────── Tokens ─────────────────────────

const SCOPES = ['repo:read', 'repo:write', 'user:write'] as const;

function TokensSection() {
  const t = useT();
  const { data: tokens, isLoading } = useTokens();
  const createToken = useCreateToken();
  const revokeToken = useRevokeToken();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['repo:read']);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggleScope(scope: string) {
    setScopes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNewToken(null);
    try {
      const created = await createToken.mutateAsync({ name, scopes });
      if (created.token) setNewToken(created.token);
      setName('');
    } catch (err) {
      setError(isApiError(err) ? err.message : t('common.error'));
    }
  }

  return (
    <div>
      {newToken ? (
        <div className="mb-6 rounded-[var(--radius-md)] border border-success/40 bg-surface p-4">
          <p className="text-sm font-medium text-success">{t('settings.tokenCreated')}</p>
          <p className="mt-2 break-all rounded bg-bg-subtle p-2 font-mono text-xs">{newToken}</p>
          <p className="mt-2 text-xs text-text-muted">{t('settings.tokenCopyWarning')}</p>
        </div>
      ) : null}

      <form onSubmit={submit} className="flex max-w-lg flex-col gap-4">
        <TextField label={t('settings.tokenName')} value={name} onChange={(e) => setName(e.target.value)} required />
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-text">{t('settings.scopes')}</span>
          <div className="flex flex-wrap gap-3">
            {SCOPES.map((scope) => (
              <label key={scope} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={scopes.includes(scope)}
                  onChange={() => toggleScope(scope)}
                  className="accent-[var(--accent)]"
                />
                <code className="text-xs">{scope}</code>
              </label>
            ))}
          </div>
        </div>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <div>
          <Button type="submit" loading={createToken.isPending} disabled={!name.trim() || !scopes.length}>
            {t('settings.createToken')}
          </Button>
        </div>
      </form>

      <h3 className="mt-8 mb-2 text-sm font-semibold text-text-muted">{t('settings.yourTokens')}</h3>
      <div className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
        {isLoading ? (
          <p className="px-4 py-6 text-center text-sm text-text-muted">{t('common.loading')}</p>
        ) : !tokens?.length ? (
          <p className="px-4 py-6 text-center text-sm text-text-muted">{t('settings.noTokens')}</p>
        ) : (
          tokens.map((tok) => (
            <div key={tok.id} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {tok.name} <code className="ml-1 text-xs text-text-muted">{tok.prefix}…</code>
                </p>
                <p className="mt-0.5 text-xs text-text-muted">{tok.scopes.join(', ')}</p>
                <p className="mt-0.5 text-xs text-text-faint">
                  {t('settings.createdOn')} {new Date(tok.createdAt).toLocaleDateString()}
                </p>
              </div>
              <Button variant="danger" onClick={() => revokeToken.mutate(tok.id)} loading={revokeToken.isPending}>
                {t('settings.revoke')}
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ───────────────────────── Security (password + 2FA) ─────────────────────────

function SecuritySection() {
  const t = useT();
  const { data: me } = useMe();
  const changePassword = useChangePassword();
  const setup2fa = useSetupTwoFactor();
  const enable2fa = useEnableTwoFactor();
  const disable2fa = useDisableTwoFactor();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);

  const [setup, setSetup] = useState<Awaited<ReturnType<typeof setup2fa.mutateAsync>> | null>(null);
  const [code, setCode] = useState('');
  const [twoFaMsg, setTwoFaMsg] = useState<string | null>(null);
  const [twoFaError, setTwoFaError] = useState<string | null>(null);

  const totpEnabled = Boolean((me as { totpEnabled?: boolean } | undefined)?.totpEnabled);

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    setPwError(null);
    try {
      await changePassword.mutateAsync({ currentPassword: current, newPassword: next });
      setPwMsg(t('settings.passwordChanged'));
      setCurrent('');
      setNext('');
    } catch (err) {
      setPwError(isApiError(err) ? err.message : t('common.error'));
    }
  }

  async function handleSetup() {
    setTwoFaError(null);
    try {
      setSetup(await setup2fa.mutateAsync());
    } catch (err) {
      setTwoFaError(isApiError(err) ? err.message : t('common.error'));
    }
  }

  async function handleEnable(e: FormEvent) {
    e.preventDefault();
    setTwoFaError(null);
    setTwoFaMsg(null);
    try {
      await enable2fa.mutateAsync(code);
      setTwoFaMsg(t('settings.twoFaEnabled'));
      setSetup(null);
      setCode('');
    } catch (err) {
      setTwoFaError(isApiError(err) ? err.message : t('common.error'));
    }
  }

  async function handleDisable(e: FormEvent) {
    e.preventDefault();
    setTwoFaError(null);
    setTwoFaMsg(null);
    try {
      await disable2fa.mutateAsync(code);
      setTwoFaMsg(t('settings.twoFaDisabled'));
      setCode('');
    } catch (err) {
      setTwoFaError(isApiError(err) ? err.message : t('common.error'));
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <section>
        <h3 className="mb-3 font-semibold">{t('settings.changePassword')}</h3>
        <form onSubmit={submitPassword} className="flex max-w-lg flex-col gap-4">
          <TextField
            label={t('settings.currentPassword')}
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
          />
          <TextField
            label={t('settings.newPassword')}
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            hint={t('auth.validation.passwordTooShort')}
            required
          />
          {pwError ? <p className="text-sm text-danger">{pwError}</p> : null}
          {pwMsg ? <p className="text-sm text-success">{pwMsg}</p> : null}
          <div>
            <Button type="submit" loading={changePassword.isPending}>
              {t('settings.updatePassword')}
            </Button>
          </div>
        </form>
      </section>

      <section>
        <h3 className="mb-1 font-semibold">{t('settings.twoFactor')}</h3>
        <p className="mb-3 text-sm text-text-muted">
          {totpEnabled ? t('settings.twoFaOn') : t('settings.twoFaOff')}
        </p>

        {twoFaError ? <p className="mb-2 text-sm text-danger">{twoFaError}</p> : null}
        {twoFaMsg ? <p className="mb-2 text-sm text-success">{twoFaMsg}</p> : null}

        {!totpEnabled && !setup ? (
          <Button onClick={handleSetup} loading={setup2fa.isPending}>
            {t('settings.enableTwoFa')}
          </Button>
        ) : null}

        {setup ? (
          <div className="max-w-lg rounded-[var(--radius-md)] border border-border bg-surface p-4">
            <p className="text-sm">{t('settings.scanQr')}</p>
            {setup.qrDataUrl ? (
              <img src={setup.qrDataUrl} alt="TOTP QR" className="mt-3 rounded bg-white p-2" width={160} height={160} />
            ) : null}
            <p className="mt-3 text-sm">
              {t('settings.manualSecret')} <code className="rounded bg-bg-subtle px-1.5 py-0.5">{setup.secret}</code>
            </p>
            <p className="mt-3 text-sm font-medium">{t('settings.backupCodes')}</p>
            <ul className="mt-1 grid grid-cols-2 gap-1 font-mono text-xs">
              {setup.backupCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <form onSubmit={handleEnable} className="mt-4 flex gap-2">
              <TextField label={t('auth.login.totp')} value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" required />
              <div className="self-end">
                <Button type="submit" loading={enable2fa.isPending}>
                  {t('common.save')}
                </Button>
              </div>
            </form>
          </div>
        ) : null}

        {totpEnabled ? (
          <form onSubmit={handleDisable} className="mt-2 flex max-w-xs gap-2">
            <TextField label={t('auth.login.totp')} value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" required />
            <div className="self-end">
              <Button type="submit" variant="danger" loading={disable2fa.isPending}>
                {t('settings.disableTwoFa')}
              </Button>
            </div>
          </form>
        ) : null}
      </section>
    </div>
  );
}
