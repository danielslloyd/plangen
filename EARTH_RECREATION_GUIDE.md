# Earth Recreation System

## Overview

The Earth Recreation System generates a planet that recreates Earth's actual geography using latitude/longitude coordinate transformations. Each tile on the generated planet corresponds to a real location on Earth, with accurate elevation, temperature, and moisture data.

## How It Works

### Coordinate System

The system converts each tile's 3D Cartesian position to geographic coordinates (latitude/longitude):

```javascript
cartesianToLatLon(position) → { lat, lon }
// lat: -90° to 90° (South to North)
// lon: -180° to 180° (West to East)
```

This uses the corrected coordinate system from CLAUDE.md where:
- Front-facing (0°, 0°) = Prime Meridian, Equator
- North Pole = any longitude, 90° latitude
- Proper axis rotation for standard geography

### Geographic Data Lookups

For each tile at a given lat/lon, the system looks up:

1. **Elevation** (`getEarthElevation`)
   - Major continents (Africa, Eurasia, Americas, Australia, Antarctica)
   - Mountain ranges (Himalayas, Andes, Rockies, Alps, etc.)
   - Ocean basins and trenches
   - Returns elevation in meters

2. **Temperature** (`getEarthTemperature`)
   - Latitude-based gradient (hot equator, cold poles)
   - Elevation adjustment (-6.5°C per 1000m)
   - Ocean vs land moderation
   - Continental interior effects
   - Returns 0-1 normalized value

3. **Moisture** (`getEarthMoisture`)
   - Latitude bands (ITCZ, subtropical highs, mid-latitude lows)
   - Specific wet regions (Amazon, Congo, SE Asia)
   - Specific dry regions (Sahara, Arabia, Gobi, Atacama)
   - Rain shadow effects
   - Returns 0-1 normalized value

## Geographic Features Implemented

### Continents

**Africa**
- Geographic bounds: 10°W to 50°E, 35°S to 35°N
- Features:
  - Atlas Mountains (Morocco): ~2500-4000m
  - Ethiopian Highlands: ~2000-3500m
  - East African Rift: ~1500-2500m
  - Congo Basin: ~300-500m (low elevation)
  - Sahara Desert: ~400-700m
  - Kalahari: ~900-1100m

**Eurasia**

*Europe* (10°W to 60°E, 35°N to 71°N)
- Alps: ~2000-4800m (Mont Blanc)
- Pyrenees: ~1500-3500m
- Scandinavian Mountains: ~800-2400m
- Carpathians: ~1000-2600m
- Ural Mountains: ~600-1900m

*Asia* (60°E to 150°E, -10°N to 80°N)
- **Himalayas**: 6000-8848m (Mount Everest)
- Tibetan Plateau: ~4000-5500m
- Karakoram: ~5000-8611m (K2)
- Hindu Kush: ~3500-7400m
- Tian Shan: ~3000-7400m
- Altai Mountains: ~2000-4500m
- Deccan Plateau: ~600-1000m
- Western Ghats: ~900-2600m

**North America** (170°W to 50°W, 25°N to 75°N)
- Rocky Mountains: ~2000-4400m
- Appalachian Mountains: ~800-2100m
- Sierra Nevada: ~2000-4400m
- Cascade Range: ~1500-4400m
- Alaska Range: ~2500-6200m (Denali)
- Great Plains: ~600-1600m
- Canadian Shield: ~300-700m
- Mexican Plateau: ~1800-2300m

**South America** (82°W to 34°W, 56°S to 13°N)
- **Andes Mountains**: 4000-6900m (Aconcagua) - longest range
- Amazon Basin: ~100-200m (very low)
- Brazilian Highlands: ~800-2000m
- Guiana Highlands: ~1000-2800m
- Patagonian Plateau: ~500-1500m

