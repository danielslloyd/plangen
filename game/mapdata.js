// mapdata.js — loads a plangen-game-map file (docs/game-export-format.md) and
// decodes it into typed arrays + derived geometry the game uses everywhere.
//
// Exposes: loadMapData(json) -> M (the global map object)
//   M.n / M.nEdges          tile / edge counts
//   M.layer(name)           Float32Array of real (descaled) per-tile values
//   M.edgeLayer(name)       same for edges
//   M.latLon                Float32Array [lat,lon] degrees per tile
//   M.polys                 per-tile polygon [[lon,lat],...] unwrapped near center
//   M.neighbors[t]          array of tile indices
//   M.tileEdges[t]          array of edge indices (aligned with neighbors)
//   M.edgeA/edgeB           Int32Array endpoints per edge
//   M.edgeBetween(a,b)      edge index or -1
//   M.isLand/isWater(t), M.terrainName(t)
//   M.bfsDistance(seeds, opts) multi-source hop distances

var M = null;

function _decodeLayer(def, count) {
	var out = new Float32Array(count);
	if (!def) return out;
	var scale = def.scale || 1;
	if (def.sparse) {
		for (var i = 0; i < def.indices.length; i++) out[def.indices[i]] = def.values[i] / scale;
	} else {
		for (var j = 0; j < count; j++) out[j] = (def.values[j] || 0) / scale;
	}
	return out;
}

function loadMapData(json) {
	if (!json || json.format !== "plangen-game-map") {
		throw new Error("Not a plangen-game-map file");
	}
	var g = json.geometry;
	var n = json.meta.counts.tiles;
	var nEdges = json.meta.counts.edges;

	var m = {
		raw: json, n: n, nEdges: nEdges, meta: json.meta, legend: json.legend,
		_tileCache: {}, _edgeCache: {}
	};

	m.layer = function (name) {
		if (!(name in m._tileCache)) m._tileCache[name] = _decodeLayer(json.tileLayers[name], n);
		return m._tileCache[name];
	};
	m.edgeLayer = function (name) {
		if (!(name in m._edgeCache)) m._edgeCache[name] = _decodeLayer(json.edgeLayers[name], nEdges);
		return m._edgeCache[name];
	};

	// --- geometry decode ----------------------------------------------------
	function toLatLon(x, y, z) {
		var r = Math.sqrt(x * x + y * y + z * z) || 1;
		// PlanGen axes: y = north pole, z = prime meridian (see cartesianToSpherical)
		var lat = Math.asin(y / r) * 180 / Math.PI;
		var lon = Math.atan2(x / r, z / r) * 180 / Math.PI;
		return [lat, lon];
	}

	var latLon = new Float32Array(n * 2);
	for (var t = 0; t < n; t++) {
		var ll = toLatLon(g.tileCenters[t * 3] / 10000, g.tileCenters[t * 3 + 1] / 10000, g.tileCenters[t * 3 + 2] / 10000);
		latLon[t * 2] = ll[0]; latLon[t * 2 + 1] = ll[1];
	}
	m.latLon = latLon;

	var nCorners = json.meta.counts.corners;
	var cornerLL = new Float32Array(nCorners * 2);
	for (var c = 0; c < nCorners; c++) {
		var cl = toLatLon(g.corners[c * 3] / 10000, g.corners[c * 3 + 1] / 10000, g.corners[c * 3 + 2] / 10000);
		cornerLL[c * 2] = cl[0]; cornerLL[c * 2 + 1] = cl[1];
	}
	m.cornerLL = cornerLL;

	// Tile polygons in [lon, lat], corner longitudes unwrapped to the tile
	// center so tiles crossing the antimeridian stay contiguous.
	m.polys = new Array(n);
	for (t = 0; t < n; t++) {
		var cLon = latLon[t * 2 + 1];
		var ring = g.tileCorners[t], poly = new Array(ring.length);
		for (var k = 0; k < ring.length; k++) {
			var lon = cornerLL[ring[k] * 2 + 1], lat = cornerLL[ring[k] * 2];
			while (lon - cLon > 180) lon -= 360;
			while (lon - cLon < -180) lon += 360;
			poly[k] = [lon, lat];
		}
		m.polys[t] = poly;
	}

	m.neighbors = g.tileNeighbors;
	m.tileEdges = g.tileEdges;

	m.edgeA = new Int32Array(nEdges);
	m.edgeB = new Int32Array(nEdges);
	var pairMap = new Map();
	for (var e = 0; e < nEdges; e++) {
		m.edgeA[e] = g.edges[e * 2];
		m.edgeB[e] = g.edges[e * 2 + 1];
		pairMap.set(m.edgeA[e] + "|" + m.edgeB[e], e);
	}
	m.edgeBetween = function (a, b) {
		var e2 = pairMap.get(Math.min(a, b) + "|" + Math.max(a, b));
		return e2 === undefined ? -1 : e2;
	};

	// --- convenience --------------------------------------------------------
	var elevation = m.layer("elevation");
	var terrain = m.layer("terrain");
	var TN = json.legend.terrain;
	m.T = {};
	TN.forEach(function (name, i) { m.T[name] = i; });
	m.terrainName = function (t2) { return TN[terrain[t2]] || "?"; };
	m.isWater = function (t2) {
		var ter = terrain[t2];
		return ter === m.T.ocean || ter === m.T.coast || ter === m.T.seaIce || ter === m.T.lake;
	};
	m.isLand = function (t2) { return !m.isWater(t2); };
	// Tiles a land unit / city can occupy.
	m.isPassable = function (t2) {
		var ter = terrain[t2];
		return !m.isWater(t2) && ter !== m.T.glacier &&
			!(GameConfig.movement.impassableMountains && ter === m.T.mountain);
	};

	m.landTiles = [];
	for (t = 0; t < n; t++) if (m.isPassable(t)) m.landTiles.push(t);

	// Multi-source BFS hop distance. opts.domain: optional tile filter.
	m.bfsDistance = function (seeds, opts) {
		opts = opts || {};
		var dist = new Int32Array(n).fill(-1);
		var q = [], qi = 0;
		seeds.forEach(function (s) { if (dist[s] === -1) { dist[s] = 0; q.push(s); } });
		while (qi < q.length) {
			var cur = q[qi++], nb = m.neighbors[cur];
			for (var k2 = 0; k2 < nb.length; k2++) {
				var x = nb[k2];
				if (dist[x] !== -1) continue;
				if (opts.domain && !opts.domain(x)) continue;
				dist[x] = dist[cur] + 1;
				q.push(x);
			}
		}
		return dist;
	};

	// Angular distance in degrees (cheap equirectangular approximation).
	m.tileDist = function (a, b) {
		var dLat = latLon[a * 2] - latLon[b * 2];
		var dLon = Math.abs(latLon[a * 2 + 1] - latLon[b * 2 + 1]);
		if (dLon > 180) dLon = 360 - dLon;
		dLon *= Math.cos((latLon[a * 2] + latLon[b * 2]) * 0.5 * Math.PI / 180);
		return Math.sqrt(dLat * dLat + dLon * dLon);
	};

	// Average neighbor spacing in degrees, so gameplay distances can be
	// expressed in "tiles" regardless of map resolution.
	var spacingSum = 0, spacingN = 0;
	for (e = 0; e < Math.min(500, nEdges); e++) {
		spacingSum += m.tileDist(m.edgeA[e], m.edgeB[e]);
		spacingN++;
	}
	m.hopDeg = spacingN ? spacingSum / spacingN : 3.5;
	// Distance in tile-hops (approximate).
	m.distTiles = function (a, b) { return m.tileDist(a, b) / m.hopDeg; };

	M = m;
	return m;
}

