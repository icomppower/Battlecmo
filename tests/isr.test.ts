import { describe, expect, it } from 'vitest';
import { run } from '../src/core/tick';
import { canDetect } from '../src/core/sensors';
import { buildAircraft, withBluePackage } from '../src/oob/assembly';
import { buildAdaptiveStrikeScenario } from '../src/scenarios/strike-adaptive';
import { buildEscalationScenario } from '../src/scenarios/strike-escalation';
import { goodPlan, sensorWarPackage, sensorWarPlan } from '../src/scenarios/plans';
import { adaptNemesis, applyNemesisDoctrine, newCampaign } from '../src/campaign/campaign';
import { importRoster } from '../src/scenarios/breach-roster';
import { miniState, radarSite } from './helpers';
import type { AircraftConfig, } from '../src/oob/assembly';

const SEED = 42;

function watchtower(spawn: { x: number; y: number; alt: number }): AircraftConfig {
  return {
    id: 'blue-awacs-1',
    callsign: 'Watchtower',
    airframeId: 'af-sentry',
    stores: ['st-airsearch', 'st-gmti'],
    spawn,
    speed: 0,
  };
}

describe('ISR sensor apertures (what keeps the AWACS honest)', () => {
  it('the air-search radar cannot break out surface targets at all', () => {
    const awacs = buildAircraft({ ...watchtower({ x: -60_000, y: 0, alt: 9_500 }), stores: ['st-airsearch'] });
    const parkedSam = radarSite('red-sam', 'RED', 0, 90_000);
    const s = miniState([awacs, parkedSam]);
    expect(canDetect(s, awacs, parkedSam)).toBe(false); // 60 km, huge RCS — still invisible
  });

  it('GMTI sees a mover and is blind to the same unit parked', () => {
    const awacs = buildAircraft({ ...watchtower({ x: -60_000, y: 0, alt: 9_500 }), stores: ['st-gmti'] });
    const sam = radarSite('red-sam', 'RED', 0, 90_000);
    const s = miniState([awacs, sam]);

    expect(canDetect(s, awacs, sam)).toBe(false); // parked in its hide

    sam.speed = 8; // commanded speed alone is not motion…
    expect(canDetect(s, awacs, sam)).toBe(false);
    sam.waypoints = [{ x: 6_000, y: -5_000, alt: 5 }]; // …moving is
    expect(canDetect(s, awacs, sam)).toBe(true);
  });
});

describe('scoot-window surveillance (the problem ISR is FOR)', () => {
  it('GMTI catches the battery displacing, and loses it once it re-hides', () => {
    const s0 = buildAdaptiveStrikeScenario();
    s0.units['blue-awacs-1'] = buildAircraft(watchtower({ x: -120_000, y: -14_000, alt: 9_500 }));
    const s = run(s0, goodPlan(), SEED, 1_600);

    const scoot = s.events.find((e) => e.type === 'SAM_RELOCATING')!;
    const deployed = s.events.find((e) => e.type === 'SAM_DEPLOYED')!;
    const detect = s.events.find(
      (e) => e.type === 'DETECTION' && e.side === 'BLUE' && e.targetId === 'red-sam-1',
    );
    const lost = s.events.find(
      (e) => e.type === 'CONTACT_LOST' && e.side === 'BLUE' && e.targetId === 'red-sam-1',
    );

    // Detection begins with the march, not before…
    expect(detect).toBeDefined();
    expect(detect!.type === 'DETECTION' && detect!.sensorUnitId).toBe('blue-awacs-1');
    expect(detect!.tick).toBeGreaterThanOrEqual(scoot.tick);
    expect(detect!.tick).toBeLessThanOrEqual(scoot.tick + 3);
    // …and the track dies shortly after the battery parks in its new hide.
    expect(lost).toBeDefined();
    expect(lost!.tick).toBeGreaterThan(deployed.tick);
    expect(lost!.tick).toBeLessThan(deployed.tick + 30);
  });
});

