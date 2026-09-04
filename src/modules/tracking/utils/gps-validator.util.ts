export interface ClockSkewResult {
  valid: boolean;
  reason?: 'TIMESTAMP_FUTURE' | 'TIMESTAMP_STALE' | 'TIMESTAMP_INVALID';
}

/**
 * Validates coordinate range limits:
 * -90 <= latitude <= 90
 * -180 <= longitude <= 180
 */
export function validateCoordinateBounds(lat: number, lng: number): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return false;
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return false;
  }
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/**
 * Validates GPS accuracy threshold (must be > 0 and <= threshold)
 */
export function validateAccuracyThreshold(
  accuracyM: number,
  threshold: number = 50,
): boolean {
  if (typeof accuracyM !== 'number' || !Number.isFinite(accuracyM)) {
    return false;
  }
  return accuracyM > 0 && accuracyM <= threshold;
}

/**
 * Validates clock skew between client recorded time and server received time.
 * Rejects if recordedAt is in the future (> futureMarginMs, default 5m)
 * or if recordedAt is stale (> staleMs ago, default 1 hour).
 */
export function validateClockSkew(
  recordedAt: string | Date,
  receivedAt: Date = new Date(),
  futureMarginMs: number = 300000, // 5 minutes
  staleMs: number = 3600000,       // 1 hour
): ClockSkewResult {
  const recDate = typeof recordedAt === 'string' ? new Date(recordedAt) : recordedAt;
  const recTime = recDate ? recDate.getTime() : NaN;
  const recReceivedTime = receivedAt ? receivedAt.getTime() : NaN;

  if (isNaN(recTime) || isNaN(recReceivedTime)) {
    return { valid: false, reason: 'TIMESTAMP_INVALID' };
  }

  // Future check: recordedAt > receivedAt + 5 min
  if (recTime > recReceivedTime + futureMarginMs) {
    return { valid: false, reason: 'TIMESTAMP_FUTURE' };
  }

  // Stale check: recordedAt < receivedAt - 1 hour
  if (recTime < recReceivedTime - staleMs) {
    return { valid: false, reason: 'TIMESTAMP_STALE' };
  }

  return { valid: true };
}

/**
 * Calculates geodesic distance using Haversine formula (returns distance in meters)
 */
export function haversineDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  if (
    typeof lat1 !== 'number' ||
    typeof lng1 !== 'number' ||
    typeof lat2 !== 'number' ||
    typeof lng2 !== 'number' ||
    !Number.isFinite(lat1) ||
    !Number.isFinite(lng1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lng2)
  ) {
    return 0;
  }

  const R = 6371008.8; // Earth mean radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculates implied speed in m/s between two points with timestamps.
 * Returns 0 if time difference <= 0 or if points are identical.
 */
export function calculateImpliedSpeedMps(
  prevLat: number,
  prevLng: number,
  prevTime: Date | string | number,
  newLat: number,
  newLng: number,
  newTime: Date | string | number,
): number {
  const tPrev = new Date(prevTime).getTime();
  const tNew = new Date(newTime).getTime();

  if (isNaN(tPrev) || isNaN(tNew)) {
    return 0;
  }

  const timeDiffSec = (tNew - tPrev) / 1000;

  // Ignore out-of-order or duplicate timestamp (elapsed <= 0)
  if (timeDiffSec <= 0) {
    return 0;
  }

  const distanceM = haversineDistanceMeters(prevLat, prevLng, newLat, newLng);
  const speed = distanceM / timeDiffSec;

  return Number.isFinite(speed) ? speed : 0;
}

/**
 * Checks if speed exceeds plausible velocity threshold (default: 41.67 m/s = 150 km/h)
 */
export function isVelocityAnomaly(
  speedMps: number,
  threshold: number = 41.67,
): boolean {
  if (typeof speedMps !== 'number' || !Number.isFinite(speedMps)) {
    return false;
  }
  return speedMps > threshold;
}
