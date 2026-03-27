# PlanGen Codebase Review

## Table of Contents

- [Project Overview](#project-overview)
- [Architecture](#architecture)
- [File Inventory](#file-inventory)
- [Generation Pipeline](#generation-pipeline)
- [Key Data Structures](#key-data-structures)
- [Rendering System](#rendering-system)
- [UI System](#ui-system)
- [External Dependencies](#external-dependencies)
- [Code Patterns & Conventions](#code-patterns--conventions)
- [Performance Improvement Suggestions](#performance-improvement-suggestions)
- [Enhancement Suggestions](#enhancement-suggestions)

---

## Project Overview

PlanGen is a browser-based 3D procedural planet generator built with Three.js, jQuery, and vanilla ES5 JavaScript. It creates realistic worlds with tectonic plates, elevation, weather systems, biomes, resources, rivers, and watersheds. The application runs entirely client-side with no build process -- just open `PlanGen.html` in a browser.

**Total codebase**: ~18,000 lines across 20 JavaScript files, 2 HTML entry points, 3 CSS files, and 5 documentation files.

---

## Architecture

```
PlanGen.html (Entry Point)
    |
    +-- External Dependencies (CDN)
    |   +-- jQuery 2.1.0
    |   +-- Three.js r125
    |   +-- ngraph (graph + pathfinding)
    |
    +-- Framework Layer
    |   +-- utilities.js          (RNG, Signal system, math helpers)
    |   +-- SteppedAction.js      (Non-blocking execution framework)
    |
    +-- Geometry & Topology
    |   +-- geometry.js           (Icosphere mesh + dual graph)
    |   +-- path-finding.js       (A* graph construction)
    |
    +-- Generation Pipeline (sequential via SteppedAction)
    |   +-- generatePlanetTerrain_functions.js  (Plates + stress)
    |   +-- elevation-generation.js             (Elevation algorithms)
    |   +-- weather-generation.js               (Atmosphere simulation)
    |   +-- post-generation.js                  (Biomes, resources, watersheds)
    |   +-- generatePlanetRenderData_functions.js (Render mesh creation)
    |
    +-- Rendering & Display
    |   +-- rendering-3d.js       (Three.js scene, camera, materials)
    |   +-- text-labels.js        (Dynamic text sprite labels)
    |   +-- debug-overlay.js      (Canvas-based analytics overlay)
    |
    +-- User Interface
    |   +-- ui-initialization.js  (DOM setup, color picker system)
    |   +-- ui-handlers.js        (Keyboard/mouse input)
    |   +-- planet-generator.js   (Main coordinator)
    |
    +-- Persistence
    |   +-- planet-save-load.js   (JSON/GeoJSON serialization)
    |
    +-- Standalone Tools
        +-- planet-editor.html/.js  (Separate tile editor application)
        +-- earth-recreation.js     (Earth-like planet recreation)
```

**Execution flow**: HTML loads -> jQuery ready -> `ui-initialization.js` builds DOM -> user presses Space -> `generatePlanetAsynchronous()` chains subactions via `SteppedAction` -> geometry -> topology -> plates -> elevation -> weather -> biomes -> render data -> Three.js displays result.

---

## File Inventory

| File | Lines | Purpose |
|------|------:|---------|
| **Core Generation** | | |
| `planet-generator.js` | 1,068 | Main orchestrator coordinating the full pipeline |
| `generatePlanetTerrain_functions.js` | 1,153 | Tectonic plate assignment, drift, boundary stress |
| `generatePlanetRenderData_functions.js` | 2,880 | Vertex color calculation, Three.js geometry building |
| `elevation-generation.js` | 583 | Elevation algorithms, exponential distribution reshaping |
| `weather-generation.js` | 272 | Air currents, heat/moisture distribution |
| `post-generation.js` | 1,618 | Watersheds, biomes, K-means regions, resources |
| **Geometry & Utilities** | | |
| `geometry.js` | 1,124 | Icosphere mesh, dual graph, coordinate math |
| `utilities.js` | 320 | XorShift128 RNG, Signal event system, helpers |
| `SteppedAction.js` | 179 | Non-blocking async execution framework |
| **Rendering** | | |
| `rendering-3d.js` | 869 | Three.js scene, camera, materials, projections |
| `text-labels.js` | 266 | Dynamic label sprite generation |
| `debug-overlay.js` | 512 | Canvas debug UI, elevation histogram |
| **UI** | | |
| `ui-initialization.js` | 854 | DOM setup, color picker, control panels |
| `ui-handlers.js` | 277 | Keyboard/mouse event handlers |
| **Features** | | |
| `path-finding.js` | 367 | A* pathfinding with terrain costs |
| `planet-save-load.js` | 1,169 | Save/load in JSON and GeoJSON formats |
| `planet-editor.js` | 612 | Standalone editor for tile-level editing |
| `earth-recreation.js` | 743 | Earth-like planet recreation system |
| **Third-party** | | |
| `jquery.mousewheel.js` | 139 | jQuery mousewheel plugin |
| **Entry Points** | | |
| `PlanGen.html` | 258 | Main application HTML |
| `planet-editor.html` | 362 | Editor application HTML |

---

## Generation Pipeline

### Phase 1: Geometry (geometry.js)

Generates an icosahedral geodesic sphere at configurable subdivision levels (20/40/60). Constructs the dual graph: mesh vertices become Voronoi cell corners, mesh faces become tiles (polygonal regions), and mesh edges become borders connecting adjacent tiles. All positions are normalized to a unit sphere.

### Phase 2: Tectonic Plates (generatePlanetTerrain_functions.js)

- Randomly selects seed tiles and flood-fills to assign every tile to a plate
- Distributes plates as oceanic (70% default) or continental
- Generates random drift axes and rotation rates per plate
- Identifies plate boundary corners and borders
- Calculates convergent pressure and shear stress at boundaries

### Phase 3: Elevation (elevation-generation.js)

1. **Boundary stress**: Pressure/shear at plate boundaries determines mountain ranges, rift valleys, subduction zones
2. **Stress blur**: Multiple iterations smooth values across neighboring corners
3. **Interior propagation**: BFS from boundaries inward with elevation falloff
4. **Distribution reshaping**: Optionally re-normalizes land elevations to exponential curve (mountains rarer, plains common)
5. **Corner medians**: Each corner elevation = median of adjacent tile elevations; coastal corners forced to sea level

### Phase 4: Weather (weather-generation.js)

1. **Air currents**: Random atmospheric whorls (Hadley cells, jet streams) generate wind vectors at each corner
2. **Heat distribution**: Latitude + elevation -> initial temperature; heat flows downwind
3. **Moisture distribution**: Ocean tiles emit moisture; flows downwind, condenses at elevation

### Phase 5: Drainage & Watersheds (post-generation.js)

- Each tile identifies its drain (lowest neighbor) forming a drainage tree
- Tiles with sufficient accumulated flow become rivers
- Lake detection at terrain sinks
- Watershed regions group tiles by drainage basin to ocean

### Phase 6: Biomes & Resources (post-generation.js)

- **Biomes**: Ocean/glacier/lake/land types based on elevation + temperature + moisture
- **Agriculture**: Wheat/corn/rice/pasture/timber yields from climate
- **Minerals**: Iron/oil/copper/gold/bauxite via Fibonacci noise + tectonic proximity
- **Cities**: Highest-calorie tiles selected as city locations

### Phase 7: Render Data (generatePlanetRenderData_functions.js)

- Per-vertex color calculation for the active overlay mode
- Three.js `BufferGeometry` construction for the planet surface
- Overlay meshes: river arrows, plate boundaries, air current vectors, text labels

---

## Key Data Structures

### Planet Object (global)

```
planet.seed               - Generation seed
planet.topology.tiles[]   - Voronoi cells (primary terrain units)
planet.topology.corners[] - Mesh vertices (dual graph nodes)
planet.topology.edges[]   - Border connections
planet.topology.plates[]  - Tectonic plates
planet.topology.watersheds[] - River drainage basins
planet.renderData         - Three.js geometries and materials
planet.random             - Seeded XorShift128 RNG
planet.partition          - Spatial index for raycasting
planet.graph              - ngraph instance for pathfinding
```

### Tile (Voronoi Cell)

Each tile holds topology (neighbors, corners, borders), terrain (elevation, plate, shore distance), climate (temperature, moisture), drainage (drain, upstream, downstream, lake, river), biome, resources (wheat, corn, rice, fish, iron, oil, gold, etc.), and labels.

### Corner (Mesh Vertex)

Holds topology connections, elevation + median, plate membership, boundary stress (pressure, shear), air current vectors and outflow distribution, temperature, and moisture.

### Border (Edge)

Connects two corners and two tiles. Tracks plate boundary status, water flow amount, and pathfinding cost.

### Plate

Contains drift/spin rates, base elevation, oceanic flag, member tiles, and boundary corners/borders.

---

## Rendering System

### Three.js Setup (rendering-3d.js)

- **Renderer**: WebGL with dark blue (0x000033) background
- **Lighting**: Ambient (0.8 intensity) + 4 directional lights; optional orbiting sun
- **Materials**: `MeshPhongMaterial` with vertex colors for surface; `MeshBasicMaterial` for overlays; `SpriteMaterial` for labels

### Projection Modes

| Mode | Camera | Description |
|------|--------|-------------|
| Globe | Perspective | 3D sphere, orbit controls |
| Raised Globe | Perspective | Globe + elevation exaggeration (mountains pop out) |
| Mercator | Orthographic | 2D flat map, infinite horizontal wrapping |

### Color Overlays

Terrain, Elevation, Plates, Temperature, Moisture, Land Regions, Watershed Regions -- each calculated per-vertex in `generatePlanetRenderData_functions.js` and switchable via keyboard (5-9) or dropdown.

---

## UI System

### Control Panels

- **Main Panel**: Projection selector, color overlay dropdown, overlay toggles (sun/rivers/air currents), save/load buttons
- **Advanced Settings**: Subdivisions (4-100), distortion (0-100%), plate count (0-300), oceanic rate, heat/moisture levels, seed input
- **Terrain Colors**: Interactive color pickers for ocean/land colors with export to clipboard
- **Progress Panel**: Action label, progress bar, cancel button
- **FPS Overlay**: Real-time FPS, zoom level, projection mode

### Input Handling

- **Keyboard**: Space (generate), 1-3 (detail), 5-9 (overlays), A/B (pathfinding), H (debug), R/U/I/O/P (toggles), arrows (camera)
- **Mouse**: Click tiles for inspection, drag for Mercator panning, wheel for zoom with smooth animation

---

## External Dependencies

| Library | Version | Purpose |
|---------|---------|---------|
| jQuery | 2.1.0 | DOM manipulation, events |
| Three.js | r125 | 3D WebGL rendering |
| ngraph.graph | 20.0.1 | Graph data structure |
| ngraph.path | 1.3.1 | A* pathfinding |

All loaded via CDN. No build system, package manager, or bundler.

---

## Code Patterns & Conventions

- **ES5 throughout**: Function declarations, `var`, `prototype`-based OOP, no modules
- **Global state**: `planet`, `scene`, `camera`, `renderer`, `generationSettings`, `surfaceRenderMode` are all globals
- **Custom RNG**: `XorShift128` for deterministic, seedable generation
- **Custom events**: `Signal` class for pub/sub (used in SteppedAction)
- **Non-blocking async**: `SteppedAction` with `MessageChannel` for background-tab-safe execution
- **Naming**: `generate*()` for creation, `calculate*()` for derivation, `show*()/hide*()` for UI toggles

---

## Performance Improvement Suggestions

### P1: Move Color Calculations to GPU Shaders

**Current**: `generatePlanetRenderData_functions.js` (2,880 lines) computes per-vertex colors on the CPU for every overlay mode switch. This is the largest file and the heaviest CPU operation during render data generation.

**Suggestion**: Move color overlay logic into GLSL fragment shaders. Pass elevation, temperature, moisture, plate ID, and biome as vertex attributes or uniforms. The GPU performs per-pixel interpolation natively, enabling instant overlay switching without rebuilding geometry. This would eliminate the most expensive CPU-bound step.

### P2: Web Workers for Generation Phases

**Current**: All generation runs on the main thread. `SteppedAction` prevents UI freezing via cooperative yielding but still competes with rendering for CPU time.

**Suggestion**: Offload compute-heavy phases (plate stress calculation, elevation propagation, weather simulation, watershed BFS) to Web Workers. The topology is serializable as typed arrays. Workers return results; main thread updates the planet object and builds render data. This would roughly halve total generation time on multi-core hardware.

### P3: Use Typed Arrays for Topology Data

**Current**: Tiles, corners, and borders are plain objects with dynamic properties. At 60 subdivisions, there are ~25,000 tiles and ~50,000 corners -- each an individual object with GC overhead.

**Suggestion**: Store tile/corner/border data in `Float32Array` and `Int32Array` buffers with struct-of-arrays layout (e.g., `tileElevations[i]`, `tileMoisture[i]`). Benefits: cache-friendly iteration, zero GC pressure, directly transferable to Web Workers and GPU buffers.

### P4: Cache Corner Elevation Medians

**Current**: Corner elevation medians are recalculated during the elevation phase. Each corner iterates its adjacent tiles, sorts, and picks the median.

**Suggestion**: Compute medians once and cache them. Only recompute when tile elevations change (which only happens during specific generation phases). This eliminates redundant O(corners x tiles) work.

### P5: Batch Label Rendering with Texture Atlas

**Current**: Each text label creates a new HTML5 Canvas, renders text, and converts to a Three.js texture. At 60 subdivisions with city/region labels, this creates dozens of individual textures.

**Suggestion**: Pre-render all labels into a single texture atlas. Use UV coordinates to map label regions to sprites. Reduces draw calls and texture memory fragmentation.

### P6: Spatial Indexing for Raycasting

**Current**: Tile selection uses `THREE.Raycaster.intersectObjects()` against the planet mesh. The built-in partition system could be leveraged more.

**Suggestion**: Build an octree or BVH for the planet surface at generation time. Point-in-polygon queries against Voronoi cells can use the dual graph structure directly (start at nearest tile, walk neighbors). This is O(1) amortized vs O(n) intersection testing.

### P7: Reduce Temporary Array Allocations

**Current**: Hot loops use `.map()`, `.filter()`, `.sort()` chains creating temporary arrays that stress the garbage collector.

**Suggestion**: In performance-critical paths (elevation propagation, weather distribution, render data generation), replace functional chains with explicit `for` loops and pre-allocated buffers. Measure with Chrome DevTools allocation profiler to identify the worst offenders.

### P8: Instanced Rendering for Arrows

**Current**: River, plate movement, and air current arrows are individually constructed as separate geometries.

**Suggestion**: Use `THREE.InstancedMesh` with a single arrow geometry and per-instance transformation matrices. This reduces draw calls from thousands to one per overlay type.

---

## Enhancement Suggestions

### E1: Ocean Current Simulation

Air currents are already modeled but ocean currents are absent. Add a parallel simulation: surface currents driven by wind, deep currents driven by temperature differentials. Visualize as a new overlay mode. This would make moisture/temperature distribution more realistic and add visual richness to ocean areas.

### E2: Climate Zone Overlay

Temperature and moisture are calculated but not organized into named climate zones (tropical rainforest, temperate grassland, polar desert, etc.). Add a Koppen climate classification overlay that maps temperature/moisture/latitude to standard climate zones. Display as a color overlay with a legend.

### E3: Civilization Simulation Layer

The resource and city systems provide a foundation for a basic civilization simulation:
- Population growth based on food calories
- Trade routes using existing pathfinding
- Territory expansion from city tiles outward
- Technology levels affecting resource extraction
- Conflict at territory boundaries

This could run as an optional post-generation phase with time-step controls.

### E4: Touch Controls for Mobile

The UI is desktop-only with keyboard shortcuts. Add:
- Pinch-to-zoom replacing mousewheel
- Two-finger drag for camera rotation
- Tap for tile selection
- Swipe gestures for overlay cycling
- Responsive control panel layout

### E5: Procedural City Generation

Currently only the best city location is identified. Extend to:
- Generate street grids using L-systems or wave function collapse
- Place buildings based on terrain and resource proximity
- Scale city size with surrounding calorie density
- Add road networks between cities using pathfinding

### E6: Planet Comparison Mode

Allow generating two planets side-by-side for comparison:
- Split-screen view with synchronized camera
- Same seed with different parameters to see their effect
- Statistical comparison (% ocean, average elevation, biome distribution)

### E7: Export to Game Engines

Add export formats for:
- **Unity**: Heightmap + biome map as textures, mesh as FBX/OBJ
- **Unreal**: Landscape heightmap format
- **Godot**: Scene file with terrain mesh
- **Generic**: OBJ mesh + PNG texture atlas

### E8: Animated Weather

Currently weather is a static snapshot. Add temporal simulation:
- Rotating storm systems
- Seasonal temperature/moisture shifts (axial tilt)
- Day/night cycle with temperature variation
- Animated cloud layer using moisture data

### E9: Geological History Playback

Show planet formation as an animation:
- Plates drift apart from Pangaea-like starting configuration
- Mountains rise at convergent boundaries
- Erosion gradually lowers peaks
- Rivers carve valleys over time
- Scrubber control to move through geological time

### E10: IndexedDB Persistence & Planet Gallery

Replace localStorage with IndexedDB for:
- Storing multiple full-detail planets (1-5 MB each)
- Thumbnail previews in a gallery view
- Tags and search for saved planets
- Import/export collections as ZIP archives

### E11: Biome-Specific Terrain Textures

Replace flat vertex colors with procedural or tiled textures:
- Sand patterns for deserts
- Tree canopy for forests
- Snow/ice for glaciers
- Rock faces for mountains
- Water caustics for shallow ocean

Use Three.js `ShaderMaterial` with texture blending based on biome + elevation.

### E12: Sound Design

Add ambient audio that responds to the current view:
- Ocean waves when viewing coastlines
- Wind when zoomed into mountains
- Rain in high-moisture regions
- Volume based on zoom level
- Web Audio API for procedural mixing

### E13: ES Module Migration

Modernize the codebase incrementally:
- Convert globals to ES module exports/imports
- Add a lightweight bundler (esbuild or Vite) for development
- Enable tree-shaking to reduce load size
- Add TypeScript types gradually via JSDoc annotations
- This unblocks code splitting, lazy loading, and better tooling

### E14: Configurable Render Quality

Add a quality slider affecting:
- Subdivision level auto-selection based on GPU capability
- Shadow quality (currently no shadows)
- Anti-aliasing level
- Texture resolution for labels
- LOD (level of detail) for distant terrain when zoomed out
