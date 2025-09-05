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
1. External: jQuery, Three.js r68, ngraph libraries
2. `SteppedAction.js` - Execution framework
3. `planet-generator.js` - Main coordination
4. `geometry.js` - Mesh generation  
5. `elevation-generation.js` - Terrain algorithms
6. `rendering-3d.js` - 3D visualization
7. Generation functions, UI handlers, utilities

The codebase uses ES5 JavaScript with global variables and function declarations for browser compatibility.