import type { SimEvent, SimState } from '../core/types';

/**
 * Narrated after-action debrief (build order step 7's "cinematic debrief"
 * byproduct, in text form): the deterministic core hands us a complete
 * ordered event log for free, so the debrief is a pure render of it —
 * mission summary, a narrated timeline with generated RED-side intercept
 * chatter, engagement statistics, and the ground-op/roster report the
 * Breach Protocol campaign layer consumes.
 */

function clock(t: number): string {
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `T+${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const CHATTER: Partial<Record<SimEvent['type'], string>> = {
  EMITTER_SHUTDOWN: '«Seeker in the air — dark, dark, dark. Everybody down.»',
  EMITTER_BACK_UP: '«Re-radiating. Picture rebuilding.»',
  SAM_RELOCATING: '«Pack it up. New hide, now.»',
  SAM_EMCON: '«Track correlated. Light it.»',
};

function narrate(e: SimEvent, s: SimState): string | null {
  const name = (id: string) => s.units[id]?.name ?? id;
  switch (e.type) {
    case 'DETECTION':
      return `${name(e.sensorUnitId)} gained a track on ${name(e.targetId)}.`;
    case 'CONTACT_LOST':
      return `${e.side} lost its track on ${name(e.targetId)}.`;
    case 'LAUNCH':
      return `${name(e.shooterId)} fired ${e.weaponId} at ${name(e.targetId)}.`;
    case 'LAUNCH_DENIED':
      return `${name(e.shooterId)} requested a shot on ${name(e.targetId)} — denied (${e.reason}).`;
    case 'HIT':
      return `Impact on ${name(e.targetId)}.`;
    case 'MISS':
      return `Missile went stupid short of ${name(e.targetId)}.`;
    case 'UNIT_DESTROYED':
      return `${name(e.unitId)} destroyed.`;
    case 'EMITTER_SHUTDOWN':
      return `${name(e.unitId)} went dark under ARM pressure (until ${clock(e.untilTick)}). ${CHATTER.EMITTER_SHUTDOWN}`;
    case 'EMITTER_BACK_UP':
      return `${name(e.unitId)} back on air. ${CHATTER.EMITTER_BACK_UP}`;
    case 'SAM_EMCON':
      return e.emitting
        ? `${name(e.unitId)} lit its fire-control radar. ${CHATTER.SAM_EMCON}`
        : `${name(e.unitId)} ceased radiating.`;
    case 'SAM_RELOCATING':
      return `${name(e.unitId)} displaced from its firing position. ${CHATTER.SAM_RELOCATING}`;
    case 'SAM_DEPLOYED':
      return `${name(e.unitId)} redeployed at its fallback site.`;
    case 'CAP_COMMIT':
      return `${name(e.unitId)} committed on ${name(e.targetId)} — intercept inbound.`;
    case 'CAP_ON_STATION':
      return `${name(e.unitId)} back on CAP station.`;
    case 'BINGO_FUEL':
      return `${name(e.unitId)} hit bingo fuel and turned for home.`;
    case 'FUEL_EXHAUSTED':
      return `${name(e.unitId)} flamed out.`;
    case 'JAMMER_SET':
      return `${name(e.unitId)} ${e.active ? 'began' : 'ceased'} standoff jamming.`;
    case 'ROE_SET':
      return `${e.side} ROE set to ${e.level}.`;
    case 'GROUND_PHASE':
      return `Ground element: ${e.phase}.`;
    case 'GROUND_DENIED':
      return `Ground order ${e.order} refused (${e.reason}).`;
    case 'HOSTAGES_SECURED':
      return `Site secured — ${e.count} hostages in friendly hands.`;
    case 'HOSTAGE_CLOCK_EXPIRED':
      return `Hostage clock expired. Site compromised.`;
    case 'TEAM_ABOARD':
      return `Team aboard ${narrateName(s, e.heloId)}. Lifting.`;
    case 'TEAM_EXTRACTED':
      return `Extraction complete — team and ${e.count} hostages across the safe line.`;
  }
}

function narrateName(s: SimState, id: string): string {
  return s.units[id]?.name ?? id;
}

export function generateDebrief(final: SimState, missionName = 'Mission'): string {
  const lines: string[] = [];
  const units = Object.values(final.units);
  const blueLost = units.filter((u) => u.side === 'BLUE' && !u.alive);
  const redLost = units.filter((u) => u.side === 'RED' && !u.alive);
  const op = final.groundOp;

  lines.push(`# ${missionName} — After-Action Report`);
  lines.push('');
  lines.push(`Duration: ${clock(final.tick)}.`);

  // ---- Summary ----
  lines.push('');
  lines.push('## Summary');
  const objective = final.units['red-hq'];
  if (objective) {
    lines.push(`- Objective (${objective.name}): ${objective.alive ? 'INTACT' : 'DESTROYED'}`);
  }
  if (op) {
    lines.push(`- Ground op: ${op.phase}${op.phase === 'EXTRACTED' ? ` (${op.hostageCount} hostages recovered)` : ''}`);
  }
  lines.push(`- BLUE losses: ${blueLost.length ? blueLost.map((u) => u.name).join(', ') : 'none'}`);
  lines.push(`- RED losses: ${redLost.length ? redLost.map((u) => u.name).join(', ') : 'none'}`);

  // ---- Statistics ----
  const launches = final.events.filter((e) => e.type === 'LAUNCH');
  const byside = (side: 'BLUE' | 'RED') => launches.filter((e) => e.type === 'LAUNCH' && e.side === side).length;
  const hits = final.events.filter((e) => e.type === 'HIT').length;
  const misses = final.events.filter((e) => e.type === 'MISS').length;
  const suppression = final.events
    .filter((e) => e.type === 'EMITTER_SHUTDOWN')
    .reduce((acc, e) => acc + (e.type === 'EMITTER_SHUTDOWN' ? e.untilTick - e.tick : 0), 0);
  lines.push('');
  lines.push('## Statistics');
  lines.push(`- Weapons expended: BLUE ${byside('BLUE')}, RED ${byside('RED')}`);
  lines.push(`- Terminal results: ${hits} hits / ${misses} misses`);
  lines.push(`- Emitter suppression bought: ${suppression} s`);
  for (const u of units.filter((u) => u.side === 'BLUE' && u.alive && u.fuelKg !== undefined)) {
    lines.push(`- ${u.name}: ${Math.round(u.fuelKg!)} kg fuel remaining`);
  }

  // ---- Ground / roster ----
  if (op) {
    lines.push('');
    lines.push('## Ground element (roster returned to Breach Protocol)');
    for (const o of op.roster) {
      lines.push(`- ${o.name}: ${o.status}, ${o.missions} missions`);
    }
  }

  // ---- Narrated timeline ----
  lines.push('');
  lines.push('## Timeline');
  for (const e of final.events) {
    const text = narrate(e, final);
    if (text) lines.push(`- ${clock(e.tick)} — ${text}`);
  }

  return lines.join('\n');
}
