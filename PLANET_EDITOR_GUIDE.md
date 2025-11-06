# Planet Editor Guide

## Overview

The Planet Editor is an advanced tool for manually editing planet data tile-by-tile. It provides intuitive interfaces for modifying elevation, wind patterns, temperature, and moisture across your generated planets.

## Features

### 🎨 Edit Modes

1. **Elevation Editing** - Modify terrain height tile-by-tile
2. **Wind Editing** - Paint wind/air current patterns with brush tool
3. **Temperature Editing** - Adjust temperature values per tile
4. **Moisture Editing** - Modify moisture levels per tile

### 🖱️ Controls

**Camera Navigation:**
- Arrow Keys - Rotate camera around planet
- Mouse Wheel - Zoom in/out
- ESC - Clear selection

**Editing:**
- Click - Select tile (all modes)
- Click & Drag - Paint wind (wind mode only)

## Getting Started

### 1. Generate an Earth-like Planet

First, generate a planet in the main PlanGen application:

```javascript
// In PlanGen.html console or via UI:
generationSettings.subdivisions = 60;
generationSettings.distortionLevel = 0.6;
generationSettings.plateCount = 15;
generationSettings.oceanicRate = 0.71;
generationSettings.heatLevel = 1.0;
generationSettings.moistureLevel = 1.0;
generationSettings.seed = "earth-like";
generatePlanetAsynchronous();
```

Or load the provided `earth-like-config.json` file.

### 2. Save Planet as Full Format

**Important:** The editor requires FULL format planet files.

1. In PlanGen, click "Save Full" button
2. File downloads as `planet-{seed}-full.json`
3. This file contains complete topology data needed for editing

### 3. Open Planet Editor

1. Open `planet-editor.html` in your browser
2. Click "Load Planet" button
3. Select your saved full format `.json` file
4. Planet loads and displays in 3D view

## Edit Modes

### Elevation Editing

**Purpose:** Modify terrain height to create mountains, valleys, or flatten areas.

**How to Use:**
1. Click "Elevation" button in Edit Mode section
2. Click on any tile to select it
3. Use slider or input field to set new elevation value
   - Range: -1.0 (deep ocean) to 1.0 (high mountain)
   - Typical ocean: -0.5 to 0.0
   - Typical land: 0.0 to 0.8
   - Mountains: 0.8 to 1.0
4. Click "Apply" to update the tile
5. Changes appear immediately in 3D view

**Tips:**
- Use small increments (±0.1) for smooth transitions
- Adjacent tiles should have similar elevations for natural terrain
- Negative values = underwater, positive = land

### Wind/Air Current Editing

**Purpose:** Paint wind patterns across multiple tiles with smooth blending.

**How to Use:**
1. Click "Wind/Air" button in Edit Mode section
2. Set wind direction using X, Y, Z inputs:
   - X: East-West wind (-/+)
   - Y: Vertical wind (up/down)
   - Z: North-South wind (-/+)
3. Adjust brush size (1-10 tiles)
4. Adjust blend strength (10%-100%)
5. Click and drag on tiles to paint wind pattern
6. Wind is automatically blended based on distance from click point

**Brush Settings:**
- **Brush Size**: Number of tiles affected from center
  - Size 1: Single tile only
  - Size 3: Center + 2 rings of neighbors (default)
  - Size 10: Large area affected
- **Blend Strength**: How much new wind affects existing wind
  - 10%: Subtle modification
  - 50%: Balanced blending (default)
  - 100%: Complete replacement

**Wind Direction Examples:**
- East wind: X=1, Y=0, Z=0
- North wind: X=0, Y=0, Z=1
- Updraft: X=0, Y=1, Z=0
- Northeast: X=0.7, Y=0, Z=0.7

**Tips:**
- Start with low blend strength (20-30%) for subtle changes
- Use brush size 3-5 for natural wind patterns
- Paint in broad strokes following latitude lines
- Create circulation patterns by painting curved paths

### Temperature Editing

**Purpose:** Adjust temperature values to modify climate zones.

**How to Use:**
1. Click "Temperature" button in Edit Mode section
2. Click on any tile to select it
3. Use slider or input to set new temperature value
   - Range: 0.0 (coldest) to 1.0 (hottest)
   - Polar: 0.0 to 0.2
   - Temperate: 0.3 to 0.6
   - Tropical: 0.7 to 1.0
4. Click "Apply" to update the tile

**Tips:**
- Temperature generally decreases toward poles
- High elevations should be cooler
- Ocean tiles moderate temperature

### Moisture Editing

**Purpose:** Adjust moisture levels to create deserts or rainforests.

**How to Use:**
1. Click "Moisture" button in Edit Mode section
2. Click on any tile to select it
3. Use slider or input to set new moisture value
   - Range: 0.0 (driest) to 1.0 (wettest)
   - Desert: 0.0 to 0.2
   - Grassland: 0.3 to 0.5
   - Rainforest: 0.7 to 1.0
