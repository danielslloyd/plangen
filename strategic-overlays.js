// strategic-overlays.js
// Strategic + tree-based geography overlays computed once per planet.
//
//   A – Transit Centrality      (caloric betweenness on land, ocean AND
//                                terrain-agnostic graphs — the third layer
//                                tints tiles that lie on global mouth-to-mouth
//                                routes regardless of which side of the coast
//                                they sit on)
//   C – Shore Delta @ Radius N  (per tile, the range of shore values among
//                                tiles at exactly N hops away; highlights
//                                cliffs, narrow straits and steep coastal
//                                transitions)
// All are geography overlays (category="geography"). Entry point at the
// bottom of the file: generateStrategicOverlays(planet).
// (The old "shoreTree" node-distance overlay was deleted — superseded by the
// Shore Tree (Skeleton) / Shore Branch Depth pair.)

// ============================================================================
// SHARED HELPERS
// ============================================================================

// Viridis colormap (perceptually uniform). Maps t in [0,1] to a THREE.Color.
var VIRIDIS_STOPS = [
	0x440154, 0x482878, 0x3E4A89, 0x31688E, 0x26828E,
	0x1F9E89, 0x35B779, 0x6DCD59, 0xB4DE2C, 0xFDE725
];
function viridisColor(t) {
	t = t < 0 ? 0 : (t > 1 ? 1 : t);
	var n = VIRIDIS_STOPS.length - 1;
	var f = t * n;
	var i = Math.floor(f);
	if (i >= n) return new THREE.Color(VIRIDIS_STOPS[n]);
	var frac = f - i;
	return new THREE.Color(VIRIDIS_STOPS[i]).lerp(new THREE.Color(VIRIDIS_STOPS[i + 1]), frac);
}

function _bfsParentMap(source, domainFn) {
	var parent = new Map();
	var queue = [source], qi = 0;
	parent.set(source, null);
	while (qi < queue.length) {
		var cur = queue[qi++];
		var nbs = cur.tiles;
		for (var k = 0; k < nbs.length; k++) {
			var nb = nbs[k];
			if (!parent.has(nb) && domainFn(nb)) {
				parent.set(nb, cur);
				queue.push(nb);
			}
		}
	}
	return parent;
}

function _tracePath(parentMap, end) {
	if (!parentMap.has(end)) return null;
	var path = [], t = end;
	while (t !== null && t !== undefined) {
		path.push(t);
		t = parentMap.get(t);
	}
	return path;
}

// Heat-diffusion smoothing: spread field values to same-domain neighbours.
function _smoothField(tiles, field, domainFn, rounds) {
	var alpha = 0.4;
	var buf = new Float64Array(tiles.length);
	for (var round = 0; round < rounds; round++) {
		for (var i = 0; i < tiles.length; i++) {
			var tile = tiles[i];
			if (!domainFn(tile)) { buf[i] = 0; continue; }
			var nbs = tile.tiles, sum = 0, cnt = 0;
			for (var k = 0; k < nbs.length; k++) {
				if (domainFn(nbs[k])) { sum += nbs[k][field]; cnt++; }
			}
			buf[i] = cnt ? tile[field] * (1 - alpha) + (sum / cnt) * alpha : tile[field];
		}
		for (var i = 0; i < tiles.length; i++) {
			if (domainFn(tiles[i])) tiles[i][field] = buf[i];
		}
	}
}

// ============================================================================
// SHORE DELTA CALCULATION (for Overlay C)
// ============================================================================

// Check if a body would disappear entirely (all tiles become opposite domain)
function _bodyWouldDisappear(tiles, savedShore, N, isLand, expandOcean) {
	for (var i = 0; i < tiles.length; i++) {
		var t = tiles[i];
		if ((t.elevation > 0) !== isLand) continue; // not in this domain
		var absDist = Math.abs(savedShore[i]);
		var wouldFlip = false;
		if (expandOcean && isLand && absDist <= N) wouldFlip = true;
		else if (!expandOcean && !isLand && absDist <= N) wouldFlip = true;
		if (!wouldFlip) return false; // at least one tile survives
	}
	return true; // entire body disappears
}

// For each tile, computes how its shore value would differ between two shifted
// boundary scenarios: boundary at ring N+1 (outward) vs ring N-1 (inward).
//
// Each scenario BFS-seeds its ring as the new coast (land=+1, ocean=-1) and
// propagates outward. Because topology matters (bays, islands, peninsulas),
// the two scenarios produce very different values at complex features:
//   - Bay mouth: BFS wraps around very differently under each shift → high delta
//   - Remote island: may be within N-1 ring on one scenario, not the other → high delta
//   - Straight coast: both produce near-symmetric values → low delta
//
function calculateShoreDelta(tiles, N) {
	if (!N) {
		var _maxS = 0;
		for (var _i = 0; _i < tiles.length; _i++) { var _s = Math.abs(tiles[_i].shore||0); if (_s > _maxS) _maxS = _s; }
		N = Math.max(2, Math.round(_maxS * 0.225));
	}

	// Build fast index and shared buffers (reused across both scenarios)
	var tileIndex = new Map();
	for (var i = 0; i < tiles.length; i++) tileIndex.set(tiles[i], i);

	var savedShore  = new Float64Array(tiles.length);
	var virtualElev = new Float64Array(tiles.length);
	for (var i = 0; i < tiles.length; i++) savedShore[i] = tiles[i].shore || 0;

	var scenario1 = new Float64Array(tiles.length);
	var scenario2 = new Float64Array(tiles.length);
	for (var i = 0; i < tiles.length; i++) scenario1[i] = savedShore[i];
	for (var i = 0; i < tiles.length; i++) scenario2[i] = savedShore[i];

	// Scenario 1: ocean expands N tiles (land within N → virtual ocean).
	// Per-body: if a land body would entirely disappear, revert that body's tiles
	// to original shore rather than skipping the entire scenario globally.
	_computeVirtualShore(tiles, savedShore, N, tileIndex, virtualElev, true);
	for (var i = 0; i < tiles.length; i++) scenario1[i] = tiles[i].shore || 0;
	// Identify land bodies that would vanish and revert them.
	var checkedBodies1 = new Set();
	for (var i = 0; i < tiles.length; i++) {
		var _t = tiles[i];
		if (_t.elevation <= 0 || _t.body === undefined || _t.body === null) continue;
		if (checkedBodies1.has(_t.body)) continue;
		checkedBodies1.add(_t.body);
		// Check if every land tile in this body would flip.
		var bodyVanishes = true;
		for (var _j = 0; _j < tiles.length; _j++) {
			if (tiles[_j].body !== _t.body || tiles[_j].elevation <= 0) continue;
			if (Math.abs(savedShore[_j]) > N) { bodyVanishes = false; break; }
		}
		if (bodyVanishes) {
			for (var _j = 0; _j < tiles.length; _j++) {
				if (tiles[_j].body === _t.body) scenario1[_j] = savedShore[_j];
			}
		}
	}

	// Scenario 2: land expands N tiles (ocean within N → virtual land).
	// No per-body change needed for this direction.
	if (!_bodyWouldDisappear(tiles, savedShore, N, false, false)) {
		_computeVirtualShore(tiles, savedShore, N, tileIndex, virtualElev, false);
		for (var i = 0; i < tiles.length; i++) scenario2[i] = tiles[i].shore || 0;
	}

	// Restore original shore and write delta.
	// Tiles far from the coast (|shore| > 2N) are unaffected by either scenario
	// and get zeroed out rather than showing noise.
	var twoN = 2 * N;
	for (var i = 0; i < tiles.length; i++) {
		tiles[i].shore = savedShore[i];
		if (Math.abs(savedShore[i]) > twoN) {
			tiles[i]._shoreDelta = 0;
		} else {
			tiles[i]._shoreDelta = Math.abs(scenario1[i] - scenario2[i]);
		}
	}

	// 2N is the display floor: deltas at/below 2N are not shown (set to 0), deltas
	// above 2N keep their continuous magnitude so the overlay reads as a gradient
	// (normalised later in computeStrategicC).
	for (var i = 0; i < tiles.length; i++) {
		if (tiles[i]._shoreDelta <= twoN) tiles[i]._shoreDelta = 0;
	}
}

