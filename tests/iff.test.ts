import { describe, expect, it } from 'vitest';
import { run } from '../src/core/tick';
import { HOSTILE_ID_QUALITY, VID_QUALITY, identifyContact } from '../src/core/sensors';
import { validateLaunch } from '../src/core/weapons';
import { WEAPONS } from '../src/scenarios/strike-basic';
import type { Contact, Order, Unit } from '../src/core/types';
import { miniState, plane } from './helpers';

const SEED = 42;

/**
 * IFF / friendly-fire (triage item #5). The design contract:
 *
 *  - identification is DETERMINISTIC and computed, never stored — a pure
 *    function of allegiance truth, transponder state, and track quality;
 *  - it modifies validateLaunch, the single gate every shot passes through:
 *    an identified FRIEND is never clearable at any ROE, while an UNKNOWN
 *    bogey under FREE is a legal shot — which is what makes weapons-free a
 *    decision with a price instead of a strict upgrade;
 *  - geometry decides who lives: VID quality (0.8) sits above every weapon's
 *    requiredTrackQuality, so from a cold track the launch decision always
 *    ripens first. A silent friend detected far out gets VID'd before it is
 *    engageable; one popping up inside the ring gets shot.
 */

function contact(targetId: string, quality: number): Contact {
  return { targetId, firstDetectedTick: 0, lastSeenTick: 0, quality };
}

/** BLUE picket destroyer: search radar + area SAM on auto-engage. */
function picket(): Unit {
  return {
    id: 'blue-picket-1',
    side: 'BLUE',
    domain: 'SEA',
    name: 'Aegis picket',
    pos: { x: 0, y: 0, alt: 12 },
    speed: 0,
    maxSpeed: 15,
    rcs: 300,
    sensors: [{ id: 'spy', kind: 'RADAR', baseRange: 120_000, refRcs: 5, emitting: true }],
    weapons: [{ weaponId: 'sam-longbow', count: 6 }],
    maxConcurrentEngagements: 1,
    waypoints: [],
    alive: true,
  };
}

/** A striker coming home eastbound-to-westbound through the picket line. */
function returningStriker(x: number, iffOn: boolean): Unit {
  return plane('blue-hammer-1', 'BLUE', x, 8_000, {
    iffOn,
    speed: 250,
    waypoints: [{ x: -100_000, y: 0, alt: 8_000 }],
  });
}

describe('contact identity (computed, deterministic)', () => {
  it('enemy contacts declare HOSTILE only at ID quality; below that they are UNKNOWN', () => {
    const blue = plane('blue-1', 'BLUE', 0, 8_000);
    const red = plane('red-1', 'RED', 40_000, 8_000);
    const s = miniState([blue, red]);
    expect(identifyContact(s, 'BLUE', contact('red-1', HOSTILE_ID_QUALITY - 0.1))).toBe('UNKNOWN');
    expect(identifyContact(s, 'BLUE', contact('red-1', HOSTILE_ID_QUALITY))).toBe('HOSTILE');
  });

  it('a squawking friend reads FRIEND instantly; a silent one needs VID quality', () => {
    const blue = plane('blue-1', 'BLUE', 0, 8_000);
    const friend = plane('blue-2', 'BLUE', 40_000, 8_000);
    const s = miniState([blue, friend]);

    expect(identifyContact(s, 'BLUE', contact('blue-2', 0.2))).toBe('FRIEND'); // squawking

    friend.iffOn = false;
    expect(identifyContact(s, 'BLUE', contact('blue-2', VID_QUALITY - 0.1))).toBe('UNKNOWN');
    expect(identifyContact(s, 'BLUE', contact('blue-2', VID_QUALITY))).toBe('FRIEND'); // VID
  });

  it('a squawking friend never enters its own side contact table; a silent one does', () => {
    const ship = picket();
    const friend = returningStriker(30_000, true);
    let s = miniState([ship, friend], { roe: { BLUE: 'HOLD', RED: 'FREE' } });
    s = run(s, [], SEED, 5);
    expect(s.contacts.BLUE['blue-hammer-1']).toBeUndefined();

    const ship2 = picket();
    const bogey = returningStriker(30_000, false);
    let s2 = miniState([ship2, bogey], { roe: { BLUE: 'HOLD', RED: 'FREE' } });
    s2 = run(s2, [], SEED, 5);
    expect(s2.contacts.BLUE['blue-hammer-1']).toBeDefined();
    expect(s2.events.some((e) => e.type === 'DETECTION' && e.targetId === 'blue-hammer-1')).toBe(true);
  });
});

describe('validateLaunch — the IFF interlock', () => {
  it('an identified FRIEND is never clearable, even weapons-free', () => {
    const ship = picket();
    const friend = returningStriker(20_000, true); // squawking, no contact entry
    const s = miniState([ship, friend], { roe: { BLUE: 'FREE', RED: 'FREE' } });
    expect(validateLaunch(s, ship, WEAPONS['sam-longbow']!, friend)).toBe('TARGET_FRIENDLY');

    // A silent friend held to VID quality is equally protected.
    friend.iffOn = false;
    s.contacts.BLUE['blue-hammer-1'] = contact('blue-hammer-1', 1);
    expect(validateLaunch(s, ship, WEAPONS['sam-longbow']!, friend)).toBe('TARGET_FRIENDLY');
  });

  it('an UNKNOWN own-side bogey is a legal shot under FREE — and only under FREE', () => {
    const ship = picket();
    const bogey = returningStriker(20_000, false);
    const s = miniState([ship, bogey], { roe: { BLUE: 'FREE', RED: 'FREE' } });
    s.contacts.BLUE['blue-hammer-1'] = contact('blue-hammer-1', 0.6); // past launch quality, short of VID

    expect(validateLaunch(s, ship, WEAPONS['sam-longbow']!, bogey)).toBeNull(); // the tragedy is legal

    s.roe.BLUE = 'TIGHT';
    expect(validateLaunch(s, ship, WEAPONS['sam-longbow']!, bogey)).toBe('ROE_TIGHT_NO_PREBRIEF');
    s.roe.BLUE = 'HOLD';
    expect(validateLaunch(s, ship, WEAPONS['sam-longbow']!, bogey)).toBe('ROE_HOLD');
  });
});

