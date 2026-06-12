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
- **Approach J — plate provinces, min water boundary** (`tile.hierarchyJ`): a
  CLONE of A (same `computePlateProvinces` with `minWaterBoundary:true`). After the
  donation step, every water province boundary is re-routed onto the shortest water
  crossing: for each adjacent water-province pair, a unit-capacity **min-cut**
  (Edmonds-Karp on an integer graph) inside a `BAND`-wide band around their shared
  boundary, between the two sides' band rims, picks the partition that cuts the
  fewest water-water edges — i.e. the deep middle slides to the narrowest channel
  between the flanking land bodies. The crossing's COASTAL ENDPOINTS are not hard-
  anchored: coastal band tiles are pinned to their province *except* within
  `ENDPOINT_SLACK` (3) edges of where the seam currently meets land, so an endpoint
  may slide a few edges along — and stays on — its own land body. Typically ~12-18%
  less total water-boundary length than A.
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
- `featBioH` — "Features H: Bioregions (climate)" — 5-colour map
- `featPlatesJ` — "Features J: Plate provinces (min water boundary)" — 5-colour map

All feature overlays are drawn as a **5-colour map**: `assignFeatureGraphColors`
greedily graph-colours each approach's finest features (land and ocean graphs
independently, planar so 4-colourable) giving every feature a `feature.colorIndex`
0..4, and `makeFeatureColorFn` paints it from the editable 5-entry land/water
palettes (`FEATURE_LAND/WATER_PALETTE_DEFAULT`). Adjacent same-domain features
never share a colour. A/H/J use `classifySimple` (size-ranked "Plate N" /
"Bioregion N"); B/C/E use the geographic classifier. (B no longer darkens by
nesting depth — `CONFIG.darkenPerLevel` is unused.)

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

## Shore-field tagging overlays (lazy, in `generatePlanetRenderData_functions.js`)

Six additional overlays for tagging coastline features (peninsulas, bays, capes,
gulfs...). Unlike approaches A–H above they are NOT hierarchies — each is a
standalone per-tile field/partition, computed lazily on first recolor and
memoized per planet via `getOverlayAggregate`. All key off `tile.shore`
(`shore === 0` tiles render gray) and treat land/water symmetrically with
separate color ramps. Shared body scaffolding: `computeShoreBodies(tiles)`
(flood-fill by shore sign; root = max-`|shore|` tile per body).

### Shore Tree (Skeleton) `shoreSkeleton` + Shore Branch Depth `shoreBranchDepth`
`computeShoreTrees`: per body, a Dijkstra tree from the root with step cost
`1 + 3*(maxShore - |shore|)` (paths follow the interior spine); each shore-node
tip (the red/fuchsia local extremes from `computeShoreNodeSet`) is traced back
to the root, merging at junction vertices. Remaining tiles claim the nearest
skeleton tile (multi-source BFS), inheriting branch id + node depth.
*Skeleton* draws the tree in place (root white, land tips red, water tips
fuchsia, junctions black, palette per branch over dim bases). *Branch Depth*
colors every tile by # of tree vertices to the root — land yellow→red, water
light-blue→purple; high depth = far out along fingers/inlets. Note: the id
`shoreTree` belongs to the older BFS node-distance overlay in
`strategic-overlays.js`.

### Local Convexity `localConvexity`
`computeLocalConvexity`: BFS two disks around each tile — 4 rings (capes,
coves) and 12 rings (whole peninsulas, gulfs) — and take the fraction of each
that belongs to the tile's own BODY (not just its domain, so a nearby separate
island doesn't count as "own side"); the signed scores `c = 1 - 2*fraction`
are blended 50/50. Displayed RELATIVE (`computeRelativeConvexity`): the mean
score of same-`|shore|` tiles in the same body is subtracted, so a tiny island
(whose shore tiles are all convex) reads neutral while a continent's capes
stand out; interiors are naturally ~0 vs. their peers. Normalized per domain,
sqrt contrast. Land: red = more convex than peers (capes/tips), teal = more
concave (bay shores). Water: purple = inlets, dark blue = unusually open.

(Scrapped/removed approaches: Shelter/Detour Index `detourIndex`, Coast Cells
`coastCells`, and Neck Severance `neckSeverance`. The Reverse Shore Distance
overlay is hidden from the dropdown (`colorOverlayRegistry[id].hidden`), and
the old Net Shore, Neighbor Shore Comparison, Shore Tree (Node Distance) and
Granulometric Thickness overlays were deleted.)

