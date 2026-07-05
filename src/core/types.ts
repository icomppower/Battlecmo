/**
 * Core data model for the Overwatch Directive deterministic multi-domain sim.
 *
 * Everything the simulation knows lives in SimState. The tick function is a
 * pure function of (state, ordersLog, seed) — no hidden globals, no wall
 * clock, no unseeded randomness — so any run can be replayed exactly from
 * its initial state plus its orders log.
 */

export type Side = 'BLUE' | 'RED';
export type Domain = 'AIR' | 'GROUND' | 'SEA';

/** Positions are meters on a flat local grid; alt is meters above ground level. */
export interface Vec3 {
  x: number;
  y: number;
  alt: number;
}

export type SensorKind = 'RADAR' | 'IR' | 'VISUAL';

export interface SensorDef {
  id: string;
  kind: SensorKind;
  /** Detection range in meters against a target of refRcs square meters. */
  baseRange: number;
  refRcs: number;
  /** Radars can be switched off (EMCON / SEAD reaction); passive sensors are always on. */
  emitting: boolean;
}

export type WeaponKind = 'SAM' | 'AGM' | 'ARM' | 'AAM';

export interface WeaponDef {
  id: string;
  name: string;
  kind: WeaponKind;
  minRange: number;
  maxRange: number;
  /** Envelope in target altitude, meters AGL. */
  minTargetAlt: number;
  maxTargetAlt: number;
  speed: number;
  /** Base single-shot probability of kill, resolved with the seeded RNG. */
  pk: number;
  targetDomains: Domain[];
  /** ARMs home on emitting radars and lose most effectiveness if the emitter goes silent. */
  antiRadiation?: boolean;
  /** SAMs need a live sensor track of at least this quality to launch. */
  requiredTrackQuality?: number;
}

export interface WeaponStation {
  weaponId: string;
  count: number;
}

export interface JammerDef {
  /** Radius in meters within which enemy radars are degraded. */
  range: number;
  /** 0..1 fraction by which affected radar detection range is reduced. */
  strength: number;
  active: boolean;
}

/** Doctrine for how a radar crew reacts to an inbound anti-radiation missile. */
export interface EmitterDoctrine {
  /** If an inbound ARM is detected within this range (m), shut the radar down. */
  armReactionRange: number;
  /** Ticks the radar stays dark after an ARM scare. */
  shutdownTicks: number;
  /**
   * Crew adaptation: each survived ARM scare multiplies the next shutdown
   * window (e.g. 0.5 halves it — they learn the missiles go stupid when they
   * blink, and blink shorter). Omit for a crew that never adapts.
   */
  shutdownDecay?: number;
  /** Floor for the adapted shutdown window. */
  minShutdownTicks?: number;
}

/**
 * Adaptive SAM battery doctrine — the step-3 layer that turns a static
 * launcher into an opponent. All of it is deterministic state-machine
 * behavior; the later nemesis system tunes these numbers between missions.
 */
export interface SamDoctrine {
  /** ACTIVE: radiate continuously. CUED: hold the FCR cold until cued. */
  emcon: 'ACTIVE' | 'CUED';
  /** CUED: light up when an own-side contact is within this range (m). */
  cueRange?: number;
  /** CUED: go cold again after this many ticks without a cue (default 30). */
  coldAfterTicks?: number;
  /** Shoot-and-scoot: relocate after firing this many missiles. */
  scootAfterShots?: number;
  /** Fallback position (consumed on arrival — one relocation per site). */
  scootTo?: Vec3;
  /** March speed while relocating, m/s. */
  scootSpeed?: number;
}

export interface Unit {
  id: string;
  side: Side;
  domain: Domain;
  name: string;
  pos: Vec3;
  /** Current speed in m/s. Ground/static units use 0. */
  speed: number;
  maxSpeed: number;
  /** Radar cross-section in square meters. */
  rcs: number;
  sensors: SensorDef[];
  weapons: WeaponStation[];
  jammer?: JammerDef;
  emitterDoctrine?: EmitterDoctrine;
  samDoctrine?: SamDoctrine;
  /** Radar forced dark until this tick (SEAD suppression / ARM reaction). */
  suppressedUntilTick?: number;
  /** Survived ARM scares — drives EmitterDoctrine.shutdownDecay. */
  armScares?: number;
  /** Missiles fired since last relocation — drives shoot-and-scoot. */
  shotsFired?: number;
  /** Set while a scooting battery is on the march (radar cold, no shooting). */
  relocating?: boolean;
  /** Last tick a CUED battery had a cue inside cueRange. */
  lastCuedTick?: number;
  /** Fuel model — only meaningful for aircraft. */
  fuelKg?: number;
  burnKgPerTick?: number;
  bingoKg?: number;
  homeBase?: Vec3;
  rtb?: boolean;
  waypoints: Vec3[];
  alive: boolean;
  /** How many missiles this unit will keep in the air at once (SAM fire discipline). */
  maxConcurrentEngagements?: number;
}

