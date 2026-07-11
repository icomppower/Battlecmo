import { describe, expect, it } from 'vitest';
import { run, tick } from '../src/core/tick';
import { buildTaiwanStrikeScenario } from '../src/scenarios/strike-taiwan';
import { taiwanStrikePlanA, taiwanStrikePlanB, taiwanStrikePlanC } from '../src/scenarios/plans';

const SEED = 42;
const TARGET_SET = ['red-corvette-1', 'red-corvette-2', 'red-frigate-1'] as const;

/**
 * Taiwan Strait — DEMO/SHOWCASE scenario (fictional/hypothetical contingency,
 * see strike-taiwan.ts's module doc). Unlike the rest of the suite, this is
 * not an adversarial proof: there is no losing plan to check, no nemesis
 * adaptation (standalone scenarios never reach debriefCampaign), and no
 * proven counter-plan. All three pre-built plans simply have to fully clear
 * the target set — a full-package strike, a pure-standoff strike, and a
 * combined-arms strike, in that order.
 */
describe('strike-taiwan: demo naval strike + SEAD', () => {
  it('Plan A (full SEAD + close-in dash) clears the whole target set', () => {
    const s = run(buildTaiwanStrikeScenario(), taiwanStrikePlanA(), SEED, 1_000);
    for (const id of TARGET_SET) expect(s.units[id]!.alive).toBe(false);
    // The whole strike package comes home — no adversarial cost to this demo.
    expect(s.units['blue-striker-1']!.alive).toBe(true);
    expect(s.units['blue-striker-2']!.alive).toBe(true);
    expect(s.units['blue-striker-3']!.alive).toBe(true);
    expect(s.units['blue-sead-1']!.alive).toBe(true);
  });

  it('Plan B (pure standoff, no SEAD) clears the whole target set', () => {
    const s = run(buildTaiwanStrikeScenario(), taiwanStrikePlanB(), SEED, 900);
    for (const id of TARGET_SET) expect(s.units[id]!.alive).toBe(false);
    // asm-pike outranges every SAM ring here — RED never gets a shot off.
    expect(s.events.some((e) => e.type === 'LAUNCH' && e.side === 'RED')).toBe(false);
    expect(s.units['blue-striker-1']!.alive).toBe(true);
    expect(s.units['blue-striker-2']!.alive).toBe(true);
    expect(s.units['blue-striker-3']!.alive).toBe(true);
  });

  it('Plan C (combined arms: standoff on the corvettes, SEAD dash on the frigate) clears the whole target set', () => {
    const s = run(buildTaiwanStrikeScenario(), taiwanStrikePlanC(), SEED, 900);
    for (const id of TARGET_SET) expect(s.units[id]!.alive).toBe(false);
    // The frigate is suppressed before Hammer 3's dash crosses into it.
    expect(s.events.some((e) => e.type === 'EMITTER_SHUTDOWN' && e.unitId === 'red-frigate-1')).toBe(true);
    expect(s.units['blue-striker-1']!.alive).toBe(true);
    expect(s.units['blue-striker-2']!.alive).toBe(true);
    expect(s.units['blue-striker-3']!.alive).toBe(true);
    expect(s.units['blue-sead-1']!.alive).toBe(true);
  });

  it('replay determinism: same seed + orders is byte-identical, tick-by-tick matches a straight run', () => {
    const orders = taiwanStrikePlanA();
    const a = run(buildTaiwanStrikeScenario(), orders, SEED, 800);
    const b = run(buildTaiwanStrikeScenario(), orders, SEED, 800);
    expect(a).toEqual(b);

    let stepped = buildTaiwanStrikeScenario();
    for (let i = 0; i < 800; i++) stepped = tick(stepped, orders, SEED);
    expect(stepped).toEqual(a);
  });

  it('does not mutate its input state', () => {
    const initial = buildTaiwanStrikeScenario();
    const snapshot = structuredClone(initial);
    tick(initial, taiwanStrikePlanA(), SEED);
    expect(initial).toEqual(snapshot);
  });
});