// Recompute shore distances as if the coastline shifted by N tiles.
// expandOcean=true  → ocean grows: land tiles within N of coast become virtual ocean
// expandOcean=false → land grows:  ocean tiles within N of coast become virtual land
// Uses a full coast-detect + BFS pass on the virtual elevation map, so topology
// changes (bay closing, island disappearing) are captured correctly.
function _computeVirtualShore(tiles, savedShore, N, tileIndex, virtualElev, expandOcean) {
	// Build virtual elevation for this scenario
	for (var i = 0; i < tiles.length; i++) {
		var absDist = Math.abs(savedShore[i]);
		var realElev = tiles[i].elevation;
		if (expandOcean && realElev > 0 && absDist <= N) {
			virtualElev[i] = -1; // land within N → virtual ocean
		} else if (!expandOcean && realElev < 0 && absDist <= N) {
			virtualElev[i] = 1;  // ocean within N → virtual land
		} else {
			virtualElev[i] = realElev > 0 ? 1 : (realElev < 0 ? -1 : 0);
		}
	}

	// Reset shore
	for (var i = 0; i < tiles.length; i++) tiles[i].shore = 0;

	// First pass: detect new virtual coastline
	for (var i = 0; i < tiles.length; i++) {
		var tile = tiles[i];
		var ve = virtualElev[i];
		if (ve === 0) continue;
		for (var j = 0; j < tile.tiles.length; j++) {
			var nbIdx = tileIndex.get(tile.tiles[j]);
			var nve = virtualElev[nbIdx];
			if (nve !== 0 && ((ve > 0 && nve < 0) || (ve < 0 && nve > 0))) {
				tile.shore = ve > 0 ? 1 : -1;
				break;
			}
		}
	}

	// Second pass: BFS from coast outward
	var queue = [], qi = 0;
	for (var i = 0; i < tiles.length; i++) {
		if (tiles[i].shore !== 0) queue.push(tiles[i]);
	}
	while (qi < queue.length) {
		var cur = queue[qi++];
		var dist = Math.abs(cur.shore);
		for (var j = 0; j < cur.tiles.length; j++) {
			var nb = cur.tiles[j];
			if (nb.shore !== 0) continue;
			var nbIdx = tileIndex.get(nb);
			var nve = virtualElev[nbIdx];
			if (nve === 0) continue;
			nb.shore = nve > 0 ? (dist + 1) : -(dist + 1);
			queue.push(nb);
		}
	}
}

// ============================================================================
// OVERLAY A – TRANSIT CENTRALITY  (land + ocean + cross-domain)
//
// Caloric betweenness on THREE A* graphs built from the planet's terrain weights:
//   - land-only   (paths between mouth tiles, land edges only)
//   - ocean-only  (paths between drain tiles, ocean edges only)
//   - vanilla A*  (paths between mouth tiles, all edges, same weights)
//
// Land/ocean domain drives tile hue (gold / cyan); the cross-domain score
// boosts intensity so coastal chokepoints also light up on both sides.
// ============================================================================

// Transit Centrality is the heaviest analysis in the whole pipeline (~435 mouth
// pairs x 3 full-graph A* searches). Running it as one synchronous call froze the
// tab for seconds even though it is a "background" overlay. It is therefore split
// into begin / step / end so the pipeline can process a handful of pairs per
// SteppedAction slice and yield between them, keeping the globe responsive while
// the overlay fills in. `computeStrategicA` keeps the old all-at-once behaviour
// for the save/load regeneration paths.
function computeStrategicA(tiles, planet) {
	var state = computeStrategicA_begin(tiles, planet);
	if (!state) return;
	while (!computeStrategicA_step(state, Infinity)) { /* single pass */ }
	computeStrategicA_end(state);
}

