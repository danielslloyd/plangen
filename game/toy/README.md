# Hex Economy v2 — sandbox + balance harness

> **Status & roadmap:** see [`game/STATUS.md`](../STATUS.md) for what's working,
> what we're aiming for, and the to-do list. This file is the how-to reference for
> the economy sandbox + harness.

A browser sandbox for the labor / wealth / roads economy that will feed the main
game, plus a headless harness that runs **thousands of test games** on fixed maps
to find which parameter settings keep genuine strategic choice and which break or
collapse to one optimal play.

The v2 economy replaces v1's non-convergent solver (the megacity bug) with the
Node-validated equilibrium from `hex_economy_v2_spec.md` §11: a conserved,
food-eating workforce that sorts between subsistence farming, market farming, and
city work; bisection (never fixed-step) on the shadow wage and each city price;
Malthusian population capped structurally by food. On top of that validated core
sit taxation → road crews → garrisons → incremental city-to-city road construction
→ gradual road decay (+ optional bandit tolls).

### Organic cities (wave 2)

Cities are no longer fixed points — they're **emergent**. Each tile is either
FARM (grows food) or URBAN (gold-work, **zero food**). A farm tile flips URBAN
when the city's **median wage** beats farming there — median, not the marginal
wage (which is pinned at the shadow wage `w`, so farm and city look identical at
the margin) and not aggregate output (O(millions), which would urbanize
everything). The median is O(1), comparable to a farmer's per-head value, and
**falls as a city grows** (`∝ N^(α−p)`), so city extent self-limits. Connected
urban tiles pool into **one** agglomerated city (Q1: nearby/connected cities
raise each other's productivity); player seeds kickstart, and new market towns
ignite organically in food-rich areas far from any city. Transport is now
per-edge (a fixed lognormal cost factor per tile-pair, so the cheapest path
isn't the fewest-hops one), and a road **multiplies** its edge cost by
`roadMult<1`, decaying back toward the overland cost when unfunded.

### Coasts, fishing, and randomness (wave 4)

- **Basin stickiness** (`basinHyst`). A farm tile ships to the city with the best
  delivered netback (price − transport). When two cities are near-tied the winner
  used to flip **every tick**; now a rival must beat the current basin by
  `basinHyst` (default 8%) to steal the tile. At rest this takes basin churn to
  **zero** (was ~800 switches/100 ticks across the catalog).
- **Harbours & sea travel** (`seaTravel`, `seaCostFrac`, `harborCost`,
  `harborWorkers`). A coastal urban tile is a **harbour**: it commits
  `harborWorkers` labourers and opens water routes. Transport may cross open water
  between harbours on the **same body of water** — each water-hex hop costs
  `seaCostFrac × (K0 × roadMult)`, and embark/disembark costs a fixed `harborCost`.
  (Whole-tile cross-water feeding stays rare — a far harbour's own city already
  claims its hinterland — so sea travel mainly connects cities and rescues a
  food-short coast.)
- **Fishing** (`fishPerSea`). A coastal tile gains **extra food capacity** per
  adjacent water tile, worked by fishermen with the *same* diminishing returns,
  labour pool, and marginal choice as farming — modelled as additive capacity
  `Cfood = farm C + fishCap`. A coastal **city** tile fishes too (it cannot farm,
  but it can fish), producing food that offsets its imports.
- **Yield randomness** (`yieldVar`). A per-tile multiplier (±`yieldVar`, default
  30%) on farm capacity and each sea tile's fishing yield, so identical terrain
  still varies. (Deterministic from the map seed. On a *uniformly* lush map this
  heterogeneity can aggravate the known over-urbanisation limit cycle — set
  `yieldVar:0` for the cleanest balance sweeps.)
- **City founding population** (`cityFoundPop`). Population is never created ex
  nihilo: **only the first city** seeds 1000 settlers into the pool (bootstrapping
  the world). Every later city — player-placed or an emergent organic core — draws
  its people from the existing pool via migration.
- **Subsistence = desperation farming** (`subsistenceShare`, default on). Instead of
  a separately-tracked self-feeding bucket, subsistence is now idle people piling
  onto land they can reach and working it — on the *same* production curve as market
  farmers — until the marginal worker's **net food is zero**. Mathematically the
  break-even room a tile still offers over its market labour `Lmkt` is
  `Lsub(C·e^(−Lmkt/κ))`, so total food (market + self-food) **can't exceed the
  tile's capacity** (the old model let a heavily-market-farmed tile also carry a
  full subsistence load, producing *above* capacity). Subsistence now concentrates
  on the under-served hinterland and self-limits where the land can't feed another
  mouth. `subsistenceShare:false` restores the legacy independent-curve model (used
  only for the reference port-fidelity check).

The sandbox hover overlay now shows a tile's farm vs fishing capacity, **market
food vs subsistence** separately (market output respects capacity — no more
"producing above capacity"), and, for a coastal city tile, its fishermen and fish
landed.

### Paving, harbours, roads, territory view (wave 5)

- **Paving is permanent** (`paved` flag). Once a tile has ever been urban its
  **farmland is gone for good** — if the city later sheds it, it reverts to barren
  (only fishing may remain). Paving no farm-food-shock removes the incentive to
  re-pave, which **eliminated the residual farm↔city oscillation** on lush maps
  (big-lush churn 99→1, fully-lush 47→0; realistic maps settle with zero swing).
  City *productivity* still reflects the site's original land quality (`siteC`, kept
  separate from the paved-over food capacity), so a city on rich land stays rich.
