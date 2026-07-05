import type { Order } from '../core/types';
import type { AircraftConfig } from '../oob/assembly';

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

/**
 * Counter to the ADAPTIVE IADS (strike-adaptive scenario). The pre-planned
 * SEAD shot of goodPlan is wasted there — the CUED battery keeps its radar
 * cold, eats the ARM at quarter-Pk, and lights up only when the strikers are
 * already inside its engagement ring.
 *
 * The counter is doctrinal, not just retimed: Hammer 1 ingresses on the deck
 * (60 m — *below* the SAM's 100 m minimum engagement altitude) to force a
 * cue the battery can see but cannot shoot. The radar comes up (~t=418),
 * Viper's ARM launches reactively against a radiating emitter (t=430), the
 * scare drops it dark (~t=513–753), and Hammer 2 dashes and releases inside
 * that window while the bait runs out low.
 */
export function baitAndBlinkPlan(): Order[] {
  return [
    { atTick: 0, type: 'SET_ROE', side: 'BLUE', level: 'TIGHT' },
    { atTick: 0, type: 'SET_JAMMER', unitId: 'blue-ea-1', active: true },
    { atTick: 0, type: 'SET_WAYPOINTS', unitId: 'blue-sead-1', waypoints: [{ x: -64_000, y: 2_000, alt: 9_000 }] },
    // Hammer 1 is the bait: descend outside the cue ring, creep in at 60 m.
    { atTick: 0, type: 'SET_WAYPOINTS', unitId: 'blue-striker-1', waypoints: [
      { x: -50_000, y: -3_000, alt: 60 },
      { x: -33_000, y: -3_000, alt: 60 },
    ] },
    { atTick: 0, type: 'SET_WAYPOINTS', unitId: 'blue-striker-2', waypoints: [{ x: -50_000, y: 3_000, alt: 8_000 }] },
    // Reactive SEAD: the radar is up by now, so this ARM finds a live emitter.
    { atTick: 430, type: 'ENGAGE', unitId: 'blue-sead-1', weaponId: 'arm-lance', targetId: 'red-sam-1' },
    // Dash and release inside the blink window.
    { atTick: 515, type: 'SET_WAYPOINTS', unitId: 'blue-striker-2', waypoints: [{ x: -27_000, y: 3_000, alt: 8_000 }] },
    { atTick: 615, type: 'ENGAGE', unitId: 'blue-striker-2', weaponId: 'agm-stormbreak', targetId: 'red-hq' },
    { atTick: 616, type: 'ENGAGE', unitId: 'blue-striker-2', weaponId: 'agm-stormbreak', targetId: 'red-hq' },
    { atTick: 620, type: 'SET_WAYPOINTS', unitId: 'blue-striker-2', waypoints: [{ x: -140_000, y: 3_000, alt: 8_000 }] },
    { atTick: 620, type: 'SET_WAYPOINTS', unitId: 'blue-striker-1', waypoints: [
      { x: -60_000, y: -3_000, alt: 60 },
      { x: -140_000, y: -3_000, alt: 8_000 },
    ] },
  ];
}

/**
 * Full rescue-op plan (rescue-op scenario): bait-and-blink air war, with the
 * two extra DMPIs and the ground timeline threaded through it —
 *
 *   air:    bait low (t0) → radar up (~418) → reactive ARM (430) → blink
 *           (~513–753) → Hammer 2 releases on the C2 node (615) → bait
 *           creeps south and kills the MANPADS guard so the LZ is safe
 *   ground: team infils from t0 → holds AT_TARGET until the C2 node dies
 *           (~713, the go-code) → breach 730 → secured 820 (deadline 1000)
 *           → exfil to LZ → helo (launched t300, nap-of-the-earth) boards
 *           them (~1003) → out west (~1514)
 */