function computeStrategicA_begin(tiles, planet) {
	var isLand  = function(t) { return t.elevation > 0; };
	var isOcean = function(t) { return t.elevation <= 0; };

	// Build tile lookup.
	var tileById = {};
	for (var i = 0; i < tiles.length; i++) tileById[tiles[i].id] = tiles[i];

	// --- 1. Find river mouths ---
	var mouths = [];
	for (var i = 0; i < tiles.length; i++) {
		var t = tiles[i];
		if (t.shore === 1 && t.drain && t.drain.elevation <= 0 && (t.upstreamCalories || 0) > 0)
			mouths.push(t);
	}
	mouths.sort(function(a, b) { return (b.upstreamCalories || 0) - (a.upstreamCalories || 0); });
	mouths = mouths.slice(0, Math.min(30, mouths.length));

	// --- 2. Reset accumulators ---
	for (var i = 0; i < tiles.length; i++) {
		tiles[i]._sA_l = 0; tiles[i]._sA_o = 0; tiles[i]._sA_x = 0;
	}

	if (mouths.length < 2 || !planet || !planet.aStarEdges) {
		for (var i = 0; i < tiles.length; i++) { tiles[i]._strategicA = 0; tiles[i]._strategicA_cross = 0; }
		return null;
	}

	// --- 3. Build filtered graphs from existing terrain-weighted edges ---
	var landVerts = [], oceanVerts = [];
	for (var i = 0; i < tiles.length; i++) {
		if (isLand(tiles[i]))  landVerts.push(tiles[i]);
		else                   oceanVerts.push(tiles[i]);
	}
	var landEdges = [], oceanEdges = [];
	var edges = planet.aStarEdges;
	for (var i = 0; i < edges.length; i++) {
		var e = edges[i];
		if (isLand(e.from)  && isLand(e.to))  landEdges.push(e);
		if (isOcean(e.from) && isOcean(e.to)) oceanEdges.push(e);
	}
	var landGraph  = buildGraph(landVerts,  landEdges);
	var oceanGraph = buildGraph(oceanVerts, oceanEdges);
	var fullGraph  = planet.graph;

	// Average tile distance for A* heuristic.
	var avgTileDistance = 0.08;
	var borders = planet.topology && planet.topology.borders;
	if (borders && borders.length > 0) {
		var tot = 0, cnt = 0;
		for (var i = 0; i < Math.min(100, borders.length); i++) {
			var b = borders[i];
			if (b.tiles && b.tiles.length === 2) { tot += b.tiles[0].position.distanceTo(b.tiles[1].position); cnt++; }
		}
		if (cnt > 0) avgTileDistance = tot / cnt;
	}

	// Build A* finder on a graph with a straight-line heuristic.
	function makeAstar(graph) {
		return ngraphPath.aStar(graph, {
			oriented: true,
			distance: function(f, t, link) { return link.data.weight; },
			heuristic: function(f, t) {
				var ft = tileById[f.id], tt = tileById[t.id];
				return (ft && tt) ? ft.position.distanceTo(tt.position) / avgTileDistance : 0;
			}
		});
	}

	return {
		tiles: tiles, isLand: isLand, isOcean: isOcean, tileById: tileById, mouths: mouths,
		landFinder:  makeAstar(landGraph),
		oceanFinder: makeAstar(oceanGraph),
		fullFinder:  makeAstar(fullGraph),
		i: 0, j: 1, progress: 0,
		totalPairs: mouths.length * (mouths.length - 1) / 2, donePairs: 0
	};
}

// Process up to maxPairs mouth pairs. Returns true when all pairs are done.
function computeStrategicA_step(state, maxPairs) {
	var mouths = state.mouths, tileById = state.tileById, isOcean = state.isOcean;
	function nodesToTiles(nodes) {
		if (!nodes || nodes.length === 0) return null;
		var path = [];
		for (var i = 0; i < nodes.length; i++) {
			var tile = tileById[nodes[i].id];
			if (tile) path.push(tile);
		}
		return path.length > 0 ? path : null;
	}

	var processed = 0;
	while (state.i < mouths.length) {
		var calA = mouths[state.i].upstreamCalories || 0;
		var drainI = mouths[state.i].drain;
		while (state.j < mouths.length) {
			if (processed >= maxPairs) {
				state.progress = state.totalPairs > 0 ? state.donePairs / state.totalPairs : 1;
				return false;
			}
			var jj = state.j++;
			processed++; state.donePairs++;
			var calB = mouths[jj].upstreamCalories || 0;
			var w = Math.sqrt(calA * calB);
			if (w <= 0) continue;

			var pathL = nodesToTiles(state.landFinder.find(mouths[state.i].id, mouths[jj].id));
			if (pathL) for (var k = 0; k < pathL.length; k++) pathL[k]._sA_l += w;

			var drainJ = mouths[jj].drain;
			if (drainI && isOcean(drainI) && drainJ && isOcean(drainJ)) {
				var pathO = nodesToTiles(state.oceanFinder.find(drainI.id, drainJ.id));
				if (pathO) for (var k = 0; k < pathO.length; k++) pathO[k]._sA_o += w;
			}

			var pathX = nodesToTiles(state.fullFinder.find(mouths[state.i].id, mouths[jj].id));
			if (pathX) for (var k = 0; k < pathX.length; k++) pathX[k]._sA_x += w;
		}
		state.i++; state.j = state.i + 1;
	}
	state.progress = 1;
	return true;
}

// Smooth + normalise once all pairs are accumulated.
function computeStrategicA_end(state) {
	var tiles = state.tiles, isLand = state.isLand, isOcean = state.isOcean;
	var smoothRounds = 6;
	_smoothField(tiles, '_sA_l', isLand,  smoothRounds);
	_smoothField(tiles, '_sA_o', isOcean, smoothRounds);
	_smoothField(tiles, '_sA_x', function(t) { return true; }, smoothRounds);

	var maxL = 0, maxO = 0, maxX = 0;
	for (var i = 0; i < tiles.length; i++) {
		if (isLand(tiles[i])  && tiles[i]._sA_l > maxL) maxL = tiles[i]._sA_l;
		if (isOcean(tiles[i]) && tiles[i]._sA_o > maxO) maxO = tiles[i]._sA_o;
		if (tiles[i]._sA_x > maxX) maxX = tiles[i]._sA_x;
	}
	for (var i = 0; i < tiles.length; i++) {
		var t = tiles[i];
		t._strategicA       = isLand(t) ? (maxL > 0 ? t._sA_l / maxL : 0)
		                                 : (maxO > 0 ? t._sA_o / maxO : 0);
		t._strategicA_cross = maxX > 0 ? t._sA_x / maxX : 0;
	}
}

// ============================================================================
// OVERLAY B – TERRAIN RUGGEDNESS
//
// For each tile, take the standard deviation of elevations over its 2-hop
// neighbourhood (itself + neighbours + neighbours' neighbours). Plains/plateaus
// score low; cliffs, mountains and rough sea floor score high. Normalised per
// domain so land and ocean ranges are comparable.
// ============================================================================


// ============================================================================
// OVERLAY C – SHORE DELTA (Boundary Shift Sensitivity)
//
// For each tile, measures how much its position relative to shore would
// change if the boundary shifted ±N. High values = places where small boundary
// shifts create large strategic changes: mouths of deep bays, isolated islands,
// narrow peninsulas. Low values = tiles that remain strategically similar
// regardless of small boundary shifts.
//
// Computed by: creating two shore-distance clones, one with boundary shifted
// outward, one inward, then taking the difference. The delta captures how
// sensitive this location is to boundary movement.
// ============================================================================

