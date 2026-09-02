import { Waypoint } from '../interfaces/routing-provider.interface';

export interface OptimizationSolution {
  orderedWaypoints: Waypoint[];
  totalDistanceM: number;
  estimatedDurationS: number;
  algorithm: 'EXHAUSTIVE_PERMUTATION' | 'NEAREST_NEIGHBOR_2OPT';
  sequenceMap: Array<{ sequence: number; deliveryStopId: string }>;
}

/**
 * Generates all permutations of an array
 */
export function generatePermutations<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr];
  const result: T[][] = [];

  for (let i = 0; i < arr.length; i++) {
    const current = arr[i];
    const remaining = [...arr.slice(0, i), ...arr.slice(i + 1)];
    const remainingPerms = generatePermutations(remaining);

    for (const perm of remainingPerms) {
      result.push([current, ...perm]);
    }
  }

  return result;
}

/**
 * Solves Traveling Salesperson Problem for Small N (N <= 5) using Exhaustive Permutation Search.
 * Guarantees 100% global optimum with deterministic tie-breaking.
 */
export function solveExhaustivePermutation(
  waypoints: Waypoint[],
  distancesMeters: number[][],
  durationsSeconds: number[][],
  fixedOrigin: boolean = true,
): OptimizationSolution {
  const n = waypoints.length;
  if (n <= 1) {
    return {
      orderedWaypoints: [...waypoints],
      totalDistanceM: 0,
      estimatedDurationS: 0,
      algorithm: 'EXHAUSTIVE_PERMUTATION',
      sequenceMap: waypoints.map((w, idx) => ({ sequence: idx + 1, deliveryStopId: w.id })),
    };
  }

  // If fixedOrigin, index 0 is fixed, permute indices 1..n-1
  const indicesToPermute = fixedOrigin
    ? Array.from({ length: n - 1 }, (_, i) => i + 1)
    : Array.from({ length: n }, (_, i) => i);

  const rawPermutations = generatePermutations(indicesToPermute);

  let bestCost = Infinity;
  let bestDistance = Infinity;
  let bestOrder: number[] = [];

  for (const perm of rawPermutations) {
    const fullOrder = fixedOrigin ? [0, ...perm] : perm;
    let cost = 0;
    let dist = 0;

    for (let i = 0; i < fullOrder.length - 1; i++) {
      const from = fullOrder[i];
      const to = fullOrder[i + 1];
      cost += durationsSeconds[from][to];
      dist += distancesMeters[from][to];
    }

    // Deterministic tie-breaking: prefer lower duration, then lower distance, then lexicographical ID
    let isBetter = false;
    if (cost < bestCost) {
      isBetter = true;
    } else if (cost === bestCost && dist < bestDistance) {
      isBetter = true;
    } else if (cost === bestCost && dist === bestDistance) {
      const bestIds = bestOrder.map((idx) => waypoints[idx].id).join(',');
      const currIds = fullOrder.map((idx) => waypoints[idx].id).join(',');
      if (currIds < bestIds) {
        isBetter = true;
      }
    }

    if (isBetter) {
      bestCost = cost;
      bestDistance = dist;
      bestOrder = fullOrder;
    }
  }

  const orderedWaypoints = bestOrder.map((idx) => waypoints[idx]);
  const sequenceMap = orderedWaypoints.map((w, idx) => ({
    sequence: idx + 1,
    deliveryStopId: w.id,
  }));

  return {
    orderedWaypoints,
    totalDistanceM: Math.round(bestDistance * 100) / 100,
    estimatedDurationS: Math.round(bestCost),
    algorithm: 'EXHAUSTIVE_PERMUTATION',
    sequenceMap,
  };
}
