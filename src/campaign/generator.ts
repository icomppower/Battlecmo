import type { Order, SamDoctrine, SimState, Unit, Vec3 } from '../core/types';
import { roll } from '../core/rng';
import { WEAPONS } from '../scenarios/strike-basic';
import { withBluePackage, type AircraftConfig } from '../oob/assembly';
import {
  applyNemesisDoctrine,
  applySquadronState,
  type CampaignState,
  type NemesisProfile,
} from './campaign';

/**
 * Campaign mission generator (triage item #4): procedurally composed strike
 * problems — target sets, IADS layout, doctrine, deadline — that are
 * GUARANTEED winnable but tense against the current nemesis profile.
 *
 * The guarantee is constructive, not statistical. Every generated mission
 * ships its own STAFF SOLUTION whose timing is computed from the sampled
 * geometry, and the solution is built exclusively on the sim's
 * deterministic-window mechanics:
 *
 *  - an ARM scare on an EMITTING radar always buys the full doctrine
 *    shutdown window (no Pk roll involved — the scare is the product);
 *  - a battery that spends its shots (on decoys) scoots, and the march is
 *    hundreds of ticks of guaranteed silence;
 *  - a CUED battery that never gets a cue below the blink never shoots.
 *
 * Because the windows are deterministic, the staff plan survives every
 * doctrine draw AND every nemesis adaptation axis: decoys fly at 3 000 m
 * (above any cueMinAlt), the plan uses no jamming (jamResistance moot), the
 * first scare of a mission always gets the full window (shutdownDecay
 * moot), nothing in the package radiates (emitter hunt moot), and
 * discriminated decoys still CUE the radar, which is all the plan needs.
 * The tension is the deadline: it is sampled at 1.15-1.35x the staff
 * timeline, so there is slack for one replan, not for a second sortie.
 */

export interface GeneratedMission {
  name: string;
  /** Scenario with the BLUE package already assembled. */
  state: SimState;
  /** Unit ids that must be destroyed for mission success. */
  objectiveIds: string[];
  /** The strike must be complete (objectives dead) by this tick. */
  deadlineTick: number;
  /** The staff solution — the constructive proof of winnability. */
  staffPlan: Order[];
  /** A straight-in reference plan — the proof of tension (it loses). */
  naivePlan: Order[];
  /** Human-readable briefing lines. */
  brief: string[];
}

const STRIKE_SPEED = 250;
const DECOY_SPEED = 200;
const ARM_SPEED = 600;
const AGM_SPEED = 300;
const SAM_MAX_RANGE = 40_000;
const ARM_REACTION_RANGE = 15_000;
const SHUTDOWN_TICKS = 240;
const SPAWN_X = -140_000;
/**
 * Strikers hold this far west of the battery — 4 km outside its ring. The
 * margin is deliberately lean: every kilometer of standoff is dash ticks
 * spent inside the suppression window, and the window is the budget the
 * whole strike timeline has to fit inside (with egress).
 */
const HOLD_MARGIN = 44_000;
/** Release this far from each target — 2 km inside the AGM's reach. */
const RELEASE_RANGE = 28_000;

function groundUnit(id: string, name: string, pos: Vec3, extra: Partial<Unit> = {}): Unit {
  return {
    id,
    side: 'RED',
    domain: 'GROUND',
    name,
    pos,
    speed: 0,
    maxSpeed: 0,
    rcs: 15,
    sensors: [],
    weapons: [],
    waypoints: [],
    alive: true,
    ...extra,
  };
}

