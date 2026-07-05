import { describe, expect, it } from 'vitest';
import { canDetect, effectiveRange, jammingFactor, rcsScaledRange } from '../src/core/sensors';
import { radarHorizon } from '../src/core/geometry';
import { miniState, plane, radarSite } from './helpers';

describe('sensor model', () => {
  it('detection range scales with the 4th root of RCS', () => {
    const sensor = { id: 's', kind: 'RADAR' as const, baseRange: 100_000, refRcs: 5, emitting: true };
    expect(rcsScaledRange(sensor, 5)).toBeCloseTo(100_000);
    // 1/16th the RCS ⇒ half the detection range.
    expect(rcsScaledRange(sensor, 5 / 16)).toBeCloseTo(50_000);
    expect(rcsScaledRange(sensor, 80)).toBeCloseTo(200_000);
  });

  it('holds a big target farther than a stealthy one', () => {
    const radar = radarSite('r', 'RED', 0, 100_000);
    const stealthy = plane('stealthy', 'BLUE', -90_000, 8_000, { rcs: 0.1 });
    const barn = plane('barn', 'BLUE', -90_000, 8_000, { rcs: 100 });
    const s = miniState([radar, stealthy, barn]);
    expect(canDetect(s, radar, stealthy)).toBe(false); // ~37.6 km vs 90 km
    expect(canDetect(s, radar, barn)).toBe(true); // ~211 km vs 90 km
  });

  it('masks targets below the radar horizon', () => {
    const radar = radarSite('r', 'RED', 0, 300_000);
    const lowFlyer = plane('low', 'BLUE', -100_000, 30);
    const highFlyer = plane('high', 'BLUE', -100_000, 8_000);
    const s = miniState([radar, lowFlyer, highFlyer]);
    // Sanity: the horizon between 15 m and 30 m really is short of 100 km.
    expect(radarHorizon(15, 30)).toBeLessThan(100_000);
    expect(canDetect(s, radar, lowFlyer)).toBe(false);
    expect(canDetect(s, radar, highFlyer)).toBe(true);
  });

  it('jamming multiplies down radar range, and stacks across jammers', () => {
    const radar = radarSite('r', 'RED', 0, 100_000);
    const target = plane('t', 'BLUE', -60_000, 8_000, { rcs: 5 });
    const jam1 = plane('j1', 'BLUE', -80_000, 10_000, {
      jammer: { range: 130_000, strength: 0.5, active: true },
    });
    const s = miniState([radar, target, jam1]);
    expect(jammingFactor(s, radar)).toBeCloseTo(0.5);
    expect(effectiveRange(s, radar, radar.sensors[0]!, target)).toBeCloseTo(50_000);
    expect(canDetect(s, radar, target)).toBe(false); // 60 km > jammed 50 km

    const jam2 = plane('j2', 'BLUE', -70_000, 10_000, {
      jammer: { range: 130_000, strength: 0.5, active: true },
    });
    const s2 = miniState([radar, target, jam1, jam2]);
    expect(jammingFactor(s2, radar)).toBeCloseTo(0.25);
  });

  it('a jammer outside its own coverage range does nothing', () => {
    const radar = radarSite('r', 'RED', 0, 100_000);
    const jam = plane('j', 'BLUE', -200_000, 10_000, {
      jammer: { range: 130_000, strength: 0.5, active: true },
    });
    const s = miniState([radar, jam]);
    expect(jammingFactor(s, radar)).toBe(1);
  });

  it('a suppressed or silent radar sees nothing', () => {
    const radar = radarSite('r', 'RED', 0, 100_000);
    const target = plane('t', 'BLUE', -50_000, 8_000, { rcs: 5 });
    const s = miniState([radar, target]);
    expect(canDetect(s, radar, target)).toBe(true);

    radar.suppressedUntilTick = 100;
    expect(canDetect(s, radar, target)).toBe(false);

    radar.suppressedUntilTick = undefined;
    radar.sensors[0]!.emitting = false;
    expect(canDetect(s, radar, target)).toBe(false);
  });
});
