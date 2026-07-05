import { describe, expect, it } from 'vitest';
import { inEnvelope, validateLaunch } from '../src/core/weapons.js';
import { WEAPONS } from '../src/scenarios/strike-basic.js';
import { miniState, plane, radarSite } from './helpers.js';

const sam = WEAPONS['sam-longbow']!;
const agm = WEAPONS['agm-stormbreak']!;

describe('weapon envelopes', () => {
  it('gates on range band', () => {
    const site = radarSite('sam', 'RED', 0, 90_000, { weapons: [{ weaponId: sam.id, count: 4 }] });
    const near = plane('near', 'BLUE', -2_000, 8_000); // inside minRange 3 km
    const inside = plane('inside', 'BLUE', -30_000, 8_000);
    const far = plane('far', 'BLUE', -45_000, 8_000); // outside maxRange 40 km
    expect(inEnvelope(sam, site, near)).toBe(false);
    expect(inEnvelope(sam, site, inside)).toBe(true);
    expect(inEnvelope(sam, site, far)).toBe(false);
  });

  it('gates on target altitude band', () => {
    const site = radarSite('sam', 'RED', 0, 90_000);
    const inTheWeeds = plane('low', 'BLUE', -20_000, 50); // below minTargetAlt 100 m
    const cruising = plane('mid', 'BLUE', -20_000, 8_000);
    expect(inEnvelope(sam, site, inTheWeeds)).toBe(false);
    expect(inEnvelope(sam, site, cruising)).toBe(true);
  });

  it('gates on target domain', () => {
    const shooter = plane('s', 'BLUE', -20_000, 8_000);
    const groundTarget = radarSite('g', 'RED', 0, 0);
    const airTarget = plane('a', 'RED', -5_000, 8_000);
    expect(inEnvelope(agm, shooter, groundTarget)).toBe(true);
    expect(inEnvelope(agm, shooter, airTarget)).toBe(false);
  });
});

describe('ROE authority gate', () => {
  function setup(roe: 'HOLD' | 'TIGHT' | 'FREE', prebriefed: string[] = []) {
    const shooter = plane('shooter', 'BLUE', -20_000, 8_000, {
      weapons: [{ weaponId: agm.id, count: 2 }],
    });
    const target = radarSite('target', 'RED', 0, 0);
    const s = miniState([shooter, target], {
      roe: { BLUE: roe, RED: 'FREE' },
      prebriefedTargets: { BLUE: prebriefed, RED: [] },
    });
    return { s, shooter, target };
  }

  it('HOLD denies everything', () => {
    const { s, shooter, target } = setup('HOLD', ['target']);
    expect(validateLaunch(s, shooter, agm, target)).toBe('ROE_HOLD');
  });

  it('TIGHT clears only pre-briefed targets', () => {
    const briefed = setup('TIGHT', ['target']);
    expect(validateLaunch(briefed.s, briefed.shooter, agm, briefed.target)).toBeNull();
    const unbriefed = setup('TIGHT');
    expect(validateLaunch(unbriefed.s, unbriefed.shooter, agm, unbriefed.target)).toBe(
      'ROE_TIGHT_NO_PREBRIEF',
    );
  });

  it('FREE clears valid contacts without a brief', () => {
    const { s, shooter, target } = setup('FREE');
    expect(validateLaunch(s, shooter, agm, target)).toBeNull();
  });
});

describe('launch validation', () => {
  it('denies with no weapon remaining', () => {
    const shooter = plane('shooter', 'BLUE', -20_000, 8_000, {
      weapons: [{ weaponId: agm.id, count: 0 }],
    });
    const target = radarSite('target', 'RED', 0, 0);
    const s = miniState([shooter, target]);
    expect(validateLaunch(s, shooter, agm, target)).toBe('NO_WEAPON');
  });

  it('a SAM cannot fire without a good enough track', () => {
    const site = radarSite('sam', 'RED', 0, 90_000, {
      weapons: [{ weaponId: sam.id, count: 4 }],
    });
    const target = plane('t', 'BLUE', -20_000, 8_000);
    const s = miniState([site, target]);
    expect(validateLaunch(s, site, sam, target)).toBe('NO_TRACK');

    s.contacts.RED['t'] = { targetId: 't', firstDetectedTick: 0, lastSeenTick: 0, quality: 0.3 };
    expect(validateLaunch(s, site, sam, target)).toBe('NO_TRACK');

    s.contacts.RED['t']!.quality = 0.6;
    expect(validateLaunch(s, site, sam, target)).toBeNull();
  });
});
