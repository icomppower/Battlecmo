import { describe, expect, it } from 'vitest';
import { run } from '../src/core/tick';
import { buildRescueScenario } from '../src/scenarios/rescue-op';
import { rescuePlan } from '../src/scenarios/plans';
import { importRoster } from '../src/scenarios/breach-roster';
import {
  applyNemesisDoctrine,
  debriefCampaign,
  newCampaign,
} from '../src/campaign/campaign';

const SEED = 42;

describe('nemesis IADS + persistent squadron (build order step 6)', () => {
  it('mission 1 win → legible adaptation → the same plan fails mission 2', () => {
    // ---- Mission 1: the rescue plan wins against the baseline nemesis. ----
    let campaign = newCampaign(importRoster());
    const m1 = run(
      applyNemesisDoctrine(buildRescueScenario(), campaign.nemesis),
      rescuePlan(),
      SEED,
      1_600,
    );
    expect(m1.groundOp!.phase).toBe('EXTRACTED');

    campaign = debriefCampaign(campaign, m1);

    // The staff read the log correctly: baited, jammed, and ARM-scared.
    expect(campaign.nemesis.cueMinAlt).toBe(120);
    expect(campaign.nemesis.jamResistance).toBeCloseTo(0.4);
    expect(campaign.nemesis.shutdownDecay).toBeCloseTo(0.35);
    expect(campaign.nemesis.notes.length).toBeGreaterThanOrEqual(3);

    // Squadron bookkeeping: everyone flew, everyone came home.
    expect(campaign.squadron.every((a) => a.status === 'READY' && a.missions === 1)).toBe(true);
    // Ground roster logged the sortie (KIA would be frozen).
    expect(campaign.roster.every((o) => o.missions >= 5)).toBe(true);

    // ---- Mission 2: same plan, adapted nemesis. ----
    const m2 = run(
      applyNemesisDoctrine(buildRescueScenario(), campaign.nemesis),
      rescuePlan(),
      SEED,
      1_600,
    );

    // The 60 m bait no longer draws a cue, so the reactive ARM finds a cold
    // radar (no suppression window at all)…
    expect(m2.events.some((e) => e.type === 'EMITTER_SHUTDOWN')).toBe(false);
    // …and the battery lights up on the real striker instead and kills it
    // before release.
    expect(m2.units['blue-striker-2']!.alive).toBe(false);
    expect(m2.units['red-hq']!.alive).toBe(true);
    expect(m2.groundOp!.phase).toBe('COMPROMISED');

    // Squadron pays the price this time.
    const after2 = debriefCampaign(campaign, m2);
    expect(after2.squadron.find((a) => a.unitId === 'blue-striker-2')!.status).toBe('LOST');
    expect(after2.missionNumber).toBe(3);
  });
});
