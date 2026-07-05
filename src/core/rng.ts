/**
 * Deterministic, order-independent random streams.
 *
 * Instead of a single mutable PRNG (where call order changes results), every
 * random draw is a pure hash of (seed, tick, tags...). Two runs with the same
 * seed and the same simulation history produce byte-identical states, and
 * adding an unrelated draw elsewhere in the tick can never perturb this one.
 */

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mix(a: number, b: number): number {
  let h = (a ^ Math.imul(b, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Uniform float in [0, 1) derived purely from seed + tick + tags. */
export function roll(seed: number, tick: number, ...tags: (string | number)[]): number {
  let h = mix(seed >>> 0, tick >>> 0);
  for (const tag of tags) {
    h = mix(h, typeof tag === 'number' ? tag >>> 0 : fnv1a(tag));
  }
  return h / 0x100000000;
}
