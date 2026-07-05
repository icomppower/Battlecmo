import { describe, expect, it } from 'vitest';
import { run } from '../src/core/tick';
import { buildRescueScenario } from '../src/scenarios/rescue-op';
import { rescuePlan } from '../src/scenarios/plans';
import { generateDebrief } from '../src/replay/debrief';

describe('narrated after-action debrief (build order step 7)', () => {
  it('renders the full mission as a readable INTSUM', () => {
    const final = run(buildRescueScenario(), rescuePlan(), 42, 1_600);
    const text = generateDebrief(final, 'OVERWATCH DIRECTIVE 01');

    // Summary reflects the actual outcome.
    expect(text).toContain('# OVERWATCH DIRECTIVE 01 — After-Action Report');
    expect(text).toContain('Objective (C2 node (objective)): DESTROYED');
    expect(text).toContain('Ground op: EXTRACTED (4 hostages recovered)');
    expect(text).toContain('BLUE losses: none');

    // Narrated timeline includes the doctrine beats and the intercept chatter.
    expect(text).toContain('went dark under ARM pressure');
    expect(text).toContain('«Seeker in the air — dark, dark, dark. Everybody down.»');
    expect(text).toContain('Site secured — 4 hostages in friendly hands.');
    expect(text).toContain('Extraction complete');

    // Roster report for the Breach Protocol handback.
    expect(text).toContain('## Ground element (roster returned to Breach Protocol)');
    expect(text).toContain('Reyes: OK');

    // Deterministic: same state ⇒ same debrief, byte for byte.
    expect(generateDebrief(final, 'OVERWATCH DIRECTIVE 01')).toBe(text);
  });
});
