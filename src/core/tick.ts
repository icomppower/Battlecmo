import type { MissileEntity, Order, SimState, Unit } from './types.js';
import { dist2d, dist3d, stepToward } from './geometry.js';
import { roll } from './rng.js';
import {
  TRACK_BUILD_RATE,
  TRACK_DECAY_RATE,
  TRACK_DROP_THRESHOLD,
  canDetect,
  isSuppressed,
} from './sensors.js';
import { validateLaunch } from './weapons.js';

/** Pk multiplier for an anti-radiation missile whose target radar went dark. */
const ARM_VS_SILENT_PK_FACTOR = 0.25;
/** Terminal endgame distance: a missile inside this range this tick resolves. */
const MISSILE_TERMINAL_RANGE = 50;

/**
 * Advance the simulation by one tick (one second of mission time).
 *
 * Pure function: same (state, ordersLog, seed) always yields the same
 * successor state. This single property is what buys replay, the Planning
 * layer, and the Executive layer for free — identical to Breach Protocol's
 * tick contract, with the air/EW domain layers stacked on top.
 */
export function tick(state: SimState, ordersLog: Order[], seed: number): SimState {
  const s: SimState = structuredClone(state);

  applyOrders(s, ordersLog);
  moveUnitsAndBurnFuel(s);
  reactToInboundArms(s);
  flyMissiles(s, seed);
  updateContacts(s);
  runDefensiveEngagements(s);

  s.tick += 1;
  return s;
}

/** Run the sim forward `ticks` steps. */
export function run(state: SimState, ordersLog: Order[], seed: number, ticks: number): SimState {
  let s = state;
  for (let i = 0; i < ticks; i++) s = tick(s, ordersLog, seed);
  return s;
}

