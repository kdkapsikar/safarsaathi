import type { AlertType } from '@safar-saathi/server/schemas';

export const ALERT_TYPE_INFO: Record<AlertType, { label: string; hint: string; badge: string }> = {
  DEPARTURE: {
    label: 'Departure',
    hint: 'When the train leaves your station',
    badge: 'bg-badge-departure text-badge-departure-ink',
  },
  ARRIVAL: {
    label: 'Arrival',
    hint: 'When it reaches your destination',
    badge: 'bg-badge-arrival text-badge-arrival-ink',
  },
  DELAY: {
    label: 'Delay',
    hint: 'When it starts running late',
    badge: 'bg-badge-delay text-badge-delay-ink',
  },
  PLATFORM_CHANGE: {
    label: 'Platform change',
    hint: 'When the platform is assigned or changes',
    badge: 'bg-badge-platform text-badge-platform-ink',
  },
};
