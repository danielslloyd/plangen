# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PlanGen is a browser-based 3D planet generator that creates procedural worlds with realistic terrain, weather, biomes, and resources. It uses Three.js for 3D rendering and implements a sophisticated stepped-action system for long-running generation processes.

## Running the Application

- Open `PlanGen.html` in a web browser (Chrome/Firefox recommended)
- No build process required - uses CDN dependencies for Three.js and jQuery
- Generation starts automatically or press **Space** to regenerate

## Key Keyboard Controls

- **Space**: Generate new planet
- **1/2/3**: Generate planet with 20/40/60 subdivisions (3 uses large seed)
- **5-9**: Switch render modes (terrain/plates/elevation/temperature/moisture)
- **A/B**: Set pathfinding start/end points
- **J**: Toggle Globe/Mercator projection
- **H**: Toggle elevation exaggeration ("Raised" view) — works in both Globe and Mercator
- **R**: Toggle rivers, **U**: Toggle sunlight, **I/O/P**: Toggle plate boundaries/movements/air currents
- **Arrow keys**: Camera navigation, **Page Up/Down**: Zoom

See **Projection & View Modes** and **Geographic Feature Detection** below for the
view modes and feature overlays added on top of the base render modes.

## Architecture Overview

### Core Generation Pipeline
The planet generation follows a structured pipeline implemented through `SteppedAction` for non-blocking execution:

1. **Geometry Generation** (`geometry.js`): Creates icosahedral mesh with specified subdivisions
2. **Topology Creation**: Builds dual graph structure (tiles/corners/edges) from mesh  
3. **Tectonic Plates** (`generatePlanetTerrain_functions.js`): Assigns continental/oceanic plates
4. **Elevation Generation** (`elevation-generation.js`): Applies exponential distribution with elevation exaggeration
5. **Weather Systems** (`weather-generation.js`): Simulates heat/moisture distribution
6. **Biomes & Resources**: Final assignment based on elevation/temperature/moisture
7. **Render Data Generation** (`generatePlanetRenderData_functions.js`): Creates Three.js geometries

### Key Systems

**SteppedAction Framework** (`SteppedAction.js`):
- Non-blocking execution system for long-running operations
- Uses MessageChannel for background tab compatibility (avoids setTimeout throttling)
- Supports nested sub-actions with proportional progress tracking
- Critical for planet generation to continue when browser tab loses focus

**3D Rendering** (`rendering-3d.js`):
- Three.js-based with perspective camera and directional lighting
- Implements elevation exaggeration via `elevationMultiplier` parameter
- Page Visibility API pauses rendering in background tabs while generation continues
- Segmented arrow rendering for rivers/paths to follow terrain contours

**Debug System** (`debug-overlay.js`):
- Canvas-based elevation histogram overlay
- Real-time tile information display
- Statistical analysis of elevation distribution

### Data Structures

**Planet Object Structure**:
- `tiles[]`: Polygonal regions with elevation, biome, resources
- `corners[]`: Mesh vertices with calculated elevation medians
- `edges[]`: Connections between corners with flow/cost data
- Dual graph structure enables both geometric and topological operations

**Render Modes**:
- `terrain`: Realistic biome coloring
- `elevation`: Height-based visualization  
- `plates`: plain land/water fill + thin black plate-boundary outlines
- `temperature/moisture`: Weather system outputs

## Important Parameters

```javascript
// Key generation settings in planet-generator.js:
subdivisions: 60,           // Mesh complexity (20/40/60)
elevationExponent: 4,       // Exponential curve steepness  
elevationMultiplier: 80,    // 3D terrain exaggeration
riverThreshold: 0.0001,     // Minimum flow for river rendering
plateCount: 36,             // Number of tectonic plates
oceanicRate: 0.7           // Proportion of oceanic plates
```

## Projection & View Modes

The surface is shown in one of four view modes, chosen by the projection buttons
in the control panel or by keys. A mode is the combination of two globals:
`projectionMode` (`"globe"` | `"mercator"`) and `useElevationDisplacement` (bool).

| Mode            | projectionMode | useElevationDisplacement | Button id              |
|-----------------|----------------|--------------------------|------------------------|
| Globe (flat)    | globe          | false                    | `#projectGlobe`        |
| Raised Globe    | globe          | true                     | `#projectRaisedGlobe`  |
| Mercator Map    | mercator       | false                    | `#projectMercatorMap`  |
| Raised Mercator | mercator       | true                     | `#projectRaisedMercator` |

