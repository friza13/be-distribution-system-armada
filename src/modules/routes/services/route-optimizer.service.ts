import { Injectable, Logger } from '@nestjs/common';
import { RoutingService } from './routing.service';
import { Waypoint, RouteGeometryResult } from '../interfaces/routing-provider.interface';
import { solveExhaustivePermutation, OptimizationSolution } from '../utils/exhaustive-permutation.util';
import { solveNearestNeighbor2Opt } from '../utils/nearest-neighbor-2opt.util';

export interface RouteOptimizationResult extends OptimizationSolution {
  providerUsed: 'OSRM' | 'HAVERSINE_FALLBACK';
  geometry?: RouteGeometryResult;
}

@Injectable()
export class RouteOptimizerService {
  private readonly logger = new Logger(RouteOptimizerService.name);

  constructor(private readonly routingService: RoutingService) {}

  async optimizeRoute(
    waypoints: Waypoint[],
    preferredProvider?: 'osrm' | 'haversine',
    fixedOrigin: boolean = true,
  ): Promise<RouteOptimizationResult> {
    if (waypoints.length <= 1) {
      return {
        orderedWaypoints: [...waypoints],
        totalDistanceM: 0,
        estimatedDurationS: 0,
        algorithm: 'EXHAUSTIVE_PERMUTATION',
        providerUsed: 'HAVERSINE_FALLBACK',
        sequenceMap: waypoints.map((w, idx) => ({ sequence: idx + 1, deliveryStopId: w.id })),
      };
    }

    // 1. Fetch distance and duration matrix
    const matrixResult = await this.routingService.getDistanceMatrix(waypoints, preferredProvider);

    // 2. Select algorithm based on stop count N
    let solution: OptimizationSolution;
    if (waypoints.length <= 5) {
      this.logger.log(`Using Exhaustive Permutation Search for N=${waypoints.length} stops`);
      solution = solveExhaustivePermutation(
        waypoints,
        matrixResult.distancesMeters,
        matrixResult.durationsSeconds,
        fixedOrigin,
      );
    } else {
      this.logger.log(`Using Nearest-Neighbor + 2-Opt for N=${waypoints.length} stops`);
      solution = solveNearestNeighbor2Opt(
        waypoints,
        matrixResult.distancesMeters,
        matrixResult.durationsSeconds,
        fixedOrigin,
      );
    }

    // 3. Fetch geometry for optimal ordered waypoints
    let geometry: RouteGeometryResult | undefined;
    try {
      geometry = await this.routingService.getRouteGeometry(
        solution.orderedWaypoints,
        preferredProvider,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to fetch route geometry: ${msg}`);
    }

    return {
      ...solution,
      totalDistanceM: geometry ? geometry.totalDistanceM : solution.totalDistanceM,
      estimatedDurationS: geometry ? geometry.estimatedDurationS : solution.estimatedDurationS,
      providerUsed: matrixResult.provider,
      geometry,
    };
  }
}
