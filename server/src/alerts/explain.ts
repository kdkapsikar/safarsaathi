import { DEFAULT_DELAY_THRESHOLD } from './events.js';

export interface ExplainSettings {
  minDelayMinutes: number | null;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  travelTimeMinutes: number | null;
  leaveBufferMinutes: number;
  connectionBufferMinutes: number;
}

/** Why an alert with this event key was sent, in plain words (for Saathi). */
export function explainEventKey(key: string, s: ExplainSettings): string {
  const [kind, a, b] = key.split(':');
  const threshold = s.minDelayMinutes ?? DEFAULT_DELAY_THRESHOLD;
  const quiet =
    s.quietHoursStart && s.quietHoursEnd
      ? ` Non-urgent alerts wait out your quiet hours (${s.quietHoursStart}–${s.quietHoursEnd} IST).`
      : '';
  switch (kind) {
    case 'DELAY':
      return `The train's delay reached ${a} minutes. You get delay alerts once it's ${threshold} minutes late, then again at 30, 60, 90 minutes and so on, each sent once.${quiet}`;
    case 'PLATFORM':
      return `The platform at ${a} was announced or changed to ${b}. You asked for platform alerts at your boarding station until the train leaves it.${quiet}`;
    case 'DEPARTED':
      return `The train left your boarding station ${a}. You asked for departure alerts.${quiet}`;
    case 'ARRIVING_SOON':
      return `The train was about 30 minutes from ${a}, your destination. You asked for arrival alerts.${quiet}`;
    case 'CANCELLED':
      return 'The train was cancelled. Cancellation alerts are always sent, even in quiet hours.';
    case 'DIVERTED':
      return 'The train was diverted onto another route. Diversion alerts are always sent, even in quiet hours.';
    case 'LEAVE_NOW':
      return `It was time to leave for ${a}: the train's expected departure (including any delay) minus your ${
        s.travelTimeMinutes ?? '?'
      }-minute journey to the station and a ${s.leaveBufferMinutes}-minute buffer. This is recalculated whenever the delay changes, and is sent even in quiet hours.`;
    case 'CONNECTION':
      return b === 'MISSED'
        ? 'The first train was running so late that it would reach the change station after your connecting train leaves.'
        : `The first train's delay left less than the ${s.connectionBufferMinutes} minutes you wanted for changing trains. Connection alerts are always sent.`;
    default:
      return 'This alert was sent because the train status changed.';
  }
}
