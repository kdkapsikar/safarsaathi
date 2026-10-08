import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Brand } from '../components/Brand';
import { StatusTimeline } from '../components/StatusTimeline';
import {
  api,
  ApiError,
  notifySimulatorChanged,
  type ClockAction,
  type SimulatorState,
  type SourceHealth,
  type TrainStatus,
} from '../lib/api';
import { formatDelay, formatIstDateTime, istDate, istDateOf } from '../lib/dates';

const STEPS = [
  { label: '+15 min', minutes: 15 },
  { label: '+1 hour', minutes: 60 },
  { label: '+6 hours', minutes: 360 },
];

const HEALTH: { id: SourceHealth; label: string }[] = [
  { id: 'HEALTHY', label: 'Healthy' },
  { id: 'SLOW', label: 'Slow (times out)' },
  { id: 'DOWN', label: 'Down' },
];

function formatOffset(minutes: number): string {
  if (minutes === 0) return 'Real time';
  const sign = minutes > 0 ? '+' : '−';
  const abs = Math.abs(minutes);
  const d = Math.floor(abs / 1440);
  const h = Math.floor((abs % 1440) / 60);
  const m = abs % 60;
  const parts = [d && `${d}d`, h && `${h}h`, m && `${m}m`].filter(Boolean).join(' ');
  return `${sign}${parts} from real time`;
}

/**
 * Dev-only control room for the MockProvider: pick a scenario per train, move
 * simulated time, and break the data source to see retries and the breaker work.
 */
