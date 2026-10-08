import { useId, useState } from 'react';
import {
  ALERT_TYPES,
  createJourneySchema,
  journeyDateProblem,
  MAX_DAYS_AHEAD,
  type AlertType,
  type CreateJourneyInput,
} from '@safar-saathi/server/schemas';
import { ApiError } from '../lib/api';
import { istDate } from '../lib/dates';
import { ALERT_TYPE_INFO } from './alertTypes';
import { StationCombobox } from './StationCombobox';

interface Props {
  onCreate: (input: CreateJourneyInput) => Promise<void>;
  /** Injected for tests. */
  now?: () => Date;
}

type Errors = Partial<Record<string, string>>;

const emptyForm = (today: string) => ({
  trainNumber: '',
  fromStationCode: '',
  fromStationName: '',
  toStationCode: '',
  toStationName: '',
  journeyDate: today,
  alertTypes: ['DEPARTURE', 'DELAY', 'PLATFORM_CHANGE'] as AlertType[],
});

export function JourneyForm({ onCreate, now = () => new Date() }: Props) {
  const today = istDate(now());
  const [form, setForm] = useState(() => emptyForm(today));
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState('');
  const ids = { train: useId(), date: useId(), fromName: useId(), toName: useId(), types: useId() };

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors(({ [key]: _gone, ...rest }) => rest);
  };

  const toggleType = (type: AlertType) =>
    set(
      'alertTypes',
      form.alertTypes.includes(type)
        ? form.alertTypes.filter((t) => t !== type)
        : [...form.alertTypes, type],
    );

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus('');

    const parsed = createJourneySchema.safeParse(form);
    const next: Errors = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
    }
    const dateProblem = journeyDateProblem(form.journeyDate, now());
    if (dateProblem) next.journeyDate ??= dateProblem;

    if (!parsed.success || dateProblem) {
      setErrors(next);
      focusFirstError(e.currentTarget);
      return;
    }

    setSubmitting(true);
    try {
      await onCreate(parsed.data);
      setForm(emptyForm(istDate(now())));
      setErrors({});
      setStatus(`Journey for train ${parsed.data.trainNumber} added.`);
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) {
        setErrors(
          Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k.split('.')[0], v])),
        );
      } else {
        setErrors({ form: err instanceof Error ? err.message : 'Could not add the journey.' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      aria-labelledby="new-journey-heading"
      className="space-y-5"
    >
      <h2 id="new-journey-heading" className="text-xl font-semibold tracking-tight">
        Add a journey
      </h2>

      <div>
        <label htmlFor={ids.train} className="field-label">
          Train number
        </label>
        <input
          id={ids.train}
          name="trainNumber"
          inputMode="numeric"
          autoComplete="off"
          maxLength={5}
          placeholder="e.g. 12951"
          value={form.trainNumber}
          onChange={(e) => set('trainNumber', e.target.value.replace(/\D/g, ''))}
          aria-invalid={errors.trainNumber ? true : undefined}
          aria-describedby={errors.trainNumber ? `${ids.train}-error` : undefined}
          className="field-input font-mono tracking-wider"
        />
        {errors.trainNumber && (
          <p id={`${ids.train}-error`} className="field-error">
            {errors.trainNumber}
          </p>
        )}
      </div>

      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        <StationCombobox
          label="From station"
          name="fromStationCode"
          value={form.fromStationCode}
          onChange={(v) => set('fromStationCode', v)}
          onSelect={(s) => set('fromStationName', s.name)}
          error={errors.fromStationCode}
        />
        <StationCombobox
          label="To station"
          name="toStationCode"
          value={form.toStationCode}
          onChange={(v) => set('toStationCode', v)}
          onSelect={(s) => set('toStationName', s.name)}
          error={errors.toStationCode}
        />
      </div>

      <details className="group -mt-2 rounded-xl text-sm">
        <summary className="cursor-pointer text-muted hover:text-ink">
          Station names (optional)
        </summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={ids.fromName} className="field-label">
              From station name
            </label>
            <input
              id={ids.fromName}
              value={form.fromStationName}
              maxLength={80}
              onChange={(e) => set('fromStationName', e.target.value)}
              className="field-input"
            />
          </div>
          <div>
            <label htmlFor={ids.toName} className="field-label">
              To station name
            </label>
            <input
              id={ids.toName}
              value={form.toStationName}
              maxLength={80}
              onChange={(e) => set('toStationName', e.target.value)}
              className="field-input"
            />
          </div>
        </div>
      </details>

      <div>
        <label htmlFor={ids.date} className="field-label">
          Journey date
        </label>
        <input
          id={ids.date}
          name="journeyDate"
          type="date"
          min={istDate(now(), -1)}
          max={istDate(now(), MAX_DAYS_AHEAD)}
          value={form.journeyDate}
          onChange={(e) => set('journeyDate', e.target.value)}
          aria-invalid={errors.journeyDate ? true : undefined}
          aria-describedby={errors.journeyDate ? `${ids.date}-error` : undefined}
          className="field-input"
        />
        {errors.journeyDate && (
          <p id={`${ids.date}-error`} className="field-error">
            {errors.journeyDate}
          </p>
        )}
      </div>

      <fieldset
        aria-describedby={errors.alertTypes ? `${ids.types}-error` : undefined}
        aria-invalid={errors.alertTypes ? true : undefined}
      >
        <legend className="field-label">Alert me about</legend>
        <div className="grid grid-cols-2 gap-2">
          {ALERT_TYPES.map((type) => {
            const info = ALERT_TYPE_INFO[type];
            const checked = form.alertTypes.includes(type);
            return (
              <label
                key={type}
                className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-saffron ${
                  checked ? 'border-teal bg-teal-soft/60' : 'border-line bg-card hover:border-muted'
                }`}
              >
                <input
                  type="checkbox"
                  name="alertTypes"
                  value={type}
                  checked={checked}
                  onChange={() => toggleType(type)}
                  className="mt-0.5 size-4 accent-teal"
                />
                <span>
                  <span className="block text-sm font-medium">{info.label}</span>
                  <span className="block text-xs text-muted">{info.hint}</span>
                </span>
              </label>
            );
          })}
        </div>
        {errors.alertTypes && (
          <p id={`${ids.types}-error`} className="field-error">
            {errors.alertTypes}
          </p>
        )}
      </fieldset>

      {errors.form && (
        <p role="alert" className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">
          {errors.form}
        </p>
      )}

      <button type="submit" disabled={submitting} className="btn-primary w-full">
        {submitting ? 'Adding…' : 'Add journey'}
      </button>
      <p role="status" className="text-sm text-ok">
        {status}
      </p>
    </form>
  );
}

function focusFirstError(form: HTMLFormElement) {
  requestAnimationFrame(() => {
    const el = form.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (el instanceof HTMLFieldSetElement) el.querySelector<HTMLElement>('input')?.focus();
    else el?.focus();
  });
}