- **Keys**: `J` toggles globe/mercator; `H` toggles elevation exaggeration
  (raised) and applies in both projections.
- **Raised Mercator** lifts land vertices by `elevationDisplacement *
  MERCATOR_ELEVATION_Z_SCALE` (0.04) and bakes a NW hillshade into vertex colors
  (`computeMercatorTileShade`) so relief reads under the flat top-down
  orthographic camera. Rivers/air-currents are lifted to ride on top via
  `mercatorOverlayLayerZ`. (All in `generatePlanetRenderData_functions.js`.)

### Instant projection switching (render-data cache)
Switching modes is ~instant after the first visit. `applyProjectionStateChange`
(`rendering-3d.js`) keeps a per-mode cache on `planet.renderDataCache` keyed by
`projection_raised` (e.g. `globe_flat`, `mercator_raised`). On switch it stashes
the current render data, then either restores the cached entry (swapping scene
objects, recoloring only if the active overlay changed) or generates fresh on
first visit. `displayPlanet` disposes the cache when a new planet loads.
`toggleMercatorProjection`, `toggleElevationExaggeration`, and the four
projection buttons all route through this.

### Mercator horizontal wrapping (seamless scroll)
- One world spans x ∈ [-2π, +2π] in scaled coords (longitude × 2.0), so the
  tiling **period is 4π** (`Math.PI * 4.0`). NOTE: this was previously `8π`
  (a doubled-scale bug) which left blank gaps between copies — do **not**
  reintroduce the `* 2.0`.
- Each mercator render object is a `THREE.Group` of **3 copies** at x = -4π, 0,
  +4π so the view is always covered while panning. Antimeridian-crossing tiles
  are split into left/right versions during the build (`buildSurfaceRenderObject`
  and the other `build*RenderObject` functions).
- `mercatorCameraX` pans freely; `updateMercatorWrapping` wraps it to [-2π, 2π]
  each frame **before** the camera bounds are set (in `updateCamera`). Content
  repeats every 4π so the wrap is invisible.
- `recreateGeometryWithMaterial` (runs on overlay/material swaps) MUST rebuild
  the 3-copy group in mercator, or the map collapses to a single copy and shows
  blank sides.
- **Selection highlight follows the scroll**: the tile-select highlight (and its
  upstream/downstream tiles) is a single mesh; `updateMercatorSelectionWrap`
  (`rendering-3d.js`) sets its `position.x` to the multiple of 4π that lands it on
  the world copy nearest the camera, so it stays visible wherever you have
  scrolled. Called from `selectTile` and every `updateCamera` (mercator branch).
  The viewed world center is `2 * mercatorCameraX` (the camera double-offsets:
  both `camera.position.x` and the L/R frustum bounds are set to
  `mercatorCameraX`), which is why picking in `clickHandler` /
  `pickHoveredTile` uses `2 * mercatorCameraX`.

## Geographic Feature Detection (`feature-detection.js`)

Identifies nested geographic features and exposes them as color overlays with
hover inspection. Land: continent > peninsula > headland > cape. Water: ocean >
bay > inlet > cove. Built on `tile.shore` (signed shore distance, computed in
`post-generation.js`) and `tile.body`; the scalar field is interiorness/openness
`w = |shore|` (high in continent cores & open ocean, low at peninsula tips /
coves, a saddle at narrow necks).

Computed once per planet by `generateFeatureOverlays(planet)`, hooked into
`planet-generator.js` right after `generateDynamicShoreOverlays` (and on the
save/load + GeoJSON-import paths). Must run after shore distances exist.

### Five approaches (each builds a nested per-tile hierarchy)
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
  the surrounding ocean). Operates over ALL tiles (land+water); single-level
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

### Overlays
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

### Tuning sliders (control panel)
The "Feature Detection tuning" `<details>` under the Surface Color Overlay
dropdown shows knobs **only for the active feature overlay** — each approach's
sliders live in a `<div class="fdGroup" data-approach="X">`, and
`updateFeatureControlsVisibility` (called from `setSurfaceRenderMode`) shows the
matching group and hides the whole panel for non-feature overlays. E's group has
a **"Drainage basins"** on/off toggle slider (`fdEFollowBasins`, a 0..1 range)
alongside Max thickness (2..80) and Neck cut width (0..12). The slider wiring
supports `toValue`/`fromValue`/`format` per control (the basins slider maps 0/1 ↔
boolean). The value label updates live while dragging; the heavier recompute
fires on release (`change`), routed through `regenerateFeatureOverlays`. Wired in
`setupFeatureDetectionControls` (`ui-initialization.js`).

