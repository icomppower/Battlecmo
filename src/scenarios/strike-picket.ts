import type { SimState, Unit } from '../core/types';
import { WEAPONS } from './strike-basic';

/**
 * The blue-on-blue picket dilemma, made PLAYABLE (triage item E, part 2).
 * IFF/transponder mechanics already exist (see tests/iff.test.ts) — this
 * scenario is the registered, flyable version of exactly that tragedy.
 *
 * A BLUE area-air-defense picket sits on the egress route home, weapons
 * FREE (it has to be — that is its job, the strike package's air cover on
 * the way out). A striker returning from a mission with its transponder off
 * (EMCON discipline, or just forgetting to squawk) reads as an UNKNOWN
 * bogey the instant its track quality clears the SAM's launch floor — which
 * ripens well before VID quality does (see VID_QUALITY in sensors.ts). The
 * picket has no way to know it is about to kill a friend; the shot is
 * entirely legal.
 *
 * Two counters, both already-existing mechanics: squawk (the transponder
 * resolves the contact to FRIEND instantly) or ROE discipline (TIGHT will
 * not clear an un-prebriefed contact at all, friend or foe).
 */
export function buildPicketScenario(): SimState {
  const units: Record<string, Unit> = {};

  units['blue-picket-1'] = {
    id: 'blue-picket-1',
    side: 'BLUE',
    domain: 'SEA',
    name: 'Aegis picket',
    pos: { x: 0, y: 0, alt: 12 },
    speed: 0,
    maxSpeed: 15,
    rcs: 300,
    sensors: [{ id: 'spy', kind: 'RADAR', baseRange: 120_000, refRcs: 5, emitting: true }],
    weapons: [{ weaponId: 'sam-longbow', count: 6 }],
    maxConcurrentEngagements: 1,
    waypoints: [],
    alive: true,
  };

  // The returning striker: eastbound-to-westbound through the picket's
  // sector, at strike-cruise altitude, transponder state set by the plan.
  units['blue-hammer-1'] = {
    id: 'blue-hammer-1',
    side: 'BLUE',
    domain: 'AIR',
    name: 'Hammer 1 (returning)',
    pos: { x: 30_000, y: 0, alt: 8_000 },
    speed: 250,
    maxSpeed: 300,
    rcs: 3,
    sensors: [],
    weapons: [],
    iffOn: true, // the plan decides whether it stays this way
    fuelKg: 3_000,
    burnKgPerTick: 1.0,
    bingoKg: 800,
    homeBase: { x: -100_000, y: 0, alt: 8_000 },
    waypoints: [{ x: -100_000, y: 0, alt: 8_000 }],
    alive: true,
  };

  return {
    tick: 0,
    units,
    missiles: {},
    contacts: { BLUE: {}, RED: {} },
    roe: { BLUE: 'FREE', RED: 'FREE' },
    prebriefedTargets: { BLUE: [], RED: [] },
    events: [],
    nextEntitySeq: 1,
    weaponCatalog: WEAPONS,
    intel: {},
  };
}
