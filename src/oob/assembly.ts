import type { JammerDef, SimState, Unit, Vec3, WeaponStation } from '../core/types';

/**
 * Order-of-battle & loadout assembly (the Planning Version's force-composition
 * layer — closes the step-5 gap noted in the design doc).
 *
 * The design language is Breach Protocol's gadget system: loadout tradeoffs,
 * not strict upgrades. Every store hung on a hardpoint costs something real
 * in the sim — added radar cross-section (detected earlier by the exact
 * radar equation the IADS uses) and added drag (kg/tick burn against the
 * same bingo-fuel clock). A clean wing is survivable but toothless; a full
 * wing is a bomb truck the early-warning net sees coming.
 *
 * Everything here is pure data + pure functions. `withBluePackage` swaps an
 * assembled package into any scenario's BLUE air OOB, and the reference
 * package reproduces the hand-built scenarios bit-for-bit (locked in by
 * test), so the assembly path and the scripted path are provably the same
 * sim.
 */

export interface AirframeDef {
  id: string;
  name: string;
  /** Drives default unit-id prefixes, callsigns, and spawn posture. */
  role: 'STRIKE' | 'SEAD' | 'EW';
  /** Hardpoint station budget — the hard constraint stores compete for. */
  hardpoints: number;
  /** Radar cross-section with nothing hung, m². */
  cleanRcs: number;
  maxSpeed: number;
  internalFuelKg: number;
  /** Burn with a clean wing; every store adds drag on top. */
  baseBurnKgPerTick: number;
  bingoKg: number;
}

export type StoreKind = 'WEAPON' | 'JAMMER_POD' | 'DROP_TANK';

export interface StoreDef {
  id: string;
  name: string;
  kind: StoreKind;
  /** Hardpoint stations consumed. */
  stations: number;
  /** Added radar cross-section, m² — hanging iron makes you easier to see. */
  rcsAdd: number;
  /** Added fuel burn from drag, kg/tick. */
  burnAdd: number;
  /** WEAPON: catalog weapon id and rounds provided. */
  weaponId?: string;
  rounds?: number;
  /** JAMMER_POD: the jammer this pod provides (starts cold). */
  jammer?: Omit<JammerDef, 'active'>;
  /** DROP_TANK: fuel added, kg. */
  fuelKg?: number;
}

export const AIRFRAMES: Record<string, AirframeDef> = {
  'af-ranger': {
    id: 'af-ranger',
    name: 'F/A-21 Ranger (strike)',
    role: 'STRIKE',
    hardpoints: 4,
    cleanRcs: 2,
    maxSpeed: 300,
    internalFuelKg: 5_200,
    baseBurnKgPerTick: 1.2,
    bingoKg: 1_800,
  },
  'af-viper': {
    id: 'af-viper',
    name: 'F/A-21W Viper (SEAD)',
    role: 'SEAD',
    hardpoints: 4,
    cleanRcs: 2,
    maxSpeed: 300,
    internalFuelKg: 5_200,
    baseBurnKgPerTick: 1.2,
    bingoKg: 1_800,
  },
  'af-static': {
    id: 'af-static',
    name: 'EA-11 Static (EW)',
    role: 'EW',
    hardpoints: 3,
    cleanRcs: 6,
    maxSpeed: 250,
    internalFuelKg: 8_000,
    baseBurnKgPerTick: 0.9,
    bingoKg: 2_500,
  },
};

