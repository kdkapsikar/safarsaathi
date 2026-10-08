import { useEffect, useId, useState } from 'react';
import { addRecipientSchema } from '@safar-saathi/server/schemas';
import { api, ApiError, appUrl, DEMO_MODE, type Journey, type Recipient } from '../lib/api';

interface Props {
  journey: Journey;
  onInviteChange: (inviteToken: string | null) => void;
}

/** Family or a driver who get this journey's alerts, and the invite link. */
export function RecipientsPanel({ journey, onInviteChange }: Props) {
  const id = useId();
  const [list, setList] = useState<Recipient[] | null>(null);
  const [form, setForm] = useState({ name: '', email: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.recipients(journey.id).then(
      (r) => !cancelled && setList(r.recipients),
      () => !cancelled && setList([]),
    );
    return () => {
      cancelled = true;
    };
  }, [journey.id]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    const parsed = addRecipientSchema.safeParse(form);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues)
        errs[String(i.path[0])] ??=
          i.message === 'Invalid email address' ? 'Enter a valid email' : i.message;
      setErrors(errs);
      return;
    }
    setErrors({});
    try {
      const { recipient } = await api.addRecipient(journey.id, parsed.data);
      setList((l) => [...(l ?? []), recipient]);
      setForm({ name: '', email: '' });
      setMessage(`${recipient.name} will get this journey's alerts.`);
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      else setMessage(err instanceof Error ? err.message : 'Could not add them.');
    }
  };

  const remove = async (r: Recipient) => {
    await api.removeRecipient(journey.id, r.id).catch(() => null);
    setList((l) => (l ?? []).filter((x) => x.id !== r.id));
    setMessage(`${r.name} removed.`);
  };

  const inviteUrl = journey.inviteToken ? appUrl(`/join/${journey.inviteToken}`) : null;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        People waiting for you, like family or your driver, get this journey's delay, platform,
        departure and arrival alerts by email
        {DEMO_MODE
          ? ' (in this demo, emails are only simulated)'
          : ' (email isn’t live yet in this preview)'}
        . Every email has a link to stop them.
      </p>

      {list === null ? (
        <p className="h-10 animate-pulse rounded-lg bg-paper" aria-label="Loading people" />
      ) : list.length === 0 ? (
        <p className="text-sm">No one yet.</p>
      ) : (
        <ul
          aria-label="People getting alerts"
          className="divide-y divide-line rounded-xl border border-line"
        >
          {list.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="font-medium">{r.name}</span>{' '}
                <span className="break-all text-muted">{r.email}</span>
                {r.optedOut && (
                  <span className="ml-2 rounded bg-line px-1.5 text-xs font-medium text-muted">
                    Opted out
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => void remove(r)}
                aria-label={`Remove ${r.name}`}
                className="shrink-0 text-sm font-medium text-bad hover:underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={add}
        noValidate
        aria-label="Add someone"
        className="grid gap-2 sm:grid-cols-[1fr_1.4fr_auto] sm:items-start"
      >
        <div>
          <label htmlFor={`${id}-name`} className="sr-only">
            Their name
          </label>
          <input
            id={`${id}-name`}
            placeholder="Name"
            maxLength={80}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            aria-invalid={errors['name'] ? true : undefined}
            className="field-input py-2"
          />
          {errors['name'] && <p className="field-error">{errors['name']}</p>}
        </div>
        <div>
          <label htmlFor={`${id}-email`} className="sr-only">
            Their email
          </label>
          <input
            id={`${id}-email`}
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            aria-invalid={errors['email'] ? true : undefined}
            className="field-input py-2"
          />
          {errors['email'] && <p className="field-error">{errors['email']}</p>}
        </div>
        <button type="submit" className="btn-primary px-4 py-2">
          Add
        </button>
      </form>
      <p role="status" className="text-sm text-ok">
        {message}
      </p>

      <div className="rounded-xl bg-paper p-3">
        <p className="text-sm font-medium">Invite link</p>
        {inviteUrl ? (
          <>
            <p className="mt-1 text-xs text-muted">
              Anyone with this link can add themselves to this journey's alerts.
            </p>
            <div className="mt-2 flex gap-2">
              <label htmlFor={`${id}-invite`} className="sr-only">
                Invite link
              </label>
              <input
                id={`${id}-invite`}
                readOnly
                value={inviteUrl}
                onFocus={(e) => e.target.select()}
                className="field-input py-2 text-xs"
              />
              <button
                type="button"
                className="btn-secondary px-3 py-2 text-xs"
                onClick={() => {
                  void navigator.clipboard?.writeText(inviteUrl).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  });
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <button
              type="button"
              onClick={() => void api.disableInvite(journey.id).then(() => onInviteChange(null))}
              className="mt-2 text-xs font-medium text-bad hover:underline"
            >
              Turn off link
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() =>
              void api.enableInvite(journey.id).then((r) => onInviteChange(r.inviteToken))
            }
            className="btn-secondary mt-2 px-3 py-2 text-xs"
          >
            Create invite link
          </button>
        )}
      </div>
    </div>
  );
}
