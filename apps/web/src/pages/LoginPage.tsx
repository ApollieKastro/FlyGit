import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth, TwoFactorRequiredError } from '../features/auth/AuthContext';
import { useT } from '../i18n/i18n';
import { TextField } from '../components/ui/Field';
import { Button } from '../components/ui/Button';
import { isApiError } from '../features/auth/AuthContext';

export function LoginPage() {
  const t = useT();
  const { user, login, loginWith2FA } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to={from} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (challengeToken) {
        await loginWith2FA(challengeToken, totp);
      } else {
        await login(identifier, password);
      }
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof TwoFactorRequiredError) {
        setChallengeToken(err.challengeToken);
      } else if (isApiError(err)) {
        setError(err.message);
      } else {
        setError(t('auth.login.error'));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">{t('auth.login.title')}</h1>

      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        {challengeToken ? (
          <TextField
            label={t('auth.login.totp')}
            value={totp}
            onChange={(e) => setTotp(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            required
          />
        ) : (
          <>
            <TextField
              label={t('auth.login.identifier')}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
            <TextField
              label={t('auth.login.password')}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </>
        )}

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        <Button type="submit" loading={loading} className="mt-2">
          {t('auth.login.submit')}
        </Button>
      </form>

      <p className="mt-6 text-sm text-text-muted">
        {t('auth.login.noAccount')}{' '}
        <Link to="/register" className="text-accent hover:underline">
          {t('auth.login.linkRegister')}
        </Link>
      </p>
    </div>
  );
}
