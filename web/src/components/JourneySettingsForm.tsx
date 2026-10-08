import { useId, useState } from 'react';
import { journeySettingsSchema } from '@safar-saathi/server/schemas';
import { api, ApiError, type Journey, type JourneySettings } from '../lib/api';
import { formatJourneyDate } from '../lib/dates';

interface Props {
  journey: Journey;
  /** The user's other journeys, for connection mode. */
  others: Journey[];
  onSaved: (journey: Journey) => void;
}

const DELAY_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120];
const BUFFER_OPTIONS = [0, 5, 10, 15, 20, 30, 45, 60];
const CHANGE_OPTIONS = [10, 15, 20, 30, 45, 60, 90, 120];

/** Smart rules for one journey: delay threshold, quiet hours, "leave now" and connection. */
export function JourneySettingsForm({ journey, others, onSaved }: Props) {
  const id = useId();
  const [s, setS] = useState<JourneySettings>(journey.settings);
  const [quietOn, setQuietOn] = useState(journey.settings.quietHoursStart !== null);
  const [travelText, setTravelText] = useState(
    journey.settings.travelTimeMinutes?.toString() ?? '',
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof JourneySettings>(k: K, v: JourneySettings[K]) =>
    setS((x) => ({ ...x, [k]: v }));
  const hasDelayAlert = journey.alertTypes.includes('DELAY');

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('');
    const travel = travelText.trim() === '' ? null : Number(travelText);
    const next: JourneySettings = {
      ...s,
      quietHoursStart: quietOn ? (s.quietHoursStart ?? '22:00') : null,
      quietHoursEnd: quietOn ? (s.quietHoursEnd ?? '06:30') : null,
      travelTimeMinutes: travel,
    };
    const parsed = journeySettingsSchema.safeParse(next);
    if (!parsed.success || (travel !== null && !Number.isInteger(travel))) {
      const errs: Record<string, string> = {};
      for (const i of parsed.success ? [] : parsed.error.issues)
        errs[String(i.path[0])] ??= i.message;
      if (travel !== null && !Number.isInteger(travel))
        errs['travelTimeMinutes'] = 'Enter whole minutes';
      setErrors(errs);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const { journey: saved } = await api.saveJourneySettings(journey.id, parsed.data);
      onSaved(saved);
      setStatus('Settings saved.');
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      else setStatus(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const err = (k: string) =>
    errors[k] ? (
      <p id={`${id}-${k}-error`} className="field-error">
        {errors[k]}
      </p>
    ) : null;

  return (
    <form
      onSubmit={save}
      noValidate
      aria-label={`Settings for train ${journey.trainNumber}`}
      className="space-y-4"
    >
      <div>
        <label htmlFor={`${id}-delay`} className="field-label">
          Delay alerts start at
        </label>
        <select
          id={`${id}-delay`}
          value={s.minDelayMinutes ?? ''}
          onChange={(e) =>
            set('minDelayMinutes', e.target.value === '' ? null : Number(e.target.value))
          }
          className="field-input py-2"
        >
          <option value="">15 minutes late (default)</option>
          {DELAY_OPTIONS.filter((m) => m !== 15).map((m) => (
            <option key={m} value={m}>
              {m} minutes late
            </option>
          ))}
        </select>
        {!hasDelayAlert && (
          <p className="mt-1 text-xs text-muted">Turn on Delay alerts for this to apply.</p>
        )}
      </div>

      <fieldset>
        <legend className="field-label">Quiet hours</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={quietOn}
            onChange={(e) => setQuietOn(e.target.checked)}
            className="size-4 accent-teal"
          />
          Hold non-urgent alerts during these hours (IST)
        </label>
        {quietOn && (
          <div className="mt-2 flex items-center gap-2">
            <label className="sr-only" htmlFor={`${id}-qs`}>
              Quiet hours start
            </label>
            <input
              id={`${id}-qs`}
              type="time"
              value={s.quietHoursStart ?? '22:00'}
              onChange={(e) => set('quietHoursStart', e.target.value)}
              className="field-input w-32 py-2"
            />
            <span aria-hidden="true">to</span>
            <label className="sr-only" htmlFor={`${id}-qe`}>
              Quiet hours end
            </label>
            <input
              id={`${id}-qe`}
              type="time"
              value={s.quietHoursEnd ?? '06:30'}
              onChange={(e) => set('quietHoursEnd', e.target.value)}
              aria-invalid={errors['quietHoursEnd'] ? true : undefined}
              aria-describedby={errors['quietHoursEnd'] ? `${id}-quietHoursEnd-error` : undefined}
              className="field-input w-32 py-2"
            />
          </div>
        )}
        {err('quietHoursEnd')}
        <p className="mt-1 text-xs text-muted">
          Cancellations, diversions, leave-now and connection alerts still come through.
        </p>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="field-label">Leave home now</legend>
        <div>
          <label htmlFor={`${id}-travel`} className="text-sm">
            Travel time to {journey.fromStationCode} (minutes)
          </label>
          <input
            id={`${id}-travel`}
            inputMode="numeric"
            placeholder="Off"
            value={travelText}
            onChange={(e) => setTravelText(e.target.value.replace(/[^\d]/g, '').slice(0, 3))}
            aria-invalid={errors['travelTimeMinutes'] ? true : undefined}
            aria-describedby={
              errors['travelTimeMinutes'] ? `${id}-travelTimeMinutes-error` : undefined
            }
            className="field-input mt-1 py-2"
          />
          {err('travelTimeMinutes')}
        </div>
        <div>
          <label htmlFor={`${id}-buffer`} className="text-sm">
            Extra time to spare
          </label>
          <select
            id={`${id}-buffer`}
            value={s.leaveBufferMinutes}
            onChange={(e) => set('leaveBufferMinutes', Number(e.target.value))}
            className="field-input mt-1 py-2"
          >
            {BUFFER_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m} minutes
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-muted sm:col-span-2">
          We'll alert you when it's time to leave, based on the live expected departure.
        </p>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="field-label">Connection</legend>
        <div>
          <label htmlFor={`${id}-conn`} className="text-sm">
            Connects to
          </label>
          <select
            id={`${id}-conn`}
            value={s.connectsToJourneyId ?? ''}
            onChange={(e) => set('connectsToJourneyId', e.target.value || null)}
            aria-invalid={errors['connectsToJourneyId'] ? true : undefined}
            className="field-input mt-1 py-2"
          >
            <option value="">No connection</option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.trainNumber} {o.fromStationCode} → {o.toStationCode},{' '}
                {formatJourneyDate(o.journeyDate)}
              </option>
            ))}
          </select>
          {err('connectsToJourneyId')}
        </div>
        <div>
          <label htmlFor={`${id}-change`} className="text-sm">
            Time needed to change
          </label>
          <select
            id={`${id}-change`}
            value={s.connectionBufferMinutes}
            disabled={!s.connectsToJourneyId}
            onChange={(e) => set('connectionBufferMinutes', Number(e.target.value))}
            className="field-input mt-1 py-2"
          >
            {CHANGE_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m} minutes
              </option>
            ))}
          </select>
        </div>
        {s.connectsToJourneyId &&
          others.find((o) => o.id === s.connectsToJourneyId)?.fromStationCode !==
            journey.toStationCode && (
            <p className="text-xs text-badge-delay-ink sm:col-span-2">
              Heads-up: that train starts from a different station than {journey.toStationCode}.
              We'll compare your arrival at {journey.toStationCode} with its departure, so allow for
              the trip between stations.
            </p>
          )}
      </fieldset>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className="btn-primary px-4 py-2">
          {busy ? 'Saving…' : 'Save settings'}
        </button>
        <p role="status" className="text-sm text-ok">
          {status}
        </p>
      </div>
    </form>
  );
}
