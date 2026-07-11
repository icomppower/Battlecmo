import type { SimState, Unit, WeaponDef } from '../core/types';
import { WEAPONS } from './strike-basic';

/**
 * Operation Epic Fury — a demo/showcase scenario, not a competitive one.
 *
 * DOCUMENTARY FRAMING: this is a historical-reconstruction-style mission —
 * the same treatment this project already gives real battles (see
 * strike-fjord's Romsdal terrain reconstruction). Target framing stays at
 * the FACILITY/SITE level throughout — a leadership site, a nuclear-related
 * facility, ballistic-missile infrastructure, air-defense/radar sites, and
 * naval targets — never a named individual as a personal objective. The
 * intel dossier below carries the same VERIFIED/APPROX/CONTESTED confidence
 * grading the rest of the codebase uses (see strike-escalation.ts): asset
 * counts and site locations drawn from public reporting are graded, not
 * presented as flatly certain. This is a simulation of military assets and
 * tactics — not a scenario about political outcomes or any leadership
 * figures as characters.
 *
 * THIS IS A DEMO, NOT A PUZZLE: no adversarial balance, no nemesis, no
 * losing reference plan. Defenses are deliberately softened for a
 * satisfying watch-it-resolve run:
 *  - every SAM (land and naval) is `samDoctrine.emcon: 'ACTIVE'` — it
 *    radiates continuously, never goes CUED/cold, never shoots-and-scoots.
 *  - the suppression window on the land IADS site is generous (500 ticks)
 *    so a single reactive SEAD shot comfortably covers a full strike
 *    package's dash-and-release, with no adaptive crew learning.
 *
 * Order of battle:
 *  RED (facility/site target set — "full clear" = all of these destroyed):
 *   - red-sam-1        air-defense/radar site (the IADS's only battery)
 *   - red-leadership-site  leadership site (APPROX — public-reporting fix)
 *   - red-nuclear-1    nuclear-related facility (VERIFIED — imaged)
 *   - red-missile-1    ballistic-missile infrastructure (APPROX)
 *   - red-corvette-1   naval target (VERIFIED)
 *   - red-frigate-1    naval target (VERIFIED)
 *
 *  BLUE (fixed roster; the three reference plans each lean on a different
 *  subset to reach the same full-clear outcome):
 *   - blue-arsenal-1   Tomahawk-analog cruise-missile shooter (SEA), long
 *                      stand-off, subsonic flight (many ticks to arrive —
 *                      this is *why* the run is long).
 *   - blue-bomber-1/2  B-2-analog very-low-RCS heavy strike aircraft —
 *                      af-ranger (the existing strike airframe, cleanRcs 2,
 *                      see oob/assembly.ts) is the lowest-RCS STRIKE-role
 *                      jet in the catalog; this is a clone at an order of
 *                      magnitude lower RCS (0.15) with a heavier payload and
 *                      a much longer fuel/loiter budget — the "heavy bomber"
 *                      flavor the design doc asks for.
 *   - blue-striker-1/2 F-35/F-18-analog strike aircraft (the existing
 *                      strike-jet roster: rcs 3, 250-300 m/s).
 *   - blue-drone-1     one-way attack drone: cheap, slow, one guided
 *                      weapon station. No `decoy: true` — that flag is a
 *                      truth/debrief marker the sim never reads (see
 *                      types.ts); this drone is lethal through the ordinary
 *                      airframe + weapon-station + ENGAGE machinery, ridden
 *                      the same way a decoy would ride it, just for real.
 *   - blue-sead-1      SEAD/naval-strike jet: land ARM + naval standoff ASM.
 */

const NUCLEAR_TARGET_ALT = { min: 0, max: 100 };

