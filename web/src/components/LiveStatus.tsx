import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, SIMULATOR_CHANGED, type TrainStatus } from '../lib/api';
import { computeLeaveTime } from '@safar-saathi/server/alerts/timing';
import { formatDelay, formatIstTime } from '../lib/dates';

const POLL_MS = 30_000;

type Load =
  | { kind: 'loading' }
  | { kind: 'ok'; status: TrainStatus }
  | { kind: 'none' }
  | { kind: 'unavailable' };

interface Props {
  trainNumber: string;
  date: string;
  /** The passenger's boarding station, to show its platform and departure. */
  boardingCode: string;
  /** "Leave now" settings: show when to leave home. */
  travelTimeMinutes?: number | null;
  leaveBufferMinutes?: number;
}

/**
 * One-line live status for a journey card. Always shows when the data is from
 * ("as of"), and says so plainly when there's no data rather than guessing.
 */
export function LiveStatus({
  trainNumber,
  date,
  boardingCode,
  travelTimeMinutes = null,
  leaveBufferMinutes = 15,
}: Props) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  const refresh = useCallback(
    (signal?: AbortSignal) => {
      api
        .trainStatus(trainNumber, date, signal, boardingCode)
        .then(({ status }) => setLoad({ kind: 'ok', status }))
        .catch((err: unknown) => {
          if (signal?.aborted) return;
          setLoad(
            err instanceof ApiError && err.status === 404
              ? { kind: 'none' }
              : { kind: 'unavailable' },
          );
        });
    },
    [trainNumber, date, boardingCode],
  );

  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal);
    const timer = setInterval(() => refresh(controller.signal), POLL_MS);
    const onSim = () => refresh(controller.signal);
    window.addEventListener(SIMULATOR_CHANGED, onSim);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener(SIMULATOR_CHANGED, onSim);
    };
  }, [refresh]);

  if (load.kind === 'loading') {
    return (
      <p className="mt-3 h-10 animate-pulse rounded-lg bg-paper" aria-label="Loading live status" />
    );
  }
  if (load.kind === 'none') {
    return <p className="mt-3 text-sm text-muted">No live data for this train yet.</p>;
  }
  if (load.kind === 'unavailable') {
    return (
      <p className="mt-3 text-sm text-muted">
        Live data is unavailable right now. We'll keep trying.
      </p>
    );
  }

  const s = load.status;
  const boarding = s.stations.find((st) => st.code === boardingCode);
  const { tone, headline } = summarize(s);

  const details: string[] = [];
  if (boarding && !s.cancelled) {
    if (boarding.state === 'DEPARTED' && boarding.expectedDeparture) {
      details.push(`Left ${boarding.code} at ${formatIstTime(boarding.expectedDeparture)}`);
    } else if (boarding.state === 'SKIPPED') {
      details.push(`Not stopping at ${boarding.code}`);
    } else if (boarding.expectedDeparture) {
      const late = boarding.delayMinutes > 0;
      details.push(
        `${late ? 'Expected' : 'Departs'} ${boarding.code} ${formatIstTime(boarding.expectedDeparture)}` +
          (late ? ` (sched. ${formatIstTime(boarding.scheduledDeparture!)})` : ''),
      );
    }
    if (boarding.platform && boarding.state !== 'DEPARTED') {
      details.push(`Platform ${boarding.platform}`);
    }
  }
  if (s.currentStation && s.state === 'RUNNING') details.push(`Last at ${s.currentStation.name}`);

  const leave =
    travelTimeMinutes !== null
      ? computeLeaveTime(
          s,
          boardingCode,
          travelTimeMinutes,
          leaveBufferMinutes,
          new Date(s.fetchedAt),
        )
      : null;

  return (
    <div className={`mt-3 rounded-xl px-3 py-2 text-sm ${TONE[tone]}`} aria-live="polite">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-semibold">{headline}</span>
        {details.length > 0 && <span>{details.join(' · ')}</span>}
      </p>
      {leave?.state === 'OK' && (
        <p className="mt-0.5 font-semibold">
          {leave.minutesUntilLeave <= 0
            ? 'Time to leave now'
            : `Leave home by ${formatIstTime(leave.leaveBy)}`}
          <span className="font-normal">
            {' '}
            ({leave.travelMinutes} min travel + {leave.bufferMinutes} min spare)
          </span>
        </p>
      )}
      {s.note && <p className="mt-0.5">{s.note}</p>}
      <p className="mt-0.5 text-xs opacity-75">
        as of {formatIstTime(s.fetchedAt)}
        {s.source === 'simulator' ? ' · simulated data' : ''}
      </p>
    </div>
  );
}

const TONE = {
  good: 'bg-ok/10 text-ok',
  warn: 'bg-badge-delay text-badge-delay-ink',
  bad: 'bg-bad/10 text-bad',
  neutral: 'bg-paper text-ink',
} as const;

function summarize(s: TrainStatus): { tone: keyof typeof TONE; headline: string } {
  if (s.cancelled) return { tone: 'bad', headline: 'Cancelled' };
  if (s.state === 'ARRIVED') {
    return {
      tone: 'neutral',
      headline: `Arrived${s.delayMinutes > 0 ? `, ${formatDelay(s.delayMinutes)}` : ''}`,
    };
  }
  if (s.diverted) return { tone: 'warn', headline: 'Diverted' };
  if (s.delayMinutes >= 15)
    return { tone: 'bad', headline: `Running ${formatDelay(s.delayMinutes)}` };
  if (s.delayMinutes > 0)
    return { tone: 'warn', headline: `Running ${formatDelay(s.delayMinutes)}` };
  return { tone: 'good', headline: s.state === 'NOT_STARTED' ? 'Scheduled, on time' : 'On time' };
}
