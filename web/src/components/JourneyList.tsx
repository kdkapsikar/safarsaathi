import { useState } from 'react';
import type { Journey } from '../lib/api';
import { formatJourneyDate, relativeDateLabel } from '../lib/dates';
import { ALERT_TYPE_INFO } from './alertTypes';
import { ConfirmDialog } from './ConfirmDialog';

interface Props {
  journeys: Journey[];
  onDelete: (id: string) => Promise<void>;
  now?: () => Date;
}

const DATE_BADGE: Record<string, string> = {
  Today: 'bg-saffron text-ink',
  Tomorrow: 'bg-teal text-white',
  Yesterday: 'bg-line text-ink',
  Upcoming: 'bg-teal-soft text-teal',
  Past: 'bg-line text-muted',
};

export function JourneyList({ journeys, onDelete, now = () => new Date() }: Props) {
  const [pending, setPending] = useState<Journey | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const confirmDelete = async () => {
    if (!pending) return;
    setDeleting(true);
    setError('');
    try {
      await onDelete(pending.id);
      setPending(null);
    } catch (err) {
      setPending(null);
      setError(err instanceof Error ? err.message : 'Could not delete the journey.');
    } finally {
      setDeleting(false);
    }
  };

  if (journeys.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-2xl border border-dashed border-line px-6 py-14 text-center">
        <svg aria-hidden="true" viewBox="0 0 64 40" className="h-10 w-16 text-teal/50">
          <path
            d="M4 34h56M10 34l5-24h34l5 24M18 18h28M24 34v-6h16v6"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <h3 className="mt-4 font-semibold">No journeys yet</h3>
        <p className="mt-1 max-w-xs text-sm text-muted">
          Add your next train and we'll watch it for you: departure, delays and platform changes.
        </p>
      </div>
    );
  }

  return (
    <>
      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}
      <ul className="space-y-3">
        {journeys.map((j) => {
          const label = relativeDateLabel(j.journeyDate, now());
          const route = `${j.fromStationCode} to ${j.toStationCode}`;
          return (
            <li key={j.id} className="rounded-2xl border border-line bg-card p-4 shadow-sm sm:p-5">
              <article aria-label={`Train ${j.trainNumber}, ${route}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-sm font-semibold tracking-wider text-teal">
                      {j.trainNumber}
                    </p>
                    <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-lg font-semibold">
                      <span>{j.fromStationCode}</span>
                      <span aria-hidden="true" className="text-muted">
                        →
                      </span>
                      <span className="sr-only">to</span>
                      <span>{j.toStationCode}</span>
                    </p>
                    {(j.fromStationName || j.toStationName) && (
                      <p className="text-sm text-muted">
                        {j.fromStationName ?? j.fromStationCode} –{' '}
                        {j.toStationName ?? j.toStationCode}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setPending(j)}
                    aria-label={`Delete journey: train ${j.trainNumber}, ${route}`}
                    className="rounded-lg p-2 text-muted hover:bg-bad/10 hover:text-bad focus-visible:outline-2 focus-visible:outline-saffron"
                  >
                    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5">
                      <path
                        d="M4 6h12M8 6V4h4v2m-6 0 1 10h6l1-10"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                  <time dateTime={j.journeyDate} className="font-medium">
                    {formatJourneyDate(j.journeyDate)}
                  </time>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${DATE_BADGE[label]}`}
                  >
                    {label}
                  </span>
                </div>

                <ul aria-label="Alerts" className="mt-3 flex flex-wrap gap-1.5">
                  {j.alertTypes.map((t) => (
                    <li
                      key={t}
                      className={`rounded-md px-2 py-0.5 text-xs font-medium ${ALERT_TYPE_INFO[t].badge}`}
                    >
                      {ALERT_TYPE_INFO[t].label}
                    </li>
                  ))}
                </ul>
              </article>
            </li>
          );
        })}
      </ul>

      {pending && (
        <ConfirmDialog
          title="Delete this journey?"
          body={`Train ${pending.trainNumber}, ${pending.fromStationCode} → ${pending.toStationCode} on ${formatJourneyDate(pending.journeyDate)}. You'll stop getting alerts for it.`}
          confirmLabel="Delete journey"
          busy={deleting}
          onConfirm={confirmDelete}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}
