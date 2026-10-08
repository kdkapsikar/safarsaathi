import { useEffect, useState } from 'react';
import { api } from '../lib/api';

/** Small API status indicator, mainly so a local preview shows whether the API is running. */
export function HealthStatus() {
  const [state, setState] = useState<'checking' | 'up' | 'down'>('checking');

  useEffect(() => {
    const controller = new AbortController();
    api
      .health(controller.signal)
      .then(() => setState('up'))
      .catch(() => !controller.signal.aborted && setState('down'));
    return () => controller.abort();
  }, []);

  const text = {
    checking: 'Checking service…',
    up: 'All systems running',
    down: 'Service unreachable',
  }[state];
  const dot = { checking: 'bg-saffron animate-pulse', up: 'bg-ok', down: 'bg-bad' }[state];

  return (
    <p role="status" className="inline-flex items-center gap-2">
      <span aria-hidden="true" className={`inline-block size-2 rounded-full ${dot}`} />
      {text}
    </p>
  );
}