4. Click "Apply" to update the tile

**Tips:**
- Coastal areas typically have higher moisture
- Rain shadow effect: low moisture behind mountains
- Moisture affects biome classification

## View Options

### Wireframe Mode
- Toggle with "Wireframe" button
- Shows tile boundaries clearly
- Useful for precise editing

### Labels Mode
- Toggle with "Labels" button
- Shows city names and geographic labels
- (Feature requires implementation)

## Saving Your Work

**Important:** Always save after making edits!

1. Click "Save Planet" button
2. File saves as `planet-{seed}-edited-full.json`
3. File includes all your edits
4. Can be reloaded in editor for further editing
5. Can be loaded in main PlanGen viewer

## Workflow Examples

### Example 1: Create Mountain Range

1. Load planet in editor
2. Select Elevation mode
3. Find desired location by rotating camera
4. Click tiles along intended mountain range
5. Set elevation to 0.9-1.0
6. Apply to each tile
7. Adjacent tiles: gradually decrease elevation (0.8, 0.6, 0.4...)
8. Save edited planet

### Example 2: Add Trade Wind Pattern

1. Load planet in editor
2. Select Wind mode
3. Set direction to easterly: X=1, Y=0, Z=0
4. Set brush size to 5 tiles
5. Set blend strength to 40%
6. Click and drag along tropical latitude (10-20° from equator)
7. Repeat for southern hemisphere
8. Save edited planet

### Example 3: Create Desert Region

1. Load planet in editor
2. Select Moisture mode
3. Find inland area away from coast
4. Click tiles in desired desert location
5. Set moisture to 0.1
6. Apply to multiple tiles
7. Select Temperature mode
8. Set temperature to 0.8 (hot)
9. Apply to same region
10. Save edited planet

### Example 4: Modify Climate Zone

1. Load planet in editor
2. Select Temperature mode
3. Identify target climate zone
4. Adjust temperature values:
   - Cooler climate: decrease by 0.2
   - Warmer climate: increase by 0.2
5. Select Moisture mode
6. Adjust moisture as needed
7. Planet will recalculate biomes
8. Save edited planet

## Technical Details

### File Format

The editor uses **full format** planet files exclusively. These contain:
- Complete topology (tiles, corners, borders)
- All terrain properties (elevation, temperature, moisture)
- Weather patterns (air currents, pressure)
- Resource data
- Biome classifications

### Visual Regeneration

When you apply edits, the editor automatically:
1. Updates tile/corner properties
2. Regenerates 3D geometry
3. Recalculates colors based on new values
4. Updates display immediately

### Wind Blending Algorithm

Wind editing uses distance-based blending:

```
For each tile in brush radius:
  distance = tile distance from click point
  blendFactor = 1.0 - (distance / brushSize)
  blendFactor *= blendStrength

  newWind = lerp(currentWind, paintedWind, blendFactor)
```

This creates smooth transitions from center to edge of brush.

### Performance Considerations

- **Small Edits**: Instant visual update
- **Large Brush**: May take 1-2 seconds
- **File Size**: Edited files same size as original
- **Memory**: Entire planet kept in memory during editing

## Limitations

### Current Limitations

1. **File Format**: Only full format supported (not minimal)
2. **Undo/Redo**: Not implemented (save frequently!)
3. **Multi-tile Selection**: Single tile or brush only
4. **Biome Editing**: No direct biome selection (use temperature/moisture)
5. **Resource Editing**: Not yet implemented
6. **Copy/Paste**: Not available

### Future Enhancements

Planned features:
- Undo/redo system
- Multi-tile selection (box select, lasso)
- Biome override option
- Resource editing tools
- Terrain smoothing tools
- Copy/paste tile properties
- Symmetry painting (mirror mode)
- History panel showing all edits

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Arrow Up | Rotate camera up |
| Arrow Down | Rotate camera down |
| Arrow Left | Rotate camera left |
| Arrow Right | Rotate camera right |
| ESC | Clear selection/cancel edit |
| Scroll Wheel | Zoom in/out |

## Troubleshooting

### "Please load a FULL format planet file"

**Problem:** Attempting to load minimal format file.

**Solution:**
1. Load minimal file in main PlanGen first
2. Let it generate completely
3. Save as Full format
4. Load that file in editor

### Visual Updates Not Appearing

**Problem:** Changes not visible after applying.

**Solution:**
1. Check if Apply button was clicked
2. Rotate camera slightly to force redraw
3. Reload planet if issue persists

### Brush Not Working

**Problem:** Wind brush doesn't affect tiles.

**Solution:**
1. Verify Paint Mode button is active (lit up)
2. Ensure wind direction values are non-zero
3. Try increasing blend strength
4. Check brush size isn't set to 0

### Planet Appears Black/Blank

