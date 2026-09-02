import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Waypoint } from '../../src/modules/routes/interfaces/routing-provider.interface';
import { HaversineRoutingProvider } from '../../src/modules/routes/providers/haversine-routing.provider';
import { OsrmRoutingProvider } from '../../src/modules/routes/providers/osrm-routing.provider';
import { RoutingService } from '../../src/modules/routes/services/routing.service';
import { RouteOptimizerService } from '../../src/modules/routes/services/route-optimizer.service';
import { solveExhaustivePermutation } from '../../src/modules/routes/utils/exhaustive-permutation.util';
import { solveNearestNeighbor2Opt } from '../../src/modules/routes/utils/nearest-neighbor-2opt.util';

describe('Route Optimization Engine ($N <= 5$ Exhaustive & $N > 5$ 2-Opt) (Unit Tests)', () => {
  let routeOptimizerService: RouteOptimizerService;

  const mockWaypoints5: Waypoint[] = [
    { id: 'stop-1', latitude: -6.1754, longitude: 106.8272 }, // Monas (Origin)
    { id: 'stop-2', latitude: -6.2183, longitude: 106.8026 }, // GBK
    { id: 'stop-3', latitude: -6.1950, longitude: 106.8230 }, // Bunderan HI (Closer to Monas!)
    { id: 'stop-4', latitude: -6.2250, longitude: 106.8000 }, // Senayan
    { id: 'stop-5', latitude: -6.2400, longitude: 106.7980 }, // Blok M
  ];

  const mockWaypoints8: Waypoint[] = [
    { id: 'stop-1', latitude: -6.1754, longitude: 106.8272 },
    { id: 'stop-2', latitude: -6.2400, longitude: 106.7980 },
    { id: 'stop-3', latitude: -6.1950, longitude: 106.8230 },
    { id: 'stop-4', latitude: -6.2183, longitude: 106.8026 },
    { id: 'stop-5', latitude: -6.2250, longitude: 106.8000 },
    { id: 'stop-6', latitude: -6.2500, longitude: 106.7900 },
    { id: 'stop-7', latitude: -6.2600, longitude: 106.7800 },
    { id: 'stop-8', latitude: -6.2700, longitude: 106.7700 },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HaversineRoutingProvider,
        OsrmRoutingProvider,
        RoutingService,
        RouteOptimizerService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, defaultVal: any) => defaultVal,
          },
        },
      ],
    }).compile();

    routeOptimizerService = module.get<RouteOptimizerService>(RouteOptimizerService);
  });

  describe('1. Exhaustive Permutation Search (N <= 5)', () => {
    it('should select EXHAUSTIVE_PERMUTATION algorithm for N=5 stops', async () => {
      const result = await routeOptimizerService.optimizeRoute(mockWaypoints5, 'haversine');

      expect(result.algorithm).toBe('EXHAUSTIVE_PERMUTATION');
      expect(result.orderedWaypoints.length).toBe(5);

      // Origin stop-1 remains at position 0
      expect(result.orderedWaypoints[0].id).toBe('stop-1');
      // stop-3 (Bunderan HI) is closer to Monas than stop-2 (GBK), so it should come first after origin
      expect(result.orderedWaypoints[1].id).toBe('stop-3');
    });

    it('should produce deterministic output on multiple executions', async () => {
      const res1 = await routeOptimizerService.optimizeRoute(mockWaypoints5, 'haversine');
      const res2 = await routeOptimizerService.optimizeRoute(mockWaypoints5, 'haversine');

      expect(res1.sequenceMap).toEqual(res2.sequenceMap);
      expect(res1.totalDistanceM).toBe(res2.totalDistanceM);
    });
  });

  describe('2. Nearest-Neighbor + 2-Opt Local Search (N > 5)', () => {
    it('should select NEAREST_NEIGHBOR_2OPT algorithm for N=8 stops', async () => {
      const result = await routeOptimizerService.optimizeRoute(mockWaypoints8, 'haversine');

      expect(result.algorithm).toBe('NEAREST_NEIGHBOR_2OPT');
      expect(result.orderedWaypoints.length).toBe(8);

      // Origin stop-1 remains at position 0
      expect(result.orderedWaypoints[0].id).toBe('stop-1');
      // Nearest neighbor to Monas (-6.1754) is Bunderan HI (-6.1950, stop-3)
      expect(result.orderedWaypoints[1].id).toBe('stop-3');
    });

    it('should produce deterministic output for N=8 stops', async () => {
      const res1 = await routeOptimizerService.optimizeRoute(mockWaypoints8, 'haversine');
      const res2 = await routeOptimizerService.optimizeRoute(mockWaypoints8, 'haversine');

      expect(res1.sequenceMap).toEqual(res2.sequenceMap);
      expect(res1.totalDistanceM).toBe(res2.totalDistanceM);
    });
  });

  describe('3. Edge Cases & Objective Function Verification', () => {
    it('should handle single stop gracefully without optimization', async () => {
      const singlePoint = [mockWaypoints5[0]];
      const result = await routeOptimizerService.optimizeRoute(singlePoint, 'haversine');

      expect(result.orderedWaypoints.length).toBe(1);
      expect(result.totalDistanceM).toBe(0);
      expect(result.sequenceMap[0].sequence).toBe(1);
    });

    it('should break ties deterministically on secondary distance metric when duration is equal', () => {
      const waypoints: Waypoint[] = [
        { id: 'stop-A', latitude: 0, longitude: 0 },
        { id: 'stop-B', latitude: 0, longitude: 1 },
        { id: 'stop-C', latitude: 0, longitude: 2 },
      ];

      // Equal durations (10s each way), but different distances (100m vs 200m)
      const durations = [
        [0, 10, 10],
        [10, 0, 10],
        [10, 10, 0],
      ];
      const distances = [
        [0, 100, 200],
        [100, 0, 100],
        [200, 100, 0],
      ];

      const solution = solveExhaustivePermutation(waypoints, distances, durations, true);
      expect(solution.orderedWaypoints[0].id).toBe('stop-A');
      expect(solution.orderedWaypoints[1].id).toBe('stop-B');
      expect(solution.orderedWaypoints[2].id).toBe('stop-C');
      expect(solution.totalDistanceM).toBe(200); // 100 + 100
    });
  });
});
