# Geographic Feature Detection (`feature-detection.js`)

> Deep-dive doc. CLAUDE.md links here; read this when working on feature overlays.

Identifies nested geographic features and exposes them as color overlays with
hover inspection. Land: continent > peninsula > headland > cape. Water: ocean >
bay > inlet > cove. Built on `tile.shore` (signed shore distance, computed in
`post-generation.js`) and `tile.body`; the scalar field is interiorness/openness
`w = |shore|` (high in continent cores & open ocean, low at peninsula tips /
coves, a saddle at narrow necks).

Computed once per planet by `generateFeatureOverlays(planet)`, hooked into
`planet-generator.js` right after `generateDynamicShoreOverlays` (and on the
save/load + GeoJSON-import paths). Must run after shore distances exist.

## Five approaches (each builds a nested per-tile hierarchy)
History: the letters have been reused. Earlier A (persistence merge tree), D
(coast convexity arcs), F (drainage basins) and G (relief tiers), plus a
Prominence debug overlay, were removed. F's drainage idea survives as an option on
E. **A is now PLATE PROVINCES** (below).
- **Approach A — plate provinces** (`tile.hierarchyA`): tectonic plates are the
  large features. Raw plate boundaries are tectonic noise, so "smart boundary"
  logic cleans them in two steps: (1) `CONFIG.plateSmooth` majority-vote
  relaxation passes (each tile takes the dominant plate among itself+neighbours,
  with a self-bias) remove jagged single-tile intrusions; (2) **domain donation** —
  each plate is mostly land or mostly ocean, and any tile whose own domain
  conflicts with its plate's majority (a land tile stranded on an ocean plate, or
  vice versa) is donated to the assignment of its NEAREST same-domain tile
  (multi-source BFS). After this every province is single-domain. Then contiguous
  same-plate regions become provinces and any below `CONFIG.plateMinSize` merge
  into a **same-domain** neighbour only (so a donated island never re-merges into
  the surrounding ocean). Finally a **cohesion merge** (`mergeByCohesion`,
  `CONFIG.plateMerge`, 0 = off) greedily joins adjacent same-domain provinces when
  they share a wide border AND the union is more compact (compactness =
  area/perimeter², peaks for disks): it rounds out blobby pairs/triples but refuses
  to absorb a concave bay (which would lower compactness). `plateMerge` (0..100)
  tunes the bar: 50 ≈ require no compactness loss, lower is stricter, higher
  tolerates a small loss. Operates over ALL tiles (land+water); single-level
  features. (Distinct from the `plates` *render mode* = land/water fill + black
  plate outlines.)
- **Approach B — recursive erosion split** (`tile.hierarchyB`): recursively
  split each body into connected components of `{|shore| > e}`, flood the rest to
  the nearest core, recurse with `e+1`. Each split adds a level. Captures
  narrow-mouth bays/straits even without interior maxima.
- **Approach C — inscribed-disk lobes** (`tile.hierarchyC`): the "most
  land-locked part" idea. Seed at the deepest-interior unclaimed tile, grow a BFS
  disk until `>= CONFIG.lobeEdgeWater%` of its boundary edges hit
  opposite-domain/claimed tiles, claim that lobe, then repeat. Lobes below
  `CONFIG.lobeMinSize` are merged into a neighbour. 2-level `[bodyRoot, lobe]`.
- **Approach E — granulometric thickness** (`tile.hierarchyE`) — the favourite.
  A bounded-disk granulometry of `w` (capped at `CONFIG.thicknessMax`, slider to
  40) produces a local THICKNESS field, nested by threshold via the shared split
  engine. Two extra knobs:
  - `CONFIG.neckWidth` (NECK CUT): tiles with `|shore| <= neckWidth` are treated
    as walls by `connectedComponentsAbove` (via the `passable` predicate) without
    being removed from the body, so narrow straits/isthmuses are split first.
    0 = off (pure thickness); 1 cuts ~2-wide necks, 2 cuts ~4-wide, etc.
  - `CONFIG.eFollowBasins` (binary): a LAND-ONLY, last-minute rule applied AFTER
    the normal thickness split (`relabelLandByBasin`). For each land drainage
    basin (`tile.drain` → mouth/sink) it relabels all the basin's land tiles to
    the single finest feature most of them already landed in, so a basin is never
    cut between two features. It only reads/writes LAND tiles' `_eFinest` and only
    reassigns to existing features (emptied leaves are pruned), so it **never adds
    features and never changes the water partition** — verified water tile→feature
    grouping is byte-identical on/off.
- **Approach H — bioregions** (`tile.hierarchyH`): climate driven. Bins each tile
  by normalized (`temperature`, `moisture`) into `CONFIG.climateBands`² classes,
  takes connected same-class components within a domain, merges regions below
  `CONFIG.climateMinSize`. Single-level (flat) features.

Each tile gets `tile.hierarchyB/C/E/H` = ordered array of feature objects
(root → finest). Feature object fields: `{ id, approach, isLand, level, parent,
children, root (the marker tile - see below), maxW, regionTiles, classification,
name }`. The shared split machinery (`buildSplitHierarchy` /
`connectedComponentsAbove` / `fillToCores`) is parameterized by a `fieldFn` and an
optional `passable` predicate (B runs it on `|shore|`; E on the thickness field +
neck-cut predicate).

