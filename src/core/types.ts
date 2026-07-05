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

export type WeaponKind = 'SAM' | 'AGM' | 'ARM' | 'AAM' | 'ASM';

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
  /**
   * CUED: ignore contacts below this altitude when deciding to light up.
   * This is the nemesis counter to low-altitude bait runs — a crew that got
   * burned radiating at an unengageable target stops taking that cue.
   */
  cueMinAlt?: number;
  /** CUED: go cold again after this many ticks without a cue (default 30). */
  coldAfterTicks?: number;
  /** Shoot-and-scoot: relocate after firing this many missiles. */
  scootAfterShots?: number;
  /** Fallback position (consumed on arrival — one relocation per site). */
  scootTo?: Vec3;
  /** March speed while relocating, m/s. */
  scootSpeed?: number;
}

/**
 * Combat-air-patrol doctrine: hold a station, commit on hostile air tracks
 * inside the commit ring, pursue, and fall back to the station when the
 * track dies. Deterministic state machine, like the SAM doctrine — the
 * nemesis layer can tune these numbers between missions.
 */
export interface CapDoctrine {
  station: Vec3;
  /** Commit on contacts within this range of the station (not of the jet). */
  commitRange: number;
  /** Ignore contacts below this altitude — they're under the AAM floor anyway. */
  commitMinAlt?: number;
  cruiseSpeed: number;
  dashSpeed: number;
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
  capDoctrine?: CapDoctrine;
  /** Target id a CAP fighter is currently committed against. */
  committedTargetId?: string;
  /**
   * 0..1 — how much of an enemy jammer's strength this unit's radars shrug
   * off (frequency agility / burn-through upgrades). Nemesis-tunable.
   */
  jamResistance?: number;
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

/**
 * A terrain ridge: a vertical crest segment that masks line of sight passing
 * below its height. Terrain masking is deterministic geometry, same as the
 * rest of the sensor model — a corridor behind a ridge is knowable in the
 * planning layer, not discovered by dying.
 */
export interface Ridge {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Crest height, meters AGL. */
  height: number;
}

/**
 * Intel dossier confidence — the briefing model from the design doc.
 * VERIFIED: the dossier position is truth at mission start. APPROX: real
 * site, position uncertain (patrolling/relocatable). CONTESTED: single-source
 * ELINT; the site may not be where the dossier puts it at all.
 */
export type IntelConfidence = 'VERIFIED' | 'APPROX' | 'CONTESTED';

export interface IntelEntry {
  unitId: string;
  confidence: IntelConfidence;
  /** Where the dossier places it — may be wrong for APPROX/CONTESTED. */
  briefedPos: Vec3;
  /** Uncertainty radius for the planning map, meters. */
  uncertaintyRadius?: number;
  /** One-line analyst note shown in the dossier panel. */
  note?: string;
}

// ---------------------------------------------------------------------------
// Ground extraction layer (build order step 4) — the Breach Protocol tie-in.
// The ground team is imported as a roster, runs a phase machine on the same
// mission clock as the air war, and is coupled to it in both directions:
// the breach is gated on the strike (alarm net down) and the exfil helicopter
// is gated on the threat picture the air war shaped.
// ---------------------------------------------------------------------------

/** One Breach Protocol operator, as imported/exported between the games. */
export interface Operator {
  id: string;
  name: string;
  status: 'OK' | 'WOUNDED' | 'KIA';
  missions: number;
}

export type GroundPhase =
  | 'STAGED'
  | 'INFIL'
  | 'AT_TARGET'
  | 'BREACHING'
  | 'SECURED'
  | 'EXFIL'
  | 'EXTRACTED'
  | 'COMPROMISED';

export interface GroundOp {
  teamUnitId: string;
  heloUnitId: string;
  /** Unit id of the hostage site (non-combat RED ground unit). */
  hostageSiteId: string;
  /** Breach is gated on this unit being destroyed (the alarm/C2 net). */
  alarmNetUnitId: string;
  lz: Vec3;
  phase: GroundPhase;
  breachTicksRequired: number;
  breachStartedTick?: number;
  /** The hostage clock: breach must COMPLETE before this tick. */
  hostageDeadlineTick: number;
  hostageCount: number;
  teamAboardHelo: boolean;
  /** Helo (team aboard) west of this x ⇒ extraction complete. */
  extractionSafeX: number;
  roster: Operator[];
}

export type GroundDenialReason = 'BAD_PHASE' | 'ALARM_NET_UP' | 'PAST_DEADLINE';

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
  | { tick: number; type: 'CAP_COMMIT'; unitId: string; targetId: string }
  | { tick: number; type: 'CAP_ON_STATION'; unitId: string }
  | { tick: number; type: 'BINGO_FUEL'; unitId: string }
  | { tick: number; type: 'FUEL_EXHAUSTED'; unitId: string }
  | { tick: number; type: 'JAMMER_SET'; unitId: string; active: boolean }
  | { tick: number; type: 'ROE_SET'; side: Side; level: RoeLevel }
  | { tick: number; type: 'GROUND_PHASE'; phase: GroundPhase }
  | { tick: number; type: 'GROUND_DENIED'; order: string; reason: GroundDenialReason }
  | { tick: number; type: 'HOSTAGES_SECURED'; count: number }
  | { tick: number; type: 'HOSTAGE_CLOCK_EXPIRED' }
  | { tick: number; type: 'TEAM_ABOARD'; heloId: string }
  | { tick: number; type: 'TEAM_EXTRACTED'; count: number };

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
  | { atTick: number; type: 'RTB'; unitId: string }
  | { atTick: number; type: 'GROUND_INFIL' }
  | { atTick: number; type: 'GROUND_BREACH' }
  | { atTick: number; type: 'GROUND_EXFIL' };

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
  /** Present when the mission carries a ground extraction op. */
  groundOp?: GroundOp;
  /** Terrain ridges that mask line of sight (empty/absent = flat world). */
  ridges?: Ridge[];
  /** BLUE's confidence-graded intel dossier, keyed by RED unit id. */
  intel?: Record<string, IntelEntry>;
}
