import { PrismaClient } from '@prisma/client';

describe('E2EE Prekey Atomic Reservation (E2E)', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('should atomically reserve distinct prekeys under concurrent requests without double consumption', async () => {
    const role = await prisma.role.upsert({
      where: { code: 'OWNER' },
      update: {},
      create: { code: 'OWNER', name: 'Owner' },
    });

    const user = await prisma.user.create({
      data: {
        username: `e2ee_user_${Date.now()}`,
        phone: `+62815${Date.now().toString().slice(-8)}`,
        passwordHash: 'hash',
        roleId: role.id,
      },
    });

    const device = await prisma.device.create({
      data: {
        userId: user.id,
        deviceIdentifier: `device-${Date.now()}`,
        platform: 'ANDROID',
        appVersion: '1.0.0',
      },
    });

    // Create 10 unconsumed prekeys
    const prekeysData = Array.from({ length: 10 }, (_, i) => ({
      deviceId: device.id,
      keyId: i + 1,
      publicKey: `base64_prekey_public_${i + 1}`,
      isConsumed: false,
    }));
    await prisma.prekey.createMany({ data: prekeysData });

    // Execute 5 concurrent atomic reservations using FOR UPDATE SKIP LOCKED
    const consumeQuery = (deviceId: string) =>
      prisma.$queryRaw<Array<{ id: string; key_id: number; public_key: string }>>`
        UPDATE prekeys
        SET is_consumed = TRUE, consumed_at = NOW()
        WHERE id = (
          SELECT id FROM prekeys
          WHERE device_id = ${deviceId}::uuid AND is_consumed = FALSE
          ORDER BY key_id ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, key_id, public_key;
      `;

    const results = await Promise.all([
      consumeQuery(device.id),
      consumeQuery(device.id),
      consumeQuery(device.id),
      consumeQuery(device.id),
      consumeQuery(device.id),
    ]);

    const consumedKeyIds = results.map((res) => res[0].key_id);
    // Verify that all 5 consumed keys are unique (no duplicates)
    const uniqueKeyIds = new Set(consumedKeyIds);
    expect(uniqueKeyIds.size).toBe(5);

    // Verify remaining unconsumed prekeys in DB = 5
    const remainingCount = await prisma.prekey.count({
      where: { deviceId: device.id, isConsumed: false },
    });
    expect(remainingCount).toBe(5);

    // Cleanup
    await prisma.prekey.deleteMany({ where: { deviceId: device.id } });
    await prisma.device.delete({ where: { id: device.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
});