export const EPICFURY_WEAPONS: Record<string, WeaponDef> = {
  // Tomahawk-analog: a pre-briefed GROUND shot, exactly like agm-stormbreak
  // or gun-mk45 — no requiredTrackQuality, because it is not a tracked
  // intercept, it is a standoff strike on a fixed DMPI. `inEnvelope` (see
  // core/weapons.ts) only ever checks range / altitude band / domain, never
  // line-of-sight, so a 1200 km stand-off range needs zero engine changes —
  // it is pure data, same as every other weapon in this catalog.
  'tlam-blk5': {
    id: 'tlam-blk5',
    name: 'BGM-Analog Blk V (subsonic cruise missile)',
    kind: 'AGM',
    minRange: 5_000,
    maxRange: 1_200_000, // ~1200 km stand-off
    minTargetAlt: NUCLEAR_TARGET_ALT.min,
    maxTargetAlt: NUCLEAR_TARGET_ALT.max,
    speed: 240, // subsonic, ~mach 0.7 — many ticks to arrive from stand-off
    pk: 0.85,
    targetDomains: ['GROUND'],
  },
  // Long-range anti-ship standoff missile: its 90 km reach outranges both
  // ships' self-defense SAM ring (25 km) outright, so sinking either naval
  // target needs no SEAD dance at all — a deliberate softening for the demo.
  'asm-standoff': {
    id: 'asm-standoff',
    name: 'ASM-14 Standoff',
    kind: 'ASM',
    minRange: 5_000,
    maxRange: 90_000,
    minTargetAlt: 0,
    maxTargetAlt: 60,
    speed: 260,
    pk: 0.82,
    targetDomains: ['SEA'],
  },
  // Naval self-defense SAM ring, softened (ACTIVE, no adaptive doctrine) —
  // shorter than asm-standoff by design, so it never gets a shot at the
  // shooter.
  'sam-seaguard': {
    id: 'sam-seaguard',
    name: 'SA-N-11 Seaguard (naval)',
    kind: 'SAM',
    minRange: 1_500,
    maxRange: 25_000,
    minTargetAlt: 20,
    maxTargetAlt: 10_000,
    speed: 700,
    pk: 0.6,
    targetDomains: ['AIR'],
    requiredTrackQuality: 0.5,
  },
};

function aircraft(partial: Omit<Unit, 'alive' | 'domain'>): Unit {
  return { ...partial, domain: 'AIR', alive: true };
}

function groundSite(partial: Omit<Unit, 'alive' | 'domain' | 'speed' | 'maxSpeed' | 'waypoints'>): Unit {
  return { ...partial, domain: 'GROUND', speed: 0, maxSpeed: 0, waypoints: [], alive: true };
}

