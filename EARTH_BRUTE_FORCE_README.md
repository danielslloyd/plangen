# Earth Brute-Force Recreation System

## Overview

This system creates a saved planet file that faithfully recreates Earth's geographic features tile-by-tile using **maximum detail and variation**. Instead of relying on procedural generation tricks, it directly maps real Earth data to each tile in a high-resolution mesh.

## Configuration

The brute-force Earth generation uses:

- **Subdivisions: 100** - Maximum mesh detail (~60,000+ tiles)
- **Distortion: 100** - Maximum geometric variation for varied tile shapes
- **Seed: `earth-brute-force-v1`** - Consistent seed for reproducibility

This creates a planet with unprecedented detail compared to the original Earth recreation (which used 80 subdivisions with 0 distortion).

## How It Works

### 1. Geometry Generation
- Generates an icosahedral mesh with 100 subdivisions
- Applies maximum distortion (100) to create varied tile shapes
- Results in ~60,000+ polygonal tiles covering the sphere

### 2. Geographic Data Mapping
For each tile, the system:

1. **Converts 3D position to lat/lon coordinates** using the corrected coordinate system
2. **Looks up Earth elevation** based on continental boundaries, mountain ranges, ocean basins, and trenches
3. **Calculates temperature** from latitude, elevation, ocean proximity, and regional climate
4. **Determines moisture/precipitation** from atmospheric circulation, rain shadows, and regional patterns
5. **Assigns biomes** (ocean, desert, tundra, taiga, rainforest, grassland, etc.)

### 3. Geographic Features Included

**Mountain Ranges:**
- Himalayas (up to 8,848m - Mt. Everest)
- Andes (up to 6,900m - Aconcagua)
- Rocky Mountains
- Alps
- Atlas Mountains
- And many more...

**Major Landmasses:**
- Africa (Sahara, Congo Basin, Ethiopian Highlands, East African Rift)
- Eurasia (European plains, Siberian plateau, Tibetan plateau)
- North America (Great Plains, Canadian Shield, Mexican plateau)
- South America (Amazon Basin, Brazilian Highlands, Patagonia)
- Australia (Great Dividing Range, Outback)
- Antarctica (ice sheet and Transantarctic Mountains)

**Ocean Features:**
- Mariana Trench (-10,994m - deepest point)
- Mid-Atlantic Ridge
- Pacific trenches
- Ocean depth variations by region

**Climate Zones:**
- Tropical rainforests (Amazon, Congo, Southeast Asia)
- Deserts (Sahara, Arabian, Gobi, Atacama, Australian Outback)
- Temperate forests (North America, Europe)
- Boreal forests (Canada, Siberia)
- Tundra and polar regions
- Monsoon regions

### 4. File Generation

The system automatically saves the planet as:
- **Filename:** `earth-brute-force-detail100-distortion100.json`
- **Format:** Full planet format (includes all topology data)
- **Size:** ~10-20 MB (varies based on final tile count)
- **Loading:** Instant load without regeneration required

## Usage

### Generating the Planet

1. Open `PlanGen.html` in a web browser
2. Look for the **"Earth Recreation (Brute Force)"** section in the control panel
3. Click **"Generate Earth (Brute Force)"** button
4. Confirm the generation (warning about 3-5 minute generation time)
5. Wait for generation to complete
6. Planet file will auto-download

**Generation Time:** 3-5 minutes depending on your system
**Memory Usage:** High - this creates a very detailed mesh

### Loading the Planet

1. Open `PlanGen.html`
2. Use the load planet button in the UI
3. Select the `earth-brute-force-detail100-distortion100.json` file
4. Planet loads instantly (no regeneration needed)

## Technical Details

### Coordinate System

Uses the corrected geographic coordinate system from CLAUDE.md:
- **Axis rotation** converts sphere positions to standard geography
- **Prime meridian (0°,0°)** faces front
- **North pole** at 90° latitude
- **Longitude** from -180° to +180°
- **Latitude** from -90° to +90°

### Data Structures

Each tile contains:
- `elevation` - Normalized elevation (-1 to 1)
- `temperature` - Temperature factor (0 to 1)
- `moisture` - Precipitation/moisture level (0 to 1)
- `biome` - Assigned biome type
- `latitude` - Geographic latitude in degrees
- `longitude` - Geographic longitude in degrees
- Standard topology data (corners, borders, neighbors)

### Elevation Scaling

Earth elevation is converted to normalized scale:
- **Real range:** -10,994m (Mariana Trench) to +8,848m (Mt. Everest)
- **Normalized range:** -1 to +1 (roughly ±10,000m)
- **Rendering:** Uses `elevationMultiplier` parameter for 3D exaggeration

## Advantages Over Procedural Generation

1. **Geographic Accuracy** - Real Earth features in correct locations
2. **No Randomness** - Consistently reproduces Earth
3. **High Detail** - 100 subdivisions provide fine resolution
4. **Instant Loading** - Full format loads without regeneration
5. **Editability** - Can be further edited in planet editor
6. **Maximum Variation** - Distortion level 100 creates varied tile geometry

## File Size Optimization

The save system applies several optimizations:
- Rounds positions to 5 decimals (~1cm precision)
- Rounds elevations to 4 decimals
- Rounds temperature/moisture to 3 decimals
- Stores only IDs for object references
- Omits computed properties that can be recalculated

Even with these optimizations, the file is 10-20 MB due to the high tile count.

## Future Enhancements

Potential improvements:
- Even higher resolution (150+ subdivisions)
- More detailed elevation data (integrate with real DEM data)
- Rivers mapped to real river systems
- Cities and labels for major locations
- Tectonic plate boundaries matching real plates
- More nuanced biome classification

## Code Location

- **Main generator:** `earth-recreation.js` (`generateEarthPlanet()` function)
- **Geographic data functions:**
  - `getEarthElevation()` - Elevation lookup
  - `getEarthTemperature()` - Temperature calculation
  - `getEarthMoisture()` - Precipitation/moisture
  - `getEarthBiome()` - Biome assignment
- **Save/Load system:** `planet-save-load.js`

## Version History

- **v1 (earth-recreation-v1):** Original version with 80 subdivisions, 0 distortion
- **v2 (earth-brute-force-v1):** Brute-force version with 100 subdivisions, 100 distortion, enhanced biome assignment

---

**Note:** This system creates a static snapshot of Earth. For procedurally generated Earth-like planets with variation, use the standard planet generation with Earth-like settings.
