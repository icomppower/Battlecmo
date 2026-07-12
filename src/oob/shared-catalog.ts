import type { SensorDef, WeaponDef } from '../core/types';
import { AIRFRAMES, STORE_WEAPONS, type AirframeDef } from './assembly';
import { WEAPONS } from '../scenarios/strike-basic';
import { NEW_WEAPONS } from '../scenarios/strike-taiwan';
import { EPICFURY_WEAPONS } from '../scenarios/strike-epicfury';

/**
 * Shared catalog — the single source of truth for the sister wargame-map
 * project (icomppower/wargame-map). This module changes NO existing
 * scenario: every scenario still builds its own weaponCatalog from its own
 * imports exactly as before (see strike-basic.ts, strike-taiwan.ts,
 * strike-epicfury.ts, oob/assembly.ts). This file only *aggregates* those
 * existing records, plus a small number of new catalog entries that don't
 * belong to any one scenario, and re-exports the union for
 * tools/export-catalog to serialize.
 *
 * Note on core WEAPONS: the design doc for this file names
 * "src/core/weapons.ts" as the source of the base weapon catalog, but that
 * module is actually the envelope/launch-validation logic (inEnvelope,
 * validateLaunch) — it has no WeaponDef record. The base catalog those
 * functions validate against lives in scenarios/strike-basic.ts's `WEAPONS`
 * export (agm-stormbreak, arm-lance, sam-longbow), so that is what's
 * aggregated here.
 */

// ---------------------------------------------------------------------------
// ASBM analogs — anti-ship ballistic missiles. Modeled as WeaponDef kind
// 'ASM' targeting SEA: an ASBM is, from the envelope/inEnvelope perspective,
// just another very-long-range, very-fast anti-ship weapon — the terminal
// maneuvering re-entry vehicle is flavor, not a new engine concept. Both
// entries use minTargetAlt 0 / maxTargetAlt 60 like every other anti-ship
// weapon in the catalog (asm-pike, asm-standoff): mast-height targets only.
// ---------------------------------------------------------------------------

export const ASBM_WEAPONS: Record<string, WeaponDef> = {
  // DF-21D-class analog: the original "carrier killer" — a medium-range
  // ballistic missile with a maneuvering re-entry vehicle terminally homing
  // on a moving sea target. `speed` here is a terminal-average figure
  // (hypersonic re-entry, not the missile's boost-phase speed) so the
  // existing range/speed/time-of-flight math needs no changes to fly it.
  // pk 0.5 is deliberately unresolved rather than confidently high: whether
  // a maneuvering RV can reliably re-acquire and hit a moving carrier-sized
  // target at 1,500 km is openly CONTESTED in the open-source literature —
  // no unclassified test against a maneuvering target at sea has ever been
  // publicly confirmed, so this pk sits at "coin flip" rather than at the
  // near-certainty other terminal-guided weapons in this catalog get.
  'asbm-anchor': {
    id: 'asbm-anchor',
    name: 'Anchor ASBM (DF-21D-class analog)',
    kind: 'ASM',
    minRange: 100_000,
    maxRange: 1_500_000, // ~1,500 km
    minTargetAlt: 0,
    maxTargetAlt: 60,
    speed: 2_100, // terminal-average, hypersonic re-entry
    pk: 0.5, // CONTESTED — see doc comment above
    targetDomains: ['SEA'],
  },
  // DF-26-class analog: the longer-legged "Guam killer" sibling — same
  // maneuvering-RV shape as asbm-anchor, stretched to intermediate range.
  // pk is graded slightly lower than asbm-anchor's already-contested figure:
  // the longer flight gives the target more time to have moved from the
  // last mid-course update, which only makes the open terminal-accuracy
  // question harder, not easier.
  'asbm-anchor-er': {
    id: 'asbm-anchor-er',
    name: 'Anchor-ER ASBM (DF-26-class analog)',
    kind: 'ASM',
    minRange: 100_000,
    maxRange: 4_000_000, // ~4,000 km
    minTargetAlt: 0,
    maxTargetAlt: 60,
    speed: 2_400, // terminal-average, hypersonic re-entry
    pk: 0.45, // CONTESTED — see asbm-anchor's doc comment
    targetDomains: ['SEA'],
  },
};

