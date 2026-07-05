import type { Operator } from '../core/types';

/**
 * Imported Breach Protocol roster — the ground team as it left its last
 * mission in the other game. This is the interchange shape: Overwatch
 * Directive carries these operators through the extraction op and hands the
 * roster back (missions flown, wounds, losses) for Breach Protocol's
 * campaign layer to consume.
 */
export const BREACH_ROSTER: Operator[] = [
  { id: 'op-reyes', name: 'Reyes', status: 'OK', missions: 12 },
  { id: 'op-okafor', name: 'Okafor', status: 'OK', missions: 9 },
  { id: 'op-lindqvist', name: 'Lindqvist', status: 'OK', missions: 15 },
  { id: 'op-tan', name: 'Tan', status: 'OK', missions: 4 },
  { id: 'op-moreau', name: 'Moreau', status: 'WOUNDED', missions: 11 },
];

/** Deep-copy the roster so a mission never mutates the source-of-truth. */
export function importRoster(source: Operator[] = BREACH_ROSTER): Operator[] {
  return source.map((o) => ({ ...o }));
}
