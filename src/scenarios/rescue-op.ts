import type { Operator, SimState } from '../core/types';
import { buildAdaptiveStrikeScenario } from './strike-adaptive';
import { importRoster } from './breach-roster';

/**
 * Build order step 4 — the full multi-domain hostage rescue. This is the
 * game's pitch in one scenario: Breach Protocol's ground op, but the
 * hostages are behind an integrated air defense, and everything shares one
 * mission clock.
 *
 * On top of the adaptive IADS:
 *
 *  - A hostage site south of the SAM ring, guarded by a MANPADS team. The
 *    MANPADS can't touch the fast movers up high — but it owns the low-level
 *    airspace the extraction helicopter needs. Someone has to kill it.
 *  - The imported Breach Protocol team, staged inland after an earlier
 *    infiltration. Its breach is gated on the C2/alarm net being destroyed —
 *    the air strike IS the ground team's go-code.
 *  - A hostage clock: if the site isn't secured before the deadline, the
 *    hostages are moved and the mission is over.
 *
 * Coupling, both directions: a missed SEAD window delays the strike, which
 * delays the breach while the clock runs; and the strike package has to
 * spend weapons on the MANPADS or the exfil dies at the LZ.
 */
export function buildRescueScenario(roster?: Operator[]): SimState {
  const s = buildAdaptiveStrikeScenario();

  s.weaponCatalog = {
    ...s.weaponCatalog,
    'manpads-9': {
      id: 'manpads-9',
      name: 'Igla team',
      kind: 'SAM',
      minRange: 300,
      maxRange: 4_500,
      minTargetAlt: 0,
      maxTargetAlt: 3_000,
      speed: 500,
      pk: 0.5,
      targetDomains: ['AIR'],
      requiredTrackQuality: 0.3,
    },
  };

  // ---- The hostage site, its guard, and the ground team ----
  s.units['red-hostage-site'] = {
    id: 'red-hostage-site',
    side: 'RED',
    domain: 'GROUND',
    name: 'Hostage site',
    pos: { x: 0, y: -14_000, alt: 0 },
    speed: 0,
    maxSpeed: 0,
    rcs: 20,
    sensors: [],
    weapons: [],
    waypoints: [],
    alive: true,
  };

  s.units['red-guard-1'] = {
    id: 'red-guard-1',
    side: 'RED',
    domain: 'GROUND',
    name: 'MANPADS guard',
    pos: { x: 100, y: -14_000, alt: 2 },
    speed: 0,
    maxSpeed: 0,
    rcs: 2,
    sensors: [{ id: 'eyes', kind: 'VISUAL', baseRange: 3_500, refRcs: 5, emitting: true }],
    weapons: [{ weaponId: 'manpads-9', count: 4 }],
    maxConcurrentEngagements: 1,
    waypoints: [],
    alive: true,
  };

  s.units['blue-team-1'] = {
    id: 'blue-team-1',
    side: 'BLUE',
    domain: 'GROUND',
    name: 'Breach team',
    pos: { x: 1_200, y: -12_500, alt: 2 },
    speed: 4, // tactical movement, m/s
    maxSpeed: 4,
    rcs: 0.5,
    sensors: [],
    weapons: [],
    waypoints: [],
    alive: true,
  };

  s.units['blue-helo-1'] = {
    id: 'blue-helo-1',
    side: 'BLUE',
    domain: 'AIR',
    name: 'Dustoff (helo)',
    pos: { x: -40_000, y: 10_000, alt: 30 }, // FARP, nap-of-the-earth the whole way
    speed: 70,
    maxSpeed: 80,
    rcs: 4,
    sensors: [],
    weapons: [],
    fuelKg: 1_600,
    burnKgPerTick: 0.4,
    bingoKg: 200,
    homeBase: { x: -40_000, y: 10_000, alt: 30 },
    waypoints: [],
    alive: true,
  };

  // Heavier strike loadout: two DMPIs (C2 node + MANPADS) at two AGMs each.
  s.units['blue-striker-2']!.weapons = [{ weaponId: 'agm-stormbreak', count: 4 }];

  // The guard and the site join the briefed target deck.
  s.prebriefedTargets.BLUE.push('red-guard-1');

  s.groundOp = {
    teamUnitId: 'blue-team-1',
    heloUnitId: 'blue-helo-1',
    hostageSiteId: 'red-hostage-site',
    alarmNetUnitId: 'red-hq',
    lz: { x: 500, y: -13_500, alt: 0 },
    phase: 'STAGED',
    breachTicksRequired: 90,
    hostageDeadlineTick: 1_000,
    hostageCount: 4,
    teamAboardHelo: false,
    extractionSafeX: -30_000,
    roster: roster ?? importRoster(),
  };

  return s;
}
