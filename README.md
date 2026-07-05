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

## Adaptive IADS (src/scenarios/strike-adaptive.ts)

Step 3 of the build order: the same order of battle, but the SAM battery fights back doctrinally — all deterministic state-machine behavior (`SamDoctrine` / `EmitterDoctrine`), which is exactly the surface the later nemesis system will tune between missions:

- **EMCON discipline** — the fire-control radar starts cold and lights up only when the IADS holds a contact inside its cue ring, going cold again when the cue ages out. A *pre-planned* ARM shot arrives at a silent radar: no scare, no suppression window, quarter Pk. `tests/adaptive.test.ts` proves the static scenario's winning plan gets both strikers killed here.
- **Shoot-and-scoot** — after its salvo the battery goes cold and displaces to a prepared fallback site; it cannot shoot on the march, and outside truth view the map keeps plotting it at the *briefed* position (BLUE has nothing in this package that would re-find it).
- **Crew adaptation** — each survived ARM scare shortens the next shutdown window (`shutdownDecay`), so repeated SEAD bluffs pay out less each time.

The proven counter (`baitAndBlinkPlan` in `tests/plans.ts`) is doctrinal, not just retimed: a striker ingresses at 60 m — *below* the SAM's 100 m minimum engagement altitude — to force a cue the battery can see but cannot shoot, the ARM launches reactively against the now-radiating emitter, and the second striker releases inside the blink window. Objective destroyed, zero losses, zero RED launches.

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
npm run dev       # Executive UI (Vite dev server)
npm run build     # static build to dist/
```

## Executive UI (web/)

CMO-style real-time/WEGO execution over the headless core — a 2D tactical map (Canvas, no framework) that imports the same `tick` the tests use.

- **Time compression**: pause / 1× / 4× / 15× / 60× / single-step, on one mission clock.
- **WEGO timeline**: every tick's state is cached, so the scrubber jumps anywhere instantly. Issuing an order while scrubbed back **rewrites the future** — cached states past the cursor are dropped and the sim recomputes forward with the amended order log. Determinism makes the untouched prefix byte-identical, so only the future changes.
- **Orders**: click to select, right-click for waypoints (shift appends), ROE authority buttons, jammer toggle, RTB, and per-weapon engage buttons that are pre-validated against the same `validateLaunch` the sim uses (a disabled button tells you *why* — `OUT_OF_ENVELOPE`, `ROE_HOLD`, …).
- **Sensor-honest picture**: the default view shows your package, the briefed IADS sites, assessed detection rings (including your own jamming benefit), emitter up/down state (ESM is passive), and RWR `SPIKE` warnings. RED's actual track quality on you is only visible in **TRUTH VIEW**.

## Roadmap (from the design doc's build order)

1. ✅ Deterministic multi-domain tick core (headless), tested against a single strike scenario
2. ✅ Executive Version UI on one hand-made scenario: 1 strike package vs. a static IADS
3. ✅ EW/jamming + SEAD sequencing + adaptive SAM behavior (EMCON, shoot-and-scoot, ARM-scare adaptation)
4. Ground extraction tie-in (Breach Protocol roster/timer import)
5. Planning Version UI: OOB assembly, ROE authoring, mission clock sync
6. Nemesis IADS adaptation + persistent squadron roster
7. Cinematic replay via the battle-documentary engine fork, campaign shell
