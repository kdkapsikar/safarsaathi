import type { Db } from '../db/index.js';
import { createAccountStore } from './accounts.js';
import { createPublicLinks } from './publicLinks.js';
import { createUserData } from './userData.js';

export function createDataAccess(db: Db) {
  return {
    accounts: createAccountStore(db),
    /** All user-owned data access goes through here, bound to the authenticated user. */
    forUser: (userId: string) => createUserData(db, userId),
    /** Invite and opt-out links: unauthenticated, token-gated, minimal data. */
    publicLinks: createPublicLinks(db),
  };
}

export type DataAccess = ReturnType<typeof createDataAccess>;
export type { User } from './accounts.js';
export { EmailTakenError } from './accounts.js';
export { DuplicateRecipientError } from './userData.js';
export type * from './userData.js';
