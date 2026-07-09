# PlanGen Civ Prototype

A browser-only, dependency-free prototype of a civ-style strategy game played on
maps exported from PlanGen (`docs/game-export-format.md`). Built for **balance
tuning**: every rule constant and every AI personality weight is a live slider.

## Running

Serve the repo root (`python -m http.server 8765`) and open
`http://localhost:8765/game/index.html`. It auto-loads `maps/sample-map.json`;
use **Load map** to open any other exported game map (PlanGen → Save/Load panel
→ **Export Game Map**).

## The game

- **Turns**: all AI players act, then occupation, economy, trade, diplomacy.
  `End Turn` or `Autoplay` (speed selector). Default: you are Player 1; pick
  "spectate" in the Players tab to watch AIs only.
- **Cities** claim territory (radius tunable), work their best tiles
  (pop × tilesPerPop), grow on food surplus, and produce units/buildings.
  A city **fortifies every edge of its tile** — any attack into the city tile
  crosses a fortified edge and suffers the fortify (+walls) defense bonus.
- **Occupation**: hostile combat units standing on enemy land accumulate
  occupation each turn; after `territory.occupationTurnsToFlip` turns the tile
  is annexed. In-progress occupation renders as **fat hatching** on the
  political overlay (denser as the flip nears); unguarded progress decays.
- **Roads & bridges** are built with gold on edges; edges flagged `riverCross`
  in the map need a (more expensive) bridge. Roads cut movement cost and make
  trade routes cheaper.
- **Eras**: science accumulates → **Classical → Napoleonic → WW2**. Each era
  brings a stronger unit roster and heavier logistics (see Supply).
- **Victory**: last player standing, or highest score at the turn limit.

## Combat, eras & supply

Each era is a **hard generational shift**: on advancing, the whole old army
disbands and every city retools from scratch — only the new era's units can be
built.

- **Classical**: militia, legion, cavalry, trireme — armies need **food**.
- **Napoleonic**: infantry, cavalry, artillery, ship of the line, frigate —
  food **+ ammunition**.
- **WW2**: infantry, artillery, armor, destroyer, carrier, fighter, bomber —
  food + ammo **+ fuel**.
- **Artillery** is a siege unit: a big bonus attacking cities and it bombards
  with little counter-fire, but it can't itself capture a tile.

### Amphibious, airborne & carriers

- **Amphibious**: any land unit can embark and cross water (transport cost per
  sea tile) — it is weak while at sea, and comes ashore **disorganized for a
  few turns** (strength ramps back up) unless trained amphibious.
- **WW2 infantry** can **train** (gold, once) as **airborne** — paradrop within
  range, burning fuel — or **amphibious** — no landing penalty.
- **Carriers** are mobile airbases: aircraft rebase onto them, sail with the
  fleet, draw supply from them, and inherit the carrier design's air-wing bonus.

### Design classes

Napoleonic+ ships and WW2 ships/planes have **configurable designs** (Designs
tab): ships trade **speed vs firepower**, planes **range vs firepower**,
carriers **speed vs air-wing**. Higher attributes cost more; changing a design
imposes a short **retooling** production penalty. AIs pick designs from their
personality (aggressive → firepower, traders → speed/range).
- **Supply lines**: every unit draws its needs from the nearest friendly city
  via a supply line that cannot cross enemy territory. Food is consumed every
  turn, ammo per attack, fuel per movement; delivery cost rises per hop
  (`supply.perHop`), so deep offensives are expensive. Units beyond
  `supply.maxRange` starve: attrition each turn, an ammo strength penalty and
  a fuel movement penalty. Unsupplied units show a red **!**; the Info panel
  shows the supply state and line length.
- **Naval**: ships path over water from coastal cities, hunt enemy fleets and
  bombard coastal cities/camps — but only land forces can capture a city.
- **Air**: fighters/bombers are **based at cities** and fly one mission per
  turn within a strike range (dashed ring when selected): strikes suffer flak
  and possible fighter interception; bombers hit cities hardest. Click a
  friendly city to rebase; losing the base scrambles or destroys the wing.

## Diplomacy

- The Diplomacy tab builds two-sided deals: **gold**, **tile-by-tile
  territory**, whole **cities** (pick tiles or cities on the map — red = you
  give, green = you get; ceded cities keep their population and buildings),
  **tribute** (gold per turn for N turns) and **peace**. You can't cede your
  last city. Warring players can only talk peace.
