import type { Order, SimState } from '../core/types';
import { buildStrikeScenario } from '../scenarios/strike-basic';
import { buildAdaptiveStrikeScenario } from '../scenarios/strike-adaptive';
import { buildRescueScenario } from '../scenarios/rescue-op';
import { buildEscalationScenario } from '../scenarios/strike-escalation';
import { buildFjordScenario } from '../scenarios/strike-fjord';
import { buildConvoyScenario } from '../scenarios/strike-convoy';
import { buildPicketScenario } from '../scenarios/strike-picket';
import { buildTaiwanStrikeScenario } from '../scenarios/strike-taiwan';
import { validateConfig, withBluePackage, type AircraftConfig } from '../oob/assembly';

/**
 * Plan export/import (triage item C): a mission is exactly its scenario, its
 * committed strike package, its orders log, and its seed — everything `run`
 * needs to reproduce a plan byte-for-byte. Serialization is JSON, nothing
 * fancier; the validation on the way back in is what earns the "never a
 * crash" guarantee — malformed or stale files are rejected with a clear
 * reason, not a thrown TypeError three call frames away.
 */
export interface Mission {
  scenario: string;
  /** null flies the scenario's stock OOB (Mission Builder was never opened). */
  packageConfigs: AircraftConfig[] | null;
  orders: Order[];
  seed: number;
}

/**
 * Scenario registry mirroring web/main.ts's SCENARIOS map. Deliberately
 * excludes 'generated': a generated-tasking mission is not a pure function of
 * {scenario, seed} alone — it also depends on the campaign's mission number
 * and the nemesis's current doctrine — so it falls outside what this small,
 * portable mission format can capture.
 */
const SCENARIO_BUILDERS: Record<string, () => SimState> = {
  'strike-basic': buildStrikeScenario,
  'strike-adaptive': buildAdaptiveStrikeScenario,
  'rescue-op': buildRescueScenario,
  'strike-escalation': buildEscalationScenario,
  'strike-fjord': buildFjordScenario,
  'strike-convoy': buildConvoyScenario,
  'strike-picket': buildPicketScenario,
  'strike-taiwan': buildTaiwanStrikeScenario,
};

/** Order variants that carry a unit id, worth validating against the scenario's OOB. */
function orderUnitId(order: Order): string | undefined {
  switch (order.type) {
    case 'SET_WAYPOINTS':
    case 'SET_JAMMER':
    case 'SET_IFF':
    case 'ENGAGE':
    case 'RTB':
      return order.unitId;
    default:
      return undefined;
  }
}

export function serializeMission(mission: Mission): string {
  return JSON.stringify(mission, null, 2);
}

/** Throws a plain Error with a human-readable reason; never lets a malformed file crash the caller. */
export function deserializeMission(json: string): Mission {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('invalid mission file: not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('invalid mission file: expected a JSON object');
  }
  const m = raw as Record<string, unknown>;

  if (typeof m.scenario !== 'string' || !SCENARIO_BUILDERS[m.scenario]) {
    throw new Error(`invalid mission file: unknown scenario id '${String(m.scenario)}'`);
  }
  if (typeof m.seed !== 'number' || !Number.isFinite(m.seed)) {
    throw new Error('invalid mission file: seed must be a finite number');
  }
  if (!Array.isArray(m.orders)) {
    throw new Error('invalid mission file: orders must be an array');
  }

  let packageConfigs: AircraftConfig[] | null = null;
  if (m.packageConfigs !== null && m.packageConfigs !== undefined) {
    if (!Array.isArray(m.packageConfigs)) {
      throw new Error('invalid mission file: packageConfigs must be an array or null');
    }
    for (const cfg of m.packageConfigs) {
      if (typeof cfg !== 'object' || cfg === null || typeof (cfg as AircraftConfig).id !== 'string') {
        throw new Error('invalid mission file: malformed package config');
      }
      const errors = validateConfig(cfg as AircraftConfig);
      if (errors.length > 0) {
        throw new Error(`invalid mission file: package config '${(cfg as AircraftConfig).id}': ${errors.join('; ')}`);
      }
    }
    packageConfigs = m.packageConfigs as AircraftConfig[];
  }

  // Build the scenario (with the package swapped in, same as the app does)
  // purely to validate that every order's unit id actually exists in it.
  let state = SCENARIO_BUILDERS[m.scenario]!();
  if (packageConfigs) state = withBluePackage(state, packageConfigs);
  const knownUnitIds = new Set(Object.keys(state.units));

  const orders = m.orders as unknown[];
  for (const raw of orders) {
    if (typeof raw !== 'object' || raw === null || typeof (raw as Order).atTick !== 'number' || typeof (raw as Order).type !== 'string') {
      throw new Error('invalid mission file: malformed order');
    }
    const order = raw as Order;
    const unitId = orderUnitId(order);
    if (unitId !== undefined && !knownUnitIds.has(unitId)) {
      throw new Error(`invalid mission file: order references unknown unit '${unitId}'`);
    }
  }

  return { scenario: m.scenario, packageConfigs, orders: orders as Order[], seed: m.seed };
}
