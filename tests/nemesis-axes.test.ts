import { describe, expect, it } from 'vitest';
import { run } from '../src/core/tick';
import { withBluePackage } from '../src/oob/assembly';
import { buildAdaptiveStrikeScenario } from '../src/scenarios/strike-adaptive';
import { buildEscalationScenario } from '../src/scenarios/strike-escalation';
import { buildFjordScenario } from '../src/scenarios/strike-fjord';
import {
  decoyPackage,
  decoySweepPlan,
  emissionsBaitPlan,
  escalationPackage,
  escalationPlan,
  fjordPlan,
  fjordSeadPackage,
  fjordSeadPlan,
  saturationPackage,
  saturationPlan,
} from '../src/scenarios/plans';
import { adaptNemesis, applyNemesisDoctrine, newCampaign, type NemesisProfile } from '../src/campaign/campaign';
import { importRoster } from '../src/scenarios/breach-roster';

const SEED = 42;

function baseline(): NemesisProfile {
  return newCampaign(importRoster()).nemesis;
}

/**
 * The remaining nemesis axes (triage item #3): gap-filler radar, point-
 * defense alert, decoy discrimination. Same contract as the first axis —
 * every adaptation keyed to observable evidence, every counter defeats the
 * plan that generated the evidence, and every counter has a PROVEN
 * counter-counter locked in below.
 */

describe('nemesis axis: gap-filler radar (counter to the unobserved strike)', () => {
  it('mission 1: the fjord run leaves exactly the evidence — losses with zero tracks', () => {
    const m1 = run(applyNemesisDoctrine(buildFjordScenario(), baseline()), fjordPlan(), SEED, 400);
    expect(m1.units['red-hq']!.alive).toBe(false);
    expect(m1.events.some((e) => e.type === 'DETECTION' && e.side === 'RED')).toBe(false);

    const nemesis = adaptNemesis(baseline(), m1);
    expect(nemesis.gapFiller).toBe(true);
    expect(nemesis.notes.some((n) => n.includes('gap-filler radar deployed'))).toBe(true);
  });

  it('a tracked mission does NOT read as a terrain-masked approach', () => {
    // The adaptive-strike battery tracks the package all mission — losing
    // units while holding tracks is a different problem, not this one.
    const m = run(
      applyNemesisDoctrine(withBluePackage(buildAdaptiveStrikeScenario(), decoyPackage()), baseline()),
      decoySweepPlan(),
      SEED,
      900,
    );
    expect(adaptNemesis(baseline(), m).gapFiller).toBe(false);
  });

  it('mission 2: the gap-filler closes the corridor — the same fjord plan gets tracked and shot', () => {
    const nemesis = { ...baseline(), gapFiller: true };
    const s0 = applyNemesisDoctrine(buildFjordScenario(), nemesis);
    expect(s0.units['red-gapfill-1']).toBeDefined();
    expect(s0.intel!['red-gapfill-1']!.confidence).toBe('CONTESTED');

    const m2 = run(s0, fjordPlan(), SEED, 400);
    // The corridor is not quiet anymore…
    expect(
      m2.events.some((e) => e.type === 'DETECTION' && e.side === 'RED' && e.sensorUnitId === 'red-gapfill-1'),
    ).toBe(true);
    // …and the battery shoots on the gap-filler's fused track.
    expect(m2.events.some((e) => e.type === 'LAUNCH' && e.side === 'RED')).toBe(true);
    const strikersLost = ['blue-striker-1', 'blue-striker-2'].filter((id) => !m2.units[id]!.alive);
    expect(strikersLost.length).toBeGreaterThan(0);
  });

  it('mission 3 counter-counter: the gap-filler radiates, so a pre-planned Lance reopens the corridor', () => {
    const nemesis = { ...baseline(), gapFiller: true };
    const s0 = applyNemesisDoctrine(
      withBluePackage(buildFjordScenario(), fjordSeadPackage()),
      nemesis,
    );
    const m3 = run(s0, fjordSeadPlan(), SEED, 500);

    // The ARM scare drops the gap-filler dark and the strikers wait it out.
    expect(m3.events.some((e) => e.type === 'EMITTER_SHUTDOWN' && e.unitId === 'red-gapfill-1')).toBe(true);
    expect(m3.events.some((e) => e.type === 'LAUNCH' && e.side === 'RED')).toBe(false);
    expect(m3.units['red-hq']!.alive).toBe(false);
    expect(m3.units['blue-striker-1']!.alive).toBe(true);
    expect(m3.units['blue-striker-2']!.alive).toBe(true);
  });
});