function computeStrategicC(tiles) {
	// N scales with planet size: use the maximum shore value found on this planet
	// as a proxy for body scale, then take ~15% of that as the shift radius.
	var maxShore = 0;
	for (var i = 0; i < tiles.length; i++) {
		var s = Math.abs(tiles[i].shore || 0);
		if (s > maxShore) maxShore = s;
	}
	var N = Math.max(2, Math.round(maxShore * 0.225));

	if (typeof calculateShoreDelta === "function") {
		calculateShoreDelta(tiles, N);
	}

	// Now copy the computed _shoreDelta to _strategicC
	for (var i = 0; i < tiles.length; i++) {
		tiles[i]._strategicC = tiles[i]._shoreDelta || 0;
	}

	// Normalise per domain.
	var maxL = 0, maxO = 0;
	for (var i = 0; i < tiles.length; i++) {
		var t = tiles[i];
		if (t.elevation > 0  && t._strategicC > maxL) maxL = t._strategicC;
		if (t.elevation <= 0 && t._strategicC > maxO) maxO = t._strategicC;
	}
	for (var i = 0; i < tiles.length; i++) {
		var t = tiles[i];
		var mx = t.elevation > 0 ? maxL : maxO;
		t._strategicC = mx > 0 ? t._strategicC / mx : 0;
	}
}

// NOTE: the old SHORE TREE overlay ("shoreTree", node-distance BFS tree) was
// deleted — superseded by the Shore Tree (Skeleton) / Shore Branch Depth pair
// in generatePlanetRenderData_functions.js.

// ============================================================================
// OVERLAY REGISTRATION
// ============================================================================

registerColorOverlay(
	"strategicA", "Strategic: Transit Centrality",
	"Routes between the top calorie-producing river mouths over land, ocean, " +
	"and cross-domain paths (can transition between land and ocean). " +
	"Domain-restricted scores set the base hue (gold on land, cyan in ocean); " +
	"the cross-domain score tints magenta over the top, marking chokepoints " +
	"that matter regardless of which side of the coast you're on.",
	function(tile) {
		if (!tile.hasOwnProperty('_strategicA')) return new THREE.Color(0x888888);
		// Combine domain-restricted and cross-domain scores; same hue per domain.
		var intensity = Math.min(1, Math.max(tile._strategicA, tile._strategicA_cross || 0));
		if (tile.elevation > 0)
			return new THREE.Color(getOverlayColor('strategicA', 'landLow', '#3c3c14'))
				.lerp(new THREE.Color(getOverlayColor('strategicA', 'landHigh', '#ffd700')), intensity); // warm-brown → gold
		else
			return new THREE.Color(getOverlayColor('strategicA', 'oceanLow', '#1e2850'))
				.lerp(new THREE.Color(getOverlayColor('strategicA', 'oceanHigh', '#00ffd0')), intensity); // dark-blue → cyan
	},
	"basic", "lazy", "strategic"
);
defineOverlayColors("strategicA", [
	{ key: "landLow",   label: "Land low",   def: "#3c3c14" },
	{ key: "landHigh",  label: "Land high",  def: "#ffd700" },
	{ key: "oceanLow",  label: "Ocean low",  def: "#1e2850" },
	{ key: "oceanHigh", label: "Ocean high", def: "#00ffd0" }
]);


registerColorOverlay(
	"strategicC", "Strategic: Shore Delta (Boundary Shift Sensitivity)",
	"For each tile, the difference between its position if the shore boundary " +
	"shifted outward vs. inward by one step. High = mouths of deep bays, " +
	"isolated islands, narrow peninsulas (where small shifts matter greatly); " +
	"low = stable interior tiles. Tiles whose delta does not exceed 2N keep their " +
	"natural terrain colour; the rest are shaded on separate, editable land and " +
	"water gradients.",
	function(tile) {
		if (!tile.hasOwnProperty('_strategicC')) return new THREE.Color(0x888888);
		var v = tile._strategicC;
		// Below the 2N display floor the delta was zeroed — leave the tile uncoloured.
		if (v <= 0) return calculateTerrainColor(tile);
		// Distinct gradients per domain so land and water deltas read differently.
		if (tile.elevation > 0)
			return new THREE.Color(getOverlayColor('strategicC', 'landLow', '#3a0d0d'))
				.lerp(new THREE.Color(getOverlayColor('strategicC', 'landHigh', '#ffd23f')), v);
		return new THREE.Color(getOverlayColor('strategicC', 'waterLow', '#15294a'))
			.lerp(new THREE.Color(getOverlayColor('strategicC', 'waterHigh', '#3fffd4')), v);
	},
	"basic", "lazy", "strategic"
);


// ============================================================================
// SHARED HELPERS FOR REGION / TERRAIN-FEATURE OVERLAYS
// ============================================================================

function _isLand(t) { return t.elevation > 0; }

// elevation value at a percentile of the land distribution (0..1).
function _landElevationThreshold(landTiles, pct) {
	if (!landTiles.length) return 0;
	var arr = landTiles.map(function (t) { return t.elevation; }).sort(function (a, b) { return a - b; });
	var i = Math.min(arr.length - 1, Math.max(0, Math.floor(pct * arr.length)));
	return arr[i];
}

// Granulometric thickness of a highland mask: hop-distance inward from the mask
// boundary. Non-mask tiles get 0; the deep core of a wide massif gets large
// values, a thin ridge stays near 1. This is the "granulometry" signal that the
// terrain-feature overlays combine with watersheds.
function _highlandInteriorness(landTiles, isHighland, outProp) {
	var queue = [], qi = 0;
	for (var i = 0; i < landTiles.length; i++) {
		var t = landTiles[i];
		t[outProp] = 0;
		if (!isHighland(t)) continue;
		var nb = t.tiles, edge = false;
		for (var k = 0; k < nb.length; k++) {
			if (!_isLand(nb[k]) || !isHighland(nb[k])) { edge = true; break; }
		}
		if (edge) { t[outProp] = 1; queue.push(t); }
	}
	while (qi < queue.length) {
		var c = queue[qi++], nb2 = c.tiles;
		for (var k = 0; k < nb2.length; k++) {
			var n = nb2[k];
			if (_isLand(n) && isHighland(n) && n[outProp] === 0) { n[outProp] = c[outProp] + 1; queue.push(n); }
		}
	}
}

