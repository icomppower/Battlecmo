import type { GroundDenialReason, GroundPhase, Order, SimState, Unit } from './types';
import { dist2d, dist3d, stepToward } from './geometry';
import { roll } from './rng';
import {
  TRACK_BUILD_RATE,
  TRACK_DECAY_RATE,
  TRACK_DROP_THRESHOLD,
  canDetect,
  isSuppressed,
} from './sensors';
import { validateLaunch } from './weapons';

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
  runGroundOp(s);
  updateContacts(s);
  runCapDoctrine(s);
  runSamDoctrine(s);
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
      case 'GROUND_INFIL':
      case 'GROUND_BREACH':
      case 'GROUND_EXFIL':
        applyGroundOrder(s, order.type);
        break;
    }
  }
}

function groundPhase(s: SimState, phase: GroundPhase): void {
  s.groundOp!.phase = phase;
  s.events.push({ tick: s.tick, type: 'GROUND_PHASE', phase });
}

function applyGroundOrder(s: SimState, type: 'GROUND_INFIL' | 'GROUND_BREACH' | 'GROUND_EXFIL'): void {
  const op = s.groundOp;
  if (!op) return;
  const deny = (reason: GroundDenialReason): void => {
    s.events.push({ tick: s.tick, type: 'GROUND_DENIED', order: type, reason });
  };
  const team = s.units[op.teamUnitId];
  if (!team?.alive) return deny('BAD_PHASE');
  const site = s.units[op.hostageSiteId];

  switch (type) {
    case 'GROUND_INFIL': {
      if (op.phase !== 'STAGED') return deny('BAD_PHASE');
      team.waypoints = site ? [{ ...site.pos }] : [];
      groundPhase(s, 'INFIL');
      break;
    }
    case 'GROUND_BREACH': {
      if (op.phase !== 'AT_TARGET') return deny('BAD_PHASE');
      // The strike IS the go-code: breaching into a wired site gets the
      // hostages killed, so the alarm/C2 net has to be down first.
      const alarm = s.units[op.alarmNetUnitId];
      if (alarm?.alive) return deny('ALARM_NET_UP');
      if (s.tick >= op.hostageDeadlineTick) return deny('PAST_DEADLINE');
      op.breachStartedTick = s.tick;
      groundPhase(s, 'BREACHING');
      break;
    }
    case 'GROUND_EXFIL': {
      if (op.phase !== 'SECURED') return deny('BAD_PHASE');
      team.waypoints = [{ ...op.lz }];
      groundPhase(s, 'EXFIL');
      break;
    }
  }
}

/**
 * Ground extraction phase machine (build order step 4) — Breach Protocol's
 * ground op, abstracted onto the shared mission clock. One clock, every
 * domain: a late SEAD window delays the strike, which delays the breach
 * go-code, and the hostage clock does not care.
 */
function runGroundOp(s: SimState): void {
  const op = s.groundOp;
  if (!op || op.phase === 'EXTRACTED' || op.phase === 'COMPROMISED') return;
  const team = s.units[op.teamUnitId];
  const helo = s.units[op.heloUnitId];
  const site = s.units[op.hostageSiteId];

  // The hostage clock runs regardless of how the air war is going.
  if (s.tick >= op.hostageDeadlineTick && op.phase !== 'SECURED' && op.phase !== 'EXFIL') {
    s.events.push({ tick: s.tick, type: 'HOSTAGE_CLOCK_EXPIRED' });
    groundPhase(s, 'COMPROMISED');
    return;
  }

  // Losing the helo with everyone aboard ends the op — and the roster.
  if (op.teamAboardHelo && (!helo || !helo.alive)) {
    if (team) team.alive = false;
    for (const operator of op.roster) operator.status = 'KIA';
    groundPhase(s, 'COMPROMISED');
    return;
  }

  if (!team?.alive) {
    groundPhase(s, 'COMPROMISED');
    return;
  }

  if (op.teamAboardHelo && helo) {
    team.pos = { ...helo.pos }; // riding along
    if (helo.pos.x <= op.extractionSafeX) {
      groundPhase(s, 'EXTRACTED');
      s.events.push({ tick: s.tick, type: 'TEAM_EXTRACTED', count: op.hostageCount });
    }
    return;
  }

  switch (op.phase) {
    case 'INFIL':
      if (site && dist2d(team.pos, site.pos) <= 100) groundPhase(s, 'AT_TARGET');
      break;
    case 'BREACHING':
      if (s.tick - op.breachStartedTick! >= op.breachTicksRequired) {
        groundPhase(s, 'SECURED');
        s.events.push({ tick: s.tick, type: 'HOSTAGES_SECURED', count: op.hostageCount });
      }
      break;
    case 'EXFIL':
      if (
        helo?.alive &&
        dist2d(team.pos, helo.pos) <= 200 &&
        helo.pos.alt <= 60 &&
        dist2d(helo.pos, op.lz) <= 400
      ) {
        op.teamAboardHelo = true;
        s.events.push({ tick: s.tick, type: 'TEAM_ABOARD', heloId: helo.id });
      }
      break;
  }
}

