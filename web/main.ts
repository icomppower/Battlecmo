import { tick } from '../src/core/tick';
import { validateLaunch } from '../src/core/weapons';
import { buildStrikeScenario } from '../src/scenarios/strike-basic';
import { buildAdaptiveStrikeScenario } from '../src/scenarios/strike-adaptive';
import { buildRescueScenario } from '../src/scenarios/rescue-op';
import { buildEscalationScenario } from '../src/scenarios/strike-escalation';
import { buildFjordScenario } from '../src/scenarios/strike-fjord';
import { buildConvoyScenario } from '../src/scenarios/strike-convoy';
import { buildPicketScenario } from '../src/scenarios/strike-picket';
import { buildTaiwanStrikeScenario } from '../src/scenarios/strike-taiwan';
import {
  baitAndBlinkPlan,
  convoyPlan,
  decoyPackage,
  decoySweepPlan,
  escalationPackage,
  escalationPlan,
  naiveConvoyPlan,
  picketHazardPlan,
  picketSafePlan,
  sensorWarPackage,
  sensorWarPlan,
  fjordPlan,
  goodPlan,
  jamOnlyPlan,
  naivePlan,
  rescuePlan,
  taiwanStrikePlanA,
  taiwanStrikePlanB,
  taiwanStrikePlanC,
} from '../src/scenarios/plans';
import { generateDebrief } from '../src/replay/debrief';
import { withBluePackage, type AircraftConfig } from '../src/oob/assembly';
import {
  applyNemesisDoctrine,
  applySquadronState,
  debriefCampaign,
  newCampaign,
  restSquadron,
  STARTING_STOCK,
  type CampaignState,
} from '../src/campaign/campaign';
import { importRoster } from '../src/scenarios/breach-roster';
import { generateMission } from '../src/campaign/generator';
import { deserializeMission, serializeMission, type Mission } from '../src/replay/mission-io';
import type { Order, RoeLevel, SimEvent, SimState, Vec3 } from '../src/core/types';
import { Renderer, type View } from './render';
import { initBuilder } from './builder';

/**
 * The tick seed for the mission currently on the timeline. 42 is the default
 * every preset and scenario switch uses; IMPORT is the only thing that ever
 * sets it to something else (a mission file carries its own seed), and every
 * other reset path restores the default so an imported seed never leaks into
 * an unrelated mission.
 */
let SEED = 42;
const MAX_RUN_TICKS = 1_800;

const SCENARIOS: Record<string, () => SimState> = {
  'strike-basic': buildStrikeScenario,
  'strike-adaptive': buildAdaptiveStrikeScenario,
  'rescue-op': buildRescueScenario,
  'strike-escalation': buildEscalationScenario,
  'strike-fjord': buildFjordScenario,
  'strike-convoy': buildConvoyScenario,
  'strike-picket': buildPicketScenario,
  'strike-taiwan': buildTaiwanStrikeScenario,
};

const PRESETS: Record<string, { plan: () => Order[]; scenario: string; pkg?: () => AircraftConfig[] }> = {
  good: { plan: goodPlan, scenario: 'strike-basic' },
  naive: { plan: naivePlan, scenario: 'strike-basic' },
  jamonly: { plan: jamOnlyPlan, scenario: 'strike-basic' },
  baitblink: { plan: baitAndBlinkPlan, scenario: 'strike-adaptive' },
  decoysweep: { plan: decoySweepPlan, scenario: 'strike-adaptive', pkg: decoyPackage },
  rescue: { plan: rescuePlan, scenario: 'rescue-op' },
  escalation: { plan: escalationPlan, scenario: 'strike-escalation', pkg: escalationPackage },
  sensorwar: { plan: sensorWarPlan, scenario: 'strike-escalation', pkg: sensorWarPackage },
  fjord: { plan: fjordPlan, scenario: 'strike-fjord' },
  naiveconvoy: { plan: naiveConvoyPlan, scenario: 'strike-convoy' },
  convoy: { plan: convoyPlan, scenario: 'strike-convoy' },
  pickethazard: { plan: picketHazardPlan, scenario: 'strike-picket' },
  picketsafe: { plan: picketSafePlan, scenario: 'strike-picket' },
  // Taiwan Strait — fictional/hypothetical demo scenario (see strike-taiwan.ts
  // module doc). No losing plan: all three pre-built plans fully clear the
  // target set, by design (demo/showcase, not an adversarial proof).
  taiwanplana: { plan: taiwanStrikePlanA, scenario: 'strike-taiwan' },
  taiwanplanb: { plan: taiwanStrikePlanB, scenario: 'strike-taiwan' },
  taiwanplanc: { plan: taiwanStrikePlanC, scenario: 'strike-taiwan' },
  // The brief says a staff solution is on file — this loads it. It is the
  // generator's own constructive winnability proof, timed to this mission's
  // sampled geometry and the nemesis's current doctrine.
  genstaff: { plan: () => currentTasking().staffPlan, scenario: 'generated' },
};

/** Deterministic per-campaign-mission tasking seed. */
const GENERATOR_SEED = 1_789;

/** The current generated tasking — a pure function of the campaign state. */
function currentTasking() {
  return generateMission(campaign.missionNumber, campaign.nemesis, GENERATOR_SEED);
}

/**
 * WEGO timeline over the pure tick core.
 *
 * Every computed state is kept, so the scrubber can jump anywhere instantly.
 * Issuing an order while scrubbed back *rewrites the future*: cached states
 * past the cursor are dropped and the sim recomputes forward from that point
 * with the amended orders log. Determinism makes this exact — replaying the
 * untouched prefix yields byte-identical states, so only the future changes.
 */
class Timeline {
  states: SimState[];
  orders: Order[] = [];
  cursor = 0;

  constructor(private build: () => SimState) {
    this.states = [build()];
  }

  get current(): SimState {
    return this.states[this.cursor]!;
  }