- AIs value deals with their own personality and geography, accept above a
  margin, and rejections come with a "they'd want ~Xg more" hint for
  counter-offers. Losing/war-weary AIs proactively buy peace with tribute;
  aggressive stronger AIs **extort tribute under threat of war** — refusing
  may start one. Incoming offers queue on the tab (badge) and expire.
- Tributes pay out each turn and are cancelled by war between the parties.

## Turn log (for AI tuning)

Every game records a structured replay: personalities and config at start,
then per-turn player snapshots (gold, science, era, score, power, cities,
pop, tiles, units, routes, knowledge), every **AI goal** (war declarations,
unit missions, production wants, trade routes, famine subsidies, diplomacy)
with machine-readable data, and the turn's events. The Log tab shows recent
goals and downloads the whole thing as JSON (~2KB/turn).

## Trade (the core loop)

- Ten commodities are read straight from map layers (crops, livestock, fish,
  timber, minerals). **Crops and livestock require knowledge**: each player
  starts only with what is native to their starting province
  (`province` layer + `nativeThreshold`).
- Every city computes **supply** (worked tiles, knowledge-gated), **demand**
  (population, era) and a **price**
  `base × (demand/supply)^elasticity`, clamped. Imports lower prices, exports
  raise them, so arbitrage self-dampens.
- **Routes** are created per city (slots tunable, markets add more). Each turn
  a route carries its best-margin commodity:
  `margin = sell + subsidy − buy − transport(path cost) − tolls − expected piracy`.
  Paths are amphibious (land/sea/ports) and re-route around tolls and pirates.
- **Tolls**: each player sets a toll rate (Players tab); foreign routes crossing
  their territory pay per tile — and will path around greedy toll-setters.
- **Subsidies**: per city × commodity (City tab). Paid from the owner's
  treasury per delivered unit; raises the effective local price, attracting
  routes. AIs use them to fight famine and to lure unknown crops.
- **Crop spread**: importing an unknown crop/animal builds familiarity each
  turn (`spreadPerTurn`); at 100% the importing player learns to grow it.
- **Pirates & bandits**: route traffic is remembered per tile. Remote tiles
  (far from any territory) with high traffic can spawn camps that raid passing
  cargo and grow on the loot; military units clear them (pirates spawn on land
  near the sea lane so armies can reach them).

## Tuning

- **Tuning tab**: sliders auto-generated from `CONFIG_SCHEMA` in `config.js`.
  Adding a tunable = one config value + one schema row. "Copy config JSON"
  exports the current balance for saving as new defaults.
- **Players tab**: per-player toll slider and the full **AI personality**
  editor (`AI_PERSONALITY_SCHEMA` in `ai.js`): map-valuation weights (food,
  production, minerals, PlanGen's cityPriority / transit / shoreDelta strategic
  layers, coast, river) and behaviour drives (expansion, military, trade,
  aggression, tollGreed, subsidyBias, riskAversion). Presets: balanced,
  expansionist, warmonger, merchant, isolationist.

## Files

| file | contents |
|---|---|
| `config.js` | GameConfig + COMMODITIES + tuning schema |
| `mapdata.js` | map decoding, derived geometry, shared Dijkstra |
| `engine.js` | state, cities, yields, movement domains, combat, supply, eras, occupation, turn driver |
| `trade.js` | prices, routes, tolls, subsidies, knowledge spread, camps |
| `diplomacy.js` | deals, valuation, tribute, city cession, AI peace/extortion |
| `designs.js` | configurable ship/plane/carrier design classes + retooling |
| `gamelog.js` | structured replay log + JSON export |
| `ai.js` | personalities, site scoring, per-turn decisions, naval/air missions |
| `render.js` | canvas map, overlays, contested hatching, deal highlights |
| `ui.js` | panels, tabs, diplomacy builder, player strip, toasts |
| `main.js` | bootstrap |

## Known prototype simplifications

- Amphibious transport is abstract (no explicit transport ships; land units
  ride "over" water and are weak until ashore).
- Air units have no fuel-range escort model; interception is probabilistic.
- Cities all-capture on HP 0 (no razing choice).
- Prices are flow-based (no warehousing/stockpiles).
- Wars auto-peace after 40 turns of stalemate.
- AI doesn't fly its land-based aircraft onto carriers (carriers still buff
  and supply any aircraft based on them).
