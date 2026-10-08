import type { Journey, User } from '../lib/api';

export const user: User = {
  id: 'u1',
  name: 'Asha Rao',
  email: 'asha@example.com',
  createdAt: '2026-10-01T00:00:00.000Z',
};

export const journey = (overrides: Partial<Journey> = {}): Journey => ({
  id: 'j1',
  trainNumber: '12951',
  fromStationCode: 'MMCT',
  fromStationName: 'Mumbai Central',
  toStationCode: 'NDLS',
  toStationName: 'New Delhi',
  journeyDate: '2026-10-09',
  status: 'ACTIVE',
  alertTypes: ['DEPARTURE', 'DELAY'],
  createdAt: '2026-10-08T10:00:00.000Z',
  ...overrides,
});

/** 2026-10-09 10:00 IST */
export const fixedNow = () => new Date('2026-10-09T04:30:00Z');
