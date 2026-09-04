-- 1. Create Operational Enums
CREATE TYPE "DeliveryStatus" AS ENUM ('DRAFT', 'ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'COMPLETED', 'CANCELLED', 'FAILED');
CREATE TYPE "RouteMode" AS ENUM ('MANUAL', 'RECOMMENDED_2OPT');
CREATE TYPE "StopStatus" AS ENUM ('PENDING', 'EN_ROUTE', 'ARRIVED', 'UNLOADING', 'DELIVERED', 'FAILED', 'SKIPPED');
CREATE TYPE "RouteSource" AS ENUM ('MANUAL', 'RECOMMENDED_2OPT', 'EXTERNAL_OSRM');
CREATE TYPE "ConflictStatus" AS ENUM ('OPEN', 'RESOLVED_OVERRIDDEN', 'RESOLVED_DISCARDED');
CREATE TYPE "EmergencyStatus" AS ENUM ('TRIGGERED', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_ALARM');
CREATE TYPE "ConversationType" AS ENUM ('DIRECT_1TO1');
CREATE TYPE "ConversationStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "RealtimeSessionType" AS ENUM ('VOICE_PTT', 'VIDEO');
CREATE TYPE "RealtimeSessionStatus" AS ENUM ('PENDING', 'ACTIVE', 'DECLINED', 'TIMEOUT', 'ENDED');
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'READ');

-- 2. Create Deliveries & Items
CREATE TABLE "deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "delivery_code" VARCHAR(50) NOT NULL,
    "driver_id" UUID,
    "vehicle_id" UUID,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'DRAFT',
    "route_mode" "RouteMode" NOT NULL DEFAULT 'RECOMMENDED_2OPT',
    "planned_start_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "deliveries_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "deliveries_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "deliveries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "deliveries_delivery_code_key" ON "deliveries"("delivery_code");
CREATE INDEX "deliveries_driver_id_status_idx" ON "deliveries"("driver_id", "status");
CREATE INDEX "deliveries_created_by_idx" ON "deliveries"("created_by");

CREATE TABLE "delivery_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "delivery_id" UUID NOT NULL,
    "item_code" VARCHAR(50) NOT NULL,
    "item_name" VARCHAR(100) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit" VARCHAR(20) NOT NULL,
    "weight_kg" DECIMAL(10,2),
    "volume_m3" DECIMAL(10,2),
    CONSTRAINT "delivery_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "delivery_items_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "delivery_stops" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "delivery_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "destination_name" VARCHAR(100) NOT NULL,
    "address" TEXT NOT NULL,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "geom" geometry(Point, 4326) NOT NULL DEFAULT ST_SetSRID(ST_MakePoint(0, 0), 4326),
    "geofence_radius_m" INTEGER NOT NULL DEFAULT 100,
    "status" "StopStatus" NOT NULL DEFAULT 'PENDING',
    "arrived_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    CONSTRAINT "delivery_stops_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "delivery_stops_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "delivery_stops_delivery_id_sequence_key" ON "delivery_stops"("delivery_id", "sequence");

CREATE TABLE "routes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "delivery_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "source" "RouteSource" NOT NULL DEFAULT 'RECOMMENDED_2OPT',
    "total_distance_m" DECIMAL(12,2) NOT NULL,
    "estimated_duration_s" INTEGER NOT NULL,
    "polyline_geojson" JSONB,
    "selected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "routes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "routes_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "routes_delivery_id_version_key" ON "routes"("delivery_id", "version");

CREATE TABLE "route_stops" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "route_id" UUID NOT NULL,
    "delivery_stop_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    CONSTRAINT "route_stops_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "route_stops_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "route_stops_delivery_stop_id_fkey" FOREIGN KEY ("delivery_stop_id") REFERENCES "delivery_stops"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "route_stops_route_id_sequence_key" ON "route_stops"("route_id", "sequence");
CREATE UNIQUE INDEX "route_stops_route_id_delivery_stop_id_key" ON "route_stops"("route_id", "delivery_stop_id");

-- 3. Range Partitioned Table: location_points
CREATE TABLE "location_points" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "driver_id" UUID NOT NULL,
    "delivery_id" UUID,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "geom" geometry(Point, 4326) NOT NULL DEFAULT ST_SetSRID(ST_MakePoint(0, 0), 4326),
    "accuracy_m" DECIMAL(6,2) NOT NULL,
    "speed_mps" DECIMAL(6,2),
    "heading_deg" DECIMAL(5,2),
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" VARCHAR(50) NOT NULL DEFAULT 'driver_app',
    "validation_status" VARCHAR(20) NOT NULL DEFAULT 'VALID',
    CONSTRAINT "location_points_pkey" PRIMARY KEY ("id", "recorded_at"),
    CONSTRAINT "location_points_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "location_points_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE SET NULL ON UPDATE CASCADE
) PARTITION BY RANGE ("recorded_at");

