import { useEffect, useId, useState } from 'react';
import { Link, useParams } from 'react-router';
import { addRecipientSchema } from '@safar-saathi/server/schemas';
import { Brand } from '../components/Brand';
import { api, ApiError, type InviteInfo, type OptOutInfo } from '../lib/api';
import { formatJourneyDate } from '../lib/dates';

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-8">
      <Brand />
      <main className="mt-10 w-full max-w-sm">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <div className="mt-4 space-y-4">{children}</div>
      </main>
    </div>
  );
}

const trip = (t: {
  trainNumber: string;
  fromStationCode: string;
  toStationCode: string;
  journeyDate: string;
}) =>
  `train ${t.trainNumber}, ${t.fromStationCode} → ${t.toStationCode} on ${formatJourneyDate(t.journeyDate)}`;

/** /join/:token: family or a driver add themselves to a journey's alerts. */
export function JoinPage() {
  const { token = '' } = useParams();
  const id = useId();
  const [info, setInfo] = useState<InviteInfo | null | 'invalid'>(null);
  const [form, setForm] = useState({ name: '', email: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  useEffect(() => {
    api.invite(token).then(
      (r) => setInfo(r.invite),
      () => setInfo('invalid'),
    );
  }, [token]);

  if (info === null)
    return (
      <Shell title="Join journey alerts">
        <p className="text-muted">Loading…</p>
      </Shell>
    );
  if (info === 'invalid') {
    return (
      <Shell title="Link not valid">
        <p className="text-muted">
          This invite link has expired or been turned off. Ask the traveller for a new one.
        </p>
      </Shell>
    );
  }
  if (done) {
    return (
      <Shell title="You're on the list">
        <p>You'll get alerts by email for {trip(info)}. Every email has a link to stop them.</p>
      </Shell>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = addRecipientSchema.safeParse(form);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues)
        errs[String(i.path[0])] ??=
          i.message === 'Invalid email address' ? 'Enter a valid email' : i.message;
      setErrors(errs);
      return;
    }
    try {
      await api.joinInvite(token, parsed.data);
      setDone(true);
    } catch (err) {
      setErrors({ form: err instanceof ApiError ? err.message : 'Something went wrong.' });
    }
  };

  return (
    <Shell title="Join journey alerts">
      <p>
        {info.ownerFirstName} invited you to get updates about {trip(info)}: delays, platform
        changes, departure and arrival.
      </p>
      <form onSubmit={submit} noValidate className="space-y-3">
        <div>
          <label htmlFor={`${id}-name`} className="field-label">
            Your name
          </label>
          <input
            id={`${id}-name`}
            value={form.name}
            maxLength={80}
            autoComplete="name"
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            aria-invalid={errors['name'] ? true : undefined}
            className="field-input"
          />
          {errors['name'] && <p className="field-error">{errors['name']}</p>}
        </div>
        <div>
          <label htmlFor={`${id}-email`} className="field-label">
            Your email
          </label>
          <input
            id={`${id}-email`}
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            aria-invalid={errors['email'] ? true : undefined}
            className="field-input"
          />
          {errors['email'] && <p className="field-error">{errors['email']}</p>}
        </div>
        {errors['form'] && (
          <p role="alert" className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">
            {errors['form']}
          </p>
        )}
        <button type="submit" className="btn-primary w-full py-3">
          Get alerts
        </button>
      </form>
    </Shell>
  );
}

/** /optout/:token: a recipient stops alerts with one click. */
export function OptOutPage() {
  const { token = '' } = useParams();
  const [info, setInfo] = useState<OptOutInfo | null | 'invalid'>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.optOutInfo(token).then(
      (r) => setInfo(r.optOut),
      () => setInfo('invalid'),
    );
  }, [token]);

  if (info === null)
    return (
      <Shell title="Stop alerts">
        <p className="text-muted">Loading…</p>
      </Shell>
    );
  if (info === 'invalid') {
    return (
      <Shell title="Link not valid">
        <p className="text-muted">
          We couldn't find these alerts. They may already have been removed.
        </p>
      </Shell>
    );
  }
  if (info.optedOut) {
    return (
      <Shell title="Alerts stopped">
        <p>You won't get any more alerts about {trip(info)}.</p>
        <Link to="/" className="text-sm font-semibold text-teal hover:underline">
          About Safar Saathi
        </Link>
      </Shell>
    );
  }
  return (
    <Shell title="Stop alerts?">
      <p>
        Hi {info.recipientName}, you're getting alerts about {trip(info)}.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void api.optOut(token).then(
            () => setInfo({ ...info, optedOut: true }),
            () => setBusy(false),
          );
        }}
        className="btn-danger w-full py-3"
      >
        Stop these alerts
      </button>
    </Shell>
  );
}
