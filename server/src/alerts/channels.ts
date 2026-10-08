import type { FastifyBaseLogger } from 'fastify';
import type { EngineStore } from '../data/engineStore.js';

export interface OutgoingNotification {
  journeyId: string;
  eventKey: string;
  title: string;
  body: string;
  /** Exactly one of these: the journey owner (in-app + optional email), or a recipient. */
  to:
    | { kind: 'owner'; userId: string; name: string; email: string }
    | { kind: 'recipient'; name: string; email: string };
}

/**
 * Where alerts go. The engine doesn't know or care how a channel delivers, so
 * WhatsApp, SMS or Telegram can be added later as new channels.
 */
export interface NotificationChannel {
  readonly name: 'IN_APP' | 'EMAIL';
  deliver(n: OutgoingNotification): Promise<void>;
}

/** The in-app feed behind the bell icon. Owners only. */
export class InAppChannel implements NotificationChannel {
  readonly name = 'IN_APP' as const;
  constructor(private readonly store: EngineStore) {}

  async deliver(n: OutgoingNotification): Promise<void> {
    if (n.to.kind !== 'owner') return;
    this.store.addInAppNotification({
      userId: n.to.userId,
      journeyId: n.journeyId,
      eventKey: n.eventKey,
      title: n.title,
      body: n.body,
    });
  }
}

/**
 * Email. Only a dry-run mode exists so far: it logs what would be sent. A real
 * provider (SMTP or an API) slots in behind the same interface.
 */
export class DryRunEmailChannel implements NotificationChannel {
  readonly name = 'EMAIL' as const;
  readonly sent: OutgoingNotification[] = [];
  constructor(private readonly log: FastifyBaseLogger) {}

  async deliver(n: OutgoingNotification): Promise<void> {
    this.sent.push(n);
    this.log.info(
      { to: n.to.email, subject: n.title, body: n.body },
      '[email dry-run] would send alert email',
    );
  }
}
