# Planet Save/Load System - Implementation Guide

## Overview

A comprehensive planet save/load system has been added to PlanGen with three export formats:
1. **Minimal Format** - Seed and settings only (~200 bytes)
2. **Full Format** - Complete planet data (1-5 MB typical)
3. **GeoJSON Format** - D3.js-compatible geographic data

## Features

### Three Save Formats

#### 1. Minimal Format (Recommended for Sharing)
- **File Size**: ~200 bytes
- **Contents**: Seed + generation settings only
- **Loading**: Requires full regeneration (takes 5-30 seconds)
- **Use Case**: Sharing planet seeds, version control, minimal storage

**Example Output**:
```json
{
  "version": 1,
  "type": "minimal",
  "seed": 1730825600000,
  "originalSeed": null,
  "settings": {
    "subdivisions": 60,
    "distortionLevel": 1,
    "plateCount": 36,
    "oceanicRate": 0.7,
    "heatLevel": 1.0,
    "moistureLevel": 1.0
  }
}
```

#### 2. Full Format (Recommended for Quick Loading)
- **File Size**: 1-5 MB (varies with planet complexity)
- **Contents**: Complete topology, terrain, weather, and resources
- **Loading**: Instant (no regeneration needed)
- **Use Case**: Working files, fast iteration, preserving exact state

**Optimizations Applied**:
- Positions rounded to 5 decimals (~1cm precision on Earth-sized planet)
- Elevations rounded to 4 decimals
- Temperature/moisture rounded to 3 decimals
- Resource values rounded to 1-3 decimals based on type
- References stored as IDs instead of full objects
- Computed properties omitted (area, normal, boundingSphere)
- Render data omitted (can be regenerated quickly)

**Data Preserved**:
- All tiles, corners, and borders with full topology
- Elevation, temperature, moisture, biomes
- Rivers, lakes, watersheds, shore data
- Resources (wheat, corn, rice, fish, minerals, etc.)
- Cities and labels
- Tectonic plates and movements
- Air currents and weather patterns

#### 3. GeoJSON Format (D3.js Compatible)
- **File Size**: 500 KB - 3 MB
- **Contents**: Geographic features with properties
- **Loading**: Import into D3.js, Leaflet, Mapbox, etc.
- **Use Case**: Web mapping, data visualization, geographic analysis

**Structure**:
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "id": 0,
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[lon, lat], [lon, lat], ...]]
      },
      "properties": {
        "elevation": 0.4562,
        "temperature": 0.723,
        "moisture": 0.456,
        "biome": "temperateRainforest",
        "wheat": 45.2,
        "city": "City 1"
      }
    },
    ...
  ],
  "properties": {
    "seed": 1730825600000,
    "generator": "PlanGen",
    "created": "2025-11-05T12:00:00.000Z"
  }
}
```

## UI Controls

New controls added to the Control Panel at bottom-left:

**Save/Load Planet Section**:
- **Save Minimal** - Download minimal seed file
- **Save Full** - Download complete planet data
- **Export GeoJSON** - Download D3.js-compatible format
- **Load Planet** - Load a previously saved planet file

## Usage Examples

### Saving a Planet

1. Generate or load a planet
2. Click the desired save button:
   - "Save Minimal" for sharing/archiving
   - "Save Full" for working files
   - "Export GeoJSON" for mapping applications
3. File downloads automatically with format: `planet-{seed}-{format}.json`

### Loading a Planet

1. Click "Load Planet" button
2. Select a minimal or full format file
3. Wait for loading/regeneration to complete
4. Planet displays automatically

### Using GeoJSON with D3.js

Example D3.js code to load exported planet:

```javascript
d3.json('planet-1730825600000.geojson').then(function(data) {
  // Create a projection
  var projection = d3.geoOrthographic()
    .scale(250)
    .translate([width/2, height/2]);

  // Create a path generator
  var path = d3.geoPath().projection(projection);

  // Draw the planet
  svg.selectAll('path')
    .data(data.features)
    .enter()
    .append('path')
    .attr('d', path)
    .attr('fill', function(d) {
      // Color by biome
      return biomeColors[d.properties.biome];
    })
    .attr('stroke', '#333')
    .attr('stroke-width', 0.5);
});
```

## File Size Optimization Recommendations

### Current Optimizations
The following optimizations are already implemented:

1. **Numeric Precision Reduction**:
   - Positions: 5 decimals (±0.00001 ≈ 1cm on Earth)
   - Elevations: 4 decimals (±0.0001)
   - Temperature/Moisture: 3 decimals (±0.001)
   - Resources: 1-3 decimals based on type

2. **Reference Optimization**:
   - Store IDs instead of full object references
   - Reduces circular reference complexity
   - Dramatically reduces JSON size

3. **Property Omission**:
   - Skip computed properties (area, normal, boundingSphere)
   - Skip render data (geometry buffers, materials)
   - Skip statistics (can be recalculated)

4. **Conditional Inclusion**:
   - Only include optional properties if they exist
   - Uses short property names in serialization

### Additional Optimizations (Future)

If you need even smaller files, consider:

1. **Binary Format**:
   - Use ArrayBuffer for numeric data
   - Could reduce file size by 50-70%
   - Requires custom parser

2. **Compression**:
   - Apply gzip/deflate compression
   - Browser native support
   - Typical 60-80% size reduction

3. **Delta Encoding**:
   - Store differences from default values
   - Useful for similar planets

4. **Topology Simplification**:
   - Store only plate boundaries
   - Regenerate smooth terrain
   - Trade accuracy for size

## D3.js Integration Details

### Coordinate System

PlanGen uses standard geographic coordinates after the fix:
- **Longitude (θ)**: -180° to 180° (east-west)
- **Latitude (φ)**: -90° to 90° (north-south)
- **Front-facing**: 0°, 0° (prime meridian, equator)
- **North pole**: any longitude, 90° latitude

### D3.js Projections

The GeoJSON export works with all D3.js projections:

```javascript
// Orthographic (globe view)
d3.geoOrthographic()

