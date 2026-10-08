import { useEffect, useId, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { MiniSignal, SaathiFace, SaathiScene } from './SaathiScene';

const SAMPLE_QUESTIONS = [
  'Is 12951 running late today?',
  'Which platform for my train at NDLS?',
  'When should I leave for the station?',
];

/**
 * Saathi, the website assistant: a launcher on every page and a chat panel.
 * Phase-6 shell: the conversation isn't wired up yet, so the input is disabled
 * and the panel says so plainly rather than pretending to answer.
 */
export function AssistantWidget() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  // The launcher nudges for attention until Saathi has been opened once.
  const [seen, setSeen] = useState(false);
  const panelId = useId();
  const titleId = useId();
  const launcherRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    launcherRef.current?.focus();
  };

  const firstName = user?.name.split(' ')[0];

  return (
    <div className="fixed right-4 bottom-4 z-40 flex flex-col items-end gap-3 sm:right-6 sm:bottom-6">
      {open && (
        <section
          id={panelId}
          role="dialog"
          aria-labelledby={titleId}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              close();
            }
          }}
          className="flex max-h-[min(36rem,calc(100dvh-6rem))] w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-line bg-card shadow-2xl"
        >
          <header className="relative">
            <SaathiScene className="block h-auto w-full" />
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
              <div>
                <h2 id={titleId} className="font-semibold">
                  Saathi
                </h2>
                <p className="text-xs text-muted">Your railway assistant</p>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={close}
                aria-label="Close Saathi"
                className="rounded-lg p-2 text-muted hover:bg-paper hover:text-ink focus-visible:outline-2 focus-visible:outline-saffron"
              >
                <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5">
                  <path
                    d="M5 5l10 10M15 5L5 15"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
            <p className="max-w-[85%] rounded-2xl rounded-tl-md bg-teal-soft px-3.5 py-2.5 text-sm">
              Namaste{firstName ? `, ${firstName}` : ''}! I'm Saathi. Soon I'll answer questions
              about your train from live running data: delays, platforms, and when to leave home.
            </p>
            <p className="max-w-[85%] rounded-2xl rounded-tl-md bg-teal-soft px-3.5 py-2.5 text-sm">
              I'm still being connected to the live data, so I can't answer yet. Here's the kind of
              thing you'll be able to ask:
            </p>
            <ul aria-label="Example questions" className="flex flex-wrap gap-2 pt-1">
              {SAMPLE_QUESTIONS.map((q) => (
                <li
                  key={q}
                  className="rounded-full border border-line bg-paper px-3 py-1.5 text-xs text-muted"
                >
                  {q}
                </li>
              ))}
            </ul>
          </div>

          <form
            className="flex gap-2 border-t border-line p-3"
            onSubmit={(e) => e.preventDefault()}
          >
            <label htmlFor={`${panelId}-input`} className="sr-only">
              Message Saathi
            </label>
            <input
              id={`${panelId}-input`}
              disabled
              placeholder="Live answers coming soon"
              className="field-input py-2 text-sm disabled:cursor-not-allowed disabled:bg-paper"
            />
            <button type="submit" disabled className="btn-primary px-3" aria-label="Send">
              <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5">
                <path
                  d="M3 10h12M11 5l5 5-5 5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </form>
        </section>
      )}

      <button
        ref={launcherRef}
        type="button"
        onClick={() => {
          if (open) {
            close();
          } else {
            setOpen(true);
            setSeen(true);
          }
        }}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={open ? 'Close Saathi assistant' : 'Open Saathi assistant'}
        className={`relative grid size-[4.75rem] place-items-center rounded-full bg-card shadow-lg ring-1 ring-line transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-saffron ${
          seen ? '' : 'saathi-launcher-nudge'
        }`}
      >
        {!seen && (
          <span aria-hidden="true" className="saathi-launcher-ring absolute inset-0 rounded-full" />
        )}
        <SaathiFace className="size-[3.75rem]" />
        {!open && <MiniSignal className="absolute -top-2 -right-1 h-9 w-auto drop-shadow" />}
      </button>
    </div>
  );
}
