import type { SimState, Unit, WeaponDef } from '../core/types';

/**
 * DEMO / SHOWCASE SCENARIO — fictional, hypothetical contingency. This is not
 * a nemesis-balanced mission: there is no adaptive doctrine, no proven
 * losing plan, and no counter-adaptation choreography. It exists to give a
 * satisfying "watch it resolve" naval strike, reusing the same catalog
 * shapes (SAM rings, ASM/ARM weapons, ship hulls) as strike-convoy.ts and
 * strike-escalation.ts.
 *
 * Premise (entirely invented, no relation to any real order of battle,
 * doctrine, or current-events posture): a BLUE strike package pushes into a
 * generic strait chokepoint against a screen of two PLA-Navy-analog
 * corvettes flanking a PLA-Navy-analog frigate. Every RED radar is left in
 * ACTIVE emcon (no CUED cleverness, no shoot-and-scoot) — the point is to
 * showcase the SEAD → strike choreography clearly, not to pose a puzzle.
 *
 * Target set: all three hulls (each hull IS its own escort SAM/radar site —
 * the fire-control radar and the SAM battery are shipboard). asm-pike's
 * 80 km reach outranges every SAM ring here (corvette 20 km, frigate 34 km),
 * so a disciplined standoff shot never has to enter an engagement envelope
 * at all; arm-triton (60 km) gives a SEAD option for a closer, more
 * aggressive profile when a plan wants one. Either approach clears the
 * target set cleanly — this is a demo, not an adversarial proof.
 */

export const NEW_WEAPONS: Record<string, WeaponDef> = {
  // Anti-ship missile — identical to oob/assembly.ts's STORE_WEAPONS entry
  // (kept as an independent copy: each scenario's catalog is self-contained
  // inline data, per the project's scenario-authoring convention).
  'asm-pike': {
    id: 'asm-pike',
    name: 'ASM-12 Pike',
    kind: 'ASM',
    minRange: 8_000,
    maxRange: 80_000,
    minTargetAlt: 0,
    maxTargetAlt: 60,
    speed: 250,
    pk: 0.8,
    targetDomains: ['SEA'],
  },
  // Anti-ship SEAD — identical shape to strike-convoy.ts's arm-triton:
  // outranges both naval SAM rings below, so the SEAD shot is fired from
  // total safety, same choreography as the land-IADS ARM.
  'arm-triton': {
    id: 'arm-triton',
    name: 'ARM-14 Triton (anti-ship SEAD)',
    kind: 'ARM',
    minRange: 5_000,
    maxRange: 60_000,
    minTargetAlt: 0,
    maxTargetAlt: 60,
    speed: 600,
    pk: 0.7,
    targetDomains: ['SEA'],
    antiRadiation: true,
  },
  // Frigate-class area SAM (PLA-analog HHQ-16 reskin of sam-bastion's shape).
  'sam-hhq16': {
    id: 'sam-hhq16',
    name: 'HHQ-16-analog area SAM',
    kind: 'SAM',
    minRange: 2_000,
    maxRange: 34_000,
    minTargetAlt: 20, // generous floor — no low-altitude trickery needed
    maxTargetAlt: 10_000,
    speed: 750,
    pk: 0.6,
    targetDomains: ['AIR'],
    requiredTrackQuality: 0.5,
  },
  // Corvette-class point-defense SAM (PLA-analog HHQ-10 reskin of
  // sam-palisade's shape) — shorter ring, forward picket layer.
  'sam-hhq10': {
    id: 'sam-hhq10',
    name: 'HHQ-10-analog point SAM',
    kind: 'SAM',
    minRange: 1_500,
    maxRange: 20_000,
    minTargetAlt: 20,
    maxTargetAlt: 8_000,
    speed: 700,
    pk: 0.55,
    targetDomains: ['AIR'],
    requiredTrackQuality: 0.5,
  },
};

function aircraft(partial: Omit<Unit, 'alive' | 'domain'>): Unit {
  return { ...partial, domain: 'AIR', alive: true };
}

/**
 * Taiwan Strait — PLA ship strike + SEAD (fictional/hypothetical demo).
 *
 * RED sails a shallow wedge: two corvettes forward as a picket screen, the
 * frigate behind them with the longer-legged SAM ring. Every radar is
 * ACTIVE emcon by scenario design (softened defenses — see module doc).
 */
