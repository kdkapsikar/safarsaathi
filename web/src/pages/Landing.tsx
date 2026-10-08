import { Link } from 'react-router';
import { Brand } from '../components/Brand';
import { HealthStatus } from '../components/HealthStatus';

const features = [
  {
    title: 'Alerts for everyone waiting',
    body: 'Send delay and platform updates to family or the driver picking you up, not just the passenger.',
  },
  { title: 'Smart rules', body: 'Only hear about delays that matter, and stay quiet overnight.' },
  {
    title: '“Leave home now”',
    body: 'A nudge timed from the live delay and your travel time to the station.',
  },
  {
    title: 'Ask the assistant',
    body: 'Questions about your train are answered from live data, with the time it was checked.',
  },
];

export function Landing() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line">
        <nav className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Brand />
          <div className="flex items-center gap-2">
            <Link to="/signin" className="btn-secondary">
              Sign in
            </Link>
            <Link to="/signup" className="btn-primary hidden sm:inline-flex">
              Get started
            </Link>
          </div>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-12 sm:py-16">
        <p className="text-sm font-semibold text-teal">Your travel companion on Indian Railways</p>
        <h1 className="mt-3 max-w-2xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
          Know before the station board does.
        </h1>
        <p className="mt-4 max-w-prose text-lg text-muted">
          Safar Saathi watches your train and tells you, and the people waiting for you, about
          delays, platform changes and cancellations as they happen.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/signup" className="btn-primary px-6 py-3 text-base">
            Create a free account
          </Link>
          <Link to="/signin" className="btn-secondary px-6 py-3 text-base">
            I already have one
          </Link>
        </div>

        <ul className="mt-16 grid gap-4 sm:grid-cols-2">
          {features.map((f) => (
            <li key={f.title} className="rounded-2xl bg-teal-soft/60 p-5">
              <h2 className="font-semibold">{f.title}</h2>
              <p className="mt-1 text-muted">{f.body}</p>
            </li>
          ))}
        </ul>
      </main>

      <footer className="mx-auto flex w-full max-w-5xl flex-wrap justify-between gap-2 px-4 pb-28 text-sm text-muted">
        <span>Early preview. Live alerts arrive in upcoming releases.</span>
        <HealthStatus />
      </footer>
    </div>
  );
}