export const STORES: Record<string, StoreDef> = {
  'st-agm-2': {
    id: 'st-agm-2',
    name: 'AGM-77 Stormbreak ×2 rack',
    kind: 'WEAPON',
    stations: 2,
    rcsAdd: 1.0,
    burnAdd: 0.1,
    weaponId: 'agm-stormbreak',
    rounds: 2,
  },
  'st-agm-1': {
    id: 'st-agm-1',
    name: 'AGM-77 Stormbreak ×1',
    kind: 'WEAPON',
    stations: 1,
    rcsAdd: 0.5,
    burnAdd: 0.05,
    weaponId: 'agm-stormbreak',
    rounds: 1,
  },
  'st-arm-2': {
    id: 'st-arm-2',
    name: 'ARM-9 Lance ×2 rack',
    kind: 'WEAPON',
    stations: 2,
    rcsAdd: 1.0,
    burnAdd: 0.1,
    weaponId: 'arm-lance',
    rounds: 2,
  },
  'st-arm-1': {
    id: 'st-arm-1',
    name: 'ARM-9 Lance ×1',
    kind: 'WEAPON',
    stations: 1,
    rcsAdd: 0.5,
    burnAdd: 0.05,
    weaponId: 'arm-lance',
    rounds: 1,
  },
  'st-jampod': {
    id: 'st-jampod',
    name: 'AN/QLP-8 jamming pod',
    kind: 'JAMMER_POD',
    stations: 2,
    rcsAdd: 2.0,
    burnAdd: 0.1,
    jammer: { range: 130_000, strength: 0.65 },
  },
  'st-tank': {
    id: 'st-tank',
    name: 'External tank (1200 kg)',
    kind: 'DROP_TANK',
    stations: 1,
    rcsAdd: 0.5,
    burnAdd: 0.05,
    fuelKg: 1_200,
  },
};

export interface AircraftConfig {
  /** Unit id in the sim — role-prefixed ids keep preset plans addressable. */
  id: string;
  callsign: string;
  airframeId: string;
  /** Store ids hung on the wing (order irrelevant; stations are the budget). */
  stores: string[];
  /** Spawn overrides; omitted fields fall back to role defaults. */
  spawn?: Vec3;
  speed?: number;
}

/** All configuration problems, empty when the jet can fly as configured. */
export function validateConfig(cfg: AircraftConfig): string[] {
  const errors: string[] = [];
  const airframe = AIRFRAMES[cfg.airframeId];
  if (!airframe) return [`unknown airframe '${cfg.airframeId}'`];

  let stations = 0;
  let jammerPods = 0;
  for (const storeId of cfg.stores) {
    const store = STORES[storeId];
    if (!store) {
      errors.push(`unknown store '${storeId}'`);
      continue;
    }
    stations += store.stations;
    if (store.kind === 'JAMMER_POD') jammerPods++;
  }
  if (stations > airframe.hardpoints) {
    errors.push(`${stations} stations used, only ${airframe.hardpoints} hardpoints`);
  }
  if (jammerPods > 1) errors.push('only one jamming pod per airframe');
  return errors;
}

export interface ConfigStats {
  stationsUsed: number;
  hardpoints: number;
  rcs: number;
  burnKgPerTick: number;
  fuelKg: number;
  /** Ticks of gas at cruise burn — the loiter budget the plan spends. */
  enduranceTicks: number;
  weapons: WeaponStation[];
  jammer?: Omit<JammerDef, 'active'>;
}

const round4 = (x: number): number => Math.round(x * 10_000) / 10_000;

/** Computed performance of a (valid) configuration — what the builder shows. */
export function configStats(cfg: AircraftConfig): ConfigStats {
  const airframe = AIRFRAMES[cfg.airframeId];
  if (!airframe) throw new Error(`unknown airframe '${cfg.airframeId}'`);

  let stationsUsed = 0;
  let rcs = airframe.cleanRcs;
  let burn = airframe.baseBurnKgPerTick;
  let fuel = airframe.internalFuelKg;
  const byWeapon: Record<string, number> = {};
  let jammer: Omit<JammerDef, 'active'> | undefined;

  for (const storeId of cfg.stores) {
    const store = STORES[storeId];
    if (!store) throw new Error(`unknown store '${storeId}'`);
    stationsUsed += store.stations;
    rcs += store.rcsAdd;
    burn += store.burnAdd;
    if (store.kind === 'WEAPON') byWeapon[store.weaponId!] = (byWeapon[store.weaponId!] ?? 0) + store.rounds!;
    if (store.kind === 'JAMMER_POD') jammer = store.jammer;
    if (store.kind === 'DROP_TANK') fuel += store.fuelKg!;
  }

  rcs = round4(rcs);
  burn = round4(burn);
  return {
    stationsUsed,
    hardpoints: airframe.hardpoints,
    rcs,
    burnKgPerTick: burn,
    fuelKg: fuel,
    enduranceTicks: Math.floor(fuel / burn),
    // Stable weapon-station order regardless of drag-in order.
    weapons: Object.keys(byWeapon)
      .sort()
      .map((weaponId) => ({ weaponId, count: byWeapon[weaponId]! })),
    ...(jammer ? { jammer } : {}),
  };
}

