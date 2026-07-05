import type { Order } from '../core/types';
import { referencePackage, type AircraftConfig } from '../oob/assembly';

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

/**
 * Reference package plus two ADM-160 Shrike decoys wearing Luneburg lenses —
 * on every radar scope in the theater they are strikers (3.0 m², strike
 * altitude, inbound heading). Decoy economics in one number: two expendable
 * drones against the battery's entire posture.
 */
export function decoyPackage(): AircraftConfig[] {
  return [
    ...referencePackage(),
    {
      id: 'blue-decoy-1',
      callsign: 'Ghost 1',
      airframeId: 'af-shrike',
      stores: ['st-lens'],
      spawn: { x: -140_000, y: -1_000, alt: 3_000 },
      speed: 200,
    },
    {
      id: 'blue-decoy-2',
      callsign: 'Ghost 2',
      airframeId: 'af-shrike',
      stores: ['st-lens'],
      spawn: { x: -140_000, y: 1_000, alt: 3_000 },
      speed: 200,
    },
  ];
}

/**
 * The decoy sweep against the ADAPTIVE battery — no SEAD shot fired at all.
 * The Shrikes cruise into the cue ring at a believable strike profile
 * (3 000 m — engageable, unlike the 60 m bait, so the battery not only
 * radiates but SHOOTS). Two launches is the battery's own shoot-and-scoot
 * trigger: it goes cold and starts its 7 km march, and the real strikers
 * walk in through a battery that spent its posture on two drones.
 *
 * Timing: decoys cross the 36 km cue ring ~t=520 (104 km at 200 m/s); the
 * battery lights and puts both missiles on them the same tick; t=521 it is
 * relocating (radar cold, cannot shoot, ~875 ticks of march). Strikers dash
 * from the 50 km hold at t=540, release at ~t=635 from 29 km, and the AGMs
 * arrive around t=730 with nothing left awake to object.
 */
export function decoySweepPlan(): Order[] {
  return [
    { atTick: 0, type: 'SET_ROE', side: 'BLUE', level: 'TIGHT' },
    { atTick: 0, type: 'SET_WAYPOINTS', unitId: 'blue-decoy-1', waypoints: [{ x: -20_000, y: -1_000, alt: 3_000 }] },
    { atTick: 0, type: 'SET_WAYPOINTS', unitId: 'blue-decoy-2', waypoints: [{ x: -20_000, y: 1_000, alt: 3_000 }] },
    { atTick: 0, type: 'SET_WAYPOINTS', unitId: 'blue-striker-1', waypoints: [{ x: -50_000, y: -3_000, alt: 8_000 }] },
    { atTick: 0, type: 'SET_WAYPOINTS', unitId: 'blue-striker-2', waypoints: [{ x: -50_000, y: 3_000, alt: 8_000 }] },
    // Dash once the battery has committed on the ghosts and started packing.
    { atTick: 540, type: 'SET_WAYPOINTS', unitId: 'blue-striker-1', waypoints: [{ x: -27_000, y: -3_000, alt: 8_000 }] },
    { atTick: 540, type: 'SET_WAYPOINTS', unitId: 'blue-striker-2', waypoints: [{ x: -27_000, y: 3_000, alt: 8_000 }] },
    { atTick: 635, type: 'ENGAGE', unitId: 'blue-striker-1', weaponId: 'agm-stormbreak', targetId: 'red-hq' },
    { atTick: 636, type: 'ENGAGE', unitId: 'blue-striker-2', weaponId: 'agm-stormbreak', targetId: 'red-hq' },
    { atTick: 640, type: 'SET_WAYPOINTS', unitId: 'blue-striker-1', waypoints: [{ x: -140_000, y: -3_000, alt: 8_000 }] },
    { atTick: 640, type: 'SET_WAYPOINTS', unitId: 'blue-striker-2', waypoints: [{ x: -140_000, y: 3_000, alt: 8_000 }] },
  ];
}

/**
 * Counter-counter to the nemesis's fleet-wide CIWS alert: the escalation
 * package re-armed for SATURATION. The CIWS mount services one inbound per
 * tick and the approach is only ~4 attempts wide, so three Pikes arriving
 * together guarantee a leaker — arithmetic, not luck. The stations come out
 * of hide: Hammer 1 gives up the AGMs it never released anyway, Viper trades
 * two hardpoints and keeps both ARMs.
 */
export function saturationPackage(): AircraftConfig[] {
  const pkg = escalationPackage();
  pkg.find((c) => c.id === 'blue-striker-1')!.stores = ['st-irst', 'st-aam-2', 'st-asm-1'];
  pkg.find((c) => c.id === 'blue-sead-1')!.stores = ['st-arm-2', 'st-asm-1'];
  return pkg;
}

/**
 * The escalation counter-plan with a three-Pike salvo instead of one. The
 * launches are staggered so the missiles arrive back-to-back (~t=311-317):
 * the mount services one inbound per tick, so a compressed stream leaves it
 * at most three attempts per missile — and the third Pike runs out its
 * clock. Three shooters firing the moment they could would instead feed the
 * mount one comfortable engagement at a time, which is what it wants.
 */
export function saturationPlan(): Order[] {
  return [
    ...escalationPlan(),
    { atTick: 10, type: 'ENGAGE', unitId: 'blue-sead-1', weaponId: 'asm-pike', targetId: 'red-corvette-1' },
    { atTick: 55, type: 'ENGAGE', unitId: 'blue-striker-1', weaponId: 'asm-pike', targetId: 'red-corvette-1' },
  ];
}

