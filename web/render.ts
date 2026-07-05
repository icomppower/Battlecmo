import type { IntelEntry, SimState, Unit, Vec3 } from '../src/core/types';
import { isSuppressed, jammingFactor, rcsScaledRange } from '../src/core/sensors';
import { getTerrain, type Heightfield } from '../src/core/terrain';

/**
 * 2D tactical map renderer for the Executive layer. Pure draw code: reads a
 * SimState (plus the previous one, for headings and missile trails) and
 * paints it — no simulation logic and no mutation.
 *
 * The map honors the sensor pillar: in the default (BLUE) view you see your
 * own package, the briefed IADS sites from the intel dossier, emitter
 * activity (ESM is passive — a radiating radar is knowable), and RWR spikes.
 * You do NOT see RED's actual track quality on you — that's what TRUTH VIEW
 * is for.
 */

export interface View {
  cx: number; // world x at canvas center, meters
  cy: number; // world y at canvas center, meters
  scale: number; // pixels per meter
}

export interface RenderOptions {
  godView: boolean;
  selectedId: string | null;
  /** Reference RCS used to draw "assessed" radar detection rings. */
  briefedRcs: number;
  /**
   * Where the intel dossier put RED's ground sites at mission start. Outside
   * truth view, RED ground units are plotted here — a battery that scoots
   * keeps its map ghost at the briefed spot, because BLUE has no sensor in
   * this package that would re-find it.
   */
  briefedPositions: Record<string, Vec3>;
  /** Confidence-graded dossier — drives ghost styling and uncertainty rings. */
  intel: Record<string, IntelEntry> | null;
  /** Extraction LZ marker, when the mission carries a ground op. */
  lz: Vec3 | null;
}

const COLORS = {
  bg: '#0b0e14',
  grid: '#131a26',
  gridMajor: '#182234',
  blue: '#4da3ff',
  blueDim: '#2a5c94',
  red: '#ff5f56',
  redDim: '#8a3531',
  amber: '#ffb84d',
  green: '#4dd97a',
  gray: '#5a6474',
  white: '#e8eef7',
};

export class Renderer {
  constructor(private canvas: HTMLCanvasElement) {}

  toScreen(view: View, p: { x: number; y: number }): [number, number] {
    const { width, height } = this.canvas;
    return [
      width / 2 + (p.x - view.cx) * view.scale,
      height / 2 - (p.y - view.cy) * view.scale,
    ];
  }

  toWorld(view: View, sx: number, sy: number): { x: number; y: number } {
    const { width, height } = this.canvas;
    return {
      x: view.cx + (sx - width / 2) / view.scale,
      y: view.cy - (sy - height / 2) / view.scale,
    };
  }

  /**
   * Position a unit is *plotted* at, honoring the intel-vs-truth rule:
   * truth for BLUE and in truth view; sensor position while BLUE holds a
   * contact; otherwise the dossier ghost.
   */
  private plotPos(state: SimState, u: Unit, opts: RenderOptions): Vec3 {
    if (opts.godView || u.side === 'BLUE') return u.pos;
    if (state.contacts.BLUE[u.id]) return u.pos; // live sensor track
    return opts.intel?.[u.id]?.briefedPos ?? opts.briefedPositions[u.id] ?? u.pos;
  }

  /** RED units BLUE neither tracks nor was briefed on simply aren't plotted. */
  private isPlottable(state: SimState, u: Unit, opts: RenderOptions): boolean {
    if (opts.godView || u.side === 'BLUE') return true;
    if (state.contacts.BLUE[u.id]) return true;
    if (opts.intel) return !!opts.intel[u.id];
    return u.domain !== 'AIR'; // pre-dossier fallback: ground sites are briefed
  }

  private isDisplaced(u: Unit, opts: RenderOptions): boolean {
    const briefed = opts.briefedPositions[u.id];
    return !!briefed && Math.hypot(u.pos.x - briefed.x, u.pos.y - briefed.y) > 500;
  }

