import { describe, expect, it } from 'vitest';
import { run } from '../src/core/tick';
import { canDetect } from '../src/core/sensors';
import { inEnvelope } from '../src/core/weapons';
import { losBlockedByTerrain, terrainHeightAt, aglOf } from '../src/core/terrain';
import { ROMSDAL } from '../src/terrain/index';
import { buildFjordScenario } from '../src/scenarios/strike-fjord';
import { fjordPlan } from '../src/scenarios/plans';
import { WEAPONS } from '../src/scenarios/strike-basic';

const SEED = 42;

describe('heightfield terrain (real Romsdal SRTM data)', () => {
  it('samples the real relief: fjord-head flats low, the massif high, sea at zero', () => {
    expect(terrainHeightAt(ROMSDAL, 2_000, -2_000)).toBeLessThan(150); // Åndalsnes flats
    expect(terrainHeightAt(ROMSDAL, 20_000, -10_000)).toBeGreaterThan(1_000); // the massif
    expect(terrainHeightAt(ROMSDAL, -40_000, 12_000)).toBeLessThan(10); // Romsdalsfjorden
    expect(terrainHeightAt(ROMSDAL, -200_000, 0)).toBe(0); // beyond the map: flat sea
  });

  it('LOS: the corridor release point is masked from both radars at 120 m, seen at 5000 m', () => {
    const releasePt = { x: -22_500, y: 11_000, alt: 120 };
    const summit = { x: 1_000, y: 8_000, alt: 987 };
    const samSite = { x: 2_000, y: -2_000, alt: 90 };
    expect(losBlockedByTerrain(releasePt, summit, ROMSDAL)).toBe(true);
    expect(losBlockedByTerrain(releasePt, samSite, ROMSDAL)).toBe(true);
    expect(losBlockedByTerrain({ ...releasePt, alt: 5_000 }, summit, ROMSDAL)).toBe(false);
  });

  it('canDetect consults the heightfield: same jet, masked low, seen high', () => {
    const s = buildFjordScenario();
    const ew = s.units['red-ew-1']!;
    const jet = s.units['blue-striker-1']!;
    jet.pos = { x: -22_500, y: 11_000, alt: 120 };
    expect(canDetect(s, ew, jet)).toBe(false);
    jet.pos = { ...jet.pos, alt: 5_000 };
    expect(canDetect(s, ew, jet)).toBe(true);
  });

  it('engagement floors are height OVER GROUND: a valley hugger is under the floor', () => {
    const s = buildFjordScenario();
    const sam = s.units['red-sam-1']!;
    const jet = s.units['blue-striker-1']!;
    const longbow = WEAPONS['sam-longbow']!; // 100 m engagement floor

    // 180 m MSL over the ~95 m fjord-head ground: ~85 m AGL — under the floor.
    jet.pos = { x: 3_500, y: -3_000, alt: 180 };
    expect(aglOf(s, jet)).toBeLessThan(100);
    expect(inEnvelope(s, longbow, sam, jet)).toBe(false);

    // The same 180 m out over the water IS 180 m AGL — engageable.
    jet.pos = { x: -15_000, y: 8_000, alt: 180 };
    expect(aglOf(s, jet)).toBeGreaterThan(100);
    expect(inEnvelope(s, longbow, sam, jet)).toBe(true);
  });
});

describe('strike-fjord: the mission Norway wrote', () => {
  it('high ingress over the sea is seen ~90 km out by the summit radar', () => {
    const s = run(buildFjordScenario(), [
      { atTick: 0, type: 'SET_ROE', side: 'BLUE', level: 'TIGHT' },
      { atTick: 0, type: 'SET_WAYPOINTS', unitId: 'blue-striker-1', waypoints: [{ x: 0, y: 0, alt: 6_000 }] },
    ], SEED, 300);
    const det = s.events.find(
      (e) => e.type === 'DETECTION' && e.side === 'RED' && e.targetId === 'blue-striker-1',
    );
    expect(det).toBeDefined();
    expect(det!.tick).toBeLessThan(40); // still ~90+ km from the coast
    expect(det!.type === 'DETECTION' && det!.sensorUnitId).toBe('red-ew-1');
  });

  it('the fjord corridor delivers the strike with ZERO enemy detections', () => {
    const s = run(buildFjordScenario(), fjordPlan(), SEED, 450);

    expect(s.units['red-hq']!.alive).toBe(false);
    // Not "survived the engagement" — there never was one. Terrain denied
    // the track the SAM's doctrine needs before it could deny anything else.
    expect(s.events.filter((e) => e.type === 'DETECTION' && e.side === 'RED')).toEqual([]);
    expect(s.events.filter((e) => e.type === 'LAUNCH' && e.side === 'RED')).toEqual([]);
    expect(s.units['blue-striker-1']!.alive).toBe(true);
    expect(s.units['blue-striker-2']!.alive).toBe(true);
  });
});
