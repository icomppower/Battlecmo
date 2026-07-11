import { describe, expect, it } from 'vitest';
import {
  STARTING_STOCK,
  expendStores,
  newCampaign,
  restSquadron,
  type AirframeRecord,
} from '../src/campaign/campaign';
import { storeAvailable } from '../src/oob/assembly';
import { importRoster } from '../src/scenarios/breach-roster';
import { miniState } from './helpers';

describe('pilot rest (triage item F)', () => {
  const squadron: AirframeRecord[] = newCampaign(importRoster()).squadron.map((r) =>
    r.unitId === 'blue-striker-1' ? { ...r, fatigue: 3 } : r,
  );

  it('recovers 1 fatigue per skipped mission per pilot', () => {
    const rested = restSquadron(squadron, 1);
    expect(rested.find((r) => r.unitId === 'blue-striker-1')!.fatigue).toBe(2);
  });

  it('floors at 0 — rest never goes negative', () => {
    const rested = restSquadron(squadron, 99);
    expect(rested.every((r) => r.fatigue === 0)).toBe(true);
  });

  it('multiple skipped missions stack linearly', () => {
    const rested = restSquadron(squadron, 3);
    expect(rested.find((r) => r.unitId === 'blue-striker-1')!.fatigue).toBe(0);
  });

  it('a LOST airframe has no pilot left to rest — untouched', () => {
    const withLoss = squadron.map((r) => (r.unitId === 'blue-sead-1' ? { ...r, status: 'LOST' as const } : r));
    const rested = restSquadron(withLoss, 1);
    const lost = rested.find((r) => r.unitId === 'blue-sead-1')!;
    expect(lost.status).toBe('LOST');
    expect(lost.fatigue).toBe(0); // was already 0; status short-circuits the update either way
  });
});

describe('stores stock pool (triage item F)', () => {
  it('decrements one round per BLUE launch, keyed by weapon id', () => {
    const final = miniState([], {
      events: [
        { tick: 10, type: 'LAUNCH', side: 'BLUE', shooterId: 'blue-striker-1', weaponId: 'agm-stormbreak', targetId: 'red-hq', missileId: 'm1' },
        { tick: 11, type: 'LAUNCH', side: 'BLUE', shooterId: 'blue-striker-2', weaponId: 'agm-stormbreak', targetId: 'red-hq', missileId: 'm2' },
        { tick: 12, type: 'LAUNCH', side: 'BLUE', shooterId: 'blue-sead-1', weaponId: 'arm-lance', targetId: 'red-sam-1', missileId: 'm3' },
      ],
    });
    const next = expendStores({ ...STARTING_STOCK }, final);
    expect(next['agm-stormbreak']).toBe(STARTING_STOCK['agm-stormbreak']! - 2);
    expect(next['arm-lance']).toBe(STARTING_STOCK['arm-lance']! - 1);
    // Untouched weapon types are left alone.
    expect(next['asm-pike']).toBe(STARTING_STOCK['asm-pike']);
  });

  it('ignores RED launches — those are the enemy staff’s stores, not ours', () => {
    const final = miniState([], {
      events: [
        { tick: 5, type: 'LAUNCH', side: 'RED', shooterId: 'red-sam-1', weaponId: 'sam-longbow', targetId: 'blue-striker-1', missileId: 'm1' },
      ],
    });
    const next = expendStores({ ...STARTING_STOCK }, final);
    expect(next).toEqual(STARTING_STOCK);
  });

  it('floors at 0 — never goes negative even if oversold', () => {
    const final = miniState([], {
      events: Array.from({ length: 5 }, (_, i) => ({
        tick: i,
        type: 'LAUNCH' as const,
        side: 'BLUE' as const,
        shooterId: 'blue-sead-1',
        weaponId: 'arm-lance',
        targetId: 'red-sam-1',
        missileId: `m${i}`,
      })),
    });
    const next = expendStores({ 'arm-lance': 2 }, final);
    expect(next['arm-lance']).toBe(0);
  });

  it('storeAvailable greys out a WEAPON store once its rounds are unaffordable', () => {
    expect(storeAvailable('st-agm-2', { 'agm-stormbreak': 2 })).toBe(true); // needs 2, have 2
    expect(storeAvailable('st-agm-2', { 'agm-stormbreak': 1 })).toBe(false); // needs 2, have 1
    expect(storeAvailable('st-agm-2', {})).toBe(false); // no stock recorded at all
  });

  it('storeAvailable never gates non-weapon hardware (pods, tanks, signature)', () => {
    expect(storeAvailable('st-jampod', {})).toBe(true);
    expect(storeAvailable('st-tank', {})).toBe(true);
    expect(storeAvailable('st-lens', {})).toBe(true);
  });

  it('a fresh campaign starts stocked', () => {
    const campaign = newCampaign(importRoster());
    expect(campaign.stores).toEqual(STARTING_STOCK);
  });
});
