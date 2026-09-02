-- 1. Enable PostGIS Extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. Create Enums
CREATE TYPE "AccountStatus" AS ENUM ('PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'DISABLED');
CREATE TYPE "DriverOperationalStatus" AS ENUM ('OFFLINE', 'AVAILABLE', 'ON_DELIVERY', 'EMERGENCY');
CREATE TYPE "VehicleType" AS ENUM ('MOTORCYCLE', 'VAN', 'TRUCK_SMALL', 'TRUCK_LARGE');
CREATE TYPE "VehicleStatus" AS ENUM ('ACTIVE', 'MAINTENANCE', 'INACTIVE');
CREATE TYPE "VehicleAssignmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'REVOKED');
CREATE TYPE "PlatformType" AS ENUM ('ANDROID', 'IOS', 'WEB');
CREATE TYPE "DeviceStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- 3. Create Master Tables
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

CREATE TABLE "permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(100) NOT NULL,
    "description" TEXT,
    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id", "permission_id"),
    CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "username" VARCHAR(50) NOT NULL,
    "email" VARCHAR(100),
    "phone" VARCHAR(20) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role_id" UUID NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'PENDING_ACTIVATION',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMPTZ(3),
    CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "users_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

CREATE TABLE "drivers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "employee_code" VARCHAR(50) NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "active_vehicle_id" UUID,
    "operational_status" "DriverOperationalStatus" NOT NULL DEFAULT 'OFFLINE',
    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "drivers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "drivers_user_id_key" ON "drivers"("user_id");
CREATE UNIQUE INDEX "drivers_employee_code_key" ON "drivers"("employee_code");

CREATE TABLE "vehicles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plate_number" VARCHAR(20) NOT NULL,
    "vehicle_type" "VehicleType" NOT NULL,
    "capacity_weight_kg" DECIMAL(10,2) NOT NULL,
    "capacity_volume_m3" DECIMAL(10,2),
    "status" "VehicleStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "vehicles_plate_number_key" ON "vehicles"("plate_number");

CREATE TABLE "vehicle_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "driver_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),
    "status" "VehicleAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    CONSTRAINT "vehicle_assignments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vehicle_assignments_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "vehicle_assignments_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "vehicle_assignments_driver_id_status_idx" ON "vehicle_assignments"("driver_id", "status");
CREATE INDEX "vehicle_assignments_vehicle_id_status_idx" ON "vehicle_assignments"("vehicle_id", "status");

-- Partial Unique Indexes to prevent overlapping active assignments
CREATE UNIQUE INDEX "idx_unique_active_vehicle_assignment" ON "vehicle_assignments"("vehicle_id") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "idx_unique_active_driver_assignment" ON "vehicle_assignments"("driver_id") WHERE "status" = 'ACTIVE';

CREATE TABLE "devices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "device_identifier" VARCHAR(100) NOT NULL,
    "platform" "PlatformType" NOT NULL,
    "app_version" VARCHAR(50) NOT NULL,
    "push_token" TEXT,
    "status" "DeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "devices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "refresh_token_hash" VARCHAR(255) NOT NULL,
    "token_family" UUID NOT NULL,
    "is_revoked" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_refreshed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "sessions_token_family_idx" ON "sessions"("token_family");
CREATE INDEX "sessions_user_id_is_revoked_idx" ON "sessions"("user_id", "is_revoked");

CREATE TABLE "device_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "device_id" UUID NOT NULL,
    "identity_key_public" TEXT NOT NULL,
    "signed_prekey_public" TEXT NOT NULL,
    "signed_prekey_sig" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "device_keys_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "device_keys_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "device_keys_device_id_key" ON "device_keys"("device_id");

CREATE TABLE "prekeys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "device_id" UUID NOT NULL,
    "key_id" INTEGER NOT NULL,
    "public_key" TEXT NOT NULL,
    "is_consumed" BOOLEAN NOT NULL DEFAULT false,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "prekeys_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "prekeys_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "prekeys_device_id_key_id_key" ON "prekeys"("device_id", "key_id");
CREATE INDEX "prekeys_device_id_is_consumed_idx" ON "prekeys"("device_id", "is_consumed");
