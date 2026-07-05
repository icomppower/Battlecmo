import type { Operator, SimState } from '../core/types';

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
}

export function newCampaign(roster: Operator[]): CampaignState {
  return {
    missionNumber: 1,
    nemesis: { cueMinAlt: 0, jamResistance: 0, shutdownDecay: 0.5, notes: [] },
    squadron: [
      { unitId: 'blue-striker-1', pilot: 'CAPT Vega', missions: 0, fatigue: 0, status: 'READY' },
      { unitId: 'blue-striker-2', pilot: 'LT Brandt', missions: 0, fatigue: 0, status: 'READY' },
      { unitId: 'blue-sead-1', pilot: 'MAJ Osei', missions: 0, fatigue: 0, status: 'READY' },
      { unitId: 'blue-ea-1', pilot: 'LT Ito', missions: 0, fatigue: 0, status: 'READY' },
    ],
    roster,
  };
}

/** Stamp the nemesis's current doctrine onto a freshly built scenario. */
export function applyNemesisDoctrine(state: SimState, nemesis: NemesisProfile): SimState {
  for (const unit of Object.values(state.units)) {
    if (unit.side !== 'RED') continue;
    if (unit.sensors.some((s) => s.kind === 'RADAR')) {
      unit.jamResistance = nemesis.jamResistance;
    }
    if (unit.samDoctrine) {
      unit.samDoctrine.cueMinAlt = nemesis.cueMinAlt;
    }
    if (unit.emitterDoctrine) {
      unit.emitterDoctrine.shutdownDecay = nemesis.shutdownDecay;
    }
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

/** Advance the campaign past a finished mission. */
export function debriefCampaign(campaign: CampaignState, final: SimState): CampaignState {
  return {
    missionNumber: campaign.missionNumber + 1,
    nemesis: adaptNemesis(campaign.nemesis, final),
    squadron: updateSquadron(campaign.squadron, final),
    roster: final.groundOp ? updateRoster(final) : campaign.roster,
  };
}
