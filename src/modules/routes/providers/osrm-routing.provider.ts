import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  RoutingProvider,
  Waypoint,
  DistanceMatrixResult,
  RouteGeometryResult,
} from '../interfaces/routing-provider.interface';

@Injectable()
export class OsrmRoutingProvider implements RoutingProvider {
  private readonly logger = new Logger(OsrmRoutingProvider.name);
  private readonly osrmBaseUrl: string;
  private readonly timeoutMs: number = 3000;

  constructor(private readonly configService: ConfigService) {
    this.osrmBaseUrl = this.configService.get<string>(
      'routing.osrmBaseUrl',
      'http://router.project-osrm.org',
    );
  }

  async getDistanceMatrix(waypoints: Waypoint[]): Promise<DistanceMatrixResult> {
    if (waypoints.length < 2) {
      return {
        distancesMeters: [[0]],
        durationsSeconds: [[0]],
        provider: 'OSRM',
      };
    }

    // OSRM coordinates format: lng,lat;lng,lat
    const coordString = waypoints
      .map((wp) => `${wp.longitude},${wp.latitude}`)
      .join(';');

    const url = `${this.osrmBaseUrl}/table/v1/driving/${coordString}?annotations=distance,duration`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      if (!response.ok) {
        throw new Error(`OSRM Table API returned status ${response.status}`);
      }

      const data = await response.json();
      if (!data || data.code !== 'Ok' || !data.distances || !data.durations) {
        throw new Error(`OSRM Table API response invalid code: ${data?.code || 'unknown'}`);
      }

      return {
        distancesMeters: data.distances,
        durationsSeconds: data.durations,
        provider: 'OSRM',
      };
    } catch (err: unknown) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`OSRM Distance Matrix request failed/timed out (${msg})`);
      throw new Error(`OSRM_PROVIDER_ERROR: ${msg}`);
    }
  }

  async getRouteGeometry(waypoints: Waypoint[]): Promise<RouteGeometryResult> {
    if (waypoints.length < 2) {
      return {
        totalDistanceM: 0,
        estimatedDurationS: 0,
        polylineGeojson: { type: 'LineString', coordinates: waypoints.map(w => [w.longitude, w.latitude]) },
        provider: 'OSRM',
      };
    }

    const coordString = waypoints
      .map((wp) => `${wp.longitude},${wp.latitude}`)
      .join(';');

    const url = `${this.osrmBaseUrl}/route/v1/driving/${coordString}?overview=full&geometries=geojson`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      if (!response.ok) {
        throw new Error(`OSRM Route API returned status ${response.status}`);
      }

      const data = await response.json();
      if (!data || data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
        throw new Error(`OSRM Route API response invalid code: ${data?.code || 'unknown'}`);
      }

      const route = data.routes[0];
      return {
        totalDistanceM: Math.round(route.distance * 100) / 100,
        estimatedDurationS: Math.round(route.duration),
        polylineGeojson: route.geometry,
        provider: 'OSRM',
      };
    } catch (err: unknown) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`OSRM Route Geometry request failed/timed out (${msg})`);
      throw new Error(`OSRM_PROVIDER_ERROR: ${msg}`);
    }
  }
}
