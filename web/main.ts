import { tick } from '../src/core/tick';
import { validateLaunch } from '../src/core/weapons';
import { buildStrikeScenario } from '../src/scenarios/strike-basic';
import type { Order, RoeLevel, SimEvent, SimState } from '../src/core/types';
import { Renderer, type View } from './render';

const SEED = 42;

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
  states: SimState[] = [buildStrikeScenario()];
  orders: Order[] = [];
  cursor = 0;

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
    this.states.length = this.cursor + 1; // the future is now unwritten
    this.orders.push(order);
  }

  scrub(to: number): void {
    this.cursor = Math.max(0, Math.min(to, this.states.length - 1));
  }

  reset(): void {
    this.states = [buildStrikeScenario()];
    this.orders = [];
    this.cursor = 0;
  }
}

// ---------------------------------------------------------------------------

const timeline = new Timeline();
const canvas = document.getElementById('map') as HTMLCanvasElement;
const renderer = new Renderer(canvas);

const view: View = { cx: -60_000, cy: 0, scale: 0.006 };
let speed = 0; // ticks per real second (0 = paused)
let godView = false;
let selectedId: string | null = null;

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

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const state = timeline.current;
  const unit = selectedId ? state.units[selectedId] : null;
  if (!unit || !unit.alive || unit.side !== 'BLUE' || unit.maxSpeed <= 0) return;
  const w = renderer.toWorld(view, e.offsetX, e.offsetY);
  const wp = { x: w.x, y: w.y, alt: unit.pos.alt };
  const waypoints = e.shiftKey ? [...unit.waypoints, wp] : [wp];
  timeline.issue({ atTick: state.tick, type: 'SET_WAYPOINTS', unitId: unit.id, waypoints });
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
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
    timeline.issue({
      atTick: timeline.current.tick,
      type: 'SET_ROE',
      side: 'BLUE',
      level: btn.dataset.roe as RoeLevel,
    });
    timeline.advance(); // apply immediately so the UI reflects the change
    speedAfterOrder();
  });
}

document.getElementById('godview')!.addEventListener('click', () => {
  godView = !godView;
});

document.getElementById('reset')!.addEventListener('click', () => {
  timeline.reset();
  selectedId = null;
  speed = 0;
});

/** Orders issued while paused shouldn't silently unpause. */
function speedAfterOrder(): void {
  if (speed === 0) timeline.scrub(timeline.cursor); // no-op, keeps intent obvious
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
  const state = timeline.current;
  const t = state.tick;
  switch (btn.dataset.action) {
    case 'engage':
      timeline.issue({
        atTick: t,
        type: 'ENGAGE',
        unitId: btn.dataset.unit!,
        weaponId: btn.dataset.weapon!,
        targetId: btn.dataset.target!,
      });
      timeline.advance();
      break;
    case 'jammer':
      timeline.issue({
        atTick: t,
        type: 'SET_JAMMER',
        unitId: btn.dataset.unit!,
        active: btn.dataset.active === 'true',
      });
      timeline.advance();
      break;
    case 'rtb':
      timeline.issue({ atTick: t, type: 'RTB', unitId: btn.dataset.unit! });
      timeline.advance();
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

  if (!u.alive || u.side !== 'BLUE') return rows.join('');

  const actions: string[] = [];
  if (u.jammer) {
    actions.push(
      `<button data-action="jammer" data-unit="${u.id}" data-active="${!u.jammer.active}" class="${u.jammer.active ? 'on' : ''}">` +
        `${u.jammer.active ? 'JAMMER OFF' : 'JAMMER ON'}</button>`,
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
    case 'ROE_SET':
      return e.side === 'BLUE' ? { text: `ROE set to ${e.level}`, cls: 'blue' } : null;
  }
}

function fmtClock(t: number): string {
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ---- outcome banner ----------------------------------------------------------

function missionOutcome(state: SimState): { cls: string; text: string } | null {
  if (!state.units['red-hq']!.alive) {
    return { cls: 'success', text: 'MISSION SUCCESS — OBJECTIVE DESTROYED' };
  }
  const strikersDead = ['blue-striker-1', 'blue-striker-2'].every((id) => !state.units[id]!.alive);
  if (strikersDead) return { cls: 'failure', text: 'MISSION FAILED — STRIKE ELEMENT LOST' };
  return null;
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
  renderer.draw(state, timeline.prev, view, { godView, selectedId, briefedRcs: 3 });

  // Header/state widgets.
  clockEl.textContent = `T+${fmtClock(state.tick)}`;
  for (const btn of speedButtons) btn.classList.toggle('on', Number(btn.dataset.speed) === speed);
  for (const btn of roeButtons) btn.classList.toggle('on', btn.dataset.roe === state.roe.BLUE);
  godBtn.classList.toggle('on', godView);

  // Scrubber.
  scrubber.max = String(timeline.states.length - 1);
  if (document.activeElement !== scrubber) scrubber.value = String(timeline.cursor);
  scrubInfo.textContent = `tick ${timeline.cursor} / ${timeline.states.length - 1}${
    timeline.cursor < timeline.states.length - 1 ? ' (replay)' : ''
  }`;

  // Unit panel — only rebuild when its content could have changed.
  const panelKey = `${timeline.cursor}:${selectedId}:${godView}`;
  if (panelKey !== lastPanelKey) {
    lastPanelKey = panelKey;
    unitPanel.innerHTML = renderUnitPanel(state);
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
