import type { Order } from '../src/core/types.js';

/**
 * Scripted mission plans against the strike-basic scenario. These are what
 * the Planning layer will eventually author interactively; here they are
 * hand-built order logs proving the core mechanics out.
 *
 * Timing sketch for the good plan (speeds are constant, so arrival ticks are
 * exact): SEAD shooter covers 76 km at 250 m/s and is on station ~t=304; its
 * ARM crosses into the SAM's 15 km reaction range ~t=392, forcing a 240-tick
 * radar shutdown (until ~t=632). The strikers hold at 50 km, dash at t=400,
 * release at t=500 from ~29 km, and are back outside the 40 km threat ring
 * ~t=557 — comfortably inside the suppression window.
 */
export function goodPlan(): Order[] {
  return [
    { atTick: 0, type: 'SET_ROE', side: 'BLUE', level: 'TIGHT' },
    { atTick: 0, type: 'SET_JAMMER', unitId: 'blue-ea-1', active: true },
    { atTick: 0, type: 'SET_WAYPOINTS', unitId: 'blue-sead-1', waypoints: [{ x: -64_000, y: 2_000, alt: 9_000 }] },
    { atTick: 0, type: 'SET_WAYPOINTS', unitId: 'blue-striker-1', waypoints: [{ x: -50_000, y: -3_000, alt: 8_000 }] },
    { atTick: 0, type: 'SET_WAYPOINTS', unitId: 'blue-striker-2', waypoints: [{ x: -50_000, y: 3_000, alt: 8_000 }] },
    // SEAD shot opens the corridor.
    { atTick: 310, type: 'ENGAGE', unitId: 'blue-sead-1', weaponId: 'arm-lance', targetId: 'red-sam-1' },
    // Dash once the radar is down.
    { atTick: 400, type: 'SET_WAYPOINTS', unitId: 'blue-striker-1', waypoints: [{ x: -27_000, y: -3_000, alt: 8_000 }] },
    { atTick: 400, type: 'SET_WAYPOINTS', unitId: 'blue-striker-2', waypoints: [{ x: -27_000, y: 3_000, alt: 8_000 }] },
    // Release and egress.
    { atTick: 500, type: 'ENGAGE', unitId: 'blue-striker-1', weaponId: 'agm-stormbreak', targetId: 'red-hq' },
    { atTick: 500, type: 'ENGAGE', unitId: 'blue-striker-2', weaponId: 'agm-stormbreak', targetId: 'red-hq' },
    { atTick: 505, type: 'SET_WAYPOINTS', unitId: 'blue-striker-1', waypoints: [{ x: -140_000, y: -3_000, alt: 8_000 }] },
    { atTick: 505, type: 'SET_WAYPOINTS', unitId: 'blue-striker-2', waypoints: [{ x: -140_000, y: 3_000, alt: 8_000 }] },
  ];
}

/** No jamming, no SEAD — fly straight at the target and hope. */
export function naivePlan(): Order[] {
  return [
    { atTick: 0, type: 'SET_ROE', side: 'BLUE', level: 'TIGHT' },
    { atTick: 0, type: 'SET_WAYPOINTS', unitId: 'blue-striker-1', waypoints: [{ x: -27_000, y: -3_000, alt: 8_000 }] },
    { atTick: 0, type: 'SET_WAYPOINTS', unitId: 'blue-striker-2', waypoints: [{ x: -27_000, y: 3_000, alt: 8_000 }] },
    { atTick: 455, type: 'ENGAGE', unitId: 'blue-striker-1', weaponId: 'agm-stormbreak', targetId: 'red-hq' },
    { atTick: 455, type: 'ENGAGE', unitId: 'blue-striker-2', weaponId: 'agm-stormbreak', targetId: 'red-hq' },
    { atTick: 460, type: 'SET_WAYPOINTS', unitId: 'blue-striker-1', waypoints: [{ x: -140_000, y: -3_000, alt: 8_000 }] },
    { atTick: 460, type: 'SET_WAYPOINTS', unitId: 'blue-striker-2', waypoints: [{ x: -140_000, y: 3_000, alt: 8_000 }] },
  ];
}

/** Jamming shortens the early-warning picture but nobody shuts the SAM up. */
export function jamOnlyPlan(): Order[] {
  return [
    { atTick: 0, type: 'SET_ROE', side: 'BLUE', level: 'TIGHT' },
    { atTick: 0, type: 'SET_JAMMER', unitId: 'blue-ea-1', active: true },
    { atTick: 0, type: 'SET_WAYPOINTS', unitId: 'blue-striker-1', waypoints: [{ x: -27_000, y: -3_000, alt: 8_000 }] },
    { atTick: 0, type: 'SET_WAYPOINTS', unitId: 'blue-striker-2', waypoints: [{ x: -27_000, y: 3_000, alt: 8_000 }] },
    { atTick: 455, type: 'ENGAGE', unitId: 'blue-striker-1', weaponId: 'agm-stormbreak', targetId: 'red-hq' },
    { atTick: 455, type: 'ENGAGE', unitId: 'blue-striker-2', weaponId: 'agm-stormbreak', targetId: 'red-hq' },
  ];
}