export function rescuePlan(): Order[] {
  return [
    { atTick: 0, type: 'SET_ROE', side: 'BLUE', level: 'TIGHT' },
    { atTick: 0, type: 'SET_JAMMER', unitId: 'blue-ea-1', active: true },
    { atTick: 0, type: 'GROUND_INFIL' },
    { atTick: 0, type: 'SET_WAYPOINTS', unitId: 'blue-sead-1', waypoints: [{ x: -64_000, y: 2_000, alt: 9_000 }] },
    { atTick: 0, type: 'SET_WAYPOINTS', unitId: 'blue-striker-1', waypoints: [
      { x: -50_000, y: -3_000, alt: 60 },
      { x: -33_000, y: -3_000, alt: 60 },
    ] },
    { atTick: 0, type: 'SET_WAYPOINTS', unitId: 'blue-striker-2', waypoints: [{ x: -50_000, y: 3_000, alt: 8_000 }] },
    { atTick: 300, type: 'SET_WAYPOINTS', unitId: 'blue-helo-1', waypoints: [{ x: 500, y: -13_500, alt: 30 }] },
    { atTick: 430, type: 'ENGAGE', unitId: 'blue-sead-1', weaponId: 'arm-lance', targetId: 'red-sam-1' },
    { atTick: 515, type: 'SET_WAYPOINTS', unitId: 'blue-striker-2', waypoints: [{ x: -27_000, y: 3_000, alt: 8_000 }] },
    // The bait repositions south (still on the deck) to service the MANPADS.
    { atTick: 520, type: 'SET_WAYPOINTS', unitId: 'blue-striker-1', waypoints: [{ x: -20_000, y: -9_000, alt: 60 }] },
    { atTick: 585, type: 'ENGAGE', unitId: 'blue-striker-1', weaponId: 'agm-stormbreak', targetId: 'red-guard-1' },
    { atTick: 586, type: 'ENGAGE', unitId: 'blue-striker-1', weaponId: 'agm-stormbreak', targetId: 'red-guard-1' },
    { atTick: 615, type: 'ENGAGE', unitId: 'blue-striker-2', weaponId: 'agm-stormbreak', targetId: 'red-hq' },
    { atTick: 616, type: 'ENGAGE', unitId: 'blue-striker-2', weaponId: 'agm-stormbreak', targetId: 'red-hq' },
    { atTick: 620, type: 'SET_WAYPOINTS', unitId: 'blue-striker-2', waypoints: [{ x: -140_000, y: 3_000, alt: 8_000 }] },
    { atTick: 730, type: 'GROUND_BREACH' },
    { atTick: 825, type: 'GROUND_EXFIL' },
    { atTick: 900, type: 'SET_WAYPOINTS', unitId: 'blue-striker-1', waypoints: [
      { x: -60_000, y: -9_000, alt: 60 },
      { x: -140_000, y: -3_000, alt: 8_000 },
    ] },
    { atTick: 1_010, type: 'SET_WAYPOINTS', unitId: 'blue-helo-1', waypoints: [{ x: -40_000, y: 10_000, alt: 30 }] },
  ];
}

/** Ground op with no air support: the breach gate never opens, the clock runs out. */
export function rescueNoStrikePlan(): Order[] {
  return [
    { atTick: 0, type: 'GROUND_INFIL' },
    { atTick: 500, type: 'GROUND_BREACH' }, // denied — alarm net still up
  ];
}

/** Send the helo to the LZ without killing the MANPADS guard first. */
export function heloRecklessPlan(): Order[] {
  return [
    { atTick: 0, type: 'SET_WAYPOINTS', unitId: 'blue-helo-1', waypoints: [{ x: 500, y: -13_500, alt: 30 }] },
  ];
}

/**
 * Force composition for the escalation scenario — this mission is unwinnable
 * with the reference package; the counters are hung on the wing:
 *
 *   Hammer 1: IRST pod + AAM rack + AGM rack — passive-kill self-escort.
 *   Hammer 2: anti-ship missile + AGM rack — clears the corvette, then flies
 *             the masked ridge corridor on the deck.
 */