-- Default partition fallback & initial monthly partitions
CREATE TABLE "location_points_default" PARTITION OF "location_points" DEFAULT;

CREATE TABLE "location_points_2026_09" PARTITION OF "location_points"
    FOR VALUES FROM ('2026-09-01 00:00:00+00') TO ('2026-10-01 00:00:00+00');

CREATE TABLE "location_points_2026_10" PARTITION OF "location_points"
    FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');

CREATE TABLE "location_points_2026_11" PARTITION OF "location_points"
    FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');

CREATE TABLE "location_points_2026_12" PARTITION OF "location_points"
    FOR VALUES FROM ('2026-12-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');

-- 4. Create Files, POD & Events
CREATE TABLE "files" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "object_key" VARCHAR(255) NOT NULL,
    "media_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "checksum_sha256" VARCHAR(64) NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "files_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "files_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "files_object_key_key" ON "files"("object_key");

CREATE TABLE "delivery_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "delivery_id" UUID NOT NULL,
    "stop_id" UUID,
    "event_type" VARCHAR(50) NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "metadata_json" JSONB NOT NULL,
    "client_occurred_at" TIMESTAMPTZ(3),
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotency_key" UUID,
    CONSTRAINT "delivery_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "delivery_events_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "delivery_events_stop_id_fkey" FOREIGN KEY ("stop_id") REFERENCES "delivery_stops"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "delivery_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "delivery_events_idempotency_key_key" ON "delivery_events"("idempotency_key");
CREATE INDEX "delivery_events_delivery_id_occurred_at_idx" ON "delivery_events"("delivery_id", "occurred_at");