/** Where the package launches from and recovers to. */
export const HOME_BASE: Vec3 = { x: -160_000, y: 0, alt: 0 };

/** Role defaults: fast movers line up abreast; the EW bird takes a standoff orbit. */
export function defaultSpawn(role: AirframeDef['role'], index: number, packageSize: number): { pos: Vec3; speed: number } {
  if (role === 'EW') {
    return { pos: { x: -110_000, y: 12_000, alt: 10_000 }, speed: 0 };
  }
  const y = (index - (packageSize - 1) / 2) * 6_000;
  return { pos: { x: -140_000, y, alt: 8_000 }, speed: 250 };
}

/** Turn one configuration into a sim unit. Pure; throws on invalid config. */
export function buildAircraft(cfg: AircraftConfig, index = 0, packageSize = 1): Unit {
  const errors = validateConfig(cfg);
  if (errors.length > 0) throw new Error(`invalid config '${cfg.id}': ${errors.join('; ')}`);
  const airframe = AIRFRAMES[cfg.airframeId]!;
  const stats = configStats(cfg);
  const d = defaultSpawn(airframe.role, index, packageSize);

  // Key order mirrors the hand-built scenario helpers so an assembled
  // reference package replays byte-identically (JSON and all).
  return {
    id: cfg.id,
    side: 'BLUE',
    name: cfg.callsign,
    pos: cfg.spawn ? { ...cfg.spawn } : d.pos,
    speed: cfg.speed ?? d.speed,
    maxSpeed: airframe.maxSpeed,
    rcs: stats.rcs,
    sensors: [],
    weapons: stats.weapons,
    ...(stats.jammer ? { jammer: { ...stats.jammer, active: false } } : {}),
    fuelKg: stats.fuelKg,
    burnKgPerTick: stats.burnKgPerTick,
    bingoKg: airframe.bingoKg,
    homeBase: { ...HOME_BASE },
    waypoints: [],
    domain: 'AIR',
    alive: true,
  };
}

/**
 * Swap the assembled package into a scenario: every BLUE fixed-wing unit is
 * replaced by the package (the rescue helicopter and the ground team belong
 * to the scenario, not the package, and are preserved). RED, the weapon
 * catalog, the intel dossier, and the ground op are untouched — the package
 * fights whatever problem the scenario poses.
 */
export function withBluePackage(state: SimState, configs: AircraftConfig[]): SimState {
  const seen = new Set<string>();
  for (const cfg of configs) {
    if (seen.has(cfg.id)) throw new Error(`duplicate unit id '${cfg.id}' in package`);
    seen.add(cfg.id);
  }

  const keepHelo = state.groundOp?.heloUnitId;
  for (const unit of Object.values(state.units)) {
    if (unit.side === 'BLUE' && unit.domain === 'AIR' && unit.id !== keepHelo) {
      delete state.units[unit.id];
    }
  }
  configs.forEach((cfg, i) => {
    state.units[cfg.id] = buildAircraft(cfg, i, configs.length);
  });
  return state;
}

/**
 * The standard package — reproduces the hand-built BLUE OOB of the strike
 * scenarios exactly (locked in by test), so committing it unmodified is the
 * same mission the preset plans were authored against.
 */
export function referencePackage(): AircraftConfig[] {
  return [
    {
      id: 'blue-striker-1',
      callsign: 'Hammer 1',
      airframeId: 'af-ranger',
      stores: ['st-agm-2'],
      spawn: { x: -140_000, y: -3_000, alt: 8_000 },
      speed: 250,
    },
    {
      id: 'blue-striker-2',
      callsign: 'Hammer 2',
      airframeId: 'af-ranger',
      stores: ['st-agm-2'],
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
