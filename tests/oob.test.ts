import { describe, expect, it } from 'vitest';
import { tick } from '../src/core/tick';
import { rcsScaledRange } from '../src/core/sensors';
import { buildStrikeScenario } from '../src/scenarios/strike-basic';
import { buildRescueScenario } from '../src/scenarios/rescue-op';
import { goodPlan } from '../src/scenarios/plans';
import {
  AIRFRAMES,
  buildAircraft,
  configStats,
  referencePackage,
  validateConfig,
  withBluePackage,
  type AircraftConfig,
} from '../src/oob/assembly';
import type { SimState } from '../src/core/types';

const SEED = 42;

function run(state: SimState, orders: ReturnType<typeof goodPlan>, ticks: number): SimState {
  let s = state;
  for (let i = 0; i < ticks; i++) s = tick(s, orders, SEED);
  return s;
}

describe('OOB/loadout assembly (Planning Version force composition)', () => {
  it('the reference package reproduces the hand-built strike-basic BLUE OOB exactly', () => {
    const handBuilt = buildStrikeScenario();
    const assembled = withBluePackage(buildStrikeScenario(), referencePackage());
    // Whole unit table: BLUE replaced bit-for-bit, RED untouched.
    expect(assembled.units).toEqual(handBuilt.units);
  });

  it('the assembled package flies the good plan to a byte-identical replay', () => {
    const handBuilt = run(buildStrikeScenario(), goodPlan(), 700);
    const assembled = run(withBluePackage(buildStrikeScenario(), referencePackage()), goodPlan(), 700);
    expect(JSON.stringify(assembled)).toBe(JSON.stringify(handBuilt));
    expect(handBuilt.units['red-hq']!.alive).toBe(false); // and it's the winning mission
  });

  it('rejects overloaded wings, double jammer pods, and unknown parts', () => {
    const overloaded: AircraftConfig = {
      id: 'x1', callsign: 'X 1', airframeId: 'af-ranger',
      stores: ['st-agm-2', 'st-agm-2', 'st-tank'], // 5 stations on 4 hardpoints
    };
    expect(validateConfig(overloaded)).toEqual(['5 stations used, only 4 hardpoints']);
    expect(() => buildAircraft(overloaded)).toThrow(/5 stations/);

    const doubleJam: AircraftConfig = {
      id: 'x2', callsign: 'X 2', airframeId: 'af-ranger', stores: ['st-jampod', 'st-jampod'],
    };
    expect(validateConfig(doubleJam)).toEqual(['only one jamming pod per airframe']);

    expect(validateConfig({ id: 'x3', callsign: 'X 3', airframeId: 'af-nope', stores: [] }))
      .toEqual(["unknown airframe 'af-nope'"]);
    expect(validateConfig({ id: 'x4', callsign: 'X 4', airframeId: 'af-ranger', stores: ['st-nope'] }))
      .toEqual(["unknown store 'st-nope'"]);
  });

  it('loadouts are tradeoffs: more iron means seen earlier and less gas', () => {
    const base = { id: 's', callsign: 'S', airframeId: 'af-ranger' };
    const light = configStats({ ...base, stores: ['st-agm-2'] });
    const heavy = configStats({ ...base, stores: ['st-agm-2', 'st-agm-2'] });

    expect(heavy.weapons).toEqual([{ weaponId: 'agm-stormbreak', count: 4 }]); // racks merge
    expect(heavy.rcs).toBeGreaterThan(light.rcs);
    expect(heavy.enduranceTicks).toBeLessThan(light.enduranceTicks);

    // The RCS penalty is priced in the same radar equation the IADS uses:
    // the bomb truck is detected meaningfully farther out.
    const ews = { id: 'ews', kind: 'RADAR' as const, baseRange: 150_000, refRcs: 5, emitting: true };
    const seenLight = rcsScaledRange(ews, light.rcs);
    const seenHeavy = rcsScaledRange(ews, heavy.rcs);
    expect(seenHeavy).toBeGreaterThan(seenLight + 5_000);
  });

  it('a drop tank buys endurance at the price of signature', () => {
    const base = { id: 's', callsign: 'S', airframeId: 'af-ranger' };
    const clean = configStats({ ...base, stores: ['st-agm-2'] });
    const tanked = configStats({ ...base, stores: ['st-agm-2', 'st-tank'] });
    expect(tanked.enduranceTicks).toBeGreaterThan(clean.enduranceTicks);
    expect(tanked.rcs).toBeGreaterThan(clean.rcs);
  });

  it('withBluePackage preserves the scenario problem: RED, helo, and ground op', () => {
    const custom: AircraftConfig[] = [
      { id: 'blue-striker-1', callsign: 'Hammer 1', airframeId: 'af-ranger', stores: ['st-agm-2', 'st-tank'] },
      { id: 'blue-sead-1', callsign: 'Viper 1', airframeId: 'af-viper', stores: ['st-arm-1'] },
    ];
    const before = buildRescueScenario();
    const after = withBluePackage(buildRescueScenario(), custom);

    // RED order of battle and the ground layer are the scenario's, untouched.
    for (const u of Object.values(before.units)) {
      if (u.side === 'RED' || u.domain !== 'AIR' || u.id === before.groundOp!.heloUnitId) {
        expect(after.units[u.id]).toEqual(u);
      }
    }
    // The old BLUE fixed-wing OOB is gone; the package flies instead.
    expect(after.units['blue-striker-2']).toBeUndefined();
    expect(after.units['blue-ea-1']).toBeUndefined();
    expect(after.units['blue-striker-1']!.fuelKg).toBe(6_400); // internal + tank
    expect(after.groundOp).toEqual(before.groundOp);

    expect(() => withBluePackage(buildRescueScenario(), [custom[0]!, custom[0]!])).toThrow(/duplicate unit id/);
  });

  it('role defaults spawn a flyable package without any spawn overrides', () => {
    const configs: AircraftConfig[] = [
      { id: 'blue-striker-1', callsign: 'Hammer 1', airframeId: 'af-ranger', stores: ['st-agm-2'] },
      { id: 'blue-ea-1', callsign: 'Static 1', airframeId: 'af-static', stores: ['st-jampod'] },
    ];
    const s = withBluePackage(buildStrikeScenario(), configs);
    const striker = s.units['blue-striker-1']!;
    const ew = s.units['blue-ea-1']!;
    expect(AIRFRAMES['af-ranger']!.role).toBe('STRIKE');
    expect(striker.pos.alt).toBe(8_000);
    expect(striker.speed).toBe(250);
    expect(ew.speed).toBe(0); // EW default is a standoff orbit, not an ingress
    expect(ew.jammer).toEqual({ range: 130_000, strength: 0.65, active: false });
  });
});
