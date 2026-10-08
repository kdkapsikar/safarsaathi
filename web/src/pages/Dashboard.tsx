import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { CreateJourneyInput } from '@safar-saathi/server/schemas';
import { useAuth } from '../auth/AuthContext';
import { Brand } from '../components/Brand';
import { JourneyForm } from '../components/JourneyForm';
import { JourneyList } from '../components/JourneyList';
import { NotificationBell } from '../components/NotificationBell';
import { api, type Journey } from '../lib/api';

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready' };

export function Dashboard() {
  const { user, signOut } = useAuth();
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [simulatorOn, setSimulatorOn] = useState(false);

  useEffect(() => {
    api
      .simulator()
      .then(() => setSimulatorOn(true))
      .catch(() => setSimulatorOn(false));
  }, []);

  const fetchJourneys = useCallback(() => {
    api
      .listJourneys()
      .then(({ journeys }) => {
        setJourneys(journeys);
        setLoad({ state: 'ready' });
      })
      .catch((err: unknown) =>
        setLoad({
          state: 'error',
          message: err instanceof Error ? err.message : 'Could not load journeys.',
        }),
      );
  }, []);

  useEffect(fetchJourneys, [fetchJourneys]);

  const create = async (input: CreateJourneyInput) => {
    const { journey } = await api.createJourney(input);
    setJourneys((js) => [journey, ...js]);
  };

  const remove = async (id: string) => {
    await api.deleteJourney(id);
    setJourneys((js) => js.filter((j) => j.id !== id));
  };

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Brand />
          <div className="flex items-center gap-3">
            {simulatorOn && (
              <Link to="/simulator" className="btn-secondary border-saffron/60 bg-saffron/10">
                Simulator
              </Link>
            )}
            <NotificationBell />
            <span className="hidden text-sm text-muted sm:inline">
              Signed in as <span className="font-medium text-ink">{user?.name}</span>
            </span>
            <button type="button" onClick={() => void signOut()} className="btn-secondary">
              Sign out
            </button>
          </div>
        </nav>
      </header>

      <main className="mx-auto grid max-w-6xl gap-8 px-4 pt-6 pb-32 md:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] md:pt-10">
        <h1 className="sr-only">Your dashboard</h1>

        <section className="h-fit rounded-2xl border border-line bg-card p-5 shadow-sm md:sticky md:top-24 sm:p-6">
          <JourneyForm onCreate={create} />
        </section>

        <section aria-labelledby="journeys-heading">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 id="journeys-heading" className="text-xl font-semibold tracking-tight">
              Your journeys
            </h2>
            {load.state === 'ready' && journeys.length > 0 && (
              <span className="text-sm text-muted">
                {journeys.length} {journeys.length === 1 ? 'journey' : 'journeys'}
              </span>
            )}
          </div>

          {load.state === 'loading' && (
            <div aria-busy="true" aria-label="Loading journeys" className="space-y-3">
              {[0, 1].map((i) => (
                <div key={i} className="h-36 animate-pulse rounded-2xl bg-line/60" />
              ))}
            </div>
          )}
          {load.state === 'error' && (
            <div role="alert" className="rounded-2xl border border-bad/30 bg-bad/5 p-5">
              <p className="text-bad">{load.message}</p>
              <button
                type="button"
                onClick={() => {
                  setLoad({ state: 'loading' });
                  fetchJourneys();
                }}
                className="btn-secondary mt-3"
              >
                Try again
              </button>
            </div>
          )}
          {load.state === 'ready' && <JourneyList journeys={journeys} onDelete={remove} />}
        </section>
      </main>
    </div>
  );
}