/**
 * Counter-counter to decoy discrimination: the drones' job changes from
 * missile sponge to EMISSIONS BAIT. A discriminated decoy still cues the
 * battery's radar up (only the launch decision changed) — and a radar that
 * is UP eats a reactive ARM at full Pk with a guaranteed scare window.
 * Sequencing: decoys cue the radar ~t=520, Viper's ARM launches at t=525
 * into a live emitter, the scare lands ~t=607 (240-tick blink), and the
 * strikers dash only AFTER the scare so the battery never gets a shot at
 * anything real.
 */
export function emissionsBaitPlan(): Order[] {
  return [
    { atTick: 0, type: 'SET_ROE', side: 'BLUE', level: 'TIGHT' },
    { atTick: 0, type: 'SET_WAYPOINTS', unitId: 'blue-decoy-1', waypoints: [{ x: -20_000, y: -1_000, alt: 3_000 }] },
    { atTick: 0, type: 'SET_WAYPOINTS', unitId: 'blue-decoy-2', waypoints: [{ x: -20_000, y: 1_000, alt: 3_000 }] },
    { atTick: 0, type: 'SET_WAYPOINTS', unitId: 'blue-sead-1', waypoints: [{ x: -64_000, y: 2_000, alt: 9_000 }] },
    { atTick: 0, type: 'SET_WAYPOINTS', unitId: 'blue-striker-1', waypoints: [{ x: -50_000, y: -3_000, alt: 8_000 }] },
    { atTick: 0, type: 'SET_WAYPOINTS', unitId: 'blue-striker-2', waypoints: [{ x: -50_000, y: 3_000, alt: 8_000 }] },
    // The ghosts have the radar up; put the Lance into a LIVE emitter.
    { atTick: 525, type: 'ENGAGE', unitId: 'blue-sead-1', weaponId: 'arm-lance', targetId: 'red-sam-1' },
    // Dash only after the scare lands (~t=607) — the window is 240 ticks.
    { atTick: 575, type: 'SET_WAYPOINTS', unitId: 'blue-striker-1', waypoints: [{ x: -27_000, y: -3_000, alt: 8_000 }] },
    { atTick: 575, type: 'SET_WAYPOINTS', unitId: 'blue-striker-2', waypoints: [{ x: -27_000, y: 3_000, alt: 8_000 }] },
    { atTick: 670, type: 'ENGAGE', unitId: 'blue-striker-1', weaponId: 'agm-stormbreak', targetId: 'red-hq' },
    { atTick: 671, type: 'ENGAGE', unitId: 'blue-striker-2', weaponId: 'agm-stormbreak', targetId: 'red-hq' },
    { atTick: 675, type: 'SET_WAYPOINTS', unitId: 'blue-striker-1', waypoints: [{ x: -140_000, y: -3_000, alt: 8_000 }] },
    { atTick: 675, type: 'SET_WAYPOINTS', unitId: 'blue-striker-2', waypoints: [{ x: -140_000, y: 3_000, alt: 8_000 }] },
  ];
}

/**
 * Counter-counter to the fjord gap-filler: it is an EMITTER, and it told
 * BLUE where it lives by radiating (the m3 dossier carries the CONTESTED
 * ELINT fix, cleared for SEAD under TIGHT). One pre-planned Lance from a
 * standoff Viper scares it dark (~t=77, 240-tick window) and the corridor
 * reopens; the strikers simply wait out the ARM's flight before entering.
 */
export function fjordSeadPackage(): AircraftConfig[] {
  return [
    {
      id: 'blue-striker-1',
      callsign: 'Hammer 1',
      airframeId: 'af-ranger',
      stores: ['st-agm-2'],
      spawn: { x: -52_000, y: 10_000, alt: 120 },
      speed: 250,
    },
    {
      id: 'blue-striker-2',
      callsign: 'Hammer 2',
      airframeId: 'af-ranger',
      stores: ['st-agm-2'],
      spawn: { x: -52_000, y: 12_000, alt: 120 },
      speed: 250,
    },
    {
      id: 'blue-sead-1',
      callsign: 'Viper (SEAD)',
      airframeId: 'af-viper',
      stores: ['st-arm-2'],
      spawn: { x: -80_000, y: 10_000, alt: 9_000 },
      speed: 0,
    },
  ];
}

export function fjordSeadPlan(): Order[] {
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
    // The Lance flies first; the scare lands ~t=77 and buys 240 ticks.
    { atTick: 0, type: 'ENGAGE', unitId: 'blue-sead-1', weaponId: 'arm-lance', targetId: 'red-gapfill-1' },
    // Enter the corridor only after the gap-filler is dark.
    { atTick: 90, type: 'SET_WAYPOINTS', unitId: 'blue-striker-1', waypoints: corridor },
    { atTick: 100, type: 'SET_WAYPOINTS', unitId: 'blue-striker-2', waypoints: corridor },
    { atTick: 230, type: 'ENGAGE', unitId: 'blue-striker-1', weaponId: 'agm-stormbreak', targetId: 'red-hq' },
    { atTick: 231, type: 'ENGAGE', unitId: 'blue-striker-1', weaponId: 'agm-stormbreak', targetId: 'red-hq' },
    { atTick: 235, type: 'SET_WAYPOINTS', unitId: 'blue-striker-1', waypoints: egress },
    { atTick: 245, type: 'SET_WAYPOINTS', unitId: 'blue-striker-2', waypoints: egress },
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
