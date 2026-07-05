import { describe, expect, it } from 'vitest';
import { run } from '../src/core/tick';
import { miniState, plane } from './helpers';

describe('fuel and loiter budget', () => {
  it('bingo fuel forces RTB toward home base', () => {
    const jet = plane('jet', 'BLUE', 0, 8_000, {
      speed: 250,
      fuelKg: 120,
      burnKgPerTick: 1,
      bingoKg: 100,
      homeBase: { x: -50_000, y: 0, alt: 0 },
      waypoints: [{ x: 100_000, y: 0, alt: 8_000 }], // flying the wrong way
    });
    const s0 = miniState([jet]);
    const s = run(s0, [], 1, 30);

    const bingo = s.events.find((e) => e.type === 'BINGO_FUEL');
    expect(bingo).toBeDefined();
    // 20th burn lands during tick 19 (ticks are zero-based): 120 − 20 = 100 = bingo
    expect(bingo!.tick).toBe(19);
    const u = s.units['jet']!;
    expect(u.rtb).toBe(true);
    expect(u.waypoints).toEqual([{ x: -50_000, y: 0, alt: 0 }]);
    // Turned around: 20 ticks east, then ~10 ticks back west (the descent
    // toward home eats a sliver of each tick's 250 m of horizontal progress).
    expect(u.pos.x).toBeLessThan(20 * 250 - 9 * 250);
    expect(u.pos.x).toBeGreaterThan(20 * 250 - 11 * 250);
  });

  it('fuel exhaustion downs the aircraft', () => {
    const jet = plane('jet', 'BLUE', 0, 8_000, {
      fuelKg: 10,
      burnKgPerTick: 1,
      // no bingo/homeBase — nowhere to go
    });
    const s = run(miniState([jet]), [], 1, 15);
    expect(s.units['jet']!.alive).toBe(false);
    expect(s.events.some((e) => e.type === 'FUEL_EXHAUSTED')).toBe(true);
  });

  it('burns fuel linearly per tick', () => {
    const jet = plane('jet', 'BLUE', 0, 8_000, { fuelKg: 100, burnKgPerTick: 1 });
    const s = run(miniState([jet]), [], 1, 5);
    expect(s.units['jet']!.fuelKg).toBe(95);
  });
});
