import { HealthStatus } from './components/HealthStatus';

const features = [
  {
    title: 'Alerts for everyone waiting',
    body: 'Send delay and platform updates to family or the driver picking you up, not just the passenger.',
  },
  {
    title: 'Smart rules',
    body: 'Only hear about delays that matter, and stay quiet overnight.',
  },
  {
    title: '“Leave home now”',
    body: 'A nudge timed from the live delay and your travel time to the station.',
  },
  {
    title: 'Ask the assistant',
    body: 'Questions about your train are answered from live data, with the time it was checked.',
  },
];

export function App() {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-4">
          <img src="/favicon.svg" alt="" className="size-8" />
          <span className="text-lg font-semibold tracking-tight">Safar Saathi</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-12 sm:py-16">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr] md:items-start">
          <div>
            <p className="text-sm font-semibold text-teal">
              Your travel companion on Indian Railways
            </p>
            <h1 className="mt-3 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
              Know before the station board does.
            </h1>
            <p className="mt-4 max-w-prose text-lg text-muted">
              Safar Saathi watches your train and tells you, and the people waiting for you, about
              delays, platform changes and cancellations as they happen.
            </p>
          </div>
          <HealthStatus />
        </div>

        <ul className="mt-14 grid gap-4 sm:grid-cols-2">
          {features.map((f) => (
            <li key={f.title} className="rounded-2xl bg-teal-soft/60 p-5">
              <h3 className="font-semibold">{f.title}</h3>
              <p className="mt-1 text-muted">{f.body}</p>
            </li>
          ))}
        </ul>
      </main>

      <footer className="mx-auto max-w-5xl px-4 pb-10 text-sm text-muted">
        Early preview. Sign-up and journeys arrive in the next phases.
      </footer>
    </div>
  );
}