function sortedAliveUnits(s: SimState): Unit[] {
  return Object.values(s.units)
    .filter((u) => u.alive)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function applyOrders(s: SimState, ordersLog: Order[]): void {
  for (const order of ordersLog) {
    if (order.atTick !== s.tick) continue;
    switch (order.type) {
      case 'SET_WAYPOINTS': {
        const unit = s.units[order.unitId];
        if (unit?.alive) unit.waypoints = order.waypoints.map((w) => ({ ...w }));
        break;
      }
      case 'SET_ROE': {
        s.roe[order.side] = order.level;
        s.events.push({ tick: s.tick, type: 'ROE_SET', side: order.side, level: order.level });
        break;
      }
      case 'SET_JAMMER': {
        const unit = s.units[order.unitId];
        if (unit?.alive && unit.jammer) {
          unit.jammer.active = order.active;
          s.events.push({ tick: s.tick, type: 'JAMMER_SET', unitId: unit.id, active: order.active });
        }
        break;
      }
      case 'ENGAGE': {
        const shooter = s.units[order.unitId];
        const target = s.units[order.targetId];
        const weapon = s.weaponCatalog[order.weaponId];
        if (!shooter || !target || !weapon) break;
        const denial = validateLaunch(s, shooter, weapon, target);
        if (denial) {
          s.events.push({
            tick: s.tick,
            type: 'LAUNCH_DENIED',
            shooterId: shooter.id,
            targetId: target.id,
            reason: denial,
          });
        } else {
          launch(s, shooter, weapon.id, target.id);
        }
        break;
      }
      case 'RTB': {
        const unit = s.units[order.unitId];
        if (unit?.alive && unit.homeBase) {
          unit.rtb = true;
          unit.waypoints = [{ ...unit.homeBase }];
        }
        break;
      }
    }
  }
}

function launch(s: SimState, shooter: Unit, weaponId: string, targetId: string): void {
  const station = shooter.weapons.find((st) => st.weaponId === weaponId)!;
  station.count -= 1;
  const missileId = `m${s.nextEntitySeq++}`;
  s.missiles[missileId] = {
    id: missileId,
    side: shooter.side,
    weaponId,
    shooterId: shooter.id,
    targetId,
    pos: { ...shooter.pos },
    alive: true,
  };
  s.events.push({
    tick: s.tick,
    type: 'LAUNCH',
    side: shooter.side,
    shooterId: shooter.id,
    weaponId,
    targetId,
    missileId,
  });
}

function moveUnitsAndBurnFuel(s: SimState): void {
  for (const unit of sortedAliveUnits(s)) {
    // Movement along waypoints at commanded speed.
    while (unit.waypoints.length > 0 && unit.speed > 0) {
      const wp = unit.waypoints[0]!;
      const before = dist3d(unit.pos, wp);
      if (before <= unit.speed) {
        unit.pos = { ...wp };
        unit.waypoints.shift();
        break; // arrive at most one waypoint per tick
      }
      unit.pos = stepToward(unit.pos, wp, unit.speed);
      break;
    }

    // Fuel — bingo is a hard constraint, same weight class as Breach
    // Protocol's noise/time tradeoff.
    if (unit.fuelKg !== undefined && unit.burnKgPerTick !== undefined) {
      unit.fuelKg = Math.max(0, unit.fuelKg - unit.burnKgPerTick);
      if (
        unit.bingoKg !== undefined &&
        unit.fuelKg <= unit.bingoKg &&
        !unit.rtb &&
        unit.homeBase
      ) {
        unit.rtb = true;
        unit.waypoints = [{ ...unit.homeBase }];
        s.events.push({ tick: s.tick, type: 'BINGO_FUEL', unitId: unit.id });
      }
      if (unit.fuelKg <= 0 && unit.domain === 'AIR') {
        unit.alive = false;
        s.events.push({ tick: s.tick, type: 'FUEL_EXHAUSTED', unitId: unit.id });
      }
    }

    // Emitter coming back up after a suppression window.
    if (unit.suppressedUntilTick !== undefined && s.tick === unit.suppressedUntilTick) {
      s.events.push({ tick: s.tick, type: 'EMITTER_BACK_UP', unitId: unit.id });
    }
  }
}

/**
 * SEAD pressure: a radar crew that spots an inbound anti-radiation missile
 * inside its reaction range shuts down for a doctrine-defined window. The
 * ARM loses most of its Pk against a silent emitter — the *suppression*
 * (not necessarily the kill) is what opens the strike corridor.
 */
function reactToInboundArms(s: SimState): void {
  for (const unit of sortedAliveUnits(s)) {
    const doctrine = unit.emitterDoctrine;
    if (!doctrine || isSuppressed(unit, s.tick)) continue;
    const hasEmittingRadar = unit.sensors.some((se) => se.kind === 'RADAR' && se.emitting);
    if (!hasEmittingRadar) continue;
    for (const missile of Object.values(s.missiles)) {
      if (!missile.alive || missile.targetId !== unit.id) continue;
      const weapon = s.weaponCatalog[missile.weaponId];
      if (!weapon?.antiRadiation) continue;
      if (dist3d(missile.pos, unit.pos) <= doctrine.armReactionRange) {
        unit.suppressedUntilTick = s.tick + doctrine.shutdownTicks;
        s.events.push({
          tick: s.tick,
          type: 'EMITTER_SHUTDOWN',
          unitId: unit.id,
          untilTick: unit.suppressedUntilTick,
          cause: 'ARM_INBOUND',
        });
        break;
      }
    }
  }
}

function flyMissiles(s: SimState, seed: number): void {
  const missiles = Object.values(s.missiles)
    .filter((m) => m.alive)
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const missile of missiles) {
    const target = s.units[missile.targetId];
    const weapon = s.weaponCatalog[missile.weaponId]!;
    if (!target || !target.alive) {
      missile.alive = false; // target gone — missile goes stupid
      continue;
    }

    missile.pos = stepToward(missile.pos, target.pos, weapon.speed);

    if (dist3d(missile.pos, target.pos) <= MISSILE_TERMINAL_RANGE) {
      missile.alive = false;
      let pk = weapon.pk;
      if (weapon.antiRadiation) {
        const emitting =
          !isSuppressed(target, s.tick) &&
          target.sensors.some((se) => se.kind === 'RADAR' && se.emitting);
        if (!emitting) pk *= ARM_VS_SILENT_PK_FACTOR;
      }
      if (roll(seed, s.tick, 'pk', missile.id) < pk) {
        target.alive = false;
        s.events.push({ tick: s.tick, type: 'HIT', missileId: missile.id, targetId: target.id });
        s.events.push({
          tick: s.tick,
          type: 'UNIT_DESTROYED',
          unitId: target.id,
          byMissileId: missile.id,
        });
      } else {
        s.events.push({ tick: s.tick, type: 'MISS', missileId: missile.id, targetId: target.id });
      }
    }
  }
}