  get prev(): SimState | null {
    return this.cursor > 0 ? this.states[this.cursor - 1]! : null;
  }

  /** Advance one tick — replay cache if we're behind, compute if at the head. */
  advance(): void {
    if (this.cursor < this.states.length - 1) {
      this.cursor++;
      return;
    }
    this.states.push(tick(this.states[this.states.length - 1]!, this.orders, SEED));
    this.cursor = this.states.length - 1;
  }

  issue(order: Order): void {
    this.invalidateFrom(order.atTick);
    this.orders.push(order);
  }

  removeOrder(index: number): void {
    const [removed] = this.orders.splice(index, 1);
    if (removed) this.invalidateFrom(removed.atTick);
  }

  /** Drop every cached state that could have seen tick `t`'s orders. */
  invalidateFrom(t: number): void {
    const keep = Math.min(this.states.length, Math.max(1, t + 1));
    this.states.length = keep;
    this.cursor = Math.min(this.cursor, keep - 1);
  }

  scrub(to: number): void {
    this.cursor = Math.max(0, Math.min(to, this.states.length - 1));
  }

  reset(build?: () => SimState): void {
    if (build) this.build = build;
    this.states = [this.build()];
    this.orders = [];
    this.cursor = 0;
  }

  /**
   * Dossier positions for RED sites. With a confidence-graded dossier the
   * briefed fixes come from it verbatim (including the wrong ones); the
   * pre-dossier fallback is mission-start truth for ground sites.
   */
  briefedPositions(): Record<string, Vec3> {
    const s0 = this.states[0]!;
    const out: Record<string, Vec3> = {};
    if (s0.intel) {
      for (const entry of Object.values(s0.intel)) out[entry.unitId] = entry.briefedPos;
      return out;
    }
    for (const u of Object.values(s0.units)) {
      if (u.side === 'RED' && u.domain !== 'AIR') out[u.id] = u.pos;
    }
    return out;
  }
}

// ---------------------------------------------------------------------------

/** Committed Mission Builder package; null flies the scenario's stock OOB. */
let packageConfigs: AircraftConfig[] | null = null;

/**
 * Campaign state: the nemesis IADS commander and the persistent squadron.
 * Effects apply to scenario builds once the first mission has been debriefed
 * — mission 1 is always flown against doctrine as briefed.
 */
let campaign: CampaignState = newCampaign(importRoster());
let campaignApplied = false;

// Campaign survives page reloads — the deployed game keeps your war going.
const CAMPAIGN_KEY = 'battlecmo-campaign-v1';
function saveCampaign(): void {
  try {
    localStorage.setItem(CAMPAIGN_KEY, JSON.stringify({ campaign, campaignApplied }));
  } catch {
    /* storage unavailable (private mode etc.) — campaign is session-only */
  }
}
try {
  const raw = localStorage.getItem(CAMPAIGN_KEY);
  if (raw) {
    const saved = JSON.parse(raw) as { campaign?: CampaignState; campaignApplied?: boolean };
    if (saved?.campaign?.squadron && saved.campaign.nemesis) {
      campaign = saved.campaign;
      campaign.nemesis.huntEmitters ??= false; // migrate pre-ISR saves
      campaign.nemesis.gapFiller ??= false; // migrate pre-axes saves
      campaign.nemesis.pointDefenseAlert ??= false;
      campaign.nemesis.decoyDiscrimination ??= false;
      campaign.stores ??= { ...STARTING_STOCK }; // migrate pre-stores saves
      campaignApplied = !!saved.campaignApplied;
    }
  }
} catch {
  /* corrupt save — start fresh */
}

/**
 * Scenario builder with the committed package (if any) swapped in and, once
 * a campaign debrief has run, the nemesis doctrine + squadron wear applied.
 */
function scenarioBuild(name: string): () => SimState {
  const configs = packageConfigs;
  const applyCampaign = campaignApplied;
  const nemesis = campaign.nemesis;
  const squadron = campaign.squadron;
  const roster = campaign.roster;
  if (name === 'generated') {
    // Generated tasking brings its own package (the generator's problem is
    // authored against it); campaign doctrine and squadron wear always
    // apply — this scenario IS the campaign's long game.
    const missionNumber = campaign.missionNumber;
    return () => {
      const g = generateMission(missionNumber, nemesis, GENERATOR_SEED);
      applyNemesisDoctrine(g.state, nemesis);
      applySquadronState(g.state, squadron);
      return g.state;
    };
  }
  const base = SCENARIOS[name]!;
  return () => {
    let s = name === 'rescue-op' && applyCampaign ? buildRescueScenario(roster) : base();
    if (configs) s = withBluePackage(s, configs);
    if (applyCampaign) {
      s = applyNemesisDoctrine(s, nemesis);
      s = applySquadronState(s, squadron);
    }
    return s;
  };
}

const timeline = new Timeline(SCENARIOS['strike-basic']!);
const canvas = document.getElementById('map') as HTMLCanvasElement;
const renderer = new Renderer(canvas);

const view: View = { cx: -60_000, cy: 0, scale: 0.006 };
let speed = 0; // ticks per real second (0 = paused)
let godView = false;
let selectedId: string | null = null;
/** Cinematic replay: auto-camera + captions; any manual input cancels it. */
let cinematic = false;

// ---- canvas sizing ----------------------------------------------------------

function resizeCanvas(): void {
  const rect = canvas.parentElement!.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
}
new ResizeObserver(resizeCanvas).observe(canvas.parentElement!);
resizeCanvas();

// ---- map interaction ----------------------------------------------------------

let dragging = false;
let dragMoved = false;
let lastMouse: [number, number] = [0, 0];

canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  cinematic = false;
  dragging = true;
  dragMoved = false;
  lastMouse = [e.offsetX, e.offsetY];
});

