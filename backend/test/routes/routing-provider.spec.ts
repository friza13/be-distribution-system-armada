import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Waypoint } from '../../src/modules/routes/interfaces/routing-provider.interface';
import { HaversineRoutingProvider } from '../../src/modules/routes/providers/haversine-routing.provider';
import { OsrmRoutingProvider } from '../../src/modules/routes/providers/osrm-routing.provider';
import { RoutingService } from '../../src/modules/routes/services/routing.service';

describe('Routing Provider Abstraction & Distance Matrix Engine (Unit Tests)', () => {
  let haversineProvider: HaversineRoutingProvider;
  let osrmProvider: OsrmRoutingProvider;
  let routingService: RoutingService;

  const mockWaypoints: Waypoint[] = [
    { id: 'stop-1', latitude: -6.1754, longitude: 106.8272 }, // Monas
    { id: 'stop-2', latitude: -6.1950, longitude: 106.8230 }, // Bunderan HI
    { id: 'stop-3', latitude: -6.2183, longitude: 106.8026 }, // GBK
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HaversineRoutingProvider,
        OsrmRoutingProvider,
        RoutingService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, defaultVal: any) => defaultVal,
          },
        },
      ],
    }).compile();

    haversineProvider = module.get<HaversineRoutingProvider>(HaversineRoutingProvider);
    osrmProvider = module.get<OsrmRoutingProvider>(OsrmRoutingProvider);
    routingService = module.get<RoutingService>(RoutingService);
  });

  describe('1. HaversineRoutingProvider', () => {
    it('should compute an N x N distance and duration matrix correctly', async () => {
      const result = await haversineProvider.getDistanceMatrix(mockWaypoints);

      expect(result.provider).toBe('HAVERSINE_FALLBACK');
      expect(result.distancesMeters.length).toBe(3);
      expect(result.durationsSeconds.length).toBe(3);

      // Diagonal elements must be zero
      expect(result.distancesMeters[0][0]).toBe(0);
      expect(result.durationsSeconds[1][1]).toBe(0);

      // Non-zero distance between Monas and Bunderan HI (~2.2 km)
      expect(result.distancesMeters[0][1]).toBeGreaterThan(2100);
      expect(result.distancesMeters[0][1]).toBeLessThan(2400);
      expect(result.durationsSeconds[0][1]).toBeGreaterThan(200);
    });

    it('should generate valid GeoJSON LineString geometry', async () => {
      const result = await haversineProvider.getRouteGeometry(mockWaypoints);

      expect(result.provider).toBe('HAVERSINE_FALLBACK');
      expect(result.totalDistanceM).toBeGreaterThan(4000);
      expect(result.polylineGeojson.type).toBe('LineString');
      expect(result.polylineGeojson.coordinates.length).toBe(3);
      expect(result.polylineGeojson.coordinates[0]).toEqual([106.8272, -6.1754]);
    });
  });

  describe('2. RoutingService Failover', () => {
    it('should use Haversine fallback directly when preferredProvider is haversine', async () => {
      const result = await routingService.getDistanceMatrix(mockWaypoints, 'haversine');
      expect(result.provider).toBe('HAVERSINE_FALLBACK');
    });

    it('should failover to Haversine when OSRM fails or times out', async () => {
      jest.spyOn(osrmProvider, 'getDistanceMatrix').mockRejectedValue(new Error('OSRM_TIMEOUT'));

      const result = await routingService.getDistanceMatrix(mockWaypoints, 'osrm');
      expect(result.provider).toBe('HAVERSINE_FALLBACK');
      expect(result.distancesMeters.length).toBe(3);
    });
  });
});