// Connected components over the land graph. includeFn gates membership; sameFn
// requires two adjacent included tiles to belong to the same component.
function _landComponents(landTiles, includeFn, sameFn) {
	var seen = new Set(), comps = [];
	for (var i = 0; i < landTiles.length; i++) {
		var start = landTiles[i];
		if (seen.has(start) || !includeFn(start)) continue;
		var comp = [], stack = [start];
		seen.add(start);
		while (stack.length) {
			var c = stack.pop();
			comp.push(c);
			var nb = c.tiles;
			for (var k = 0; k < nb.length; k++) {
				var n = nb[k];
				if (!seen.has(n) && _isLand(n) && includeFn(n) && sameFn(c, n)) { seen.add(n); stack.push(n); }
			}
		}
		comps.push(comp);
	}
	return comps;
}

// Default editable palettes for the id-indexed region overlays (mountain ranges,
// terrain features). Warm set for highlands/massifs, green set for lowlands.
var MOUNTAIN_PALETTE_DEFAULT = ["#6b4f2a", "#8a5a2b", "#a9743b", "#c2925a", "#7a5230", "#9c6b3f", "#b07d4a", "#5e421f"];
var LAND_PALETTE_DEFAULT     = ["#3a6b35", "#4e8c3f", "#6aa84f", "#8bbf66", "#2f5e2c", "#5b9748", "#79b85e", "#46813c"];

// Stable distinct colour per integer id. family: 'land' (green), 'mountain'
// (warm/brown), 'water' (blue).
function _hueColor(id, family) {
	var h = (id * 0.61803398875) % 1;
	var j = (id * 0.382) % 1;
	if (family === 'mountain') return new THREE.Color().setHSL(0.04 + h * 0.09, 0.5, 0.34 + 0.16 * j);
	if (family === 'water') return new THREE.Color().setHSL(0.55 + h * 0.12, 0.6, 0.5);
	return new THREE.Color().setHSL(0.22 + h * 0.20, 0.48, 0.42 + 0.12 * j);
}

// ============================================================================
// MERGED WATERSHED REGIONS  (Task: clone of "Watershed Regions" with merging)
//
// Greedily merges ADJACENT drainage basins. Each candidate pair gets a tunable
// "desirability": rewarded for eliminating shared border (border reduction),
// penalised for merging large basins or crossing a high-elevation (mountain)
// divide, and strongly biased to absorb tiny basins. Same 6-colour scheme as the
// original Watershed Regions overlay, assigned by adjacency-aware graph colouring.
// ============================================================================

var mergedWatershedConfig = {
	borderWeight: 3.0, // reward for the fraction of the smaller basin's border that the merge removes
	sizeWeight: 0.05,  // penalty proportional to the smaller basin's size (dislike merging large basins)
	elevWeight: 0.8,   // penalty proportional to mean boundary elevation (dislike high-elevation divides)
	oceanPenalty: 0.5, // penalty when the shared divide terminates at the ocean (touches the coast)
	tinySize: 40,      // basins with this many tiles or fewer ALWAYS merge into a neighbour
	threshold: 0.05    // keep merging while the best pair's desirability stays at/above this
};

var MERGED_WATERSHED_PALETTE = [0xE2E8C6, 0xB7C779, 0x7D8A42, 0xA67B5B, 0x6F5A4D, 0x4D3B2E];

// ---------------------------------------------------------------------------
// Shared watershed-merge engine. Builds the basin-adjacency graph (with shared
// border length, mean boundary elevation and mean boundary |shore| per pair),
// then greedily merges the most desirable adjacent pair while
// opts.keepMerging(bestD, regionCount) says to. Afterwards every region at or
// below opts.tinySize is force-merged into its most desirable neighbour
// (replaces the old "tiny bonus" term). Returns the union-find context.
// ---------------------------------------------------------------------------
function _watershedMergeEngine(planet, opts) {
	var tiles = planet.topology.tiles;
	var watersheds = (planet.topology && planet.topology.watersheds) || [];
	var W = watersheds.length;
	if (!W) return null;

	var idx = new Map();
	for (var i = 0; i < W; i++) idx.set(watersheds[i], i);

	var parent = new Array(W), size = new Array(W), perim = new Array(W), adj = new Array(W);
	for (var i = 0; i < W; i++) { parent[i] = i; size[i] = watersheds[i].tiles.length; perim[i] = 0; adj[i] = new Map(); }
	function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }

	// Max land |shore| for normalizing boundary interiorness.
	var maxShore = 1;
	for (i = 0; i < tiles.length; i++) {
		if (tiles[i].shore > maxShore) maxShore = tiles[i].shore;
	}

	// Build the region-adjacency graph from land-tile neighbours. Each undirected
	// boundary edge is seen twice (once from each side), keeping adj symmetric.
	for (i = 0; i < tiles.length; i++) {
		var t = tiles[i];
		if (!t.watershed) continue;
		var a = idx.get(t.watershed); if (a === undefined) continue;
		var nb = t.tiles;
		for (var k = 0; k < nb.length; k++) {
			var n = nb[k];
			if (!n.watershed || n.watershed === t.watershed) continue;
			var b = idx.get(n.watershed); if (b === undefined) continue;
			perim[a]++;
			var be = (t.elevation + n.elevation) * 0.5;
			var bs = (Math.abs(t.shore || 0) + Math.abs(n.shore || 0)) * 0.5 / maxShore;
			// the divide "terminates at the ocean" when one of its edges sits on
			// the coast (either side of the boundary pair is a shore==1 tile)
			var ct = (Math.abs(t.shore || 0) <= 1 || Math.abs(n.shore || 0) <= 1) ? 1 : 0;
			var m = adj[a].get(b);
			if (!m) adj[a].set(b, { shared: 1, elevSum: be, shoreSum: bs, coastTouch: ct });
			else { m.shared++; m.elevSum += be; m.shoreSum += bs; m.coastTouch += ct; }
		}
	}

	var meanSize = 0;
	for (i = 0; i < W; i++) meanSize += size[i];
	meanSize /= W; if (meanSize < 1) meanSize = 1;
	var regionCount = W;

	var ctx = { size: size, perim: perim, adj: adj, meanSize: meanSize, find: find, watersheds: watersheds, idx: idx };

	function desirability(a, b) {
		var m = adj[a].get(b);
		if (!m) return -Infinity;
		return opts.desirability(ctx, a, b, m);
	}

	function merge(a, b) {
		var m = adj[a].get(b);
		var sharedAB = m ? m.shared : 0;
		parent[b] = a;
		size[a] += size[b];
		perim[a] = perim[a] + perim[b] - 2 * sharedAB;
		adj[a].delete(b);
		adj[b].forEach(function (rec, g) {
			if (g === a) return;
			adj[g].delete(b);
			var ag = adj[a].get(g);
			if (ag) { ag.shared += rec.shared; ag.elevSum += rec.elevSum; ag.shoreSum += rec.shoreSum; ag.coastTouch += rec.coastTouch; }
			else adj[a].set(g, { shared: rec.shared, elevSum: rec.elevSum, shoreSum: rec.shoreSum, coastTouch: rec.coastTouch });
			var ga = adj[g].get(a);
			if (ga) { ga.shared += rec.shared; ga.elevSum += rec.elevSum; ga.shoreSum += rec.shoreSum; ga.coastTouch += rec.coastTouch; }
			else adj[g].set(a, { shared: rec.shared, elevSum: rec.elevSum, shoreSum: rec.shoreSum, coastTouch: rec.coastTouch });
		});
		adj[b] = new Map();
		regionCount--;
	}

	var safety = W * 4;
	while (safety-- > 0) {
		var bestD = -Infinity, bestA = -1, bestB = -1;
		for (var g = 0; g < W; g++) {
			if (find(g) !== g) continue;
			adj[g].forEach(function (rec, h) {
				if (h <= g || find(h) !== h) return;
				var d = desirability(g, h);
				if (d > bestD) { bestD = d; bestA = g; bestB = h; }
			});
		}
		if (bestA < 0 || !opts.keepMerging(bestD, regionCount)) break;
		merge(bestA, bestB);
	}

	// Forced tiny-basin absorption: every region at/below tinySize merges into
	// its most desirable neighbour regardless of threshold.
	var tinySize = opts.tinySize || 0;
	if (tinySize > 0) {
		var changed = true;
		safety = W * 2;
		while (changed && safety-- > 0) {
			changed = false;
			for (g = 0; g < W; g++) {
				if (find(g) !== g || size[g] > tinySize || adj[g].size === 0) continue;
				var bD = -Infinity, bH = -1;
				adj[g].forEach(function (rec, h) {
					if (find(h) !== h) return;
					var d = desirability(g, h);
					if (d > bD) { bD = d; bH = h; }
				});
				if (bH >= 0) { merge(g, bH); changed = true; }
			}
		}
	}

	ctx.regionCount = regionCount;
	ctx.groupTilesByRoot = function() {
		var groupTiles = {};
		for (var i2 = 0; i2 < tiles.length; i2++) {
			var t2 = tiles[i2];
			if (!t2.watershed) continue;
			var a2 = idx.get(t2.watershed); if (a2 === undefined) continue;
			var root = find(a2);
			(groupTiles[root] = groupTiles[root] || []).push(t2);
		}
		return groupTiles;
	};
	return ctx;
}