canvas.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const dx = e.offsetX - lastMouse[0];
  const dy = e.offsetY - lastMouse[1];
  if (Math.abs(dx) + Math.abs(dy) > 2) dragMoved = true;
  view.cx -= dx / view.scale;
  view.cy += dy / view.scale;
  lastMouse = [e.offsetX, e.offsetY];
});

window.addEventListener('mouseup', (e) => {
  if (!dragging) return;
  dragging = false;
  if (dragMoved || e.button !== 0) return;
  // Plain click: select the nearest unit (BLUE always; RED only in truth view).
  const state = timeline.current;
  let best: string | null = null;
  let bestDist = 16; // px
  for (const u of Object.values(state.units)) {
    if (!u.alive) continue;
    if (u.side === 'RED' && !godView) continue;
    const [sx, sy] = renderer.toScreen(view, u.pos);
    const d = Math.hypot(sx - lastMouse[0], sy - lastMouse[1]);
    if (d < bestDist) {
      bestDist = d;
      best = u.id;
    }
  }
  selectedId = best;
});

/** Planner offset: orders authored now can be scheduled for later. */
function orderDelay(): number {
  const el = document.getElementById('orderdelay') as HTMLInputElement;
  return Math.max(0, Math.floor(Number(el.value) || 0));
}

type OrderDraft = Order extends infer O ? (O extends Order ? Omit<O, 'atTick'> : never) : never;

function issueAt(order: OrderDraft): void {
  const atTick = timeline.current.tick + orderDelay();
  timeline.issue({ ...order, atTick } as Order);
  if (orderDelay() === 0) timeline.advance(); // instant orders show immediately
}

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  cinematic = false;
  const state = timeline.current;
  const unit = selectedId ? state.units[selectedId] : null;
  if (!unit || !unit.alive || unit.side !== 'BLUE' || unit.maxSpeed <= 0) return;
  const w = renderer.toWorld(view, e.offsetX, e.offsetY);
  const wp = { x: w.x, y: w.y, alt: unit.pos.alt };
  const waypoints = e.shiftKey ? [...unit.waypoints, wp] : [wp];
  timeline.issue({
    atTick: state.tick + orderDelay(),
    type: 'SET_WAYPOINTS',
    unitId: unit.id,
    waypoints,
  });
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  cinematic = false;
  const before = renderer.toWorld(view, e.offsetX, e.offsetY);
  const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
  view.scale = Math.min(0.25, Math.max(0.0008, view.scale * factor));
  const after = renderer.toWorld(view, e.offsetX, e.offsetY);
  view.cx += before.x - after.x;
  view.cy += before.y - after.y;
}, { passive: false });

// ---- header controls ----------------------------------------------------------

const speedButtons = [...document.querySelectorAll<HTMLButtonElement>('#speeds [data-speed]')];
for (const btn of speedButtons) {
  btn.addEventListener('click', () => {
    speed = Number(btn.dataset.speed);
  });
}
document.getElementById('step')!.addEventListener('click', () => {
  speed = 0;
  timeline.advance();
});

const roeButtons = [...document.querySelectorAll<HTMLButtonElement>('#roe [data-roe]')];
for (const btn of roeButtons) {
  btn.addEventListener('click', () => {
    issueAt({ type: 'SET_ROE', side: 'BLUE', level: btn.dataset.roe as RoeLevel });
  });
}

document.getElementById('godview')!.addEventListener('click', () => {
  godView = !godView;
});

document.getElementById('reset')!.addEventListener('click', () => {
  SEED = 42; // RESET MISSION always returns to the default seed.
  timeline.reset();
  selectedId = null;
  speed = 0;
  onMissionReset();
});

const scenarioSelect = document.getElementById('scenario') as HTMLSelectElement;
scenarioSelect.addEventListener('change', () => {
  SEED = 42; // switching scenarios leaves any imported seed behind.
  timeline.reset(scenarioBuild(scenarioSelect.value));
  selectedId = null;
  speed = 0;
  onMissionReset();
});

initBuilder(
  (configs) => {
    packageConfigs = configs;
    timeline.reset(scenarioBuild(scenarioSelect.value));
    selectedId = null;
    speed = 0;
    onMissionReset();
  },
  (unitId) => {
    const rec = campaign.squadron.find((r) => r.unitId === unitId);
    return rec ? { pilot: rec.pilot, lost: rec.status === 'LOST' } : undefined;
  },
  () => campaign.stores,
);

document.getElementById('replay')!.addEventListener('click', () => {
  timeline.scrub(0);
  cinematic = true;
  speed = 4;
});

// ---- 3D replay view (phase 1: read-only) ----------------------------------

type Replay3DModule = typeof import('./replay3d');
let replay3d: import('./replay3d').Replay3D | null = null;
let mode3d = false;
let camMode: import('./replay3d').CameraMode = 'overview';
const map3dEl = document.getElementById('map3d') as HTMLElement;
const camSel = document.getElementById('camsel') as HTMLSelectElement;
const view3dBtn = document.getElementById('view3d')!;

function populateCameraOptions(state: SimState): void {
  const options = ['<option value="overview">cam: overview</option>'];
  for (const u of Object.values(state.units)) {
    if (u.side === 'BLUE' && u.domain === 'AIR') {
      options.push(`<option value="chase:${u.id}">cam: chase ${esc(u.name)}</option>`);
    }
  }
  const prior = camSel.value;
  camSel.innerHTML = options.join('');
  camSel.value = [...camSel.options].some((o) => o.value === prior) ? prior : 'overview';
  camMode = camSel.value as import('./replay3d').CameraMode;
}

view3dBtn.addEventListener('click', () => {
  mode3d = !mode3d;
  map3dEl.style.display = mode3d ? 'block' : 'none';
  camSel.style.display = mode3d ? '' : 'none';
  if (mode3d) {
    populateCameraOptions(timeline.states[0]!);
    if (!replay3d) {
      import('./replay3d').then((mod: Replay3DModule) => {
        replay3d = new mod.Replay3D(map3dEl);
      });
    }
  }
});

