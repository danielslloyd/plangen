# PlanGen Game Map Export Format (`plangen-game-map`)

A compact, **game-engine-facing** snapshot of a generated planet. It is what the
civ-style game prototype in `game/` consumes. Design goals:

1. **Locked geometry** — the tile/corner/edge graph is stored once, as indices.
   Nothing in the game ever changes geometry, so gameplay state only ever needs
   to reference `tile index` and `edge index`.
2. **Struct-of-arrays layers** — every tile attribute is a named flat array
   (`tileLayers`), every edge attribute likewise (`edgeLayers`). Adding a new
   attribute later = adding one more named layer; no format change, old maps
   keep loading, games ignore layers they don't know.
3. **Aggressive rounding** — values are stored as small integers with a
   per-layer `scale` divisor (real value = stored / scale). Positions are unit
   vectors rounded to 4 decimals. Typical file: ~1–2 MB at 20 subdivisions,
   ~5 MB at 40, before gzip (JSON of small ints compresses ~10x).

Produced by `game-export.js` (`exportGameMap()` in the PlanGen UI or
`buildGameMapExport(planet)` from the console).

## Top-level structure

```jsonc
{
  "format": "plangen-game-map",
  "version": 1,
  "meta": {
    "seed": 1724774450630,
    "generator": "PlanGen",
    "created": "2026-07-07T...",
    "settings": { "subdivisions": 20, "plateCount": 36, "oceanicRate": 0.7, ... },
    "counts": { "tiles": 4002, "corners": 8000, "edges": 12000 }
  },
  "geometry": { ... },       // locked — see below
  "tileLayers": { ... },     // named per-tile arrays
  "edgeLayers": { ... },     // named per-edge arrays
  "legend": { ... }          // human-readable value tables (terrain ids, etc.)
}
```

## Geometry (locked)

All coordinates are on the **unit sphere** (planet radius normalised to 1).
`y` is the north pole axis. Longitude/latitude, tile areas, and edge lengths
are derived by the loader — they are not stored.

| key             | shape                | meaning |
|-----------------|----------------------|---------|
| `corners`       | flat `[x,y,z, ...]`  | corner positions ×10000, rounded to ints |
| `tileCenters`   | flat `[x,y,z, ...]`  | tile centroid positions ×10000 |
| `tileCorners`   | `[[c0,c1,...], ...]` | ordered polygon ring of corner indices per tile (5–7 entries) |
| `tileNeighbors` | `[[t,...], ...]`     | adjacent tile indices per tile (same count as corners) |
| `edges`         | flat `[tA,tB, ...]`  | one entry per border in the dual graph; tA < tB |
| `edgeCorners`   | flat `[cA,cB, ...]`  | the two corners of each edge's shared border |
| `tileEdges`     | `[[e,...], ...]`     | edge indices around each tile (aligned with `tileNeighbors`) |

Every game concept maps onto this: a **city** is on a tile and fortifies the
tile's `tileEdges`; a **road** or **bridge** lives on an edge index; unit
movement walks `tileNeighbors`/`tileEdges`.

## Layer encoding

Each entry of `tileLayers` / `edgeLayers`:

```jsonc
"calories": {
  "scale": 1,          // real = stored / scale
  "desc": "max food yield of best crop on this tile",
  "values": [0, 130, ...]          // dense: length = tile/edge count
}
// or sparse (for rare attributes, e.g. minerals):
"gold": {
  "scale": 100, "sparse": true,
  "indices": [12, 407, ...], "values": [88, 100, ...]   // others default to 0
}
```

Loaders should treat **any missing layer as all-zero** and **ignore unknown
layers** — that is the whole extensibility contract.

## Standard tile layers (version 1)

Geography / climate:

| layer         | scale | notes |
|---------------|-------|-------|
| `elevation`   | 1000  | signed; ≤0 is water |
| `temperature` | 100   | ~0..1 (can be slightly outside) |
| `moisture`    | 100   | ~0..1 |
| `terrain`     | 1     | classified id, see `legend.terrain` (ocean/coast/lake/ice/glacier/desert/plains/grassland/forest/tundra/hills/mountain) |
| `shore`       | 1     | signed hop distance to coast (+land / −water) |
| `river`       | 1     | 0/1 — tile carries a river |
| `lake`        | 1     | 0/1 |
| `drain`       | 1     | tile index water flows to next, −1 if none |
| `flow`        | 100   | outflow volume (river size) |
| `plate`       | 1     | tectonic plate id |

Food / economy (all normalised 0..1 at generation, stored ×100):

`wheat, corn, rice, pasture, fish, timber` and `calories` (already an absolute
per-tile "best crop" figure, stored ×1).

Minerals (normalised 0..1, ×100, **sparse**):

`iron, gold, oil, coal, copper, silver, uranium, bauxite`

Strategic layers (PlanGen's automatic strategic-spot detection, all 0..1 ×1000):

| layer            | source in PlanGen | meaning for the game |
|------------------|-------------------|----------------------|
| `cityPriority`   | `tile.cityPriorityScore` | river-junction / calorie-flux city spots |
| `transit`        | `tile._strategicA` | caloric betweenness on own domain (land corridors / sea lanes) |
| `transitCross`   | `tile._strategicA_cross` | cross-domain chokepoints (coastal straits etc.) |
| `shoreDelta`     | `tile._strategicC` | boundary-shift sensitivity: bay mouths, isthmuses, key islands |

Region ids (for AI reasoning and future diplomacy/culture mechanics):

| layer        | meaning |
|--------------|---------|
| `province`   | balanced watershed provinces (roughly equal-size land regions) |
| `watershed`  | raw drainage basin id |
| `range`      | mountain/hill range id (0 = none) |
| `body`       | land-mass / ocean body id |

## Standard edge layers (version 1)

| layer        | scale | notes |
|--------------|-------|-------|
| `domain`     | 1     | 0 water–water, 1 land–land, 2 coast (land–water) |
| `riverCross` | 1     | 0/1 — land–land edge touching a river tile (a road here passes over the river and needs a **bridge**) |
| `riverAlong` | 1     | 0/1 — the edge connects a river tile to its drain (river runs through it; used for river rendering) |
| `moveCost`   | 10    | terrain-derived base traversal cost A→B (from PlanGen's caloric A* graph), capped at 300 |
| `moveCostR`  | 10    | traversal cost B→A (asymmetric: slopes, sailing winds) |

PlanGen rivers are tile-based (wide rivers occupying whole tiles), so the game
rule is: any road segment on an edge whose endpoint is a river tile is a
bridge. Costs are stored in the `edges` orientation (lower tile index → higher).

## Game state is NOT in this file

Cities, roads, bridges, units, ownership are game-save concerns. The game
stores them as `{tileIndex: ...}` / `{edgeIndex: ...}` maps referencing this
immutable map file — which is why the geometry is locked.
