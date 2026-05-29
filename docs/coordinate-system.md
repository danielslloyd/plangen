# Coordinate System

> Deep-dive doc. CLAUDE.md links here. Read this only when touching coordinate
> math (projections, lat/lon, stripes/meridians).

**FIXED**: The coordinate system has been corrected to return proper geographic coordinates.

**Original Problem** (discovered via magenta tile debugging):
- The raw planet used a rotated coordinate system where `phi = 0` was front-facing, not north pole
- `theta` did not represent longitude in the traditional sense
- North pole was at `theta = π/2, phi = π/2` instead of standard coordinates

**Solution Implemented:**
The `cartesianToSpherical()` function (in `generatePlanetRenderData_functions.js`)
applies axis rotation to return standard geographic coordinates:
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