describe('nemesis axis: point-defense alert (counter to the standoff ASM kill)', () => {
  it('mission 1: losing the corvette to a Pike is the evidence', () => {
    const m1 = run(
      applyNemesisDoctrine(withBluePackage(buildEscalationScenario(), escalationPackage()), baseline()),
      escalationPlan(),
      SEED,
      1_400,
    );
    expect(m1.units['red-corvette-1']!.alive).toBe(false);

    const nemesis = adaptNemesis(baseline(), m1);
    expect(nemesis.pointDefenseAlert).toBe(true);
    expect(nemesis.notes.some((n) => n.includes('close-in weapon systems'))).toBe(true);
  });

  it('mission 2: CIWS splashes the lone Pike and the corvette owns the coastal lane again', () => {
    const nemesis = { ...baseline(), pointDefenseAlert: true };
    const m2 = run(
      applyNemesisDoctrine(withBluePackage(buildEscalationScenario(), escalationPackage()), nemesis),
      escalationPlan(),
      SEED,
      1_400,
    );
    expect(m2.events.some((e) => e.type === 'CIWS_INTERCEPT')).toBe(true);
    expect(m2.units['red-corvette-1']!.alive).toBe(true); // the single-missile kill is over
  });

  it('mission 3 counter-counter: a three-Pike saturation salvo — the mount services one inbound per tick', () => {
    const nemesis = { ...baseline(), pointDefenseAlert: true };
    const m3 = run(
      applyNemesisDoctrine(withBluePackage(buildEscalationScenario(), saturationPackage()), nemesis),
      saturationPlan(),
      SEED,
      1_400,
    );
    expect(m3.units['red-corvette-1']!.alive).toBe(false);
    // The rest of the escalation problem still gets solved around it.
    expect(m3.units['red-hq']!.alive).toBe(false);
    expect(m3.units['red-cap-1']!.alive).toBe(false);
    expect(Object.values(m3.units).filter((u) => u.side === 'BLUE' && !u.alive)).toEqual([]);
  });
});

describe('nemesis axis: decoy discrimination (counter to the decoy sweep)', () => {
  it('mission 1: missiles expended on drones are the evidence', () => {
    const m1 = run(
      applyNemesisDoctrine(withBluePackage(buildAdaptiveStrikeScenario(), decoyPackage()), baseline()),
      decoySweepPlan(),
      SEED,
      900,
    );
    const nemesis = adaptNemesis(baseline(), m1);
    expect(nemesis.decoyDiscrimination).toBe(true);
    expect(nemesis.notes.some((n) => n.includes('Wreckage analysis'))).toBe(true);
  });

  it('mission 2: crews hold fire on the ghosts — the salvo goes into the real strikers instead', () => {
    const nemesis = { ...baseline(), decoyDiscrimination: true };
    const m2 = run(
      applyNemesisDoctrine(withBluePackage(buildAdaptiveStrikeScenario(), decoyPackage()), nemesis),
      decoySweepPlan(),
      SEED,
      900,
    );

    // Not one round on a drone — every RED missile went at a manned jet…
    const redLaunches = m2.events.filter((e) => e.type === 'LAUNCH' && e.side === 'RED');
    expect(redLaunches.length).toBeGreaterThan(0);
    expect(redLaunches.every((e) => e.type === 'LAUNCH' && !m2.units[e.targetId]?.decoy)).toBe(true);
    // …and the sweep's whole value proposition (a free win, zero losses,
    // battery posture bought with drones) is gone: the dash eats the salvo.
    const strikersLost = ['blue-striker-1', 'blue-striker-2'].filter((id) => !m2.units[id]!.alive);
    expect(strikersLost.length).toBeGreaterThan(0);
  });

  it('mission 3 counter-counter: discriminated decoys still CUE the radar — emissions bait for a reactive Lance', () => {
    const nemesis = { ...baseline(), decoyDiscrimination: true };
    const m3 = run(
      applyNemesisDoctrine(withBluePackage(buildAdaptiveStrikeScenario(), decoyPackage()), nemesis),
      emissionsBaitPlan(),
      SEED,
      900,
    );

    // The ghosts lit the radar up (cue logic is untouched by discrimination)…
    expect(m3.events.some((e) => e.type === 'SAM_EMCON' && e.emitting)).toBe(true);
    // …the Lance arrived at a LIVE emitter and bought the full blink window…
    expect(m3.events.some((e) => e.type === 'EMITTER_SHUTDOWN' && e.unitId === 'red-sam-1')).toBe(true);
    // …and the strike walked through it: no RED launch at anything real.
    const launchesAtManned = m3.events.filter(
      (e) => e.type === 'LAUNCH' && e.side === 'RED' && !m3.units[e.targetId]?.decoy,
    );
    expect(launchesAtManned).toEqual([]);
    expect(m3.units['red-hq']!.alive).toBe(false);
    const manned = Object.values(m3.units).filter((u) => u.side === 'BLUE' && !u.decoy);
    expect(manned.every((u) => u.alive)).toBe(true);
  });
});