CREATE TABLE "proof_of_delivery" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "delivery_stop_id" UUID NOT NULL,
    "receiver_name" VARCHAR(100) NOT NULL,
    "signature_file_id" UUID,
    "photo_file_id" UUID,
    "notes" TEXT,
    "completed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "proof_of_delivery_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "proof_of_delivery_delivery_stop_id_fkey" FOREIGN KEY ("delivery_stop_id") REFERENCES "delivery_stops"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "proof_of_delivery_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "proof_of_delivery_signature_file_id_fkey" FOREIGN KEY ("signature_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "proof_of_delivery_photo_file_id_fkey" FOREIGN KEY ("photo_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "proof_of_delivery_delivery_stop_id_key" ON "proof_of_delivery"("delivery_stop_id");

CREATE TABLE "delivery_conflicts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "delivery_id" UUID NOT NULL,
    "client_event_id" VARCHAR(100) NOT NULL,
    "conflict_type" VARCHAR(50) NOT NULL,
    "server_state" VARCHAR(50) NOT NULL,
    "client_payload" JSONB NOT NULL,
    "status" "ConflictStatus" NOT NULL DEFAULT 'OPEN',
    "resolved_by" UUID,
    "resolution_notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),
    CONSTRAINT "delivery_conflicts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "delivery_conflicts_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "delivery_conflicts_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_user_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" VARCHAR(100) NOT NULL,
    "before_json" JSONB,
    "after_json" JSONB,
    "result" VARCHAR(20) NOT NULL,
    "request_id" VARCHAR(36),
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");
CREATE INDEX "audit_logs_actor_user_id_idx" ON "audit_logs"("actor_user_id");

CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "endpoint" VARCHAR(100) NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "idempotency_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "idempotency_records_key_user_id_endpoint_key" ON "idempotency_records"("key", "user_id", "endpoint");
CREATE INDEX "idempotency_records_expires_at_idx" ON "idempotency_records"("expires_at");

CREATE TABLE "emergencies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "driver_id" UUID NOT NULL,
    "delivery_id" UUID,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "geom" geometry(Point, 4326) NOT NULL DEFAULT ST_SetSRID(ST_MakePoint(0, 0), 4326),
    "emergency_type" VARCHAR(50) NOT NULL,
    "note" TEXT,
    "status" "EmergencyStatus" NOT NULL DEFAULT 'TRIGGERED',
    "triggered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by" UUID,
    CONSTRAINT "emergencies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "emergencies_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "emergencies_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "emergencies_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "ConversationType" NOT NULL DEFAULT 'DIRECT_1TO1',
    "owner_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "conversations_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "conversations_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "conversations_owner_id_driver_id_key" ON "conversations"("owner_id", "driver_id");

CREATE TABLE "messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "sender_user_id" UUID NOT NULL,
    "sender_device_id" UUID NOT NULL,
    "recipient_device_id" UUID NOT NULL,
    "protocol_version" INTEGER NOT NULL DEFAULT 1,
    "ciphertext_blob" TEXT NOT NULL,
    "header_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMPTZ(3),
    "read_at" TIMESTAMPTZ(3),
    CONSTRAINT "messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "messages_sender_device_id_fkey" FOREIGN KEY ("sender_device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "messages_recipient_device_id_fkey" FOREIGN KEY ("recipient_device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

CREATE TABLE "realtime_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "RealtimeSessionType" NOT NULL,
    "owner_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "delivery_id" UUID,
    "status" "RealtimeSessionStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    CONSTRAINT "realtime_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "realtime_sessions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "realtime_sessions_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "realtime_sessions_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "realtime_sessions_owner_id_driver_id_idx" ON "realtime_sessions"("owner_id", "driver_id");
CREATE INDEX "realtime_sessions_status_expires_at_idx" ON "realtime_sessions"("status", "expires_at");

CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "device_id" UUID,
    "type" VARCHAR(50) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "payload_json" JSONB NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "provider_message_id" VARCHAR(100),
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "notifications_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "notifications_user_id_status_idx" ON "notifications"("user_id", "status");

-- 5. Universal Coordinate Sync Trigger Function & Triggers
CREATE OR REPLACE FUNCTION sync_point_geom()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.longitude IS NOT NULL AND NEW.latitude IS NOT NULL THEN
    NEW.geom := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326);
  ELSIF NEW.geom IS NOT NULL THEN
    NEW.longitude := ST_X(NEW.geom);
    NEW.latitude := ST_Y(NEW.geom);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_delivery_stops_geom
  BEFORE INSERT OR UPDATE ON "delivery_stops"
  FOR EACH ROW EXECUTE FUNCTION sync_point_geom();

CREATE TRIGGER trg_sync_location_points_geom
  BEFORE INSERT OR UPDATE ON "location_points"
  FOR EACH ROW EXECUTE FUNCTION sync_point_geom();

CREATE TRIGGER trg_sync_emergencies_geom
  BEFORE INSERT OR UPDATE ON "emergencies"
  FOR EACH ROW EXECUTE FUNCTION sync_point_geom();

-- 6. Functional GiST Expression Indexes for Metric Distance / Geofence Queries
CREATE INDEX "idx_delivery_stops_geog" ON "delivery_stops" USING GIST (((geom)::geography));
CREATE INDEX "idx_location_points_geog" ON "location_points" USING GIST (((geom)::geography));
CREATE INDEX "idx_emergencies_geog" ON "emergencies" USING GIST (((geom)::geography));

-- Composite Operational Indexes
CREATE INDEX "idx_location_points_driver_recorded" ON "location_points"("driver_id", "recorded_at" DESC);

-- 7. Check Constraints for Coordinate Validity & JSON Length
ALTER TABLE "delivery_stops"
  ADD CONSTRAINT "check_delivery_stops_lat_range" CHECK ("latitude" >= -90 AND "latitude" <= 90),
  ADD CONSTRAINT "check_delivery_stops_lng_range" CHECK ("longitude" >= -180 AND "longitude" <= 180);

ALTER TABLE "location_points"
  ADD CONSTRAINT "check_location_points_lat_range" CHECK ("latitude" >= -90 AND "latitude" <= 90),
  ADD CONSTRAINT "check_location_points_lng_range" CHECK ("longitude" >= -180 AND "longitude" <= 180);

ALTER TABLE "emergencies"
  ADD CONSTRAINT "check_emergencies_lat_range" CHECK ("latitude" >= -90 AND "latitude" <= 90),
  ADD CONSTRAINT "check_emergencies_lng_range" CHECK ("longitude" >= -180 AND "longitude" <= 180);

ALTER TABLE "delivery_events"
  ADD CONSTRAINT "check_delivery_events_metadata_size" CHECK (octet_length("metadata_json"::text) <= 65536);
