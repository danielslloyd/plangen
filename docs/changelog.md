# Recent Work (changelog)

> Deep-dive doc. CLAUDE.md links here. Newest first.

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
