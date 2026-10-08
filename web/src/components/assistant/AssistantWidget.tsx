import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import {
  api,
  ApiError,
  notifyJourneysChanged,
  streamChat,
  type ChatEvent,
  type ProposalView,
} from '../../lib/api';
import { MiniSignal, SaathiFace, SaathiScene } from './SaathiScene';

const SAMPLE_QUESTIONS = [
  'Is 12951 running late?',
  'Which platform for 12301 at HWH?',
  'Show the timetable of 12002',
];

const TOOL_LABEL: Record<string, string> = {
  get_live_status: 'Checking live status…',
  get_journey_status: 'Checking your train…',
  get_platform_info: 'Looking up the platform…',
  get_schedule: 'Fetching the timetable…',
  trains_between: 'Searching trains…',
  list_my_journeys: 'Looking at your journeys…',
  create_journey: 'Preparing your journey…',
  delete_journey: 'Preparing that change…',
  site_help: 'Checking the help pages…',
};

type ProposalState = 'pending' | 'working' | 'confirmed' | 'cancelled' | 'failed';

interface Message {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  proposals: (ProposalView & { state: ProposalState; error?: string })[];
  error?: boolean;
}

let nextId = 1;

/** Saathi, the website assistant: a launcher on every page and a streaming chat panel. */
export function AssistantWidget() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [open, setOpen] = useState(false);
  // The launcher nudges for attention until Saathi has been opened once.
  const [seen, setSeen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState('');
  const [mode, setMode] = useState<'claude' | 'offline' | null>(null);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  // The conversation belongs to whoever is signed in; start fresh when that changes.
  // (undefined = still checking the session, so not a change yet.)
  const [owner, setOwner] = useState(user === undefined ? undefined : userId);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  if (user !== undefined && owner !== userId) {
    setOwner(userId);
    if (owner !== undefined) {
      setMessages([]);
      setSessionId(undefined);
    }
  }
  const abortRef = useRef<AbortController | null>(null);
  const panelId = useId();
  const titleId = useId();
  const launcherRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // On open: which engine is answering.
  useEffect(() => {
    if (!open || mode) return;
    api.chatInfo().then(
      (i) => setMode(i.mode),
      () => setMode('offline'),
    );
  }, [open, mode]);

  // On open, once per signed-in user: restore their last conversation.
  useEffect(() => {
    if (!open || !userId || historyFor === userId) return;
    let cancelled = false;
    api.chatHistory().then(
      (h) => {
        if (cancelled) return;
        setHistoryFor(userId);
        if (!h.sessionId) return;
        setSessionId(h.sessionId);
        setMessages(
          h.messages.map((m) => ({
            id: nextId++,
            role: m.role,
            text: m.text,
            // Old cards can't be acted on again from history.
            proposals: (m.proposals ?? []).map((p) => ({ ...p, state: 'cancelled' as const })),
          })),
        );
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [open, userId, historyFor]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, activity]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const close = () => {
    setOpen(false);
    launcherRef.current?.focus();
  };

  const patchLast = useCallback((fn: (m: Message) => Message) => {
    setMessages((ms) => (ms.length ? [...ms.slice(0, -1), fn(ms[ms.length - 1]!)] : ms));
  }, []);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    const history = messages
      .filter((m) => !m.error && m.text)
      .map((m) => ({ role: m.role, text: m.text }));
    setDraft('');
    setBusy(true);
    setMessages((ms) => [
      ...ms,
      { id: nextId++, role: 'user', text: message, proposals: [] },
      { id: nextId++, role: 'assistant', text: '', proposals: [] },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;
    const onEvent = (e: ChatEvent) => {
      switch (e.type) {
        case 'text':
          setActivity('');
          patchLast((m) => ({ ...m, text: m.text + e.delta }));
          break;
        case 'tool':
          setActivity(e.status === 'start' ? (TOOL_LABEL[e.name] ?? 'Working…') : '');
          break;
        case 'proposal':
          patchLast((m) => ({
            ...m,
            proposals: [...m.proposals, { ...e.proposal, state: 'pending' }],
          }));
          break;
        case 'notice':
          patchLast((m) => ({ ...m, text: `${e.message}\n\n${m.text}` }));
          break;
        case 'done':
          setSessionId(e.sessionId ?? undefined);
          setMode(e.mode);
          break;
        case 'error':
          patchLast((m) => ({ ...m, text: m.text || e.message, error: !m.text }));
          break;
      }
    };

    try {
      await streamChat(
        { message, sessionId, history: userId ? undefined : history.slice(-16) },
        onEvent,
        controller.signal,
      );
    } catch (err) {
      if (!controller.signal.aborted) {
        const text = err instanceof ApiError ? err.message : "Sorry, I couldn't answer just now.";
        patchLast((m) => ({ ...m, text, error: true }));
      }
    } finally {
      setBusy(false);
      setActivity('');
      inputRef.current?.focus();
    }
  };

  const decide = async (messageId: number, proposal: ProposalView, confirm: boolean) => {
    const set = (state: ProposalState, error?: string) =>
      setMessages((ms) =>
        ms.map((m) =>
          m.id !== messageId
            ? m
            : {
                ...m,
                proposals: m.proposals.map((p) =>
                  p.id === proposal.id ? { ...p, state, error } : p,
                ),
              },
        ),
      );
    set('working');
    try {
      if (confirm) {
        await api.confirmProposal(proposal.id);
        set('confirmed');
        notifyJourneysChanged();
      } else {
        await api.cancelProposal(proposal.id);
        set('cancelled');
      }
    } catch (err) {
      set('failed', err instanceof Error ? err.message : 'That did not work.');
    }
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
          className="flex h-[min(40rem,calc(100dvh-7rem))] w-[min(23rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-line bg-card shadow-2xl"
        >
          <header className="shrink-0">
            {messages.length === 0 && <SaathiScene className="block h-auto w-full" />}
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
              <div className="flex items-center gap-2.5">
                {messages.length > 0 && <SaathiFace className="size-9" />}
                <div>
                  <h2 id={titleId} className="font-semibold">
                    Saathi
                  </h2>
                  <p className="text-xs text-muted">
                    Your railway assistant
                    {mode === 'offline' && ' · basic mode'}
                  </p>
                </div>
              </div>
              <button
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

          <div
            ref={logRef}
            role="log"
            aria-live="polite"
            aria-busy={busy}
            className="flex-1 space-y-3 overflow-y-auto p-4"
          >
            {messages.length === 0 && (
              <>
                <p className="max-w-[85%] rounded-2xl rounded-tl-md bg-teal-soft px-3.5 py-2.5 text-sm">
                  Namaste{firstName ? `, ${firstName}` : ''}! I'm Saathi. Ask me how a train is
                  running, which platform it's on, or its timetable. I answer from live data and
                  tell you how fresh it is.
                </p>
                <ul aria-label="Example questions" className="flex flex-wrap gap-2 pt-1">
                  {SAMPLE_QUESTIONS.map((q) => (
                    <li key={q}>
                      <button
                        type="button"
                        onClick={() => void send(q)}
                        className="rounded-full border border-line bg-paper px-3 py-1.5 text-xs hover:border-teal hover:bg-teal-soft/60"
                      >
                        {q}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {messages.map((m) =>
              m.role === 'user' ? (
                <p
                  key={m.id}
                  className="ml-auto max-w-[85%] rounded-2xl rounded-tr-md bg-teal px-3.5 py-2.5 text-sm text-white"
                >
                  <span className="sr-only">You: </span>
                  {m.text}
                </p>
              ) : (
                <div key={m.id} className="max-w-[90%] space-y-2">
                  {(m.text || !busy) && (
                    <p
                      className={`whitespace-pre-line rounded-2xl rounded-tl-md px-3.5 py-2.5 text-sm ${
                        m.error ? 'bg-bad/10 text-bad' : 'bg-teal-soft'
                      }`}
                    >
                      <span className="sr-only">Saathi: </span>
                      {m.text}
                    </p>
                  )}
                  {m.proposals.map((p) => (
                    <div
                      key={p.id}
                      className="rounded-2xl border border-saffron/60 bg-saffron/10 p-3 text-sm"
                    >
                      <p className="font-medium">{p.summary}</p>
                      {p.state === 'pending' || p.state === 'working' ? (
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            disabled={p.state === 'working'}
                            onClick={() => void decide(m.id, p, true)}
                            className="btn-primary px-3 py-1.5 text-xs"
                          >
                            {p.kind === 'DELETE_JOURNEY' ? 'Confirm delete' : 'Confirm'}
                          </button>
                          <button
                            type="button"
                            disabled={p.state === 'working'}
                            onClick={() => void decide(m.id, p, false)}
                            className="btn-secondary px-3 py-1.5 text-xs"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <p
                          role="status"
                          className={`mt-1 text-xs ${p.state === 'failed' ? 'text-bad' : 'text-muted'}`}
                        >
                          {p.state === 'confirmed'
                            ? p.kind === 'DELETE_JOURNEY'
                              ? 'Done: journey deleted.'
                              : 'Done: journey added to your dashboard.'
                            : p.state === 'failed'
                              ? p.error
                              : 'Not done.'}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ),
            )}

            {busy && (
              <p className="flex items-center gap-2 text-xs text-muted" role="status">
                <span aria-hidden="true" className="inline-flex gap-1">
                  <span className="size-1.5 animate-bounce rounded-full bg-teal [animation-delay:-0.2s]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-teal [animation-delay:-0.1s]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-teal" />
                </span>
                {activity || 'Saathi is typing…'}
              </p>
            )}
          </div>

          <form
            className="flex shrink-0 gap-2 border-t border-line p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
          >
            <label htmlFor={`${panelId}-input`} className="sr-only">
              Message Saathi
            </label>
            <input
              ref={inputRef}
              id={`${panelId}-input`}
              value={draft}
              maxLength={2000}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask about a train…"
              autoComplete="off"
              className="field-input py-2 text-sm"
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className="btn-primary px-3"
              aria-label="Send"
            >
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
