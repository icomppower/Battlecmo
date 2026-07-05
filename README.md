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

## The full rescue (src/scenarios/rescue-op.ts)

Step 4 — the game's pitch in one scenario: Breach Protocol's ground op behind an integrated air defense, everything on one mission clock.

- The imported **Breach Protocol roster** (`breach-roster.ts`) rides a ground-op phase machine: STAGED → INFIL → AT_TARGET → BREACHING → SECURED → EXFIL → EXTRACTED (or COMPROMISED). The roster is handed back after the mission — sorties logged, losses marked — for the other game's campaign layer.
- **The strike is the go-code**: `GROUND_BREACH` is refused (`ALARM_NET_UP`) until the C2 node is destroyed, and the **hostage clock** expires the site if the breach doesn't come in time. A missed SEAD window delays the strike, delays the breach, and the clock does not care.
- **The exfil is air-war-shaped**: a MANPADS team owns the low-level airspace over the site. The big SAM can't touch the nap-of-the-earth helicopter — the MANPADS can, so the strike package has to spend weapons on it or the extraction dies at the LZ (`tests/ground-op.test.ts` proves both outcomes).

## Campaign & nemesis (src/campaign/campaign.ts)

Step 6 — the nemesis never cheats *inside* a mission; it adapts *between* them, by reading the engagement log the way an air-defense staff would. Every inference is keyed to observable evidence, so the player can predict and pre-empt it:

- Radiated with no engageable target in the basket ⇒ **ignore cues below 120 m** (kills the bait trick).
- Got jammed ⇒ **frequency-agility kits** (`jamResistance` — jamming strength partially shrugged off).
- Survived ARM scares by blinking ⇒ **relight faster** (`shutdownDecay` drops).

`tests/campaign.test.ts` runs the loop end-to-end: the rescue plan wins mission 1, the nemesis adapts with legible staff notes, and the *same plan* in mission 2 loses a striker and the hostages — the squadron roster records the loss. Persistent airframes/pilots (sorties, fatigue, losses) and the ground roster carry across missions.

## Debrief & replay (src/replay/debrief.ts)

Step 7, scoped to what this repo owns (the 3D battle-documentary engine fork stays a separate project): the deterministic core produces a complete ordered event log for free, so the **after-action report is a pure render of it** — mission summary, engagement statistics, the roster handback, and a narrated timeline with generated RED-side intercept chatter («Seeker in the air — dark, dark, dark. Everybody down.»). In the UI, **DEBRIEF** opens the report and **▶ REPLAY** re-runs the recorded mission with an auto-tracking cinematic camera and event captions — same states, zero re-simulation.

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
- **Orders**: click to select, right-click for waypoints (shift appends), ROE authority buttons, jammer toggle, RTB, ground-op phase buttons, and per-weapon engage buttons that are pre-validated against the same `validateLaunch` the sim uses (a disabled button tells you *why* — `OUT_OF_ENVELOPE`, `ROE_HOLD`, …).
- **Planner (step 5)**: the order log *is* the plan. Load a preset (every plan from the test suite), author orders with a time offset ("issue at now + N s"), delete scheduled orders — deleting one invalidates only the cached future from its tick — and **RUN ►►** scrubs the whole plan to the end instantly for review on the timeline. Full drag-and-drop OOB assembly is the remaining planning-layer gap.
- **Sensor-honest picture**: the default view shows your package, the briefed IADS sites, assessed detection rings (including your own jamming benefit), emitter up/down state (ESM is passive), and RWR `SPIKE` warnings. RED's actual track quality on you is only visible in **TRUTH VIEW**.

## Roadmap (from the design doc's build order)

1. ✅ Deterministic multi-domain tick core (headless), tested against a single strike scenario
2. ✅ Executive Version UI on one hand-made scenario: 1 strike package vs. a static IADS
3. ✅ EW/jamming + SEAD sequencing + adaptive SAM behavior (EMCON, shoot-and-scoot, ARM-scare adaptation)
4. ✅ Ground extraction tie-in (Breach Protocol roster import, hostage clock, breach gating, MANPADS-vs-helo exfil)
5. ✅ Planning Version UI (order-log authoring, presets, timed orders, run-to-end scrubbing; OOB assembly still open)
6. ✅ Nemesis IADS adaptation + persistent squadron roster (headless campaign module, fully tested)
7. ✅ Cinematic replay & debrief (auto-camera replay + narrated INTSUM with intercept chatter; the 3D battle-documentary engine fork remains future work)
