import type { Db } from '../db/index.js';
import { createAccountStore } from './accounts.js';
import { createUserData } from './userData.js';

export function createDataAccess(db: Db) {
  return {
    accounts: createAccountStore(db),
    /** All user-owned data access goes through here, bound to the authenticated user. */
    forUser: (userId: string) => createUserData(db, userId),
  };
}

export type DataAccess = ReturnType<typeof createDataAccess>;
export type { User } from './accounts.js';
export { EmailTakenError } from './accounts.js';
export type * from './userData.js';
