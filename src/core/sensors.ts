import type { Contact, SensorDef, SimState, Unit } from './types';
import { dist2d, dist3d, losBlocked, radarHorizon } from './geometry';
import { getTerrain, losBlockedByTerrain } from './terrain';

/**
 * Sensor model — pillar 1: "you fight what your radar actually detected".
 *
 * Detection is deterministic: a target is held when it is inside the sensor's
 * effective range, above the radar horizon, and the sensor is allowed to
 * emit. Randomness is reserved for weapon endgames; sensor coverage is a
 * geometry problem the player can reason about in the planning layer.
 */

/** Radar-equation RCS scaling: detection range goes with the 4th root of RCS. */
export function rcsScaledRange(sensor: SensorDef, targetRcs: number): number {
  return sensor.baseRange * Math.pow(targetRcs / sensor.refRcs, 0.25);
}

/**
 * Combined degradation from every active enemy jammer whose coverage reaches
 * the radar. Multiple jammers stack multiplicatively on the remaining range.
 */
export function jammingFactor(state: SimState, radarOwner: Unit): number {
  // Frequency-agile radars shrug off part of the jamming (nemesis-tunable).
  const resistance = radarOwner.jamResistance ?? 0;
  let factor = 1;
  for (const unit of Object.values(state.units)) {
    if (!unit.alive || unit.side === radarOwner.side) continue;
    const jammer = unit.jammer;
    if (!jammer || !jammer.active) continue;
    if (dist3d(unit.pos, radarOwner.pos) <= jammer.range) {
      factor *= 1 - jammer.strength * (1 - resistance);
    }
  }
  return factor;
}

export function isSuppressed(unit: Unit, tick: number): boolean {
  return unit.suppressedUntilTick !== undefined && tick < unit.suppressedUntilTick;
}

/**
 * Effective detection range of one sensor against one target, after RCS
 * scaling and jamming. Returns 0 when the sensor cannot see at all
 * (radar dark from suppression or EMCON).
 */
export function effectiveRange(state: SimState, owner: Unit, sensor: SensorDef, target: Unit): number {
  if (sensor.kind === 'RADAR') {
    if (!sensor.emitting || isSuppressed(owner, state.tick)) return 0;
    return rcsScaledRange(sensor, target.rcs) * jammingFactor(state, owner);
  }
  // IR/visual: passive, unaffected by RF jamming; scale with RCS as a stand-in
  // for target size/signature.
  return rcsScaledRange(sensor, target.rcs);
}

/** Actual motion, not commanded speed: a unit with no waypoint is parked. */
export function targetGroundSpeed(u: Unit): number {
  return u.waypoints.length > 0 ? u.speed : 0;
}

/** True when `owner`'s sensor suite holds `target` this tick. */
export function canDetect(state: SimState, owner: Unit, target: Unit): boolean {
  if (!owner.alive || !target.alive) return false;
  const range = dist2d(owner.pos, target.pos);
  // Terrain masking blocks every sensor kind — radar, IR, and eyes alike.
  if (losBlocked(owner.pos, target.pos, state.ridges)) return false;
  const hf = getTerrain(state.terrainId);
  if (hf && losBlockedByTerrain(owner.pos, target.pos, hf)) return false;
  for (const sensor of owner.sensors) {
    // Sensor aperture limits: wrong-domain targets are invisible, and a
    // GMTI-style radar cannot break out a target below its speed floor.
    if (sensor.targetDomains && !sensor.targetDomains.includes(target.domain)) continue;
    if (sensor.minTargetSpeed !== undefined && targetGroundSpeed(target) < sensor.minTargetSpeed) continue;
    if (range > effectiveRange(state, owner, sensor, target)) continue;
    if (sensor.kind !== 'VISUAL' && range > radarHorizon(owner.pos.alt + 5, target.pos.alt)) continue;
    return true;
  }
  return false;
}

/** Track quality gained per tick a target is held, and lost per tick it is not. */
export const TRACK_BUILD_RATE = 0.2;
export const TRACK_DECAY_RATE = 0.05;
/** Contacts are dropped entirely below this quality. */
export const TRACK_DROP_THRESHOLD = 0.01;

// ---------------------------------------------------------------------------
// IFF / identification — deterministic, computed, never stored.
// ---------------------------------------------------------------------------

export type ContactIdentity = 'HOSTILE' | 'FRIEND' | 'UNKNOWN';

/** Track quality at which an enemy contact is *declared* hostile. */
export const HOSTILE_ID_QUALITY = 0.6;
/**
 * Track quality at which a transponder-silent own-side bogey is visually
 * identified as friendly. Deliberately ABOVE every weapon's
 * requiredTrackQuality: starting from a cold track, the launch decision
 * always ripens before the VID does — the only things that save a silent
 * friend are geometry (detected far enough out that VID beats the envelope),
 * the squawk, or ROE discipline.
 */
export const VID_QUALITY = 0.8;

/**
 * What `side` believes this contact is. Identification is a pure function of
 * (allegiance truth, transponder state, track quality) — deterministic and
 * plannable, like everything else in the sensor model:
 *
 *  - a squawking own-side unit reads FRIEND instantly (it also never enters
 *    its own side's contact table — see updateContacts);
 *  - a transponder-silent friend is a bogey: UNKNOWN until the track is held
 *    to VID quality;
 *  - an enemy is UNKNOWN until the track quality supports a hostile
 *    declaration.
 *
 * UNKNOWN is the dangerous word: under FREE ROE an unknown is engageable —
 * that is what "weapons free" means, and it is how blue-on-blue happens.
 */
export function identifyContact(state: SimState, side: Unit['side'], contact: Contact): ContactIdentity {
  const target = state.units[contact.targetId];
  if (!target) return 'UNKNOWN';
  if (target.side === side) {
    if (target.iffOn !== false) return 'FRIEND';
    return contact.quality >= VID_QUALITY ? 'FRIEND' : 'UNKNOWN';
  }
  return contact.quality >= HOSTILE_ID_QUALITY ? 'HOSTILE' : 'UNKNOWN';
}
