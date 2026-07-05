import type { SimState, Unit, WeaponDef } from '../core/types';
import { buildAdaptiveStrikeScenario } from './strike-adaptive';

/**
 * Escalation scenario — the adaptive IADS problem with three new layers on
 * top, one per domain the v0.1 build deferred:
 *
 *  - AIR: a QRA fighter on CAP station north of the ingress lane. Its AAMs
 *    out-range everything BLUE carried in v0.1; its radar is jammable but it
 *    also rides the IADS's shared track picture. CONTESTED intel — the
 *    dossier's ELINT fix is 17 km off.
 *  - SEA: a missile corvette patrolling the littoral southwest. Its SAM ring
 *    owns the coastal low-level lane the ridge would otherwise protect.
 *    APPROX intel — the last maritime-patrol fix is hours old and it moves.
 *  - TERRAIN: the Koro ridge line. A striker on the deck southwest of it is
 *    masked from every IADS ground radar — deterministic geometry the player
 *    can plan against — but the ridge does nothing about the fighter looking
 *    down or the corvette on the same side of the crest.
 *
 * The intended solution is force composition (Mission Builder): an IRST pod
 * plus AAM rack makes one striker a passive-kill self-escort; an anti-ship
 * missile clears the corvette from standoff; the masked corridor delivers
 * the strike below the SAM's engagement floor. Sensors before shooters,
 * in all three domains at once.
 */

const NEW_WEAPONS: Record<string, WeaponDef> = {
  'aam-saber': {
    id: 'aam-saber',
    name: 'AAM-11 Saber',
    kind: 'AAM',
    minRange: 2_000,
    maxRange: 55_000,
    minTargetAlt: 100,
    maxTargetAlt: 20_000,
    speed: 900,
    pk: 0.65,
    targetDomains: ['AIR'],
    requiredTrackQuality: 0.5,
  },
  'sam-palisade': {
    id: 'sam-palisade',
    name: 'SA-N-9 Palisade (naval)',
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

export function buildEscalationScenario(): SimState {
  const s = buildAdaptiveStrikeScenario();
  s.weaponCatalog = { ...s.weaponCatalog, ...NEW_WEAPONS };

  // ---- AIR: QRA fighter on CAP station ----
  const cap: Unit = {
    id: 'red-cap-1',
    side: 'RED',
    domain: 'AIR',
    name: 'Saber CAP',
    pos: { x: -30_000, y: 18_000, alt: 9_000 },
    speed: 0,
    maxSpeed: 320,
    rcs: 4,
    sensors: [{ id: 'nose-radar', kind: 'RADAR', baseRange: 80_000, refRcs: 5, emitting: true }],
    weapons: [{ weaponId: 'aam-saber', count: 4 }],
    maxConcurrentEngagements: 1,
    waypoints: [],
    alive: true,
  };
  s.units[cap.id] = cap;

  // ---- SEA: missile corvette patrolling the littoral ----
  const corvette: Unit = {
    id: 'red-corvette-1',
    side: 'RED',
    domain: 'SEA',
    name: 'Palisade corvette',
    pos: { x: -70_000, y: -30_000, alt: 12 }, // mast-height sensors
    speed: 6,
    maxSpeed: 15,
    rcs: 200,
    sensors: [{ id: 'search-radar', kind: 'RADAR', baseRange: 70_000, refRcs: 5, emitting: true }],
    weapons: [{ weaponId: 'sam-palisade', count: 8 }],
    maxConcurrentEngagements: 2,
    emitterDoctrine: { armReactionRange: 10_000, shutdownTicks: 180 },
    waypoints: [
      { x: -55_000, y: -22_000, alt: 12 },
      { x: -62_000, y: -14_000, alt: 12 },
    ],
    alive: true,
  };
  s.units[corvette.id] = corvette;

  // ---- TERRAIN: the Koro ridge line ----
  s.ridges = [
    { id: 'ridge-koro', x1: -52_000, y1: -26_000, x2: -30_000, y2: -6_000, height: 450 },
  ];

  // The corvette is briefed (imprecisely) and strikeable under TIGHT; the
  // fighter is single-source ELINT and NOT pre-briefed — engaging it takes a
  // weapons-free decision.
  s.prebriefedTargets.BLUE = [...s.prebriefedTargets.BLUE, 'red-corvette-1'];

  // ---- Confidence-graded intel dossier ----
  s.intel = {
    'red-sam-1': {
      unitId: 'red-sam-1',
      confidence: 'VERIFIED',
      briefedPos: { ...s.units['red-sam-1']!.pos },
      note: 'Fixed site, imaged on three consecutive passes.',
    },
    'red-ew-1': {
      unitId: 'red-ew-1',
      confidence: 'VERIFIED',
      briefedPos: { ...s.units['red-ew-1']!.pos },
      note: 'Continuous emitter — ELINT fix is solid.',
    },
    'red-hq': {
      unitId: 'red-hq',
      confidence: 'VERIFIED',
      briefedPos: { ...s.units['red-hq']!.pos },
      note: 'Hardened C2 node. The objective.',
    },
    'red-corvette-1': {
      unitId: 'red-corvette-1',
      confidence: 'APPROX',
      briefedPos: { ...corvette.pos },
      uncertaintyRadius: 12_000,
      note: 'Last MPA fix 6 h old; patrolling the littoral.',
    },
    'red-cap-1': {
      unitId: 'red-cap-1',
      confidence: 'CONTESTED',
      briefedPos: { x: -45_000, y: 25_000, alt: 9_000 },
      uncertaintyRadius: 25_000,
      note: 'Single-source ELINT. QRA pattern unknown — treat the whole northern sector as hostile air.',
    },
  };

  return s;
}