describe('blue-on-blue, end to end (defeat, then the counters)', () => {
  it('a silent striker popping up inside a weapons-free picket ring is engaged and killed', () => {
    // Pops up already inside the SAM envelope: launch quality (0.5) ripens at
    // tick 2, VID (0.8) not until tick 3 — the launch decision wins the race.
    const s0 = miniState([picket(), returningStriker(30_000, false)], {
      roe: { BLUE: 'FREE', RED: 'FREE' },
    });
    const s = run(s0, [], SEED, 200);

    const launch = s.events.find((e) => e.type === 'LAUNCH');
    expect(launch).toBeDefined();
    expect(launch!.type === 'LAUNCH' && launch!.shooterId).toBe('blue-picket-1');
    expect(launch!.type === 'LAUNCH' && launch!.targetId).toBe('blue-hammer-1');
    expect(launch!.tick).toBeLessThanOrEqual(3); // fired before the VID could land
    expect(s.units['blue-hammer-1']!.alive).toBe(false); // blue-on-blue
  });

  it('counter 1 — squawk: the transponder resolves the bogey and the picket holds', () => {
    const s0 = miniState([picket(), returningStriker(30_000, true)], {
      roe: { BLUE: 'FREE', RED: 'FREE' },
    });
    const s = run(s0, [], SEED, 200);
    expect(s.events.some((e) => e.type === 'LAUNCH')).toBe(false);
    expect(s.units['blue-hammer-1']!.alive).toBe(true);
  });

  it('counter 2 — ROE discipline: under TIGHT the picket cannot clear an unknown', () => {
    const s0 = miniState([picket(), returningStriker(30_000, false)], {
      roe: { BLUE: 'TIGHT', RED: 'FREE' },
    });
    const s = run(s0, [], SEED, 200);
    expect(s.events.some((e) => e.type === 'LAUNCH')).toBe(false);
    expect(s.units['blue-hammer-1']!.alive).toBe(true);
  });

  it('counter 3 — geometry: detected far out, the VID beats the envelope even silent + FREE', () => {
    // From 80 km the track reaches VID quality in 4 ticks, ~150 ticks before
    // the bogey ever enters the SAM's 40 km envelope. Nobody shoots a friend
    // they have watched all the way in.
    const s0 = miniState([picket(), returningStriker(80_000, false)], {
      roe: { BLUE: 'FREE', RED: 'FREE' },
    });
    const s = run(s0, [], SEED, 400);
    expect(s.events.some((e) => e.type === 'LAUNCH')).toBe(false);
    expect(s.units['blue-hammer-1']!.alive).toBe(true);
  });

  it('the squawk order works mid-mission (SET_IFF rewrites the picture)', () => {
    // Same tragedy geometry, but the striker remembers to squawk at tick 1 —
    // before the launch decision ripens at tick 2.
    const orders: Order[] = [{ atTick: 1, type: 'SET_IFF', unitId: 'blue-hammer-1', on: true }];
    const s0 = miniState([picket(), returningStriker(30_000, false)], {
      roe: { BLUE: 'FREE', RED: 'FREE' },
    });
    const s = run(s0, orders, SEED, 200);
    expect(s.events.some((e) => e.type === 'IFF_SET')).toBe(true);
    expect(s.events.some((e) => e.type === 'LAUNCH')).toBe(false);
    expect(s.units['blue-hammer-1']!.alive).toBe(true);
  });
});

describe('intercept-to-identify (CAP doctrine + identity, for free)', () => {
  it('a CAP commits on an own-side bogey, VIDs it while closing, and breaks off', () => {
    const capJet = plane('red-cap-1', 'RED', 0, 9_000, {
      sensors: [{ id: 'nose', kind: 'RADAR', baseRange: 80_000, refRcs: 5, emitting: true }],
      weapons: [{ weaponId: 'sam-longbow', count: 4 }], // any track-quality AAM stand-in
      maxConcurrentEngagements: 1,
      capDoctrine: {
        station: { x: 0, y: 0, alt: 9_000 },
        commitRange: 65_000,
        cruiseSpeed: 200,
        dashSpeed: 320,
      },
    });
    // A silent squadron-mate drifting home through the CAP's sector, outside
    // every weapon envelope but well inside the commit ring.
    const bogey = plane('red-wingman-9', 'RED', 60_000, 9_000, {
      iffOn: false,
      speed: 150,
      waypoints: [{ x: 200_000, y: 0, alt: 9_000 }],
    });
    const s0 = miniState([capJet, bogey], { roe: { BLUE: 'FREE', RED: 'FREE' } });
    const s = run(s0, [], SEED, 30);

    // It committed on the unknown…
    const commit = s.events.find((e) => e.type === 'CAP_COMMIT');
    expect(commit).toBeDefined();
    expect(commit!.type === 'CAP_COMMIT' && commit!.targetId).toBe('red-wingman-9');
    // …identified it while closing, broke off, and never fired.
    expect(s.units['red-cap-1']!.committedTargetId).toBeUndefined();
    expect(s.events.some((e) => e.type === 'LAUNCH')).toBe(false);
    expect(s.units['red-wingman-9']!.alive).toBe(true);
  });
});
