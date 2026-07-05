import type { SimState, Unit, Vec3 } from '../src/core/types';
import { isSuppressed, jammingFactor, rcsScaledRange } from '../src/core/sensors';

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

  /** Position a unit is *plotted* at, honoring the intel-vs-truth rule. */
  private plotPos(u: Unit, opts: RenderOptions): Vec3 {
    if (!opts.godView && u.side === 'RED' && u.domain !== 'AIR') {
      return opts.briefedPositions[u.id] ?? u.pos;
    }
    return u.pos;
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

    this.drawGrid(ctx, view);
    this.drawJammerCoverage(ctx, state, view);
    this.drawThreatRings(ctx, state, view, opts);
    this.drawWaypoints(ctx, state, view, opts);
    this.drawMissiles(ctx, state, prev, view);
    this.drawUnits(ctx, state, prev, view, opts);
    this.drawScaleBar(ctx, view);
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
      const suppressed = isSuppressed(u, state.tick);
      const pp = this.plotPos(u, opts);

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
      const [sx, sy] = this.toScreen(view, this.plotPos(u, opts));
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

      if (u.domain === 'AIR') {
        this.drawAircraft(ctx, sx, sy, this.headingOf(u, prev), color);
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
            r.weapons.some((w) => state.weaponCatalog[w.weaponId]?.kind === 'SAM') &&
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
