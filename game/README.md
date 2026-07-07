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

- **Turns**: all AI players act, then economy, then trade. `End Turn` or
  `Autoplay` (speed selector). Default: you are Player 1; pick "spectate" in
  the Players tab to watch AIs only.
- **Cities** claim territory (radius tunable), work their best tiles
  (pop × tilesPerPop), grow on food surplus, and produce units/buildings.
  A city **fortifies every edge of its tile** — any attack into the city tile
  crosses a fortified edge and suffers the fortify (+walls) defense bonus.
- **Roads & bridges** are built with gold on edges; edges flagged `riverCross`
  in the map need a (more expensive) bridge. Roads cut movement cost and make
  trade routes cheaper.
- **Eras**: science accumulates → Ancient → Classical (unlocks Legions) →
  Imperial. Combat becomes decisive as eras advance.
- **Victory**: last player standing, or highest score at the turn limit.

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
| `engine.js` | state, cities, yields, movement, combat, eras, turn driver |
| `trade.js` | prices, routes, tolls, subsidies, knowledge spread, camps |
| `ai.js` | personalities, site scoring, per-turn decisions |
| `render.js` | canvas map, overlays (terrain/political/food/strategic/prices/traffic) |
| `ui.js` | panels, tabs, interactions |
| `main.js` | bootstrap |

## Known prototype simplifications

- Land-only military (no navies); trade is amphibious.
- One melee unit line; no ranged/siege.
- Cities all-capture on HP 0 (no razing choice).
- Prices are flow-based (no warehousing/stockpiles).
- Wars auto-peace after 40 turns of stalemate.
