import { hashPassword } from '../auth/passwords.js';
import type { DataAccess } from '../data/index.js';
import { istDate } from '../schemas/dates.js';
import type { AlertType } from '../schemas/journey.js';

/**
 * Local demo account for previews. Development only: `npm run seed` refuses
 * to run with NODE_ENV=production. Change these freely; they protect nothing.
 */
export const DEMO_ACCOUNT = {
  name: 'Demo Traveller',
  email: 'demo@safarsaathi.test',
  password: 'chai-and-chaat-2026',
} as const;

const sampleJourneys = (now: Date) => [
  {
    trainNumber: '12951',
    fromStationCode: 'MMCT',
    fromStationName: 'Mumbai Central',
    toStationCode: 'NDLS',
    toStationName: 'New Delhi',
    journeyDate: istDate(now),
    alertTypes: ['DEPARTURE', 'DELAY', 'PLATFORM_CHANGE'] as AlertType[],
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
    trainNumber: '12627',
    fromStationCode: 'SBC',
    fromStationName: 'KSR Bengaluru City',
    toStationCode: 'NDLS',
    toStationName: 'New Delhi',
    journeyDate: istDate(now, 5),
    alertTypes: ['PLATFORM_CHANGE'] as AlertType[],
  },
];

/**
 * Creates the demo account, or resets it (password and journeys) if it exists.
 * Returns the number of sample journeys created.
 */
export async function seedDemo(data: DataAccess, now = new Date()): Promise<number> {
  const passwordHash = await hashPassword(DEMO_ACCOUNT.password);
  const existing = data.accounts.findUserForLogin(DEMO_ACCOUNT.email);
  const userId = existing
    ? (data.accounts.setPassword(existing.id, passwordHash), existing.id)
    : data.accounts.createUser({ name: DEMO_ACCOUNT.name, email: DEMO_ACCOUNT.email, passwordHash })
        .id;

  const mine = data.forUser(userId);
  for (const j of mine.journeys.list()) mine.journeys.delete(j.id);
  // Oldest first, so the list shows today's journey on top.
  const journeys = sampleJourneys(now).reverse();
  for (const j of journeys) mine.journeys.create(j);
  return journeys.length;
}
