import { describe, expect, it } from 'vitest';
import { run } from '../src/core/tick';
import type { Order } from '../src/core/types';
import { buildAdaptiveStrikeScenario } from '../src/scenarios/strike-adaptive';
import { miniState, plane, radarSite } from './helpers';
import { baitAndBlinkPlan, goodPlan } from './plans';

const SEED = 42;

describe('adaptive SAM doctrine (strike-adaptive)', () => {
  it('the plan that beat the static IADS gets slaughtered here', () => {
    const s = run(buildAdaptiveStrikeScenario(), goodPlan(), SEED, 800);

    // The pre-planned ARM found a cold radar: no scare, no suppression window.
    expect(s.events.some((e) => e.type === 'EMITTER_SHUTDOWN')).toBe(false);
    expect(s.events.some((e) => e.type === 'MISS' && e.targetId === 'red-sam-1')).toBe(true);

    // The battery lit up only once the strikers were inside the cue ring,
    // and killed them before release.
    const lightUp = s.events.find((e) => e.type === 'SAM_EMCON' && e.emitting);
    expect(lightUp).toBeDefined();
    expect(lightUp!.tick).toBeGreaterThan(400);
    expect(s.units['blue-striker-1']!.alive).toBe(false);
    expect(s.units['blue-striker-2']!.alive).toBe(false);
    expect(s.units['red-hq']!.alive).toBe(true);
  });

  it('shoot-and-scoot: after its salvo the battery goes cold, displaces, and redeploys', () => {
    const s = run(buildAdaptiveStrikeScenario(), goodPlan(), SEED, 1_500);

    const reloc = s.events.find((e) => e.type === 'SAM_RELOCATING');
    expect(reloc).toBeDefined();

    // No shots while on the march.
    const redLaunches = s.events.filter((e) => e.type === 'LAUNCH' && e.side === 'RED');
    expect(redLaunches.length).toBe(2); // the salvo that triggered the scoot
    expect(redLaunches.every((e) => e.tick <= reloc!.tick)).toBe(true);

    // It actually moved, arrived, and reset for the next fight.
    const sam = s.units['red-sam-1']!;
    expect(s.events.some((e) => e.type === 'SAM_DEPLOYED')).toBe(true);
    expect(sam.relocating).toBe(false);
    expect(sam.pos.x).toBeCloseTo(6_000);
    expect(sam.pos.y).toBeCloseTo(-5_000);
    expect(sam.shotsFired).toBe(0);
  });

  it('bait-and-blink: a low-altitude decoy run + reactive SEAD beats the adaptive IADS clean', () => {
    const s = run(buildAdaptiveStrikeScenario(), baitAndBlinkPlan(), SEED, 800);

    // The bait forced the radar up without ever being engageable (60 m is
    // below the SAM's 100 m floor): zero RED launches the entire mission.
    expect(s.events.filter((e) => e.type === 'LAUNCH' && e.side === 'RED')).toEqual([]);

    // The reactive ARM caught a radiating emitter and blinked it.
    const shutdown = s.events.find((e) => e.type === 'EMITTER_SHUTDOWN');
    expect(shutdown).toBeDefined();

    // Objective destroyed, everyone comes home.
    expect(s.units['red-hq']!.alive).toBe(false);
    for (const id of ['blue-striker-1', 'blue-striker-2', 'blue-sead-1', 'blue-ea-1']) {
      expect(s.units[id]!.alive, `${id} should survive`).toBe(true);
    }

    // EMCON cycles: up when cued, cold again after the bait egresses.
    const emcon = s.events.filter((e) => e.type === 'SAM_EMCON');
    expect(emcon.map((e) => e.type === 'SAM_EMCON' && e.emitting)).toEqual([true, false]);
  });
});

describe('ARM-scare crew adaptation', () => {
  it('each survived scare shortens the next shutdown window', () => {
    const emitter = radarSite('red-radar', 'RED', 0, 90_000, {
      emitterDoctrine: {
        armReactionRange: 15_000,
        shutdownTicks: 100,
        shutdownDecay: 0.5,
        minShutdownTicks: 20,
      },
    });
    const shooter = plane('blue-sead', 'BLUE', -50_000, 9_000, {
      weapons: [{ weaponId: 'arm-lance', count: 3 }],
    });
    const orders: Order[] = [
      { atTick: 0, type: 'ENGAGE', unitId: 'blue-sead', weaponId: 'arm-lance', targetId: 'red-radar' },
      { atTick: 170, type: 'ENGAGE', unitId: 'blue-sead', weaponId: 'arm-lance', targetId: 'red-radar' },
    ];
    const s = run(miniState([emitter, shooter]), orders, 3, 300);

    expect(s.units['red-radar']!.alive).toBe(true); // both ARMs went stupid vs a dark radar
    const windows = s.events
      .filter((e) => e.type === 'EMITTER_SHUTDOWN')
      .map((e) => (e.type === 'EMITTER_SHUTDOWN' ? e.untilTick - e.tick : 0));
    expect(windows).toEqual([100, 50]);
  });
});
