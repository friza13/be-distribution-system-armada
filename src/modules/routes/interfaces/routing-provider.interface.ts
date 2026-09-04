export interface Waypoint {
  id: string;
  latitude: number;
  longitude: number;
}

export interface DistanceMatrixResult {
  distancesMeters: number[][];
  durationsSeconds: number[][];
  provider: 'OSRM' | 'HAVERSINE_FALLBACK';
}

export interface RouteGeometryResult {
  totalDistanceM: number;
  estimatedDurationS: number;
  polylineGeojson: Record<string, any>;
  provider: 'OSRM' | 'HAVERSINE_FALLBACK';
}

export interface RoutingProvider {
  getDistanceMatrix(waypoints: Waypoint[]): Promise<DistanceMatrixResult>;
  getRouteGeometry(waypoints: Waypoint[]): Promise<RouteGeometryResult>;
}