function updateContacts(s: SimState): void {
  const sides = ['BLUE', 'RED'] as const;
  for (const side of sides) {
    const own = sortedAliveUnits(s).filter((u) => u.side === side);
    const enemies = sortedAliveUnits(s).filter((u) => u.side !== side);
    const table = s.contacts[side];

    for (const enemy of enemies) {
      const spotter = own.find((u) => canDetect(s, u, enemy));
      const existing = table[enemy.id];
      if (spotter) {
        if (!existing) {
          table[enemy.id] = {
            targetId: enemy.id,
            firstDetectedTick: s.tick,
            lastSeenTick: s.tick,
            quality: TRACK_BUILD_RATE,
          };
          s.events.push({
            tick: s.tick,
            type: 'DETECTION',
            side,
            sensorUnitId: spotter.id,
            targetId: enemy.id,
          });
        } else {
          existing.quality = Math.min(1, existing.quality + TRACK_BUILD_RATE);
          existing.lastSeenTick = s.tick;
        }
      } else if (existing) {
        existing.quality -= TRACK_DECAY_RATE;
        if (existing.quality < TRACK_DROP_THRESHOLD) {
          delete table[enemy.id];
          s.events.push({ tick: s.tick, type: 'CONTACT_LOST', side, targetId: enemy.id });
        }
      }
    }

    // Contacts on destroyed units decay out the same way.
    for (const contact of Object.values(table)) {
      const target = s.units[contact.targetId];
      if (!target || !target.alive) {
        contact.quality -= TRACK_DECAY_RATE;
        if (contact.quality < TRACK_DROP_THRESHOLD) {
          delete table[contact.targetId];
          s.events.push({ tick: s.tick, type: 'CONTACT_LOST', side, targetId: contact.targetId });
        }
      }
    }
  }
}

/**
 * Defensive fire doctrine for units with a concurrency limit set (SAM
 * batteries): engage the highest-quality valid contact, keeping at most
 * `maxConcurrentEngagements` missiles in the air. All gating goes through
 * the same validateLaunch path as player ENGAGE orders — ROE, envelope,
 * and track quality apply equally to the AI.
 */
function runDefensiveEngagements(s: SimState): void {
  for (const unit of sortedAliveUnits(s)) {
    const limit = unit.maxConcurrentEngagements;
    if (limit === undefined || limit <= 0) continue;

    // A SAM battery needs its own radar up to guide — a suppressed or silent
    // emitter cannot shoot, which is the whole point of the SEAD window.
    const hasLiveRadar =
      !isSuppressed(unit, s.tick) &&
      unit.sensors.some((se) => se.kind === 'RADAR' && se.emitting);
    if (!hasLiveRadar) continue;

    let inFlight = Object.values(s.missiles).filter(
      (m) => m.alive && m.shooterId === unit.id,
    ).length;
    if (inFlight >= limit) continue;

    const contacts = Object.values(s.contacts[unit.side]).sort(
      (a, b) => b.quality - a.quality || a.targetId.localeCompare(b.targetId),
    );

    for (const contact of contacts) {
      if (inFlight >= limit) break;
      const target = s.units[contact.targetId];
      if (!target || !target.alive) continue;
      // One missile per target per shooter at a time.
      const alreadyEngaged = Object.values(s.missiles).some(
        (m) => m.alive && m.shooterId === unit.id && m.targetId === target.id,
      );
      if (alreadyEngaged) continue;

      for (const station of unit.weapons) {
        const weapon = s.weaponCatalog[station.weaponId];
        if (!weapon || weapon.kind !== 'SAM') continue;
        if (validateLaunch(s, unit, weapon, target) === null) {
          launch(s, unit, weapon.id, target.id);
          inFlight += 1;
          break;
        }
      }
    }
  }
}
