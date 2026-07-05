import type { SimState } from '../core/types';
import { buildStrikeScenario } from './strike-basic';

/**
 * Step-3 variant of the reference scenario: same order of battle, same
 * geometry, but the SAM battery fights back doctrinally.
 *
 *  - EMCON: the fire-control radar starts cold and only lights up when the
 *    IADS holds a contact inside 36 km. A pre-planned ARM shot arrives at a
 *    silent radar: no scare, no suppression window, ~quarter Pk. The static
 *    scenario's winning plan stops working here.
 *  - Shoot-and-scoot: after two launches the battery goes cold and displaces
 *    ~7 km to a prepared fallback site; it cannot shoot on the march.
 *  - Crew adaptation: each survived ARM scare halves the next shutdown
 *    window (floor 45 s) — repeated SEAD bluffs pay out less each time.
 *
 * The counter is reactive SEAD: make the battery radiate (something has to
 * enter the cue ring), shoot the ARM *while it's up*, and use the blink or
 * the scoot as the release window.
 */
export function buildAdaptiveStrikeScenario(): SimState {
  const s = buildStrikeScenario();
  const sam = s.units['red-sam-1']!;

  for (const r of sam.sensors) r.emitting = false; // starts cold
  sam.samDoctrine = {
    emcon: 'CUED',
    cueRange: 36_000,
    coldAfterTicks: 30,
    scootAfterShots: 2,
    scootTo: { x: 6_000, y: -5_000, alt: 5 },
    scootSpeed: 8,
  };
  sam.emitterDoctrine = {
    armReactionRange: 15_000,
    shutdownTicks: 240,
    shutdownDecay: 0.5,
    minShutdownTicks: 45,
  };

  return s;
}