### Narrow Channels `narrowChannels`
`computeNarrowChannels`: water tiles on the shortest route between two land
bodies. Pair selection is implicit — no all-pairs work: a multi-source BFS over
water, seeded from every land body's adjacent water tiles, builds a water
VORONOI (each water tile gets nearest-land-body label + hop distance + parent
pointer toward that coast). Only pairs whose regions touch are candidates; at
each boundary edge the channel width = `dist(a) + dist(b)`, the minimum-width
crossing per pair is kept, and the route is traced to both coasts via the
parent pointers (a tile on several routes keeps its narrowest). Routes ramp
white-hot (narrowest strait) → orange → dull red (wide passages); other water
is a dim navy, land a dark olive base. O(N) plus one pass over boundary edges.

### Local Thickness (Granulometry) `localThickness`
`computeLocalThickness`: the width class of the widest disk that fits in the
domain and contains the tile — the same granulometric-thickness idea as
feature-detection's Approach E, computed standalone as a morphological OPENING
of `|shore|`: for each radius r ascending, tiles with `|shore| >= r` are
dilated back out r-1 steps (multi-source BFS within the same domain); the last
r to reach a tile is its thickness. Thin = hot (quadratic ramp): fingers,
necks, channels and small islands glow orange-red on land / magenta in water;
wide cores cool to dark green / deep blue. The key difference from shore
distance: the coast of a WIDE mass still reads thick. O(N·maxShore).

### Chokepoints (Betweenness) `chokepoints`
`computeChokepoints`: sampled shortest-path betweenness centrality — how much
traffic is forced through each tile. Brandes' algorithm from ~48 evenly-strided
source tiles, paths restricted to the source's domain (never cross the coast),
dependency scores accumulated per tile and normalized per domain (sqrt ramp).
Straits, isthmuses and peninsula necks score high because every route between
the masses they join must pass through them; open interiors spread traffic and
stay dark. Land dim-olive→gold, water navy→cyan. Complements Narrow Channels
(inter-body water routes): chokepoints are bottlenecks WITHIN a connected
domain. O(sources·N).

## From-scratch feature grouping (K, L, M — `computeFeatureGroupings`)

Three standalone partitions (category **Features**), computed together in one
background pass (aggregate `featureGroupings`) and drawn as a stable
hue-per-region patchwork (`_groupingColor`). K and M are built on the shared
watershed-merge engine (`_watershedMergeEngine`, strategic-overlays.js), which
also powers Watershed Regions (Merged): it builds the basin-adjacency graph
(shared border, mean boundary elevation, mean boundary |shore|), greedily
merges the most desirable pair, then force-merges every region at/below
`tinySize` into its best neighbour (this replaced the old "tiny bonus" term).
Merged-watershed defaults: borderWeight 3.0, sizeWeight 0.05, threshold 0.05,
tinySize 40.

### Features K: Watershed Peninsulas `featBasinsK`
`computeWatershedPeninsulas` (strategic-overlays.js): the watershed merge with
an INTERIORNESS-aware score. The border reward is gated multiplicatively by
signed boundary interiorness `(avgShore - neckMid) / (1 - neckMid)` (mean
normalized `|shore|` along the shared divide, neckMid 0.25): a divide deep in
the interior keeps its full reward, while one running along the coast — a
peninsula neck — flips the score negative no matter how much border the merge
would erase. Interior basins coalesce; peninsulas/capes stay their own groups.
Land only (ocean fill). Config: `watershedPeninsulaConfig`.

### Features L: Communities (label propagation) `featCommunitiesL`
Deterministic label propagation on the same-domain graph: every tile starts
with its own label; `GROUPING_LP_ROUNDS` (10) synchronous rounds of "adopt the
most common neighbour label" (self-bias 1.5, ties → smallest label), then
connected-component relabeling so regions are contiguous. Organic blobs whose
borders settle where local connectivity is weakest.

### Features M: Balanced Watershed Provinces `featProvincesM`
`computeBalancedWatershedProvinces` (strategic-overlays.js): the same watershed
merge driven by combined size — desirability `-(size_a+size_b)/mean +
0.6*borderFrac` always fuses the smallest adjacent pair (border fraction as
tie-break) and merging continues until `max(6, basins/10)` regions remain,
yielding roughly equal-population provinces. Land only. Config:
`balancedWatershedConfig`.
