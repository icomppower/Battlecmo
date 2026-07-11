import { describe, expect, it } from 'vitest';
import { run, tick } from '../src/core/tick';
import { buildEpicFuryScenario } from '../src/scenarios/strike-epicfury';
import { epicFuryPlanA, epicFuryPlanB, epicFuryPlanC, epicFuryPlanD } from '../src/scenarios/plans';
import type { SimState } from '../src/core/types';

const SEED = 42;
const RUN_TICKS = 1_800;

/** The facility/site target set — "full clear" is every one of these dead. */
const TARGET_SET = [
  'red-sam-1',
  'red-leadership-site',
  'red-nuclear-1',
  'red-missile-1',
  'red-corvette-1',
  'red-frigate-1',
] as const;

function expectFullClear(s: SimState): void {
  for (const id of TARGET_SET) {
    expect(s.units[id]!.alive, `${id} should be destroyed`).toBe(false);
  }
}

describe('strike-epicfury: Operation Epic Fury (demo/showcase)', () => {
  it('Plan A (Tomahawk SEAD-first + bomber-heavy) fully clears the target set', () => {
    const s = run(buildEpicFuryScenario(), epicFuryPlanA(), SEED, RUN_TICKS);
    expectFullClear(s);
    // The Tomahawk-analog is what makes this plan distinctive: it must
    // actually have flown (many ticks, subsonic) and hit before the bombers
    // ever released.
    const tlamMissileIds = new Set(
      s.events
        .filter((e): e is Extract<typeof s.events[number], { type: 'LAUNCH' }> => e.type === 'LAUNCH' && e.weaponId === 'tlam-blk5')
        .map((e) => e.missileId),
    );
    expect(tlamMissileIds.size).toBeGreaterThan(0);
    expect(s.events.some((e) => e.type === 'HIT' && tlamMissileIds.has(e.missileId))).toBe(true);
  });

  it('Plan B (drone/strike-aircraft-heavy, classic reactive SEAD) fully clears the target set', () => {
    const s = run(buildEpicFuryScenario(), epicFuryPlanB(), SEED, RUN_TICKS);
    expectFullClear(s);
    // No Tomahawks or bombers fired in this plan.
    expect(s.events.some((e) => e.type === 'LAUNCH' && e.weaponId === 'tlam-blk5')).toBe(false);
    expect(s.events.some((e) => e.type === 'EMITTER_SHUTDOWN' && e.unitId === 'red-sam-1')).toBe(true);
  });

  it('Plan C (coalition mix) fully clears the target set', () => {
    const s = run(buildEpicFuryScenario(), epicFuryPlanC(), SEED, RUN_TICKS);
    expectFullClear(s);
    // Tomahawks reserved for the two hardened facilities in this plan.
    const tlamHits = s.events.filter((e) => e.type === 'LAUNCH' && e.weaponId === 'tlam-blk5') as Extract<
      typeof s.events[number],
      { type: 'LAUNCH' }
    >[];
    expect(tlamHits.every((e) => e.targetId === 'red-nuclear-1' || e.targetId === 'red-missile-1')).toBe(true);
  });

  it('Plan D (ultra-long-range Poseidon HGV) fully clears the target set', () => {
    const s = run(buildEpicFuryScenario(), epicFuryPlanD(), SEED, RUN_TICKS);
    expectFullClear(s);
    // The whole point of Plan D: the HGV is what kills the missile
    // infrastructure, and it flies for a long, mostly-solo stretch — the
    // showcase moment the cinematic chase-cam is built to frame.
    const hgvLaunches = s.events.filter(
      (e): e is Extract<typeof s.events[number], { type: 'LAUNCH' }> => e.type === 'LAUNCH' && e.weaponId === 'hgv-condor',
    );
    expect(hgvLaunches.length).toBeGreaterThan(0);
    const hgvIds = new Set(hgvLaunches.map((e) => e.missileId));
    const hit = s.events.find((e) => e.type === 'HIT' && hgvIds.has(e.missileId) && e.targetId === 'red-missile-1');
    expect(hit).toBeDefined();
    // Flight time is the demo's whole point — confirm it's a long, hypersonic
    // (not instant, not a multi-thousand-tick crawl) transit.
    expect(hit!.tick - hgvLaunches[0]!.tick).toBeGreaterThan(300);
    expect(hit!.tick - hgvLaunches[0]!.tick).toBeLessThan(700);
  });

  it('replay determinism: same seed + orders is byte-identical, tick-by-tick matches a straight run', () => {
    const orders = epicFuryPlanA();
    const a = run(buildEpicFuryScenario(), orders, SEED, 1_200);
    const b = run(buildEpicFuryScenario(), orders, SEED, 1_200);
    expect(a).toEqual(b);

    let stepped = buildEpicFuryScenario();
    for (let i = 0; i < 1_200; i++) stepped = tick(stepped, orders, SEED);
    expect(stepped).toEqual(a);
  });
});
