# PlanGen Game — Status & Roadmap

> Consolidated status for the **game side** of PlanGen: the civ-style strategy
> **prototype** (`game/`) and the **economy sandbox + balance harness**
> (`game/toy/`). This is the single "where are we / where are we going" doc.
>
> **Companions (how-to reference, kept current):** [`game/README.md`](README.md)
> (playing the prototype), [`game/toy/README.md`](toy/README.md) (the economy
> sandbox + harness), [`game/toy/hex_economy_v2_spec.md`](toy/hex_economy_v2_spec.md)
> (the validated economy design). Dated history lives in
> [`docs/changelog.md`](../docs/changelog.md) (newest first). Map format:
> [`docs/game-export-format.md`](../docs/game-export-format.md).

---

## The north star

Build a civ-style strategy game whose **balance is tuned by AI**, on the real
worlds PlanGen generates. Two halves are converging on that goal:

1. **The prototype (`game/`)** — a full, playable civ game (cities, combat across
   three eras, supply, trade, diplomacy, AI opponents) where **every rule constant
   and AI weight is a live slider**, and every game emits a **structured replay
   log with machine-readable AI goals**. That log + the sliders are the substrate
   an AI tuner will eventually optimize over.

2. **The economy sandbox (`game/toy/`)** — a **Node-validated** von-Thünen economy
   (a conserved, food-eating workforce that sorts between subsistence farming,
   market farming and city work; organic cities; roads funded by tax→crews→
   garrisons) plus a **headless harness** that runs thousands of games on fixed
   maps and asks, per rule-set: does one strategy dominate (→ abstract it away),
   or do **population and wealth get won by different strategies** (→ a real
   wide-vs-tall choice worth keeping)? An outer-loop LLM reads the aggregate
   analysis to steer the next sweep (never in the per-turn loop — fatal latency).

**Why two:** the prototype's current economy is a fast, flow-based abstraction
(prices from supply/demand, merchant agents, city "wealth"); the sandbox is the
**economically-honest** model we want the prototype to eventually run on. The goal
is to **converge** them — the validated economy becomes the game's economy, and
the harness tells us which parameter regimes keep the game strategically
interesting.

---

## What's working

### `game/` — the civ prototype (playable end-to-end)
- Loads any PlanGen `plangen-game-map`; setup screen (2–8 human/AI slots, start
  picking, city-state independents + bandit camps on sparse maps).
- Cities claim/work territory, grow on food, build units/buildings; **three hard
  era shifts** (Classical → Napoleonic → WW2) each with a distinct roster and
  heavier logistics (food → +ammo → +fuel).
- Combat with **supply lines** (starve beyond range), **siege** artillery,
  **amphibious** landings, **airborne** paradrops, **carriers** as mobile
  airbases, configurable **ship/plane/carrier designs** with retooling.
- **Trade**: ten map-layer commodities, knowledge-gated crops, endogenous prices,
  auto-routed caravans/fleets, tolls, subsidies, crop spread, pirates/bandits.
- **Diplomacy**: two-sided deals (gold / tiles / whole cities / tribute / peace),
  AI valuation, extortion, proactive peace-buying.
- **AI** with editable personalities; **structured JSON replay log** (~2 KB/turn)
  capturing every AI goal — the balance-tuning foundation.
- Most wave-3.5+ dynamics sit behind **`GameConfig.features` flags** (keep-or-drop
  candidates): persistentOrders, unitStackLimit, edgeFortifications, timedEras,
  settlementMissions, recruitment, tilePopulation, policies, merchants, powerups.

### `game/toy/` — the economy sandbox + harness (Node-validated)
- **One shared engine** (`econ_engine.js`) runs **identically in Node and the
  browser** (verified). Conserved workforce, bisection solver (no fixed-step),
  Malthusian population capped by food, organic emergent cities, per-edge
  transport, tax→crew→garrison road economy.