describe('the sensor war (nemesis axis: emitter hunting)', () => {
  it('mission 1: the ISR package wins clean, but the orbit leaves an ELINT fingerprint', () => {
    const campaign = newCampaign(importRoster());
    const m1 = run(
      applyNemesisDoctrine(withBluePackage(buildEscalationScenario(), sensorWarPackage()), campaign.nemesis),
      sensorWarPlan(),
      SEED,
      1_400,
    );

    // Same clean sweep as the escalation counter-plan — with a better picture:
    // Watchtower holds the CAP from tick 0 (no IRST creep needed to SEE it).
    expect(m1.units['red-hq']!.alive).toBe(false);
    expect(m1.units['red-corvette-1']!.alive).toBe(false);
    expect(m1.units['red-cap-1']!.alive).toBe(false);
    expect(Object.values(m1.units).filter((u) => u.side === 'BLUE' && !u.alive)).toEqual([]);
    expect(
      m1.events.some(
        (e) =>
          e.type === 'DETECTION' &&
          e.side === 'BLUE' &&
          e.sensorUnitId === 'blue-awacs-1' &&
          e.targetId === 'red-cap-1' &&
          e.tick === 0,
      ),
    ).toBe(true);

    // The staff read: radiating at people is a one-way broadcast.
    const nemesis = adaptNemesis(campaign.nemesis, m1);
    expect(nemesis.huntEmitters).toBe(true);
    expect(nemesis.notes.some((n) => n.includes('ELINT correlated a persistent airborne surveillance radar'))).toBe(true);
  });

  it('a passive-only mission does NOT arm the emitter hunt (IRST leaves no fingerprint)', () => {
    // The original escalation package has no airborne radar — its CAP track
    // is built passively. Same win, no ELINT evidence, no adaptation.
    const campaign = newCampaign(importRoster());
    const m1 = run(
      applyNemesisDoctrine(withBluePackage(buildEscalationScenario(), sensorWarPackage().filter((c) => c.id !== 'blue-awacs-1')), campaign.nemesis),
      sensorWarPlan(),
      SEED,
      1_400,
    );
    const nemesis = adaptNemesis(campaign.nemesis, m1);
    expect(nemesis.huntEmitters).toBe(false);
  });

  it('mission 2: a hunting CAP kills a forward orbit — and BLUE loses the air picture with it', () => {
    const nemesis = {
      cueMinAlt: 0,
      jamResistance: 0,
      shutdownDecay: 0.5,
      huntEmitters: true,
      gapFiller: false,
      pointDefenseAlert: false,
      decoyDiscrimination: false,
      notes: [],
    };
    const s0 = withBluePackage(buildEscalationScenario(), [
      ...sensorWarPackage().filter((c) => c.id !== 'blue-awacs-1'),
      watchtower({ x: -85_000, y: 0, alt: 9_500 }), // inside the extended hunt ring
    ]);
    const s = run(applyNemesisDoctrine(s0, nemesis), [], SEED, 900);

    const commit = s.events.find((e) => e.type === 'CAP_COMMIT');
    expect(commit).toBeDefined();
    expect(commit!.type === 'CAP_COMMIT' && commit!.targetId).toBe('blue-awacs-1');
    expect(s.units['blue-awacs-1']!.alive).toBe(false);
    // The picture died with the platform: no surviving track on the fighter.
    expect(s.contacts.BLUE['red-cap-1']).toBeUndefined();
  });

  it('the counter-counter: a standoff orbit survives the hunt and keeps the whole picture', () => {
    const nemesis = {
      cueMinAlt: 0,
      jamResistance: 0,
      shutdownDecay: 0.5,
      huntEmitters: true,
      gapFiller: false,
      pointDefenseAlert: false,
      decoyDiscrimination: false,
      notes: [],
    };
    const s0 = withBluePackage(buildEscalationScenario(), [
      ...sensorWarPackage().filter((c) => c.id !== 'blue-awacs-1'),
      watchtower({ x: -120_000, y: -14_000, alt: 9_500 }), // outside the extended ring
    ]);
    const s = run(applyNemesisDoctrine(s0, nemesis), [], SEED, 900);

    expect(s.events.some((e) => e.type === 'CAP_COMMIT' && e.targetId === 'blue-awacs-1')).toBe(false);
    expect(s.units['blue-awacs-1']!.alive).toBe(true);
    // Standoff costs nothing here — the apertures still cover the battlespace…
    expect(s.contacts.BLUE['red-cap-1']).toBeDefined(); // air picture (245 km)
    expect(s.contacts.BLUE['red-corvette-1']).toBeDefined(); // GMTI on a ship under way
  });
});