function computeMergedWatersheds(planet) {
	var tiles = planet.topology.tiles;
	for (var i = 0; i < tiles.length; i++) tiles[i]._mwColor = null;
	var cfg = mergedWatershedConfig;

	var ctx = _watershedMergeEngine(planet, {
		desirability: function(c, a, b, m) {
			var minPerim = Math.min(c.perim[a], c.perim[b]); if (minPerim < 1) minPerim = 1;
			var borderFrac = m.shared / minPerim;
			var minSize = Math.min(c.size[a], c.size[b]);
			var avgElev = m.elevSum / m.shared;
			return cfg.borderWeight * borderFrac - cfg.sizeWeight * (minSize / c.meanSize) - cfg.elevWeight * avgElev
				- cfg.oceanPenalty * (m.coastTouch > 0 ? 1 : 0);
		},
		keepMerging: function(bestD) { return bestD >= cfg.threshold; },
		tinySize: cfg.tinySize
	});
	if (!ctx) return;
	var adj = ctx.adj, find = ctx.find;
	var groupTiles = ctx.groupTilesByRoot();

	// Adjacency-aware graph colouring with the watershed palette.
	var roots = Object.keys(groupTiles).map(Number);
	roots.sort(function (x, y) { return adj[y].size - adj[x].size; });
	var colorOf = {};
	for (var i = 0; i < roots.length; i++) {
		var g = roots[i], used = {};
		adj[g].forEach(function (rec, h) { var hr = find(h); if (colorOf[hr] !== undefined) used[colorOf[hr]] = true; });
		var c = 0; while (c < MERGED_WATERSHED_PALETTE.length && used[c]) c++;
		if (c >= MERGED_WATERSHED_PALETTE.length) c = 0;
		colorOf[g] = c;
	}
	for (var r in groupTiles) {
		var ci = colorOf[r] !== undefined ? colorOf[r] : 0;
		var ts = groupTiles[r];
		// Store the palette INDEX (not a baked colour) so the Layer Colors pickers
		// can recolour regions live without recomputing the merge.
		for (var j = 0; j < ts.length; j++) ts[j]._mwColorIdx = ci;
	}
}

// Live retuning from the console: regenerateMergedWatersheds({ elevWeight: 2 })
function regenerateMergedWatersheds(overrides) {
	if (overrides) for (var k in overrides) mergedWatershedConfig[k] = overrides[k];
	if (typeof planet === "undefined" || !planet || !planet.topology) return;
	computeMergedWatersheds(planet);
	if (typeof surfaceRenderMode !== "undefined" && surfaceRenderMode === "mergedWatersheds" &&
		typeof recalculateBufferGeometryColors === "function" &&
		planet.renderData && planet.renderData.surface && planet.renderData.surface.geometry) {
		recalculateBufferGeometryColors(planet.topology.tiles, planet.renderData.surface.geometry, surfaceRenderMode);
	}
}

registerColorOverlay(
	"mergedWatersheds", "Watershed Regions (Merged)",
	"Drainage basins greedily merged into larger regions. Merges favour border " +
	"reduction, resist joining large basins or crossing high-elevation divides, " +
	"and almost always absorb tiny basins. Tunable via regenerateMergedWatersheds(). " +
	"Same colour scheme as Watershed Regions.",
	function (tile) {
		if (tile.elevation <= 0) return new THREE.Color(getOverlayColor('mergedWatersheds', 'ocean', '#6699cc'));
		if (tile._mwColorIdx != null) {
			var keys = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];
			var defs = MERGED_WATERSHED_PALETTE;
			var i = tile._mwColorIdx % keys.length;
			return new THREE.Color(getOverlayColor('mergedWatersheds', keys[i], '#' + defs[i].toString(16)));
		}
		if (tile.watershed && tile.watershed.color) return new THREE.Color(tile.watershed.color);
		return new THREE.Color(0x888888);
	},
	"basic", "lazy", "features"
);

