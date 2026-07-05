import { describe, expect, it } from 'vitest';
import { run } from '../src/core/tick';
import { buildRescueScenario } from '../src/scenarios/rescue-op';
import { heloRecklessPlan, rescueNoStrikePlan, rescuePlan } from '../src/scenarios/plans';
import { BREACH_ROSTER } from '../src/scenarios/breach-roster';

const SEED = 42;

describe('rescue-op: the full multi-domain hostage rescue (build order step 4)', () => {
  it('the complete mission: air war opens the door, ground team walks through it', () => {
    const s = run(buildRescueScenario(), rescuePlan(), SEED, 1_600);

    // Phase machine ran the whole ladder on one mission clock.
    const phases = s.events.filter((e) => e.type === 'GROUND_PHASE').map((e) => e.phase);
    expect(phases).toEqual([
      'INFIL',
      'AT_TARGET',
      'BREACHING',
      'SECURED',
      'EXFIL',
      'EXTRACTED',
    ]);
    expect(s.groundOp!.phase).toBe('EXTRACTED');
    expect(s.events.some((e) => e.type === 'TEAM_EXTRACTED' && e.count === 4)).toBe(true);

    // The couplings actually bound: breach only after the C2 node died…
    const hqDeath = s.events.find((e) => e.type === 'UNIT_DESTROYED' && e.unitId === 'red-hq')!;
    const breach = s.events.find((e) => e.type === 'GROUND_PHASE' && e.phase === 'BREACHING')!;
    expect(breach.tick).toBeGreaterThan(hqDeath.tick);

    // …and the MANPADS died before the helo entered its bubble.
    expect(s.units['red-guard-1']!.alive).toBe(false);
    expect(s.units['blue-helo-1']!.alive).toBe(true);

    // The IADS never got a shot off at anyone.
    expect(s.events.filter((e) => e.type === 'LAUNCH' && e.side === 'RED')).toEqual([]);

    // Roster comes home intact.
    expect(s.groundOp!.roster.every((o) => o.status !== 'KIA')).toBe(true);
  });

  it('no strike ⇒ the breach gate never opens and the hostage clock runs out', () => {
    const s = run(buildRescueScenario(), rescueNoStrikePlan(), SEED, 1_100);

    expect(
      s.events.some((e) => e.type === 'GROUND_DENIED' && e.reason === 'ALARM_NET_UP'),
    ).toBe(true);
    expect(s.events.some((e) => e.type === 'HOSTAGE_CLOCK_EXPIRED')).toBe(true);
    expect(s.groundOp!.phase).toBe('COMPROMISED');
  });

  it('sending the helo in before the MANPADS is dead gets it shot down', () => {
    const s = run(buildRescueScenario(), heloRecklessPlan(), SEED, 900);

    const guardShots = s.events.filter(
      (e) => e.type === 'LAUNCH' && e.shooterId === 'red-guard-1',
    );
    expect(guardShots.length).toBeGreaterThan(0);
    expect(s.units['blue-helo-1']!.alive).toBe(false);
    // Nobody was aboard — the roster survives the loss of the aircraft.
    expect(s.groundOp!.roster.every((o) => o.status !== 'KIA')).toBe(true);
  });

  it('imported roster is deep-copied — missions never mutate the source', () => {
    const before = JSON.stringify(BREACH_ROSTER);
    run(buildRescueScenario(), rescuePlan(), SEED, 1_600);
    expect(JSON.stringify(BREACH_ROSTER)).toBe(before);
  });
});
