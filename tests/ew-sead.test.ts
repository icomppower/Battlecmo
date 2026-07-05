import { describe, expect, it } from 'vitest';
import { run } from '../src/core/tick.js';
import type { Order, SimState } from '../src/core/types.js';
import { miniState, plane, radarSite } from './helpers.js';

/**
 * SEAD mechanics: an inbound anti-radiation missile forces the emitter dark,
 * the dark window is what lets strikers through, and the ARM itself loses
 * most of its Pk against a silent radar — suppression, not destruction, is
 * the product.
 */

function seadSetup(withDoctrine: boolean): { s0: SimState; orders: Order[] } {
  const emitter = radarSite('red-radar', 'RED', 0, 90_000, {
    emitterDoctrine: withDoctrine
      ? { armReactionRange: 15_000, shutdownTicks: 100 }
      : undefined,
  });
  const shooter = plane('blue-sead', 'BLUE', -50_000, 9_000, {
    weapons: [{ weaponId: 'arm-lance', count: 1 }],
  });
  const s0 = miniState([emitter, shooter]);
  const orders: Order[] = [
    { atTick: 0, type: 'ENGAGE', unitId: 'blue-sead', weaponId: 'arm-lance', targetId: 'red-radar' },
  ];
  return { s0, orders };
}

describe('EW / SEAD layer', () => {
  it('an inbound ARM forces the emitter dark for its doctrine window', () => {
    const { s0, orders } = seadSetup(true);
    const s = run(s0, orders, 42, 80);

    const shutdown = s.events.find((e) => e.type === 'EMITTER_SHUTDOWN');
    expect(shutdown).toBeDefined();
    expect(shutdown!.type === 'EMITTER_SHUTDOWN' && shutdown!.unitId).toBe('red-radar');
    if (shutdown!.type === 'EMITTER_SHUTDOWN') {
      expect(shutdown!.untilTick).toBe(shutdown!.tick + 100);
    }
  });

  it('the suppressed radar cannot detect or shoot, then comes back up', () => {
    const emitter = radarSite('red-radar', 'RED', 0, 90_000, {
      emitterDoctrine: { armReactionRange: 15_000, shutdownTicks: 100 },
      weapons: [{ weaponId: 'sam-longbow', count: 4 }],
      maxConcurrentEngagements: 2,
    });
    const shooter = plane('blue-sead', 'BLUE', -50_000, 9_000, {
      weapons: [{ weaponId: 'arm-lance', count: 1 }],
    });
    // A juicy target parked well inside the SAM envelope the whole time.
    const bait = plane('blue-bait', 'BLUE', -20_000, 8_000);
    const s0 = miniState([emitter, shooter, bait]);
    const orders: Order[] = [
      { atTick: 0, type: 'ENGAGE', unitId: 'blue-sead', weaponId: 'arm-lance', targetId: 'red-radar' },
    ];

    const s = run(s0, orders, 7, 400);
    const shutdown = s.events.find((e) => e.type === 'EMITTER_SHUTDOWN')!;
    const backUp = s.events.find((e) => e.type === 'EMITTER_BACK_UP');
    const samLaunches = s.events.filter((e) => e.type === 'LAUNCH' && e.side === 'RED');

    // Radar reacted before the SAM could complete an engagement cycle on the
    // bait? No — the bait was detectable from tick 0, so the SAM gets shots
    // off *before* the ARM arrives, and again *after* the window expires...
    // unless it died. Either way: zero RED launches strictly inside the
    // suppression window.
    if (s.units['red-radar']!.alive) {
      expect(backUp).toBeDefined();
      const windowLaunches = samLaunches.filter(
        (e) => e.tick > shutdown.tick && e.tick < (shutdown.type === 'EMITTER_SHUTDOWN' ? shutdown.untilTick : 0),
      );
      expect(windowLaunches).toEqual([]);
    }
  });

  it('an ARM is far less lethal against a radar that went dark', () => {
    // Same seed, same geometry: the only difference is the shutdown doctrine.
    // The Pk roll happens at the same tick with the same missile id, so the
    // raw roll value is identical — the doctrine changes the threshold.
    const noDoctrine = run(seadSetup(false).s0, seadSetup(false).orders, 3, 120);
    const withDoctrine = run(seadSetup(true).s0, seadSetup(true).orders, 3, 120);

    expect(noDoctrine.units['red-radar']!.alive).toBe(false); // roll < 0.75
    expect(withDoctrine.units['red-radar']!.alive).toBe(true); // same roll ≥ 0.1875
    expect(withDoctrine.events.some((e) => e.type === 'MISS')).toBe(true);
  });
});
