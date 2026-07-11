import { describe, expect, it } from 'vitest';
import { run, tick } from '../src/core/tick';
import { buildConvoyScenario } from '../src/scenarios/strike-convoy';
import { convoyPlan, naiveConvoyPlan } from '../src/scenarios/plans';
import type { SimEvent } from '../src/core/types';

const SEED = 42;

/**
 * The HVU escort problem (triage item E — naval catalog expansion). The
 * frigate's SAM ring (sam-bastion, 34 km) outreaches BLUE's only anti-ship
 * weapon (asm-harpoon, 24 km) — there is no standoff position that is both
 * in weapon range of the supply ship and out of the SAM's envelope. The
 * counter is SEAD, moved to the SEA domain: arm-triton (60 km) outranges the
 * SAM ring, so the frigate's radar can be forced dark from total safety
 * before the harpoon shooter ever has to enter the ring.
 */
describe('strike-convoy: the HVU escort problem', () => {
  it('the naive standoff shot fails — asm-harpoon range sits inside the SAM ring', () => {
    const s = run(buildConvoyScenario(), naiveConvoyPlan(), SEED, 900);

    const frigateLaunches = s.events.filter(
      (e): e is Extract<SimEvent, { type: 'LAUNCH' }> => e.type === 'LAUNCH' && e.shooterId === 'red-frigate-1',
    );
    expect(frigateLaunches.length).toBeGreaterThan(0);
    expect(frigateLaunches[0]!.weaponId).toBe('sam-bastion');
    // The striker never got a shot off — it was dead before it could close
    // inside 24 km, because 24 km is already inside the 34 km SAM ring.
    expect(s.units['blue-striker-1']!.alive).toBe(false);
    expect(s.events.some((e) => e.type === 'LAUNCH' && e.shooterId === 'blue-striker-1')).toBe(false);
    expect(s.units['red-supply-1']!.alive).toBe(true);
  });

  it('the counter-plan wins: anti-ship SEAD blinds the frigate, the harpoon shooter sinks the HVU clean', () => {
    const s = run(buildConvoyScenario(), convoyPlan(), SEED, 1_400);

    expect(s.events.some((e) => e.type === 'EMITTER_SHUTDOWN' && e.unitId === 'red-frigate-1')).toBe(true);
    expect(s.units['red-supply-1']!.alive).toBe(false); // the objective is dead
    // The frigate never got a shot off at anyone — its radar was down for
    // the whole dash.
    expect(s.events.some((e) => e.type === 'LAUNCH' && e.side === 'RED')).toBe(false);
    // The whole package comes home.
    expect(s.units['blue-striker-1']!.alive).toBe(true);
    expect(s.units['blue-sead-1']!.alive).toBe(true);
  });

  it('replay determinism: same seed + orders is byte-identical, tick-by-tick matches a straight run', () => {
    const orders = convoyPlan();
    const a = run(buildConvoyScenario(), orders, SEED, 800);
    const b = run(buildConvoyScenario(), orders, SEED, 800);
    expect(a).toEqual(b);

    let stepped = buildConvoyScenario();
    for (let i = 0; i < 800; i++) stepped = tick(stepped, orders, SEED);
    expect(stepped).toEqual(a);
  });
});
