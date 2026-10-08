import { describe, expect, it } from 'vitest';
import { verifyPassword } from '../src/auth/passwords.js';
import { createDataAccess } from '../src/data/index.js';
import { openDatabase } from '../src/db/index.js';
import { DEMO_ACCOUNT, seedDemo } from '../src/db/seed.js';

describe('seedDemo', () => {
  it('creates a demo account with sample journeys, today first', async () => {
    const data = createDataAccess(openDatabase(':memory:'));
    const now = new Date('2026-10-09T04:30:00Z');
    expect(await seedDemo(data, now)).toBe(3);

    const account = data.accounts.findUserForLogin(DEMO_ACCOUNT.email)!;
    expect(await verifyPassword(account.passwordHash, DEMO_ACCOUNT.password)).toBe(true);
    const journeys = data.forUser(account.id).journeys.list();
    expect(journeys.map((j) => j.journeyDate)).toEqual(['2026-10-09', '2026-10-10', '2026-10-14']);
  });

  it('is repeatable: resets journeys and password without duplicating the user', async () => {
    const db = openDatabase(':memory:');
    const data = createDataAccess(db);
    await seedDemo(data);
    const id = data.accounts.findUserForLogin(DEMO_ACCOUNT.email)!.id;
    data.forUser(id).journeys.create({
      trainNumber: '11111',
      fromStationCode: 'A',
      fromStationName: undefined,
      toStationCode: 'B',
      toStationName: undefined,
      journeyDate: '2026-10-09',
      alertTypes: ['DELAY'],
    });

    await seedDemo(data);
    expect(db.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 1 });
    expect(data.forUser(id).journeys.list()).toHaveLength(3);
  });
});
