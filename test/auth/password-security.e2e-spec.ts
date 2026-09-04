import { PrismaClient } from '@prisma/client';
import {
  hashPassword,
  verifyPassword,
  dummyVerifyPassword,
} from '../../src/common/utils/password.util';

describe('Password Security & Credential Protection (E2E)', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('should store only Argon2id hash in database and successfully verify valid credentials', async () => {
    const role = await prisma.role.upsert({
      where: { code: 'ADMIN' },
      update: {},
      create: { code: 'ADMIN', name: 'Administrator' },
    });

    const plainPassword = 'SuperSecretPassword2026!';
    const hashedPassword = await hashPassword(plainPassword);

    const user = await prisma.user.create({
      data: {
        username: `pwd_user_${Date.now()}`,
        email: `pwd_${Date.now()}@test.com`,
        phone: `+62817${Date.now().toString().slice(-8)}`,
        passwordHash: hashedPassword,
        roleId: role.id,
      },
    });

    // Verify DB user record contains Argon2id hash and NEVER plain password
    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(dbUser?.passwordHash).not.toBe(plainPassword);
    expect(dbUser?.passwordHash).toContain('$argon2id$');

    // Verify credential verification
    const isCorrect = await verifyPassword(dbUser!.passwordHash, plainPassword);
    expect(isCorrect).toBe(true);

    const isWrong = await verifyPassword(dbUser!.passwordHash, 'IncorrectPassword!');
    expect(isWrong).toBe(false);

    // Cleanup
    await prisma.user.delete({ where: { id: user.id } });
  });

  it('should equalize timing for non-existent users using dummyVerifyPassword', async () => {
    const t0 = Date.now();
    await dummyVerifyPassword('NonExistentUserPassword');
    const dummyDuration = Date.now() - t0;

    const realHash = await hashPassword('ValidUserPassword');
    const t1 = Date.now();
    await verifyPassword(realHash, 'WrongPasswordForExistingUser');
    const realVerifyDuration = Date.now() - t1;

    // Both operations should execute the full Argon2id computation
    expect(dummyDuration).toBeGreaterThanOrEqual(10);
    expect(realVerifyDuration).toBeGreaterThanOrEqual(10);
  });
});