  draw(state: SimState, prev: SimState | null, view: View, opts: RenderOptions): void {
    const ctx = this.canvas.getContext('2d')!;
    const { width, height } = this.canvas;
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, width, height);

    this.drawTerrain(ctx, state, view);
    this.drawGrid(ctx, view);
    this.drawRidges(ctx, state, view);
    this.drawJammerCoverage(ctx, state, view);
    this.drawUncertainty(ctx, state, view, opts);
    this.drawThreatRings(ctx, state, view, opts);
    this.drawWaypoints(ctx, state, view, opts);
    if (opts.lz) this.drawLz(ctx, view, opts.lz);
    this.drawMissiles(ctx, state, prev, view);
    this.drawUnits(ctx, state, prev, view, opts);
    this.drawScaleBar(ctx, view);
  }

  private terrainCache: { id: string; canvas: HTMLCanvasElement } | null = null;

  /**
   * Heightfield underlay — the SAME data the sim's LOS checks read, so what
   * looks like a shadowed fjord arm on the map IS one. Rendered once per
   * terrain into an offscreen canvas (dark hypsometric ramp), then blitted
   * with the view transform each frame.
   */
  private drawTerrain(ctx: CanvasRenderingContext2D, state: SimState, view: View): void {
    const hf = getTerrain(state.terrainId);
    if (!hf) return;
    if (this.terrainCache?.id !== hf.name) {
      this.terrainCache = { id: hf.name, canvas: renderTerrainBitmap(hf) };
    }
    const spanX = (hf.width - 1) * hf.cellSize;
    const spanY = (hf.height - 1) * hf.cellSize;
    const [sx0, sy0] = this.toScreen(view, { x: hf.originX, y: hf.originY + spanY });
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.terrainCache.canvas, sx0, sy0, spanX * view.scale, spanY * view.scale);
  }

  private drawGrid(ctx: CanvasRenderingContext2D, view: View): void {
    const step = 10_000; // 10 km
    const { width, height } = this.canvas;
    const tl = this.toWorld(view, 0, 0);
    const br = this.toWorld(view, width, height);
    ctx.lineWidth = 1;
    for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) {
      const [sx] = this.toScreen(view, { x, y: 0 });
      ctx.strokeStyle = x % 50_000 === 0 ? COLORS.gridMajor : COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, height);
      ctx.stroke();
    }
    for (let y = Math.floor(br.y / step) * step; y <= tl.y; y += step) {
      const [, sy] = this.toScreen(view, { x: 0, y });
      ctx.strokeStyle = y % 50_000 === 0 ? COLORS.gridMajor : COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(this.canvas.width, sy);
      ctx.stroke();
    }
  }

  /** Terrain ridges: hatched crest lines — the masked side is a planning tool. */
  private drawRidges(ctx: CanvasRenderingContext2D, state: SimState, view: View): void {
    for (const r of state.ridges ?? []) {
      const [x1, y1] = this.toScreen(view, { x: r.x1, y: r.y1 });
      const [x2, y2] = this.toScreen(view, { x: r.x2, y: r.y2 });
      ctx.strokeStyle = 'rgba(155,135,95,0.8)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      // Hatch ticks along the crest.
      const len = Math.hypot(x2 - x1, y2 - y1);
      const nx = -(y2 - y1) / len;
      const ny = (x2 - x1) / len;
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(155,135,95,0.5)';
      for (let t = 0.08; t < 1; t += 0.08) {
        const hx = x1 + (x2 - x1) * t;
        const hy = y1 + (y2 - y1) * t;
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx + nx * 5, hy + ny * 5);
        ctx.stroke();
      }
      this.label(ctx, (x1 + x2) / 2, (y1 + y2) / 2 - 10, `${r.id} · ${r.height} m`, 'rgba(155,135,95,0.9)');
    }
  }

  /** APPROX/CONTESTED dossier entries get an uncertainty ring at the ghost. */
  private drawUncertainty(
    ctx: CanvasRenderingContext2D,
    state: SimState,
    view: View,
    opts: RenderOptions,
  ): void {
    if (!opts.intel || opts.godView) return;
    for (const entry of Object.values(opts.intel)) {
      const u = state.units[entry.unitId];
      if (!u?.alive || !entry.uncertaintyRadius) continue;
      if (state.contacts.BLUE[entry.unitId]) continue; // tracked — no guesswork
      const color = entry.confidence === 'CONTESTED' ? 'rgba(255,95,86,0.35)' : 'rgba(255,184,77,0.35)';
      this.circle(ctx, view, entry.briefedPos, entry.uncertaintyRadius);
      ctx.strokeStyle = color;
      ctx.setLineDash([3, 7]);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private circle(ctx: CanvasRenderingContext2D, view: View, center: Vec3, radiusM: number): void {
    const [sx, sy] = this.toScreen(view, center);
    ctx.beginPath();
    ctx.arc(sx, sy, radiusM * view.scale, 0, Math.PI * 2);
  }

  private drawJammerCoverage(ctx: CanvasRenderingContext2D, state: SimState, view: View): void {
    for (const u of Object.values(state.units)) {
      if (!u.alive || !u.jammer?.active) continue;
      this.circle(ctx, view, u.pos, u.jammer.range);
      ctx.fillStyle = 'rgba(77, 163, 255, 0.04)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(77, 163, 255, 0.25)';
      ctx.setLineDash([2, 6]);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /**
   * RED site rings, as BLUE would brief them: weapon engagement ring (the
   * no-go circle) and the assessed radar detection ring against the strike
   * package's own RCS — including the current jamming benefit, which BLUE
   * knows because the jamming is theirs.
   */
  private drawThreatRings(
    ctx: CanvasRenderingContext2D,
    state: SimState,
    view: View,
    opts: RenderOptions,
  ): void {
    for (const u of Object.values(state.units)) {
      if (!u.alive || u.side !== 'RED') continue;
      if (!this.isPlottable(state, u, opts)) continue;
      const suppressed = isSuppressed(u, state.tick);
      const pp = this.plotPos(state, u, opts);

      // Weapon engagement rings.
      for (const st of u.weapons) {
        const w = state.weaponCatalog[st.weaponId];
        if (!w || st.count <= 0) continue;
        this.circle(ctx, view, pp, w.maxRange);
        ctx.strokeStyle = suppressed ? 'rgba(90,100,116,0.5)' : 'rgba(255,95,86,0.55)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash(suppressed ? [3, 5] : []);
        ctx.stroke();
        this.circle(ctx, view, pp, w.maxRange);
        ctx.fillStyle = suppressed ? 'rgba(90,100,116,0.03)' : 'rgba(255,95,86,0.05)';
        ctx.fill();
      }

      // Assessed radar detection rings vs briefed package RCS.
      for (const sensor of u.sensors) {
        if (sensor.kind !== 'RADAR') continue;
        const range =
          suppressed || !sensor.emitting
            ? 0
            : rcsScaledRange(sensor, opts.briefedRcs) * jammingFactor(state, u);
        if (range <= 0) continue;
        this.circle(ctx, view, pp, range);
        ctx.strokeStyle = 'rgba(255,184,77,0.35)';
        ctx.setLineDash([8, 6]);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.setLineDash([]);
  }

  private drawWaypoints(
    ctx: CanvasRenderingContext2D,
    state: SimState,
    view: View,
    opts: RenderOptions,
  ): void {
    for (const u of Object.values(state.units)) {
      if (!u.alive || u.side !== 'BLUE' || u.waypoints.length === 0) continue;
      const selected = u.id === opts.selectedId;
      ctx.strokeStyle = selected ? 'rgba(77,163,255,0.8)' : 'rgba(77,163,255,0.25)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      let [sx, sy] = this.toScreen(view, u.pos);
      ctx.moveTo(sx, sy);
      for (const wp of u.waypoints) {
        [sx, sy] = this.toScreen(view, wp);
        ctx.lineTo(sx, sy);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      for (const wp of u.waypoints) {
        const [wx, wy] = this.toScreen(view, wp);
        ctx.fillStyle = selected ? COLORS.blue : COLORS.blueDim;
        ctx.fillRect(wx - 2, wy - 2, 4, 4);
      }
    }
  }

  private drawMissiles(
    ctx: CanvasRenderingContext2D,
    state: SimState,
    prev: SimState | null,
    view: View,
  ): void {
    for (const m of Object.values(state.missiles)) {
      if (!m.alive) continue;
      const [sx, sy] = this.toScreen(view, m.pos);
      const color = m.side === 'BLUE' ? COLORS.blue : COLORS.red;

      const prevPos = prev?.missiles[m.id]?.pos ?? m.pos;
      const [px, py] = this.toScreen(view, prevPos);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(sx, sy);
      ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Dashed intent line to the target.
      const target = state.units[m.targetId];
      if (target) {
        const [tx, ty] = this.toScreen(view, target.pos);
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.15;
        ctx.setLineDash([2, 6]);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    }
  }

  private drawUnits(
    ctx: CanvasRenderingContext2D,
    state: SimState,
    prev: SimState | null,
    view: View,
    opts: RenderOptions,
  ): void {
    for (const u of Object.values(state.units)) {
      if (!this.isPlottable(state, u, opts)) continue;
      const [sx, sy] = this.toScreen(view, this.plotPos(state, u, opts));
      const isBlue = u.side === 'BLUE';
      const color = u.alive ? (isBlue ? COLORS.blue : COLORS.red) : COLORS.gray;

      if (!u.alive) {
        ctx.strokeStyle = COLORS.gray;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sx - 5, sy - 5);
        ctx.lineTo(sx + 5, sy + 5);
        ctx.moveTo(sx + 5, sy - 5);
        ctx.lineTo(sx - 5, sy + 5);
        ctx.stroke();
        this.label(ctx, sx, sy, `✝ ${u.name}`, COLORS.gray);
        continue;
      }

      if (u.id === opts.selectedId) {
        ctx.strokeStyle = COLORS.white;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(sx, sy, 12, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (u.domain === 'AIR' && u.maxSpeed < 120) {
        // Rotary-wing: rotor disc over a hull bar.
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx, sy, 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(sx - 8, sy);
        ctx.lineTo(sx + 8, sy);
        ctx.stroke();
      } else if (u.domain === 'AIR') {
        this.drawAircraft(ctx, sx, sy, this.headingOf(u, prev), color);
      } else if (u.domain === 'SEA') {
        // Naval hull: pointed bow, flat stern.
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sx - 8, sy - 4);
        ctx.lineTo(sx + 4, sy - 4);
        ctx.lineTo(sx + 9, sy);
        ctx.lineTo(sx + 4, sy + 4);
        ctx.lineTo(sx - 8, sy + 4);
        ctx.closePath();
        ctx.stroke();
      } else if (u.side === 'BLUE') {
        // Friendly ground element: small filled block (infantry wedge kin).
        ctx.fillStyle = color;
        ctx.fillRect(sx - 4, sy - 4, 8, 8);
        ctx.strokeStyle = COLORS.bg;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx - 4, sy + 4);
        ctx.lineTo(sx, sy - 1);
        ctx.lineTo(sx + 4, sy + 4);
        ctx.stroke();
      } else {
        this.drawGroundSite(ctx, sx, sy, u, color);
      }

      // RWR spike: RED holds a track on this BLUE aircraft while a SAM radar
      // is live — the crew would know they're spiked.
      if (isBlue && u.domain === 'AIR' && state.contacts.RED[u.id]) {
        const samLive = Object.values(state.units).some(
          (r) =>
            r.alive &&
            r.side === 'RED' &&
            r.weapons.some((w) => ['SAM', 'AAM'].includes(state.weaponCatalog[w.weaponId]?.kind ?? '')) &&
            !isSuppressed(r, state.tick) &&
            r.sensors.some((se) => se.kind === 'RADAR' && se.emitting),
        );
        if (samLive) {
          ctx.strokeStyle = COLORS.amber;
          ctx.lineWidth = 1;
          ctx.strokeRect(sx - 9, sy - 9, 18, 18);
          this.label(ctx, sx, sy - 26, 'SPIKE', COLORS.amber, 'center');
        }
      }

      // Truth view: show RED's track quality on BLUE units.
      if (opts.godView && isBlue && state.contacts.RED[u.id]) {
        const q = state.contacts.RED[u.id]!.quality;
        ctx.fillStyle = '#1a2230';
        ctx.fillRect(sx - 10, sy + 12, 20, 3);
        ctx.fillStyle = q >= 0.5 ? COLORS.red : COLORS.amber;
        ctx.fillRect(sx - 10, sy + 12, 20 * q, 3);
      }

      let tag = u.name;
      if (u.domain === 'AIR' && u.fuelKg !== undefined && u.bingoKg !== undefined) {
        if (u.rtb) tag += ' · RTB';
      }
      if (u.side === 'RED' && isSuppressed(u, state.tick)) {
        tag += ` · DOWN ${u.suppressedUntilTick! - state.tick}s`;
      }
      if (u.side === 'RED' && u.domain !== 'AIR' && this.isDisplaced(u, opts)) {
        tag += opts.godView ? ' · DISPLACED' : ' · last known';
      }
      // Un-tracked, non-verified dossier ghosts wear their confidence grade.
      if (!opts.godView && u.side === 'RED' && !state.contacts.BLUE[u.id]) {
        const conf = opts.intel?.[u.id]?.confidence;
        if (conf && conf !== 'VERIFIED') tag += conf === 'CONTESTED' ? ' · ?' : ' · approx';
      }
      // Stagger ground-site labels so co-located sites stay readable:
      // shooters above, sensors beside, the objective below.
      let dy = 0;
      if (u.domain !== 'AIR') {
        if (u.weapons.length > 0) dy = -16;
        else if (u.sensors.length === 0) dy = 18;
      }
      this.label(ctx, sx, sy + dy, tag, color);
    }
  }

  private headingOf(u: Unit, prev: SimState | null): number {
    const before = prev?.units[u.id];
    if (before && (before.pos.x !== u.pos.x || before.pos.y !== u.pos.y)) {
      return Math.atan2(u.pos.y - before.pos.y, u.pos.x - before.pos.x);
    }
    const wp = u.waypoints[0];
    if (wp) return Math.atan2(wp.y - u.pos.y, wp.x - u.pos.x);
    return u.side === 'BLUE' ? 0 : Math.PI;
  }

  private drawAircraft(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    heading: number,
    color: string,
  ): void {
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(-heading); // canvas y is flipped
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-6, 5);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-6, -5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawGroundSite(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    u: Unit,
    color: string,
  ): void {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    const isSam = u.weapons.length > 0;
    const isRadar = u.sensors.some((s) => s.kind === 'RADAR');
    if (isSam) {
      ctx.strokeRect(sx - 6, sy - 6, 12, 12);
      ctx.beginPath();
      ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    } else if (isRadar) {
      ctx.strokeRect(sx - 6, sy - 6, 12, 12);
      ctx.beginPath();
      ctx.arc(sx, sy - 1, 4, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    } else {
      // Objective: diamond.
      ctx.beginPath();
      ctx.moveTo(sx, sy - 8);
      ctx.lineTo(sx + 8, sy);
      ctx.lineTo(sx, sy + 8);
      ctx.lineTo(sx - 8, sy);
      ctx.closePath();
      ctx.stroke();
    }
  }

  private label(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    text: string,
    color: string,
    align: CanvasTextAlign = 'left',
  ): void {
    ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = align;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.fillText(text, align === 'left' ? sx + 12 : sx, sy + 3 + (align === 'center' ? 12 : 0));
    ctx.globalAlpha = 1;
  }

  private drawLz(ctx: CanvasRenderingContext2D, view: View, lz: Vec3): void {
    const [sx, sy] = this.toScreen(view, lz);
    ctx.strokeStyle = COLORS.green;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(sx, sy, 7, 0, Math.PI * 2);
    ctx.moveTo(sx - 4, sy - 4);
    ctx.lineTo(sx + 4, sy + 4);
    ctx.moveTo(sx + 4, sy - 4);
    ctx.lineTo(sx - 4, sy + 4);
    ctx.stroke();
    this.label(ctx, sx, sy, 'LZ', COLORS.green);
  }

  private drawScaleBar(ctx: CanvasRenderingContext2D, view: View): void {
    const targetPx = 120;
    const meters = targetPx / view.scale;
    const nice = Math.pow(10, Math.floor(Math.log10(meters)));
    const km = (Math.round(meters / nice) * nice) / 1000;
    const px = km * 1000 * view.scale;
    const x = 16;
    const y = this.canvas.height - 18;
    ctx.strokeStyle = COLORS.gray;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + px, y);
    ctx.moveTo(x, y - 4);
    ctx.lineTo(x, y + 4);
    ctx.moveTo(x + px, y - 4);
    ctx.lineTo(x + px, y + 4);
    ctx.stroke();
    ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.gray;
    ctx.fillText(`${km} km`, x + px + 8, y + 3);
  }
}

/** Bake a heightfield into a dark hypsometric bitmap (north-up, 4 px/cell). */
function renderTerrainBitmap(hf: Heightfield): HTMLCanvasElement {
  const scale = 4;
  const w = (hf.width - 1) * scale;
  const h = (hf.height - 1) * scale;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  // Dark theme ramp: water stays near the map background; land climbs from
  // deep slate to pale summit grey.
  const stops: [number, [number, number, number]][] = [
    [0, [13, 22, 34]],
    [1, [24, 34, 48]],
    [300, [37, 50, 68]],
    [700, [58, 72, 92]],
    [1200, [92, 104, 122]],
    [1900, [150, 158, 172]],
  ];
  const shade = (elev: number): [number, number, number] => {
    if (elev <= 0) return stops[0]![1];
    for (let i = 1; i < stops.length; i++) {
      if (elev <= stops[i]![0]) {
        const [e0, c0] = stops[i - 1]!;
        const [e1, c1] = stops[i]!;
        const t = (elev - e0) / (e1 - e0);
        return [0, 1, 2].map((k) => Math.round(c0[k]! + (c1[k]! - c0[k]!) * t)) as [number, number, number];
      }
    }
    return stops[stops.length - 1]![1];
  };
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      // Canvas y grows south; heightfield rows grow north.
      const gx = px / scale;
      const gy = (h - 1 - py) / scale;
      const x0 = Math.min(hf.width - 2, Math.floor(gx));
      const y0 = Math.min(hf.height - 2, Math.floor(gy));
      const fx = gx - x0;
      const fy = gy - y0;
      const i0 = y0 * hf.width + x0;
      const elev =
        (hf.data[i0]! * (1 - fx) + hf.data[i0 + 1]! * fx) * (1 - fy) +
        (hf.data[i0 + hf.width]! * (1 - fx) + hf.data[i0 + hf.width + 1]! * fx) * fy;
      const [r, g, b] = shade(elev);
      const o = (py * w + px) * 4;
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
