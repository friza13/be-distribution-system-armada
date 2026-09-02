import { Injectable, Logger } from '@nestjs/common';
import {
  RoutingProvider,
  Waypoint,
  DistanceMatrixResult,
  RouteGeometryResult,
} from '../interfaces/routing-provider.interface';
import { haversineDistanceMeters } from '../../tracking/utils/gps-validator.util';

@Injectable()
export class HaversineRoutingProvider implements RoutingProvider {
  private readonly logger = new Logger(HaversineRoutingProvider.name);
  private readonly averageSpeedMps = 8.333; // ~30 km/h urban delivery average speed

  async getDistanceMatrix(waypoints: Waypoint[]): Promise<DistanceMatrixResult> {
    const n = waypoints.length;
    const distancesMeters: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
    const durationsSeconds: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) {
          distancesMeters[i][j] = 0;
          durationsSeconds[i][j] = 0;
        } else {
          const dist = haversineDistanceMeters(
            waypoints[i].latitude,
            waypoints[i].longitude,
            waypoints[j].latitude,
            waypoints[j].longitude,
          );
          distancesMeters[i][j] = Math.round(dist * 100) / 100;
          durationsSeconds[i][j] = Math.round(dist / this.averageSpeedMps);
        }
      }
    }

    return {
      distancesMeters,
      durationsSeconds,
      provider: 'HAVERSINE_FALLBACK',
    };
  }

  async getRouteGeometry(waypoints: Waypoint[]): Promise<RouteGeometryResult> {
    const n = waypoints.length;
    let totalDistanceM = 0;

    const coordinates: Array<[number, number]> = [];
    for (let i = 0; i < n; i++) {
      coordinates.push([waypoints[i].longitude, waypoints[i].latitude]);
      if (i > 0) {
        totalDistanceM += haversineDistanceMeters(
          waypoints[i - 1].latitude,
          waypoints[i - 1].longitude,
          waypoints[i].latitude,
          waypoints[i].longitude,
        );
      }
    }

    totalDistanceM = Math.round(totalDistanceM * 100) / 100;
    const estimatedDurationS = Math.round(totalDistanceM / this.averageSpeedMps);

    return {
      totalDistanceM,
      estimatedDurationS,
      polylineGeojson: {
        type: 'LineString',
        coordinates,
      },
      provider: 'HAVERSINE_FALLBACK',
    };
  }
}
