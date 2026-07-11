import { describe, expect, it } from 'vitest';
import { run, tick } from '../src/core/tick';
import { buildPicketScenario } from '../src/scenarios/strike-picket';
import { picketHazardPlan, picketSafePlan } from '../src/scenarios/plans';
import type { SimEvent } from '../src/core/types';

const SEED = 42;

/**
 * The blue-on-blue picket dilemma, playable (triage item E, part 2). The
 * mechanics themselves are established in tests/iff.test.ts; this exercises
 * the registered scenario + preset plans a player actually flies.
 */
describe('strike-picket: the blue-on-blue dilemma', () => {
  it('transponder off, weapons FREE: the picket launches on the returning friend and kills it', () => {
    const s = run(buildPicketScenario(), picketHazardPlan(), SEED, 300);

    const launch = s.events.find(
      (e): e is Extract<SimEvent, { type: 'LAUNCH' }> => e.type === 'LAUNCH' && e.shooterId === 'blue-picket-1',
    );
    expect(launch).toBeDefined();
    expect(launch!.targetId).toBe('blue-hammer-1');
    expect(launch!.weaponId).toBe('sam-longbow');
    expect(s.units['blue-hammer-1']!.alive).toBe(false);
  });

  it('counter 1 — squawk: leaving the transponder on resolves the contact, the picket never fires', () => {
    const s = run(buildPicketScenario(), [], SEED, 300);
    expect(s.events.some((e) => e.type === 'LAUNCH')).toBe(false);
    expect(s.units['blue-hammer-1']!.alive).toBe(true);
  });

  it('counter 2 — ROE discipline: TIGHT holds fire even on a silent, un-prebriefed contact', () => {
    const s = run(buildPicketScenario(), picketSafePlan(), SEED, 300);
    expect(s.events.some((e) => e.type === 'LAUNCH')).toBe(false);
    expect(s.units['blue-hammer-1']!.alive).toBe(true);
  });

  it('replay determinism: same seed + orders is byte-identical, tick-by-tick matches a straight run', () => {
    const orders = picketHazardPlan();
    const a = run(buildPicketScenario(), orders, SEED, 300);
    const b = run(buildPicketScenario(), orders, SEED, 300);
    expect(a).toEqual(b);

    let stepped = buildPicketScenario();
    for (let i = 0; i < 300; i++) stepped = tick(stepped, orders, SEED);
    expect(stepped).toEqual(a);
  });
});
