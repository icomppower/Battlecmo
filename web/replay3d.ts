import * as THREE from 'three';
import type { SimEvent, SimState, Unit, Vec3 } from '../src/core/types';
import { isSuppressed } from '../src/core/sensors';
import { getTerrain, type Heightfield } from '../src/core/terrain';

/**
 * Phase 1 of the 3D replay: a READ-ONLY cinematic view over the same
 * recorded states the 2D map and the scrubber use — no orders, no picking,
 * no separate simulation. Terrain ridges are extruded to real footprint
 * with exaggerated height (standard wargame-viz practice: at true scale a
 * 450 m crest under a 40 km ring is invisible), and the same exaggeration
 * is applied to unit altitudes so "under the radar" reads on screen: the
 * deck run hugs the dirt while the ridge towers over it.
 *
 * This is the truth view by design — replay is after-action footage, the
 * same contract as the narrated debrief.
 */

/** Scene units per meter (1 scene unit = 200 m). */
const S = 1 / 200;
/** Vertical exaggeration applied to both terrain and altitudes. */
const ALT = 6;

const COL = {
  bg: 0x0a0d13,
  ground: 0x131b28,
  grid: 0x203047,
  ridge: 0x3a4a68,
  ridgeCrest: 0x51648a,
  blue: 0x4da3ff,
  red: 0xff5f56,
  gray: 0x5a6474,
  ringLive: 0xff5f56,
  ringDown: 0x5a6474,
  missileBlue: 0x9fd0ff,
  missileRed: 0xffb0aa,
  ping: 0xffcf5c,
};

function toScene(p: Vec3): THREE.Vector3 {
  return new THREE.Vector3(p.x * S, Math.max(p.alt, 0) * S * ALT, -p.y * S);
}

export type CameraMode =
  | 'overview'
  /** Cinematic auto-director: pick the shot from the event stream every frame. */
  | 'director'
  | `chase:${string}`
  /** Orbit a fixed world point (event location), keyed by the unit at that point. */
  | `orbit:${string}`
  /** Frame the ground team + extraction helicopter (rescue-op mission). */
  | 'ground';

/** Sim-seconds (ticks) each director shot holds before it's eligible to lapse. */
const DIRECTOR_HOLD: Partial<Record<SimEvent['type'], number>> = {
  LAUNCH: 15,
  HIT: 6,
  EMITTER_SHUTDOWN: 6,
  GROUND_PHASE: 8,
};
/** Longest of the above — bounds how far back the director needs to scan. */
const DIRECTOR_MAX_HOLD = Math.max(...Object.values(DIRECTOR_HOLD));

/**
 * Cinematic auto-director: which shot is live *right now*, derived purely
 * from the recorded event stream — the same events the 2D captions narrate.
 * Stateless by design (a pure function of tick + history) so scrubbing the
 * replay re-derives the identical shot instead of drifting from held state:
 *   LAUNCH            → chase the shooter for ~15 sim-seconds
 *   HIT / EMITTER_SHUTDOWN → orbit the event location
 *   GROUND_PHASE       → frame the ground team + helicopter
 *   nothing live       → overview orbit
 * A newer qualifying event always wins over an older one still in its hold
 * window (scanned newest-first), so escalating action cuts promptly.
 */
export function directorPick(state: SimState, events: SimEvent[]): CameraMode {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.tick < state.tick - DIRECTOR_MAX_HOLD) break; // too old for any hold window
    const hold = DIRECTOR_HOLD[e.type];
    if (hold === undefined || e.tick + hold <= state.tick) continue; // not directable, or lapsed
    switch (e.type) {
      case 'LAUNCH':
        return `chase:${e.shooterId}`;
      case 'HIT':
        return `orbit:${e.targetId}`;
      case 'EMITTER_SHUTDOWN':
        return `orbit:${e.unitId}`;
      case 'GROUND_PHASE':
        return 'ground';
      default:
        continue;
    }
  }
  return 'overview';
}

/** Expanding-ring event ping: real-time (not sim-time) so it reads at any replay speed. */
const PING_LIFE_MS = 800;
const PING_MIN_RADIUS = 0.3;
const PING_MAX_RADIUS = 9;