camSel.addEventListener('change', () => {
  camMode = camSel.value as import('./replay3d').CameraMode;
});

/** Anything that swaps the mission must also rebuild the 3D scene. */
function onMissionReset(): void {
  replay3d?.resetScene();
  if (mode3d) populateCameraOptions(timeline.states[0]!);
}

document.getElementById('debrief')!.addEventListener('click', () => {
  const text = generateDebrief(
    timeline.states[timeline.states.length - 1]!,
    `OVERWATCH DIRECTIVE — ${scenarioSelect.value}`,
  );
  document.getElementById('debrieftext')!.textContent = text;
  document.getElementById('debriefoverlay')!.classList.add('open');
});
document.getElementById('debriefclose')!.addEventListener('click', () => {
  document.getElementById('debriefoverlay')!.classList.remove('open');
});

// ---- planner ----------------------------------------------------------

const presetSelect = document.getElementById('preset') as HTMLSelectElement;
presetSelect.addEventListener('change', () => {
  const preset = PRESETS[presetSelect.value];
  if (!preset) return;
  SEED = 42; // presets are always authored against the default seed.
  scenarioSelect.value = preset.scenario;
  // Presets that need a specific force composition bring their package.
  if (preset.pkg) packageConfigs = preset.pkg();
  timeline.reset(scenarioBuild(preset.scenario));
  timeline.orders = preset.plan();
  selectedId = null;
  speed = 0;
  onMissionReset();
});

// ---- plan export / import (triage item C) ----------------------------------

