import { describe, expect, it } from 'vitest';
import { run } from '../src/core/tick';
import { buildStrikeScenario } from '../src/scenarios/strike-basic';
import { buildEscalationScenario } from '../src/scenarios/strike-escalation';
import { goodPlan, escalationPackage, escalationPlan, convoyPlan, picketSafePlan, taiwanStrikePlanB } from '../src/scenarios/plans';
import { deserializeMission, serializeMission, type Mission } from '../src/replay/mission-io';

describe('mission export/import round-trip (triage item C)', () => {
  it('serialize → deserialize → run reproduces a byte-identical final state', () => {
    const mission: Mission = { scenario: 'strike-basic', packageConfigs: null, orders: goodPlan(), seed: 42 };
    const restored = deserializeMission(serializeMission(mission));

    expect(restored).toEqual(mission);

    const a = run(buildStrikeScenario(), mission.orders, mission.seed, 700);
    const b = run(buildStrikeScenario(), restored.orders, restored.seed, 700);
    expect(b).toEqual(a);
  });

  it('round-trips a mission that carries a custom package', () => {
    const mission: Mission = {
      scenario: 'strike-escalation',
      packageConfigs: escalationPackage(),
      orders: escalationPlan(),
      seed: 7,
    };
    const restored = deserializeMission(serializeMission(mission));
    expect(restored).toEqual(mission);

    const a = run(buildEscalationScenario(), mission.orders, mission.seed, 900);
    const b = run(buildEscalationScenario(), restored.orders, restored.seed, 900);
    expect(b).toEqual(a);
  });

  it('rejects malformed JSON with a clear error, never a crash', () => {
    expect(() => deserializeMission('not json at all')).toThrow(/not valid JSON/);
    expect(() => deserializeMission('[]')).toThrow(/expected a JSON object/);
  });

  it('rejects an unknown scenario id', () => {
    const bad = JSON.stringify({ scenario: 'not-a-real-scenario', packageConfigs: null, orders: [], seed: 1 });
    expect(() => deserializeMission(bad)).toThrow(/unknown scenario id/);
  });

  it('rejects an order referencing a unit that does not exist in the scenario', () => {
    const bad = JSON.stringify({
      scenario: 'strike-basic',
      packageConfigs: null,
      orders: [{ atTick: 0, type: 'RTB', unitId: 'blue-ghost-99' }],
      seed: 1,
    });
    expect(() => deserializeMission(bad)).toThrow(/unknown unit/);
  });

  it('rejects a malformed package config (invalid loadout)', () => {
    const bad = JSON.stringify({
      scenario: 'strike-basic',
      packageConfigs: [{ id: 'blue-striker-1', callsign: 'Hammer 1', airframeId: 'af-ranger', stores: ['st-agm-2', 'st-agm-2', 'st-agm-2'] }],
      orders: [],
      seed: 1,
    });
    expect(() => deserializeMission(bad)).toThrow(/stations used/);
  });

  it('accepts every UI scenario, including ones added after this module (registry parity)', () => {
    // The naval scenarios landed in a parallel branch; this pins the registry
    // so a new scenario that exports fine can never be rejected on import.
    for (const [scenario, orders] of [
      ['strike-convoy', convoyPlan()],
      ['strike-picket', picketSafePlan()],
      ['strike-taiwan', taiwanStrikePlanB()],
    ] as const) {
      const mission: Mission = { scenario, packageConfigs: null, orders, seed: 42 };
      const restored = deserializeMission(serializeMission(mission));
      expect(restored).toEqual(mission);
    }
  });

  it('defaults a missing packageConfigs to null (stock OOB)', () => {
    const json = JSON.stringify({ scenario: 'strike-basic', orders: [], seed: 1 });
    const restored = deserializeMission(json);
    expect(restored.packageConfigs).toBeNull();
  });
});