function launch(s: SimState, shooter: Unit, weaponId: string, targetId: string): void {
  const station = shooter.weapons.find((st) => st.weaponId === weaponId)!;
  station.count -= 1;
  shooter.shotsFired = (shooter.shotsFired ?? 0) + 1;
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
        // Adapted window: every survived scare shortens the next blink.
        const scares = unit.armScares ?? 0;
        const window = Math.max(
          doctrine.minShutdownTicks ?? 1,
          Math.round(doctrine.shutdownTicks * Math.pow(doctrine.shutdownDecay ?? 1, scares)),
        );
        unit.armScares = scares + 1;
        unit.suppressedUntilTick = s.tick + window;
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
 * Combat air patrol doctrine: a fighter holds its station until an own-side
 * air track appears inside the commit ring, then dashes a pursuit curve at
 * it (waypoint re-laid on the target every tick); when the track dies it
 * cruises back and re-anchors. Contacts below commitMinAlt don't tempt it —
 * they're under the missile floor anyway, and chasing them is how you get
 * baited (nemesis-tunable, same as the SAM cue floor).
 */
function runCapDoctrine(s: SimState): void {
  for (const unit of sortedAliveUnits(s)) {
    const doctrine = unit.capDoctrine;
    if (!doctrine) continue;

    const contacts = Object.values(s.contacts[unit.side]).sort(
      (a, b) => b.quality - a.quality || a.targetId.localeCompare(b.targetId),
    );
    let target: Unit | null = null;

    // Nemesis emitter hunt: a radiating surveillance aircraft is priority
    // one, and the fighter reaches for it well beyond the normal ring.
    if (doctrine.huntEmitters) {
      const ring = doctrine.emitterCommitRange ?? doctrine.commitRange * 1.6;
      for (const contact of contacts) {
        const t = s.units[contact.targetId];
        if (!t?.alive || t.domain !== 'AIR') continue;
        if (t.pos.alt < (doctrine.commitMinAlt ?? 0)) continue;
        if (!t.sensors.some((se) => se.kind === 'RADAR' && se.emitting)) continue;
        if (dist2d(doctrine.station, t.pos) > ring) continue;
        target = t;
        break;
      }
    }

    for (const contact of target ? [] : contacts) {
      const t = s.units[contact.targetId];
      if (!t?.alive || t.domain !== 'AIR') continue;
      if (t.pos.alt < (doctrine.commitMinAlt ?? 0)) continue;
      if (dist2d(doctrine.station, t.pos) > doctrine.commitRange) continue;
      target = t;
      break;
    }

    if (target) {
      if (unit.committedTargetId !== target.id) {
        unit.committedTargetId = target.id;
        s.events.push({ tick: s.tick, type: 'CAP_COMMIT', unitId: unit.id, targetId: target.id });
      }
      unit.speed = doctrine.dashSpeed;
      // Pursuit curve: re-lay the intercept point every tick; never chase
      // into the dirt.
      unit.waypoints = [{ x: target.pos.x, y: target.pos.y, alt: Math.max(target.pos.alt, 1_000) }];
    } else if (unit.committedTargetId !== undefined) {
      unit.committedTargetId = undefined;
      unit.speed = doctrine.cruiseSpeed;
      unit.waypoints = [{ ...doctrine.station }];
    } else if (unit.waypoints.length === 0 && unit.speed > 0) {
      unit.speed = 0;
      s.events.push({ tick: s.tick, type: 'CAP_ON_STATION', unitId: unit.id });
    }
  }
}

/**
 * Adaptive battery doctrine (step 3 of the build order) — a deterministic
 * state machine per SAM site:
 *
 *  - EMCON: a CUED battery holds its fire-control radar cold until the IADS
 *    (any own-side sensor, e.g. the EW radar) has a contact inside cueRange,
 *    and goes cold again once the cue ages out. A cold radar can't be
 *    ARM-scared and eats anti-radiation shots at degraded Pk — pre-planned
 *    SEAD timing stops working against it.
 *  - Shoot-and-scoot: after scootAfterShots launches the battery goes cold
 *    and relocates to its fallback position; while on the march it cannot
 *    shoot, which is the window an alert strike lead exploits.
 */
function runSamDoctrine(s: SimState): void {
  for (const unit of sortedAliveUnits(s)) {
    const doctrine = unit.samDoctrine;
    if (!doctrine) continue;
    const radars = unit.sensors.filter((se) => se.kind === 'RADAR');
    if (radars.length === 0) continue;
    const emitting = radars.some((se) => se.emitting);

    // Arrival at the fallback site.
    if (unit.relocating && unit.waypoints.length === 0) {
      unit.relocating = false;
      unit.speed = 0;
      doctrine.scootTo = undefined; // one relocation per prepared site
      unit.shotsFired = 0;
      s.events.push({ tick: s.tick, type: 'SAM_DEPLOYED', unitId: unit.id });
    }

    // Shoot-and-scoot trigger.
    if (
      !unit.relocating &&
      doctrine.scootAfterShots !== undefined &&
      doctrine.scootTo &&
      (unit.shotsFired ?? 0) >= doctrine.scootAfterShots
    ) {
      unit.relocating = true;
      unit.waypoints = [{ ...doctrine.scootTo }];
      unit.speed = doctrine.scootSpeed ?? 8;
      for (const r of radars) r.emitting = false;
      if (emitting) s.events.push({ tick: s.tick, type: 'SAM_EMCON', unitId: unit.id, emitting: false });
      s.events.push({ tick: s.tick, type: 'SAM_RELOCATING', unitId: unit.id });
      continue;
    }

    if (unit.relocating) continue; // radar stays cold on the march

    // EMCON discipline.
    if (doctrine.emcon === 'CUED') {
      // Only air tracks cue an air-defense battery — a ground blip is not
      // this radar's problem.
      const cued = Object.values(s.contacts[unit.side]).some((c) => {
        const target = s.units[c.targetId];
        return (
          target?.alive &&
          target.domain === 'AIR' &&
          target.pos.alt >= (doctrine.cueMinAlt ?? 0) &&
          dist2d(unit.pos, target.pos) <= (doctrine.cueRange ?? Infinity)
        );
      });
      if (cued) unit.lastCuedTick = s.tick;
      const cueFresh =
        unit.lastCuedTick !== undefined &&
        s.tick - unit.lastCuedTick <= (doctrine.coldAfterTicks ?? 30);

      if (cueFresh && !emitting) {
        for (const r of radars) r.emitting = true;
        s.events.push({ tick: s.tick, type: 'SAM_EMCON', unitId: unit.id, emitting: true });
      } else if (!cueFresh && emitting) {
        for (const r of radars) r.emitting = false;
        s.events.push({ tick: s.tick, type: 'SAM_EMCON', unitId: unit.id, emitting: false });
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

    // A shooter needs a live sensor of its own to guide: a radar battery
    // that is suppressed or silent cannot shoot (the whole point of the
    // SEAD window), while an IR/visual shooter (MANPADS team) needs no
    // emitter at all.
    const hasLiveRadar =
      !isSuppressed(unit, s.tick) &&
      unit.sensors.some((se) => se.kind === 'RADAR' && se.emitting);
    const hasPassiveSensor = unit.sensors.some((se) => se.kind !== 'RADAR');
    if (!hasLiveRadar && !hasPassiveSensor) continue;

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
        // SAMs and AAMs are defensive-fire weapons (batteries and interceptors);
        // strike weapons only ever fire on explicit ENGAGE orders.
        if (!weapon || (weapon.kind !== 'SAM' && weapon.kind !== 'AAM')) continue;
        if (validateLaunch(s, unit, weapon, target) === null) {
          launch(s, unit, weapon.id, target.id);
          inFlight += 1;
          break;
        }
      }
    }
  }
}