document.getElementById('planexport')!.addEventListener('click', () => {
  if (scenarioSelect.value === 'generated') {
    alert('Generated tasking is campaign-specific (it depends on mission number and nemesis doctrine) and cannot be exported as a portable mission file.');
    return;
  }
  const mission: Mission = {
    scenario: scenarioSelect.value,
    packageConfigs,
    orders: timeline.orders,
    seed: SEED,
  };
  const blob = new Blob([serializeMission(mission)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `overwatch-mission-${mission.scenario}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

const importInput = document.getElementById('planimportfile') as HTMLInputElement;
document.getElementById('planimport')!.addEventListener('click', () => importInput.click());
importInput.addEventListener('change', () => {
  const file = importInput.files?.[0];
  importInput.value = ''; // allow re-importing the same filename later
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const mission = deserializeMission(String(reader.result));
      packageConfigs = mission.packageConfigs;
      SEED = mission.seed;
      scenarioSelect.value = mission.scenario;
      timeline.reset(scenarioBuild(mission.scenario));
      timeline.orders = mission.orders;
      selectedId = null;
      speed = 0;
      onMissionReset();
    } catch (err) {
      alert(`Import failed: ${(err as Error).message}`);
    }
  };
  reader.readAsText(file);
});

document.getElementById('runend')!.addEventListener('click', () => {
  // Scrub the plan: compute to the end instantly, then review on the timeline.
  const start = timeline.states.length;
  for (let i = start; i <= MAX_RUN_TICKS; i++) timeline.advance();
  speed = 0;
});

const orderList = document.getElementById('orderlist')!;
orderList.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-del]');
  if (!btn) return;
  timeline.removeOrder(Number(btn.dataset.del));
});

function describeOrder(o: Order): string {
  switch (o.type) {
    case 'SET_WAYPOINTS':
      return `${o.unitId} → ${o.waypoints.map((w) => `(${Math.round(w.x / 1000)},${Math.round(w.y / 1000)})`).join(' ')}`;
    case 'SET_ROE':
      return `ROE ${o.side} ${o.level}`;
    case 'SET_JAMMER':
      return `${o.unitId} jammer ${o.active ? 'ON' : 'OFF'}`;
    case 'SET_IFF':
      return `${o.unitId} IFF ${o.on ? 'SQUAWK' : 'SILENT'}`;
    case 'ENGAGE':
      return `${o.unitId} ${o.weaponId} → ${o.targetId}`;
    case 'RTB':
      return `${o.unitId} RTB`;
    case 'GROUND_INFIL':
      return 'ground: INFIL';
    case 'GROUND_BREACH':
      return 'ground: BREACH';
    case 'GROUND_EXFIL':
      return 'ground: EXFIL';
  }
}

function renderOrderList(): string {
  const indexed = timeline.orders.map((o, i) => ({ o, i }));
  indexed.sort((a, b) => a.o.atTick - b.o.atTick || a.i - b.i);
  if (indexed.length === 0) return '<div style="color:var(--dim)">no orders scheduled</div>';
  return indexed
    .map(
      ({ o, i }) =>
        `<div class="ord"><span class="t">${fmtClock(o.atTick)}</span>` +
        `<span class="desc">${esc(describeOrder(o))}</span>` +
        `<button data-del="${i}">✕</button></div>`,
    )
    .join('');
}

// ---- ground op panel ----------------------------------------------------------

const groundPanel = document.getElementById('groundpanel')!;
groundPanel.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-ground]');
  if (!btn) return;
  issueAt({ type: btn.dataset.ground as 'GROUND_INFIL' | 'GROUND_BREACH' | 'GROUND_EXFIL' });
});

function renderGroundPanel(state: SimState): string {
  const op = state.groundOp;
  if (!op) return '';
  const remaining = op.hostageDeadlineTick - state.tick;
  const clockText =
    op.phase === 'SECURED' || op.phase === 'EXFIL' || op.phase === 'EXTRACTED'
      ? 'secured'
      : remaining > 0
        ? `${fmtClock(remaining)} remaining`
        : 'EXPIRED';
  const rows = [
    `<h3>Ground op — ${op.phase}</h3>`,
    `<div class="row"><span class="k">hostage clock</span><span>${clockText}</span></div>`,
    `<div class="row"><span class="k">team</span><span>${op.roster.filter((o) => o.status !== 'KIA').length}/${op.roster.length} up</span></div>`,
    `<div class="actions">` +
      `<button data-ground="GROUND_INFIL" ${op.phase !== 'STAGED' ? 'disabled' : ''}>INFIL</button>` +
      `<button data-ground="GROUND_BREACH" ${op.phase !== 'AT_TARGET' ? 'disabled' : ''}>BREACH</button>` +
      `<button data-ground="GROUND_EXFIL" ${op.phase !== 'SECURED' ? 'disabled' : ''}>EXFIL</button>` +
      `</div>`,
  ];
  return rows.join('');
}

// ---- intel dossier panel ----------------------------------------------------------

function renderDossier(state: SimState): string {
  const intel = timeline.states[0]!.intel;
  if (!intel) return '';
  const chip = (c: string) =>
    `<span class="conf ${c.toLowerCase()}">${c}</span>`;
  const rows = Object.values(intel).map((e) => {
    const unit = state.units[e.unitId];
    const dead = unit && !unit.alive;
    const tracked = !!state.contacts.BLUE[e.unitId];
    const status = dead ? ' <span style="color:var(--dim)">✝ destroyed</span>' : tracked ? ' <span style="color:var(--blue)">tracking</span>' : '';
    return (
      `<div class="intel${dead ? ' dead' : ''}">` +
      `<div>${chip(e.confidence)} <b>${esc(unit?.name ?? e.unitId)}</b>${status}</div>` +
      (e.note ? `<div class="note">${esc(e.note)}</div>` : '') +
      `</div>`
    );
  });
  return `<h3>Intel dossier</h3>${rows.join('')}`;
}

// ---- campaign panel ----------------------------------------------------------

const campaignOverlay = document.getElementById('campaignoverlay')!;
document.getElementById('campaignopen')!.addEventListener('click', () => {
  renderCampaign();
  campaignOverlay.classList.add('open');
});
document.getElementById('campaignclose')!.addEventListener('click', () => {
  campaignOverlay.classList.remove('open');
});

document.getElementById('campaignadvance')!.addEventListener('click', () => {
  // Debrief the mission as flown to the end of the recorded timeline: the
  // nemesis reads the log, the squadron logs sorties/losses, the roster
  // carries forward. The next reset flies against the adapted world.
  const final = timeline.states[timeline.states.length - 1]!;
  campaign = debriefCampaign(campaign, final);
  campaignApplied = true;
  saveCampaign();
  timeline.reset(scenarioBuild(scenarioSelect.value));
  selectedId = null;
  speed = 0;
  renderCampaign();
  document.getElementById('campaignopen')!.classList.add('on');
});

document.getElementById('campaignrest')!.addEventListener('click', () => {
  // REST is deliberately simpler than DEBRIEF & ADVANCE: it stands the
  // squadron down for one cycle so pilots recover fatigue, and nothing
  // else. It does NOT advance missionNumber and does NOT call
  // adaptNemesis — no mission was flown, so there is no event log for the
  // enemy staff to read, and the generated tasking (keyed on missionNumber)
  // stays exactly what it was. Stores are untouched too: resting pilots
  // doesn't resupply munitions, only a flown/skipped mission's bookkeeping
  // does that.
  campaign = { ...campaign, squadron: restSquadron(campaign.squadron, 1) };
  saveCampaign();
  renderCampaign();
});

document.getElementById('campaignreset')!.addEventListener('click', () => {
  campaign = newCampaign(importRoster());
  campaignApplied = false;
  saveCampaign();
  timeline.reset(scenarioBuild(scenarioSelect.value));
  selectedId = null;
  speed = 0;
  renderCampaign();
  document.getElementById('campaignopen')!.classList.remove('on');
});
if (campaignApplied) document.getElementById('campaignopen')!.classList.add('on');

function renderCampaign(): void {
  const notes = campaign.nemesis.notes.length
    ? campaign.nemesis.notes.map((n) => `<div class="note">▸ ${esc(n)}</div>`).join('')
    : '<div class="note" style="color:var(--dim)">No adaptations yet — the enemy fights as briefed.</div>';
  const sq = campaign.squadron
    .map(
      (r) =>
        `<div class="row"><span class="k">${esc(r.pilot)} <span style="color:var(--dim)">(${r.unitId})</span></span>` +
        `<span>${r.status === 'LOST' ? '<span style="color:var(--red)">LOST</span>' : `${r.missions} sorties · fatigue ${r.fatigue}`}</span></div>`,
    )
    .join('');
  const roster = campaign.roster
    .map(
      (o) =>
        `<div class="row"><span class="k">${esc(o.name)}</span>` +
        `<span>${o.status === 'KIA' ? '<span style="color:var(--red)">KIA</span>' : `${o.status} · ${o.missions} msn`}</span></div>`,
    )
    .join('');
  const tasking = currentTasking()
    .brief.map((line) => `<div class="note">▸ ${esc(line)}</div>`)
    .join('');
  const stores = Object.keys(campaign.stores)
    .sort()
    .map((weaponId) => `<div class="row"><span class="k">${esc(weaponId)}</span><span>${campaign.stores[weaponId]}</span></div>`)
    .join('');
  document.getElementById('campaignbody')!.innerHTML =
    `<div class="row"><span class="k">mission</span><span>#${campaign.missionNumber}</span></div>` +
    `<div class="row"><span class="k">campaign effects</span><span>${campaignApplied ? 'APPLIED (doctrine adapted, wear carried)' : 'not yet — mission 1 as briefed'}</span></div>` +
    `<h3 style="margin-top:12px;">Enemy staff notes (INTSUM)</h3>${notes}` +
    `<h3 style="margin-top:12px;">Generated tasking (scenario: generated strike)</h3>${tasking}` +
    `<h3 style="margin-top:12px;">Squadron</h3>${sq}` +
    `<h3 style="margin-top:12px;">Stores (rounds remaining)</h3>${stores}` +
    `<h3 style="margin-top:12px;">Ground roster</h3>${roster}`;
}

// ---- scrubber ----------------------------------------------------------

const scrubber = document.getElementById('scrubber') as HTMLInputElement;
scrubber.addEventListener('input', () => {
  speed = 0;
  timeline.scrub(Number(scrubber.value));
});

// ---- side panel ----------------------------------------------------------

const unitPanel = document.getElementById('unitpanel')!;
unitPanel.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!btn) return;
  switch (btn.dataset.action) {
    case 'engage':
      issueAt({
        type: 'ENGAGE',
        unitId: btn.dataset.unit!,
        weaponId: btn.dataset.weapon!,
        targetId: btn.dataset.target!,
      });
      break;
    case 'jammer':
      issueAt({
        type: 'SET_JAMMER',
        unitId: btn.dataset.unit!,
        active: btn.dataset.active === 'true',
      });
      break;
    case 'iff':
      issueAt({ type: 'SET_IFF', unitId: btn.dataset.unit!, on: btn.dataset.on === 'true' });
      break;
    case 'rtb':
      issueAt({ type: 'RTB', unitId: btn.dataset.unit! });
      break;
  }
});

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function renderUnitPanel(state: SimState): string {
  const u = selectedId ? state.units[selectedId] : null;
  if (!u) return '<h3>No unit selected</h3><div style="color:var(--dim)">Click a friendly unit on the map.</div>';

  const rows: string[] = [`<h3>${esc(u.name)} <span style="color:var(--dim)">(${u.id})</span></h3>`];
  const row = (k: string, v: string) => rows.push(`<div class="row"><span class="k">${k}</span><span>${v}</span></div>`);

  row('status', u.alive ? (u.rtb ? 'RTB' : 'operational') : 'DESTROYED');
  row('position', `${(u.pos.x / 1000).toFixed(1)}, ${(u.pos.y / 1000).toFixed(1)} km`);
  if (u.domain === 'AIR') row('altitude', `${Math.round(u.pos.alt)} m`);
  if (u.fuelKg !== undefined) {
    row('fuel', `${Math.round(u.fuelKg)} kg${u.bingoKg ? ` (bingo ${u.bingoKg})` : ''}`);
    const frac = Math.max(0, Math.min(1, u.fuelKg / 5200));
    const low = u.bingoKg !== undefined && u.fuelKg < u.bingoKg * 1.3;
    rows.push(`<div class="fuelbar${low ? ' low' : ''}"><div style="width:${frac * 100}%"></div></div>`);
  }
  for (const st of u.weapons) {
    const w = state.weaponCatalog[st.weaponId];
    row(w?.name ?? st.weaponId, `× ${st.count}`);
  }
  if (u.jammer) row('jammer', u.jammer.active ? 'RADIATING' : 'standby');
  if (u.domain === 'AIR') row('IFF', u.iffOn === false ? 'SILENT (bogey to friendlies)' : 'squawking');

  if (!u.alive || u.side !== 'BLUE') return rows.join('');

  const actions: string[] = [];
  if (u.jammer) {
    actions.push(
      `<button data-action="jammer" data-unit="${u.id}" data-active="${!u.jammer.active}" class="${u.jammer.active ? 'on' : ''}">` +
        `${u.jammer.active ? 'JAMMER OFF' : 'JAMMER ON'}</button>`,
    );
  }
  if (u.domain === 'AIR') {
    const silent = u.iffOn === false;
    actions.push(
      `<button data-action="iff" data-unit="${u.id}" data-on="${silent}" class="${silent ? '' : 'on'}">` +
        `${silent ? 'IFF SQUAWK' : 'IFF SILENT'}</button>`,
    );
  }
  if (u.homeBase && u.domain === 'AIR') {
    actions.push(`<button data-action="rtb" data-unit="${u.id}">RTB</button>`);
  }

  // Engage buttons: every (armed station × briefed-or-known target) pair,
  // pre-validated so the button shows why a shot would be refused.
  for (const st of u.weapons) {
    const w = state.weaponCatalog[st.weaponId];
    if (!w || st.count <= 0) continue;
    const targetIds = new Set([
      ...state.prebriefedTargets.BLUE,
      ...Object.keys(state.contacts.BLUE),
    ]);
    for (const tid of [...targetIds].sort()) {
      const target = state.units[tid];
      if (!target || !target.alive) continue;
      const denial = validateLaunch(state, u, w, target);
      const label = `${w.name.split(' ')[0]} → ${esc(target.name)}`;
      actions.push(
        `<button data-action="engage" data-unit="${u.id}" data-weapon="${w.id}" data-target="${tid}"` +
          `${denial ? ` disabled title="${denial}"` : ''}>${label}${denial ? ` <span style="color:var(--dim)">(${denial})</span>` : ''}</button>`,
      );
    }
  }
  if (actions.length) rows.push(`<div class="actions">${actions.join('')}</div>`);
  return rows.join('');
}

