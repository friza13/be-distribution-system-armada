import { PrismaClient } from '@prisma/client';

describe('Location Points Partitioning & Observability Fallback (E2E)', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('should route current monthly points to active partition and out-of-range points to default partition', async () => {
    const role = await prisma.role.upsert({
      where: { code: 'DRIVER' },
      update: {},
      create: { code: 'DRIVER', name: 'Driver' },
    });

    const user = await prisma.user.create({
      data: {
        username: `driver_part_${Date.now()}`,
        phone: `+62816${Date.now().toString().slice(-8)}`,
        passwordHash: 'hash',
        roleId: role.id,
      },
    });

    const driver = await prisma.driver.create({
      data: {
        userId: user.id,
        employeeCode: `EMP-PART-${Date.now()}`,
        displayName: 'Partition Driver',
        phone: user.phone,
      },
    });

    // 1. Insert point in current month (2026-09-02) -> should go to location_points_2026_09
    const septDate = new Date('2026-09-02T10:00:00Z');
    await prisma.$executeRaw`
      INSERT INTO location_points (id, driver_id, latitude, longitude, accuracy_m, recorded_at)
      VALUES (gen_random_uuid(), ${driver.id}::uuid, -6.175392, 106.827153, 5.0, ${septDate});
    `;

    // 2. Insert point in year 2028 (no explicit partition) -> MUST fall back to location_points_default without failing!
    const futureDate = new Date('2028-05-15T10:00:00Z');
    await prisma.$executeRaw`
      INSERT INTO location_points (id, driver_id, latitude, longitude, accuracy_m, recorded_at)
      VALUES (gen_random_uuid(), ${driver.id}::uuid, -6.175392, 106.827153, 5.0, ${futureDate});
    `;

    // 3. Verify row counts in specific partitions
    const septCount = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM location_points_2026_09 WHERE driver_id = ${driver.id}::uuid;
    `;
    expect(Number(septCount[0].count)).toBe(1);

    const defaultCount = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM location_points_default WHERE driver_id = ${driver.id}::uuid;
    `;
    expect(Number(defaultCount[0].count)).toBe(1);

    // Cleanup
    await prisma.$executeRaw`DELETE FROM location_points WHERE driver_id = ${driver.id}::uuid;`;
    await prisma.driver.delete({ where: { id: driver.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
});