/** Unit circle, shared by every ping instance — radius comes from `.scale`, never rebuilt. */
const pingRingPts: THREE.Vector3[] = [];
for (let i = 0; i <= 48; i++) {
  const a = (i / 48) * Math.PI * 2;
  pingRingPts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
}
const pingRingGeometry = new THREE.BufferGeometry().setFromPoints(pingRingPts);

interface Ping {
  obj: THREE.LineLoop;
  bornAt: number;
}

export class Replay3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private unitMeshes = new Map<string, THREE.Object3D>();
  private missileMeshes = new Map<string, THREE.Object3D>();
  private rings = new Map<string, THREE.LineLoop>();
  /** Unit-name sprites, cached per unit id so label draw calls stay bounded. */
  private labelSprites = new Map<string, THREE.Sprite>();
  private pings: Ping[] = [];
  /** Index into state.events already scanned for pings — avoids re-spawning history. */
  private pingEventCursor = 0;
  /** Last director-resolved shot; exposed read-only via `currentShot`. */
  private lastResolvedMode: CameraMode = 'overview';
  private staticBuilt = false;
  private orbitAngle = 0;
  private camPos = new THREE.Vector3(0, 400, 400);
  private camTarget = new THREE.Vector3(0, 0, 0);

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.5, 20_000);

    this.scene.background = new THREE.Color(0x0e1522);
    this.scene.fog = new THREE.Fog(0x0e1522, 900, 5_000);

    const hemi = new THREE.HemisphereLight(0x9fc2f0, 0x1c2636, 0.9);
    this.scene.add(hemi);
    // Low sun out of the northwest: it rakes the masked (corridor) side of
    // the ridges, so the money shot's rock face is lit, not a silhouette.
    const sun = new THREE.DirectionalLight(0xffe0b8, 2.2);
    sun.position.set(-500, 550, -600);
    this.scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(12_000, 12_000),
      new THREE.MeshStandardMaterial({ color: COL.ground, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.5;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(12_000, 240, COL.grid, COL.grid);
    grid.position.y = -0.4;
    this.scene.add(grid);
    // Fine 2 km grid so the ground reads at deck height.
    const fine = new THREE.GridHelper(12_000, 1_200, 0x18243a, 0x18243a);
    fine.position.y = -0.45;
    this.scene.add(fine);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  private resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Real heightfield terrain, displaced from the SAME data the sim's LOS
   * ray-marches — the fjord arm that hides you on the map is the fjord arm
   * you fly down here. Same ×ALT vertical exaggeration as unit altitudes.
   */
  private buildHeightfieldMesh(hf: Heightfield): void {
    const w = hf.width;
    const h = hf.height;
    const positions = new Float32Array(w * h * 3);
    const colors = new Float32Array(w * h * 3);
    const low = new THREE.Color(0x1a2434);
    const mid = new THREE.Color(0x3c4c66);
    const high = new THREE.Color(0x9aa2b2);
    const c = new THREE.Color();
    for (let r = 0; r < h; r++) {
      for (let col = 0; col < w; col++) {
        const i = r * w + col;
        const elev = hf.data[i]!;
        positions[i * 3] = (hf.originX + col * hf.cellSize) * S;
        positions[i * 3 + 1] = Math.max(elev, 0) * S * ALT;
        positions[i * 3 + 2] = -(hf.originY + r * hf.cellSize) * S;
        const t = Math.min(1, elev / 1_900);
        if (t < 0.35) c.lerpColors(low, mid, t / 0.35);
        else c.lerpColors(mid, high, (t - 0.35) / 0.65);
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
      }
    }
    const indices: number[] = [];
    for (let r = 0; r < h - 1; r++) {
      for (let col = 0; col < w - 1; col++) {
        const a = r * w + col;
        indices.push(a, a + w, a + 1, a + 1, a + w, a + w + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: false }),
    );
    mesh.userData.staticScenery = true;
    this.scene.add(mesh);
  }

  /** Ridges and site rings never move — build them once per mission. */
  private buildStatic(state: SimState): void {
    if (this.staticBuilt) return;
    this.staticBuilt = true;

    const hf = getTerrain(state.terrainId);
    if (hf) this.buildHeightfieldMesh(hf);

    for (const ridge of state.ridges ?? []) {
      const dx = ridge.x2 - ridge.x1;
      const dy = ridge.y2 - ridge.y1;
      const length = Math.hypot(dx, dy) * S;
      const height = ridge.height * S * ALT;
      // Keep the footprint tight: the masked corridor in strike-escalation
      // runs ~1.2 km from the crest line, and the flight path (and chase
      // camera) must stay outside the rock.
      const halfBase = 900 * S;

      // Tent-prism cross-section, extruded along the crest line.
      const shape = new THREE.Shape();
      shape.moveTo(-halfBase, 0);
      shape.lineTo(0, height);
      shape.lineTo(halfBase, 0);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false });
      geo.translate(0, 0, -length / 2);
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ color: COL.ridge, roughness: 0.95, flatShading: true }),
      );
      const mid = toScene({ x: (ridge.x1 + ridge.x2) / 2, y: (ridge.y1 + ridge.y2) / 2, alt: 0 });
      mesh.position.set(mid.x, 0, mid.z);
      // Extrusion runs along +z; yaw it onto the crest bearing. World (dx,dy)
      // becomes scene (dx, -dy), and rotation.y maps +z to (sinα, 0, cosα),
      // so α = atan2(dx, -dy).
      mesh.rotation.y = Math.atan2(dx, -dy);
      mesh.userData.staticScenery = true;
      this.scene.add(mesh);

      // Crest line for readability against the dark ground.
      const a = toScene({ x: ridge.x1, y: ridge.y1, alt: ridge.height });
      const b = toScene({ x: ridge.x2, y: ridge.y2, alt: ridge.height });
      const crest = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([a, b]),
        new THREE.LineBasicMaterial({ color: COL.ridgeCrest }),
      );
      crest.userData.staticScenery = true;
      this.scene.add(crest);
    }

    // Engagement rings for RED shooters (position updates each frame for
    // scooting batteries; geometry is fixed).
    for (const u of Object.values(state.units)) {
      if (u.side !== 'RED') continue;
      for (const st of u.weapons) {
        const w = state.weaponCatalog[st.weaponId];
        if (!w || w.kind !== 'SAM' || w.maxRange < 10_000) continue;
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 96; i++) {
          const a = (i / 96) * Math.PI * 2;
          pts.push(new THREE.Vector3(Math.cos(a) * w.maxRange * S, 0.2, Math.sin(a) * w.maxRange * S));
        }
        const ring = new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: COL.ringLive, transparent: true, opacity: 0.6 }),
        );
        this.rings.set(u.id, ring);
        this.scene.add(ring);
        break;
      }
    }
  }

  private makeUnitMesh(u: Unit): THREE.Object3D {
    const color = u.side === 'BLUE' ? COL.blue : COL.red;
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.55,
      // Units glow slightly so they read against terrain at cinematic ranges.
      emissive: color,
      emissiveIntensity: 0.35,
    });
    let obj: THREE.Object3D;
    if (u.domain === 'AIR' && u.maxSpeed < 120) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(1.0, 12, 8), mat);
      body.scale.set(1.6, 0.7, 0.7);
      const rotor = new THREE.Mesh(
        new THREE.CylinderGeometry(2.0, 2.0, 0.1, 16),
        new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.35 }),
      );
      rotor.position.y = 1;
      g.add(body, rotor);
      obj = g;
    } else if (u.domain === 'AIR') {
      // Simple delta: a flattened cone pointing +x before yaw.
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1.1, 3.6, 4), mat);
      cone.rotation.z = -Math.PI / 2;
      cone.scale.set(1, 1, 0.4);
      const g = new THREE.Group();
      g.add(cone);
      obj = g;
    } else if (u.domain === 'SEA') {
      const hull = new THREE.Mesh(new THREE.BoxGeometry(5, 1.2, 1.4), mat);
      const mast = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 0.6), mat);
      mast.position.y = 1.4;
      const g = new THREE.Group();
      g.add(hull, mast);
      obj = g;
    } else {
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.1, 2.6), mat);
      g.add(base);
      if (u.sensors.some((s) => s.kind === 'RADAR')) {
        const dish = new THREE.Mesh(new THREE.ConeGeometry(1.0, 1.8, 8), mat);
        dish.position.y = 1.5;
        g.add(dish);
      }
      obj = g;
    }
    return obj;
  }

  /**
   * Screen-constant-size name tag, built once per unit and cached. Colored
   * by side to match the unit mesh; `depthTest: true` + `fog: true` (the
   * SpriteMaterial defaults) mean it is occluded by terrain and fades with
   * distance exactly like the mesh it labels — a unit hidden behind a masked
   * ridge never has a name floating above the rock.
   */
  private makeLabelSprite(u: Unit): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const color = u.side === 'BLUE' ? '#4da3ff' : '#ff5f56';
    ctx.fillStyle = 'rgba(6, 9, 14, 0.75)';
    ctx.fillRect(0, 12, 256, 40);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 13, 254, 38);
    ctx.fillStyle = '#eef3fa';
    ctx.font = '600 24px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(u.name, 128, 33, 240);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({
      map: texture,
      sizeAttenuation: false,
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    // Tuned for this camera (fov 55): reads as a compact tag at cinematic
    // ranges without dominating the frame at chase-cam close-ups.
    sprite.scale.set(0.13, 0.0325, 1);
    return sprite;
  }

  /** Vertical clearance above a unit mesh so the tag sits clear of the model. */
  private static readonly LABEL_LIFT = 2.4;

  private headingOf(u: Unit, prev: SimState | null): number {
    const before = prev?.units[u.id];
    if (before && (before.pos.x !== u.pos.x || before.pos.y !== u.pos.y)) {
      return Math.atan2(u.pos.y - before.pos.y, u.pos.x - before.pos.x);
    }
    const wp = u.waypoints[0];
    if (wp) return Math.atan2(wp.y - u.pos.y, wp.x - u.pos.x);
    return u.side === 'BLUE' ? 0 : Math.PI;
  }

  render(state: SimState, prev: SimState | null, mode: CameraMode): void {
    this.buildStatic(state);

    // ---- units ----
    for (const u of Object.values(state.units)) {
      let mesh = this.unitMeshes.get(u.id);
      if (!mesh) {
        mesh = this.makeUnitMesh(u);
        this.unitMeshes.set(u.id, mesh);
        this.scene.add(mesh);
      }
      const p = toScene(u.pos);
      mesh.position.copy(p);
      mesh.rotation.y = this.headingOf(u, prev);
      if (!u.alive) {
        mesh.position.y = 0.3;
        mesh.scale.setScalar(0.8);
        mesh.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
          if (m?.color) m.color.setHex(COL.gray);
        });
      }

      let label = this.labelSprites.get(u.id);
      if (!label) {
        label = this.makeLabelSprite(u);
        this.labelSprites.set(u.id, label);
        this.scene.add(label);
      }
      label.position.set(p.x, p.y + Replay3D.LABEL_LIFT, p.z);
      // Never label what isn't drawn: wreckage keeps its (recolored) mesh but
      // drops the tag so the scene declutters as a strike develops.
      label.visible = u.alive;
    }

    // ---- engagement rings follow their batteries ----
    for (const [id, ring] of this.rings) {
      const u = state.units[id];
      if (!u || !u.alive) {
        ring.visible = false;
        continue;
      }
      const p = toScene(u.pos);
      ring.position.set(p.x, 0.2, p.z);
      const down = isSuppressed(u, state.tick) || !u.sensors.some((s) => s.kind === 'RADAR' && s.emitting);
      (ring.material as THREE.LineBasicMaterial).color.setHex(down ? COL.ringDown : COL.ringLive);
    }

    // ---- missiles ----
    const liveMissiles = new Set<string>();
    for (const m of Object.values(state.missiles)) {
      if (!m.alive) continue;
      liveMissiles.add(m.id);
      let mesh = this.missileMeshes.get(m.id);
      if (!mesh) {
        const color = m.side === 'BLUE' ? COL.missileBlue : COL.missileRed;
        const g = new THREE.Group();
        g.add(
          new THREE.Mesh(
            new THREE.SphereGeometry(0.6, 8, 6),
            new THREE.MeshBasicMaterial({ color }),
          ),
        );
        const streak = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
          new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 }),
        );
        streak.name = 'streak';
        g.add(streak);
        this.missileMeshes.set(m.id, g);
        this.scene.add(g);
        mesh = g;
      }
      const p = toScene(m.pos);
      mesh.position.copy(p);
      const prevPos = prev?.missiles[m.id]?.pos ?? m.pos;
      const pp = toScene(prevPos).sub(p);
      const streak = mesh.getObjectByName('streak') as THREE.Line;
      streak.geometry.setFromPoints([new THREE.Vector3(), pp.multiplyScalar(2.5)]);
    }
    for (const [id, mesh] of this.missileMeshes) {
      if (!liveMissiles.has(id)) {
        this.scene.remove(mesh);
        this.missileMeshes.delete(id);
      }
    }

    this.scanForPings(state);
    this.updatePings();

    const resolvedMode = mode === 'director' ? directorPick(state, state.events) : mode;
    this.lastResolvedMode = resolvedMode;
    this.updateCamera(state, prev, resolvedMode);
    this.renderer.render(this.scene, this.camera);
  }

  /** The concrete shot actually in effect this frame (director-resolved, if applicable). */
  get currentShot(): CameraMode {
    return this.lastResolvedMode;
  }

  /** Spawn a ping for any LAUNCH/HIT/EMITTER_SHUTDOWN event new since the last render. */
  private scanForPings(state: SimState): void {
    const events = state.events;
    // Scrubbing back shrinks the history — don't replay it as a ping burst.
    if (events.length < this.pingEventCursor) this.pingEventCursor = events.length;
    for (let i = this.pingEventCursor; i < events.length; i++) {
      const e = events[i]!;
      switch (e.type) {
        case 'LAUNCH': {
          const u = state.units[e.shooterId];
          if (u) this.spawnPing(toScene(u.pos));
          break;
        }
        case 'HIT': {
          const u = state.units[e.targetId];
          if (u) this.spawnPing(toScene(u.pos));
          break;
        }
        case 'EMITTER_SHUTDOWN': {
          const u = state.units[e.unitId];
          if (u) this.spawnPing(toScene(u.pos));
          break;
        }
      }
    }
    this.pingEventCursor = events.length;
  }

  private spawnPing(worldPos: THREE.Vector3): void {
    const material = new THREE.LineBasicMaterial({ color: COL.ping, transparent: true, opacity: 0.9 });
    const ring = new THREE.LineLoop(pingRingGeometry, material);
    ring.position.copy(worldPos);
    ring.scale.setScalar(PING_MIN_RADIUS);
    this.scene.add(ring);
    this.pings.push({ obj: ring, bornAt: performance.now() });
  }

  /** Age, expand, and fade active pings; drop them 0.8 s after they spawn. */
  private updatePings(): void {
    const now = performance.now();
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const ping = this.pings[i]!;
      const t = (now - ping.bornAt) / PING_LIFE_MS;
      if (t >= 1) {
        this.scene.remove(ping.obj);
        (ping.obj.material as THREE.Material).dispose();
        this.pings.splice(i, 1);
        continue;
      }
      const radius = PING_MIN_RADIUS + t * (PING_MAX_RADIUS - PING_MIN_RADIUS);
      ping.obj.scale.setScalar(radius);
      (ping.obj.material as THREE.LineBasicMaterial).opacity = 0.9 * (1 - t);
    }
  }

  /** Slow orbit around the live action (missiles first, else units) — the idle/fallback shot. */
  private overviewShot(state: SimState): [THREE.Vector3, THREE.Vector3] {
    const pts: THREE.Vector3[] = [];
    for (const m of Object.values(state.missiles)) if (m.alive) pts.push(toScene(m.pos));
    if (pts.length === 0) {
      for (const u of Object.values(state.units)) if (u.alive) pts.push(toScene(u.pos));
    }
    const center = pts.length
      ? pts.reduce((a, b) => a.add(b), new THREE.Vector3()).divideScalar(pts.length)
      : new THREE.Vector3();
    let radius = 250;
    for (const p of pts) radius = Math.max(radius, center.distanceTo(p) * 1.2);
    radius = Math.min(radius, 1_400);
    this.orbitAngle += 0.0012;
    const wantPos = new THREE.Vector3(
      center.x + Math.cos(this.orbitAngle) * radius,
      radius * 0.55,
      center.z + Math.sin(this.orbitAngle) * radius,
    );
    return [wantPos, center];
  }

  /** Tighter orbit around a single fixed point — the event-location shot. */
  private orbitPointShot(center: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
    const radius = 380;
    this.orbitAngle += 0.0025;
    const wantPos = new THREE.Vector3(
      center.x + Math.cos(this.orbitAngle) * radius,
      radius * 0.5,
      center.z + Math.sin(this.orbitAngle) * radius,
    );
    return [wantPos, center];
  }

  private updateCamera(state: SimState, prev: SimState | null, mode: CameraMode): void {
    let wantPos: THREE.Vector3;
    let wantTarget: THREE.Vector3;

    const chaseId = mode.startsWith('chase:') ? mode.slice(6) : null;
    const chased = chaseId ? state.units[chaseId] : null;
    const orbitId = mode.startsWith('orbit:') ? mode.slice(6) : null;
    const orbitUnit = orbitId ? state.units[orbitId] : null;

    if (chased?.alive) {
      // The money shot: sit behind and slightly above, look through the
      // aircraft toward where it's going. On the deck run the camera is at
      // ~vine height while the ridge fills the frame.
      const heading = this.headingOf(chased, prev);
      const fwd = new THREE.Vector3(Math.cos(heading), 0, -Math.sin(heading));
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const p = toScene(chased.pos);
      // Oblique chase: behind, low, and offset to the right of track, so a
      // deck run reads with depth — ground rushing under the jet, the
      // exaggerated crest (450 m → 13.5 scene units) towering on one side.
      wantPos = p
        .clone()
        .addScaledVector(fwd, -3_200 * S)
        .addScaledVector(right, -1_400 * S)
        .add(new THREE.Vector3(0, 2.4, 0));
      wantTarget = p.clone().addScaledVector(fwd, 3_500 * S).add(new THREE.Vector3(0, 0.8, 0));
    } else if (mode === 'ground' && state.groundOp) {
      // Frame the ground team and their extraction helicopter together.
      const team = state.units[state.groundOp.teamUnitId];
      const helo = state.units[state.groundOp.heloUnitId];
      const pts = [team, helo].filter((u): u is Unit => !!u).map((u) => toScene(u.pos));
      if (pts.length) {
        const center = pts.reduce((a, b) => a.add(b), new THREE.Vector3()).divideScalar(pts.length);
        let radius = 220;
        for (const p of pts) radius = Math.max(radius, center.distanceTo(p) * 1.6);
        radius = Math.min(radius, 900);
        this.orbitAngle += 0.0025;
        wantPos = new THREE.Vector3(
          center.x + Math.cos(this.orbitAngle) * radius,
          radius * 0.5,
          center.z + Math.sin(this.orbitAngle) * radius,
        );
        wantTarget = center;
      } else {
        [wantPos, wantTarget] = this.overviewShot(state);
      }
    } else if (orbitUnit) {
      [wantPos, wantTarget] = this.orbitPointShot(toScene(orbitUnit.pos));
    } else {
      [wantPos, wantTarget] = this.overviewShot(state);
    }

    this.camPos.lerp(wantPos, 0.08);
    this.camTarget.lerp(wantTarget, 0.12);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
  }

  /** Reset per-mission scene content (e.g. after scenario change). */
  resetScene(): void {
    for (const mesh of this.unitMeshes.values()) this.scene.remove(mesh);
    for (const mesh of this.missileMeshes.values()) this.scene.remove(mesh);
    this.unitMeshes.clear();
    this.missileMeshes.clear();
    for (const ring of this.rings.values()) this.scene.remove(ring);
    this.rings.clear();
    for (const label of this.labelSprites.values()) {
      this.scene.remove(label);
      label.material.map?.dispose();
      label.material.dispose();
    }
    this.labelSprites.clear();
    for (const ping of this.pings) {
      this.scene.remove(ping.obj);
      (ping.obj.material as THREE.Material).dispose();
    }
    this.pings.length = 0;
    this.pingEventCursor = 0;
    // Ridges are cheap; rebuild them with the next render call.
    this.staticBuilt = false;
    const toRemove = this.scene.children.filter((c) => c.userData.staticScenery);
    for (const c of toRemove) this.scene.remove(c);
  }
}
