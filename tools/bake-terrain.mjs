/**
 * One-time terrain bake: fetch real elevation (AWS Open Data terrarium tiles,
 * SRTM-derived, public domain hosting) for a bounding box and resample it
 * into the sim's flat local-meters grid as a committed TypeScript module.
 *
 * The sim never touches the network — this script runs at authoring time and
 * the quantized Int16 heightfield is committed, so the deterministic core
 * stays pure and offline.
 *
 * Usage: node tools/bake-terrain.mjs
 */
import { PNG } from 'pngjs';
import { writeFileSync } from 'node:fs';

// ---- Romsdal, Norway: sea-level fjords under ~1500 m walls ----
const NAME = 'romsdal';
const LAT0 = 62.55; // box center
const LON0 = 7.65;
const BOX_KM = 110; // square box edge, km
const GRID = 128; // output grid cells per side
const ZOOM = 10;

const M_PER_DEG_LAT = 110_540;
const mPerDegLon = 111_320 * Math.cos((LAT0 * Math.PI) / 180);

function tileXY(lat, lon, z) {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

async function fetchTile(z, tx, ty) {
  const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${tx}/${ty}.png`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return PNG.sync.read(buf);
}

// Bounding box in degrees.
const halfLat = (BOX_KM * 500) / M_PER_DEG_LAT;
const halfLon = (BOX_KM * 500) / mPerDegLon;
const latMax = LAT0 + halfLat;
const latMin = LAT0 - halfLat;
const lonMin = LON0 - halfLon;
const lonMax = LON0 + halfLon;

const tl = tileXY(latMax, lonMin, ZOOM);
const br = tileXY(latMin, lonMax, ZOOM);
const txMin = Math.floor(tl.x);
const txMax = Math.floor(br.x);
const tyMin = Math.floor(tl.y);
const tyMax = Math.floor(br.y);

console.log(`tiles x ${txMin}..${txMax}, y ${tyMin}..${tyMax} (${(txMax - txMin + 1) * (tyMax - tyMin + 1)} tiles)`);

const tiles = new Map();
for (let tx = txMin; tx <= txMax; tx++) {
  for (let ty = tyMin; ty <= tyMax; ty++) {
    tiles.set(`${tx}/${ty}`, await fetchTile(ZOOM, tx, ty));
    console.log(`fetched ${tx}/${ty}`);
  }
}

/** Elevation in meters at (lat, lon) via the terrarium mosaic (nearest px). */
function elevationAt(lat, lon) {
  const { x, y } = tileXY(lat, lon, ZOOM);
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  const png = tiles.get(`${tx}/${ty}`);
  if (!png) return 0;
  const px = Math.min(255, Math.floor((x - tx) * 256));
  const py = Math.min(255, Math.floor((y - ty) * 256));
  const i = (py * 256 + px) * 4;
  const h = png.data[i] * 256 + png.data[i + 1] + png.data[i + 2] / 256 - 32768;
  return h;
}

// Resample into the local-meters grid. World origin = box center; grid [0][0]
// is the SOUTH-WEST corner; rows go north (+y), columns go east (+x).
const cellSize = (BOX_KM * 1000) / (GRID - 1);
const originX = -(BOX_KM * 1000) / 2;
const originY = -(BOX_KM * 1000) / 2;
const data = new Int16Array(GRID * GRID);
let maxH = 0;
for (let row = 0; row < GRID; row++) {
  for (let col = 0; col < GRID; col++) {
    const wx = originX + col * cellSize;
    const wy = originY + row * cellSize;
    const lat = LAT0 + wy / M_PER_DEG_LAT;
    const lon = LON0 + wx / mPerDegLon;
    const h = Math.max(0, Math.round(elevationAt(lat, lon)));
    data[row * GRID + col] = h;
    if (h > maxH) maxH = h;
  }
}
console.log(`max elevation in box: ${maxH} m`);

const b64 = Buffer.from(new Uint8Array(data.buffer)).toString('base64');
const out = `/**
 * Real terrain: ${NAME} (Romsdal coast, Norway) — SRTM-derived elevations
 * resampled from AWS Open Data terrarium tiles (zoom ${ZOOM}) into the sim's
 * flat local grid by tools/bake-terrain.mjs. Committed data; the sim and the
 * game never touch the network. Box center ${LAT0}°N ${LON0}°E, ${BOX_KM} km
 * square, ${GRID}×${GRID} cells (${Math.round(cellSize)} m/cell), max ${maxH} m.
 *
 * Generated file — re-run the bake script to regenerate. Do not hand-edit.
 */
import type { Heightfield } from '../core/terrain';

const B64 =
  '${b64.replace(/(.{100})/g, "$1' +\n  '")}';

function decode(): Int16Array {
  const bin = atob(B64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

export const ROMSDAL: Heightfield = {
  name: '${NAME}',
  originX: ${originX},
  originY: ${originY},
  cellSize: ${cellSize},
  width: ${GRID},
  height: ${GRID},
  data: decode(),
};
`;
writeFileSync(`src/terrain/${NAME}.ts`, out);
console.log(`wrote src/terrain/${NAME}.ts (${Math.round(out.length / 1024)} KB)`);