// ---------------------------------------------------------------------------
// Generic Dijkstra over the tile graph with a binary heap.
// costFn(from, to) -> step cost (Infinity = blocked). blockFn(t) optional:
// true = can't path THROUGH t (goal exempt). Returns {path, cost} or null.
// ---------------------------------------------------------------------------

function dijkstraPath(start, goal, costFn, blockFn, maxCost) {
	var n = M.n;
	var dist = new Float64Array(n).fill(Infinity);
	var prev = new Int32Array(n).fill(-1);
	var visited = new Uint8Array(n);
	dist[start] = 0;
	// binary min-heap of [cost, tile]
	var heap = [0, start], hn = 2; // flat pairs
	function push(c, t) {
		heap[hn++] = c; heap[hn++] = t;
		var i = hn / 2 - 1;
		while (i > 0) {
			var p = (i - 1) >> 1;
			if (heap[p * 2] <= heap[i * 2]) break;
			var tc = heap[p * 2], tt = heap[p * 2 + 1];
			heap[p * 2] = heap[i * 2]; heap[p * 2 + 1] = heap[i * 2 + 1];
			heap[i * 2] = tc; heap[i * 2 + 1] = tt;
			i = p;
		}
	}
	function pop() {
		var c = heap[0], t = heap[1];
		hn -= 2;
		heap[0] = heap[hn]; heap[1] = heap[hn + 1];
		var i = 0, size = hn / 2;
		for (;;) {
			var l = i * 2 + 1, r = l + 1, s = i;
			if (l < size && heap[l * 2] < heap[s * 2]) s = l;
			if (r < size && heap[r * 2] < heap[s * 2]) s = r;
			if (s === i) break;
			var tc = heap[s * 2], tt = heap[s * 2 + 1];
			heap[s * 2] = heap[i * 2]; heap[s * 2 + 1] = heap[i * 2 + 1];
			heap[i * 2] = tc; heap[i * 2 + 1] = tt;
			i = s;
		}
		return [c, t];
	}
	while (hn > 0) {
		var top = pop();
		var cur = top[1];
		if (visited[cur]) continue;
		visited[cur] = 1;
		if (cur === goal) break;
		if (maxCost && dist[cur] > maxCost) continue;
		var nb = M.neighbors[cur];
		for (var k = 0; k < nb.length; k++) {
			var t = nb[k];
			if (visited[t]) continue;
			if (blockFn && t !== goal && blockFn(t)) continue;
			var c = costFn(cur, t);
			if (!isFinite(c)) continue;
			var nd = dist[cur] + c;
			if (nd < dist[t]) {
				dist[t] = nd;
				prev[t] = cur;
				push(nd, t);
			}
		}
	}
	if (!isFinite(dist[goal])) return null;
	var path = [], x = goal;
	while (x !== -1) { path.push(x); x = prev[x]; }
	path.reverse();
	return { path: path, cost: dist[goal] };
}
