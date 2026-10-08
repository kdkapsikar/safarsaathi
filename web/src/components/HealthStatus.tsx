import { useCallback, useEffect, useState } from 'react';
import { fetchHealth, type HealthResponse } from '../api';

type State =
  { kind: 'checking' } | { kind: 'up'; health: HealthResponse } | { kind: 'down'; message: string };

export function HealthStatus() {
  const [state, setState] = useState<State>({ kind: 'checking' });

  const load = useCallback((signal?: AbortSignal) => {
    fetchHealth(signal)
      .then((health) => setState({ kind: 'up', health }))
      .catch((err: unknown) => {
        if (signal?.aborted) return;
        setState({ kind: 'down', message: err instanceof Error ? err.message : 'Unknown error' });
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const retry = () => {
    setState({ kind: 'checking' });
    load();
  };

  return (
    <section
      aria-labelledby="health-heading"
      className="rounded-2xl border border-line bg-card p-5 shadow-sm"
    >
      <h2 id="health-heading" className="text-sm font-semibold uppercase tracking-wide text-muted">
        System check
      </h2>
      <div role="status" aria-live="polite" className="mt-3 flex items-center gap-3">
        <span
          aria-hidden="true"
          className={`inline-block size-3 rounded-full ${
            state.kind === 'up'
              ? 'bg-ok'
              : state.kind === 'down'
                ? 'bg-bad'
                : 'bg-saffron animate-pulse'
          }`}
        />
        {state.kind === 'checking' && <p>Checking the API…</p>}
        {state.kind === 'up' && (
          <p>
            API is up ·{' '}
            <span className="text-muted">checked at {formatTime(state.health.time)}</span>
          </p>
        )}
        {state.kind === 'down' && <p>API unreachable: {state.message}</p>}
      </div>
      {state.kind === 'down' && (
        <button
          type="button"
          onClick={retry}
          className="mt-4 rounded-lg bg-teal px-4 py-2 text-sm font-medium text-white hover:bg-teal/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-saffron"
        >
          Try again
        </button>
      )}
    </section>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