export function escalationPackage(): AircraftConfig[] {
  return [
    {
      id: 'blue-striker-1',
      callsign: 'Hammer 1',
      airframeId: 'af-ranger',
      stores: ['st-irst', 'st-aam-2', 'st-agm-2'],
      spawn: { x: -140_000, y: -3_000, alt: 8_000 },
      speed: 250,
    },
    {
      id: 'blue-striker-2',
      callsign: 'Hammer 2',
      airframeId: 'af-ranger',
      stores: ['st-asm-1', 'st-agm-2'],
      spawn: { x: -140_000, y: 3_000, alt: 8_000 },
      speed: 250,
    },
    {
      id: 'blue-sead-1',
      callsign: 'Viper (SEAD)',
      airframeId: 'af-viper',
      stores: ['st-arm-2'],
      spawn: { x: -140_000, y: 2_000, alt: 9_000 },
      speed: 250,
    },
    {
      id: 'blue-ea-1',
      callsign: 'Static (EW)',
      airframeId: 'af-static',
      stores: ['st-jampod'],
      spawn: { x: -110_000, y: 12_000, alt: 10_000 },
      speed: 0,
    },
  ];
}

/**
 * The escalation counter-plan, one move per new threat layer:
 *
 *   SEA:     Pike launched on the 6-h-old APPROX fix at t=5 (the missile's
 *            seeker makes up the dossier's error); the corvette is on the
 *            bottom before Hammer 2 crosses its SAM ring.
 *   AIR:     Hammer 1 closes to IRST range of the CONTESTED CAP station,
 *            builds a passive track (nothing radiates — no warning), the
 *            side goes weapons-free at t=300 (the decision point), and a
 *            Dart takes the fighter head-on.
 *   TERRAIN: Hammer 2 drops to 60 m behind the Koro ridge — masked from
 *            every IADS ground radar — and pops out inside the SAM's cue
 *            ring but below its 100 m engagement floor. The radar comes up,
 *            Viper's reactive ARM forces the blink, and the AGMs release
 *            inside it.
 */
/**
 * ISR variant of the escalation package: the same four-ship plus Watchtower,
 * an E-9 Sentry parked in a deep standoff orbit. Two apertures, two limits:
 * the air-search radar sees only the air battle (245 km vs the CAP), and the
 * GMTI radar sees only surface targets that are MOVING — the corvette under
 * way and the SAM battery *while it displaces*, never a battery in its hide.
 * ISR informs the hunt; it does not finish it. And the rotodome radiates all
 * mission — the enemy's next staff read will notice (see the nemesis).
 */
export function sensorWarPackage(): AircraftConfig[] {
  return [
    ...escalationPackage(),
    {
      id: 'blue-awacs-1',
      callsign: 'Watchtower',
      airframeId: 'af-sentry',
      stores: ['st-airsearch', 'st-gmti'],
      spawn: { x: -120_000, y: -14_000, alt: 9_500 },
      speed: 0,
    },
  ];
}

/** The escalation counter-plan flown with the ISR picture up. */
export function sensorWarPlan(): Order[] {
  return escalationPlan(); // Watchtower needs no orders — its orbit IS the plan
}

/**
 * The fjord run (strike-fjord, real Romsdal terrain): thread the radar
 * shadow the elevation data actually contains. The corridor waypoints came
 * out of a BFS over the masked-water cells of the baked heightfield — this
 * route exists in Norway, not in the scenario author's imagination. Release
 * from the shadow at ~28 km and the SAM never gets the track its doctrine
 * needs; terrain denies the track, not the shot.
 */
export function fjordPlan(): Order[] {
  const corridor = [
    { x: -50_500, y: 11_000, alt: 120 },
    { x: -45_500, y: 12_000, alt: 120 },
    { x: -40_000, y: 12_000, alt: 120 },
    { x: -34_000, y: 12_000, alt: 120 },
    { x: -28_500, y: 12_000, alt: 120 },
    { x: -22_500, y: 12_000, alt: 120 },
    { x: -22_500, y: 11_000, alt: 120 },
  ];
  const egress = [...corridor].reverse().concat([{ x: -140_000, y: 10_000, alt: 120 }]);
  return [
    { atTick: 0, type: 'SET_ROE', side: 'BLUE', level: 'TIGHT' },
    { atTick: 0, type: 'SET_WAYPOINTS', unitId: 'blue-striker-1', waypoints: corridor },
    { atTick: 10, type: 'SET_WAYPOINTS', unitId: 'blue-striker-2', waypoints: corridor },
    { atTick: 140, type: 'ENGAGE', unitId: 'blue-striker-1', weaponId: 'agm-stormbreak', targetId: 'red-hq' },
    { atTick: 141, type: 'ENGAGE', unitId: 'blue-striker-1', weaponId: 'agm-stormbreak', targetId: 'red-hq' },
    { atTick: 145, type: 'SET_WAYPOINTS', unitId: 'blue-striker-1', waypoints: egress },
    { atTick: 155, type: 'SET_WAYPOINTS', unitId: 'blue-striker-2', waypoints: egress },
  ];
}

