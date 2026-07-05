import type { LaunchDenialReason, SimState, Unit, WeaponDef } from './types';
import { dist2d } from './geometry';
import { identifyContact } from './sensors';
import { aglOf } from './terrain';

/**
 * Weapons are envelopes, not a generic "attack" action: every weapon-target
 * pairing is gated by range band, target altitude band, and target domain.
 */
export function inEnvelope(state: SimState, weapon: WeaponDef, shooter: Unit, target: Unit): boolean {
  if (!weapon.targetDomains.includes(target.domain)) return false;
  const range = dist2d(shooter.pos, target.pos);
  if (range < weapon.minRange || range > weapon.maxRange) return false;
  // Altitude bands are height OVER GROUND: a jet at 60 m AGL in a 200 m-MSL
  // valley is still under a 100 m engagement floor. Flat worlds unchanged.
  const targetAgl = aglOf(state, target);
  if (targetAgl < weapon.minTargetAlt || targetAgl > weapon.maxTargetAlt) return false;
  return true;
}

/**
 * ROE authority gate — engagement requires the right clearance level active.
 * HOLD blocks everything. TIGHT clears only pre-briefed ground targets
 * (the planned strike). FREE clears any target the shooter can justify.
 */
export function roeAllows(state: SimState, shooter: Unit, target: Unit): LaunchDenialReason | null {
  const level = state.roe[shooter.side];
  if (level === 'FREE') return null;
  if (level === 'HOLD') return 'ROE_HOLD';
  const prebriefed = state.prebriefedTargets[shooter.side].includes(target.id);
  return prebriefed ? null : 'ROE_TIGHT_NO_PREBRIEF';
}

/**
 * Full launch validation. Returns null when the shot is cleared, otherwise
 * the reason it is denied — denials are logged as events so a scrubbed plan
 * shows *why* a scheduled shot never came off the rail.
 */
export function validateLaunch(
  state: SimState,
  shooter: Unit,
  weapon: WeaponDef,
  target: Unit,
): LaunchDenialReason | null {
  if (!shooter.alive) return 'SHOOTER_DEAD';
  if (!target.alive) return 'TARGET_DEAD';
  // IFF interlock: a target the shooter's side has identified as FRIEND is
  // never clearable, at any ROE. A transponder-silent own-side unit that is
  // still an UNKNOWN bogey in the contact table falls through to the ROE
  // gates like any other contact — under FREE that shot is legal, and that
  // is precisely the friendly-fire risk the transponder exists to remove.
  if (target.side === shooter.side) {
    const contact = state.contacts[shooter.side][target.id];
    if (!contact || identifyContact(state, shooter.side, contact) === 'FRIEND') {
      return 'TARGET_FRIENDLY';
    }
  }
  const station = shooter.weapons.find((s) => s.weaponId === weapon.id);
  if (!station || station.count <= 0) return 'NO_WEAPON';
  const roeDenial = roeAllows(state, shooter, target);
  if (roeDenial) return roeDenial;
  if (!inEnvelope(state, weapon, shooter, target)) return 'OUT_OF_ENVELOPE';
  if (weapon.requiredTrackQuality !== undefined) {
    const contact = state.contacts[shooter.side][target.id];
    if (!contact || contact.quality < weapon.requiredTrackQuality) return 'NO_TRACK';
  }
  return null;
}
