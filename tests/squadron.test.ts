import { describe, expect, it } from 'vitest';
import { buildStrikeScenario } from '../src/scenarios/strike-basic';
import { applySquadronState, newCampaign, type AirframeRecord } from '../src/campaign/campaign';
import { importRoster } from '../src/scenarios/breach-roster';

describe('squadron state applied in-mission (campaign layer)', () => {
  it('accumulated fatigue costs fuel discipline: a tired pilot burns more', () => {
    const squadron: AirframeRecord[] = newCampaign(importRoster()).squadron.map((r) =>
      r.unitId === 'blue-striker-1' ? { ...r, fatigue: 3 } : r,
    );
    const fresh = buildStrikeScenario();
    const worn = applySquadronState(buildStrikeScenario(), squadron);

    const freshBurn = fresh.units['blue-striker-1']!.burnKgPerTick!;
    const wornBurn = worn.units['blue-striker-1']!.burnKgPerTick!;
    expect(wornBurn).toBeCloseTo(freshBurn * 1.12, 4); // +4% per fatigue point
    // Wingman flew no sorties — untouched.
    expect(worn.units['blue-striker-2']!.burnKgPerTick).toBe(freshBurn);
  });

  it('a LOST airframe does not fly the next mission', () => {
    const squadron: AirframeRecord[] = newCampaign(importRoster()).squadron.map((r) =>
      r.unitId === 'blue-striker-2' ? { ...r, status: 'LOST' as const } : r,
    );
    const s = applySquadronState(buildStrikeScenario(), squadron);
    expect(s.units['blue-striker-2']).toBeUndefined();
    expect(s.units['blue-striker-1']).toBeDefined();
  });

  it('fatigue penalty is capped at +40%', () => {
    const squadron: AirframeRecord[] = newCampaign(importRoster()).squadron.map((r) =>
      r.unitId === 'blue-striker-1' ? { ...r, fatigue: 25 } : r,
    );
    const s = applySquadronState(buildStrikeScenario(), squadron);
    expect(s.units['blue-striker-1']!.burnKgPerTick).toBeCloseTo(1.3 * 1.4, 4);
  });
});
