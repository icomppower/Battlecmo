import type { SimState, Unit } from '../core/types';
import { terrainHeightAt } from '../core/terrain';
import { ROMSDAL } from '../terrain/index';
import { WEAPONS } from './strike-basic';

/**
 * First real-geography mission: the Romsdal coast of Norway, on the baked
 * SRTM heightfield the sim's LOS model now consults (`terrainId: 'romsdal'`).
 *
 * RED sites the way an IADS actually would on this ground: the early-warning
 * radar on a 972 m coastal summit with a clean sweep of the seaward
 * approaches, the SAM battery and the C2 objective on the fjord-head flats
 * below it. The geometry is not authored — it is Norway:
 *
 *  - a high ingress over the sea is seen ~100 km out;
 *  - Romsdalsfjorden's outer arm is a REAL radar-shadow corridor at 120 m —
 *    the probe BFS found it in the elevation data, and it ends 28 km from
 *    the fjord head, inside AGM release range, masked from BOTH radars;
 *  - engagement floors are height-over-ground now, so the corridor stays
 *    honest: 120 m over the water is 120 m AGL — the SAM could engage if it
 *    ever got a track. Terrain denies the track, not the shot.
 */
export function buildFjordScenario(): SimState {
  const units: Record<string, Unit> = {};
  const elev = (x: number, y: number) => terrainHeightAt(ROMSDAL, x, y);

  // ---- RED: sited on real ground ----
  units['red-ew-1'] = {
    id: 'red-ew-1',
    side: 'RED',
    name: 'Summit EW radar',
    domain: 'GROUND',
    pos: { x: 1_000, y: 8_000, alt: elev(1_000, 8_000) + 15 },
    speed: 0,
    maxSpeed: 0,
    rcs: 15,
    sensors: [{ id: 'ews', kind: 'RADAR', baseRange: 150_000, refRcs: 5, emitting: true }],
    weapons: [],
    emitterDoctrine: { armReactionRange: 12_000, shutdownTicks: 240 },
    waypoints: [],
    alive: true,
  };

  units['red-sam-1'] = {
    id: 'red-sam-1',
    side: 'RED',
    name: 'SA-31 battery (fjord head)',
    domain: 'GROUND',
    pos: { x: 2_000, y: -2_000, alt: elev(2_000, -2_000) + 5 },
    speed: 0,
    maxSpeed: 0,
    rcs: 15,
    sensors: [{ id: 'fcr', kind: 'RADAR', baseRange: 90_000, refRcs: 5, emitting: false }],
    weapons: [{ weaponId: 'sam-longbow', count: 6 }],
    maxConcurrentEngagements: 2,
    samDoctrine: { emcon: 'CUED', cueRange: 36_000, coldAfterTicks: 30 },
    emitterDoctrine: { armReactionRange: 15_000, shutdownTicks: 240, shutdownDecay: 0.5, minShutdownTicks: 45 },
    waypoints: [],
    alive: true,
  };

  units['red-hq'] = {
    id: 'red-hq',
    side: 'RED',
    name: 'C2 node (objective)',
    domain: 'GROUND',
    pos: { x: 2_500, y: -2_000, alt: elev(2_500, -2_000) },
    speed: 0,
    maxSpeed: 0,
    rcs: 25,
    sensors: [],
    weapons: [],
    waypoints: [],
    alive: true,
  };

  // ---- BLUE: a two-ship low over the outer fjord, holding in the shadow ----
  for (const [n, x, y] of [
    ['1', -52_000, 10_000],
    ['2', -52_000, 12_000],
  ] as const) {
    units[`blue-striker-${n}`] = {
      id: `blue-striker-${n}`,
      side: 'BLUE',
      name: `Hammer ${n}`,
      domain: 'AIR',
      pos: { x, y, alt: 120 },
      speed: 250,
      maxSpeed: 300,
      rcs: 3,
      sensors: [],
      weapons: [{ weaponId: 'agm-stormbreak', count: 2 }],
      fuelKg: 5_200,
      burnKgPerTick: 1.3,
      bingoKg: 1_800,
      homeBase: { x: -140_000, y: 10_000, alt: 0 },
      waypoints: [],
      alive: true,
    };
  }

  return {
    tick: 0,
    units,
    missiles: {},
    contacts: { BLUE: {}, RED: {} },
    roe: { BLUE: 'HOLD', RED: 'FREE' },
    prebriefedTargets: { BLUE: ['red-ew-1', 'red-sam-1', 'red-hq'], RED: [] },
    events: [],
    nextEntitySeq: 1,
    weaponCatalog: WEAPONS,
    terrainId: 'romsdal',
    intel: {
      'red-ew-1': {
        unitId: 'red-ew-1',
        confidence: 'VERIFIED',
        briefedPos: { x: 1_000, y: 8_000, alt: elev(1_000, 8_000) + 15 },
        note: 'Summit site — sweeps the whole seaward approach. Do not come in high.',
      },
      'red-sam-1': {
        unitId: 'red-sam-1',
        confidence: 'VERIFIED',
        briefedPos: { x: 2_000, y: -2_000, alt: elev(2_000, -2_000) + 5 },
        note: 'Battery on the fjord-head flats, radar cold until cued.',
      },
      'red-hq': {
        unitId: 'red-hq',
        confidence: 'VERIFIED',
        briefedPos: { x: 2_500, y: -2_000, alt: elev(2_500, -2_000) },
        note: 'The objective. The fjord is the only quiet way in.',
      },
    },
  };
}
