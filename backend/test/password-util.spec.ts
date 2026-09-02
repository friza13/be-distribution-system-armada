import {
  hashPassword,
  verifyPassword,
  dummyVerifyPassword,
  needsRehash,
  ARGON2_CONFIG,
} from '../src/common/utils/password.util';

describe('Password Utility (Unit)', () => {
  it('should hash a password using Argon2id with 64MB memory and 3 iterations', async () => {
    const rawPassword = 'StrongPassword!2026';
    const hash = await hashPassword(rawPassword);

    expect(hash).toContain('$argon2id$');
    expect(hash).toContain(`m=${ARGON2_CONFIG.memoryCost}`);
    expect(hash).toContain(`t=${ARGON2_CONFIG.timeCost}`);
    expect(hash).toContain(`p=${ARGON2_CONFIG.parallelism}`);

    const isValid = await verifyPassword(hash, rawPassword);
    expect(isValid).toBe(true);

    const isInvalid = await verifyPassword(hash, 'WrongPassword');
    expect(isInvalid).toBe(false);
  });

  it('should detect when an old/weak hash needs rehash', () => {
    const modernHash = '$argon2id$v=19$m=65536,t=3,p=4$salt$digest';
    const weakMemoryHash = '$argon2id$v=19$m=19456,t=2,p=1$salt$digest';
    const bcryptHash = '$2b$10$oldBcryptHashStringHere';

    expect(needsRehash(modernHash)).toBe(false);
    expect(needsRehash(weakMemoryHash)).toBe(true);
    expect(needsRehash(bcryptHash)).toBe(true);
  });

  it('should execute dummyVerifyPassword for timing equalization without throwing', async () => {
    const startTime = Date.now();
    await dummyVerifyPassword('randomTestPassword');
    const elapsed = Date.now() - startTime;
    // Should take non-trivial time (~30ms - 250ms) to simulate full hash calculation
    expect(elapsed).toBeGreaterThanOrEqual(10);
  });
});