- **Emergent towns prefer harbours** (`coastalCoreBonus`). New-core site scoring
  used to weigh only local food; it ignored the coast entirely. A coastal (harbour)
  candidate now gets a score multiplier, so towns cluster on the shore (bonus
  0→0.6→1.5 gave 0→3→5 coastal cores on a symmetric test).
- **Roads you can actually buy.** A segment needs materials + a crew; idle spare
  labour works free, and any shortfall is **hired from the treasury at the public
  wage** — so a road builds whenever the treasury can afford it (it just costs more
  where labour is dear) and stalls (with a reason) only when the treasury is short.
  **Govt wages track the city wage** (gold per *city worker*, `wageShare × Y/cityN`),
  not the farmer-diluted per-capita average.
- **Territory view** (replaces Labor + Basins). Base = terrain colour; each city's
  colour **hatches the tiles it farms** (denser where farmed harder) and draws a
  **colour-coded outline around its basin**; city tiles are solid city colour.
- **Tile hover forecast.** Every tile's overlay ends with a couple of sentences in
  plain language describing what the next step's calculation will do to it (migrate
  farmers, pave into a crowded city, subsist to break-even, ship to which city, …).

## One engine, two consumers

`econ_engine.js` is the single source of truth. It runs **identically** in Node
(the harness) and the browser (the sandbox) — the sandbox and a Node game produce
the same numbers for the same inputs (verified). Everything else is built on it.

```
econ_engine.js        the economy (equilibrium + organic cities + tax/road/crew/garrison)
maps.js               deterministic fixed-map catalog (12 archetypes, per-map seed)
game_map_adapter.js   adapt the game's DEFAULT MAP (a plangen-game-map) -> engine graph spec
strategies.js         6 "civilizational strategy" archetypes (the player levers)
game_runner.js        run ONE game -> structured result row (+ health flags)
harness.js            parallel sweep runner (worker_threads) -> JSONL + manifest
analyze.js            JSONL -> per-rule-set verdict + markdown brief for an LLM
llm_steer.js          propose the next sweep (deterministic mock, or local Ollama)
hex_economy_v2.html   the interactive sandbox on the fixed hex maps (loads econ_engine.js + maps.js)
planet_economy.html   the interactive sandbox on the DEFAULT MAP (econ_engine.js + game_map_adapter.js)
sweep_planet.json     example sweep spec that runs the harness on the default map
test/                 validate_core/layers/organic/transport/planet.js, gen_maps.js
maps/                 the committed fixed maps (JSON)
out/                  sweep output (JSONL, manifest, analysis)
```

The sandbox shows per-tile readouts (farmers / gold workers / gov workers, food
capacity·production·net, gold output) as on-tile text when zoomed in, plus an
arrow from every net food producer to the city it feeds. **Hover any tile** for a
full stats overlay (terrain, capacity, workforce, food balance, where it ships);
urban tiles add a city-level block (cluster workers, productivity, price, output,
tax, net gold, top-1% wealth share).

### Stable, compact-but-irregular city growth (wave 3)