export function escalationPlan(): Order[] {
  return [
    { atTick: 0, type: 'SET_ROE', side: 'BLUE', level: 'TIGHT' },
    { atTick: 0, type: 'SET_JAMMER', unitId: 'blue-ea-1', active: true },
    { atTick: 0, type: 'SET_WAYPOINTS', unitId: 'blue-sead-1', waypoints: [{ x: -64_000, y: 2_000, alt: 9_000 }] },
    // Hammer 1 climbs toward the CAP's real neighborhood, stopping outside
    // the fighter's jammed radar but inside IRST range.
    { atTick: 0, type: 'SET_WAYPOINTS', unitId: 'blue-striker-1', waypoints: [{ x: -68_000, y: 14_000, alt: 8_000 }] },
    // Hammer 2 stages southwest, outside the corvette's ring.
    { atTick: 0, type: 'SET_WAYPOINTS', unitId: 'blue-striker-2', waypoints: [{ x: -95_000, y: -30_000, alt: 8_000 }] },
    // SEA: standoff anti-ship shot on the briefed patrol box.
    { atTick: 5, type: 'ENGAGE', unitId: 'blue-striker-2', weaponId: 'asm-pike', targetId: 'red-corvette-1' },
    // AIR: weapons-free is a command decision — the CAP is not pre-briefed.
    { atTick: 300, type: 'SET_ROE', side: 'BLUE', level: 'FREE' },
    { atTick: 395, type: 'ENGAGE', unitId: 'blue-striker-1', weaponId: 'aam-dart', targetId: 'red-cap-1' },
    { atTick: 420, type: 'ENGAGE', unitId: 'blue-striker-1', weaponId: 'aam-dart', targetId: 'red-cap-1' },
    // TERRAIN: the deck run behind the Koro ridge — parallel the crest on
    // its masked (northwest) side, round the northern tip at (-30,-6), and
    // pop out inside the cue ring but under the SAM's 100 m floor. The
    // route never crosses the crest segment: at 60 m that would be rock.
    { atTick: 400, type: 'SET_WAYPOINTS', unitId: 'blue-striker-2', waypoints: [
      { x: -45_000, y: -18_000, alt: 60 },
      { x: -36_000, y: -9_500, alt: 60 },
      { x: -31_000, y: -3_000, alt: 60 },
      { x: -26_000, y: -5_000, alt: 60 },
    ] },
    // Reactive SEAD once the corridor exit cues the battery up.
    { atTick: 700, type: 'ENGAGE', unitId: 'blue-sead-1', weaponId: 'arm-lance', targetId: 'red-sam-1' },
    { atTick: 800, type: 'ENGAGE', unitId: 'blue-striker-2', weaponId: 'agm-stormbreak', targetId: 'red-hq' },
    { atTick: 801, type: 'ENGAGE', unitId: 'blue-striker-2', weaponId: 'agm-stormbreak', targetId: 'red-hq' },
    // Egress: back out the way the terrain allows — around the tip again.
    { atTick: 810, type: 'SET_WAYPOINTS', unitId: 'blue-striker-2', waypoints: [
      { x: -31_000, y: -3_000, alt: 60 },
      { x: -36_000, y: -9_500, alt: 60 },
      { x: -45_000, y: -18_000, alt: 60 },
      { x: -140_000, y: 3_000, alt: 8_000 },
    ] },
    { atTick: 500, type: 'SET_WAYPOINTS', unitId: 'blue-striker-1', waypoints: [{ x: -140_000, y: -3_000, alt: 8_000 }] },
    { atTick: 900, type: 'RTB', unitId: 'blue-sead-1' },
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