**Problem:** Planet loaded but not visible.

**Solution:**
1. Zoom out using scroll wheel
2. Rotate camera with arrow keys
3. Check file loaded correctly (see console)
4. Verify file is full format with render data

### Selection Not Registering

**Problem:** Clicking tiles doesn't select them.

**Solution:**
1. Ensure planet is fully loaded
2. Verify edit mode is selected
3. Try clicking near tile centers
4. Check console for JavaScript errors

## Tips & Best Practices

### General Tips

1. **Save Frequently**: No undo, so save before major changes
2. **Small Steps**: Make gradual changes for natural results
3. **Test Early**: Check results in main viewer periodically
4. **Keep Originals**: Save unedited planet as backup
5. **Name Clearly**: Use descriptive filenames for edited versions

### Elevation Tips

1. **Gradual Slopes**: Change elevation gradually between tiles
2. **Coastal Transition**: Use -0.1 to 0.1 for realistic coastlines
3. **Mountain Ranges**: Create connected high-elevation tiles
4. **Valleys**: Surrounded by higher elevation tiles
5. **Plateaus**: Groups of tiles with same elevation

### Wind Tips

1. **Hadley Cells**: Create tropical circulation patterns
2. **Westerlies**: Mid-latitude winds west to east
3. **Trade Winds**: Tropical winds east to west
4. **Monsoons**: Seasonal wind reversals (requires multiple saves)
5. **Jet Streams**: High-altitude winds at polar boundaries

### Climate Tips

1. **Latitude Effect**: Temperature decreases toward poles
2. **Elevation Effect**: Decrease temperature 0.1 per 500m elevation
3. **Ocean Effect**: Moisture higher near coasts
4. **Rain Shadow**: Low moisture on leeward side of mountains
5. **Continental Interior**: Generally drier than coasts

## Earth-like Planet Configuration

The included `earth-like-config.json` provides a starting point:

**Settings:**
- **Subdivisions**: 60 (good detail level)
- **Distortion**: 0.6 (moderate terrain variation)
- **Plates**: 15 (matching Earth's major plates)
- **Oceanic Rate**: 71% (Earth's water coverage)
- **Heat Level**: 1.0 (standard)
- **Moisture Level**: 1.0 (standard)

**Characteristics:**
- ~71% ocean coverage
- Realistic continent sizes
- Diverse biomes
- Moderate terrain variation
- 15 major tectonic plates

**Using the Configuration:**
1. Load config in PlanGen
2. Generate planet
3. Save as full format
4. Load in editor for fine-tuning

## Advanced Techniques

### Creating Realistic Continents

1. Start with Earth-like configuration
2. Use elevation editing to define coastlines
3. Add mountain ranges along plate boundaries
4. Create interior basins and plateaus
5. Add river valleys (low elevation paths)
6. Adjust moisture for realistic biomes

### Painting Global Wind Patterns

1. **Trade Winds** (0-30° latitude):
   - Direction: East to West (X=-1, Z=0)
   - Brush size: 5
   - Paint along bands north and south of equator

2. **Westerlies** (30-60° latitude):
   - Direction: West to East (X=1, Z=0)
   - Brush size: 5
   - Paint along mid-latitude bands

3. **Polar Easterlies** (60-90° latitude):
   - Direction: East to West (X=-1, Z=0)
   - Brush size: 3
   - Paint near poles

4. **Monsoon Systems**:
   - Create seasonal wind reversals
   - Paint coastal areas with alternating directions
   - Save multiple versions for seasons

### Creating Climate Zones

1. **Polar** (>60° latitude):
   - Temperature: 0.0-0.2
   - Moisture: 0.1-0.3
   - Biomes: Tundra, ice

2. **Temperate** (30-60° latitude):
   - Temperature: 0.3-0.6
   - Moisture: 0.3-0.7
   - Biomes: Forests, grasslands

3. **Tropical** (0-30° latitude):
   - Temperature: 0.7-1.0
   - Moisture: 0.2-1.0
   - Biomes: Rainforest, desert, savanna

## Integration with Main Viewer

Edited planets can be loaded in the main PlanGen viewer:

1. Open `PlanGen.html`
2. Click "Load Planet"
3. Select your edited planet file
4. Planet displays with all your edits
5. All features work (rivers, cities, resources, etc.)

**Features Available:**
- 3D terrain visualization
- Multiple render modes
- Pathfinding
- Statistics
- Export to GeoJSON

## Conclusion

The Planet Editor provides powerful tools for fine-tuning generated planets. Whether you're creating an Earth-like world, designing alien landscapes, or experimenting with climate systems, the editor gives you precise control over every aspect of your planet's terrain and weather.

**Remember:**
- Start with a good generated planet
- Make edits gradually
- Save frequently
- Test in main viewer
- Have fun creating unique worlds!

For questions or issues, check the console (F12) for error messages and refer to the troubleshooting section above.