Two coupled improvements to the organic-city model (see `updateUrbanization` in
`econ_engine.js`):

- **No oscillation.** Tile flips are now effectively one-directional over the
  settling horizon, so a tile grows OR shrinks — it doesn't ping-pong. Three
  mechanisms: a **directional reversal lock** (`reversalCooldown`, a tile can't
  reverse its last flip for N ticks), an **EMA-smoothed** flip signal (`clSmooth`,
  so a single flip's food shock can't trip the reverse flip next tick), and a
  **per-city grow interval** (`growInterval`, cities add tiles gradually instead of
  one/tick, so extent *tracks* rather than *overshoots* what food supports —
  overshoot-then-thrash was the main oscillation source). On the fixed catalog this
  takes tile reversals to ~0 (every tile flips at most once = pure growth).
- **Compact but irregular extent.** A growing city paves the adjacent farm tile
  that best combines *compactness* (`compactBias` × urban-neighbour count) with
  *cheap farmland* (spares prime land → the extent follows terrain) plus a
  deterministic jitter (`growJitter`). A hard **ring backstop** (`ringGate`,
  `ringFillFrac`) blocks a ring-N tile until ring N−1 is >50% filled, so thin
  fingers can't form.

## On the game's default map (the planet)

The same engine also runs on the game's **real default map** — the `plangen-game-map`
the civ prototype loads (`../../maps/sample-map.json`, via `game/mapdata.js`). Instead
of a rectangular hex grid it is an irregular dual-graph of ~4000 tiles, and
`game_map_adapter.js` maps it onto the engine:

- **Food capacity** = the map's per-tile **`calories`** (PlanGen's best-crop yield),
  scaled so a *median land tile* ≈ the engine's "farm" tier (520). One smooth
  gradient, no terrain buckets. Coastal tiles gain fishing from adjacent water
  tiles' calories. *(Dan's call — "counting calories".)*
- **Transport** = the map's **baked, bi-directional edge costs** (`moveCost` A→B /
  `moveCostR` B→A — ~40% of edges are genuinely asymmetric: slopes, winds),
  normalised so a median *land* hop ≈ `K0`. Water and coast edges keep their own
  baked costs, so sailing is priced by the map (the sample map bakes very cheap
  ocean travel). `world.transport[city][tile]` charges the **toward-city**
  direction, so netback reflects the real cost of shipping food *to* market.
  Impassable land (mountains/glaciers) **walls off** food transport — a barrier,
  as in the hex model and for roads — while water stays a traversable sea lane.
  Roads still multiply the baked cost as before.
- **Strategic resources** (iron/gold/oil/…) are carried through as **inert display
  data** — shown in the sandbox, *not* simulated in the food/labor/wealth economy.
  *(Dan's call — deliberately left out for now.)*
- **Cities**: three selectable start modes — seed the map's top `cityPriority`
  spots then grow, one bootstrap that lets the rest self-ignite, or place them
  yourself.

The rectangular-hex path is **bit-identical** (all four original gates still pass);
the planet is opt-in. The engine runs **identically in Node and the browser** here
too (a 220-tick Node game and the browser sandbox both settle at N≈488 520, 32
cities on the sample map).

```bash
npm run validate:planet     # Node gate: adapter + economy on the sample map
npm run sweep:planet         # harness sweep on the default map (sweep_planet.json)
node analyze.js out/sweep_planet.jsonl
```

Open the interactive sandbox (`planet_economy.html`) on any static server rooted at
the repo, e.g. `python -m http.server 8765` then
`http://localhost:8765/game/toy/planet_economy.html`. Six views (Territory /
Terrain / Food-cap / Pop / Wealth / Prices), pan-zoom, per-tile hover, a city tool
and a two-city road tool. Balance sweeps use `urbanize:false` (fixed
strategy-seeded cities — the clean, convergent mode); the sandbox defaults to
`urbanize:true` to watch cities emerge.

## Run it

```bash
# 1. prove the economics (same Node-first discipline as v1/v2 spec)
npm run validate            # port fidelity + fiscal layer + transport + planet

# 2. (re)generate the fixed maps  (already committed)
npm run gen-maps

# 3. sweep thousands of games and analyze
npm run sweep               # 7 maps x 81 rule-sets x 6 strategies = 3402 games
npm run analyze             # -> out/sweep.analysis.md  (read this)
npm run steer               # propose the next sweep (mock; --ollama for a model)

# quick smoke (48 games)
npm run sweep:quick && node analyze.js out/sweep_quick.jsonl
```

Open the sandbox at `hex_economy_v2.html` (any static server; e.g.
`python -m http.server` then load the file).

## The experiment

Two objectives compete: **population** (a wide, populous civilization) and
**aggregate wealth** ΣY (a tall, rich one). The **sweep axes are the game rules**
(transport cost `K0`, urbanization `urban`→A/α/p, garrison cost `garrisonPerDist`,
public-wage `wageShare`, …). The **strategies are the player's choices** (which
sites to settle, road projects, tax rate). For every rule-set the analyzer asks:

| verdict | meaning | what to do |
|---|---|---|
| **DIVERGENT** | population & wealth won by *different* strategies (wide vs tall) | **keep** — a real choice |
| **DOMINANT** | one strategy wins both | abstract the choice away |
| **BROKEN** | collapse / runaway / never settles / food not conserved | avoid this region |
| **FLAT** | strategies barely differ | choice doesn't matter |
| **MIXED** | inconsistent across maps | inspect |

`out/sweep.analysis.md` ranks the DIVERGENT rule-sets (the promising ones), lists
the DOMINANT/BROKEN ones, and shows per-axis trends. It is written to be read by
an LLM: `llm_steer.js` feeds it back to propose the next batch, closing the loop.

### On the local LLM (Dan's question)

A game is ~1s of pure arithmetic; a local model is seconds *per call*. Putting a
model in the inner per-turn loop of thousands of games is fatal, so the games are
driven by fast deterministic strategy archetypes. The model's productive place is
the **outer loop**: reasoning over the aggregate analysis to steer the next sweep
toward the settings that preserve strategic divergence. `llm_steer.js --ollama`
targets a local Ollama endpoint (nothing leaves the machine); the default `mock`
backend does the same job heuristically so the loop runs fully offline.

## Model defaults (from Dan's answers)

- Fractional migration (workers flow toward equilibrium; economically real,
  conserved at steady state). Instant = set `migrate: 1`.
- Malthusian growth ON, capped by food carrying capacity.
- Roads never fall below their overland baseline — cost drifts `K1→K0` when
  unfunded (travel slows; never worse). Optional bandit tolls on remote,
  high-traffic, poorly-kept routes (`bandits: true`).
- Populations are large by design (cities in the thousands, farm hexes saturating
  at hundreds). Integers are fine for display; the solver runs on floats.

## Determinism

Same map + same params + same strategy ⇒ identical results (no RNG in the sim;
road maintenance is funded cheapest-first, not stochastically). Reproducible
sweeps are the whole point.

## Organic-city oscillation — mostly solved (wave 3)

The organic model couples a **discrete** decision (a tile flips farm↔urban,
removing/adding a whole tile of food at once) to a **continuous** one (Malthusian
population), which used to settle into a **tile-flip limit cycle** on lush,
heavily-urbanizing maps: the food shock of a flip nudged population → density →
another flip. Root cause: cities grew one tile *per tick* during a population boom,
**overshot** their sustainable size, then thrashed back down.

Wave 3 fixes it with three cheap, deterministic mechanisms (all tunable knobs in
`DEFAULTS`): the **`growInterval`** rate-limit (extent tracks, not overshoots,
sustainable size — the big one), the **`reversalCooldown`** directional lock (a
tile can't reverse its last flip for N ticks), and **`clSmooth`** signal smoothing
(a one-tick food shock can't trip the reverse flip). On the fixed catalog this
takes tile reversals to **~0** (every tile flips at most once). A stickier
`shrinkRatio` keeps paved extent through population dips.

Residual churn now only shows on synthetic **uniform, giant, fully-lush** maps
(e.g. a 30×24 all-`rich` plain that spawns ~30 cities all pinned at the urban cap):
there a genuine population limit cycle remains, but no tile flips more than a few
times over a whole run — slow boundary reorganization, not the old visible flicker.
The harness still **flags non-convergence as broken** so these surface in analysis.
For a perfectly clean balance sweep, `urbanize:false` (fixed cities) is still the
rock-solid base equilibrium; leave it on to study emergent settlement dynamics.
