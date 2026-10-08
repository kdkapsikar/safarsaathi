import { istDate } from '../schemas/dates.js';
import type { AlertType } from '../schemas/journey.js';

/**
 * The demo account, used by `npm run seed` locally and by the GitHub Pages demo.
 * Sign in with this username/password. It protects nothing real.
 */
export const DEMO_ACCOUNT = {
  name: 'Demo Traveller',
  email: 'demo',
  password: 'chai@2026',
} as const;

/** Sample journeys, oldest first (so the list shows today's on top). */
export const demoJourneys = (now: Date) => [
  {
    trainNumber: '12627',
    fromStationCode: 'SBC',
    fromStationName: 'KSR Bengaluru City',
    toStationCode: 'NDLS',
    toStationName: 'New Delhi',
    journeyDate: istDate(now, 5),
    alertTypes: ['PLATFORM_CHANGE'] as AlertType[],
  },
  {
    trainNumber: '12301',
    fromStationCode: 'HWH',
    fromStationName: 'Howrah Junction',
    toStationCode: 'NDLS',
    toStationName: 'New Delhi',
    journeyDate: istDate(now, 1),
    alertTypes: ['DEPARTURE', 'ARRIVAL', 'DELAY'] as AlertType[],
  },
  {
    trainNumber: '12951',
    fromStationCode: 'MMCT',
    fromStationName: 'Mumbai Central',
    toStationCode: 'NDLS',
    toStationName: 'New Delhi',
    journeyDate: istDate(now),
    alertTypes: ['DEPARTURE', 'DELAY', 'PLATFORM_CHANGE'] as AlertType[],
  },
];
