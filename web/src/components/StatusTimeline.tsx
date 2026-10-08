import type { TrainStatus } from '../lib/api';
import { formatIstTime } from '../lib/dates';

const DOT: Record<string, string> = {
  DEPARTED: 'bg-teal border-teal',
  ARRIVED: 'bg-saffron border-saffron ring-4 ring-saffron/25',
  UPCOMING: 'bg-card border-line',
  SKIPPED: 'bg-card border-bad border-dashed',
};

/** Station-by-station view of a train's live status. */
export function StatusTimeline({ status }: { status: TrainStatus }) {
  return (
    <ol className="relative mt-3 space-y-0" aria-label={`Stations for train ${status.trainNumber}`}>
      {status.stations.map((st, i) => {
        const sched = st.scheduledArrival ?? st.scheduledDeparture!;
        const expected = st.expectedArrival ?? st.expectedDeparture!;
        const late = st.delayMinutes > 0 && st.state !== 'SKIPPED';
        const last = i === status.stations.length - 1;
        return (
          <li key={st.code} className="relative flex gap-3 pb-3 last:pb-0">
            {!last && (
              <span
                aria-hidden="true"
                className={`absolute top-4 left-[5px] h-full w-0.5 ${st.state === 'DEPARTED' ? 'bg-teal' : 'bg-line'}`}
              />
            )}
            <span
              aria-hidden="true"
              className={`relative mt-1 size-3 shrink-0 rounded-full border-2 ${DOT[st.state]}`}
            />
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3 text-sm">
              <p className={st.state === 'SKIPPED' ? 'text-muted line-through' : ''}>
                <span className="font-mono font-semibold">{st.code}</span>{' '}
                <span className="text-muted">{st.name}</span>
                <span className="sr-only">, {st.state.toLowerCase()}</span>
              </p>
              <p className="flex items-baseline gap-2 tabular-nums">
                {st.platform && (
                  <span className="rounded bg-badge-platform px-1.5 text-xs font-medium text-badge-platform-ink">
                    PF {st.platform}
                  </span>
                )}
                {st.state === 'SKIPPED' ? (
                  <span className="text-xs font-medium text-bad">Skipped</span>
                ) : (
                  <>
                    {late && <s className="text-xs text-muted">{formatIstTime(sched)}</s>}
                    <span className={late ? 'font-semibold text-bad' : ''}>
                      {formatIstTime(expected)}
                    </span>
                  </>
                )}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
