import type { SimState, Unit, WeaponDef } from '../core/types';

/**
 * Reference scenario for the headless core (Build Order step 1):
 * one BLUE strike package against a static RED integrated air defense.
 *
 *   RED  — an early-warning radar, a long-range SAM battery, and the
 *          objective (a hardened C2 node adjacent to the SAM ring).
 *   BLUE — two strikers with standoff AGMs, one SEAD shooter with
 *          anti-radiation missiles, and one standoff jammer.
 *
 * The geometry is built so the AGM launch ring (30 km around the target)
 * sits *inside* the SAM engagement ring (40 km around the battery): the
 * strikers cannot reach a release point without entering the threat ring,
 * so the mission only works if the jamming window and SEAD shot open a
 * suppression corridor first. Sensors before shooters.
 */

export const WEAPONS: Record<string, WeaponDef> = {
  'agm-stormbreak': {
    id: 'agm-stormbreak',
    name: 'AGM-77 Stormbreak',
    kind: 'AGM',
    minRange: 2_000,
    maxRange: 30_000,
    minTargetAlt: 0,
    maxTargetAlt: 100,
    speed: 300,
    pk: 0.85,
    targetDomains: ['GROUND'],
  },
  'arm-lance': {
    id: 'arm-lance',
    name: 'ARM-9 Lance',
    kind: 'ARM',
    minRange: 5_000,
    maxRange: 70_000,
    minTargetAlt: 0,
    maxTargetAlt: 100,
    speed: 600,
    pk: 0.75,
    targetDomains: ['GROUND'],
    antiRadiation: true,
  },
  'sam-longbow': {
    id: 'sam-longbow',
    name: 'SA-31 Longbow',
    kind: 'SAM',
    minRange: 3_000,
    maxRange: 40_000,
    minTargetAlt: 100,
    maxTargetAlt: 20_000,
    speed: 800,
    pk: 0.7,
    targetDomains: ['AIR'],
    requiredTrackQuality: 0.5,
  },
};

function aircraft(partial: Omit<Unit, 'alive' | 'domain'>): Unit {
  return { ...partial, domain: 'AIR', alive: true };
}

function groundUnit(partial: Omit<Unit, 'alive' | 'domain' | 'speed' | 'maxSpeed' | 'waypoints'>): Unit {
  return { ...partial, domain: 'GROUND', speed: 0, maxSpeed: 0, waypoints: [], alive: true };
}

export function buildStrikeScenario(): SimState {
  const units: Record<string, Unit> = {};

  // ---- RED integrated air defense ----
  units['red-sam-1'] = groundUnit({
    id: 'red-sam-1',
    side: 'RED',
    name: 'SA-31 battery',
    pos: { x: 0, y: 0, alt: 5 },
    rcs: 15,
    sensors: [{ id: 'fcr', kind: 'RADAR', baseRange: 90_000, refRcs: 5, emitting: true }],
    weapons: [{ weaponId: 'sam-longbow', count: 6 }],
    maxConcurrentEngagements: 2,
    emitterDoctrine: { armReactionRange: 15_000, shutdownTicks: 240 },
  });

  units['red-ew-1'] = groundUnit({
    id: 'red-ew-1',
    side: 'RED',
    name: 'Early-warning radar',
    pos: { x: 0, y: 8_000, alt: 10 },
    rcs: 15,
    sensors: [{ id: 'ews', kind: 'RADAR', baseRange: 150_000, refRcs: 5, emitting: true }],
    weapons: [],
    emitterDoctrine: { armReactionRange: 12_000, shutdownTicks: 240 },
  });

  units['red-hq'] = groundUnit({
    id: 'red-hq',
    side: 'RED',
    name: 'C2 node (objective)',
    pos: { x: 2_000, y: 0, alt: 0 },
    rcs: 25,
    sensors: [],
    weapons: [],
  });

  // ---- BLUE strike package, ingressing from the west ----
  const strikerBase = { x: -160_000, y: 0, alt: 0 };
  for (const [n, y] of [
    ['1', -3_000],
    ['2', 3_000],
  ] as const) {
    units[`blue-striker-${n}`] = aircraft({
      id: `blue-striker-${n}`,
      side: 'BLUE',
      name: `Hammer ${n}`,
      pos: { x: -140_000, y, alt: 8_000 },
      speed: 250,
      maxSpeed: 300,
      rcs: 3,
      sensors: [],
      weapons: [{ weaponId: 'agm-stormbreak', count: 2 }],
      fuelKg: 5_200,
      burnKgPerTick: 1.3,
      bingoKg: 1_800,
      homeBase: { ...strikerBase },
      waypoints: [],
    });
  }

  units['blue-sead-1'] = aircraft({
    id: 'blue-sead-1',
    side: 'BLUE',
    name: 'Viper (SEAD)',
    pos: { x: -140_000, y: 2_000, alt: 9_000 },
    speed: 250,
    maxSpeed: 300,
    rcs: 3,
    sensors: [],
    weapons: [{ weaponId: 'arm-lance', count: 2 }],
    fuelKg: 5_200,
    burnKgPerTick: 1.3,
    bingoKg: 1_800,
    homeBase: { ...strikerBase },
    waypoints: [],
  });

  units['blue-ea-1'] = aircraft({
    id: 'blue-ea-1',
    side: 'BLUE',
    name: 'Static (EW)',
    pos: { x: -110_000, y: 12_000, alt: 10_000 },
    speed: 0,
    maxSpeed: 250,
    rcs: 8,
    sensors: [],
    weapons: [],
    jammer: { range: 130_000, strength: 0.65, active: false },
    fuelKg: 8_000,
    burnKgPerTick: 1.0,
    bingoKg: 2_500,
    homeBase: { ...strikerBase },
    waypoints: [],
  });

  return {
    tick: 0,
    units,
    missiles: {},
    contacts: { BLUE: {}, RED: {} },
    roe: { BLUE: 'HOLD', RED: 'FREE' },
    // Intel dossier: the briefed IADS order of battle — these are the only
    // targets BLUE may strike under TIGHT ROE.
    prebriefedTargets: { BLUE: ['red-sam-1', 'red-ew-1', 'red-hq'], RED: [] },
    events: [],
    nextEntitySeq: 1,
    weaponCatalog: WEAPONS,
    // Confidence-graded dossier: everything in this mission is well imaged.
    intel: {
      'red-sam-1': {
        unitId: 'red-sam-1',
        confidence: 'VERIFIED',
        briefedPos: { x: 0, y: 0, alt: 5 },
        note: 'Fixed site, imaged on three consecutive passes.',
      },
      'red-ew-1': {
        unitId: 'red-ew-1',
        confidence: 'VERIFIED',
        briefedPos: { x: 0, y: 8_000, alt: 10 },
        note: 'Continuous emitter — ELINT fix is solid.',
      },
      'red-hq': {
        unitId: 'red-hq',
        confidence: 'VERIFIED',
        briefedPos: { x: 2_000, y: 0, alt: 0 },
        note: 'Hardened C2 node. The objective.',
      },
    },
  };
}
