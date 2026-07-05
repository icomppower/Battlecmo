# Battlecmo — Overwatch Directive

Deterministic multi-domain strike/rescue C2 simulation (CMO-style wargame). This repo implements the design doc's build order, starting with **step 1: the headless deterministic tick core** — sensors, weapons envelopes, EW/SEAD, fuel, and ROE — tested against a single strike scenario.

> **Design doc:** *Overwatch Directive — Multi-Domain Hostage Rescue C2 Sim* (Notion). Same universe and tick philosophy as Breach Protocol: the ground team owns everything below the rooftop; this game owns everything above it.

## The core contract

```
tick(state, ordersLog, seed) → state
```

One tick = one second of mission time. The tick function is **pure**: no wall clock, no unseeded randomness, no hidden globals. Random draws are order-independent hashes of `(seed, tick, tags…)`, so identical inputs produce byte-identical states. That one property buys, for free:

- **Replay** — any mission is fully reproduced from initial state + orders log + seed.
- **Planning layer** — pre-scheduled order logs are just plans; scrub them against the sim.
- **Executive layer (WEGO)** — pause/replan at any tick; stepping and straight runs are provably identical (see `tests/determinism.test.ts`).

## Domain layers (src/core/)

| Module | What it models |
|---|---|
| `sensors.ts` | Radar-equation RCS scaling (4th-root), radar horizon masking, jamming degradation, track quality build/decay. Detection is deterministic geometry — you fight what your sensors hold, and you can reason about coverage in planning. |
| `weapons.ts` | Engagement **envelopes** per weapon-target pair (range band, target-altitude band, domain), not a generic "attack" action. Full launch validation with typed denial reasons. |
| `tick.ts` | The tick pipeline: orders → movement/fuel → ARM reactions → missile flight → contacts → defensive engagements. Includes the SEAD mechanic: an inbound anti-radiation missile forces an emitter dark for a doctrine window; a dark radar can't guide, and the ARM loses most of its Pk against it — *suppression, not destruction, is the product*. |
| `rng.ts` | Seeded, order-independent random streams (randomness is reserved for weapon endgames). |
| `types.ts` | The full state/orders/events data model, including ROE authority levels (`HOLD` / `TIGHT` / `FREE`) and pre-briefed target lists. |

## Reference scenario (src/scenarios/strike-basic.ts)

One BLUE strike package (2 strikers with standoff AGMs, 1 SEAD shooter with ARMs, 1 standoff jammer) against a static RED IADS (early-warning radar, long-range SAM battery, and the objective — a C2 node). The geometry deliberately places the AGM release ring *inside* the SAM engagement ring, so the mission only works if the jamming window and SEAD shot open a suppression corridor first.

`tests/scenario-strike.test.ts` proves the doctrine:

- the sequenced plan (jam → SEAD window → dash → release → egress) destroys the objective with zero losses and zero SAM launches;
- the naive plan loses aircraft;
- jamming alone delays detection but does not stop the engagement;
- ROE `HOLD` blocks a perfect firing solution, and `TIGHT` denies targets missing from the brief.

## Running

```sh
npm install
npm test          # vitest
npm run typecheck # tsc --noEmit
```

## Roadmap (from the design doc's build order)

1. ✅ Deterministic multi-domain tick core (headless), tested against a single strike scenario
2. Executive Version UI on one hand-made scenario: 1 strike package vs. a static IADS
3. EW/jamming + SEAD sequencing + adaptive SAM behavior
4. Ground extraction tie-in (Breach Protocol roster/timer import)
5. Planning Version UI: OOB assembly, ROE authoring, mission clock sync
6. Nemesis IADS adaptation + persistent squadron roster
7. Cinematic replay via the battle-documentary engine fork, campaign shell