export function generateMission(
  missionNumber: number,
  nemesis: NemesisProfile,
  seed: number,
): GeneratedMission {
  const r = (tag: string) => roll(seed, missionNumber, 'gen', tag);
  const km = 1_000;

  // ---- Sample the problem ----
  const hq: Vec3 = {
    x: Math.round(r('objx') * 8 - 4) * km,
    y: Math.round(r('objy') * 30 - 15) * km,
    alt: 0,
  };
  // The battery stands west of the objective, astride the ingress axis.
  const sam: Vec3 = {
    x: hq.x - (2 + Math.round(r('samdx') * 6)) * km,
    y: hq.y + Math.round(r('samdy') * 8 - 4) * km,
    alt: 5,
  };
  const ew: Vec3 = {
    x: sam.x + Math.round(r('ewdx') * 4 - 2) * km,
    y: sam.y + (6 + Math.round(r('ewdy') * 6)) * km,
    alt: 10,
  };
  const emcon: SamDoctrine['emcon'] = r('emcon') < 0.35 ? 'ACTIVE' : 'CUED';
  const cueRange = (32 + Math.round(r('cue') * 2) * 4) * km; // 32/36/40 km
  const scoots = r('scoot') < 0.5;
  const hasDepot = r('depot') < 0.45;
  const depot: Vec3 = {
    x: hq.x + (2 + Math.round(r('depx') * 3)) * km,
    y: hq.y - (2 + Math.round(r('depy') * 3)) * km,
    alt: 0,
  };

  // ---- RED order of battle ----
  const units: Record<string, Unit> = {};
  units['red-sam-1'] = groundUnit('red-sam-1', 'SA-31 battery', sam, {
    sensors: [{ id: 'fcr', kind: 'RADAR', baseRange: 90_000, refRcs: 5, emitting: emcon === 'ACTIVE' }],
    weapons: [{ weaponId: 'sam-longbow', count: 6 }],
    maxConcurrentEngagements: 2,
    emitterDoctrine: { armReactionRange: ARM_REACTION_RANGE, shutdownTicks: SHUTDOWN_TICKS, shutdownDecay: 0.5, minShutdownTicks: 45 },
    samDoctrine: {
      emcon,
      ...(emcon === 'CUED' ? { cueRange, coldAfterTicks: 30 } : {}),
      ...(scoots
        ? { scootAfterShots: 2, scootTo: { x: sam.x + 4 * km, y: sam.y - 5 * km, alt: 5 }, scootSpeed: 8 }
        : {}),
    },
  });
  units['red-ew-1'] = groundUnit('red-ew-1', 'Early-warning radar', ew, {
    sensors: [{ id: 'ews', kind: 'RADAR', baseRange: 150_000, refRcs: 5, emitting: true }],
    emitterDoctrine: { armReactionRange: 12_000, shutdownTicks: SHUTDOWN_TICKS },
  });
  units['red-hq'] = groundUnit('red-hq', 'C2 node (objective)', hq, { rcs: 25 });
  if (hasDepot) {
    units['red-depot'] = groundUnit('red-depot', 'Ammunition depot (secondary)', depot, { rcs: 25 });
  }
  const objectiveIds = hasDepot ? ['red-hq', 'red-depot'] : ['red-hq'];

  const state: SimState = {
    tick: 0,
    units,
    missiles: {},
    contacts: { BLUE: {}, RED: {} },
    roe: { BLUE: 'HOLD', RED: 'FREE' },
    prebriefedTargets: { BLUE: ['red-sam-1', 'red-ew-1', ...objectiveIds], RED: [] },
    events: [],
    nextEntitySeq: 1,
    weaponCatalog: { ...WEAPONS },
    intel: Object.fromEntries(
      Object.values(units).map((u) => [
        u.id,
        {
          unitId: u.id,
          confidence: 'VERIFIED' as const,
          briefedPos: { ...u.pos },
          note: u.sensors.length > 0 ? 'Emitter — ELINT fix is solid.' : 'Imaged on consecutive passes.',
        },
      ]),
    ),
  };

  // ---- BLUE package: two heavy strikers + SEAD, plus decoys when the
  // battery holds its radar cold (the bait IS the plan against CUED). ----
  const pkg: AircraftConfig[] = [
    { id: 'blue-striker-1', callsign: 'Hammer 1', airframeId: 'af-ranger', stores: ['st-agm-2', 'st-agm-2'], spawn: { x: SPAWN_X, y: hq.y - 3 * km, alt: 8_000 }, speed: STRIKE_SPEED },
    { id: 'blue-striker-2', callsign: 'Hammer 2', airframeId: 'af-ranger', stores: ['st-agm-2', 'st-agm-2'], spawn: { x: SPAWN_X, y: hq.y + 3 * km, alt: 8_000 }, speed: STRIKE_SPEED },
    { id: 'blue-sead-1', callsign: 'Viper (SEAD)', airframeId: 'af-viper', stores: ['st-arm-2'], spawn: { x: SPAWN_X, y: sam.y + 2 * km, alt: 9_000 }, speed: STRIKE_SPEED },
  ];
  if (emcon === 'CUED') {
    pkg.push(
      { id: 'blue-decoy-1', callsign: 'Ghost 1', airframeId: 'af-shrike', stores: ['st-lens'], spawn: { x: SPAWN_X, y: sam.y - km, alt: 3_000 }, speed: DECOY_SPEED },
      { id: 'blue-decoy-2', callsign: 'Ghost 2', airframeId: 'af-shrike', stores: ['st-lens'], spawn: { x: SPAWN_X, y: sam.y + km, alt: 3_000 }, speed: DECOY_SPEED },
    );
  }
  withBluePackage(state, pkg);

  // ---- The staff solution, timed from the sampled geometry ----
  const viperStation: Vec3 = { x: sam.x - 60 * km, y: sam.y + 2 * km, alt: 9_000 };
  const viperArrival = Math.ceil(Math.hypot(viperStation.x - SPAWN_X, 0) / STRIKE_SPEED);
  const holdX = sam.x - HOLD_MARGIN;

  // When does the suppression window open?
  let armLaunch: number;
  let windowOpen: number;
  if (emcon === 'ACTIVE') {
    // The radar is always up: a pre-planned Lance lands its scare on time.
    armLaunch = viperArrival + 5;
    windowOpen = armLaunch + Math.ceil((60 * km - ARM_REACTION_RANGE) / ARM_SPEED) + 2;
  } else {
    // CUED: the ghosts cross the cue ring at t_cue and the radar lights.
    // The Lance is fired EARLY so it crosses the reaction ring a few ticks
    // after the cue — into a radar that is guaranteed up (the scare) or a
    // battery that just spent its shots on drones (the scoot). Both windows
    // are deterministic; neither depends on a Pk roll.
    const cueCross = Math.ceil((sam.x - Math.sqrt(cueRange * cueRange - km * km) - SPAWN_X) / DECOY_SPEED);
    armLaunch = Math.max(viperArrival + 2, cueCross - 70);
    windowOpen = Math.max(cueCross, armLaunch + Math.ceil((60 * km - ARM_REACTION_RANGE) / ARM_SPEED)) + 6;
  }

  // Dash the moment the window opens: the timeline (dash + release + AGM
  // flight + egress back past the ring) has to fit inside the 240-tick
  // blink, and every tick of hesitation is margin spent. Each striker holds
  // pre-aligned with its own target's latitude so the dash is pure-x and
  // the arithmetic below is exact, not an estimate.
  const dashOrder = windowOpen + 2;
  const targets = objectiveIds;
  const strikerIds = ['blue-striker-1', 'blue-striker-2'];
  const releaseOrders: Order[] = [];
  let lastImpact = 0;
  strikerIds.forEach((sid, i) => {
    const target = state.units[targets[i % targets.length]!]!;
    const releaseX = target.pos.x - RELEASE_RANGE;
    const arrive = dashOrder + Math.ceil((releaseX - holdX) / STRIKE_SPEED) + 2;
    releaseOrders.push({ atTick: dashOrder, type: 'SET_WAYPOINTS', unitId: sid, waypoints: [{ x: releaseX, y: target.pos.y, alt: 8_000 }] });
    for (let shot = 0; shot < 4; shot++) {
      releaseOrders.push({ atTick: arrive + shot, type: 'ENGAGE', unitId: sid, weaponId: 'agm-stormbreak', targetId: target.id });
    }
    releaseOrders.push({ atTick: arrive + 5, type: 'SET_WAYPOINTS', unitId: sid, waypoints: [{ x: SPAWN_X, y: target.pos.y, alt: 8_000 }] });
    lastImpact = Math.max(lastImpact, arrive + 4 + Math.ceil(RELEASE_RANGE / AGM_SPEED));
  });

  const staffPlan: Order[] = [
    { atTick: 0, type: 'SET_ROE', side: 'BLUE', level: 'TIGHT' },
    { atTick: 0, type: 'SET_WAYPOINTS', unitId: 'blue-sead-1', waypoints: [viperStation] },
    { atTick: 0, type: 'SET_WAYPOINTS', unitId: 'blue-striker-1', waypoints: [{ x: holdX, y: state.units[targets[0]!]!.pos.y, alt: 8_000 }] },
    { atTick: 0, type: 'SET_WAYPOINTS', unitId: 'blue-striker-2', waypoints: [{ x: holdX, y: state.units[targets[1 % targets.length]!]!.pos.y, alt: 8_000 }] },
    ...(emcon === 'CUED'
      ? ([
          { atTick: 0, type: 'SET_WAYPOINTS', unitId: 'blue-decoy-1', waypoints: [{ x: sam.x - 18 * km, y: sam.y - km, alt: 3_000 }] },
          { atTick: 0, type: 'SET_WAYPOINTS', unitId: 'blue-decoy-2', waypoints: [{ x: sam.x - 18 * km, y: sam.y + km, alt: 3_000 }] },
        ] satisfies Order[])
      : []),
    { atTick: armLaunch, type: 'ENGAGE', unitId: 'blue-sead-1', weaponId: 'arm-lance', targetId: 'red-sam-1' },
    ...releaseOrders,
  ];

  // The straight-in reference plan: same targets, no window. It loses.
  const naive: Order[] = [
    { atTick: 0, type: 'SET_ROE', side: 'BLUE', level: 'TIGHT' },
    ...strikerIds.flatMap((sid, i): Order[] => {
      const target = state.units[targets[i % targets.length]!]!;
      const releaseX = target.pos.x - RELEASE_RANGE;
      const arrive = Math.ceil(Math.hypot(releaseX - SPAWN_X, target.pos.y - (hq.y + (i === 0 ? -3 : 3) * km)) / STRIKE_SPEED) + 2;
      return [
        { atTick: 0, type: 'SET_WAYPOINTS', unitId: sid, waypoints: [{ x: releaseX, y: target.pos.y, alt: 8_000 }] },
        ...Array.from({ length: 4 }, (_, shot): Order => ({ atTick: arrive + shot, type: 'ENGAGE', unitId: sid, weaponId: 'agm-stormbreak', targetId: target.id })),
      ];
    }),
  ];

  // Deadline: staff timeline plus 15-35% slack — room for one replan, not
  // for a second sortie.
  const deadlineTick = Math.ceil(lastImpact * (1.15 + r('slack') * 0.2));

  const brief = [
    `OBJECTIVE${targets.length > 1 ? 'S' : ''}: ${targets.map((t) => state.units[t]!.name).join(' + ')}.`,
    `THREAT: SA-31 battery ${(Math.hypot(hq.x - sam.x, hq.y - sam.y) / km).toFixed(0)} km west of the objective, ` +
      (emcon === 'ACTIVE'
        ? 'radiating continuously.'
        : `radar cold until cued (~${Math.round(cueRange / km)} km ring assessed).`),
    ...(scoots ? ['Battery is assessed as shoot-and-scoot capable.'] : []),
    `Early-warning radar northeast of the battery — assume you are tracked from the coast in.`,
    `DEADLINE: objectives destroyed by T+${Math.floor(deadlineTick / 60)}:${String(deadlineTick % 60).padStart(2, '0')} or the tasking reverts.`,
    `STAFF SOLUTION on file: ${emcon === 'CUED' ? 'ghost flight cues the battery, reactive Lance into the live emitter' : 'pre-planned Lance on the active emitter'}, strike through the blink window.`,
  ];

  return {
    name: `Generated strike #${missionNumber} (seed ${seed})`,
    state,
    objectiveIds,
    deadlineTick,
    staffPlan,
    naivePlan: naive,
    brief,
  };
}

/**
 * Campaign rotation: generate the next mission against the CURRENT nemesis
 * profile and material state — doctrine adapted, lost airframes absent,
 * fatigued pilots burning heavier.
 */
export function nextCampaignMission(campaign: CampaignState, seed: number): GeneratedMission {
  const gen = generateMission(campaign.missionNumber, campaign.nemesis, seed);
  applyNemesisDoctrine(gen.state, campaign.nemesis);
  applySquadronState(gen.state, campaign.squadron);
  return gen;
}
