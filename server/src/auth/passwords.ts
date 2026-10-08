import { hash, verify } from '@node-rs/argon2';

// argon2id with the library defaults (m=19456 KiB, t=2, p=1), the OWASP baseline.
export const hashPassword = (password: string): Promise<string> => hash(password);

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/** Burns the same time as a real check, so unknown emails aren't revealed by timing. */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword('dummy-password-for-timing');
  await verifyPassword(await dummyHash, password);
  return false;
}
