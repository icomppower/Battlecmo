import type { CiwsDef, Operator, SimState, Unit } from '../core/types';
import { getTerrain, terrainHeightAt } from '../core/terrain';

/**
 * Campaign layer (build order step 6): the nemesis IADS commander and the
 * persistent squadron roster.
 *
 * The nemesis does NOT cheat inside a mission — every in-mission behavior is
 * the deterministic doctrine the player can observe and out-think. What the
 * nemesis does is *between* missions: it reads the engagement log the way an
 * air-defense staff would, infers what beat it, and re-tunes doctrine
 * parameters for the next mission. Statistical counter-adaptation, exactly
 * like Breach Protocol's nemesis organization, extended to air-defense
 * posture.
 */

export interface NemesisProfile {
  /** Crews ignore cues below this altitude (counter to low-alt bait runs). */
  cueMinAlt: number;
  /** Frequency agility: fraction of jamming strength the radars shrug off. */
  jamResistance: number;
  /** ARM-scare blink decay (lower ⇒ crews relight faster after scares). */
  shutdownDecay: number;
  /** Fighters prioritize and reach for radiating surveillance aircraft. */
  huntEmitters: boolean;
  /** A gap-filler radar deploys to the theater's surveyed shadow sites. */
  gapFiller: boolean;
  /** Ships mount CIWS after losing a hull to a standoff anti-ship missile. */
  pointDefenseAlert: boolean;
  /** Batteries stop expending rounds on slow, never-firing air contacts. */
  decoyDiscrimination: boolean;
  /** Human-readable staff notes — this is the INTSUM the player reads. */
  notes: string[];
}

export interface AirframeRecord {
  unitId: string;
  pilot: string;
  missions: number;
  fatigue: number;
  status: 'READY' | 'LOST';
}

export interface CampaignState {
  missionNumber: number;
  nemesis: NemesisProfile;
  squadron: AirframeRecord[];
  roster: Operator[];
  /** Stock pool, rounds remaining per weapon id — the "rearm" half of rest & rearm. */
  stores: Record<string, number>;
}

/** Starting rounds per weapon id — generous enough for a multi-mission campaign. */
export const STARTING_STOCK: Record<string, number> = {
  'agm-stormbreak': 20,
  'arm-lance': 12,
  'aam-dart': 12,
  'asm-pike': 6,
};

export function newCampaign(roster: Operator[]): CampaignState {
  return {
    missionNumber: 1,
    nemesis: {
      cueMinAlt: 0,
      jamResistance: 0,
      shutdownDecay: 0.5,
      huntEmitters: false,
      gapFiller: false,
      pointDefenseAlert: false,
      decoyDiscrimination: false,
      notes: [],
    },
    squadron: [
      { unitId: 'blue-striker-1', pilot: 'CAPT Vega', missions: 0, fatigue: 0, status: 'READY' },
      { unitId: 'blue-striker-2', pilot: 'LT Brandt', missions: 0, fatigue: 0, status: 'READY' },
      { unitId: 'blue-sead-1', pilot: 'MAJ Osei', missions: 0, fatigue: 0, status: 'READY' },
      { unitId: 'blue-ea-1', pilot: 'LT Ito', missions: 0, fatigue: 0, status: 'READY' },
      { unitId: 'blue-awacs-1', pilot: 'CDR Halevy', missions: 0, fatigue: 0, status: 'READY' },
    ],
    roster,
    stores: { ...STARTING_STOCK },
  };
}

/** The CIWS fit issued under a point-defense alert (see tick's runPointDefense). */
export const CIWS_ALERT_FIT: CiwsDef = { range: 1_200, pk: 0.3, magazine: 10 };

/** Launch-discrimination doctrine issued after wreckage analysis finds drones. */
export const DECOY_DISCRIMINATION = { maxDecoySpeed: 230, selfDefenseRange: 15_000 };