## Overlays
- `featPlatesA` — "Features A: Plate provinces"        — distinct hue per feature
- `featNestedB` — "Features B: Nested (erosion)"      — darken-by-depth
- `featLobesC` — "Features C: Lobes (inscribed disk)" — distinct hue per feature
- `featThicknessE` — "Features E: Thickness (granulometry)" — distinct hue per feature
- `featBioH` — "Features H: Bioregions (climate)" — distinct hue per feature

B color = land (green) / water (blue) base hue **darkened once per nesting level**
(`CONFIG.darkenPerLevel = 0.72`). A/C/E/H color = a **stable hue per finest feature**
(golden-ratio hash of `feature.id`; land = green family, water = blue family) so
the segmentation reads as a patchwork. Both share `featureHueColor`. A/H use
`classifySimple` (size-ranked "Plate N" / "Bioregion N"); B/C/E use the geographic
classifier.

## Tuning sliders (control panel)
The "Feature Detection tuning" `<details>` under the Surface Color Overlay
dropdown shows knobs **only for the active feature overlay** — each approach's
sliders live in a `<div class="fdGroup" data-approach="X">`, and
`updateFeatureControlsVisibility` (called from `setSurfaceRenderMode`) shows the
matching group and hides the whole panel for non-feature overlays. A's group has a
**"Cohesion merge"** slider (`fdPlateMerge`, 0..100). E's group has a **"Drainage
basins"** on/off toggle slider (`fdEFollowBasins`, a 0..1 range) alongside Max
thickness (2..80) and Neck cut width (0..12). The slider wiring supports
`toValue`/`fromValue`/`format` per control (the basins slider maps 0/1 ↔ boolean).
The value label updates live while dragging; the heavier recompute fires on
release (`change`), routed through `regenerateFeatureOverlays`. Wired in
`setupFeatureDetectionControls` (`ui-initialization.js`).

## Feature root/node visualization
The "Show Feature Roots" toggle (same panel; `toggleFeatureRoots` /
`rebuildFeatureRoots`) draws, for the active approach, a dot at every feature's
`root` tile (`THREE.Points`, screen-space size, depth-test off) with a thin line
to its parent's root — i.e. the feature node-tree drawn in place. `feature.root`
is the **pole of inaccessibility**: the tile furthest (graph distance) from the
feature's region boundary, i.e. furthest from any other feature, computed by
`assignFeatureMarkers` (BFS inward from the boundary). Colored by
`featureHueColor`. Projection-specific, so it is rebuilt on overlay change
(`setSurfaceRenderMode`) and projection switch (`applyProjectionStateChange`,
both the cached and fresh branches), and replicated across the 3 mercator copies.

> Coordinate note: `projectCorner`/`projectTileCenter` must read the source
> vector's length **before** `normalize()` (normalize mutates it to unit length).
> A prior version computed `p.normalize().multiplyScalar(p.length()+off)`, which
> collapsed globe hover outlines to radius ~5 near the origin; fixed by caching
> `len` first.

## Hover (only when a feature overlay A or B is active)
Hovering a tile draws a thin black outline around every feature in its hierarchy
(one merged `LineSegments`, antimeridian-corrected and replicated across the 3
mercator copies) and shows a subtle popup label per feature at that feature's
stable root tile. Picking: globe uses `planet.partition.intersectRay`, mercator
finds nearest tile; throttled ~50 ms. `window.__fhDebug` exposes hover internals.

## Classification (rudimentary, `classifyFeature`)
By domain / root / size / elongation (`aspect = size / maxW²`). Connectors
(Strait/Isthmus) also require narrowness (`maxW <= 4`) so large elongated bodies
aren't mislabeled.
- Water: Ocean, Sea, Lake (roots, by size); Gulf, Bay, Inlet, Strait (nested).
- Land: Continent, Island, Islet (roots, by size); Peninsula, Headland, Cape,
  Isthmus (nested).

## Tuning (sliders or console)
Prefer the sliders above; the same knobs are available on `console`.
`featureDetectionConfig` = `{ plateSmooth, plateMinSize, plateMerge (A);
maxErosion, darkenPerLevel (B); lobeEdgeWater, lobeMinSize (C); thicknessMax,
neckWidth, eFollowBasins (E); climateBands, climateMinSize (H) }`. Re-run with
`regenerateFeatureOverlays({...})`; it recomputes, unregisters stale overlay ids,
rebuilds the dropdown, reapplies the current overlay, and rebuilds root markers.
Examples:
```javascript
regenerateFeatureOverlays({ plateMerge: 70 })           // A: join more provinces into rounder features
regenerateFeatureOverlays({ lobeEdgeWater: 55 })        // C: larger lobes
regenerateFeatureOverlays({ neckWidth: 2 })             // E: cut wider straits/isthmuses
regenerateFeatureOverlays({ eFollowBasins: true })      // E: land follows drainage basins
regenerateFeatureOverlays({ thicknessMax: 10 })         // E: deeper width nesting
```
