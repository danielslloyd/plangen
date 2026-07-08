# Recent Work (changelog)

> Deep-dive doc. CLAUDE.md links here. Newest first.

- **Game prototype: eras, supply, diplomacy, occupation, turn log** (all in
  `game/`, see `game/README.md`): (1) three combat eras — Classical →
  Napoleonic → WW2 — with a full land/sea/air roster (per-type stats in
  `GameConfig.units.stats`, slider-tunable); (2) **supply lines**: food every
  turn, ammo per attack, fuel per movement, delivered from the nearest
  friendly city at a per-hop cost, with attrition/strength/movement penalties
  out of range; (3) **naval** bombardment (land forces capture) and **air**
  units based at cities flying ranged strike missions with interception and
  flak; (4) **diplomacy**: two-sided deals (gold, tile-by-tile territory via
  map picker, per-turn tribute, peace), AI valuation with counter-offer
  hints, AI-initiated tribute-for-peace and extortion-under-threat; (5)
  **occupation**: hostile units annex tiles after N turns, contested tiles
  hatch-rendered on the political map; (6) **structured turn log** with AI
  goals/priorities, downloadable JSON for AI tuning; (7) UI: player strip,
  event toasts, Diplomacy tab, richer status bar.

- **Game map export + civ-style game prototype**: new `plangen-game-map`
  format (`docs/game-export-format.md`) with locked tile/edge geometry and
  extensible struct-of-arrays layers (terrain, food, minerals, strategic
  layers, provinces, per-edge river-crossing/movement data). Exported by
  `game-export.js` ("Export Game Map" button in the Save/Load panel);
  `maps/sample-map.json` is a committed 20-subdivision example. `game/` holds
  a dependency-free playable prototype (see `game/README.md`): cities that
  fortify their surrounding edges, roads/bridges on edges, supply/demand
  commodity prices, micromanaged trade routes with tolls & subsidies,
  region-native crops spreading via trade, pirate/bandit camps on remote
  high-traffic route segments, eras & combat, and fully slider-tunable rules
  (`CONFIG_SCHEMA`) and AI personalities (`AI_PERSONALITY_SCHEMA`).

- **Tuning-panel overhaul**: (1) Layer-color pickers recolor on `change` (final
  color only), not on every hue crossed while dragging. (2) Every tuning panel
  gained a **"Save as defaults (copy code)"** button that copies a paste-ready
  snippet of the current values (colors: `defineOverlayColors/Palette` calls;
  sliders: the `var <config> = {...}` declaration with its file location);
  Layer Colors also has a per-overlay Save. (3) New per-overlay panels (shown
  only when their overlay is active, via `updateOverlayTuningPanels`):
  **Watershed Peninsulas (K)** (`watershedPeninsulaConfig` + 
  `regenerateWatershedPeninsulas`), **City Priority** (`cityPriorityConfig` in
  post-generation.js — coastal/junction weights — + `regenerateCityPriority`),
  **Mountain ranges** (`regenerateMountainRanges`). (4) Watershed merge: new
  **ocean-border penalty** (`oceanPenalty`, default 0.5) — the engine now
  tracks `coastTouch` per basin pair and penalizes merging across divides that
  terminate at the ocean. (5) Slider scales: size penalty capped at 0.20 with
  0.01 steps; elevation penalty up to 6.0; merge threshold quadratic (fine
  steps at the low end, `_quadLowMap`); border reward square-root (fine steps
  at the high end, `_sqrtHighMap`); shared wiring in `wireConfigSliders`.
  (6) **Mountain & Hill Ranges redefined**: absolute `hillHeight` /
  `mountainHeight` thresholds (not percentiles), and a range is a connected set
  of WATERSHED-BORDER tiles above the hill height — drainage divides are the
  ridgelines, so ranges trace crests.

- **Watershed-merge engine + K/M replaced**: extracted the merged-watershed
  greedy merge into a shared engine (`_watershedMergeEngine`,
  strategic-overlays.js) that tracks shared border, mean boundary elevation AND
  mean boundary |shore| per basin pair, with a forced "absorb every region ≤
  tinySize" pass replacing the old tiny-bonus term (`tinyBonus` removed from
  config, slider deleted). New merged-watershed defaults per testing:
  borderWeight 3.0, sizeWeight 0.05, threshold 0.05, tinySize 40. **Features K**
  is now Watershed Peninsulas (`computeWatershedPeninsulas`): border reward
  gated multiplicatively by signed boundary interiorness, so merging across
  coastal necks is blocked and peninsulas survive as their own groups (the old
  |shore|-watershed K removed). **Features M** is now Balanced Watershed
  Provinces (`computeBalancedWatershedProvinces`): smallest-pair-first merging
  until `basins/10` regions remain — roughly equal-population provinces (the
  old farthest-point-seeding M removed). Both land-only with ocean fill.
