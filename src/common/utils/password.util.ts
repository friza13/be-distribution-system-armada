import { hash, verify, Algorithm } from '@node-rs/argon2';

export const ARGON2_CONFIG = {
  memoryCost: 65536, // 64 MB
  timeCost: 3,
  parallelism: 4,
  algorithm: Algorithm.Argon2id,
};

// Precomputed valid dummy hash with matching Argon2id parameters for timing equalization
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$4mPZ6+Q4rP4f4lU4mPZ6+Q$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_CONFIG);
}

export async function verifyPassword(
  passwordHash: string,
  plainPassword: string,
): Promise<boolean> {
  try {
    return await verify(passwordHash, plainPassword);
  } catch {
    return false;
  }
}

export async function dummyVerifyPassword(plainPassword?: string): Promise<void> {
  try {
    await verify(DUMMY_HASH, plainPassword || 'DummyTimingPassword123!');
  } catch {
    // Ignore error, execution timing is what matters
  }
}

export function needsRehash(passwordHash: string): boolean {
  // Check if hash algorithm and baseline parameters match
  return (
    !passwordHash.startsWith('$argon2id$') ||
    !passwordHash.includes('m=65536,t=3,p=4')
  );
}
