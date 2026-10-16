import { useState, type FormEvent } from 'react';
import { Link, useNavigate, Navigate } from 'react-router-dom';
import { useAuth, isApiError } from '../features/auth/AuthContext';
import { useT } from '../i18n/i18n';
import { TextField } from '../components/ui/Field';
import { Button } from '../components/ui/Button';

export function RegisterPage() {
  const t = useT();
  const { user, register } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setLoading(true);
    try {
      await register({ username, email, password, acceptTerms: true });
      navigate('/login', { state: { registered: true } });
    } catch (err) {
      if (isApiError(err)) {
        setError(err.message);
        if (err.details) {
          const mapped: Record<string, string> = {};
          for (const [field, messages] of Object.entries(err.details)) {
            if (Array.isArray(messages) && messages.length) mapped[field] = messages[0]!;
          }
          setFieldErrors(mapped);
        }
      } else {
        setError(t('common.error'));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">{t('auth.register.title')}</h1>

      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        <TextField
          label={t('auth.register.username')}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoFocus
          required
          error={fieldErrors.username}
        />
        <TextField
          label={t('auth.register.email')}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
          error={fieldErrors.email}
        />
        <TextField
          label={t('auth.register.password')}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
          error={fieldErrors.password}
        />

        <label className="flex items-start gap-2 text-sm text-text-muted">
          <input
            type="checkbox"
            checked={acceptTerms}
            onChange={(e) => setAcceptTerms(e.target.checked)}
            className="mt-0.5 accent-[var(--accent)]"
            required
          />
          <span>{t('auth.register.acceptTerms')}</span>
        </label>

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        <Button type="submit" loading={loading} disabled={!acceptTerms} className="mt-2">
          {t('auth.register.submit')}
        </Button>
      </form>

      <p className="mt-6 text-sm text-text-muted">
        {t('auth.register.haveAccount')}{' '}
        <Link to="/login" className="text-accent hover:underline">
          {t('auth.register.linkLogin')}
        </Link>
      </p>
    </div>
  );
}
