# Projection & View Modes / Rendering internals (`rendering-3d.js`)

> Deep-dive doc. CLAUDE.md links here; read this when working on projections,
> the mercator map, the render-data cache, or overlay outlines.

## View modes
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
  (raised) and applies in both projections. Up/down arrows are **reversed** in the
  mercator views (up = north).
- **Raised Mercator** lifts land vertices by `elevationDisplacement *
  MERCATOR_ELEVATION_Z_SCALE` (0.04) and bakes a NW hillshade into vertex colors
  (`computeMercatorTileShade`) so relief reads under the flat top-down
  orthographic camera. Rivers/air-currents are lifted to ride on top via
  `mercatorOverlayLayerZ`. (All in `generatePlanetRenderData_functions.js`.)

## Instant projection switching (render-data cache)
Switching modes is ~instant after the first visit. `applyProjectionStateChange`
(`rendering-3d.js`) keeps a per-mode cache on `planet.renderDataCache` keyed by
`projection_raised` (e.g. `globe_flat`, `mercator_raised`). On switch it stashes
the current render data, then either restores the cached entry (swapping scene
objects, recoloring only if the active overlay changed) or generates fresh on
first visit. `displayPlanet` disposes the cache when a new planet loads.
`toggleMercatorProjection`, `toggleElevationExaggeration`, and the four
projection buttons all route through this. `reapplyOverlayVisibility` re-applies
the toggle overlays (sun/rivers/air currents/coastline) after each swap.

## Mercator horizontal wrapping (seamless scroll)
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

## Outline overlays (plate / coastline)
Both are thin black `LineSegments` drawn over the surface, projection-aware and
3-copy in mercator, with `depthTest:false` so they render on top.
- **Plate outline** (`buildPlateOutlineObject` / `rebuildPlateOutline`): borders
  between tiles of different `plate`. Shown only while the `plates` overlay is
  active; rebuilt on overlay + projection change.
- **Coastline outline** (`buildCoastlineOutlineObject` / `rebuildCoastlineOutline`):
  borders between a land tile and a water tile. Driven by the independent
  `renderCoastline` toggle (Overlay Display Options → "Coastline"), not a render
  mode. Rebuilt by `rebuildCoastlineOutline` from `reapplyOverlayVisibility`
  (projection swap) and `showHideCoastline` (toggle) and `displayPlanet` (new
  planet).
