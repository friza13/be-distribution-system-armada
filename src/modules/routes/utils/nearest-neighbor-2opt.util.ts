import { Waypoint } from '../interfaces/routing-provider.interface';
import { OptimizationSolution } from './exhaustive-permutation.util';

/**
 * Solves Traveling Salesperson Problem for Larger N (N > 5) using
 * Nearest-Neighbor Constructive Heuristic followed by 2-Opt Local Search Improvement.
 * Includes iteration cap (100) and threshold termination to prevent infinite loops.
 */
export function solveNearestNeighbor2Opt(
  waypoints: Waypoint[],
  distancesMeters: number[][],
  durationsSeconds: number[][],
  fixedOrigin: boolean = true,
  maxIterations: number = 100,
  improvementThreshold: number = 0.001,
): OptimizationSolution {
  const n = waypoints.length;
  if (n <= 1) {
    return {
      orderedWaypoints: [...waypoints],
      totalDistanceM: 0,
      estimatedDurationS: 0,
      algorithm: 'NEAREST_NEIGHBOR_2OPT',
      sequenceMap: waypoints.map((w, idx) => ({ sequence: idx + 1, deliveryStopId: w.id })),
    };
  }

  // --- Step 1: Nearest Neighbor Construction ---
  const visited = new Set<number>();
  const tour: number[] = [];

  const startNode = fixedOrigin ? 0 : 0;
  tour.push(startNode);
  visited.add(startNode);

  while (visited.size < n) {
    const lastNode = tour[tour.length - 1];
    let nearestNode = -1;
    let minCost = Infinity;
    let minDist = Infinity;

    for (let i = 0; i < n; i++) {
      if (!visited.has(i)) {
        const cost = durationsSeconds[lastNode][i];
        const dist = distancesMeters[lastNode][i];

        let isBetter = false;
        if (cost < minCost) {
          isBetter = true;
        } else if (cost === minCost && dist < minDist) {
          isBetter = true;
        } else if (cost === minCost && dist === minDist) {
          if (nearestNode === -1 || waypoints[i].id < waypoints[nearestNode].id) {
            isBetter = true;
          }
        }

        if (isBetter) {
          minCost = cost;
          minDist = dist;
          nearestNode = i;
        }
      }
    }

    if (nearestNode !== -1) {
      tour.push(nearestNode);
      visited.add(nearestNode);
    } else {
      break;
    }
  }

  // --- Step 2: 2-Opt Local Search Improvement ---
  let currentTour = [...tour];
  let currentCost = computeTourCost(currentTour, durationsSeconds);
  let currentDistance = computeTourDistance(currentTour, distancesMeters);
  let iteration = 0;
  let improved = true;

  const startIdx = fixedOrigin ? 1 : 0;

  while (improved && iteration < maxIterations) {
    improved = false;
    iteration++;

    for (let i = startIdx; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        // Reverse subpath from i to j
        const candidateTour = perform2OptSwap(currentTour, i, j);
        const candidateCost = computeTourCost(candidateTour, durationsSeconds);
        const candidateDist = computeTourDistance(candidateTour, distancesMeters);

        const delta = currentCost - candidateCost;
        if (delta > improvementThreshold) {
          currentTour = candidateTour;
          currentCost = candidateCost;
          currentDistance = candidateDist;
          improved = true;
          break; // First-improvement strategy
        }
      }
      if (improved) break;
    }
  }

  const orderedWaypoints = currentTour.map((idx) => waypoints[idx]);
  const sequenceMap = orderedWaypoints.map((w, idx) => ({
    sequence: idx + 1,
    deliveryStopId: w.id,
  }));

  return {
    orderedWaypoints,
    totalDistanceM: Math.round(currentDistance * 100) / 100,
    estimatedDurationS: Math.round(currentCost),
    algorithm: 'NEAREST_NEIGHBOR_2OPT',
    sequenceMap,
  };
}

function perform2OptSwap(route: number[], i: number, j: number): number[] {
  const newRoute = route.slice(0, i);
  const reversedSubpath = route.slice(i, j + 1).reverse();
  const rest = route.slice(j + 1);
  return [...newRoute, ...reversedSubpath, ...rest];
}

function computeTourCost(tour: number[], durationsSeconds: number[][]): number {
  let cost = 0;
  for (let i = 0; i < tour.length - 1; i++) {
    cost += durationsSeconds[tour[i]][tour[i + 1]];
  }
  return cost;
}

function computeTourDistance(tour: number[], distancesMeters: number[][]): number {
  let dist = 0;
  for (let i = 0; i < tour.length - 1; i++) {
    dist += distancesMeters[tour[i]][tour[i + 1]];
  }
  return dist;
}
