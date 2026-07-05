import * as THREE from 'three';
import type { SimState, Unit, Vec3 } from '../src/core/types';
import { isSuppressed } from '../src/core/sensors';

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
};

function toScene(p: Vec3): THREE.Vector3 {
  return new THREE.Vector3(p.x * S, Math.max(p.alt, 0) * S * ALT, -p.y * S);
}

export type CameraMode = 'overview' | `chase:${string}`;

export class Replay3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private unitMeshes = new Map<string, THREE.Object3D>();
  private missileMeshes = new Map<string, THREE.Object3D>();
  private rings = new Map<string, THREE.LineLoop>();
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

  /** Ridges and site rings never move — build them once per mission. */
  private buildStatic(state: SimState): void {
    if (this.staticBuilt) return;
    this.staticBuilt = true;

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

    this.updateCamera(state, prev, mode);
    this.renderer.render(this.scene, this.camera);
  }

  private updateCamera(state: SimState, prev: SimState | null, mode: CameraMode): void {
    let wantPos: THREE.Vector3;
    let wantTarget: THREE.Vector3;

    const chaseId = mode.startsWith('chase:') ? mode.slice(6) : null;
    const chased = chaseId ? state.units[chaseId] : null;

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
    } else {
      // Overview: slow orbit around the action (missiles first, else units).
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
      wantPos = new THREE.Vector3(
        center.x + Math.cos(this.orbitAngle) * radius,
        radius * 0.55,
        center.z + Math.sin(this.orbitAngle) * radius,
      );
      wantTarget = center;
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
    // Ridges are cheap; rebuild them with the next render call.
    this.staticBuilt = false;
    const toRemove = this.scene.children.filter((c) => c.userData.staticScenery);
    for (const c of toRemove) this.scene.remove(c);
  }
}
