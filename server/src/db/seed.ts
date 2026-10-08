import { hashPassword } from '../auth/passwords.js';
import type { DataAccess } from '../data/index.js';
import { DEMO_ACCOUNT, demoJourneys } from './demoAccount.js';

export { DEMO_ACCOUNT };

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
  const journeys = demoJourneys(now);
  for (const j of journeys) mine.journeys.create(j);
  return journeys.length;
}
