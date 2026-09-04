import { PrismaClient } from '@prisma/client';

describe('Vehicle Assignment Overlap Guard (E2E)', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('should reject creating two ACTIVE assignments for the same vehicle via partial unique index', async () => {
    const role = await prisma.role.upsert({
      where: { code: 'DRIVER' },
      update: {},
      create: { code: 'DRIVER', name: 'Driver' },
    });

    const user1 = await prisma.user.create({
      data: {
        username: `driver1_${Date.now()}`,
        phone: `+62813${Date.now().toString().slice(-8)}`,
        passwordHash: 'hash',
        roleId: role.id,
      },
    });

    const user2 = await prisma.user.create({
      data: {
        username: `driver2_${Date.now()}`,
        phone: `+62814${Date.now().toString().slice(-8)}`,
        passwordHash: 'hash',
        roleId: role.id,
      },
    });

    const driver1 = await prisma.driver.create({
      data: {
        userId: user1.id,
        employeeCode: `EMP-1-${Date.now()}`,
        displayName: 'Driver One',
        phone: user1.phone,
      },
    });

    const driver2 = await prisma.driver.create({
      data: {
        userId: user2.id,
        employeeCode: `EMP-2-${Date.now()}`,
        displayName: 'Driver Two',
        phone: user2.phone,
      },
    });

    const vehicle = await prisma.vehicle.create({
      data: {
        plateNumber: `B-${Date.now().toString().slice(-4)}-XYZ`,
        vehicleType: 'VAN',
        capacityWeightKg: 1000,
      },
    });

    // 1. First active assignment succeeds
    const assignment1 = await prisma.vehicleAssignment.create({
      data: {
        driverId: driver1.id,
        vehicleId: vehicle.id,
        status: 'ACTIVE',
      },
    });

    // 2. Second active assignment for the same vehicle MUST FAIL due to partial unique index
    await expect(
      prisma.vehicleAssignment.create({
        data: {
          driverId: driver2.id,
          vehicleId: vehicle.id,
          status: 'ACTIVE',
        },
      }),
    ).rejects.toThrow();

    // 3. Completing first assignment allows new active assignment
    await prisma.vehicleAssignment.update({
      where: { id: assignment1.id },
      data: { status: 'COMPLETED', endedAt: new Date() },
    });

    const assignment2 = await prisma.vehicleAssignment.create({
      data: {
        driverId: driver2.id,
        vehicleId: vehicle.id,
        status: 'ACTIVE',
      },
    });

    expect(assignment2.id).toBeDefined();

    // Cleanup
    await prisma.vehicleAssignment.deleteMany({ where: { vehicleId: vehicle.id } });
    await prisma.vehicle.delete({ where: { id: vehicle.id } });
    await prisma.driver.deleteMany({ where: { id: { in: [driver1.id, driver2.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [user1.id, user2.id] } } });
  });
});