// ---- event log ----------------------------------------------------------

function formatEvent(e: SimEvent, state: SimState): { text: string; cls: string } | null {
  const name = (id: string) => state.units[id]?.name ?? id;
  switch (e.type) {
    case 'DETECTION':
      if (e.side === 'RED' && !godView) return null; // enemy's picture is not ours
      return { text: `${name(e.sensorUnitId)} detected ${name(e.targetId)}`, cls: e.side === 'BLUE' ? 'blue' : 'red' };
    case 'CONTACT_LOST':
      if (e.side === 'RED' && !godView) return null;
      return { text: `${e.side} lost track of ${name(e.targetId)}`, cls: '' };
    case 'LAUNCH':
      return {
        text: `${name(e.shooterId)} launched ${e.weaponId} at ${name(e.targetId)}`,
        cls: e.side === 'BLUE' ? 'blue' : 'red',
      };
    case 'LAUNCH_DENIED':
      return { text: `${name(e.shooterId)}: shot on ${name(e.targetId)} DENIED (${e.reason})`, cls: 'warn' };
    case 'HIT':
      return { text: `impact on ${name(e.targetId)}`, cls: 'warn' };
    case 'MISS':
      return { text: `missile missed ${name(e.targetId)}`, cls: '' };
    case 'UNIT_DESTROYED':
      return { text: `${name(e.unitId)} DESTROYED`, cls: state.units[e.unitId]?.side === 'RED' ? 'good' : 'red' };
    case 'EMITTER_SHUTDOWN':
      return { text: `${name(e.unitId)} emitter DOWN until T+${fmtClock(e.untilTick)} (ARM inbound)`, cls: 'good' };
    case 'EMITTER_BACK_UP':
      return { text: `${name(e.unitId)} emitter BACK UP`, cls: 'warn' };
    case 'BINGO_FUEL':
      return { text: `${name(e.unitId)} BINGO FUEL — RTB`, cls: 'warn' };
    case 'FUEL_EXHAUSTED':
      return { text: `${name(e.unitId)} flamed out`, cls: 'red' };
    case 'JAMMER_SET':
      return { text: `${name(e.unitId)} jammer ${e.active ? 'RADIATING' : 'standby'}`, cls: 'blue' };
    case 'CIWS_INTERCEPT': {
      const red = state.units[e.unitId]?.side === 'RED';
      return {
        text: `${name(e.unitId)} CIWS ${e.killed ? 'SPLASHED inbound missile' : 'engaging inbound missile'}`,
        cls: red ? 'red' : 'blue',
      };
    }
    case 'IFF_SET': {
      if (state.units[e.unitId]?.side === 'RED' && !godView) return null;
      return { text: `${name(e.unitId)} transponder ${e.on ? 'SQUAWKING' : 'SILENT — reads as a bogey'}`, cls: e.on ? 'blue' : 'warn' };
    }
    case 'SAM_EMCON':
      // ESM is passive — emissions starting/stopping are knowable to BLUE.
      return {
        text: `${name(e.unitId)} emitter ${e.emitting ? 'RADIATING' : 'silent'}`,
        cls: e.emitting ? 'red' : '',
      };
    case 'SAM_RELOCATING':
      return godView ? { text: `${name(e.unitId)} displacing (shoot-and-scoot)`, cls: 'red' } : null;
    case 'SAM_DEPLOYED':
      return godView ? { text: `${name(e.unitId)} redeployed`, cls: 'red' } : null;
    case 'CAP_COMMIT': {
      // An enemy fighter turning in is only knowable if you can see it.
      const red = state.units[e.unitId]?.side === 'RED';
      if (red && !godView && !state.contacts.BLUE[e.unitId]) return null;
      return { text: `${name(e.unitId)} COMMITTING on ${name(e.targetId)}`, cls: red ? 'red' : 'blue' };
    }
    case 'CAP_ON_STATION': {
      const red = state.units[e.unitId]?.side === 'RED';
      if (red && !godView) return null;
      return { text: `${name(e.unitId)} back on station`, cls: red ? 'red' : 'blue' };
    }
    case 'ROE_SET':
      return e.side === 'BLUE' ? { text: `ROE set to ${e.level}`, cls: 'blue' } : null;
    case 'GROUND_PHASE':
      return { text: `ground element: ${e.phase}`, cls: 'blue' };
    case 'GROUND_DENIED':
      return { text: `ground order ${e.order} refused (${e.reason})`, cls: 'warn' };
    case 'HOSTAGES_SECURED':
      return { text: `site secured — ${e.count} hostages recovered`, cls: 'good' };
    case 'HOSTAGE_CLOCK_EXPIRED':
      return { text: 'HOSTAGE CLOCK EXPIRED — site compromised', cls: 'red' };
    case 'TEAM_ABOARD':
      return { text: `team aboard ${name(e.heloId)}`, cls: 'good' };
    case 'TEAM_EXTRACTED':
      return { text: `EXTRACTION COMPLETE — ${e.count} hostages out`, cls: 'good' };
  }
}