### Feature root/node visualization
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

### Hover (only when a feature overlay A or B is active)
Hovering a tile draws a thin black outline around every feature in its hierarchy
(one merged `LineSegments`, antimeridian-corrected and replicated across the 3
mercator copies) and shows a subtle popup label per feature at that feature's
stable root tile. Picking: globe uses `planet.partition.intersectRay`, mercator
finds nearest tile; throttled ~50 ms. `window.__fhDebug` exposes hover internals.

### Classification (rudimentary, `classifyFeature`)
By domain / root / size / elongation (`aspect = size / maxW²`). Connectors
(Strait/Isthmus) also require narrowness (`maxW <= 4`) so large elongated bodies
aren't mislabeled.
- Water: Ocean, Sea, Lake (roots, by size); Gulf, Bay, Inlet, Strait (nested).
- Land: Continent, Island, Islet (roots, by size); Peninsula, Headland, Cape,
  Isthmus (nested).

### Tuning (sliders or console)
Prefer the sliders above; the same knobs are available on `console`.
`featureDetectionConfig` = `{ plateSmooth, plateMinSize (A); maxErosion,
darkenPerLevel (B); lobeEdgeWater, lobeMinSize (C); thicknessMax, neckWidth,
eFollowBasins (E); climateBands, climateMinSize (H) }`. Re-run with
`regenerateFeatureOverlays({...})`; it recomputes, unregisters stale overlay ids,
rebuilds the dropdown, reapplies the current overlay, and rebuilds root markers.
Examples:
```javascript
regenerateFeatureOverlays({ lobeEdgeWater: 55 })        // C: larger lobes
regenerateFeatureOverlays({ neckWidth: 2 })             // E: cut wider straits/isthmuses
regenerateFeatureOverlays({ eFollowBasins: true })      // E: land follows drainage basins
regenerateFeatureOverlays({ thicknessMax: 10 })         // E: deeper width nesting
```

## Common Development Patterns

**Adding New Render Modes**: 
1. Add case in `ui-handlers.js` keyUpHandler()
2. Implement color calculation in `generatePlanetRenderData_functions.js`
3. Update surface render mode switching logic

**Modifying Generation Pipeline**:
- Use `SteppedAction.executeSubaction()` for new processing steps
- Add console timing markers for performance monitoring
- Handle progress updates via `action.loop()` for long operations

**Debugging Elevation Issues**:
- Toggle debug overlay (H key) to view elevation histogram
- Check exponential distribution parameters in `elevation-generation.js`
- Verify corner elevation medians vs tile elevations

## File Dependencies

Core files loaded in order (see `PlanGen.html`):
1. External: jQuery 2.1.0, Three.js r125, ngraph libraries
2. `SteppedAction.js` - Execution framework
3. `geometry.js` - Mesh generation
4. `utilities.js` - Helper functions and math operations
5. `elevation-generation.js` - Terrain algorithms
6. Generation functions (`generatePlanetTerrain_functions.js`, `post-generation.js`, `generatePlanetRenderData_functions.js`)
7. `feature-detection.js` - Hierarchical feature detection + overlays (loaded after render-data functions, before `rendering-3d.js`)
8. `rendering-3d.js` - 3D visualization
9. `weather-generation.js` - Climate simulation
10. `planet-generator.js` - Main coordination
11. UI components (`ui-handlers.js`, `ui-initialization.js`)
12. Additional features (`path-finding.js`, `debug-overlay.js`, `text-labels.js`, `planet-save-load.js`, `earth-recreation.js`)

The codebase uses ES5 JavaScript with global variables and function declarations for browser compatibility.

## Coordinate System

**FIXED**: The coordinate system has been corrected to return proper geographic coordinates.

**Original Problem** (discovered via magenta tile debugging):
- The raw planet used a rotated coordinate system where `phi = 0` was front-facing, not north pole
- `theta` did not represent longitude in the traditional sense
- North pole was at `theta = π/2, phi = π/2` instead of standard coordinates

**Solution Implemented:**
The `cartesianToSpherical()` function now applies axis rotation to return standard geographic coordinates:
```javascript
// Axis rotation to convert to standard geography:
var geo_x = position.z;  // Front-facing becomes prime meridian
var geo_y = position.x;  // Original X becomes 90°E direction
var geo_z = position.y;  // North pole becomes Z-axis

var phi = Math.asin(geo_z / r);      // Standard latitude (-π/2 to π/2)
var theta = Math.atan2(geo_y, geo_x); // Standard longitude (-π to π)
```

