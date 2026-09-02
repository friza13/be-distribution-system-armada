import { Injectable, Logger } from '@nestjs/common';
import {
  RoutingProvider,
  Waypoint,
  DistanceMatrixResult,
  RouteGeometryResult,
} from '../interfaces/routing-provider.interface';
import { OsrmRoutingProvider } from '../providers/osrm-routing.provider';
import { HaversineRoutingProvider } from '../providers/haversine-routing.provider';

@Injectable()
export class RoutingService implements RoutingProvider {
  private readonly logger = new Logger(RoutingService.name);

  constructor(
    private readonly osrmProvider: OsrmRoutingProvider,
    private readonly haversineProvider: HaversineRoutingProvider,
  ) {}

  async getDistanceMatrix(
    waypoints: Waypoint[],
    preferredProvider?: 'osrm' | 'haversine',
  ): Promise<DistanceMatrixResult> {
    if (preferredProvider === 'haversine') {
      return this.haversineProvider.getDistanceMatrix(waypoints);
    }

    try {
      return await this.osrmProvider.getDistanceMatrix(waypoints);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Primary OSRM provider failed (${msg}). Failing over to Haversine Geodesic Provider.`);
      return this.haversineProvider.getDistanceMatrix(waypoints);
    }
  }

  async getRouteGeometry(
    waypoints: Waypoint[],
    preferredProvider?: 'osrm' | 'haversine',
  ): Promise<RouteGeometryResult> {
    if (preferredProvider === 'haversine') {
      return this.haversineProvider.getRouteGeometry(waypoints);
    }

    try {
      return await this.osrmProvider.getRouteGeometry(waypoints);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Primary OSRM provider failed (${msg}). Failing over to Haversine Geodesic Provider.`);
      return this.haversineProvider.getRouteGeometry(waypoints);
    }
  }
}