export interface MissileEntity {
  id: string;
  side: Side;
  weaponId: string;
  shooterId: string;
  targetId: string;
  pos: Vec3;
  alive: boolean;
}

/** What one side's sensors currently believe about an enemy unit. */
export interface Contact {
  targetId: string;
  firstDetectedTick: number;
  lastSeenTick: number;
  /** 0..1; builds while a sensor holds the target, decays when it doesn't. */
  quality: number;
}

/**
 * Rules of engagement — mirrors Breach Protocol's engagement-authority gates.
 * HOLD: no weapon release. TIGHT: only pre-briefed ground targets. FREE: any valid contact.
 */
export type RoeLevel = 'HOLD' | 'TIGHT' | 'FREE';

export type SimEvent =
  | { tick: number; type: 'DETECTION'; side: Side; sensorUnitId: string; targetId: string }
  | { tick: number; type: 'CONTACT_LOST'; side: Side; targetId: string }
  | { tick: number; type: 'LAUNCH'; side: Side; shooterId: string; weaponId: string; targetId: string; missileId: string }
  | { tick: number; type: 'LAUNCH_DENIED'; shooterId: string; targetId: string; reason: LaunchDenialReason }
  | { tick: number; type: 'HIT'; missileId: string; targetId: string }
  | { tick: number; type: 'MISS'; missileId: string; targetId: string }
  | { tick: number; type: 'UNIT_DESTROYED'; unitId: string; byMissileId: string }
  | { tick: number; type: 'EMITTER_SHUTDOWN'; unitId: string; untilTick: number; cause: 'ARM_INBOUND' }
  | { tick: number; type: 'EMITTER_BACK_UP'; unitId: string }
  | { tick: number; type: 'SAM_EMCON'; unitId: string; emitting: boolean }
  | { tick: number; type: 'SAM_RELOCATING'; unitId: string }
  | { tick: number; type: 'SAM_DEPLOYED'; unitId: string }
  | { tick: number; type: 'BINGO_FUEL'; unitId: string }
  | { tick: number; type: 'FUEL_EXHAUSTED'; unitId: string }
  | { tick: number; type: 'JAMMER_SET'; unitId: string; active: boolean }
  | { tick: number; type: 'ROE_SET'; side: Side; level: RoeLevel };

export type LaunchDenialReason =
  | 'ROE_HOLD'
  | 'ROE_TIGHT_NO_PREBRIEF'
  | 'OUT_OF_ENVELOPE'
  | 'NO_TRACK'
  | 'NO_WEAPON'
  | 'TARGET_DEAD'
  | 'SHOOTER_DEAD';

export type Order =
  | { atTick: number; type: 'SET_WAYPOINTS'; unitId: string; waypoints: Vec3[] }
  | { atTick: number; type: 'SET_ROE'; side: Side; level: RoeLevel }
  | { atTick: number; type: 'SET_JAMMER'; unitId: string; active: boolean }
  | { atTick: number; type: 'ENGAGE'; unitId: string; weaponId: string; targetId: string }
  | { atTick: number; type: 'RTB'; unitId: string };

export interface SimState {
  /** Current tick. One tick = one second of mission time. */
  tick: number;
  units: Record<string, Unit>;
  missiles: Record<string, MissileEntity>;
  contacts: Record<Side, Record<string, Contact>>;
  roe: Record<Side, RoeLevel>;
  /** Ground targets each side may strike under TIGHT ROE (pre-briefed DMPIs). */
  prebriefedTargets: Record<Side, string[]>;
  events: SimEvent[];
  /** Monotonic counter for deterministic entity id generation. */
  nextEntitySeq: number;
  weaponCatalog: Record<string, WeaponDef>;
}
