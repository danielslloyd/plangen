// game-export.js
// Exports the current planet as a "plangen-game-map" JSON file — the compact,
// game-facing format consumed by the civ-style prototype in game/.
// Format spec: docs/game-export-format.md
//
// Entry points:
//   exportGameMap()            — build + download (wired to #exportGameMapButton)
//   buildGameMapExport(planet) — returns the plain JS object (console/tests)

var GAME_MAP_FORMAT = "plangen-game-map";
var GAME_MAP_VERSION = 1;

// Terrain classification ids (legend.terrain in the export).
var GAME_TERRAIN_NAMES = [
	"ocean", "coast", "lake", "seaIce", "glacier",
	"desert", "plains", "grassland", "forest", "tundra", "hills", "mountain"
];
var GAME_TERRAIN = {};
GAME_TERRAIN_NAMES.forEach(function (n, i) { GAME_TERRAIN[n] = i; });

function classifyGameTerrain(tile) {
	if (tile.biome === "seaIce") return GAME_TERRAIN.seaIce;
	if (tile.elevation <= 0) {
		return (tile.shore === -1) ? GAME_TERRAIN.coast : GAME_TERRAIN.ocean;
	}
	if (tile.biome === "glacier") return GAME_TERRAIN.glacier;
	if (tile.biome === "lake" || tile.lake) return GAME_TERRAIN.lake;
	if (tile.elevation > 0.6) return GAME_TERRAIN.mountain;
	if (tile.elevation > 0.35) return GAME_TERRAIN.hills;
	if (tile.temperature < 0.2) return GAME_TERRAIN.tundra;
	if (tile.moisture < 0.15) return GAME_TERRAIN.desert;
	if (tile.moisture > 0.55 && tile.temperature > 0.35) return GAME_TERRAIN.forest;
	if (tile.moisture > 0.25) return GAME_TERRAIN.grassland;
	return GAME_TERRAIN.plains;
}

// ---------------------------------------------------------------------------
// Layer helpers: dense int arrays with a scale divisor; sparse when mostly 0.
// ---------------------------------------------------------------------------

function _gmQuant(v, scale) {
	if (v === undefined || v === null || !isFinite(v)) return 0;
	return Math.round(v * scale);
}

function _gmLayer(desc, scale, rawValues, opts) {
	opts = opts || {};
	var n = rawValues.length, values = new Array(n), nonZero = 0;
	for (var i = 0; i < n; i++) {
		values[i] = _gmQuant(rawValues[i], scale);
		if (values[i] !== 0) nonZero++;
	}
	var layer = { scale: scale, desc: desc };
	if (!opts.dense && nonZero < n * 0.25) {
		var indices = [], sparseVals = [];
		for (var j = 0; j < n; j++) {
			if (values[j] !== 0) { indices.push(j); sparseVals.push(values[j]); }
		}
		layer.sparse = true;
		layer.indices = indices;
		layer.values = sparseVals;
	} else {
		layer.values = values;
	}
	return layer;
}