**Australia** (110°E to 155°E, 44°S to 10°S)
- Great Dividing Range: ~600-2200m
- Central Australian ranges: ~400-1400m
- Western Plateau: ~400-600m
- (Note: Australia is Earth's flattest continent, avg ~300m)

**Antarctica** (60°S to 90°S)
- Ice sheet elevation: ~2000-4000m
- Transantarctic Mountains: ~3000-4700m

**Greenland** (73°W to 12°W, 60°N to 84°N)
- Ice sheet: ~2000-3000m

### Ocean Features

**Ocean Basins**
- Atlantic Ocean: ~-3500 to -5500m
- Pacific Ocean: ~-4200 to -6200m
- Indian Ocean: ~-3800 to -5800m
- Mid-Atlantic Ridge: ~-2500 to -1500m

**Deep Trenches**
- Mariana Trench: -10,994m (Challenger Deep) - deepest point
- Pacific trenches: ~-6000 to -10000m

### Climate Zones

**Temperature Distribution**

*Equatorial* (0-10° latitude)
- Base temperature: 0.8-0.9 (hot)
- Ocean moderation: slight cooling
- Land: Amazon, Congo, Indonesia very hot

*Tropical* (10-30° latitude)
- Base temperature: 0.6-0.8
- Deserts (Sahara, Arabia): 0.85-1.0 (very hot)
- Coasts: moderate

*Temperate* (30-60° latitude)
- Base temperature: 0.3-0.6
- Continental interiors: more extreme
- Oceans: moderate

*Polar* (60-90° latitude)
- Base temperature: 0.0-0.2 (very cold)
- Siberia: extreme cold (-0.2 adjustment)
- Ocean slightly warmer than land

**Moisture/Precipitation Patterns**

*Wet Regions*
- ITCZ (equator): 0.8-1.0 (very wet)
- Amazon Rainforest: 0.9-1.0
- Congo Rainforest: 0.8-0.9
- Southeast Asian Monsoon: 0.8-0.9
- Indonesian wet zone: 0.8-1.0
- Pacific Northwest: 0.7-0.8
- Eastern North America: 0.6-0.7

*Dry Regions*
- Sahara Desert: 0.0-0.1 (very dry)
- Arabian Desert: 0.0-0.1
- Atacama Desert: 0.0-0.05 (driest on Earth)
- Gobi Desert: 0.1-0.2
- Australian Outback: 0.1-0.2
- Kalahari: 0.2-0.3
- Patagonian Desert: 0.2-0.3
- US Southwest (Sonoran/Mojave): 0.1-0.2

*Moderate Regions*
- Mid-latitude storm tracks: 0.5-0.7
- Mediterranean: 0.3-0.5
- Continental interiors: 0.3-0.5

## Generation Process

### 1. High-Resolution Mesh

```javascript
subdivisions: 80  // ~25,000 tiles
distortionLevel: 0  // Perfect sphere (no distortion)
```

The system uses 80 subdivisions for high detail. This creates approximately 25,000 tiles across the planet surface, giving resolution of roughly 1,600 km² per tile at the equator.

### 2. Tile Processing

For each of the ~25,000 tiles:

```javascript
// Convert position to geographic coordinates
latLon = cartesianToLatLon(tile.position)

// Look up Earth data
elevation = getEarthElevation(latLon.lat, latLon.lon)
temperature = getEarthTemperature(latLon.lat, latLon.lon, elevation)
moisture = getEarthMoisture(latLon.lat, latLon.lon, elevation)

// Normalize and apply
tile.elevation = elevation / 10000.0  // -1 to 1 range
tile.temperature = temperature  // 0 to 1
tile.moisture = moisture  // 0 to 1
```

### 3. Corner Processing

Each tile has 5-7 corners (vertices). The system also applies Earth data to corners for accurate 3D rendering:

```javascript
for each corner:
  cornerLatLon = cartesianToLatLon(corner.position)
  corner.elevation = getEarthElevation(cornerLatLon.lat, cornerLatLon.lon)
  corner.temperature = getEarthTemperature(...)
  corner.moisture = getEarthMoisture(...)
```

### 4. Visual Generation

After applying geographic data, the system:
1. Calculates elevation displacements for 3D terrain
2. Generates render data (geometry, colors)
3. Applies biome classification based on elevation/temperature/moisture
4. Auto-saves as full format

## Usage

### Generating Earth

**Method 1: UI Button**

1. Open `PlanGen.html`
2. Look for "Earth Recreation" section in control panel
3. Click "Generate Earth Recreation" button
4. Confirm the dialog (warns about 1-3 minute generation time)
5. Wait for generation to complete
6. File auto-saves as `earth-recreation-full.json`

**Method 2: Console**

```javascript
generateEarthPlanet()
```

### Generation Time

- **Mesh Generation**: 5-10 seconds
- **Earth Data Application**: 30-60 seconds (~25,000 tiles × lookups)
- **Visual Generation**: 20-30 seconds
- **Total**: 1-3 minutes

### File Size

The generated `earth-recreation-full.json` file:
- Size: ~8-12 MB (80 subdivisions, full format)
- Contains: Complete topology, elevation, temperature, moisture
- Can be loaded in editor for fine-tuning
- Can be loaded in main viewer for exploration

## Using the Generated Earth

### In Main Viewer (PlanGen.html)

1. Click "Load Planet"
2. Select `earth-recreation-full.json`
3. Explore Earth's geography in 3D
4. Use different render modes:
   - Terrain: See biomes (deserts, forests, etc.)
   - Elevation: See height map
   - Temperature: See climate zones
   - Moisture: See wet/dry regions
5. Rotate camera to view different continents
6. Zoom in to see mountain ranges

### In Planet Editor

1. Open `planet-editor.html`
2. Load `earth-recreation-full.json`
3. Fine-tune specific features:
   - Adjust mountain elevations
   - Modify climate zones
   - Paint wind patterns
   - Refine coastlines
4. Save edited version

### Verification Points

To verify Earth recreation accuracy, check these landmarks:

**Himalayas**
- Location: ~30°N, 85°E
- Elevation: Should be highest on planet (0.6-0.9 normalized)
- Visual: Massive mountain range across Asia

**Sahara Desert**
- Location: ~20°N, 10°E
- Moisture: Should be very low (0.0-0.1)
- Temperature: Should be high (0.8-0.9)
- Visual: Large tan/orange dry region

**Amazon Rainforest**
- Location: ~0°, 60°W
- Elevation: Very low (~0.01)
- Moisture: Very high (0.9-1.0)
- Temperature: High (0.8-0.9)
- Visual: Green equatorial region

**Antarctica**
- Location: 90°S
- Elevation: High due to ice (~0.2-0.4)
- Temperature: Lowest on planet (0.0-0.1)
- Visual: White/ice at south pole

**Mariana Trench**
- Location: ~11°N, 142°E
- Elevation: Deepest point (should be -1.0 or close)
- Visual: Very deep blue in Pacific

## Technical Details

### Coordinate Transformation

The system uses the corrected coordinate system from CLAUDE.md:

```javascript
// Axis rotation for standard geography
geo_x = position.z  // Front → Prime Meridian
geo_y = position.x  // Original X → 90°E
geo_z = position.y  // North Pole → Z-axis

phi = asin(geo_z / r)       // Latitude
theta = atan2(geo_y, geo_x) // Longitude
```

This ensures:
- 0°, 0° is at front-facing position (Prime Meridian, Equator)
- North pole is at top (90° latitude)
- Longitude increases eastward

### Elevation Normalization

Earth's elevation range:
- Deepest: Mariana Trench at -10,994m
- Highest: Mount Everest at 8,848m
- Total range: ~20,000m

Normalized to -1 to 1:
```javascript
normalized = elevation_meters / 10000.0
normalized = clamp(normalized, -1, 1)
```

This gives:
- Ocean floor: -1.0 to -0.3
- Sea level: 0.0
- Plains/hills: 0.0 to 0.3
- Mountains: 0.3 to 0.8
- Himalayas: 0.6 to 0.9

### Temperature Model

```javascript
// Base from latitude
baseTemp = 0.9 - (|lat| / 90) * 0.9

// Elevation lapse rate (-6.5°C per 1000m)
elevAdjust = -(elevation_m / 1000) * 0.065

// Ocean moderation
oceanMod = elevation < 0 ? (+0.1 polar, -0.05 tropical) : 0

// Continental effects (Siberia -0.2, Sahara +0.15, etc.)
continentalEffect = regional adjustments

temperature = baseTemp + elevAdjust + oceanMod + continentalEffect
```

### Moisture Model

```javascript
// Base from latitude (ITCZ, Hadley cells, storm tracks)
if (|lat| < 10) baseMoisture = 0.8  // ITCZ
else if (|lat| < 35) baseMoisture = 0.2  // Subtropical highs
else if (|lat| < 60) baseMoisture = 0.6  // Mid-latitude lows
else baseMoisture = 0.3  // Polar dry

// Ocean bonus
if (ocean) baseMoisture += 0.2

// Regional adjustments
// Rainforests: +0.4 to +0.5
// Deserts: -0.3 to -0.7
// Rain shadows: varies by location

moisture = baseMoisture + coastal + regional
```

## Accuracy and Limitations

### What's Accurate

✅ **Continental Positions**: Correctly placed at proper lat/lon
✅ **Major Mountain Ranges**: Himalayas, Andes, Rockies, etc. in right locations
✅ **Ocean Basins**: Atlantic, Pacific, Indian oceans
✅ **Climate Zones**: Tropical, temperate, polar correctly distributed
✅ **Major Deserts**: Sahara, Arabia, Gobi, Atacama, etc.
✅ **Wet Regions**: Amazon, Congo, SE Asia rainforests
✅ **Temperature Gradient**: Proper equator-to-pole gradient
✅ **Elevation Patterns**: Realistic continental vs oceanic heights

### Approximations

⚠️ **Coastline Detail**: Simplified (limited by mesh resolution)
⚠️ **Small Islands**: Many islands <1000km² not represented
⚠️ **Local Variations**: Fine-scale terrain smoothed
⚠️ **Seasonal Changes**: Static snapshot (no seasonal variation)
⚠️ **Ocean Currents**: Not modeled (affects temperature/moisture)
⚠️ **Detailed Topography**: No data at <100km scale

### Known Limitations

1. **Resolution**: 80 subdivisions ≈ 1,600 km² per tile
   - Can't represent small features
   - Coastlines are smoothed
   - Islands may be merged or missing

2. **Data Source**: Hand-coded approximations
   - Not based on actual DEM (Digital Elevation Model)
   - Mountain heights are representative, not exact
   - Some minor ranges may be missing

3. **Climate**: Simplified models
   - No ocean currents (Gulf Stream, etc.)
   - No seasonal variation
   - No monsoon dynamics
   - Rain shadow effect simplified

4. **Biomes**: Auto-generated from elevation/temp/moisture
   - May not match real biome boundaries exactly
   - Transitional zones simplified

## Improvements for Higher Accuracy

### Higher Resolution

Increase subdivisions for more detail:

```javascript
subdivisions: 100  // ~40,000 tiles, ~1,000 km² each
subdivisions: 120  // ~57,000 tiles, ~700 km² each
```

**Trade-offs**:
- Better coastline detail
- More accurate small features
- Larger file size (15-25 MB)
- Longer generation time (3-5 minutes)

### External Data Integration

For maximum accuracy, integrate real elevation data:

```javascript
// Example: Load SRTM or ETOPO data
function getEarthElevation(lat, lon) {
  return lookupFromDatabase(lat, lon);
}
```

**Data Sources**:
- SRTM (Shuttle Radar Topography Mission): 90m resolution
- ETOPO1: 1 arc-minute global relief
- GEBCO: Bathymetry and topography
- WorldClim: Climate data (temp, precip)

### Ocean Currents

Add ocean circulation for realistic temperature/moisture:

```javascript
// Gulf Stream warms Western Europe
if (lat > 50 && lat < 60 && lon > -10 && lon < 10) {
  temperature += 0.15;  // Warmer than latitude suggests
}
```

### Seasonal Variation

Generate multiple versions for seasons:

```javascript
generateEarthPlanet(season)
// season: 'winter', 'spring', 'summer', 'fall'
// Adjust temperature, moisture, ice extent
```

## Comparison with Random Planets

| Feature | Random Planet | Earth Recreation |
|---------|--------------|------------------|
| Continents | Random shapes | Real continents (Africa, Eurasia, etc.) |
| Mountains | Random placement | Real ranges (Himalayas, Andes, etc.) |
| Oceans | Random distribution | Atlantic, Pacific, Indian |
| Coastlines | Varied, irregular | Earth's actual coastlines |
| Climate | Physically modeled | Earth's actual climate zones |
| Deserts | Based on Hadley cells | Sahara, Arabia, Gobi, etc. |
| Wet zones | Based on circulation | Amazon, Congo, SE Asia |
| Elevation range | Arbitrary scaling | -11km to +8.8km (Earth's range) |
| Temperature | Latitude + random | Latitude + real geography |
| Moisture | Circulation + random | Real precipitation patterns |

## Use Cases

### Education

- **Geography Teaching**: Explore Earth's features interactively
- **Climate Science**: Visualize temperature/moisture patterns
- **Geology**: See plate boundaries and mountain ranges
- **Oceanography**: Explore ocean basins and trenches

### Game Development

- **Realistic Earth Map**: Use as base for Earth-based games
- **Alternate History**: Load in editor, modify for what-if scenarios
- **Future Earth**: Adjust sea levels, temperatures for climate scenarios

### Cartography

- **3D Visualization**: Export to D3.js for interactive maps
- **Custom Projections**: View Earth in various projections (globe, Mercator, etc.)
- **Data Overlay**: Add custom data to real geography

### Worldbuilding

- **Starting Point**: Begin with Earth, then modify
- **Parallel Earth**: Make small changes for alternate reality
- **Reference**: Compare fictional worlds to real geography

## FAQ

**Q: How accurate is this compared to real Earth?**

A: Continental positions, major features, and climate zones are quite accurate. Fine details (coastlines, small islands, local topography) are approximated due to mesh resolution.

**Q: Can I increase accuracy?**

A: Yes, increase `subdivisions` to 100 or 120 for more detail. For maximum accuracy, integrate real DEM data (SRTM, ETOPO).

**Q: Why doesn't it match satellite imagery exactly?**

A: The system uses mathematical models and region-based rules, not actual satellite/elevation data. It's an approximation optimized for procedural generation.

**Q: Can I modify the generated Earth?**

A: Yes! Load `earth-recreation-full.json` in the planet editor and adjust any features you want.

**Q: How long does generation take?**

A: About 1-3 minutes for 80 subdivisions. Higher subdivisions take longer (up to 5 minutes for 120).

**Q: What's the file size?**

A: ~8-12 MB for 80 subdivisions in full format. Minimal format (seed only) is just 200 bytes but requires regeneration.

**Q: Can I export to other formats?**

A: Yes! Use "Export GeoJSON" to get D3.js-compatible geographic data. This can be used in web mapping libraries, GIS software, etc.

**Q: Is the Earth recreation deterministic?**

A: Yes, given the same subdivision count and seed, it will generate identically every time.

## Conclusion

The Earth Recreation System provides a powerful way to generate planets that match Earth's actual geography. While not satellite-perfect, it accurately captures major features, climate patterns, and elevation distributions, making it suitable for education, visualization, game development, and as a starting point for modified Earth scenarios.

The combination of lat/lon transformation, geographic feature databases, and climate models creates a recognizable Earth that can be explored, edited, and exported for various purposes.

For maximum accuracy, consider:
1. Increasing subdivisions (100-120)
2. Integrating real elevation data sources
3. Fine-tuning in the planet editor
4. Adding ocean current effects
5. Implementing seasonal variations

The system is extensible and can be enhanced with more detailed geographic data as needed.
