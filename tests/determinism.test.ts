import { describe, expect, it } from 'vitest';
import { run, tick } from '../src/core/tick';
import { buildStrikeScenario } from '../src/scenarios/strike-basic';
import { goodPlan } from '../src/scenarios/plans';

describe('deterministic tick core', () => {
  it('same seed + same orders log ⇒ byte-identical state', () => {
    const orders = goodPlan();
    const a = run(buildStrikeScenario(), orders, 42, 700);
    const b = run(buildStrikeScenario(), orders, 42, 700);
    expect(a).toEqual(b);
  });

  it('replaying tick-by-tick matches a straight run (WEGO pause/replan safe)', () => {
    const orders = goodPlan();
    const straight = run(buildStrikeScenario(), orders, 42, 300);
    let stepped = buildStrikeScenario();
    for (let i = 0; i < 300; i++) stepped = tick(stepped, orders, 42);
    expect(stepped).toEqual(straight);
  });

  it('tick does not mutate its input state', () => {
    const initial = buildStrikeScenario();
    const snapshot = structuredClone(initial);
    tick(initial, goodPlan(), 42);
    expect(initial).toEqual(snapshot);
  });

  it('different seeds may diverge only through seeded rolls, never through structure', () => {
    // With no weapon endgames (empty orders, BLUE holds, RED never gets a
    // valid shot), no randomness is consumed: every seed must agree exactly.
    const a = run(buildStrikeScenario(), [], 1, 200);
    const b = run(buildStrikeScenario(), [], 999, 200);
    expect(a).toEqual(b);
  });
});