/** Stamp the nemesis's current doctrine onto a freshly built scenario. */
export function applyNemesisDoctrine(state: SimState, nemesis: NemesisProfile): SimState {
  for (const unit of Object.values(state.units)) {
    if (unit.side !== 'RED') continue;
    if (unit.sensors.some((s) => s.kind === 'RADAR')) {
      unit.jamResistance = nemesis.jamResistance;
    }
    if (unit.samDoctrine) {
      unit.samDoctrine.cueMinAlt = nemesis.cueMinAlt;
      if (nemesis.decoyDiscrimination) {
        unit.samDoctrine.discrimination = { ...DECOY_DISCRIMINATION };
      }
    }
    if (unit.emitterDoctrine) {
      unit.emitterDoctrine.shutdownDecay = nemesis.shutdownDecay;
    }
    if (unit.capDoctrine) {
      unit.capDoctrine.huntEmitters = nemesis.huntEmitters;
    }
    if (nemesis.pointDefenseAlert && unit.domain === 'SEA' && !unit.ciws) {
      unit.ciws = { ...CIWS_ALERT_FIT };
    }
  }

  // Gap-filler radar: erected at the theater's surveyed shadow sites. It
  // radiates continuously from day one, so BLUE's between-mission ELINT
  // sweep hears it — the dossier carries a CONTESTED fix and the site is
  // cleared for SEAD under TIGHT. The corridor is closed, not hidden:
  // legible, predictable, and counterable.
  if (nemesis.gapFiller && state.gapFillerSites) {
    const hf = getTerrain(state.terrainId);
    state.gapFillerSites.forEach((site, i) => {
      const id = `red-gapfill-${i + 1}`;
      if (state.units[id]) return;
      const groundAlt = hf ? terrainHeightAt(hf, site.x, site.y) : site.alt;
      const unit: Unit = {
        id,
        side: 'RED',
        domain: 'GROUND',
        name: `Gap-filler radar ${i + 1}`,
        pos: { x: site.x, y: site.y, alt: groundAlt + 10 },
        speed: 0,
        maxSpeed: 0,
        rcs: 10,
        sensors: [{ id: `${id}-radar`, kind: 'RADAR', baseRange: 45_000, refRcs: 5, emitting: true }],
        weapons: [],
        emitterDoctrine: { armReactionRange: 12_000, shutdownTicks: 240 },
        waypoints: [],
        alive: true,
      };
      state.units[id] = unit;
      state.prebriefedTargets.BLUE = [...state.prebriefedTargets.BLUE, id];
      if (state.intel) {
        state.intel[id] = {
          unitId: id,
          confidence: 'CONTESTED',
          briefedPos: { ...unit.pos },
          uncertaintyRadius: 6_000,
          note: 'New low-level emitter — ELINT caught its acceptance testing between missions. The quiet way in is not quiet anymore.',
        };
      }
    });
  }
  return state;
}

/**
 * Read the finished mission like an air-defense staff and counter what
 * worked. Each inference is keyed to observable evidence in the event log,
 * so the player can predict (and pre-empt) the adaptation — that's the
 * nemesis contract: legible, not arbitrary.
 */