- **Resources, categories, K/L/M groupings**: (1) coal/silver/uranium deposits
  were never generated (overlays always empty) — added geologically motivated
  formulas in `post-generation.js`: coal in warm wet flat lowland basins far
  from plate margins, silver in hydrothermal bands hugging plate boundaries at
  mid-high elevation, uranium in arid cratonic interiors far from boundaries;
  percentile-thresholded like the other minerals (coal 93 / silver 98 /
  uranium 98). (2) The old Geography category is split three ways —
  **Geography** (terrain/elevation/temperature/moisture/simple/shore +
  convexity/thickness scalar fields), **Features** (all partition overlays:
  watersheds, feat A/B/C/E/H/J, terrain features, shore skeleton/branch depth,
  K/L/M) and **Strategic** (transit centrality, shore delta, narrow
  connectors/channels, chokepoints); five buttons in `#viewCategoryList`.
  (3) Three from-scratch feature-grouping overlays (`computeFeatureGroupings`,
  one background pass): **K Interiorness Basins** (watershed of |shore| —
  borders on saddles/necks), **L Communities** (deterministic label
  propagation), **M Balanced Provinces** (farthest-point seeds + simultaneous
  BFS growth). See `docs/feature-detection.md`.
- **Overlay responsiveness + pruning**: the shore-field tagging overlays'
  aggregates are now precomputed in the background phase
  (`calculateBackgroundOverlays` subactions; convexity and chokepoints run in
  slices via `action.loop()`), so selecting them never blocks the UI. While
  pending they show a ⏳ suffix in the dropdown and render flat gray (a wrapper
  in `registerColorOverlay` short-circuits the color fn when
  `entry.ready === false`); each group recolors live when it finishes. ALL
  keyboard shortcuts for color overlays were removed (W/C/F/S/D/K/L/N and
  5/7/8/9) — overlays are dropdown-only now. Overlay pruning: **deleted** Net
  Shore (`shoreRatio`), Neighbor Shore Comparison (`neighborShore`, incl. its
  generation pass), the old Shore Tree (Node Distance) (`shoreTree`,
  strategic-overlays.js), the old Granulometric Thickness (`thickness`), and
  Neck Severance (`neckSeverance`); **hidden** Reverse Shore Distance
  (`reverseShore`, code kept — `colorOverlayRegistry[id].hidden = true`, the
  dropdown skips hidden entries).
- **Tagging overlay iteration**: `localConvexity` now blends TWO scales (4-ring
  + 12-ring disks, 50/50) and counts same-BODY tiles instead of same-domain
  (nearby separate islands no longer count as "own side"). Scrapped the
  Shelter/Detour Index (`detourIndex`) and Coast Cells (`coastCells`) overlays
  (not visually useful). Two new approaches: **Local Thickness (Granulometry)**
  (`localThickness`, morphological opening of |shore| — thin fingers/necks/
  channels hot, wide cores cool; coast of a wide mass still reads thick) and
  **Chokepoints (Betweenness)** (`chokepoints`, Brandes betweenness sampled
  from ~48 sources per domain, paths never cross the coast — straits, isthmuses
  and peninsula necks glow gold/cyan).
- **Convexity normalization + Narrow Channels**: `localConvexity` now displays
  RELATIVE convexity (`computeRelativeConvexity`) — each tile vs. the mean of
  same-`|shore|` tiles in its own body — so small islands no longer read hot
  (1-tile islands score exactly 0). New **Narrow Channels** overlay
  (`narrowChannels`, `computeNarrowChannels`): water Voronoi by nearest land
  body picks which body pairs to connect (only touching regions, no all-pairs);
  each pair's minimum-width crossing is traced to both coasts via BFS parent
  pointers; routes ramp white-hot (narrowest strait) → dull red (wide passage).
- **Four shore-field tagging overlays** (`generatePlanetRenderData_functions.js`,
  documented in `docs/feature-detection.md` § "Shore-field tagging overlays"):
  **Local Convexity** (`localConvexity`, 4-ring own-domain fraction — capes red,
  bay shores teal, inlets purple), **Shelter / Detour Index** (`detourIndex`,
  reverseShore hops ÷ chord distance — flags fjords/hooked bays/curled
  peninsulas), **Neck Severance** (`neckSeverance`, |shore|-threshold erosion
  vs. disconnection from the body root — lights up exactly the wide lobes behind
  narrow necks), and **Coast Cells** (`coastCells`, coastline segmented into
  cape/straight/bay arcs by convexity sign, every tile claims its nearest arc —
  a feature-cell partition; warm = cape arcs, cool = bay arcs). All lazy
  aggregates via `getOverlayAggregate`; shared `computeShoreBodies` helper.