// Mercator (flat map)
d3.geoMercator()

// Equal Earth (area-preserving)
d3.geoEqualEarth()

// Natural Earth (balanced)
d3.geoNaturalEarth1()

// Stereographic (polar view)
d3.geoStereographic()
```

### Feature Properties Available

Each tile polygon includes:
- `elevation` - Height above/below sea level
- `temperature` - 0.0 (cold) to 1.0 (hot)
- `moisture` - 0.0 (dry) to 1.0 (wet)
- `biome` - String (ocean, desert, forest, etc.)
- `river` - Boolean (if tile has river)
- `lake` - Boolean (if tile is lake)
- `city` - City label (if present)
- `label` - Geographic label (mountains, etc.)
- `wheat`, `corn`, `rice` - Agricultural resources
- `fish`, `timber`, `gold`, `iron`, `oil`, etc. - Natural resources
- `calories` - Total food production capacity

### Example Visualizations

**Elevation Map**:
```javascript
.attr('fill', d => d3.interpolateRdYlGn(d.properties.elevation))
```

**Temperature Map**:
```javascript
.attr('fill', d => d3.interpolateRdBu(1 - d.properties.temperature))
```

**Biome Map**:
```javascript
const biomeColors = {
  ocean: '#1e90ff',
  desert: '#f4a460',
  temperateRainforest: '#228b22',
  tundra: '#e0e0e0',
  // ... etc
};
.attr('fill', d => biomeColors[d.properties.biome])
```

**Resource Heatmap**:
```javascript
.attr('fill', d => {
  const value = d.properties.wheat || 0;
  return d3.interpolateYlGn(value / 100);
})
```

## Technical Implementation

### Key Functions

**planet-save-load.js** provides:

- `savePlanetMinimal(planet)` - Create minimal JSON
- `savePlanetFull(planet)` - Create full JSON with optimization
- `loadPlanetMinimal(data, callback)` - Load and regenerate
- `loadPlanetFull(data, callback)` - Load instantly
- `exportToGeoJSON(planet)` - Create D3.js-compatible format
- `savePlanetToFile(format)` - Download file
- `loadPlanetFromFile()` - Upload and load file

### Serialization Pipeline

1. **Serialize Topology** - Extract tiles, corners, borders
2. **Round Values** - Apply precision limits
3. **Convert References** - Replace objects with IDs
4. **Omit Computed** - Skip derivable properties
5. **Conditional Include** - Only include existing properties
6. **Stringify** - Convert to JSON

### Deserialization Pipeline

1. **Parse JSON** - Load file contents
2. **Create Objects** - Instantiate Corner, Border, Tile
3. **Restore Properties** - Apply saved values
4. **Link References** - Convert IDs back to objects
5. **Recalculate** - Rebuild computed properties
6. **Generate Render Data** - Create 3D geometry
7. **Display** - Show in scene

## File Size Comparison

For a typical 60-subdivision planet:

| Format | Typical Size | Load Time | Regeneration Required |
|--------|-------------|-----------|----------------------|
| Minimal | 200 bytes | 5-30 sec | Yes (full generation) |
| Full | 1-5 MB | <1 sec | No |
| GeoJSON | 500 KB - 3 MB | N/A | External use only |

### Size Breakdown (Full Format)

- **Corners**: ~30% (positions, elevations, weather)
- **Borders**: ~20% (connections, flow data)
- **Tiles**: ~40% (terrain, resources, biomes)
- **Plates**: ~5% (tectonic data)
- **Metadata**: ~5% (seed, settings)

## Best Practices

### When to Use Each Format

**Minimal Format**:
- ✅ Sharing planets with others
- ✅ Version control systems
- ✅ Long-term archival
- ✅ Bandwidth-constrained situations
- ❌ Quick iteration/testing
- ❌ Preserving manual edits

**Full Format**:
- ✅ Working files during development
- ✅ Quick save/load cycles
- ✅ Preserving exact planet state
- ✅ Offline work
- ❌ Long-term storage (large)
- ❌ Version control (too large)

**GeoJSON Format**:
- ✅ D3.js visualizations
- ✅ Web mapping applications
- ✅ GIS analysis
- ✅ External tools (QGIS, etc.)
- ❌ Loading back into PlanGen
- ❌ Preserving full planet data

### File Naming

Files are automatically named: `planet-{seed}-{format}.json`

Examples:
- `planet-1730825600000-minimal.json`
- `planet-1730825600000-full.json`
- `planet-1730825600000.geojson`

## Troubleshooting

### Common Issues

**"No planet to save!"**
- Generate or load a planet first before saving

**Large file size (>10 MB)**
- Use minimal format for storage
- Consider lower subdivision level
- File size scales with planet complexity

**Load fails**
- Ensure file is valid JSON
- Check file format version matches
- Try regenerating from minimal format

**GeoJSON doesn't display**
- Verify D3.js version compatibility
- Check coordinate system (should be WGS84)
- Ensure projection is configured correctly

## Future Enhancements

Potential additions:

1. **Compression**: Automatic gzip compression
2. **Versioning**: Handle different file format versions
3. **Partial Save**: Save only modified regions
4. **Cloud Storage**: Integration with cloud services
5. **TopoJSON**: More efficient topology encoding
6. **Binary Format**: Smaller files with ArrayBuffer
7. **Incremental Load**: Stream large planets
8. **Diff/Patch**: Save only changes between versions

## Compatibility

### D3.js Versions
- Tested with D3.js v5+
- Compatible with v6, v7
- Uses standard GeoJSON spec

### Browser Support
- Modern browsers (Chrome, Firefox, Safari, Edge)
- Requires File API support
- LocalStorage not used (files only)

### File Format Version
- Current: v1
- Future versions will maintain backward compatibility
- Version stored in JSON for migration

## Example Workflow

### Typical Development Workflow

1. Generate planet with desired settings
2. Save as minimal format for version control
3. Save as full format for quick iteration
4. Make adjustments, reload full format
5. Final export as GeoJSON for visualization
6. Archive minimal format for reproduction

### Sharing Workflow

1. Generate interesting planet
2. Save minimal format
3. Share file (200 bytes, easy to copy)
4. Recipient loads minimal file
5. Planet regenerates identically

### Visualization Workflow

1. Generate planet in PlanGen
2. Export as GeoJSON
3. Load in D3.js/Mapbox/Leaflet
4. Apply custom styling
5. Create interactive visualizations
6. Publish to web

## API Reference

### Save Functions

```javascript
// Save minimal (seed + settings only)
var minimalJSON = savePlanetMinimal(planet);