**Current Coordinate Mappings** (after fix):
- **Front-facing point (0°,0°)**: `theta = 0, phi = 0` (prime meridian, equator)
- **North pole**: `theta = any, phi = π/2` (90° latitude)
- **South pole**: `theta = any, phi = -π/2` (-90° latitude)
- **90°E meridian**: `theta = π/2, phi = varies`

**Benefits of Fix:**
- Mercator projection works correctly without tile stretching
- All geographic functions (stripes, meridians) work intuitively
- `phi` now properly represents latitude, `theta` represents longitude
- Future coordinate-based features will work as expected

**Debugging Methodology:**
Test specific coordinate ranges with magenta tiles in `generatePlanetRenderData_functions.js`:
```javascript
// Example: Mark specific coordinate region
var thetaDiff = Math.abs(spherical.theta - targetTheta);
var phiDiff = Math.abs(spherical.phi - targetPhi);
if (thetaDiff < 0.2 && phiDiff < 0.2) {
    tile.error = 'test'; // Makes tiles magenta
}
```

## UI System & Customization

**Color System**: Interactive terrain color panel allows real-time customization of:
- Ocean colors (surface/deep, warm/cold variations)
- Land colors (elevation-based dry/wet variations, cold climate colors)
- Export functionality copies color initialization code to clipboard

**Control Panels**:
- Advanced settings panel (`generationSettingsPanel`) for detailed terrain parameters
- Control panel with projection modes (Globe / Raised Globe / Mercator Map / Raised Mercator), color overlays, and display options
- Progress tracking panel for long-running generation operations

**Dynamic UI Updates**: Color overlay dropdown and toggle buttons are populated programmatically based on available render modes. Feature-detection overlays (`featNestedB`, `featLobesC`, `featThicknessE`, `featBioH`) and dynamic shore overlays register themselves and call `populateColorOverlayDropdown()` after each planet is generated.

## Development Environment Notes

- **City labels removed**: the feature work removed all city labels (in
  `collectLabeledTiles`, `rebuildAllLabelsForProjection`, and the `displayPlanet`
  call). `tile.isCity` still exists; only the rendered labels were dropped. The
  "Mount Everest" label is kept.
- **Static-server JS caching**: when serving via a plain static server
  (e.g. `python -m http.server`), the browser caches `.js` files and a normal
  reload may execute stale code. Hard refresh (Ctrl+Shift+R), or force-refetch
  with `fetch(url, { cache: 'reload' })` for each changed file before
  `location.reload()`.
- **Background-tab rendering**: the Page Visibility API pauses
  `requestAnimationFrame` when the tab/preview is not focused, so headless
  screenshots can return blank or time out even though `renderer.render` works.
  Planet generation continues regardless (SteppedAction uses MessageChannel).
- `.claude/launch.json` defines a `plangen-static` preview server on port 8765
  (`python -m http.server 8765`).

## Recent Work (changelog)

- **Mercator**: continuous seamless horizontal scroll (3-copy group, period 4π),
  instant Globe↔Mercator switching via `planet.renderDataCache`, and a new
  **Raised Mercator** relief view. Rendering-only changes — generation untouched.
- **Feature detection** (`feature-detection.js`): nested land/water features
  exposed as color overlays (current set B/C/E/H — see the section above; a wider
  A–H set existed transiently and was trimmed). Distinct hue per feature (B uses
  depth-darkening). Hover outlines + popup labels, rudimentary classification.
  Tunable via **UI sliders** (no console needed) and a **"Show Feature Roots"**
  toggle that draws the feature node-tree (root dot + line to parent) in place.
  Also fixed a latent globe-projection bug where hover outlines collapsed to the
  origin (`p.length()` read after `normalize()`).
- **Mercator selection follows infinite scroll**: the tile-select highlight now
  re-homes onto the world copy nearest the camera each frame
  (`updateMercatorSelectionWrap`), so selecting a tile while scrolled to a far
  copy shows the highlight where you are looking instead of only on the base copy.
- **Feature detection trimmed to B/C/E/H**: removed approaches A, D, F, G and the
  Prominence debug overlay. E gained a NECK CUT (`neckWidth`) so it splits narrow
  straits/isthmuses, and an `eFollowBasins` toggle (folds old F in: land follows
  drainage basins). Feature root markers are now the pole of inaccessibility
  (`assignFeatureMarkers`) instead of the max-field tile.
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