import type { Ridge, Vec3 } from './types';

export function dist2d(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function dist3d(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.alt - b.alt);
}

/**
 * Radar horizon between two heights (meters AGL), in meters — the 4/3-earth
 * approximation used in radar engineering: d ≈ 4120 (√h1 + √h2).
 * A target below the horizon is terrain/curvature-masked regardless of
 * radar power.
 */
export function radarHorizon(h1: number, h2: number): number {
  return 4120 * (Math.sqrt(Math.max(h1, 0)) + Math.sqrt(Math.max(h2, 0)));
}

/**
 * Terrain masking: does the sight line a→b pass below a ridge's crest where
 * it crosses the ridge segment? Pure 2D segment intersection plus a linear
 * interpolation of the line-of-sight altitude at the crossing point.
 */
export function losBlockedByRidge(a: Vec3, b: Vec3, ridge: Ridge): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const rx = ridge.x2 - ridge.x1;
  const ry = ridge.y2 - ridge.y1;
  const denom = dx * ry - dy * rx;
  if (denom === 0) return false; // parallel — treat a grazing line as clear
  const t = ((ridge.x1 - a.x) * ry - (ridge.y1 - a.y) * rx) / denom; // along a→b
  const u = ((ridge.x1 - a.x) * dy - (ridge.y1 - a.y) * dx) / denom; // along ridge
  if (t <= 0 || t >= 1 || u < 0 || u > 1) return false;
  const losAlt = a.alt + (b.alt - a.alt) * t;
  return losAlt < ridge.height;
}

/** True when any ridge masks the sight line between the two positions. */
export function losBlocked(a: Vec3, b: Vec3, ridges: Ridge[] | undefined): boolean {
  if (!ridges || ridges.length === 0) return false;
  return ridges.some((r) => losBlockedByRidge(a, b, r));
}

/** Step `from` toward `to` by at most `maxDist`, returning the new position. */
export function stepToward(from: Vec3, to: Vec3, maxDist: number): Vec3 {
  const d = dist3d(from, to);
  if (d <= maxDist || d === 0) return { ...to };
  const t = maxDist / d;
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    alt: from.alt + (to.alt - from.alt) * t,
  };
}