// ---------------------------------------------------------------------------
// Sensor catalog — Battlecmo has never had one (every SensorDef so far is
// authored inline on a unit or a store; see oob/assembly.ts's STORES for the
// closest precedent: st-airsearch, st-gmti, st-irst). This is the first
// standalone, named sensor entry, seeded for the wargame-map export.
// ---------------------------------------------------------------------------

export const SENSORS: Record<string, Omit<SensorDef, 'id'>> = {
  // Over-the-horizon (skywave) surveillance radar: bounces HF energy off the
  // ionosphere to see thousands of km beyond the radar horizon. That reach
  // comes at a real cost the catalog must not paper over — skywave
  // propagation and huge natural resolution cells give a *cueing-grade*
  // detection (something is out there, roughly here) never a
  // *weapons-grade* track (a fire-control-quality fix a missile can home
  // on). The map/sim treats oth-longview as cueing only: it can put a
  // contact on the board and point a striker's own sensors at the area, but
  // it can never itself supply requiredTrackQuality for a shot.
  'oth-longview': {
    kind: 'RADAR',
    baseRange: 2_500_000, // ~2,500 km, skywave
    refRcs: 5,
    emitting: true,
    targetDomains: ['AIR', 'SEA'],
  },
};

// ---------------------------------------------------------------------------
// Bomber airframe — the AirframeDef the fictional-analog naming style calls
// for. strike-epicfury.ts's blue-bomber-1/2 already fakes this "heavy
// bomber" flavor with an *inline* af-ranger clone (see its doc comment: "the
// existing strike airframe, cleanRcs 2 ... is a clone at an order of
// magnitude lower RCS (0.15) with a heavier payload and a much longer
// fuel/loiter budget"); af-onyx is that same idea promoted to a real,
// reusable AIRFRAMES catalog entry instead of a one-off inline unit.
// ---------------------------------------------------------------------------

export const BOMBER_AIRFRAMES: Record<string, AirframeDef> = {
  'af-onyx': {
    id: 'af-onyx',
    name: 'B-21 Onyx (B-2/B-21-class analog, heavy bomber)',
    role: 'STRIKE',
    hardpoints: 8,
    // An order of magnitude under af-ranger's 2 m² clean RCS — the whole
    // point of the airframe, same figure strike-epicfury.ts's inline clone
    // already uses.
    cleanRcs: 0.15,
    maxSpeed: 250,
    internalFuelKg: 60_000,
    baseBurnKgPerTick: 2.0,
    bingoKg: 8_000,
  },
};

// ---------------------------------------------------------------------------
// Aggregated shared catalog — merges every existing scenario/oob catalog
// (unmodified) with the new entries above. This is what tools/export-catalog
// serializes for the wargame-map project; nothing here is read by any
// scenario or by the sim core.
// ---------------------------------------------------------------------------

export interface SharedCatalog {
  weapons: Record<string, WeaponDef>;
  airframes: Record<string, AirframeDef>;
  sensors: Record<string, Omit<SensorDef, 'id'>>;
}

/** Builds the aggregated catalog fresh each call — pure, no shared mutable state. */
export function buildSharedCatalog(): SharedCatalog {
  return {
    weapons: {
      ...WEAPONS,
      ...STORE_WEAPONS,
      ...NEW_WEAPONS,
      ...EPICFURY_WEAPONS,
      ...ASBM_WEAPONS,
    },
    airframes: {
      ...AIRFRAMES,
      ...BOMBER_AIRFRAMES,
    },
    sensors: {
      ...SENSORS,
    },
  };
}

export const SHARED_CATALOG: SharedCatalog = buildSharedCatalog();