// ---------------------------------------------------------------------------
// WATERSHED-MERGE VARIANTS (used by Features K and M in
// generatePlanetRenderData_functions.js — both return { tileId: regionId }).
// ---------------------------------------------------------------------------

// K — PENINSULA-AWARE MERGE: same greedy merge, but the boundary's mean
// interiorness (|shore|, normalized) shifts desirability: merging across a
// deep-interior divide is encouraged, merging across a coastal NECK (low
// |shore| on both sides — exactly where a peninsula joins the mainland) is
// strongly discouraged. Peninsulas, capes and other appendages therefore stay
// their own groups while interior basins coalesce.
var watershedPeninsulaConfig = {
	borderWeight: 3.0,
	sizeWeight: 0.05,
	elevWeight: 0.3,
	neckMid: 0.25,     // boundary interiorness below this BLOCKS the merge
	tinySize: 40,
	threshold: 0.05
};

function computeWatershedPeninsulas(planet) {
	var cfg = watershedPeninsulaConfig;
	var ctx = _watershedMergeEngine(planet, {
		desirability: function(c, a, b, m) {
			var minPerim = Math.min(c.perim[a], c.perim[b]); if (minPerim < 1) minPerim = 1;
			var borderFrac = m.shared / minPerim;
			var minSize = Math.min(c.size[a], c.size[b]);
			var avgElev = m.elevSum / m.shared;
			var avgShore = m.shoreSum / m.shared; // 0 coast .. 1 deepest interior
			// The border reward is GATED by signed interiorness: a divide deep in
			// the interior keeps its full reward, while one running along the coast
			// (a peninsula neck) flips the score negative no matter how much border
			// the merge would erase.
			var gate = (avgShore - cfg.neckMid) / (1 - cfg.neckMid);
			return cfg.borderWeight * borderFrac * gate
				- cfg.sizeWeight * (minSize / c.meanSize)
				- cfg.elevWeight * avgElev;
		},
		keepMerging: function(bestD) { return bestD >= cfg.threshold; },
		tinySize: cfg.tinySize
	});
	if (!ctx) return {};
	var out = {}, groups = ctx.groupTilesByRoot();
	for (var r in groups) {
		var ts = groups[r];
		for (var j = 0; j < ts.length; j++) out[ts[j].id] = +r;
	}
	return out;
}

// Live retuning of Features K from the sliders / console.
function regenerateWatershedPeninsulas(overrides) {
	if (overrides) for (var k in overrides) watershedPeninsulaConfig[k] = overrides[k];
	if (typeof planet === "undefined" || !planet || !planet.topology) return;
	var agg = planet._overlayAggregates && planet._overlayAggregates.featureGroupings;
	if (!agg) return; // background pass not finished yet
	agg.basins = computeWatershedPeninsulas(planet);
	if (typeof surfaceRenderMode !== "undefined" && surfaceRenderMode === "featBasinsK" &&
		typeof recalculateBufferGeometryColors === "function" &&
		planet.renderData && planet.renderData.surface && planet.renderData.surface.geometry) {
		recalculateBufferGeometryColors(planet.topology.tiles, planet.renderData.surface.geometry, surfaceRenderMode);
	}
}

// ============================================================================
// MOUNTAIN / HILL RANGES  (Task: collect ranges as tile groups, coloured)
//
// Connected components of land above a "hill" elevation percentile. Each range
// gets a distinct warm hue; tiles above the higher "mountain" percentile are
// brightened, hills are darkened, so peaks read within their range.
// ============================================================================

// Absolute elevation thresholds (not percentiles). A range is a connected set
// of WATERSHED-BORDER tiles (land tiles with a neighbour in a different
// drainage basin) above the hill height — drainage divides ARE the ridgelines,
// so this traces the crest of each range. Tiles above the mountain height are
// brightened within their range.
var mountainRangeConfig = { hillHeight: 0.35, mountainHeight: 0.60, minSize: 3 };

function computeMountainRanges(tiles) {
	for (var i = 0; i < tiles.length; i++) { tiles[i]._rangeId = 0; tiles[i]._rangeKind = 0; }
	var land = tiles.filter(_isLand);
	if (!land.length) return;
	var cfg = mountainRangeConfig;
	function onWatershedBorder(t) {
		if (!t.watershed) return false;
		var nb = t.tiles;
		for (var k = 0; k < nb.length; k++) {
			if (nb[k].watershed && nb[k].watershed !== t.watershed) return true;
		}
		return false;
	}
	var inRange = function (t) { return t.elevation >= cfg.hillHeight && onWatershedBorder(t); };
	var comps = _landComponents(land, inRange, function () { return true; });
	var rid = 0;
	for (var c = 0; c < comps.length; c++) {
		if (comps[c].length < cfg.minSize) continue;
		rid++;
		for (var j = 0; j < comps[c].length; j++) {
			var t = comps[c][j];
			t._rangeId = rid;
			t._rangeKind = t.elevation >= cfg.mountainHeight ? 2 : 1;
		}
	}
}

// Live retuning of the mountain-range thresholds from the sliders / console.
function regenerateMountainRanges(overrides) {
	if (overrides) for (var k in overrides) mountainRangeConfig[k] = overrides[k];
	if (typeof planet === "undefined" || !planet || !planet.topology) return;
	computeMountainRanges(planet.topology.tiles);
	if (typeof surfaceRenderMode !== "undefined" && surfaceRenderMode === "mountainRanges" &&
		typeof recalculateBufferGeometryColors === "function" &&
		planet.renderData && planet.renderData.surface && planet.renderData.surface.geometry) {
		recalculateBufferGeometryColors(planet.topology.tiles, planet.renderData.surface.geometry, surfaceRenderMode);
	}
}

registerColorOverlay(
	"mountainRanges", "Mountain & Hill Ranges",
	"Contiguous uplands grouped into ranges (connected land above a hill-elevation " +
	"percentile), each a distinct colour. Mountain-percentile tiles are brightened, " +
	"hills darkened. Lowlands keep their terrain colour.",
	function (tile) {
		if (!tile._rangeId) return calculateTerrainColor(tile);
		var base = getOverlayPaletteColor("mountainRanges", "ranges", tile._rangeId - 1, MOUNTAIN_PALETTE_DEFAULT);
		return tile._rangeKind === 2 ? base.offsetHSL(0, 0, 0.12) : base.offsetHSL(0, 0, -0.07);
	},
	"basic", "lazy", "features"
);
defineOverlayPalette("mountainRanges", "ranges", "Ranges", MOUNTAIN_PALETTE_DEFAULT);