// Compact renumbering: arbitrary group keys -> 1..K (0 reserved for "none").
function _gmRenumber(rawIds) {
	var map = new Map(), next = 1, out = new Array(rawIds.length);
	for (var i = 0; i < rawIds.length; i++) {
		var r = rawIds[i];
		if (r === undefined || r === null || r === -1) { out[i] = 0; continue; }
		if (!map.has(r)) map.set(r, next++);
		out[i] = map.get(r);
	}
	return out;
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

function buildGameMapExport(p) {
	p = p || planet;
	if (!p || !p.topology) throw new Error("No planet to export");
	var tiles = p.topology.tiles;
	var corners = p.topology.corners;
	var borders = p.topology.borders;

	// Strategic layers are computed in the background pass; make sure they exist.
	if (tiles.length && tiles[0]._strategicA === undefined &&
		typeof generateStrategicOverlays === "function") {
		generateStrategicOverlays(p);
	}

	// Index maps (ids are sequential in practice, but don't rely on it).
	var tileIndex = new Map(), cornerIndex = new Map(), borderIndex = new Map();
	tiles.forEach(function (t, i) { tileIndex.set(t, i); });
	corners.forEach(function (c, i) { cornerIndex.set(c, i); });
	borders.forEach(function (b, i) { borderIndex.set(b, i); });

	// --- Geometry (unit sphere, x10000 ints) --------------------------------
	var radius = tiles[0].position.length() || 1;
	function packVec(arr, v) {
		arr.push(Math.round(v.x / radius * 10000),
		         Math.round(v.y / radius * 10000),
		         Math.round(v.z / radius * 10000));
	}
	var cornerPos = [], tileCenters = [];
	corners.forEach(function (c) { packVec(cornerPos, c.position); });
	tiles.forEach(function (t) { packVec(tileCenters, t.averagePosition || t.position); });

	var tileCorners = tiles.map(function (t) {
		return t.corners.map(function (c) { return cornerIndex.get(c); });
	});
	var tileNeighbors = tiles.map(function (t) {
		return t.tiles.map(function (n) { return tileIndex.get(n); });
	});

	var edgeTiles = [], edgeCornersArr = [];
	var pairToEdge = new Map(); // "a|b" (a<b) -> edge index
	borders.forEach(function (b, e) {
		var a = tileIndex.get(b.tiles[0]), c = tileIndex.get(b.tiles[1]);
		var lo = Math.min(a, c), hi = Math.max(a, c);
		edgeTiles.push(lo, hi);
		edgeCornersArr.push(cornerIndex.get(b.corners[0]), cornerIndex.get(b.corners[1]));
		pairToEdge.set(lo + "|" + hi, e);
	});
	function edgeOf(tA, tB) {
		var a = tileIndex.get(tA), b = tileIndex.get(tB);
		return pairToEdge.get(Math.min(a, b) + "|" + Math.max(a, b));
	}
	var tileEdges = tiles.map(function (t) {
		return t.tiles.map(function (n) {
			var e = edgeOf(t, n);
			return e === undefined ? -1 : e;
		});
	});

	// --- Tile layers ---------------------------------------------------------
	function col(fn) { return tiles.map(fn); }
	var maxCityPriority = 0;
	tiles.forEach(function (t) {
		if ((t.cityPriorityScore || 0) > maxCityPriority) maxCityPriority = t.cityPriorityScore;
	});

	var provinceByTileId = (typeof computeBalancedWatershedProvinces === "function")
		? computeBalancedWatershedProvinces(p) : {};

	var tileLayers = {
		elevation:   _gmLayer("signed elevation; <=0 is water", 1000, col(function (t) { return t.elevation; }), { dense: true }),
		temperature: _gmLayer("~0..1 temperature", 100, col(function (t) { return t.temperature; }), { dense: true }),
		moisture:    _gmLayer("~0..1 moisture", 100, col(function (t) { return t.moisture; }), { dense: true }),
		terrain:     _gmLayer("terrain class id, see legend.terrain", 1, col(classifyGameTerrain), { dense: true }),
		shore:       _gmLayer("signed hop distance to coast (+land/-water)", 1, col(function (t) { return t.shore; }), { dense: true }),
		river:       _gmLayer("1 = tile carries a river", 1, col(function (t) { return t.river ? 1 : 0; })),
		lake:        _gmLayer("1 = lake tile", 1, col(function (t) { return t.lake ? 1 : 0; })),
		drain:       _gmLayer("tile index water drains to, -1 none", 1, col(function (t) {
			return (t.drain && tileIndex.has(t.drain)) ? tileIndex.get(t.drain) : -1;
		}), { dense: true }),
		flow:        _gmLayer("outflow volume (river size)", 100, col(function (t) { return t.outflow || 0; })),
		plate:       _gmLayer("tectonic plate id", 1, col(function (t) { return t.plate && t.plate.id ? t.plate.id : 0; }), { dense: true }),

		// Food / economy (normalised 0..1 at generation)
		wheat:   _gmLayer("0..1 wheat suitability", 100, col(function (t) { return t.wheat; })),
		corn:    _gmLayer("0..1 corn suitability", 100, col(function (t) { return t.corn; })),
		rice:    _gmLayer("0..1 rice suitability", 100, col(function (t) { return t.rice; })),
		pasture: _gmLayer("0..1 pasture suitability", 100, col(function (t) { return t.pasture; })),
		fish:    _gmLayer("0..1 fishing yield", 100, col(function (t) { return t.fish; })),
		timber:  _gmLayer("0..1 timber", 100, col(function (t) { return t.timber; })),
		calories: _gmLayer("absolute best-crop calories", 1, col(function (t) { return t.calories; })),

		// Minerals (normalised 0..1, sparse-friendly)
		iron:    _gmLayer("0..1 iron deposit", 100, col(function (t) { return t.iron; })),
		gold:    _gmLayer("0..1 gold deposit", 100, col(function (t) { return t.gold; })),
		oil:     _gmLayer("0..1 oil deposit", 100, col(function (t) { return t.oil; })),
		coal:    _gmLayer("0..1 coal deposit", 100, col(function (t) { return t.coal; })),
		copper:  _gmLayer("0..1 copper deposit", 100, col(function (t) { return t.copper; })),
		silver:  _gmLayer("0..1 silver deposit", 100, col(function (t) { return t.silver; })),
		uranium: _gmLayer("0..1 uranium deposit", 100, col(function (t) { return t.uranium; })),
		bauxite: _gmLayer("0..1 bauxite deposit", 100, col(function (t) { return t.bauxite; })),

		// Strategic layers (PlanGen's automatic strategic-spot detection)
		cityPriority: _gmLayer("0..1 city priority (calorie flux + junction/coast bonuses)", 1000, col(function (t) {
			return maxCityPriority > 0 ? (t.cityPriorityScore || 0) / maxCityPriority : 0;
		})),
		transit:      _gmLayer("0..1 transit centrality within own domain (land corridors / sea lanes)", 1000, col(function (t) { return t._strategicA; })),
		transitCross: _gmLayer("0..1 cross-domain transit chokepoints", 1000, col(function (t) { return t._strategicA_cross; })),
		shoreDelta:   _gmLayer("0..1 boundary-shift sensitivity (bays, isthmuses, key islands)", 1000, col(function (t) { return t._strategicC; })),

		// Region ids (0 = none)
		province:  { scale: 1, desc: "balanced watershed province id", values: _gmRenumber(tiles.map(function (t) { return provinceByTileId[t.id]; })) },
		watershed: { scale: 1, desc: "drainage basin id", values: _gmRenumber(tiles.map(function (t) { return t.watershed ? t.watershed.id : null; })) },
		range:     _gmLayer("mountain/hill range id (0 none)", 1, col(function (t) { return t._rangeId || 0; })),
		body:      { scale: 1, desc: "landmass / water body id", values: _gmRenumber(tiles.map(function (t) { return t.body || null; })) }
	};

	// --- Edge layers ---------------------------------------------------------
	// Movement costs from the caloric A* graph (asymmetric).
	var costMap = new Map();
	(p.aStarEdges || []).forEach(function (e) {
		costMap.set(e.from.id + "|" + e.to.id, e);
	});
	var eDomain = new Array(borders.length);
	var eRiverAlong = new Array(borders.length);
	var eRiverCross = new Array(borders.length);
	var eCost = new Array(borders.length);
	var eCostR = new Array(borders.length);
	borders.forEach(function (b, e) {
		var tA = b.tiles[0], tB = b.tiles[1];
		var landA = tA.elevation > 0, landB = tB.elevation > 0;
		eDomain[e] = (landA && landB) ? 1 : (!landA && !landB) ? 0 : 2;
		eRiverAlong[e] = ((tA.drain === tB && tA.river) || (tB.drain === tA && tB.river)) ? 1 : 0;
		// A road on this edge passes through a river tile -> needs a bridge.
		eRiverCross[e] = (eDomain[e] === 1 && (tA.river || tB.river)) ? 1 : 0;
		var rec = costMap.get(tA.id + "|" + tB.id);
		var cost = 100, costR = 100;
		if (rec) { cost = rec.cost; costR = rec.reverseCost; }
		else {
			rec = costMap.get(tB.id + "|" + tA.id);
			if (rec) { cost = rec.reverseCost; costR = rec.cost; }
		}
		// Match export orientation (lo -> hi tile index).
		if (tileIndex.get(tA) > tileIndex.get(tB)) { var tmp = cost; cost = costR; costR = tmp; }
		eCost[e] = Math.min(cost, 300);
		eCostR[e] = Math.min(costR, 300);
	});

	var edgeLayers = {
		domain:     _gmLayer("0 water-water, 1 land-land, 2 coast", 1, eDomain, { dense: true }),
		riverAlong: _gmLayer("1 = river flows through this edge (tile->drain)", 1, eRiverAlong),
		riverCross: _gmLayer("1 = land edge touching a river tile; road needs a bridge", 1, eRiverCross),
		moveCost:   _gmLayer("terrain traversal cost A->B (caloric A* weights)", 10, eCost, { dense: true }),
		moveCostR:  _gmLayer("terrain traversal cost B->A", 10, eCostR, { dense: true })
	};

	return {
		format: GAME_MAP_FORMAT,
		version: GAME_MAP_VERSION,
		meta: {
			seed: p.seed,
			originalSeed: p.originalSeed,
			generator: "PlanGen",
			created: new Date().toISOString(),
			settings: (typeof generationSettings !== "undefined") ? {
				subdivisions: generationSettings.subdivisions,
				distortionLevel: generationSettings.distortionLevel,
				plateCount: generationSettings.plateCount,
				oceanicRate: generationSettings.oceanicRate,
				heatLevel: generationSettings.heatLevel,
				moistureLevel: generationSettings.moistureLevel
			} : {},
			counts: { tiles: tiles.length, corners: corners.length, edges: borders.length }
		},
		geometry: {
			corners: cornerPos,
			tileCenters: tileCenters,
			tileCorners: tileCorners,
			tileNeighbors: tileNeighbors,
			tileEdges: tileEdges,
			edges: edgeTiles,
			edgeCorners: edgeCornersArr
		},
		tileLayers: tileLayers,
		edgeLayers: edgeLayers,
		legend: {
			terrain: GAME_TERRAIN_NAMES,
			food: ["wheat", "corn", "rice", "pasture", "fish", "timber"],
			minerals: ["iron", "gold", "oil", "coal", "copper", "silver", "uranium", "bauxite"],
			strategic: ["cityPriority", "transit", "transitCross", "shoreDelta"]
		}
	};
}

function exportGameMap() {
	if (typeof planet === "undefined" || !planet) {
		alert("No planet to export!");
		return;
	}
	var data = JSON.stringify(buildGameMapExport(planet));
	var filename = "gamemap-" + planet.seed + ".json";
	downloadPlanetFile(data, filename);
	console.log("Exported game map " + filename + " (" + (data.length / 1024).toFixed(1) + " KB)");
}

// Wire the UI button (if present).
$(document).ready(function () {
	var btn = $("#exportGameMapButton");
	if (btn.length) btn.click(exportGameMap);
});
