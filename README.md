# Battlecmo — Overwatch Directive

Deterministic multi-domain strike/rescue C2 simulation (CMO-style wargame). This repo implements the design doc's build order, starting with **step 1: the headless deterministic tick core** — sensors, weapons envelopes, EW/SEAD, fuel, and ROE — tested against a single strike scenario.

**▶ Play it:** https://icomppower.github.io/Battlecmo/ (deployed from the `gh-pages` branch; redeploy with `npm run build:pages` and push `dist/` there)

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
- **Planner (step 5)**: the order log *is* the plan. Load a preset (every plan from the test suite), author orders with a time offset ("issue at now + N s"), delete scheduled orders — deleting one invalidates only the cached future from its tick — and **RUN ►►** scrubs the whole plan to the end instantly for review on the timeline.
- **Mission Builder (OOB/loadout assembly)**: drag airframes from the hangar into the strike package and stores from the armory onto each jet's hardpoints. Loadouts are tradeoffs, not upgrades — every store costs stations, adds RCS (priced by the same radar equation the IADS uses), and adds drag against the bingo-fuel clock; the builder shows the computed numbers live and refuses to commit an overloaded wing. The committed package is swapped into any scenario via the pure `withBluePackage`, and the standard package reproduces the hand-built scenarios **byte-for-byte** (locked in by test), so the assembly path and the scripted path are provably the same sim.
- **Sensor-honest picture**: the default view shows your package, the briefed IADS sites, assessed detection rings (including your own jamming benefit), emitter up/down state (ESM is passive), and RWR `SPIKE` warnings. RED units you neither track nor were briefed on aren't plotted at all; APPROX/CONTESTED dossier ghosts wear dashed uncertainty rings until a sensor finds the real thing. RED's actual track quality on you is only visible in **TRUTH VIEW**.
- **Intel dossier**: every scenario ships a confidence-graded briefing (`VERIFIED`/`APPROX`/`CONTESTED` chips in the side panel). The grades are honest: the escalation scenario's CONTESTED ELINT fix on the enemy fighter is 17 km wrong, and the APPROX corvette has patrolled off its 6-hour-old fix by the time you get there.
- **Campaign**: fly a mission to its end, then **DEBRIEF & ADVANCE** — the nemesis IADS staff reads the engagement log and re-tunes doctrine (legible staff notes, every adaptation keyed to evidence you generated), your airframes log sorties and fatigue (tired pilots burn +4%/sortie more fuel), lost airframes stay lost, and the ground roster carries wounds forward. The next mission reset flies against the adapted world. The campaign persists in the browser (localStorage) across sessions; the Mission Builder refuses to commit a package containing an airframe LOST on a previous mission.

## Domains & terrain (post-v0.1)

- **Air-to-air**: `AAM` weapons with engagement floors; interceptors auto-engage through the same `validateLaunch`/ROE gates as SAMs. Fighters fly a deterministic CAP doctrine — hold station, commit on hostile air tracks inside the commit ring (pursuit curve, re-laid every tick), return to station when the track dies — and never commit on contacts below their missile floor, so they can't be baited into the dirt. The `strike-escalation` scenario posts a QRA fighter over the ingress lane; counter it with a passive IRST + AAM self-escort loadout from the Mission Builder (the kill track is built without radiating), or stay below its 100 m floor.
- **Naval (SEA domain)**: a missile corvette patrols the littoral with its own SAM ring; the `asm-pike` anti-ship missile kills it from standoff on the dossier's stale fix. Weapons envelopes were domain-generic from day one — the SEA domain is data, not new engine code.
- **Terrain masking**: ridge crest segments block line of sight for every sensor kind (deterministic segment-intersection geometry, drawn on the map). The escalation scenario's Koro ridge shelters a deck-level corridor from the whole IADS — but not from the fighter looking down, and the corvette patrols the same side of the crest.

## Roadmap (from the design doc's build order)

