import type { SimState, Unit, WeaponDef } from '../src/core/types';
import { WEAPONS } from '../src/scenarios/strike-basic';

/** Minimal state builder for unit-level tests. */
export function miniState(
  units: Unit[],
  overrides: Partial<SimState> = {},
  weapons: Record<string, WeaponDef> = WEAPONS,
): SimState {
  return {
    tick: 0,
    units: Object.fromEntries(units.map((u) => [u.id, u])),
    missiles: {},
    contacts: { BLUE: {}, RED: {} },
    roe: { BLUE: 'FREE', RED: 'FREE' },
    prebriefedTargets: { BLUE: [], RED: [] },
    events: [],
    nextEntitySeq: 1,
    weaponCatalog: weapons,
    ...overrides,
  };
}

export function plane(id: string, side: 'BLUE' | 'RED', x: number, alt: number, extra: Partial<Unit> = {}): Unit {
  return {
    id,
    side,
    domain: 'AIR',
    name: id,
    pos: { x, y: 0, alt },
    speed: 0,
    maxSpeed: 300,
    rcs: 3,
    sensors: [],
    weapons: [],
    waypoints: [],
    alive: true,
    ...extra,
  };
}

export function radarSite(id: string, side: 'BLUE' | 'RED', x: number, baseRange: number, extra: Partial<Unit> = {}): Unit {
  return {
    id,
    side,
    domain: 'GROUND',
    name: id,
    pos: { x, y: 0, alt: 10 },
    speed: 0,
    maxSpeed: 0,
    rcs: 15,
    sensors: [{ id: `${id}-radar`, kind: 'RADAR', baseRange, refRcs: 5, emitting: true }],
    weapons: [],
    waypoints: [],
    alive: true,
    ...extra,
  };
}