export function adaptNemesis(nemesis: NemesisProfile, final: SimState): NemesisProfile {
  const next: NemesisProfile = { ...nemesis, notes: [] };
  const events = final.events;

  const litUp = events.some((e) => e.type === 'SAM_EMCON' && e.emitting);
  const firedAtAnything = events.some((e) => e.type === 'LAUNCH' && e.side === 'RED');
  if (litUp && !firedAtAnything && next.cueMinAlt < 120) {
    next.cueMinAlt = 120;
    next.notes.push(
      'Battery radiated with no engageable target in the basket — assessed as a low-altitude decoy run. ' +
        'Crews ordered to disregard cues below 120 m.',
    );
  }

  const wasJammed = events.some((e) => e.type === 'JAMMER_SET' && e.active);
  if (wasJammed && next.jamResistance < 0.8) {
    next.jamResistance = Math.min(0.8, next.jamResistance + 0.4);
    next.notes.push(
      'Standoff jamming degraded the early-warning picture — frequency-agility kits issued to surviving radars.',
    );
  }

  const scares = events.filter((e) => e.type === 'EMITTER_SHUTDOWN').length;
  if (scares > 0 && next.shutdownDecay > 0.35) {
    next.shutdownDecay = 0.35;
    next.notes.push(
      'Crews survived anti-radiation shots by blinking — drilled to relight faster after each scare.',
    );
  }

  // ELINT correlates a persistent airborne surveillance radar. Emissions
  // travel one way: if a BLUE airborne radar painted RED units (BLUE
  // DETECTION events credited to a radar-emitting aircraft), RED's ELINT
  // heard that radar — jamming its receivers doesn't silence its own
  // transmitter. Passive tracks (IRST) leave no such fingerprint.
  const radiatedAtRed = events.some((e) => {
    if (e.type !== 'DETECTION' || e.side !== 'BLUE') return false;
    const sensorUnit = final.units[e.sensorUnitId];
    return (
      sensorUnit?.side === 'BLUE' &&
      sensorUnit.domain === 'AIR' &&
      sensorUnit.sensors.some((se) => se.kind === 'RADAR' && se.emitting)
    );
  });
  if (radiatedAtRed && !next.huntEmitters) {
    next.huntEmitters = true;
    next.notes.push(
      'ELINT correlated a persistent airborne surveillance radar behind the strike — ' +
        'interceptors re-tasked: radiating command-and-surveillance aircraft are now priority targets, ' +
        'engaged well beyond the normal commit ring.',
    );
  }

  // The unobserved strike: RED lost units this mission yet never held a
  // single track on a BLUE aircraft. The staff's only explanation is a
  // terrain shadow — survey teams plot the dead ground, and a gap-filler
  // radar deploys to the theater's surveyed shadow sites (if it has any).
  const redEverTrackedAir = events.some(
    (e) => e.type === 'DETECTION' && e.side === 'RED' && final.units[e.targetId]?.domain === 'AIR',
  );
  const redLostSomething = Object.values(final.units).some((u) => u.side === 'RED' && !u.alive);
  if (!redEverTrackedAir && redLostSomething && !next.gapFiller) {
    next.gapFiller = true;
    next.notes.push(
      'Strike arrived and departed without a single radar track — assessed as a terrain-masked approach. ' +
        'Engineer survey of the coverage dead ground complete; gap-filler radar deployed to the shadowed corridor.',
    );
  }

  // A hull lost to an anti-ship missile: every ship in the theater mounts
  // (and mans) its point defense from now on. Saturation still works —
  // the mount can only service one inbound at a time — but the single-
  // missile standoff kill is over.
  const asmKilledShip = events.some((e) => {
    if (e.type !== 'UNIT_DESTROYED') return false;
    const missile = final.missiles[e.byMissileId];
    const weapon = missile && final.weaponCatalog[missile.weaponId];
    return weapon?.kind === 'ASM' && final.units[e.unitId]?.domain === 'SEA';
  });
  if (asmKilledShip && !next.pointDefenseAlert) {
    next.pointDefenseAlert = true;
    next.notes.push(
      'Hull lost to a sea-skimming missile fired from outside the air-defense ring — ' +
        'close-in weapon systems fitted and manned fleet-wide.',
    );
  }

  // Wreckage analysis: missiles were expended on unmanned decoys. Crews are
  // ordered to hold fire on slow contacts that have never fired a weapon,
  // outside self-defense range. The radars still track and cue on them —
  // only the launch decision changes.
  const shotAtDecoys = events.some(
    (e) => e.type === 'LAUNCH' && e.side === 'RED' && final.units[e.targetId]?.decoy,
  );
  if (shotAtDecoys && !next.decoyDiscrimination) {
    next.decoyDiscrimination = true;
    next.notes.push(
      'Wreckage analysis: expended rounds brought down unmanned decoy drones. ' +
        'Crews ordered to discriminate — no launches on slow, non-firing contacts beyond self-defense range.',
    );
  }

  const samLost = Object.values(final.units).some(
    (u) => u.side === 'RED' && !u.alive && u.weapons.some((w) => w.weaponId.startsWith('sam')),
  );
  if (samLost) {
    next.notes.push('Battery written off — replacement battery deployed with a fresh crew.');
  }

  return next;
}

