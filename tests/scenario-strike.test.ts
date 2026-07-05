import { describe, expect, it } from 'vitest';
import { run } from '../src/core/tick';
import { buildStrikeScenario } from '../src/scenarios/strike-basic';
import { goodPlan, jamOnlyPlan, naivePlan } from './plans';

const SEED = 42;
const MISSION_TICKS = 700;

const BLUE_AIRCRAFT = ['blue-striker-1', 'blue-striker-2', 'blue-sead-1', 'blue-ea-1'];

describe('strike-basic: one package vs a static IADS', () => {
  it('the sequenced plan (jam → SEAD window → dash → release) wins clean', () => {
    const s = run(buildStrikeScenario(), goodPlan(), SEED, MISSION_TICKS);

    // Objective destroyed.
    expect(s.units['red-hq']!.alive).toBe(false);

    // Zero BLUE losses.
    for (const id of BLUE_AIRCRAFT) {
      expect(s.units[id]!.alive, `${id} should survive`).toBe(true);
    }

    // The SAM battery never got a shot off — the corridor stayed shut.
    const redLaunches = s.events.filter((e) => e.type === 'LAUNCH' && e.side === 'RED');
    expect(redLaunches).toEqual([]);

    // And the mechanism was suppression, not luck: the radar went dark.
    expect(s.events.some((e) => e.type === 'EMITTER_SHUTDOWN' && e.unitId === 'red-sam-1')).toBe(
      true,
    );
  });

  it('the naive plan (no EW, no SEAD) gets the package shot up', () => {
    const s = run(buildStrikeScenario(), naivePlan(), SEED, MISSION_TICKS);

    // The IADS saw them coming and engaged.
    const redLaunches = s.events.filter((e) => e.type === 'LAUNCH' && e.side === 'RED');
    expect(redLaunches.length).toBeGreaterThan(0);

    // At least one striker goes down before or during the release window.
    const blueLosses = BLUE_AIRCRAFT.filter((id) => !s.units[id]!.alive);
    expect(blueLosses.length).toBeGreaterThan(0);
  });

  it('jamming alone shrinks the warning time but does not shut the SAM up', () => {
    const s = run(buildStrikeScenario(), jamOnlyPlan(), SEED, MISSION_TICKS);

    // Detection happens later than in the naive plan…
    const naive = run(buildStrikeScenario(), naivePlan(), SEED, MISSION_TICKS);
    const firstDetection = (st: typeof s) =>
      st.events.find((e) => e.type === 'DETECTION' && e.side === 'RED')?.tick ?? Infinity;
    expect(firstDetection(s)).toBeGreaterThan(firstDetection(naive));

    // …but the battery still engages once the strikers enter the ring.
    const redLaunches = s.events.filter((e) => e.type === 'LAUNCH' && e.side === 'RED');
    expect(redLaunches.length).toBeGreaterThan(0);
  });

  it('ROE HOLD blocks the strike even with a perfect firing solution', () => {
    const plan = goodPlan().filter((o) => o.type !== 'SET_ROE'); // BLUE stays on HOLD
    const s = run(buildStrikeScenario(), plan, SEED, MISSION_TICKS);

    expect(s.units['red-hq']!.alive).toBe(true);
    const denials = s.events.filter(
      (e) => e.type === 'LAUNCH_DENIED' && e.reason === 'ROE_HOLD',
    );
    expect(denials.length).toBeGreaterThan(0);
    const blueLaunches = s.events.filter((e) => e.type === 'LAUNCH' && e.side === 'BLUE');
    expect(blueLaunches).toEqual([]);
  });

  it('TIGHT ROE denies targets outside the briefed target list', () => {
    const s0 = buildStrikeScenario();
    s0.prebriefedTargets.BLUE = ['red-sam-1']; // HQ got dropped from the brief
    const s = run(s0, goodPlan(), SEED, MISSION_TICKS);

    expect(s.units['red-hq']!.alive).toBe(true);
    expect(
      s.events.some((e) => e.type === 'LAUNCH_DENIED' && e.reason === 'ROE_TIGHT_NO_PREBRIEF'),
    ).toBe(true);
  });
});