- **Interactive sandboxes**: `hex_economy_v2.html` (fixed hex maps) and
  `planet_economy.html` (the game's default map — see below).
- **Balance harness**: `maps.js` (12 fixed maps) → `strategies.js` (6 archetypes)
  → `game_runner.js` → `harness.js` (parallel sweep) → `analyze.js` (classifies
  each rule-set DIVERGENT / DOMINANT / BROKEN / FLAT) → `llm_steer.js` (proposes
  the next sweep). **Five Node gates** guard it: `validate_core / layers / organic
  / transport / planet` (`npm run validate` — all green).
- **Finding so far:** with organic cities, **population is largely a map property**
  (food-capped carrying capacity) while **wealth stays the strategic lever**
  (roads / connectivity / tax) — so wide-vs-tall divergence now shows up mostly
  through wealth, and the strategy roster may need a rethink to regain population
  leverage.

### The bridge — economy on the game's **default map** (newest)
The sandbox economy now runs on the **same map the prototype plays**
(`maps/sample-map.json`), via `game_map_adapter.js`, using:
- **the map's baked bi-directional travel costs** (`moveCost`/`moveCostR`), charged
  in the toward-city direction so netback is real; impassable land walls off food
  transport, water stays a sea lane;
- **per-tile `calories` as food capacity** (median land ≈ the "farm" tier), coastal
  fishing from adjacent water;
- **strategic minerals carried inert** (displayed, not simulated — a deliberate
  deferral).

Cities arise three ways (seed `cityPriority` + grow / one bootstrap that
self-ignites / manual). It's wired into **both consumers** — the Node gate
(`npm run validate:planet`), the harness (`npm run sweep:planet`; the first sweep
classed every rule-set DIVERGENT: laissez-faire wins population, frontier wins
wealth), and the browser sandbox. Node and browser settle **identically**
(N≈488 520 / 32 cities on the sample map).

---

## What we're aiming for

The economy prototype is **~working**; the plan now is to run it as the game's
real economy **on the actual planet map** and tune it hard.

1. **Tune on the real map — find what breaks.** The immediate goal: run **massive
   batches of runs** on the default planet map to map out which parameter settings
   **break the game** — runaway/collapse/non-convergence, or degenerate regimes
   where one strategy dominates and choice disappears. The harness
   (`sweep_planet.json` → `analyze` → `steer`) is the instrument; break-finding at
   scale is the near-term objective.
2. **Converge the two economies.** Replace the prototype's flow-based trade
   abstraction (`trade.js` prices + merchants + city "wealth") with the
   **validated von-Thünen economy** on the same planet graph the game already
   uses. The bridge (adapter + baked-cost transport + calorie capacity) is the
   first half; the second is the game's cities/population **consuming the
   equilibrium** instead of the abstraction — plus the near-term mechanics (A–D)
   that make it a real, tunable game. **Classical era only for now** (D).
3. **Close the AI balance-tuning loop.** Feed the harness's DIVERGENT rule-sets
   (genuine strategic choices) and the prototype's replay logs into an outer-loop
   tuner that steers parameters toward "strategically interesting, not broken."

### Near-term build priorities (A–D)

- **A · Food storage / stockpiles.** A per-city (and per-tile) food stock rather
  than pure flow. Essential for modelling **sieges and combat** (a besieged city
  lives off stores), and a natural **damper on the dynamic economy's
  fluctuations** — likely subsumes the organic-city limit-cycle fix. Applies to
  both the toy economy and the prototype's flow-only trade.
- **B · Automatic road router.** Suggest road projects that **pay for themselves**
  (ROI-positive: the netback/throughput gain exceeds build + upkeep). The player
  auto-approves the suggestions or re-routes strategically. Builds on the existing
  city-pair road projects + `routeBetween`.
- **C · Walls + basic combat.** Walls (expensive, but necessary for security) and
  basic combat mechanics, integrated with the economy on the planet map (this is
  where food storage from A pays off — sieges).
- **D · Classical era only for now.** Hold the Napoleonic/WW2 era machinery; get
  the economy + basic combat working in the Classical era first.

---

## To-do

### Near-term (the current focus)
- [ ] **Massive break-finding sweeps on the planet map.** Scale the planet sweep
      far beyond the 72-game example; classify which parameter regimes break
      (runaway / collapse / non-convergence / single-strategy dominance) vs. stay
      strategically alive. Run `sweep_planet` → `analyze` → `steer` at volume.
- [ ] **A · Food storage / stockpiles.** Per-city (and per-tile) food stock, not
      pure flow — powers **sieges/combat** and **dampens the dynamic economy's
      swings** (expected to subsume the organic-city limit-cycle fix). Spans the
      toy economy and the prototype's flow-only trade.
- [ ] **B · Automatic road router.** Suggest **self-paying** road projects
      (ROI-positive), auto-approve or re-route by hand. Extends the city-pair
      projects + `routeBetween`.
- [ ] **C · Walls + basic combat.** Walls (expensive; security) + basic combat on
      the economy-driven planet map; sieges lean on A.
- [ ] **D · Classical era only for now.** Defer Napoleonic/WW2 era machinery until
      the economy + basic combat work in Classical.

### Economy backlog (`game/toy/`)
- [ ] **Regain population as a strategic lever.** Organic cities made population
      food-capped (strategy-invariant); rethink the strategy roster / knobs so
      *both* population and wealth can be won by different plays.
- [ ] **Organic-city limit cycle** (few-% oscillation on lush/high-urban maps) —
      *next fix if A doesn't cover it:* ramp a flipped tile's residual farmers to 0
      over the cooldown (gradual food shock). Clean sweeps still use
      `urbanize:false`.
- [ ] **Strategic resources in the economy** (currently inert): city-productivity
      bonus vs. a full second tradeable commodity.
- [ ] **Sea-cost knob** (`seaCostMult`): the sample map bakes very cheap ocean
      travel (~0.05 vs 1.0 per land hop); optional damping without touching land
      costs, if global sea-trade proves too strong.

### Civ prototype backlog (`game/`)
- [ ] **Pick the feature-flag keepers** (persistentOrders, unitStackLimit,
      edgeFortifications, timedEras, settlementMissions, recruitment,
      tilePopulation, policies, merchants, powerups) — drop what doesn't earn it.
- [ ] Deferred by (D) but noted: multi-era logistics, abstract amphibious
      transport, air fuel-range/escort, all-capture at HP 0, flow prices
      (superseded by A), 40-turn auto-peace, AI carrier aircraft.

### Integration / the bridge
- [ ] **Wire the validated economy into the game loop** — have `game/engine.js`
      cities/population derive from the toy equilibrium on the shared planet graph,
      not the flow abstraction. (Biggest item; the adapter + baked-cost transport
      are the groundwork.)
- [ ] **Feed the tuning loop** — connect harness verdicts + replay logs to an
      outer-loop (local-LLM) tuner.

---

## Load-bearing invariants (don't regress these)

From the economy's Node-first development — these caught real model-killers:

- **`p > α`** (Pareto concentration > agglomeration exponent) — *the* anti-runaway
  condition; below it cities explode. The collapsed "urban" slider enforces it.
- **Bisection, never fixed-step** on the shadow wage `w` and each city price — the
  anti-oscillation fix (fixed-step was the original megacity bug).
- **Subsistence floor is mandatory** — idle workers subsist-farm reachable land to
  break-even; without it low population → no demand → wage 0 → population craters.
- **Food is the numéraire**; `w` is the global reservation real wage (labor mobile).
- **Food produced ≈ food eaten every tick** — the conservation regression test.
- **The rectangular-hex path is bit-identical** — the planet generalization must
  never change the fixed-map numbers (guarded by the four original gates).
- **No RNG in the sim** — same map + params + strategy ⇒ identical results;
  reproducible sweeps are the whole point.

## Verify before trusting a change

- **Economy:** `cd game/toy && npm run validate` (all five gates), then
  `npm run sweep && npm run analyze` and read `out/sweep.analysis.md`.
- **Prototype:** headless via `preview_eval` — set
  `GameConfig.setup.humanPlayer = -1`, loop `endTurn()`, inspect `G.replay`/`G.log`
  (a full ~300-turn game ≈ 9 s). Static server caches JS — hard-refresh (or
  `fetch(f,{cache:'reload'})`) before `location.reload()`.
- **Browser renders:** screenshots time out (Page Visibility API pauses the
  renderer) — verify via `javascript_tool` eval / `gl.readPixels`.
