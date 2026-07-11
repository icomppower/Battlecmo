import type { SimState, Unit, WeaponDef } from '../core/types';

/**
 * The HVU escort problem (triage item E — naval catalog expansion). A RED
 * supply ship is the objective: unarmed, unsensored, worth nothing to shoot
 * at directly. What makes it hard is the escort standing next to it — a
 * frigate whose SAM ring is drawn from ITS position, and since the two sail
 * in close company, that ring covers the HVU as surely as it covers the
 * frigate itself.
 *
 * The trap: the only weapon BLUE has that can put the supply ship on the
 * bottom (asm-harpoon, 24 km) is shorter-legged than the frigate's SAM ring
 * (34 km). There is no standoff distance that is simultaneously inside
 * harpoon range of the HVU and outside the SAM's engagement envelope — a
 * naive standoff shot is a contradiction in terms here, not a discipline
 * failure. The counter is the same SEAD choreography as the land IADS,
 * moved to the SEA domain: an anti-radiation weapon (arm-triton) outranges
 * the SAM ring, so a SEAD shooter can force the frigate's radar dark from
 * total safety; the harpoon shooter dashes into the blind window and sinks
 * the HVU before the radar ever gets a track on it.
 */

export const NEW_WEAPONS: Record<string, WeaponDef> = {
  'sam-bastion': {
    id: 'sam-bastion',
    name: 'SA-N-20 Bastion (naval)',
    kind: 'SAM',
    minRange: 2_000,
    maxRange: 34_000, // longer ring than the corvette's sam-palisade (25 000)
    minTargetAlt: 20,
    maxTargetAlt: 10_000,
    speed: 750,
    pk: 0.62,
    targetDomains: ['AIR'],
    requiredTrackQuality: 0.5,
  },
  'asm-harpoon': {
    id: 'asm-harpoon',
    name: 'ASM-6 Harpoon',
    kind: 'ASM',
    minRange: 3_000,
    // Deliberately shorter than sam-bastion's ring — there is no release
    // point that is in weapon range of the HVU and out of the SAM's reach.
    maxRange: 24_000,
    minTargetAlt: 0,
    maxTargetAlt: 60,
    speed: 280,
    pk: 0.75,
    targetDomains: ['SEA'],
  },
  'arm-triton': {
    id: 'arm-triton',
    name: 'ARM-14 Triton (anti-ship SEAD)',
    kind: 'ARM',
    minRange: 5_000,
    // Outranges sam-bastion by design — the SEAD shot is fired from total
    // safety, exactly like arm-lance versus the land SAM.
    maxRange: 60_000,
    minTargetAlt: 0,
    maxTargetAlt: 60,
    speed: 600,
    pk: 0.7,
    targetDomains: ['SEA'],
    antiRadiation: true,
  },
};

function aircraft(partial: Omit<Unit, 'alive' | 'domain'>): Unit {
  return { ...partial, domain: 'AIR', alive: true };
}

export function buildConvoyScenario(): SimState {
  const units: Record<string, Unit> = {};

  // ---- RED: the convoy, escort in close company with the HVU ----
  units['red-frigate-1'] = {
    id: 'red-frigate-1',
    side: 'RED',
    domain: 'SEA',
    name: 'Bastion frigate',
    pos: { x: 0, y: 0, alt: 14 }, // mast-height sensors
    speed: 5,
    maxSpeed: 16,
    rcs: 220,
    sensors: [{ id: 'search-radar', kind: 'RADAR', baseRange: 90_000, refRcs: 5, emitting: true }],
    weapons: [{ weaponId: 'sam-bastion', count: 8 }],
    maxConcurrentEngagements: 2,
    // No CIWS — the frigate trades point defense for its longer SAM ring.
    emitterDoctrine: { armReactionRange: 14_000, shutdownTicks: 240 },
    waypoints: [
      { x: 3_000, y: -1_500, alt: 14 },
      { x: -1_000, y: 2_000, alt: 14 },
    ],
    alive: true,
  };

  units['red-supply-1'] = {
    id: 'red-supply-1',
    side: 'RED',
    domain: 'SEA',
    name: 'Karsk (supply ship, HVU)',
    pos: { x: 4_000, y: 500, alt: 10 },
    speed: 5,
    maxSpeed: 12,
    rcs: 450, // a big, unstealthy hull — a high-value unit, not a warship
    sensors: [],
    weapons: [], // minimal armament — the frigate is the only defense it has
    waypoints: [
      { x: 7_000, y: -1_000, alt: 10 },
      { x: 3_000, y: 1_500, alt: 10 },
    ],
    alive: true,
  };

  // ---- BLUE: a harpoon shooter and a SEAD shooter, staged west ----
  const homeBase = { x: -160_000, y: 0, alt: 0 };

  units['blue-striker-1'] = aircraft({
    id: 'blue-striker-1',
    side: 'BLUE',
    name: 'Hammer 1',
    pos: { x: -140_000, y: -3_000, alt: 8_000 },
    speed: 250,
    maxSpeed: 300,
    rcs: 3,
    sensors: [],
    weapons: [{ weaponId: 'asm-harpoon', count: 2 }],
    fuelKg: 5_200,
    burnKgPerTick: 1.3,
    bingoKg: 1_800,
    homeBase: { ...homeBase },
    waypoints: [],
  });

  units['blue-sead-1'] = aircraft({
    id: 'blue-sead-1',
    side: 'BLUE',
    name: 'Viper (naval SEAD)',
    pos: { x: -140_000, y: 3_000, alt: 9_000 },
    speed: 250,
    maxSpeed: 300,
    rcs: 3,
    sensors: [],
    weapons: [{ weaponId: 'arm-triton', count: 2 }],
    fuelKg: 5_200,
    burnKgPerTick: 1.3,
    bingoKg: 1_800,
    homeBase: { ...homeBase },
    waypoints: [],
  });

  return {
    tick: 0,
    units,
    missiles: {},
    contacts: { BLUE: {}, RED: {} },
    roe: { BLUE: 'HOLD', RED: 'FREE' },
    prebriefedTargets: { BLUE: ['red-frigate-1', 'red-supply-1'], RED: [] },
    events: [],
    nextEntitySeq: 1,
    weaponCatalog: NEW_WEAPONS,
    intel: {
      'red-frigate-1': {
        unitId: 'red-frigate-1',
        confidence: 'VERIFIED',
        briefedPos: { x: 0, y: 0, alt: 14 },
        note: 'Escort frigate, continuous search radar — the SAM ring to plan around.',
      },
      'red-supply-1': {
        unitId: 'red-supply-1',
        confidence: 'VERIFIED',
        briefedPos: { x: 4_000, y: 500, alt: 10 },
        note: 'The objective. Unarmed — the frigate is doing all the work.',
      },
    },
  };
}