export function Simulator() {
  const [sim, setSim] = useState<SimulatorState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, TrainStatus | string>>({});

  const loadStatuses = useCallback(async (state: SimulatorState) => {
    const today = istDateOf(state.now);
    const yesterday = istDateOf(new Date(new Date(state.now).getTime() - 86_400_000).toISOString());
    const entries = await Promise.all(
      state.trains.map(async (t) => {
        try {
          // Show today's run, unless it hasn't started and yesterday's is still on the move.
          const { status } = await api.trainStatus(t.trainNumber, today);
          if (status.state === 'NOT_STARTED') {
            const prev = await api.trainStatus(t.trainNumber, yesterday).catch(() => null);
            if (prev?.status.state === 'RUNNING') return [t.trainNumber, prev.status] as const;
          }
          return [t.trainNumber, status] as const;
        } catch (err) {
          return [t.trainNumber, err instanceof Error ? err.message : 'Unavailable'] as const;
        }
      }),
    );
    setStatuses(Object.fromEntries(entries));
    // Those reads changed the cache stats.
    setSim(await api.simulator());
  }, []);

  useEffect(() => {
    api
      .simulator()
      .then((s) => {
        setSim(s);
        return loadStatuses(s);
      })
      .catch((err: unknown) =>
        setError(
          err instanceof ApiError && err.status === 404
            ? 'The simulator is turned off (it only runs with the mock data source, outside production).'
            : err instanceof Error
              ? err.message
              : 'Could not reach the simulator.',
        ),
      );
  }, [loadStatuses]);

  const act = async (change: () => Promise<SimulatorState>) => {
    setBusy(true);
    setError('');
    try {
      const next = await change();
      setSim(next);
      notifySimulatorChanged();
      await loadStatuses(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };
  const clock = (a: ClockAction) => act(() => api.moveClock(a));

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Brand />
          <Link to="/dashboard" className="btn-secondary">
            Back to dashboard
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-8 pb-32">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-2xl font-bold tracking-tight">Simulator</h1>
          <span className="rounded-full bg-saffron/20 px-2.5 py-0.5 text-xs font-semibold text-badge-delay-ink">
            Development only
          </span>
        </div>
        <p className="mt-1 max-w-prose text-muted">
          Drive the simulated train-data source. Changes apply instantly to the dashboard and
          everything else reading live status. Timetables are illustrative, not real.
        </p>

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">
            {error}
          </p>
        )}

        {sim && (
          <div className="mt-6 grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
            <aside className="space-y-4">
              <section
                aria-labelledby="clock-h"
                className="rounded-2xl border border-line bg-card p-5"
              >
                <h2 id="clock-h" className="text-sm font-semibold text-muted">
                  Simulated time (IST)
                </h2>
                <p className="mt-1 text-2xl font-semibold tabular-nums" aria-live="polite">
                  {formatIstDateTime(sim.now)}
                </p>
                <p className="text-sm text-muted">{formatOffset(sim.offsetMinutes)}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {STEPS.map((s) => (
                    <button
                      key={s.label}
                      type="button"
                      disabled={busy}
                      onClick={() => void clock({ action: 'advance', minutes: s.minutes })}
                      className="btn-primary px-3 py-2"
                    >
                      {s.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void clock({ action: 'reset' })}
                    className="btn-secondary px-3 py-2"
                  >
                    Reset to now
                  </button>
                </div>
              </section>

              <section
                aria-labelledby="health-h"
                className="rounded-2xl border border-line bg-card p-5"
              >
                <h2 id="health-h" className="text-sm font-semibold text-muted">
                  Data source
                </h2>
                <div role="radiogroup" aria-labelledby="health-h" className="mt-3 grid gap-2">
                  {HEALTH.map((h) => (
                    <label
                      key={h.id}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                        sim.health === h.id ? 'border-teal bg-teal-soft/60' : 'border-line'
                      }`}
                    >
                      <input
                        type="radio"
                        name="health"
                        checked={sim.health === h.id}
                        disabled={busy}
                        onChange={() => void act(() => api.setSourceHealth(h.id))}
                        className="accent-teal"
                      />
                      {h.label}
                    </label>
                  ))}
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted">Upstream calls</dt>
                  <dd className="text-right tabular-nums">{sim.stats.upstreamCalls}</dd>
                  <dt className="text-muted">Cache hits</dt>
                  <dd className="text-right tabular-nums">{sim.stats.cacheHits}</dd>
                  <dt className="text-muted">Shared in-flight</dt>
                  <dd className="text-right tabular-nums">{sim.stats.coalesced}</dd>
                  <dt className="text-muted">Served stale</dt>
                  <dd className="text-right tabular-nums">{sim.stats.staleServed}</dd>
                  <dt className="text-muted">Failures</dt>
                  <dd className="text-right tabular-nums">{sim.stats.failures}</dd>
                  <dt className="text-muted">Circuit breaker</dt>
                  <dd
                    className={`text-right font-semibold ${sim.stats.breaker === 'CLOSED' ? 'text-ok' : 'text-bad'}`}
                  >
                    {sim.stats.breaker}
                  </dd>
                </dl>
              </section>
            </aside>

            <section aria-labelledby="trains-h">
              <h2 id="trains-h" className="sr-only">
                Simulated trains
              </h2>
              <ul className="grid gap-4 xl:grid-cols-2">
                {sim.trains.map((t) => {
                  const st = statuses[t.trainNumber];
                  return (
                    <li
                      key={t.trainNumber}
                      className="rounded-2xl border border-line bg-card p-5 shadow-sm"
                    >
                      <article aria-label={`Train ${t.trainNumber} ${t.trainName}`}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-mono text-sm font-semibold text-teal">
                              {t.trainNumber}
                            </p>
                            <h3 className="font-semibold">{t.trainName}</h3>
                            <p className="text-sm text-muted">
                              {t.from} → {t.to}
                            </p>
                          </div>
                          <label className="text-sm">
                            <span className="field-label">Scenario</span>
                            <select
                              value={t.scenario}
                              disabled={busy}
                              onChange={(e) =>
                                void act(() => api.setScenario(t.trainNumber, e.target.value))
                              }
                              className="field-input py-2"
                            >
                              {sim.scenarios.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <p className="mt-2 text-xs text-muted">
                          {sim.scenarios.find((s) => s.id === t.scenario)?.description}
                        </p>

                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void clock({
                              action: 'beforeDeparture',
                              trainNumber: t.trainNumber,
                              startDate: istDate(),
                              minutes: 60,
                            })
                          }
                          className="btn-secondary mt-3 px-3 py-1.5 text-xs"
                        >
                          Jump to 1 h before today's departure
                        </button>

                        {typeof st === 'string' && <p className="mt-3 text-sm text-bad">{st}</p>}
                        {st && typeof st !== 'string' && (
                          <>
                            <p className="mt-3 text-sm">
                              <span className="font-semibold">
                                {st.cancelled
                                  ? 'Cancelled'
                                  : st.state === 'NOT_STARTED'
                                    ? 'Not started'
                                    : st.state === 'ARRIVED'
                                      ? 'Arrived'
                                      : 'Running'}
                              </span>
                              {!st.cancelled && ` · ${formatDelay(st.delayMinutes)}`}
                              <span className="text-muted"> · run starting {st.startDate}</span>
                            </p>
                            {st.note && <p className="text-sm text-bad">{st.note}</p>}
                            <StatusTimeline status={st} />
                          </>
                        )}
                      </article>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