1. ✅ Deterministic multi-domain tick core (headless), tested against a single strike scenario
2. ✅ Executive Version UI on one hand-made scenario: 1 strike package vs. a static IADS
3. ✅ EW/jamming + SEAD sequencing + adaptive SAM behavior (EMCON, shoot-and-scoot, ARM-scare adaptation)
4. ✅ Ground extraction tie-in (Breach Protocol roster import, hostage clock, breach gating, MANPADS-vs-helo exfil)
5. ✅ Planning Version UI (order-log authoring, presets, timed orders, run-to-end scrubbing, drag-and-drop OOB/loadout assembly)
6. ✅ Nemesis IADS adaptation + persistent squadron roster (campaign module + in-game CAMPAIGN screen with between-mission debrief)
7. ✅ Cinematic replay & debrief (auto-camera replay + narrated INTSUM with intercept chatter; the 3D battle-documentary engine fork remains future work)

Post-v0.1 additions: air-to-air (AAM/CAP), naval domain (corvette + anti-ship missile), terrain masking (ridge LOS), confidence-graded intel dossier, campaign UI with squadron fatigue effects. Remaining future work: full-fidelity ground combat (deliberately parked in the design doc).

## ISR & the sensor war (src/oob — af-sentry; tests/isr.test.ts)

BLUE finally owns a real sensor picture: the E-9 Sentry (`af-sentry`) carries two apertures with designed limits — an air-search radar that sees only the air battle (245 km vs the CAP from tick 0), and a GMTI/SAR radar that sees only surface targets that are **moving** (`minTargetSpeed`). A battery parked in its hide stays invisible; a battery *displacing* after its salvo lights up for exactly the length of its march (`tests/isr.test.ts` pins the detection to the scoot window). ISR informs the hunt; it does not finish it.

The nemesis answers in kind: a surveillance radar that painted RED units is a one-way broadcast — ELINT hears it even through BLUE's own jamming — and the next mission's CAP flies **emitter hunt** doctrine, committing on radiating aircraft out to 1.6× its normal ring. A forward orbit dies at tick 0 and takes the air picture with it; a standoff orbit survives and keeps the whole picture. Passive IRST tracks leave no fingerprint, so the passive-escort play stays viable. Load the `sensor war` preset to fly it.

## Real terrain (src/core/terrain.ts, src/terrain/ — SRTM Romsdal)

The ridge abstraction grew up into a **heightfield LOS model**: `tools/bake-terrain.mjs` pulls real SRTM-derived elevations (AWS Open Data terrarium tiles) at authoring time and commits them as a quantized grid — the sim never touches the network, and the heightfield lives in a static registry (states carry only a `terrainId`), so WEGO clones stay cheap and replay stays byte-exact. Every sensor check ray-marches the same data both renderers draw: the 2D map's hypsometric underlay and the 3D view's displaced mesh **are** the LOS model. Altitude floors became height-over-ground (`aglOf`) — flat scenarios are bit-identical, but in terrain a 60 m valley hugger is genuinely under a 100 m engagement floor.

`strike-fjord` is the mission Norway wrote: the summit EW radar (a real 972 m coastal top) sees a high ingress ~90 km out, but a BFS over the masked-water cells of the actual elevation data found a 120 m corridor up Romsdalsfjorden ending 28 km from the fjord head — masked from **both** radars. The corridor plan (`fjordPlan`, waypoints straight from the BFS) kills the objective with *zero enemy detections all mission*: terrain denies the track, not the shot. Load the `fjord run` preset.

## 3D replay — phase 1 (web/replay3d.ts)

A read-only Three.js view over the same recorded states the 2D map and scrubber use — no orders, no picking, no separate simulation, and the `three` bundle loads lazily only when the **3D** toggle is hit. Terrain ridges are extruded to their real footprint with ×6 vertical exaggeration (applied equally to unit altitudes, so "under the radar" reads on screen), engagement rings live on the ground plane and grey out when the emitter is down, and two camera families ship: an auto-orbiting overview that follows the action, and per-aircraft chase cams. The deck run is the money shot: chase Hammer 2 through the Koro corridor at 60 m with the lit rock face towering to starboard and the SAM ring waiting on the far side.

Building this view caught a real plan bug the 2D map hid: the scripted corridor crossed the crest *line* mid-run — legal to the LOS model, but rock at 60 m. The route now parallels the crest on its masked side and rounds the northern tip, exactly matching the plan's fiction ("pops out inside the cue ring, below the engagement floor").
