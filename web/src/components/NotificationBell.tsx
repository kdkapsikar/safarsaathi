import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { api, SIMULATOR_CHANGED, type AppNotification } from '../lib/api';
import { formatIstDateTime } from '../lib/dates';

const POLL_MS = 30_000;

/** Bell icon with an unread count, opening the in-app alert feed. */
export function NotificationBell() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const refresh = useCallback((signal?: AbortSignal) => {
    api
      .notifications(signal)
      .then((r) => {
        setItems(r.notifications);
        setUnread(r.unreadCount);
      })
      .catch(() => {
        /* keep the last list; the bell isn't worth an error banner */
      });
  }, []);

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

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const markRead = async (n: AppNotification) => {
    if (n.readAt) return;
    setItems((xs) =>
      xs.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)),
    );
    setUnread((u) => Math.max(0, u - 1));
    await api.markNotificationRead(n.id).catch(() => refresh());
  };

  const markAll = async () => {
    setItems((xs) => xs.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })));
    setUnread(0);
    await api.markAllNotificationsRead().catch(() => refresh());
  };

  return (
    <div
      ref={rootRef}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          setOpen(false);
          buttonRef.current?.focus();
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        onClick={() => setOpen((o) => !o)}
        className="relative grid size-10 place-items-center rounded-xl border border-line bg-card hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-saffron"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5">
          <path
            d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Zm4 3a2 2 0 0 0 4 0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
        </svg>
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-1.5 -right-1.5 grid min-w-5 place-items-center rounded-full bg-bad px-1 text-[11px] font-bold text-white"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <section
          id={panelId}
          aria-label="Notifications"
          className="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-line bg-card shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="font-semibold">Alerts</h2>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => void markAll()}
                className="text-sm font-medium text-teal hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">
              No alerts yet. We'll tell you here when your train is late, changes platform or
              leaves.
            </p>
          ) : (
            <ul className="max-h-96 divide-y divide-line overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => void markRead(n)}
                    className={`flex w-full gap-3 px-4 py-3 text-left hover:bg-paper ${n.readAt ? '' : 'bg-teal-soft/40'}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt ? 'bg-transparent' : 'bg-teal'}`}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">
                        {n.title}
                        {!n.readAt && <span className="sr-only"> (unread)</span>}
                      </span>
                      <span className="block text-sm text-muted">{n.body}</span>
                      <span className="mt-0.5 block text-xs text-muted">
                        {formatIstDateTime(n.createdAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