export function buildTaiwanStrikeScenario(): SimState {
  const units: Record<string, Unit> = {};

  // ---- RED: PLA-Navy-analog surface action group ----
  units['red-corvette-1'] = {
    id: 'red-corvette-1',
    side: 'RED',
    domain: 'SEA',
    name: 'Hostile corvette (forward, south)',
    pos: { x: -15_000, y: -9_000, alt: 12 }, // mast-height sensors
    speed: 5,
    maxSpeed: 15,
    rcs: 180,
    sensors: [{ id: 'search-radar', kind: 'RADAR', baseRange: 60_000, refRcs: 5, emitting: true }],
    weapons: [{ weaponId: 'sam-hhq10', count: 6 }],
    maxConcurrentEngagements: 2,
    samDoctrine: { emcon: 'ACTIVE' }, // always radiating — softened, no CUED cleverness
    emitterDoctrine: { armReactionRange: 12_000, shutdownTicks: 220 },
    waypoints: [
      { x: -13_000, y: -10_500, alt: 12 },
      { x: -16_000, y: -7_500, alt: 12 },
    ],
    alive: true,
  };

  units['red-corvette-2'] = {
    id: 'red-corvette-2',
    side: 'RED',
    domain: 'SEA',
    name: 'Hostile corvette (forward, north)',
    pos: { x: -15_000, y: 9_000, alt: 12 },
    speed: 5,
    maxSpeed: 15,
    rcs: 180,
    sensors: [{ id: 'search-radar', kind: 'RADAR', baseRange: 60_000, refRcs: 5, emitting: true }],
    weapons: [{ weaponId: 'sam-hhq10', count: 6 }],
    maxConcurrentEngagements: 2,
    samDoctrine: { emcon: 'ACTIVE' },
    emitterDoctrine: { armReactionRange: 12_000, shutdownTicks: 220 },
    waypoints: [
      { x: -13_000, y: 10_500, alt: 12 },
      { x: -16_000, y: 7_500, alt: 12 },
    ],
    alive: true,
  };

  units['red-frigate-1'] = {
    id: 'red-frigate-1',
    side: 'RED',
    domain: 'SEA',
    name: 'Hostile frigate (screen commander)',
    pos: { x: 0, y: 0, alt: 14 },
    speed: 4,
    maxSpeed: 16,
    rcs: 220,
    sensors: [{ id: 'search-radar', kind: 'RADAR', baseRange: 70_000, refRcs: 5, emitting: true }],
    weapons: [{ weaponId: 'sam-hhq16', count: 8 }],
    maxConcurrentEngagements: 2,
    samDoctrine: { emcon: 'ACTIVE' },
    emitterDoctrine: { armReactionRange: 14_000, shutdownTicks: 240 },
    waypoints: [
      { x: 2_000, y: -1_500, alt: 14 },
      { x: -1_500, y: 1_500, alt: 14 },
    ],
    alive: true,
  };

  // ---- BLUE: strike package staged west, one striker per hull, one SEAD ----
  const homeBase = { x: -160_000, y: 0, alt: 0 };

  units['blue-striker-1'] = aircraft({
    id: 'blue-striker-1',
    side: 'BLUE',
    name: 'Hammer 1 (vs. corvette south)',
    pos: { x: -140_000, y: -9_000, alt: 8_000 },
    speed: 250,
    maxSpeed: 300,
    rcs: 3,
    sensors: [],
    weapons: [{ weaponId: 'asm-pike', count: 2 }],
    fuelKg: 5_200,
    burnKgPerTick: 1.3,
    bingoKg: 1_800,
    homeBase: { ...homeBase },
    waypoints: [],
  });

  units['blue-striker-2'] = aircraft({
    id: 'blue-striker-2',
    side: 'BLUE',
    name: 'Hammer 2 (vs. corvette north)',
    pos: { x: -140_000, y: 9_000, alt: 8_000 },
    speed: 250,
    maxSpeed: 300,
    rcs: 3,
    sensors: [],
    weapons: [{ weaponId: 'asm-pike', count: 2 }],
    fuelKg: 5_200,
    burnKgPerTick: 1.3,
    bingoKg: 1_800,
    homeBase: { ...homeBase },
    waypoints: [],
  });

  units['blue-striker-3'] = aircraft({
    id: 'blue-striker-3',
    side: 'BLUE',
    name: 'Hammer 3 (vs. frigate)',
    pos: { x: -140_000, y: 0, alt: 8_000 },
    speed: 250,
    maxSpeed: 300,
    rcs: 3,
    sensors: [],
    // One extra round over the corvette shooters — the frigate is the
    // toughest hull in the screen and gets a third redundant shot.
    weapons: [{ weaponId: 'asm-pike', count: 3 }],
    fuelKg: 5_200,
    burnKgPerTick: 1.3,
    bingoKg: 1_800,
    homeBase: { ...homeBase },
    waypoints: [],
  });

  units['blue-sead-1'] = aircraft({
    id: 'blue-sead-1',
    side: 'BLUE',
    name: 'Viper (anti-ship SEAD)',
    pos: { x: -140_000, y: 4_000, alt: 9_000 },
    speed: 250,
    maxSpeed: 300,
    rcs: 3,
    sensors: [],
    weapons: [{ weaponId: 'arm-triton', count: 3 }],
    fuelKg: 5_200,
    burnKgPerTick: 1.3,
    bingoKg: 1_800,
    homeBase: { ...homeBase },
    waypoints: [],
  });

  return {
    tick: 0,
    units,
    missiles: {},
    contacts: { BLUE: {}, RED: {} },
    roe: { BLUE: 'HOLD', RED: 'FREE' },
    prebriefedTargets: {
      BLUE: ['red-corvette-1', 'red-corvette-2', 'red-frigate-1'],
      RED: [],
    },
    events: [],
    nextEntitySeq: 1,
    weaponCatalog: NEW_WEAPONS,
    intel: {
      'red-corvette-1': {
        unitId: 'red-corvette-1',
        confidence: 'VERIFIED',
        briefedPos: { x: -15_000, y: -9_000, alt: 12 },
        note: 'Forward picket, south flank. Continuous search radar, HHQ-10-analog point SAM.',
      },
      'red-corvette-2': {
        unitId: 'red-corvette-2',
        confidence: 'VERIFIED',
        briefedPos: { x: -15_000, y: 9_000, alt: 12 },
        note: 'Forward picket, north flank. Continuous search radar, HHQ-10-analog point SAM.',
      },
      'red-frigate-1': {
        unitId: 'red-frigate-1',
        confidence: 'VERIFIED',
        briefedPos: { x: 0, y: 0, alt: 14 },
        note: 'Screen commander. Longest-legged SAM ring of the three (HHQ-16-analog, 34 km).',
      },
    },
  };
}