// ============================================================================
// TERRAIN FEATURES (watersheds + granulometry) — two approaches
//
// W1 "Basin Relief": every drainage basin is split into nested relief tiers
//    (valley / slope / granulometric core) so each basin shows a mountainous
//    interior fading to valley fingers.
// W2 "Massifs & Lowlands": granulometric highland blocks become massif features
//    (warm hues, connected components); the remaining lowland tiles are grouped
//    by watershed (green hues). Separates ranges from plains naturally.
// ============================================================================

function computeTerrainFeaturesBasin(tiles) {
	for (var i = 0; i < tiles.length; i++) { tiles[i]._tfBId = 0; tiles[i]._tfBTier = 0; }
	var land = tiles.filter(_isLand);
	if (!land.length) return;
	var hi = _landElevationThreshold(land, 0.60);
	var isHigh = function (t) { return t.elevation >= hi; };
	_highlandInteriorness(land, isHigh, '_tfBHi');
	var tierOf = function (t) { if (!isHigh(t)) return 0; return (t._tfBHi >= 3) ? 2 : 1; };
	var sameWs = function (a, b) {
		var aw = a.watershed ? a.watershed.id : -1, bw = b.watershed ? b.watershed.id : -1;
		return aw === bw && tierOf(a) === tierOf(b);
	};
	var comps = _landComponents(land, function () { return true; }, sameWs);
	var id = 0;
	for (var c = 0; c < comps.length; c++) {
		id++;
		var tier = tierOf(comps[c][0]);
		for (var j = 0; j < comps[c].length; j++) { comps[c][j]._tfBId = id; comps[c][j]._tfBTier = tier; }
	}
}

registerColorOverlay(
	"terrainBasinRelief", "Terrain Features: Basin Relief",
	"Each drainage basin split by granulometric relief: granulometric core (warm), " +
	"slope (dark green), and valley floor (light green). Combines watersheds with a " +
	"highland-interiorness granulometry.",
	function (tile) {
		if (!_isLand(tile) || !tile._tfBId) return calculateTerrainColor(tile);
		var i = tile._tfBId - 1;
		if (tile._tfBTier === 2) return getOverlayPaletteColor("terrainBasinRelief", "core", i, MOUNTAIN_PALETTE_DEFAULT);
		if (tile._tfBTier === 1) return getOverlayPaletteColor("terrainBasinRelief", "valley", i, LAND_PALETTE_DEFAULT).offsetHSL(0, 0, -0.08);
		return getOverlayPaletteColor("terrainBasinRelief", "valley", i, LAND_PALETTE_DEFAULT).offsetHSL(0, 0, 0.05);
	},
	"basic", "lazy", "features"
);
defineOverlayPalette("terrainBasinRelief", "core",   "Core (high)", MOUNTAIN_PALETTE_DEFAULT);
defineOverlayPalette("terrainBasinRelief", "valley", "Valley",      LAND_PALETTE_DEFAULT);

function computeTerrainFeaturesMassif(tiles) {
	for (var i = 0; i < tiles.length; i++) { tiles[i]._tfMId = 0; tiles[i]._tfMKind = 0; }
	var land = tiles.filter(_isLand);
	if (!land.length) return;
	var hi = _landElevationThreshold(land, 0.62);
	var isHigh = function (t) { return t.elevation >= hi; };
	_highlandInteriorness(land, isHigh, '_tfMHi');
	var id = 0;
	var massifs = _landComponents(land, isHigh, function () { return true; });
	for (var c = 0; c < massifs.length; c++) {
		if (massifs[c].length < 3) continue; // too small to be a massif — falls through to lowland
		id++;
		for (var j = 0; j < massifs[c].length; j++) { massifs[c][j]._tfMId = id; massifs[c][j]._tfMKind = 2; }
	}
	// Lowland (everything not a massif) grouped by watershed.
	var wsMap = {}, lid = id;
	for (var i = 0; i < land.length; i++) {
		var t = land[i];
		if (t._tfMKind === 2) continue;
		var w = t.watershed ? t.watershed.id : -1;
		if (wsMap[w] === undefined) { lid++; wsMap[w] = lid; }
		t._tfMId = wsMap[w]; t._tfMKind = 1;
	}
}

registerColorOverlay(
	"terrainMassif", "Terrain Features: Massifs & Lowlands",
	"Granulometric highland blocks become massif features (warm hues); the " +
	"remaining lowland tiles are grouped by watershed (green hues). Combines " +
	"watersheds with granulometry to separate ranges from plains.",
	function (tile) {
		if (!_isLand(tile) || !tile._tfMId) return calculateTerrainColor(tile);
		var i = tile._tfMId - 1;
		return tile._tfMKind === 2
			? getOverlayPaletteColor("terrainMassif", "massif",  i, MOUNTAIN_PALETTE_DEFAULT)
			: getOverlayPaletteColor("terrainMassif", "lowland", i, LAND_PALETTE_DEFAULT);
	},
	"basic", "lazy", "features"
);
defineOverlayPalette("terrainMassif", "massif",  "Massif",  MOUNTAIN_PALETTE_DEFAULT);
defineOverlayPalette("terrainMassif", "lowland", "Lowland", LAND_PALETTE_DEFAULT);

// ============================================================================
// ENTRY POINT (called from planet generation pipeline)
// ============================================================================

function generateStrategicOverlays(planet) {
	var tiles = planet.topology.tiles;
	ctime('Strategic A: Transit Centrality');
	computeStrategicA(tiles, planet);
	ctimeEnd('Strategic A: Transit Centrality');
	generateStrategicOverlaysRest(planet);
}

// Everything except Transit Centrality. The main pipeline runs centrality
// incrementally (computeStrategicA_begin/step/end) and then calls this; the
// save/load paths use generateStrategicOverlays (all-at-once) above.
function generateStrategicOverlaysRest(planet) {
	var tiles = planet.topology.tiles;
	ctime('Strategic C: Shore Delta @ N');
	computeStrategicC(tiles);
	ctimeEnd('Strategic C: Shore Delta @ N');
	ctime('Merged Watersheds');
	computeMergedWatersheds(planet);
	ctimeEnd('Merged Watersheds');
	ctime('Mountain Ranges');
	computeMountainRanges(tiles);
	ctimeEnd('Mountain Ranges');
	ctime('Terrain Features (watershed + granulometry)');
	computeTerrainFeaturesBasin(tiles);
	computeTerrainFeaturesMassif(tiles);
	ctimeEnd('Terrain Features (watershed + granulometry)');
}
