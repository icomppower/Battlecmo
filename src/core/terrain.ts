import type { SimState, Unit, Vec3 } from './types';

/**
 * Heightfield terrain — the real-geography successor to the ridge-segment
 * abstraction, with the same contract: deterministic geometry every sensor
 * check consults, knowable in the planning layer.
 *
 * The heightfield itself is IMMUTABLE STATIC DATA and lives in a module
 * registry, not in SimState — states carry only a `terrainId` string, so the
 * WEGO timeline's per-tick clones stay cheap and replay stays byte-exact
 * (the terrain is part of the program, like the weapon catalog code).
 *
 * Altitude semantics with terrain: `pos.alt` is ABSOLUTE (MSL) everywhere.
 * Flat scenarios have ground level 0, so nothing changes for them; terrain
 * scenarios get `aglOf` for the checks that doctrinally mean height OVER THE
 * GROUND — weapon engagement floors, SAM cue floors, CAP commit floors.
 */

export interface Heightfield {
  name: string;
  /** World coordinates of the grid's south-west corner. */
  originX: number;
  originY: number;
  /** Meters between grid points. */
  cellSize: number;
  width: number;
  height: number;
  /** Row-major heights in meters; rows advance north (+y). */
  data: Int16Array | number[];
}

const REGISTRY = new Map<string, Heightfield>();

export function registerTerrain(hf: Heightfield): void {
  REGISTRY.set(hf.name, hf);
}

export function getTerrain(id: string | undefined): Heightfield | null {
  return (id && REGISTRY.get(id)) || null;
}

/** Ground elevation at a world point, bilinear; flat sea (0) beyond the map. */
export function terrainHeightAt(hf: Heightfield, x: number, y: number): number {
  const gx = (x - hf.originX) / hf.cellSize;
  const gy = (y - hf.originY) / hf.cellSize;
  if (gx < 0 || gy < 0 || gx > hf.width - 1 || gy > hf.height - 1) return 0;
  const x0 = Math.min(hf.width - 2, Math.floor(gx));
  const y0 = Math.min(hf.height - 2, Math.floor(gy));
  const fx = gx - x0;
  const fy = gy - y0;
  const i = y0 * hf.width + x0;
  const h00 = hf.data[i]!;
  const h10 = hf.data[i + 1]!;
  const h01 = hf.data[i + hf.width]!;
  const h11 = hf.data[i + hf.width + 1]!;
  return h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
}

/**
 * Ray-marched line of sight: blocked when the terrain rises above the
 * straight sight line anywhere strictly between the endpoints. Sampling at
 * half the cell size cannot miss a grid-resolvable crest; endpoint margins
 * keep a unit from being masked by the hill it is standing on.
 */
export function losBlockedByTerrain(a: Vec3, b: Vec3, hf: Heightfield): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const step = hf.cellSize / 2;
  if (dist <= step * 2) return false;
  const margin = step; // don't self-intersect the terrain underfoot
  for (let s = margin; s <= dist - margin; s += step) {
    const t = s / dist;
    const losAlt = a.alt + (b.alt - a.alt) * t;
    if (terrainHeightAt(hf, a.x + dx * t, a.y + dy * t) > losAlt + 1) return true;
  }
  return false;
}

/** Ground elevation under a state's world point (0 when the mission is flat). */
export function groundLevelAt(state: SimState, x: number, y: number): number {
  const hf = getTerrain(state.terrainId);
  return hf ? terrainHeightAt(hf, x, y) : 0;
}

/** Height over ground — what engagement floors and cue floors actually mean. */
export function aglOf(state: SimState, unit: Unit): number {
  return unit.pos.alt - groundLevelAt(state, unit.pos.x, unit.pos.y);
}