/**
 * Stamp the squadron's material state onto a freshly built scenario:
 * airframes LOST on earlier missions don't fly, and accumulated pilot
 * fatigue shows up as sloppier fuel discipline (+4% burn per sortie of
 * fatigue, capped at +40%) — the loiter budget the plan was authored
 * against quietly shrinks mission over mission.
 */
export function applySquadronState(state: SimState, squadron: AirframeRecord[]): SimState {
  for (const rec of squadron) {
    const unit = state.units[rec.unitId];
    if (!unit) continue;
    if (rec.status === 'LOST') {
      delete state.units[rec.unitId];
      continue;
    }
    if (unit.burnKgPerTick !== undefined && rec.fatigue > 0) {
      const factor = 1 + 0.04 * Math.min(rec.fatigue, 10);
      unit.burnKgPerTick = Math.round(unit.burnKgPerTick * factor * 10_000) / 10_000;
    }
  }
  return state;
}

/** Post-mission squadron bookkeeping: sorties, fatigue, losses. */
export function updateSquadron(squadron: AirframeRecord[], final: SimState): AirframeRecord[] {
  return squadron.map((rec) => {
    if (rec.status === 'LOST') return rec;
    const unit = final.units[rec.unitId];
    if (!unit) return rec;
    if (!unit.alive) return { ...rec, status: 'LOST' as const };
    return { ...rec, missions: rec.missions + 1, fatigue: rec.fatigue + 1 };
  });
}

/** Carry the ground roster forward: survivors log the sortie. */
export function updateRoster(final: SimState): Operator[] {
  const roster = final.groundOp?.roster ?? [];
  return roster.map((o) => (o.status === 'KIA' ? { ...o } : { ...o, missions: o.missions + 1 }));
}

/**
 * Rest recovers pilot fatigue without flying a mission: −1 fatigue per
 * skipped mission per pilot, floored at 0. A LOST airframe has no pilot left
 * to rest. `missionsSkipped` lets one REST press stand for more than one
 * down cycle if the UI ever wants that; today's REST button always passes 1.
 */
export function restSquadron(squadron: AirframeRecord[], missionsSkipped: number): AirframeRecord[] {
  return squadron.map((rec) =>
    rec.status === 'LOST' ? rec : { ...rec, fatigue: Math.max(0, rec.fatigue - missionsSkipped) },
  );
}

/**
 * Deplete the stock pool by every BLUE weapon actually launched this
 * mission (RED's own SAM rounds are its problem, not the player's stores).
 * The LAUNCH event already carries the weapon id, so this is a straight
 * tally against the event log — no extra bookkeeping in the tick core.
 */
export function expendStores(stores: Record<string, number>, final: SimState): Record<string, number> {
  const next = { ...stores };
  for (const e of final.events) {
    if (e.type === 'LAUNCH' && e.side === 'BLUE') {
      next[e.weaponId] = Math.max(0, (next[e.weaponId] ?? 0) - 1);
    }
  }
  return next;
}

/** Advance the campaign past a finished mission. */
export function debriefCampaign(campaign: CampaignState, final: SimState): CampaignState {
  return {
    missionNumber: campaign.missionNumber + 1,
    nemesis: adaptNemesis(campaign.nemesis, final),
    squadron: updateSquadron(campaign.squadron, final),
    roster: final.groundOp ? updateRoster(final) : campaign.roster,
    stores: expendStores(campaign.stores, final),
  };
}
