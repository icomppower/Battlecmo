import { describe, expect, it } from 'vitest';
import { run } from '../src/core/tick';
import { generateMission, nextCampaignMission } from '../src/campaign/generator';
import { adaptNemesis, applyNemesisDoctrine, debriefCampaign, newCampaign, type NemesisProfile } from '../src/campaign/campaign';
import { importRoster } from '../src/scenarios/breach-roster';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function baseline(): NemesisProfile {
  return newCampaign(importRoster()).nemesis;
}

/** A nemesis that has adapted on every axis it can. */
function hardened(): NemesisProfile {
  return {
    cueMinAlt: 120,
    jamResistance: 0.8,
    shutdownDecay: 0.35,
    huntEmitters: true,
    gapFiller: true, // inert on flat generated maps (no surveyed sites) — by design
    pointDefenseAlert: true,
    decoyDiscrimination: true,
    notes: [],
  };
}

/**
 * The campaign generator (triage item #4). Winnability is CONSTRUCTIVE —
 * every mission ships a staff solution timed from its own sampled geometry,
 * built only on deterministic windows (ARM scares, scoot marches) — and the
 * property tests below hold it to that across a seed sweep, against both
 * the baseline and a fully hardened nemesis. Tension is the naive plan
 * losing across the same sweep, and a deadline with one-replan slack.
 */

describe('generated missions are deterministic', () => {
  it('same inputs, byte-identical mission', () => {
    const a = generateMission(3, baseline(), 77);
    const b = generateMission(3, baseline(), 77);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('different seeds and mission numbers vary the problem', () => {
    const layouts = new Set(
      SEEDS.map((seed) => {
        const g = generateMission(1, baseline(), seed);
        const sam = g.state.units['red-sam-1']!;
        return `${sam.pos.x},${sam.pos.y},${sam.samDoctrine!.emcon},${g.objectiveIds.length}`;
      }),
    );
    expect(layouts.size).toBeGreaterThanOrEqual(8); // genuinely different problems
  });
});

describe('winnable but tense (the property, not the hope)', () => {
  it('the staff solution wins every seed against the baseline nemesis — inside the deadline, zero manned losses', () => {
    for (const seed of SEEDS) {
      const g = generateMission(1, baseline(), seed);
      const final = run(applyNemesisDoctrine(g.state, baseline()), g.staffPlan, seed, g.deadlineTick);

      for (const id of g.objectiveIds) {
        expect(final.units[id]!.alive, `objective ${id} survived seed ${seed}`).toBe(false);
      }
      const mannedLost = Object.values(final.units).filter((u) => u.side === 'BLUE' && !u.decoy && !u.alive);
      expect(mannedLost, `losses on seed ${seed}: ${mannedLost.map((u) => u.id).join(',')}`).toEqual([]);
    }
  });

  it('the staff solution ALSO wins every seed against a fully hardened nemesis', () => {
    for (const seed of SEEDS) {
      const g = generateMission(2, hardened(), seed);
      const final = run(applyNemesisDoctrine(g.state, hardened()), g.staffPlan, seed, g.deadlineTick);

      for (const id of g.objectiveIds) {
        expect(final.units[id]!.alive, `objective ${id} survived seed ${seed}`).toBe(false);
      }
      const mannedLost = Object.values(final.units).filter((u) => u.side === 'BLUE' && !u.decoy && !u.alive);
      expect(mannedLost, `losses on seed ${seed}: ${mannedLost.map((u) => u.id).join(',')}`).toEqual([]);
    }
  });

  it('the straight-in plan draws fire on every seed and pays in aircraft on most — the threat is real', () => {
    // A shoot-and-scoot battery only fires twice before displacing, so a
    // naive package occasionally walks through both misses. That is the
    // sim being honest, not the generator being soft: every seed gets
    // engaged, and most seeds bury someone.
    let punished = 0;
    for (const seed of SEEDS) {
      const g = generateMission(1, baseline(), seed);
      const final = run(applyNemesisDoctrine(g.state, baseline()), g.naivePlan, seed, g.deadlineTick);
      expect(
        final.events.some((e) => e.type === 'LAUNCH' && e.side === 'RED'),
        `no shot fired at the naive plan on seed ${seed}`,
      ).toBe(true);
      if (['blue-striker-1', 'blue-striker-2'].some((id) => !final.units[id]!.alive)) punished++;
    }
    expect(punished).toBeGreaterThanOrEqual(Math.ceil(SEEDS.length * (2 / 3)));
  });

  it('the deadline is tense: slack for one replan, not a second sortie', () => {
    for (const seed of SEEDS) {
      const g = generateMission(1, baseline(), seed);
      const final = run(applyNemesisDoctrine(g.state, baseline()), g.staffPlan, seed, g.deadlineTick);
      const lastHit = final.events.filter((e) => e.type === 'HIT').map((e) => e.tick);
      const done = Math.max(...lastHit);
      expect(done).toBeLessThanOrEqual(g.deadlineTick);
      expect(g.deadlineTick).toBeLessThanOrEqual(Math.ceil(done * 1.6));
    }
  });
});

describe('campaign rotation', () => {
  it('fly a generated mission, debrief, and the next one is a different problem against the adapted staff', () => {
    let campaign = newCampaign(importRoster());
    const m1 = nextCampaignMission(campaign, 5);
    const final1 = run(m1.state, m1.staffPlan, 5, m1.deadlineTick);
    for (const id of m1.objectiveIds) expect(final1.units[id]!.alive).toBe(false);

    campaign = debriefCampaign(campaign, final1);
    expect(campaign.missionNumber).toBe(2);
    // Squadron flew and logged it (decoys are stores, not airframes).
    expect(campaign.squadron.find((a) => a.unitId === 'blue-striker-1')!.missions).toBe(1);

    const m2 = nextCampaignMission(campaign, 5);
    // Same seed, different mission number — a different problem…
    expect(JSON.stringify(m2.state.units['red-sam-1']!.pos)).not.toBe(
      JSON.stringify(m1.state.units['red-sam-1']!.pos),
    );
    // …and still winnable against whatever the staff learned from mission 1.
    const final2 = run(m2.state, m2.staffPlan, 5, m2.deadlineTick);
    for (const id of m2.objectiveIds) expect(final2.units[id]!.alive).toBe(false);
  });

  it('what the staff learns from a generated mission is the decoy lesson (when the ghosts flew and got shot)', () => {
    // Find a CUED seed where the un-adapted battery expends rounds on drones.
    const g = generateMission(1, baseline(), 2);
    const final = run(applyNemesisDoctrine(g.state, baseline()), g.staffPlan, 2, g.deadlineTick);
    const shotAtDecoy = final.events.some(
      (e) => e.type === 'LAUNCH' && e.side === 'RED' && final.units[e.targetId]?.decoy,
    );
    const nemesis = adaptNemesis(baseline(), final);
    expect(nemesis.decoyDiscrimination).toBe(shotAtDecoy);
  });
});