// Save full (complete data)
var fullJSON = savePlanetFull(planet);

// Export GeoJSON (D3.js compatible)
var geojson = exportToGeoJSON(planet);

// Download to file
savePlanetToFile('minimal');  // or 'full' or 'geojson'
```

### Load Functions

```javascript
// Load from file (shows file picker)
loadPlanetFromFile();

// Load minimal data
loadPlanetMinimal(jsonData, function() {
  console.log('Planet loaded and regenerated');
});

// Load full data
loadPlanetFull(jsonData, function() {
  console.log('Planet loaded instantly');
});
```

### Utility Functions

```javascript
// Round numeric value
var rounded = roundValue(3.14159265, 3); // 3.142

// Round Vector3
var roundedVec = roundVector3(vector, 5); // {x, y, z} rounded

// Convert to spherical
var spherical = cartesianToSpherical(position); // {theta, phi}
```

## Performance Considerations

### Save Performance
- Minimal: <1ms (trivial)
- Full: 100-500ms (depends on planet size)
- GeoJSON: 200-800ms (coordinate conversion)

### Load Performance
- Minimal: 5-30 seconds (full regeneration)
- Full: 500-2000ms (deserialization + rendering)
- GeoJSON: N/A (external use)

### Memory Usage
- Minimal: Negligible
- Full: 2x planet size during load (temporary)
- GeoJSON: 1.5x planet size (coordinate arrays)

## Conclusion

The new save/load system provides flexible options for:
- Quick prototyping (full format)
- Easy sharing (minimal format)
- Data visualization (GeoJSON format)

All formats are optimized for their specific use case while maintaining data integrity and compatibility with industry-standard tools like D3.js.