- **Shore skeleton tree overlays** (`generatePlanetRenderData_functions.js`,
  `computeShoreTrees`): two new geography overlays built from the Shore Distance
  node tiles (the red/fuchsia local extremes from `computeShoreNodeSet`).
  Per connected body: root = node with max `|shore|`; a Dijkstra tree whose step
  cost favors high-`|shore|` tiles (so paths follow the interior spine); each
  node tip is traced back to the root, traces merging at junction vertices.
  Remaining tiles claim the nearest skeleton tile via multi-source BFS.
  **Shore Tree (Skeleton)** (`shoreSkeleton`) draws the branches in place
  (root white, land tips red, water tips fuchsia, junctions black, per-branch
  palette over dimmed bases). **Shore Branch Depth** (`shoreBranchDepth`)
  colors every tile by the number of tree vertices between its branch and the
  root (land yellow→red, water light-blue→purple) — high depth tags
  peninsulas/bays. Memoized per planet via `getOverlayAggregate("shoreTrees")`
  (~10ms at 4k tiles). Note: id `shoreTree` was already taken by the older
  BFS node-distance overlay in `strategic-overlays.js`, hence `shoreSkeleton`.

- **Context-efficiency pass**: moved deep-dive docs out of CLAUDE.md into `docs/`
  (this file, `feature-detection.md`, `rendering.md`, `coordinate-system.md`);
  extracted resource/food overlays into `resource-overlays.js`; removed dead code
  and the high-frequency per-tile/per-triangle build logging.
- **Overlay categories**: the Surface Color Overlay dropdown is filtered by three
  category toggle buttons — **Geography / Food / Resources** (`#viewCategoryList`).
  Each overlay carries a `category` (7th arg to `registerColorOverlay`, default
  `"geography"`); `populateColorOverlayDropdown` shows only the active category and
  `setSurfaceRenderMode` keeps the category in sync when an overlay is chosen
  outside the dropdown (e.g. keyboard shortcuts). Added a combined **All Strategic
  Resources** overlay. Removed the **Land Regions** overlay (the `landRegion` tile
  data + graph coloring in `post-generation.js` remains). Removed the stale `X`/`Z`
  shore shortcuts (the dynamic Shore-N overlays keep their code, just no shortcut).
  The crops (corn/wheat/rice/fish/pasture) and calories live under **Food**,
  minerals under **Resources**. Up/down arrows in mercator are reversed (up = north).
- **Coastline overlay** (Overlay Display Options): a thin black outline along
  land/water boundary edges, modeled on the plate outline (projection-aware,
  3-copy in mercator). `buildCoastlineOutlineObject` / `rebuildCoastlineOutline`.
- **Shore overlay perf fix**: `shore`/`reverseShore`/`shoreRatio` (and
  `calories`/`upstreamCalories`/`pathDensity`) recomputed `Math.min/max` over every
  tile *per tile* (O(N²)) — a hard freeze on bigger planets when switching to them.
  Aggregates are now memoized once per planet via `getOverlayAggregate`.
- **Approach A cohesion merge** (`mergeByCohesion`, `CONFIG.plateMerge` slider):
  after the tiny-region merge, adjacent same-domain provinces are joined when they
  share a wide border and the union is more compact (area/perimeter²), rounding out
  features without absorbing concave bays.
- **Mercator**: continuous seamless horizontal scroll (3-copy group, period 4π),
  instant Globe↔Mercator switching via `planet.renderDataCache`, and a new
  **Raised Mercator** relief view. Rendering-only changes — generation untouched.
- **Feature detection** (`feature-detection.js`): nested land/water features
  exposed as color overlays (current set A/B/C/E/H). Distinct hue per feature (B uses
  depth-darkening). Hover outlines + popup labels, rudimentary classification.
  Tunable via **UI sliders** (no console needed) and a **"Show Feature Roots"**
  toggle that draws the feature node-tree (root dot + line to parent) in place.
  Also fixed a latent globe-projection bug where hover outlines collapsed to the
  origin (`p.length()` read after `normalize()`).
- **Mercator selection follows infinite scroll**: the tile-select highlight now
  re-homes onto the world copy nearest the camera each frame
  (`updateMercatorSelectionWrap`), so selecting a tile while scrolled to a far
  copy shows the highlight where you are looking instead of only on the base copy.
- **Feature detection trimmed to B/C/E/H** (then A re-added as plate provinces):
  removed approaches A (old), D, F, G and the Prominence debug overlay. E gained a
  NECK CUT (`neckWidth`) so it splits narrow straits/isthmuses, and an
  `eFollowBasins` toggle (folds old F in: land follows drainage basins). Feature
  root markers are now the pole of inaccessibility (`assignFeatureMarkers`) instead
  of the max-field tile.
- **Plates view reworked** (`calculatePlatesColor` + `buildPlateOutlineObject` /
  `rebuildPlateOutline` in `rendering-3d.js`): plain land/water fill plus a
  projection-aware thin black plate-boundary outline shown only while the "plates"
  overlay is active (rebuilt on overlay + projection change, 3-copy in mercator).
- **Feature detection round 4**: new **Approach A = plate provinces** (plates as
  large features + majority-vote boundary smoothing + domain donation so a
  province is never mixed land/water; same-domain-only tiny-merge). `eFollowBasins`
  is a land-only post-hoc relabel that keeps each land drainage basin in one
  feature without adding features or changing the water partition; it's now an
  on/off toggle slider. E sliders widened (thickness 2..80, neck 0..12). Tuning
  panel shows only the active overlay's knob group. Feature root markers use the
  pole of inaccessibility.