export function buildEpicFuryScenario(): SimState {
  const units: Record<string, Unit> = {};
  const weaponCatalog: Record<string, WeaponDef> = { ...WEAPONS, ...EPICFURY_WEAPONS };

  // ---- RED: the facility/site target set ----
  units['red-sam-1'] = groundSite({
    id: 'red-sam-1',
    side: 'RED',
    name: 'Air-defense/radar site',
    pos: { x: 30_000, y: 0, alt: 5 },
    rcs: 15,
    sensors: [{ id: 'fcr', kind: 'RADAR', baseRange: 90_000, refRcs: 5, emitting: true }],
    weapons: [{ weaponId: 'sam-longbow', count: 8 }],
    maxConcurrentEngagements: 2,
    // Softened for the demo: ACTIVE (always radiating), and a wide
    // suppression window with no crew adaptation.
    samDoctrine: { emcon: 'ACTIVE' },
    emitterDoctrine: { armReactionRange: 15_000, shutdownTicks: 500 },
  });

  units['red-leadership-site'] = groundSite({
    id: 'red-leadership-site',
    side: 'RED',
    name: 'Leadership site',
    pos: { x: 34_000, y: -4_000, alt: 0 },
    rcs: 25,
    sensors: [],
    weapons: [],
  });

  units['red-nuclear-1'] = groundSite({
    id: 'red-nuclear-1',
    side: 'RED',
    name: 'Nuclear-related facility',
    pos: { x: 28_000, y: 5_000, alt: 0 },
    rcs: 30,
    sensors: [],
    weapons: [],
  });

  units['red-missile-1'] = groundSite({
    id: 'red-missile-1',
    side: 'RED',
    name: 'Ballistic-missile infrastructure',
    pos: { x: 36_000, y: 6_000, alt: 0 },
    rcs: 25,
    sensors: [],
    weapons: [],
  });

  units['red-corvette-1'] = {
    id: 'red-corvette-1',
    side: 'RED',
    domain: 'SEA',
    name: 'Naval target (corvette analog)',
    pos: { x: 15_000, y: 25_000, alt: 12 },
    speed: 4,
    maxSpeed: 14,
    rcs: 180,
    sensors: [{ id: 'search-radar', kind: 'RADAR', baseRange: 80_000, refRcs: 5, emitting: true }],
    weapons: [{ weaponId: 'sam-seaguard', count: 6 }],
    maxConcurrentEngagements: 1,
    samDoctrine: { emcon: 'ACTIVE' },
    waypoints: [],
    alive: true,
  };

  units['red-frigate-1'] = {
    id: 'red-frigate-1',
    side: 'RED',
    domain: 'SEA',
    name: 'Naval target (frigate analog)',
    pos: { x: 12_000, y: -25_000, alt: 14 },
    speed: 4,
    maxSpeed: 14,
    rcs: 220,
    sensors: [{ id: 'search-radar', kind: 'RADAR', baseRange: 80_000, refRcs: 5, emitting: true }],
    weapons: [{ weaponId: 'sam-seaguard', count: 6 }],
    maxConcurrentEngagements: 1,
    samDoctrine: { emcon: 'ACTIVE' },
    waypoints: [],
    alive: true,
  };

  // ---- BLUE: fixed roster, held at safe stand-off (outside every RED
  // engagement ring at mission start) — the three reference plans decide
  // who dashes in, when, and against which DMPI. ----

  units['blue-arsenal-1'] = {
    id: 'blue-arsenal-1',
    side: 'BLUE',
    domain: 'SEA',
    name: 'Trident (VLS strike ship)',
    pos: { x: -150_000, y: 0, alt: 12 },
    speed: 0,
    maxSpeed: 10,
    rcs: 300,
    sensors: [],
    weapons: [{ weaponId: 'tlam-blk5', count: 10 }],
    waypoints: [],
    alive: true,
  };

  units['blue-bomber-1'] = aircraft({
    id: 'blue-bomber-1',
    side: 'BLUE',
    name: 'Raider 1 (heavy bomber)',
    pos: { x: -20_000, y: 5_500, alt: 11_000 },
    speed: 220,
    maxSpeed: 260,
    rcs: 0.15, // an order of magnitude under af-ranger's 2 m² clean RCS
    sensors: [],
    weapons: [{ weaponId: 'agm-stormbreak', count: 4 }],
    fuelKg: 14_000,
    burnKgPerTick: 0.9,
    bingoKg: 3_500,
    homeBase: { x: -170_000, y: 5_500, alt: 11_000 },
    waypoints: [],
  });

  units['blue-bomber-2'] = aircraft({
    id: 'blue-bomber-2',
    side: 'BLUE',
    name: 'Raider 2 (heavy bomber)',
    pos: { x: -20_000, y: -5_500, alt: 11_000 },
    speed: 220,
    maxSpeed: 260,
    rcs: 0.15,
    sensors: [],
    weapons: [{ weaponId: 'agm-stormbreak', count: 4 }],
    fuelKg: 14_000,
    burnKgPerTick: 0.9,
    bingoKg: 3_500,
    homeBase: { x: -170_000, y: -5_500, alt: 11_000 },
    waypoints: [],
  });

  units['blue-striker-1'] = aircraft({
    id: 'blue-striker-1',
    side: 'BLUE',
    name: 'Hammer 1',
    pos: { x: -20_000, y: 3_000, alt: 8_000 },
    speed: 250,
    maxSpeed: 300,
    rcs: 3,
    sensors: [],
    weapons: [{ weaponId: 'agm-stormbreak', count: 4 }],
    fuelKg: 5_200,
    burnKgPerTick: 1.3,
    bingoKg: 1_800,
    homeBase: { x: -160_000, y: 3_000, alt: 8_000 },
    waypoints: [],
  });

  units['blue-striker-2'] = aircraft({
    id: 'blue-striker-2',
    side: 'BLUE',
    name: 'Hammer 2',
    pos: { x: -20_000, y: -3_000, alt: 8_000 },
    speed: 250,
    maxSpeed: 300,
    rcs: 3,
    sensors: [],
    weapons: [{ weaponId: 'agm-stormbreak', count: 4 }],
    fuelKg: 5_200,
    burnKgPerTick: 1.3,
    bingoKg: 1_800,
    homeBase: { x: -160_000, y: -3_000, alt: 8_000 },
    waypoints: [],
  });

  // One-way attack drone: cheap, slow, one guided weapon station (a single
  // WeaponStation entry). Ordinary unit + ordinary ENGAGE order — no decoy
  // flag, no special-cased lethality.
  units['blue-drone-1'] = aircraft({
    id: 'blue-drone-1',
    side: 'BLUE',
    name: 'Reaper-One (one-way attack drone)',
    pos: { x: -20_000, y: 20_000, alt: 3_000 },
    speed: 120,
    maxSpeed: 140,
    rcs: 1.2,
    sensors: [],
    weapons: [{ weaponId: 'asm-standoff', count: 2 }],
    waypoints: [],
  });

  units['blue-sead-1'] = aircraft({
    id: 'blue-sead-1',
    side: 'BLUE',
    name: 'Viper (SEAD)',
    pos: { x: -20_000, y: 0, alt: 9_000 },
    speed: 250,
    maxSpeed: 300,
    rcs: 3,
    sensors: [],
    weapons: [
      { weaponId: 'arm-lance', count: 2 },
      { weaponId: 'asm-standoff', count: 2 },
    ],
    fuelKg: 5_200,
    burnKgPerTick: 1.3,
    bingoKg: 1_800,
    homeBase: { x: -160_000, y: 0, alt: 9_000 },
    waypoints: [],
  });

  return {
    tick: 0,
    units,
    missiles: {},
    contacts: { BLUE: {}, RED: {} },
    roe: { BLUE: 'HOLD', RED: 'FREE' },
    prebriefedTargets: {
      BLUE: [
        'red-sam-1',
        'red-leadership-site',
        'red-nuclear-1',
        'red-missile-1',
        'red-corvette-1',
        'red-frigate-1',
      ],
      RED: [],
    },
    events: [],
    nextEntitySeq: 1,
    weaponCatalog,
    // Confidence-graded intel dossier (documentary framing, not a puzzle):
    // VERIFIED where public reporting/imagery is solid, APPROX where the
    // site or its extent is real but the precise fix is uncertain. Facility
    // framing throughout — no named individuals.
    intel: {
      'red-sam-1': {
        unitId: 'red-sam-1',
        confidence: 'VERIFIED',
        briefedPos: { x: 30_000, y: 0, alt: 5 },
        note: 'The IADS’s only battery on this axis — continuous emitter, well imaged.',
      },
      'red-leadership-site': {
        unitId: 'red-leadership-site',
        confidence: 'APPROX',
        briefedPos: { x: 34_000, y: -4_000, alt: 0 },
        uncertaintyRadius: 3_000,
        note: 'Site fix drawn from public reporting; exact footprint and current use are not independently confirmed.',
      },
      'red-nuclear-1': {
        unitId: 'red-nuclear-1',
        confidence: 'VERIFIED',
        briefedPos: { x: 28_000, y: 5_000, alt: 0 },
        note: 'Nuclear-related facility, imaged on multiple passes.',
      },
      'red-missile-1': {
        unitId: 'red-missile-1',
        confidence: 'APPROX',
        briefedPos: { x: 36_000, y: 6_000, alt: 0 },
        uncertaintyRadius: 2_000,
        note: 'Ballistic-missile infrastructure; inventory and readiness figures are CONTESTED across public sources.',
      },
      'red-corvette-1': {
        unitId: 'red-corvette-1',
        confidence: 'VERIFIED',
        briefedPos: { x: 15_000, y: 25_000, alt: 12 },
        note: 'Naval target, continuous search radar.',
      },
      'red-frigate-1': {
        unitId: 'red-frigate-1',
        confidence: 'VERIFIED',
        briefedPos: { x: 12_000, y: -25_000, alt: 14 },
        note: 'Naval target, continuous search radar.',
      },
    },
  };
}
