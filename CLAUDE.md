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
- **H**: Toggle debug overlay with elevation histogram
- **R**: Toggle rivers, **U**: Toggle sunlight, **I/O/P**: Toggle plate boundaries/movements/air currents
- **Arrow keys**: Camera navigation, **Page Up/Down**: Zoom

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
- `plates`: Tectonic plate boundaries
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
6. Generation functions (`generatePlanetTerrain_functions.js`, `generatePlanetRenderData_functions.js`)
7. `rendering-3d.js` - 3D visualization
8. `weather-generation.js` - Climate simulation
9. `planet-generator.js` - Main coordination
10. UI components (`ui-handlers.js`, `ui-initialization.js`)
11. Additional features (`path-finding.js`, `debug-overlay.js`, `text-labels.js`)

The codebase uses ES5 JavaScript with global variables and function declarations for browser compatibility.

## Coordinate System

**CRITICAL**: The planet uses a rotated coordinate system that differs from traditional geographic orientation.

**Verified Coordinate Mappings** (confirmed via magenta tile debugging):
- **Front-facing point (0°,0°)**: `phi = 0` (what user sees when planet loads)
- **North pole**: `theta = π/2, phi = π/2`
- **South pole**: `theta = -π/2, phi = π/2` (or `theta = 3π/2, phi = π/2`)
- **Backside (180° from front)**: `theta = 0 or ±π, phi = π`

**Key Insights:**
- The sphere is rotated 90° from traditional geographic orientation
- `phi = 0` is the front-facing point, NOT the north pole
- `phi = π/2` corresponds to the actual north/south poles
- `theta` varies around the "equator" perpendicular to traditional orientation

**Implications for Development:**
- The `cartesianToMercator()` function in `utilities.js` needs correction based on this orientation
- Meridian selection requires understanding that traditional lat/lon assumptions don't apply
- The current Mercator projection math assumes wrong coordinate orientation, causing tile stretching
- For debugging coordinates, use narrow ranges around specific theta/phi values rather than broad bands

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
- Control panel with projection modes (Globe/Raised Globe/Mercator), color overlays, and display options
- Progress tracking panel for long-running generation operations

**Dynamic UI Updates**: Color overlay dropdown and toggle buttons are populated programmatically based on available render modes.