function fmtClock(t: number): string {
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ---- outcome banner ----------------------------------------------------------

function missionOutcome(state: SimState): { cls: string; text: string } | null {
  if (state.groundOp) {
    if (state.groundOp.phase === 'EXTRACTED') {
      return { cls: 'success', text: `MISSION SUCCESS — ${state.groundOp.hostageCount} HOSTAGES EXTRACTED` };
    }
    if (state.groundOp.phase === 'COMPROMISED') {
      return { cls: 'failure', text: 'MISSION FAILED — SITE COMPROMISED' };
    }
    return null; // rescue verdict waits for the ground op
  }
  // The objective unit id varies by scenario (a land C2 node for the strike
  // missions, the HVU for the convoy problem); scenarios with neither (the
  // picket vignette) simply have no destroy-the-objective verdict to show.
  const objective = state.units['red-hq'] ?? state.units['red-supply-1'];
  if (objective && !objective.alive) {
    return { cls: 'success', text: 'MISSION SUCCESS — OBJECTIVE DESTROYED' };
  }
  // Strike element = every armed BLUE fixed-wing (package composition varies).
  const strikers = Object.values(state.units).filter(
    (u) => u.side === 'BLUE' && u.domain === 'AIR' && u.weapons.length > 0,
  );
  if (strikers.length > 0 && strikers.every((u) => !u.alive)) {
    return { cls: 'failure', text: 'MISSION FAILED — STRIKE ELEMENT LOST' };
  }
  return null;
}

/**
 * Cinematic auto-camera: track the missiles if any are flying, otherwise the
 * maneuvering friendlies. Ease toward the target framing each frame.
 */
function updateCinematicCamera(state: SimState): void {
  const pts: { x: number; y: number }[] = [];
  for (const m of Object.values(state.missiles)) {
    if (!m.alive) continue;
    pts.push(m.pos);
    const t = state.units[m.targetId];
    if (t) pts.push(t.pos);
  }
  if (pts.length === 0) {
    for (const u of Object.values(state.units)) {
      if (u.alive && u.side === 'BLUE' && u.domain === 'AIR' && u.waypoints.length > 0) pts.push(u.pos);
    }
  }
  if (pts.length === 0) {
    for (const u of Object.values(state.units)) if (u.alive) pts.push(u.pos);
  }
  if (pts.length === 0) return;

  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const spanX = Math.max(...xs) - Math.min(...xs) + 30_000;
  const spanY = Math.max(...ys) - Math.min(...ys) + 30_000;
  const targetScale = Math.min(0.03, Math.max(0.0025, Math.min(canvas.width / spanX, canvas.height / spanY)));

  view.cx += (cx - view.cx) * 0.05;
  view.cy += (cy - view.cy) * 0.05;
  view.scale += (targetScale - view.scale) * 0.03;
}

// ---- main loop ----------------------------------------------------------

const clockEl = document.getElementById('clock')!;
const eventLog = document.getElementById('eventlog')!;
const banner = document.getElementById('banner')!;
const scrubInfo = document.getElementById('scrubinfo')!;
const godBtn = document.getElementById('godview')!;

let acc = 0;
let lastTime = performance.now();
let lastPanelKey = '';
let lastLogLen = -1;

function frame(now: number): void {
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  if (speed > 0) {
    acc += dt * speed;
    const steps = Math.min(Math.floor(acc), 120);
    acc -= Math.floor(acc);
    for (let i = 0; i < steps; i++) timeline.advance();
  }

  const state = timeline.current;
  if (cinematic) {
    updateCinematicCamera(state);
    if (timeline.cursor >= timeline.states.length - 1 && speed > 0) {
      // Replay caught up to the head of recorded history — hold there.
      speed = timeline.states.length > 1 ? 0 : speed;
      if (speed === 0) cinematic = false;
    }
  }
  if (mode3d && replay3d) {
    // Cinematic replay hands the camera to the 3D auto-director (driven off
    // the same event stream as the captions below); manual selection resumes
    // the moment cinematic stops.
    replay3d.render(state, timeline.prev, cinematic ? 'director' : camMode);
    map3dEl.dataset.shot = replay3d.currentShot;
  } else {
    renderer.draw(state, timeline.prev, view, {
      godView,
      selectedId,
      briefedRcs: 3,
      briefedPositions: timeline.briefedPositions(),
      intel: timeline.states[0]!.intel ?? null,
      lz: state.groundOp?.lz ?? null,
    });
  }

  // Cinematic caption: the most recent narratable event.
  const captionEl = document.getElementById('caption')!;
  if (cinematic) {
    let caption = '';
    for (let i = state.events.length - 1; i >= 0; i--) {
      const f = formatEvent(state.events[i]!, state);
      if (f) {
        caption = `T+${fmtClock(state.events[i]!.tick)} — ${f.text}`;
        break;
      }
    }
    captionEl.textContent = caption;
  } else {
    captionEl.textContent = '';
  }

  // Header/state widgets.
  clockEl.textContent = `T+${fmtClock(state.tick)}`;
  for (const btn of speedButtons) btn.classList.toggle('on', Number(btn.dataset.speed) === speed);
  for (const btn of roeButtons) btn.classList.toggle('on', btn.dataset.roe === state.roe.BLUE);
  godBtn.classList.toggle('on', godView);
  view3dBtn.classList.toggle('on', mode3d);
  // The auto-director owns the camera during 3D cinematic replay — manual
  // selection is inert then, so disable it rather than let it silently do nothing.
  camSel.disabled = mode3d && cinematic;

  // Scrubber.
  scrubber.max = String(timeline.states.length - 1);
  if (document.activeElement !== scrubber) scrubber.value = String(timeline.cursor);
  scrubInfo.textContent = `tick ${timeline.cursor} / ${timeline.states.length - 1}${
    timeline.cursor < timeline.states.length - 1 ? ' (replay)' : ''
  }`;

  // Side panels — only rebuild when their content could have changed.
  const panelKey = `${timeline.cursor}:${selectedId}:${godView}:${timeline.orders.length}:${timeline.states.length}`;
  if (panelKey !== lastPanelKey) {
    lastPanelKey = panelKey;
    unitPanel.innerHTML = renderUnitPanel(state);
    orderList.innerHTML = renderOrderList();
    const groundHtml = renderGroundPanel(state);
    groundPanel.innerHTML = groundHtml;
    (groundPanel as HTMLElement).style.display = groundHtml ? 'block' : 'none';
    const dossierHtml = renderDossier(state);
    const dossierPanel = document.getElementById('dossierpanel')!;
    dossierPanel.innerHTML = dossierHtml;
    dossierPanel.style.display = dossierHtml ? 'block' : 'none';
  }

  // Event log — rebuild when events (or view filter) change.
  const logKey = state.events.length * 2 + (godView ? 1 : 0);
  if (logKey !== lastLogLen) {
    lastLogLen = logKey;
    const lines: string[] = [];
    for (const e of state.events.slice(-80)) {
      const f = formatEvent(e, state);
      if (!f) continue;
      lines.push(`<div class="ev ${f.cls}"><span class="t">T+${fmtClock(e.tick)}</span> ${f.text}</div>`);
    }
    eventLog.innerHTML = lines.join('');
    eventLog.scrollTop = eventLog.scrollHeight;
  }

  // Outcome banner.
  const outcome = missionOutcome(state);
  banner.className = outcome?.cls ?? '';
  banner.textContent = outcome?.text ?? '';

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
