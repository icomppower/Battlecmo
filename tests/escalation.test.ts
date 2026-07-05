import { describe, expect, it } from 'vitest';
import { run } from '../src/core/tick';
import { losBlockedByRidge } from '../src/core/geometry';
import { canDetect } from '../src/core/sensors';
import { buildEscalationScenario } from '../src/scenarios/strike-escalation';
import { escalationPackage, escalationPlan, goodPlan } from '../src/scenarios/plans';
import { withBluePackage } from '../src/oob/assembly';
import { miniState, plane, radarSite } from './helpers';
import type { Ridge, SimEvent } from '../src/core/types';

const SEED = 42;

describe('terrain masking (deterministic LOS geometry)', () => {
  const ridge: Ridge = { id: 'r1', x1: 0, y1: -10_000, x2: 0, y2: 10_000, height: 400 };

  it('a low sight line crossing the ridge is blocked; a high one clears the crest', () => {
    const low = { x: -20_000, y: 0, alt: 60 };
    const high = { x: -20_000, y: 0, alt: 6_000 };
    const radar = { x: 20_000, y: 0, alt: 10 };
    expect(losBlockedByRidge(low, radar, ridge)).toBe(true);
    // LOS from 6000 m crosses x=0 at ~3005 m — far above the 400 m crest.
    expect(losBlockedByRidge(high, radar, ridge)).toBe(false);
  });

  it('a sight line that misses the ridge segment is clear regardless of altitude', () => {
    const low = { x: -20_000, y: 15_000, alt: 60 };
    const radar = { x: 20_000, y: 15_000, alt: 10 };
    expect(losBlockedByRidge(low, radar, ridge)).toBe(false);
  });

  it('canDetect honors ridges: same geometry, detection only without the ridge', () => {
    const radar = radarSite('ews', 'RED', 20_000, 150_000);
    const target = plane('striker', 'BLUE', -20_000, 60);
    const masked = miniState([radar, target], { ridges: [ridge] });
    const open = miniState([radar, target]);
    expect(canDetect(masked, radar, target)).toBe(false);
    expect(canDetect(open, radar, target)).toBe(true);
  });
});

describe('escalation scenario: air-to-air, naval, terrain, dossier', () => {
  it('the CAP fighter auto-engages an intruder at altitude with AAMs', () => {
    const s = buildEscalationScenario();
    // One striker blunders straight through the CAP's ring at 8000 m.
    const final = run(s, [
      { atTick: 0, type: 'SET_WAYPOINTS', unitId: 'blue-striker-1', waypoints: [{ x: -30_000, y: 14_000, alt: 8_000 }] },
    ], SEED, 700);
    const capLaunches = final.events.filter(
      (e): e is Extract<SimEvent, { type: 'LAUNCH' }> => e.type === 'LAUNCH' && e.shooterId === 'red-cap-1',
    );
    expect(capLaunches.length).toBeGreaterThan(0);
    expect(capLaunches[0]!.weaponId).toBe('aam-saber');
    expect(final.units['blue-striker-1']!.alive).toBe(false);
  });

  it('the AAM engagement floor: a deck-level target cannot be engaged by the CAP', () => {
    const s = buildEscalationScenario();
    // Same intrusion on the deck: finish the descent to 60 m (below
    // aam-saber's 100 m floor) while still outside the CAP's 55 km ring,
    // then run in low the whole way.
    const final = run(s, [
      { atTick: 0, type: 'SET_WAYPOINTS', unitId: 'blue-striker-1', waypoints: [
        { x: -95_000, y: 5_000, alt: 60 },
        { x: -40_000, y: 14_000, alt: 60 },
      ] },
    ], SEED, 700);
    expect(final.events.some((e) => e.type === 'LAUNCH' && e.shooterId === 'red-cap-1')).toBe(false);
    expect(final.units['blue-striker-1']!.alive).toBe(true);
  });

  it('the corvette (SEA domain) patrols away from its briefed fix and defends its ring', () => {
    const s = buildEscalationScenario();
    // A striker orbits inside the corvette ring at medium altitude.
    const final = run(s, [
      { atTick: 0, type: 'SET_WAYPOINTS', unitId: 'blue-striker-2', waypoints: [{ x: -75_000, y: -25_000, alt: 5_000 }] },
    ], SEED, 600);
    const corvette = final.units['red-corvette-1']!;
    expect(corvette.domain).toBe('SEA');
    // It moved off the APPROX dossier fix — the map ghost is honest about that.
    const briefed = final.intel!['red-corvette-1']!.briefedPos;
    expect(Math.hypot(corvette.pos.x - briefed.x, corvette.pos.y - briefed.y)).toBeGreaterThan(3_000);
    expect(final.events.some((e) => e.type === 'LAUNCH' && e.shooterId === 'red-corvette-1')).toBe(true);
  });

  it('the dossier grades confidence and the CONTESTED fix is genuinely wrong', () => {
    const s = buildEscalationScenario();
    expect(s.intel!['red-sam-1']!.confidence).toBe('VERIFIED');
    expect(s.intel!['red-corvette-1']!.confidence).toBe('APPROX');
    const capIntel = s.intel!['red-cap-1']!;
    expect(capIntel.confidence).toBe('CONTESTED');
    const cap = s.units['red-cap-1']!;
    expect(Math.hypot(cap.pos.x - capIntel.briefedPos.x, cap.pos.y - capIntel.briefedPos.y)).toBeGreaterThan(10_000);
  });

  it('the reference package (v0.1 winning plan) loses to the escalation layers', () => {
    // goodPlan flies the strike-basic timing — the CAP alone should ruin it.
    const final = run(buildEscalationScenario(), goodPlan(), SEED, 900);
    const blueLosses = ['blue-striker-1', 'blue-striker-2'].filter((id) => !final.units[id]!.alive);
    expect(blueLosses.length).toBeGreaterThan(0);
  });

  it('the full counter-plan wins: Pike sinks the corvette, a passive Dart kills the CAP, the ridge corridor delivers the strike', () => {
    const s = withBluePackage(buildEscalationScenario(), escalationPackage());
    const final = run(s, escalationPlan(), SEED, 1_400);

    expect(final.units['red-corvette-1']!.alive).toBe(false); // SEA
    expect(final.units['red-cap-1']!.alive).toBe(false); // AIR
    expect(final.units['red-hq']!.alive).toBe(false); // objective

    // The whole package comes home.
    for (const id of ['blue-striker-1', 'blue-striker-2', 'blue-sead-1', 'blue-ea-1']) {
      expect(final.units[id]!.alive).toBe(true);
    }

    // The kill chain is what the plan claims: the CAP never got a shot off,
    // because the track that killed it was built passively (IRST).
    expect(final.events.some((e) => e.type === 'LAUNCH' && e.shooterId === 'red-cap-1')).toBe(false);
  });
});
