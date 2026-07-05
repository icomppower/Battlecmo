import { describe, expect, it } from 'vitest';
import { run } from '../src/core/tick';
import { STORE_WEAPONS, buildAircraft, withBluePackage } from '../src/oob/assembly';
import { WEAPONS } from '../src/scenarios/strike-basic';
import { buildAdaptiveStrikeScenario } from '../src/scenarios/strike-adaptive';
import { decoyPackage, decoySweepPlan } from '../src/scenarios/plans';
import type { CiwsDef, Order, Unit } from '../src/core/types';
import { miniState } from './helpers';

const SEED = 42;
const CATALOG = { ...WEAPONS, ...STORE_WEAPONS };

/**
 * Point defense & decoys (triage item G). The balance contract:
 *
 *  - CIWS gets ONE intercept attempt per tick (nearest inbound first), so
 *    the engagement RATE is the lever: a lone sea-skimmer eats attempts all
 *    the way in and usually dies; a salvo splits the mount and leaks.
 *    Saturation — not a bigger missile — is the designed counter.
 *  - Decoys are ordinary units: they cue radars, get engaged, and die
 *    through the same machinery as everything else. Their value is what the
 *    enemy SPENDS on them (missiles, shoot-and-scoot posture), priced at two
 *    expendable drones.
 */

function corvette(ciws?: CiwsDef): Unit {
  return {
    id: 'red-corvette-1',
    side: 'RED',
    domain: 'SEA',
    name: 'Palisade corvette',
    pos: { x: 0, y: 0, alt: 12 },
    speed: 0,
    maxSpeed: 15,
    rcs: 200,
    sensors: [{ id: 'search', kind: 'RADAR', baseRange: 70_000, refRcs: 5, emitting: true }],
    weapons: [],
    ...(ciws ? { ciws } : {}),
    waypoints: [],
    alive: true,
  };
}

function asmShooter(rounds: number): Unit {
  return {
    id: 'blue-striker-2',
    side: 'BLUE',
    domain: 'AIR',
    name: 'Hammer 2',
    pos: { x: -60_000, y: 0, alt: 8_000 },
    speed: 0,
    maxSpeed: 300,
    rcs: 3,
    sensors: [],
    weapons: [{ weaponId: 'asm-pike', count: rounds }],
    waypoints: [],
    alive: true,
  };
}

const CIWS_STANDARD: CiwsDef = { range: 1_200, pk: 0.3, magazine: 10 };

