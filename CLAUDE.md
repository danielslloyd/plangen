# CLAUDE.md

Guidance for Claude Code when working in this repo. This file is a lean index;
deep-dives live in `docs/` (see **Deep-dive docs** below) — read those only when
working in that area.

## Project Overview

PlanGen is a browser-based 3D planet generator that creates procedural worlds with
realistic terrain, weather, biomes, and resources. Three.js for rendering; a
`SteppedAction` system runs long generation steps without freezing the tab.

## Running the Application

- Open `PlanGen.html` in a browser (Chrome/Firefox). No build step — CDN deps.
- Generation starts automatically or press **Space** to regenerate.
- `.claude/launch.json` defines a `plangen-static` preview server on port 8765
  (`python -m http.server 8765`); load `http://localhost:8765/PlanGen.html`.

## Key Keyboard Controls

- **Space**: new planet. **1/2/3**: 20/40/60 subdivisions (3 uses large seed).
- **5-9**: base render modes (terrain/plates/elevation/temperature/moisture).
- **A/B**: pathfinding start/end. **Arrow keys**: camera; **Page Up/Down**: zoom.
- **J**: Globe/Mercator. **H**: elevation exaggeration ("Raised", both projections).
- **R** rivers, **U** sun, **I/O/P** plate boundaries/movements/air currents.
- Surface overlays are also chosen from the control-panel dropdown (filtered by the
  Geography/Food/Resources category buttons), not just keys.

## Deep-dive docs (read on demand)

- `docs/rendering.md` — projection/view modes, render-data cache, mercator
  wrapping, plate/coastline outlines.
- `docs/feature-detection.md` — the A/B/C/E/H feature overlays, tuning sliders,
  roots, hover, classification.
- `docs/coordinate-system.md` — the cartesianToSpherical axis-rotation fix.
- `docs/changelog.md` — recent work, newest first.

## Architecture Overview

### Core generation pipeline (via `SteppedAction`, non-blocking)
1. **Geometry** (`geometry.js`): icosahedral mesh at N subdivisions.
2. **Topology**: dual graph (tiles/corners/edges) from the mesh.
3. **Tectonic plates** (`generatePlanetTerrain_functions.js`): continental/oceanic.
4. **Elevation** (`elevation-generation.js`): exponential distribution + exaggeration.
5. **Weather** (`weather-generation.js`): heat/moisture.
6. **Biomes & resources**: from elevation/temperature/moisture.
7. **Render data** (`generatePlanetRenderData_functions.js`): Three.js geometries.
8. **Post + features** (`post-generation.js`, `feature-detection.js`): shore
   distances, overlays.

### Key systems
- **SteppedAction** (`SteppedAction.js`): non-blocking long ops; uses MessageChannel
  so generation continues in a backgrounded tab (avoids setTimeout throttling).
- **3D rendering** (`rendering-3d.js`): perspective (globe) / orthographic
  (mercator) camera; Page Visibility API pauses `requestAnimationFrame` in
  background tabs (generation continues). See `docs/rendering.md`.
- **Color overlays**: registry in `generatePlanetRenderData_functions.js`
  (`registerColorOverlay(id, name, desc, fn, materialType, computationType,
  category)`); resource/food overlays live in `resource-overlays.js`. Expensive
  per-overlay aggregates are memoized via `getOverlayAggregate` (avoids O(N²)).
- **Debug overlay** (`debug-overlay.js`): elevation histogram + tile info.

### Data structures
- Planet: `tiles[]` (elevation, biome, resources, shore, hierarchyA/B/C/E/H),
  `corners[]` (elevation medians), `edges[]` (flow/cost). Dual graph.
- Base render modes: `terrain`, `elevation`, `plates` (land/water fill + black
  plate outline), `temperature`, `moisture`.

## Important Parameters

```javascript
// planet-generator.js
subdivisions: 60,        // Mesh complexity (20/40/60)
elevationExponent: 4,    // Exponential curve steepness
elevationMultiplier: 80, // 3D terrain exaggeration
riverThreshold: 0.0001,  // Min flow for river rendering
plateCount: 36,          // Tectonic plates
oceanicRate: 0.7         // Proportion of oceanic plates
```

## Projection & View Modes (summary — see `docs/rendering.md`)

Four modes = `projectionMode` (`globe`|`mercator`) × `useElevationDisplacement`
(bool): Globe, Raised Globe, Mercator Map, Raised Mercator. Switching is ~instant
via a per-mode `planet.renderDataCache`. Mercator scrolls seamlessly (3-copy group,
period 4π); up/down arrows reversed (up = north).

## Geographic Feature Detection (summary — see `docs/feature-detection.md`)

`generateFeatureOverlays(planet)` builds nested land/water features as color
overlays (approaches **A** plate provinces, **B** erosion, **C** lobes, **E**
thickness, **H** bioregions), each a `tile.hierarchyX` array. Tunable live via the
"Feature Detection tuning" sliders or `regenerateFeatureOverlays({...})`.

## Common Development Patterns

- **New render mode**: add the overlay via `registerColorOverlay` (in
  `generatePlanetRenderData_functions.js` or `resource-overlays.js`) with a
  `category`; keyboard shortcuts (optional) live in `ui-handlers.js` keyUpHandler().
  Color fns are called once per tile per recolor — never iterate all tiles inside
  one; precompute via `getOverlayAggregate`.
- **New generation step**: use `SteppedAction.executeSubaction()`; report progress
  with `action.loop()`.

## File Dependencies

Loaded in order (see `PlanGen.html`):
1. External: jQuery 2.1.0, Three.js r125, ngraph.
2. `SteppedAction.js`, `geometry.js`, `utilities.js`, `elevation-generation.js`
3. Generation: `generatePlanetTerrain_functions.js`, `post-generation.js`,
   `generatePlanetRenderData_functions.js`, `resource-overlays.js`
4. `feature-detection.js` (after render-data, before rendering)
5. `rendering-3d.js`, `weather-generation.js`, `planet-generator.js`
6. UI: `ui-handlers.js`, `ui-initialization.js`
7. Extras: `path-finding.js`, `debug-overlay.js`, `text-labels.js`,
   `planet-save-load.js`, `earth-recreation.js`

ES5 JavaScript with global vars and function declarations (browser-global, no
modules) — load order matters for top-level executable statements (e.g. overlay
registrations), but function declarations are hoisted per file.

## UI System & Customization

- **Terrain color panel**: live ocean/land color editing; "Export Colors" copies
  init code to clipboard.
- **Control panel**: projection buttons, the category-filtered overlay dropdown +
  feature-tuning sliders, Overlay Display Options (Sun/Rivers/Air Currents/Coastline).
- **Dynamic dropdown**: overlays register themselves and call
  `populateColorOverlayDropdown()` after each planet; it shows only the active
  category. `setSurfaceRenderMode` syncs the category when an overlay is selected
  outside the dropdown (e.g. keyboard).

## Development Environment Notes

- **City labels removed**: only rendered labels were dropped (`tile.isCity`
  remains); the "Mount Everest" label is kept.
- **Static-server JS caching**: a plain static server caches `.js`; hard refresh
  (Ctrl+Shift+R) or `fetch(url, { cache: 'reload' })` before `location.reload()`.
- **Background-tab rendering**: Page Visibility API pauses rendering when the
  tab/preview is unfocused, so headless screenshots can time out even though
  `renderer.render` works — prefer `preview_eval` for state checks. Generation
  continues regardless.
