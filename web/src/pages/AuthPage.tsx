import { useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { loginSchema, registerSchema } from '@safar-saathi/server/schemas';
import { useAuth } from '../auth/AuthContext';
import { Brand } from '../components/Brand';
import { DEMO_ACCOUNT } from '@safar-saathi/server/db/demoAccount';
import { ApiError, DEMO_MODE } from '../lib/api';

type Mode = 'signin' | 'signup';
type Errors = Partial<Record<'name' | 'email' | 'password' | 'form', string>>;

const COPY = {
  signin: {
    title: 'Welcome back',
    subtitle: 'Sign in to see your journeys.',
    submit: 'Sign in',
    busy: 'Signing in…',
    switchText: 'New to Safar Saathi?',
    switchLink: 'Create an account',
    switchTo: '/signup',
  },
  signup: {
    title: 'Create your account',
    subtitle: 'Free, no ads. Takes under a minute.',
    submit: 'Create account',
    busy: 'Creating account…',
    switchText: 'Already have an account?',
    switchLink: 'Sign in',
    switchTo: '/signin',
  },
} as const;

export function AuthPage({ mode }: { mode: Mode }) {
  const copy = COPY[mode];
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const [values, setValues] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const ids = { name: useId(), email: useId(), password: useId() };

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const parsed =
      mode === 'signup' ? registerSchema.safeParse(values) : loginSchema.safeParse(values);
    if (!parsed.success) {
      const next: Errors = {};
      for (const i of parsed.error.issues) next[i.path[0] as keyof Errors] ??= i.message;
      setErrors(next);
      const form = e.currentTarget;
      requestAnimationFrame(() =>
        form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
      return;
    }

    setBusy(true);
    setErrors({});
    try {
      if (mode === 'signup') await signUp(values.name, values.email, values.password);
      else await signIn(values.email, values.password);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      else setErrors({ form: err instanceof Error ? err.message : 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  };

  const field = (
    key: 'name' | 'email' | 'password',
    label: string,
    props: React.InputHTMLAttributes<HTMLInputElement>,
  ) => (
    <div>
      <label htmlFor={ids[key]} className="field-label">
        {label}
      </label>
      <input
        id={ids[key]}
        name={key}
        value={values[key]}
        onChange={(e) => {
          setValues((v) => ({ ...v, [key]: e.target.value }));
          if (errors[key]) setErrors(({ [key]: _gone, ...rest }) => rest);
        }}
        aria-invalid={errors[key] ? true : undefined}
        aria-describedby={errors[key] ? `${ids[key]}-error` : undefined}
        className="field-input"
        {...props}
      />
      {errors[key] && (
        <p id={`${ids[key]}-error`} className="field-error">
          {errors[key]}
        </p>
      )}
    </div>
  );

  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-8">
      <Brand />
      <main className="mt-10 w-full max-w-sm">
        <h1 className="text-2xl font-bold tracking-tight">{copy.title}</h1>
        <p className="mt-1 text-muted">{copy.subtitle}</p>

        {DEMO_MODE && mode === 'signin' && (
          <div className="mt-6 rounded-xl border border-saffron/60 bg-saffron/10 p-3 text-sm">
            <p className="font-semibold">Demo login</p>
            <p className="mt-0.5">
              Username <code className="font-mono font-semibold">{DEMO_ACCOUNT.email}</code> ·
              Password <code className="font-mono font-semibold">{DEMO_ACCOUNT.password}</code>
            </p>
            <button
              type="button"
              onClick={() =>
                setValues({ name: '', email: DEMO_ACCOUNT.email, password: DEMO_ACCOUNT.password })
              }
              className="mt-2 text-sm font-semibold text-teal underline-offset-4 hover:underline"
            >
              Fill in the demo login
            </button>
          </div>
        )}

        <form noValidate onSubmit={onSubmit} className="mt-8 space-y-4">
          {mode === 'signup' && field('name', 'Your name', { autoComplete: 'name', maxLength: 80 })}
          {mode === 'signup'
            ? field('email', 'Email', { type: 'email', autoComplete: 'email', inputMode: 'email' })
            : field('email', 'Email or username', {
                autoComplete: 'username',
                autoCapitalize: 'none',
                spellCheck: false,
              })}
          {field('password', 'Password', {
            type: 'password',
            autoComplete: mode === 'signup' ? 'new-password' : 'current-password',
            maxLength: 128,
            ...(mode === 'signup' ? { placeholder: 'At least 8 characters' } : {}),
          })}

          {errors.form && (
            <p role="alert" className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">
              {errors.form}
            </p>
          )}

          <button type="submit" disabled={busy} className="btn-primary w-full py-3">
            {busy ? copy.busy : copy.submit}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          {copy.switchText}{' '}
          <Link
            to={copy.switchTo}
            className="font-semibold text-teal underline-offset-4 hover:underline"
          >
            {copy.switchLink}
          </Link>
        </p>
      </main>
    </div>
  );
}