describe('CIWS terminal point defense', () => {
  it('a lone sea-skimming ASM is engaged across its approach and splashed', () => {
    const orders: Order[] = [
      { atTick: 0, type: 'ENGAGE', unitId: 'blue-striker-2', weaponId: 'asm-pike', targetId: 'red-corvette-1' },
    ];
    const s0 = miniState([corvette({ ...CIWS_STANDARD }), asmShooter(1)], {}, CATALOG);
    const s = run(s0, orders, SEED, 300);

    const attempts = s.events.filter((e) => e.type === 'CIWS_INTERCEPT');
    expect(attempts.length).toBeGreaterThanOrEqual(1);
    expect(attempts.some((e) => e.type === 'CIWS_INTERCEPT' && e.killed)).toBe(true);
    expect(s.events.some((e) => e.type === 'HIT')).toBe(false);
    expect(s.units['red-corvette-1']!.alive).toBe(true); // the single-Pike kill is gone
  });

  it('a saturation salvo overwhelms the mount — one leaker is enough', () => {
    // The approach gives the mount ~4 attempts total. A pair splits them
    // 2/2 (a coin flip); a three-missile salvo GUARANTEES a free runner —
    // saturation is arithmetic, not luck.
    const orders: Order[] = [
      { atTick: 0, type: 'ENGAGE', unitId: 'blue-striker-2', weaponId: 'asm-pike', targetId: 'red-corvette-1' },
      { atTick: 0, type: 'ENGAGE', unitId: 'blue-striker-2', weaponId: 'asm-pike', targetId: 'red-corvette-1' },
      { atTick: 0, type: 'ENGAGE', unitId: 'blue-striker-2', weaponId: 'asm-pike', targetId: 'red-corvette-1' },
    ];
    const s0 = miniState([corvette({ ...CIWS_STANDARD }), asmShooter(3)], {}, CATALOG);
    const s = run(s0, orders, SEED, 300);

    expect(s.units['red-corvette-1']!.alive).toBe(false);
  });

  it('the mount is burst-limited: an empty magazine stops shooting', () => {
    const orders: Order[] = [
      { atTick: 0, type: 'ENGAGE', unitId: 'blue-striker-2', weaponId: 'asm-pike', targetId: 'red-corvette-1' },
    ];
    const s0 = miniState([corvette({ range: 1_200, pk: 0.05, magazine: 2 }), asmShooter(1)], {}, CATALOG);
    const s = run(s0, orders, SEED, 300);

    expect(s.events.filter((e) => e.type === 'CIWS_INTERCEPT').length).toBeLessThanOrEqual(2);
  });

  it('fast missiles cross the ring too quickly to be reliably engaged', () => {
    // An 800 m/s SAM-class weapon covers the whole 1 200 m ring in under two
    // ticks — the mount physically gets at most 1-2 attempts.
    const fastShooter: Unit = {
      ...asmShooter(1),
      id: 'blue-fast-1',
      pos: { x: -20_000, y: 0, alt: 30 },
      weapons: [{ weaponId: 'fast-asm', count: 1 }],
    };
    const catalog = {
      ...CATALOG,
      'fast-asm': { ...STORE_WEAPONS['asm-pike']!, id: 'fast-asm', speed: 800 },
    };
    const orders: Order[] = [
      { atTick: 0, type: 'ENGAGE', unitId: 'blue-fast-1', weaponId: 'fast-asm', targetId: 'red-corvette-1' },
    ];
    const s0 = miniState([corvette({ ...CIWS_STANDARD }), fastShooter], {}, catalog);
    const s = run(s0, orders, SEED, 60);

    expect(s.events.filter((e) => e.type === 'CIWS_INTERCEPT').length).toBeLessThanOrEqual(2);
  });
});

describe('decoy drones (assembly)', () => {
  it('a Shrike with a Luneburg lens wears exactly a striker paint', () => {
    const drone = buildAircraft({
      id: 'blue-decoy-1',
      callsign: 'Ghost 1',
      airframeId: 'af-shrike',
      stores: ['st-lens'],
    });
    expect(drone.rcs).toBe(3); // 0.4 clean + 2.6 lens = a loaded striker's 3.0
    expect(drone.decoy).toBe(true);
    expect(drone.weapons).toEqual([]);
    expect(drone.maxSpeed).toBe(220); // it cannot fake a dash — the eventual tell
  });
});

describe('the decoy sweep (what decoys buy against the adaptive battery)', () => {
  it('two drones purchase the battery entire posture: both SAMs wasted, scoot triggered, strike walks in', () => {
    const s0 = withBluePackage(buildAdaptiveStrikeScenario(), decoyPackage());
    const s = run(s0, decoySweepPlan(), SEED, 900);

    // Every missile RED fired went at a ghost…
    const redLaunches = s.events.filter((e) => e.type === 'LAUNCH' && e.side === 'RED');
    expect(redLaunches.length).toBe(2);
    for (const l of redLaunches) {
      expect(l.type === 'LAUNCH' && s.units[l.targetId]?.decoy).toBe(true);
    }
    // …which is the battery own shoot-and-scoot trigger: it packed up and
    // spent the rest of the mission on the march, radar cold.
    expect(s.events.some((e) => e.type === 'SAM_RELOCATING')).toBe(true);

    // The strike walked in behind it — no SEAD shot fired all mission.
    expect(s.units['red-hq']!.alive).toBe(false);
    expect(s.events.some((e) => e.type === 'LAUNCH' && e.weaponId === 'arm-lance')).toBe(false);
    const manned = Object.values(s.units).filter((u) => u.side === 'BLUE' && !u.decoy);
    expect(manned.every((u) => u.alive)).toBe(true);
  });
});
