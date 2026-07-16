// render.js — 2D equirectangular canvas renderer with pan/zoom, data overlays,
// territory, rivers, roads/bridges, trade routes, cities, units, camps.
//
// Split into a cached BASE layer (tiles, grid, rivers, roads, borders —
// rebuilt when R.dirty) and a DYNAMIC layer (cities, units, routes, halos,
// hover previews) drawn every animation frame on top, so pulsing halos and
// animated path previews stay cheap even on big maps.

var R = {
	canvas: null, ctx: null,
	base: null, baseCtx: null,        // offscreen cache of the static map
	view: { lonC: 0, latC: 10, scale: 6 },  // scale = px per degree
	overlay: "terrain",
	priceCommodity: "wheat",
	// Optional detail layers (Layers panel in the top bar).
	layers: {
		borders: true, rivers: true, roads: true, routes: true, forts: true,
		cities: true, cityNames: true, healthBars: true,
		units: true, supplyWarnings: true, occupation: true, orders: true,
		camps: true, ranges: true, grid: false
	},
	hoverTile: -1, selectedTile: -1, selectedUnit: null, selectedCity: null,
	routeCreateFrom: null, // city id when in "new route" mode
	dirty: true,
	_fills: null, _fillsKey: "",
	_reach: null,          // cached movement-range flood for the selected unit
	_pathPrev: null        // cached hover path preview
};

var TERRAIN_COLORS = {
	ocean: "#16324f", coast: "#1f4a73", lake: "#2e6a94", seaIce: "#b8ccd8",
	glacier: "#e8eef2", desert: "#d4bd7a", plains: "#c2b25c", grassland: "#7ba84e",
	forest: "#3e6f38", tundra: "#98a189", hills: "#8a7b56", mountain: "#6c6156"
};

// Layer presets for the "detail level" buttons.
var LAYER_PRESETS = {
	minimal:  { borders: true, rivers: false, roads: false, routes: false, forts: true, cities: true, cityNames: false,
		healthBars: false, units: true, supplyWarnings: false, occupation: false, orders: false, camps: false, ranges: true, grid: false },
	standard: { borders: true, rivers: true, roads: true, routes: true, forts: true, cities: true, cityNames: true,
		healthBars: true, units: true, supplyWarnings: true, occupation: true, orders: true, camps: true, ranges: true, grid: false },
	full:     { borders: true, rivers: true, roads: true, routes: true, forts: true, cities: true, cityNames: true,
		healthBars: true, units: true, supplyWarnings: true, occupation: true, orders: true, camps: true, ranges: true, grid: true }
};

// Neutral overlay palette: overlays paint data on desaturated ground so the
// items of interest pop. Ocean that carries no data is a flat light blue.
var OVERLAY_WATER_FLAT = "#7ea6bd";    // flat light blue (no data at sea)
var OVERLAY_LAND_NEUTRAL = "#63705c";  // desaturated green (generic land)
var OVERLAY_WATER_NEUTRAL = "#4d6175"; // desaturated blue (generic sea)

function initRenderer(canvas) {
	R.canvas = canvas;
	R.ctx = canvas.getContext("2d");
	R.base = document.createElement("canvas");
	R.baseCtx = R.base.getContext("2d");
	resizeCanvas();
	window.addEventListener("resize", resizeCanvas);
}

function resizeCanvas() {
	var parent = R.canvas.parentElement;
	R.canvas.width = parent.clientWidth;
	R.canvas.height = parent.clientHeight;
	R.base.width = R.canvas.width;
	R.base.height = R.canvas.height;
	R.dirty = true;
}

function wrapLon(d) {
	while (d > 180) d -= 360;
	while (d < -180) d += 360;
	return d;
}

function projX(lonRelToCenter) { return R.canvas.width / 2 + lonRelToCenter * R.view.scale; }
function projY(lat) { return R.canvas.height / 2 - (lat - R.view.latC) * R.view.scale; }

// screen position of a tile center
function tileScreen(t) {
	var lat = M.latLon[t * 2], lon = M.latLon[t * 2 + 1];
	return [projX(wrapLon(lon - R.view.lonC)), projY(lat)];
}

function pickTile(mx, my) {
	// nearest tile center in screen space (fine for roughly-hexagonal tiles)
	var best = -1, bestD = 30 * (R.view.scale / 6) * (R.view.scale / 6 < 1 ? 1 : R.view.scale / 6);
	bestD = Math.max(25, bestD); bestD *= bestD;
	for (var t = 0; t < M.n; t++) {
		var p = tileScreen(t);
		var dx = p[0] - mx, dy = p[1] - my;
		var d = dx * dx + dy * dy;
		if (d < bestD) { bestD = d; best = t; }
	}
	return best;
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

function lerpColor(c1, c2, t) {
	t = Math.max(0, Math.min(1, t));
	var a = parseInt(c1.slice(1), 16), b = parseInt(c2.slice(1), 16);
	var r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t;
	var g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t;
	var bl = (a & 255) + ((b & 255) - (a & 255)) * t;
	return "rgb(" + Math.round(r) + "," + Math.round(g) + "," + Math.round(bl) + ")";
}
function heatColor(v) { // 0..1 dark blue -> yellow
	v = Math.max(0, Math.min(1, v));
	if (v < 0.5) return lerpColor("#2a2a55", "#1f9e89", v * 2);
	return lerpColor("#1f9e89", "#fde725", (v - 0.5) * 2);
}
function hexToRgba(hex, a) {
	var v = parseInt(hex.slice(1), 16);
	return "rgba(" + ((v >> 16) & 255) + "," + ((v >> 8) & 255) + "," + (v & 255) + "," + a + ")";
}

// ---------------------------------------------------------------------------
// Tile fill colors per overlay mode
// ---------------------------------------------------------------------------

function terrainFill(t) { return TERRAIN_COLORS[M.terrainName(t)] || "#555"; }

// Neutral ground for a tile on a data overlay: desaturated green/blue, or
// flat light blue at sea when the overlay carries no ocean data at all.
function neutralFill(t, waterHasData) {
	if (M.isWater(t)) return waterHasData ? OVERLAY_WATER_NEUTRAL : OVERLAY_WATER_FLAT;
	return OVERLAY_LAND_NEUTRAL;
}

function overlayFill(t) {
	var mode = R.overlay;
	if (mode === "terrain") return terrainFill(t);

	if (mode === "political") {
		var ow = G ? G.owner[t] : -1;
		if (ow < 0) return neutralFill(t, true);
		return lerpColor(M.isWater(t) ? OVERLAY_WATER_NEUTRAL : OVERLAY_LAND_NEUTRAL, G.players[ow].color, 0.62);
	}
	if (mode === "food") {
		var f = 0;
		COMMODITIES.forEach(function (cm) {
			if (cm.demandGroup === "food" && cm.layer) f = Math.max(f, M.layer(cm.layer)[t]);
		});
		return f > 0.05 ? heatColor(f) : neutralFill(t, true); // fish give the sea data
	}
	if (mode === "minerals") {
		var v = M.layer("iron")[t] + M.layer("copper")[t] + M.layer("gold")[t] + M.layer("silver")[t];
		return v > 0.05 ? heatColor(Math.min(1, v)) : neutralFill(t, false);
	}
	if (mode === "cityPriority" || mode === "transit" || mode === "shoreDelta") {
		var s = M.layer(mode)[t];
		if (mode === "transit") s = Math.max(s, M.layer("transitCross")[t]);
		return s > 0.03 ? heatColor(s) : neutralFill(t, false);
	}
	if (mode === "population") {
		if (!G || !G.tilePop) return neutralFill(t, false);
		var pop = G.tilePop[t];
		if (G.cityAt[t] >= 0) pop += G.cities[G.cityAt[t]].pop * 2;
		var scale = GameConfig.population.popPerFood || 6;
		return pop > 0.15 ? heatColor(Math.min(1, pop / (scale * 1.2))) : neutralFill(t, false);
	}
	if (mode === "prices") {
		if (!G) return neutralFill(t, false);
		var cid = G.ownerCity[t];
		if (cid < 0) return neutralFill(t, false);
		var city = G.cities[cid];
		var pr = city.prices[R.priceCommodity];
		if (pr === undefined) return neutralFill(t, false);
		var cm = commodityById(R.priceCommodity);
		var rel = (pr / cm.basePrice - GameConfig.trade.priceMin) / (GameConfig.trade.priceMax - GameConfig.trade.priceMin);
		return heatColor(rel);
	}
	if (mode === "traffic") {
		if (!G) return neutralFill(t, true);
		var tr = G.traffic[t];
		return tr > 0.5 ? heatColor(Math.min(1, tr / 30)) : neutralFill(t, true);
	}
	if (mode === "province") {
		if (M.isWater(t)) return OVERLAY_WATER_FLAT;
		var pv = M.layer("province")[t];
		if (!pv) return OVERLAY_LAND_NEUTRAL;
		var hue = (pv * 137.5) % 360;
		return "hsl(" + hue + ",45%,42%)";
	}
	return terrainFill(t);
}

function computeFills() {
	var key = R.overlay + "|" + R.priceCommodity + "|" + (G ? G.turn : -1);
	if (R._fills && R._fillsKey === key && R.overlay !== "political") return;
	R._fillsKey = key;
	if (!R._fills) R._fills = new Array(M.n);
	for (var t = 0; t < M.n; t++) R._fills[t] = overlayFill(t);
}

// ---------------------------------------------------------------------------
// Main draw: rebuild base when dirty, then dynamic layer every frame.
// ---------------------------------------------------------------------------

function draw() {
	if (!M) return;
	if (R.dirty) drawBase();
	var ctx = R.ctx;
	ctx.clearRect(0, 0, R.canvas.width, R.canvas.height);
	ctx.drawImage(R.base, 0, 0);
	drawDynamic(ctx);
	R.dirty = false;
}

function drawBase() {
	var ctx = R.baseCtx, W = R.canvas.width, H = R.canvas.height;
	computeFills();
	ctx.fillStyle = "#0a111c";
	ctx.fillRect(0, 0, W, H);

	var sc = R.view.scale;
	var lonHalf = W / 2 / sc + 8, latHalf = H / 2 / sc + 8;

	// tiles
	for (var t = 0; t < M.n; t++) {
		var lat = M.latLon[t * 2], lonC = M.latLon[t * 2 + 1];
		var d = wrapLon(lonC - R.view.lonC);
		if (Math.abs(d) > lonHalf || Math.abs(lat - R.view.latC) > latHalf) continue;
		var poly = M.polys[t];
		ctx.beginPath();
		for (var k = 0; k < poly.length; k++) {
			var x = projX(d + (poly[k][0] - lonC)), y = projY(poly[k][1]);
			if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
		}
		ctx.closePath();
		ctx.fillStyle = R._fills[t];
		ctx.fill();
		if (R.layers.grid || sc > 10) {
			ctx.strokeStyle = "rgba(0,0,0," + (R.layers.grid ? 0.3 : 0.15) + ")";
			ctx.lineWidth = 0.5;
			ctx.stroke();
		}
	}

	drawShorelines(ctx);
	if (R.layers.rivers) drawRivers(ctx);
	if (G) {
		if (R.layers.roads) drawRoads(ctx);
		if (R.layers.forts) drawFortEdges(ctx);
		if (R.layers.borders) drawTerritoryBorders(ctx);
	}
}

// ---------------------------------------------------------------------------
// Poly-aligned edge segments: take an edge's endpoints from the TILE's own
// unwrapped polygon (not the raw corner longitudes) so the segment always
// lines up with the drawn fill — corner-based segments could land 360° away
// near the antimeridian, which left borders partially undrawn.
// ---------------------------------------------------------------------------

function tileEdgeSegment(t, k) {
	var e = M.tileEdges[t][k];
	if (e === undefined) return null;
	var ring = M.raw.geometry.tileCorners[t];
	var cA = M.raw.geometry.edgeCorners[e * 2], cB = M.raw.geometry.edgeCorners[e * 2 + 1];
	var iA = ring.indexOf(cA), iB = ring.indexOf(cB);
	if (iA < 0 || iB < 0) return null;
	var poly = M.polys[t];
	var lonC = M.latLon[t * 2 + 1];
	var d = wrapLon(lonC - R.view.lonC);
	return [projX(d + (poly[iA][0] - lonC)), projY(poly[iA][1]),
		projX(d + (poly[iB][0] - lonC)), projY(poly[iB][1])];
}

// Every coastline gets a bold stroke so land/sea shapes read at a glance.
function drawShorelines(ctx) {
	ctx.strokeStyle = "rgba(8,15,24,0.85)";
	ctx.lineWidth = Math.max(1.5, R.view.scale * 0.24);
	ctx.lineCap = "round";
	ctx.beginPath();
	for (var t = 0; t < M.n; t++) {
		if (!M.isLand(t)) continue;
		var nb = M.neighbors[t];
		for (var k = 0; k < nb.length; k++) {
			if (!M.isWater(nb[k])) continue;
			var s = tileEdgeSegment(t, k);
			if (!s || !segVisible(s)) continue;
			ctx.moveTo(s[0], s[1]);
			ctx.lineTo(s[2], s[3]);
		}
	}
	ctx.stroke();
}

// Edge fortifications: dashed palisade (level 1, fading as it decays) or a
// solid stone wall (level 2), drawn on the owner's side of the edge.
function drawFortEdges(ctx) {
	if (!GameConfig.features.edgeFortifications || !G.fortLevel) return;
	ctx.lineCap = "butt";
	for (var e = 0; e < M.nEdges; e++) {
		var lvl = G.fortLevel[e];
		if (!lvl) continue;
		var t = M.isLand(M.edgeA[e]) ? M.edgeA[e] : M.edgeB[e];
		var k = M.tileEdges[t].indexOf(e);
		if (k < 0) continue;
		var s = tileEdgeSegment(t, k);
		if (!s || !segVisible(s)) continue;
		if (lvl === 2) {
			ctx.strokeStyle = "#d7dee6";
			ctx.lineWidth = Math.max(2.5, R.view.scale * 0.34);
			ctx.setLineDash([]);
		} else {
			var decay = G.fortDecay[e] || 0;
			var fade = Math.max(0.35, 1 - decay / Math.max(1, GameConfig.fort.decayTurns));
			ctx.strokeStyle = "rgba(222,178,106," + fade + ")";
			ctx.lineWidth = Math.max(2, R.view.scale * 0.26);
			ctx.setLineDash([Math.max(3, R.view.scale * 0.4), Math.max(2, R.view.scale * 0.2)]);
		}
		ctx.beginPath();
		ctx.moveTo(s[0], s[1]);
		ctx.lineTo(s[2], s[3]);
		ctx.stroke();
	}
	ctx.setLineDash([]);
}

function drawDynamic(ctx) {
	if (!G) return;
	if (R.layers.occupation && R.overlay === "political") drawContestedTiles(ctx);
	if (R.layers.routes) {
		drawRoutes(ctx);
		drawMerchants(ctx);
		drawTollGates(ctx);
	}
	if (R.layers.camps) drawCamps(ctx);
	if (R.layers.cities) drawCities(ctx);
	if (R.layers.units) drawUnits(ctx);
	if (R.layers.orders) drawUnitOrders(ctx);
	drawStartPick(ctx);
	drawSelection(ctx);
}

// True while something on screen is animated (halos, previews, pick modes).
function renderNeedsAnimation() {
	if (!G) return false;
	if (G.pendingStarts && G.pendingStarts.length) return true;
	if (R.selectedUnit || R.selectedTile >= 0 || R.selectedCity) return true;
	if (R.routeCreateFrom !== null) return true;
	if (typeof UI !== "undefined" && (UI.dropMode || UI.roadTargetMode !== null || UI.dealPick ||
		UI.fortifyMode || UI.settleMode)) return true;
	return false;
}

function animPulse(period) { // 0..1 smooth pulse
	var s = performance.now() / 1000;
	return 0.5 + 0.5 * Math.sin(s * 2 * Math.PI / (period || 1.6));
}

// ---------------------------------------------------------------------------
// Static geometry helpers
// ---------------------------------------------------------------------------

function edgeScreenSegment(e) {
	var cA = M.raw.geometry.edgeCorners[e * 2], cB = M.raw.geometry.edgeCorners[e * 2 + 1];
	var latA = M.cornerLL[cA * 2], lonA = M.cornerLL[cA * 2 + 1];
	var latB = M.cornerLL[cB * 2], lonB = M.cornerLL[cB * 2 + 1];
	var dA = wrapLon(lonA - R.view.lonC);
	var dB = dA + wrapLon(lonB - lonA); // keep the segment contiguous
	return [projX(dA), projY(latA), projX(dB), projY(latB)];
}

function tileSegment(a, b) {
	var latA = M.latLon[a * 2], lonA = M.latLon[a * 2 + 1];
	var latB = M.latLon[b * 2], lonB = M.latLon[b * 2 + 1];
	var dA = wrapLon(lonA - R.view.lonC);
	var dB = dA + wrapLon(lonB - lonA);
	return [projX(dA), projY(latA), projX(dB), projY(latB)];
}

function segVisible(s) {
	var W = R.canvas.width, H = R.canvas.height, m = 60;
	return !(Math.max(s[0], s[2]) < -m || Math.min(s[0], s[2]) > W + m ||
		Math.max(s[1], s[3]) < -m || Math.min(s[1], s[3]) > H + m);
}

// Territory borders: each owned tile strokes its own boundary edges using its
// own polygon (see tileEdgeSegment), pulled slightly toward the tile center so
// two facing owners both stay visible.
function drawTerritoryBorders(ctx) {
	ctx.lineCap = "round";
	ctx.lineWidth = Math.max(1.8, R.view.scale * 0.24);
	var byOwner = {}; // batch strokes per player color
	for (var t = 0; t < M.n; t++) {
		var ow = G.owner[t];
		if (ow < 0) continue;
		var nb = M.neighbors[t];
		for (var k = 0; k < nb.length; k++) {
			if (G.owner[nb[k]] === ow) continue;
			var s = tileEdgeSegment(t, k);
			if (!s || !segVisible(s)) continue;
			(byOwner[ow] = byOwner[ow] || []).push([s, t]);
		}
	}
	Object.keys(byOwner).forEach(function (ow2) {
		ctx.strokeStyle = G.players[+ow2].color;
		ctx.beginPath();
		byOwner[ow2].forEach(function (pair) {
			var s = pair[0], c = tileScreen(pair[1]);
			var inset = 0.14;
			ctx.moveTo(s[0] + (c[0] - s[0]) * inset, s[1] + (c[1] - s[1]) * inset);
			ctx.lineTo(s[2] + (c[0] - s[2]) * inset, s[3] + (c[1] - s[3]) * inset);
		});
		ctx.stroke();
	});
}

// Contested tiles (hostile occupation in progress) get fat diagonal hatching
// in the occupier's color; stripes densify as the flip approaches.
function drawContestedTiles(ctx) {
	var keys = Object.keys(G.occupation);
	if (!keys.length) return;
	var need = GameConfig.territory.occupationTurnsToFlip;
	keys.forEach(function (key) {
		var t = +key, oc = G.occupation[key];
		var lat = M.latLon[t * 2], lonC = M.latLon[t * 2 + 1];
		var d = wrapLon(lonC - R.view.lonC);
		var poly = M.polys[t];
		// polygon path + screen bounds
		var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
		ctx.save();
		ctx.beginPath();
		for (var k = 0; k < poly.length; k++) {
			var x = projX(d + (poly[k][0] - lonC)), y = projY(poly[k][1]);
			if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
			if (x < minX) minX = x; if (x > maxX) maxX = x;
			if (y < minY) minY = y; if (y > maxY) maxY = y;
		}
		ctx.closePath();
		if (maxX < 0 || minX > R.canvas.width || maxY < 0 || minY > R.canvas.height) { ctx.restore(); return; }
		ctx.clip();
		var prog = Math.min(1, oc.turns / need);
		ctx.strokeStyle = G.players[oc.by].color;
		ctx.globalAlpha = 0.55 + 0.4 * prog;
		ctx.lineWidth = Math.max(2.5, R.view.scale * 0.32);
		var gap = Math.max(6, R.view.scale * (1.6 - 0.8 * prog));
		ctx.beginPath();
		for (var s = minX - (maxY - minY); s < maxX; s += gap) {
			ctx.moveTo(s, maxY);
			ctx.lineTo(s + (maxY - minY), minY);
		}
		ctx.stroke();
		ctx.restore();
	});
}

function drawRivers(ctx) {
	var riverAlong = M.edgeLayer("riverAlong");
	ctx.strokeStyle = "#4ab3ff";
	ctx.lineCap = "round";
	for (var e = 0; e < M.nEdges; e++) {
		if (!riverAlong[e]) continue;
		var s = tileSegment(M.edgeA[e], M.edgeB[e]);
		if (!segVisible(s)) continue;
		ctx.lineWidth = Math.max(1, R.view.scale * 0.16);
		ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.lineTo(s[2], s[3]); ctx.stroke();
	}
}

function drawRoads(ctx) {
	ctx.lineCap = "round";
	for (var e = 0; e < M.nEdges; e++) {
		if (!G.roads[e]) continue;
		var s = tileSegment(M.edgeA[e], M.edgeB[e]);
		if (!segVisible(s)) continue;
		ctx.strokeStyle = "#3b2d1d";
		ctx.lineWidth = Math.max(1.2, R.view.scale * 0.14);
		ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.lineTo(s[2], s[3]); ctx.stroke();
		if (G.roads[e] === 2) { // bridge marker
			var mx = (s[0] + s[2]) / 2, my = (s[1] + s[3]) / 2;
			ctx.fillStyle = "#e8d9a0";
			ctx.fillRect(mx - 2.5, my - 2.5, 5, 5);
		}
	}
}

function drawRoutes(ctx) {
	G.routes.forEach(function (r) {
		if (!r.active && R.selectedRoute !== r) return;
		var pl = G.players[r.owner];
		ctx.strokeStyle = pl.color;
		ctx.globalAlpha = R.selectedRoute === r ? 0.95 : 0.4;
		ctx.lineWidth = R.selectedRoute === r ? 2.5 : 1.5;
		ctx.setLineDash([5, 4]);
		ctx.beginPath();
		var started = false;
		for (var i = 1; i < r.path.length; i++) {
			var s = tileSegment(r.path[i - 1], r.path[i]);
			if (!segVisible(s)) { started = false; continue; }
			if (!started) { ctx.moveTo(s[0], s[1]); started = true; }
			ctx.lineTo(s[2], s[3]);
		}
		ctx.stroke();
		ctx.setLineDash([]);
		ctx.globalAlpha = 1;
	});
}

// Merchant agents: a small diamond in the owner's color with a kind glyph,
// plus the remaining leg of the active trip as a faint dotted line.
function drawMerchants(ctx) {
	if (!GameConfig.features.merchants || !G.merchants) return;
	G.merchants.forEach(function (m) {
		var p = tileScreen(m.tile);
		if (p[0] < -40 || p[0] > R.canvas.width + 40 || p[1] < -40 || p[1] > R.canvas.height + 40) return;
		var pl = G.players[m.owner];
		// remaining path of the current leg
		if (m.plan && m.state !== "idle") {
			var path = m.plan.path;
			ctx.strokeStyle = hexToRgba(pl.color, 0.35);
			ctx.lineWidth = 1.2;
			ctx.setLineDash([2, 4]);
			ctx.beginPath();
			var started = false;
			var from = m.state === "outbound" ? m.pathIdx : 0;
			var to = m.state === "outbound" ? path.length - 1 : m.pathIdx;
			for (var i = from + 1; i <= to; i++) {
				var s = tileSegment(path[i - 1], path[i]);
				if (!segVisible(s)) { started = false; continue; }
				if (!started) { ctx.moveTo(s[0], s[1]); started = true; }
				ctx.lineTo(s[2], s[3]);
			}
			ctx.stroke();
			ctx.setLineDash([]);
		}
		// diamond marker
		ctx.save();
		ctx.translate(p[0], p[1]);
		ctx.rotate(Math.PI / 4);
		ctx.fillStyle = pl.color;
		ctx.fillRect(-4.5, -4.5, 9, 9);
		ctx.strokeStyle = "rgba(10,17,28,0.9)";
		ctx.lineWidth = 1.5;
		ctx.strokeRect(-4.5, -4.5, 9, 9);
		ctx.restore();
		ctx.font = "7px sans-serif";
		ctx.textAlign = "center";
		ctx.fillStyle = "#fff";
		ctx.fillText(m.kind === "fleet" ? "⛵" : "🐫", p[0], p[1] + 2.5);
	});
}

// Toll gates (merchant.tollMode 0): ⛩ on each gated tile.
function drawTollGates(ctx) {
	if (!GameConfig.features.merchants || !G.tollGates || GameConfig.merchant.tollMode !== 0) return;
	ctx.font = "12px sans-serif";
	ctx.textAlign = "center";
	for (var t = 0; t < M.n; t++) {
		if (!G.tollGates[t]) continue;
		var p = tileScreen(t);
		if (p[0] < -20 || p[0] > R.canvas.width + 20 || p[1] < -20 || p[1] > R.canvas.height + 20) continue;
		ctx.strokeStyle = "rgba(0,0,0,0.85)";
		ctx.lineWidth = 2.5;
		ctx.strokeText("⛩", p[0], p[1] + 4);
		ctx.fillStyle = G.owner[t] >= 0 ? G.players[G.owner[t]].color : "#ddd";
		ctx.fillText("⛩", p[0], p[1] + 4);
	}
}

// ---------------------------------------------------------------------------
// Cities, units, camps (bold, high-contrast markers)
// ---------------------------------------------------------------------------

function drawCities(ctx) {
	G.cities.forEach(function (c) {
		var p = tileScreen(c.tile);
		if (p[0] < -40 || p[0] > R.canvas.width + 40 || p[1] < -40 || p[1] > R.canvas.height + 40) return;
		var pl = G.players[c.owner];
		var rad = 4.5 + Math.min(8, c.pop * 0.7);
		var capital = pl.capital === c.id && !pl.minor;

		// soft drop shadow for lift
		ctx.beginPath();
		ctx.arc(p[0], p[1] + 1.5, rad + 1.5, 0, Math.PI * 2);
		ctx.fillStyle = "rgba(0,0,0,0.35)";
		ctx.fill();

		ctx.beginPath();
		ctx.arc(p[0], p[1], rad, 0, Math.PI * 2);
		ctx.fillStyle = pl.color;
		ctx.fill();
		ctx.lineWidth = 2.5;
		ctx.strokeStyle = c.buildings.walls ? "#f4f6f8" : "rgba(10,17,28,0.9)";
		ctx.stroke();
		if (capital) { // star ring for capitals
			ctx.beginPath();
			ctx.arc(p[0], p[1], rad + 3, 0, Math.PI * 2);
			ctx.lineWidth = 1.4;
			ctx.strokeStyle = "rgba(255,224,130,0.9)";
			ctx.stroke();
		}
		if (pl.minor) { // hollow center marks an independent city-state
			ctx.beginPath();
			ctx.arc(p[0], p[1], Math.max(2, rad * 0.4), 0, Math.PI * 2);
			ctx.fillStyle = "rgba(10,17,28,0.7)";
			ctx.fill();
		}
		if (R.layers.healthBars && c.hp < GameConfig.city.cityMaxHP) {
			ctx.fillStyle = "rgba(0,0,0,0.7)"; ctx.fillRect(p[0] - rad, p[1] - rad - 7, rad * 2, 3.5);
			ctx.fillStyle = "#ff5544"; ctx.fillRect(p[0] - rad, p[1] - rad - 7, rad * 2 * c.hp / GameConfig.city.cityMaxHP, 3.5);
		}
		if (R.layers.cityNames && R.view.scale > 4) {
			var label = c.name + " · " + c.pop;
			ctx.font = "600 11px system-ui, sans-serif";
			ctx.textAlign = "center";
			var w = ctx.measureText(label).width;
			var ly = p[1] + rad + 6;
			ctx.fillStyle = "rgba(10,17,28,0.72)";
			roundRect(ctx, p[0] - w / 2 - 5, ly, w + 10, 15, 4);
			ctx.fill();
			ctx.fillStyle = pl.minor ? "#c9d4de" : "#f4f6f8";
			ctx.fillText(label, p[0], ly + 11);
		}
	});
}

function roundRect(ctx, x, y, w, h, r) {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

function drawUnits(ctx) {
	var byTile = {};
	G.units.forEach(function (u) { (byTile[u.tile] = byTile[u.tile] || []).push(u); });
	Object.keys(byTile).forEach(function (tile) {
		var us = byTile[tile];
		var p = tileScreen(+tile);
		if (p[0] < -40 || p[0] > R.canvas.width + 40 || p[1] < -40 || p[1] > R.canvas.height + 40) return;
		us.forEach(function (u, i) {
			var x = p[0] + (i - (us.length - 1) / 2) * 10, y = p[1] - 10;
			var sel = R.selectedUnit === u;
			ctx.beginPath();
			ctx.arc(x, y + 1, 6.5, 0, Math.PI * 2);
			ctx.fillStyle = "rgba(0,0,0,0.35)";
			ctx.fill();
			ctx.beginPath();
			ctx.arc(x, y, 6, 0, Math.PI * 2);
			ctx.fillStyle = G.players[u.owner].color;
			ctx.fill();
			ctx.strokeStyle = sel ? "#ffffff" : "rgba(10,17,28,0.9)";
			ctx.lineWidth = sel ? 2.5 : 1.5;
			ctx.stroke();
			ctx.font = "8px sans-serif";
			ctx.textAlign = "center";
			ctx.fillStyle = "#fff";
			ctx.fillText(UNIT_TYPES[u.type].icon, x, y + 3);
			// floating status bar: HP (always) + supply pips for each need
			if (R.layers.healthBars) {
				var hpFrac = u.hp / 100;
				ctx.fillStyle = "rgba(0,0,0,0.75)"; ctx.fillRect(x - 6.5, y - 11.5, 13, 3);
				ctx.fillStyle = hpFrac > 0.6 ? "#4cd07d" : hpFrac > 0.3 ? "#ffc14e" : "#ff5a50";
				ctx.fillRect(x - 6, y - 11, 12 * hpFrac, 2);
			}
			if (R.layers.supplyWarnings && u.supply) {
				var needs = unitNeeds(u);
				var pips = [];
				if (needs.food) pips.push(u.supply.food);
				if (needs.ammo) pips.push(u.supply.ammo);
				if (needs.fuel) pips.push(u.supply.fuel);
				for (var pi = 0; pi < pips.length; pi++) {
					ctx.fillStyle = pips[pi] ? "#4cd07d" : "#ff5a50";
					ctx.fillRect(x - 6 + pi * 4.5, y - 15.5, 3, 3);
				}
			}
		});
	});
}

// Standing orders (features.persistentOrders): a subtle dashed line from each
// of the viewing player's units to its destination, with a flag marker.
function drawUnitOrders(ctx) {
	if (!GameConfig.features.persistentOrders) return;
	var h = typeof UI !== "undefined" ? UI.humanId() : -1;
	G.units.forEach(function (u) {
		if (!u.orders || (u.owner !== h && u.type !== "settler")) return;
		var sel = R.selectedUnit === u;
		var seg = tileSegment(u.tile, u.orders.target);
		if (!segVisible(seg)) return;
		ctx.strokeStyle = hexToRgba(G.players[u.owner].color, sel ? 0.9 : 0.45);
		ctx.lineWidth = sel ? 2.2 : 1.4;
		ctx.setLineDash([4, 5]);
		ctx.beginPath(); ctx.moveTo(seg[0], seg[1]); ctx.lineTo(seg[2], seg[3]); ctx.stroke();
		ctx.setLineDash([]);
		var p = tileScreen(u.orders.target);
		ctx.font = "12px sans-serif";
		ctx.textAlign = "center";
		ctx.strokeStyle = "rgba(0,0,0,0.8)";
		ctx.lineWidth = 2.5;
		ctx.strokeText("⚑", p[0], p[1]);
		ctx.fillStyle = G.players[u.owner].color;
		ctx.fillText("⚑", p[0], p[1]);
	});
}

function drawCamps(ctx) {
	G.camps.forEach(function (c) {
		var p = tileScreen(c.tile);
		if (p[0] < -40 || p[0] > R.canvas.width + 40 || p[1] < -40 || p[1] > R.canvas.height + 40) return;
		ctx.beginPath();
		ctx.arc(p[0], p[1], 8, 0, Math.PI * 2);
		ctx.fillStyle = c.kind === "pirates" ? "rgba(30,70,100,0.75)" : "rgba(90,45,25,0.75)";
		ctx.fill();
		ctx.lineWidth = 1.5;
		ctx.strokeStyle = "rgba(10,17,28,0.9)";
		ctx.stroke();
		ctx.font = "11px sans-serif";
		ctx.textAlign = "center";
		ctx.fillStyle = c.kind === "pirates" ? "#9fdcff" : "#ffc296";
		ctx.fillText("☠", p[0], p[1] + 4);
		ctx.font = "600 9px system-ui, sans-serif";
		ctx.fillStyle = "#eee";
		ctx.fillText(Math.round(c.strength), p[0], p[1] + 16);
	});
}

// ---------------------------------------------------------------------------
// Movement range + hover path preview for the selected unit
// ---------------------------------------------------------------------------

// Bounded Dijkstra flood from the unit's tile: which tiles can it reach with
// its remaining moves this turn, and which enemy tiles could it attack?
function computeReachable(u) {
	var def = UNIT_TYPES[u.type];
	if (def.domain === "air") return null;
	var key = u.id + "|" + u.tile + "|" + u.moves + "|" + (G ? G.turn : 0);
	if (R._reach && R._reach.key === key) return R._reach;

	var budget = u.moves;
	var fullMoves = unitMoveBudget(u);
	var cost = {}, attack = {};
	cost[u.tile] = 0;
	var frontier = [[0, u.tile]];
	while (frontier.length) {
		// smallest-cost first (frontier stays tiny at these budgets)
		var bi = 0;
		for (var i = 1; i < frontier.length; i++) if (frontier[i][0] < frontier[bi][0]) bi = i;
		var cur = frontier.splice(bi, 1)[0];
		if (cur[0] > cost[cur[1]]) continue;
		var nb = M.neighbors[cur[1]];
		for (var k = 0; k < nb.length; k++) {
			var t = nb[k];
			var c = stepCost(cur[1], t, def.domain);
			if (!isFinite(c)) continue;
			var nc = cur[0] + c;
			// the one-full-budget-step rule: from the start tile, one step is
			// always allowed when the unit has its full budget
			if (nc > budget && !(cur[1] === u.tile && u.moves >= fullMoves)) continue;
			// hostile occupants stop movement — but mark them attackable
			var us = unitsAt(t);
			var cid = G.cityAt[t];
			var hostileUnit = us.length && us[0].owner !== u.owner;
			var hostileCity = cid >= 0 && G.cities[cid].owner !== u.owner;
			if (hostileUnit || hostileCity || G.campAt[t] >= 0) {
				var isWarTarget = G.campAt[t] >= 0 ||
					(hostileUnit && atWar(u.owner, us[0].owner)) ||
					(hostileCity && atWar(u.owner, G.cities[cid].owner));
				if (isWarTarget) attack[t] = true;
				continue;
			}
			if (cost[t] !== undefined && cost[t] <= nc) continue;
			cost[t] = nc;
			frontier.push([nc, t]);
		}
	}
	delete cost[u.tile];
	R._reach = { key: key, cost: cost, attack: attack };
	return R._reach;
}

// Hover path preview: full path to the hovered tile + how many turns it takes.
function computePathPreview(u, target) {
	var def = UNIT_TYPES[u.type];
	if (def.domain === "air") return null;
	var key = u.id + "|" + u.tile + "|" + target + "|" + (G ? G.turn : 0);
	if (R._pathPrev && R._pathPrev.key === key) return R._pathPrev.data;

	var goal = target;
	if (def.domain === "sea" && !M.isWater(target)) {
		// ships bombard from an adjacent water tile
		var w = -1, wd = Infinity;
		M.neighbors[target].forEach(function (n2) {
			if (!M.isWater(n2)) return;
			var d2 = M.distTiles(u.tile, n2);
			if (d2 < wd) { wd = d2; w = n2; }
		});
		if (w < 0) { R._pathPrev = { key: key, data: null }; return null; }
		goal = w;
	}
	var pf = unitPathfind(u.tile, goal, u.owner, def.domain);
	var data = null;
	if (pf && pf.path.length > 1) {
		// walk the path with per-turn budgets to estimate arrival turns; a unit
		// with a full budget may always take one step (same rule as the engine)
		var budget = unitMoveBudget(u);
		var left = u.moves, turns = 1, reachIdx = 0, stepsThisTurn = 0;
		for (var i = 1; i < pf.path.length; i++) {
			var c = stepCost(pf.path[i - 1], pf.path[i], def.domain);
			if (c > left && !(stepsThisTurn === 0 && left >= budget)) {
				if (turns === 1) reachIdx = i - 1;
				turns++;
				left = budget;
				stepsThisTurn = 0;
			}
			left -= Math.min(c, left);
			stepsThisTurn++;
		}
		if (turns === 1) reachIdx = pf.path.length - 1;
		data = { path: pf.path, cost: pf.cost, turns: turns, reachIdx: reachIdx };
	}
	R._pathPrev = { key: key, data: data };
	return data;
}

function drawTileHalo(ctx, t, color, alpha, width) {
	var lat = M.latLon[t * 2], lonC = M.latLon[t * 2 + 1];
	var d = wrapLon(lonC - R.view.lonC);
	var poly = M.polys[t];
	ctx.save();
	ctx.beginPath();
	for (var k = 0; k < poly.length; k++) {
		var x = projX(d + (poly[k][0] - lonC)), y = projY(poly[k][1]);
		if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
	}
	ctx.closePath();
	ctx.globalAlpha = alpha;
	if (width) {
		ctx.strokeStyle = color;
		ctx.lineWidth = width;
		ctx.lineJoin = "round";
		ctx.stroke();
	} else {
		ctx.fillStyle = color;
		ctx.fill();
	}
	ctx.restore();
}

function drawSelectionGlow(ctx, p, color, radius) {
	var pulse = animPulse(1.8);
	var r = radius + 4 + pulse * 3;
	var grad = ctx.createRadialGradient(p[0], p[1], radius * 0.4, p[0], p[1], r * 1.8);
	grad.addColorStop(0, hexToRgba(color, 0.0));
	grad.addColorStop(0.55, hexToRgba(color, 0.22 + pulse * 0.1));
	grad.addColorStop(1, hexToRgba(color, 0));
	ctx.fillStyle = grad;
	ctx.beginPath();
	ctx.arc(p[0], p[1], r * 1.8, 0, Math.PI * 2);
	ctx.fill();
	// rotating dashed ring
	ctx.save();
	ctx.strokeStyle = hexToRgba(color, 0.85);
	ctx.lineWidth = 2;
	ctx.setLineDash([6, 6]);
	ctx.lineDashOffset = -(performance.now() / 40) % 12;
	ctx.beginPath();
	ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
	ctx.stroke();
	ctx.restore();
}

// ---------------------------------------------------------------------------
// Start-position picking overlay
// ---------------------------------------------------------------------------

function drawStartPick(ctx) {
	if (!G || !G.pendingStarts || !G.pendingStarts.length) return;
	var pulse = animPulse(1.6);

	// recommended sites (computed by the UI when pick mode starts)
	(G._recommendedStarts || []).forEach(function (t) {
		var p = tileScreen(t);
		if (p[0] < -60 || p[0] > R.canvas.width + 60 || p[1] < -60 || p[1] > R.canvas.height + 60) return;
		drawTileHalo(ctx, t, "#ffd54f", 0.14 + pulse * 0.12);
		ctx.save();
		ctx.strokeStyle = "rgba(255,213,79," + (0.55 + pulse * 0.35) + ")";
		ctx.lineWidth = 2;
		ctx.setLineDash([5, 5]);
		ctx.lineDashOffset = -(performance.now() / 50) % 10;
		ctx.beginPath();
		ctx.arc(p[0], p[1], 12 + pulse * 3, 0, Math.PI * 2);
		ctx.stroke();
		ctx.restore();
	});

	// hovered tile: green when valid, red when not
	if (R.hoverTile >= 0) {
		var bad = startPickProblem(R.hoverTile);
		drawTileHalo(ctx, R.hoverTile, bad ? "#ff5a50" : "#7dff8a", 0.28);
		drawTileHalo(ctx, R.hoverTile, bad ? "#ff5a50" : "#7dff8a", 0.9, 2.5);
	}
}

// ---------------------------------------------------------------------------
// Selection, halos, previews
// ---------------------------------------------------------------------------

function drawSelection(ctx) {
	var h = typeof UI !== "undefined" ? UI.humanId() : -1;

	// deal-builder tile highlights (Diplomacy tab)
	if (typeof UI !== "undefined" && UI.tab === "diplo" && UI.deal) {
		UI.deal.give.tiles.forEach(function (t) { outlineTile(ctx, t, "#ff7d6b", 3); });
		UI.deal.get.tiles.forEach(function (t) { outlineTile(ctx, t, "#7dff8a", 3); });
		(UI.deal.give.cities || []).forEach(function (cid) { if (G.cities[cid]) outlineTile(ctx, G.cities[cid].tile, "#ff3b2b", 4); });
		(UI.deal.get.cities || []).forEach(function (cid) { if (G.cities[cid]) outlineTile(ctx, G.cities[cid].tile, "#3bff5a", 4); });
	}

	if (G.pendingStarts && G.pendingStarts.length) return; // pick overlay handles the rest

	var u = R.selectedUnit;
	var uMine = u && u.owner === h;

	// movement range + attack halos for an own selected ground/sea unit
	if (uMine && R.layers.ranges && UNIT_TYPES[u.type].domain !== "air") {
		var reach = computeReachable(u);
		if (reach) {
			var pulse = animPulse(2.2);
			Object.keys(reach.cost).forEach(function (t) {
				drawTileHalo(ctx, +t, "#ffffff", 0.07 + pulse * 0.03);
			});
			Object.keys(reach.attack).forEach(function (t) {
				drawTileHalo(ctx, +t, "#ff5a50", 0.16 + pulse * 0.1);
				drawTileHalo(ctx, +t, "#ff5a50", 0.5 + pulse * 0.4, 2);
			});
		}
	}

	// settle-mission targeting: hovered tile shows validity
	if (typeof UI !== "undefined" && UI.settleMode && R.hoverTile >= 0) {
		var okSettle = M.isPassable(R.hoverTile) && G.cityAt[R.hoverTile] < 0 &&
			nearestCityDistance(R.hoverTile) >= 4;
		drawTileHalo(ctx, R.hoverTile, okSettle ? "#7dff8a" : "#ff5a50", 0.3);
		drawTileHalo(ctx, R.hoverTile, okSettle ? "#7dff8a" : "#ff5a50", 0.9, 2.5);
	}

	// hover: tile outline; with an own unit selected, an animated path preview
	if (R.hoverTile >= 0) {
		outlineTile(ctx, R.hoverTile, "rgba(255,255,255,0.55)", 1.5);
		if (uMine && UNIT_TYPES[u.type].domain !== "air" && R.hoverTile !== u.tile &&
			(typeof UI === "undefined" || !UI.dropMode) && (typeof UI === "undefined" || !UI.fortifyMode)) {
			drawPathPreview(ctx, u, R.hoverTile);
		}
	}

	if (R.selectedTile >= 0) outlineTile(ctx, R.selectedTile, "#ffffff", 2);
	if (R.selectedCity) {
		var cp = tileScreen(R.selectedCity.tile);
		drawSelectionGlow(ctx, cp, G.players[R.selectedCity.owner].color, 8 + Math.min(8, R.selectedCity.pop * 0.7));
	}

	if (u) {
		var p0 = tileScreen(u.tile);
		drawSelectionGlow(ctx, p0, uMine ? "#ffe97f" : "#c9d4de", 8);

		// supply line to the nearest friendly city (green ok, red cut)
		if (R.layers.supplyWarnings && UNIT_TYPES[u.type].domain !== "air" && (UNIT_TYPES[u.type].needs || {}).food) {
			var src = null, sd = Infinity;
			G.cities.forEach(function (c) {
				if (c.owner !== u.owner) return;
				var d = M.distTiles(u.tile, c.tile);
				if (d < sd) { sd = d; src = c; }
			});
			if (src && src.tile !== u.tile) {
				var seg = tileSegment(u.tile, src.tile);
				ctx.strokeStyle = u.supplyDist >= 0 ? "rgba(125,255,138,0.75)" : "rgba(255,90,80,0.85)";
				ctx.lineWidth = 1.5;
				ctx.setLineDash([3, 5]);
				ctx.beginPath(); ctx.moveTo(seg[0], seg[1]); ctx.lineTo(seg[2], seg[3]); ctx.stroke();
				ctx.setLineDash([]);
			}
		}

		// air units: strike-range ring + valid-target halos
		if (UNIT_TYPES[u.type].domain === "air") {
			var pulse2 = animPulse(2);
			var range = (u.strikeRange || GameConfig.air.strikeRange) * carrierAirBonus(u);
			ctx.strokeStyle = "rgba(255,233,127," + (0.5 + pulse2 * 0.3) + ")";
			ctx.lineWidth = 1.8;
			ctx.setLineDash([7, 6]);
			ctx.lineDashOffset = -(performance.now() / 60) % 13;
			ctx.beginPath();
			ctx.arc(p0[0], p0[1], range * M.hopDeg * R.view.scale, 0, Math.PI * 2);
			ctx.stroke();
			ctx.setLineDash([]);
			if (uMine && u.moves > 0) drawAirTargets(ctx, u, range, pulse2);
		}

		// fortify mode: highlight the edge between the unit and the hovered
		// neighbor tile (green = buildable, red = not)
		if (uMine && typeof UI !== "undefined" && UI.fortifyMode && R.hoverTile >= 0 && R.hoverTile !== u.tile) {
			var k2 = M.neighbors[u.tile].indexOf(R.hoverTile);
			if (k2 >= 0) {
				var seg2 = tileEdgeSegment(u.tile, k2);
				if (seg2) {
					var e2 = M.edgeBetween(u.tile, R.hoverTile);
					var okFort = e2 >= 0 && (M.isLand(M.edgeA[e2]) || M.isLand(M.edgeB[e2])) &&
						G.fortLevel[e2] < UI.fortifyMode.level;
					ctx.strokeStyle = okFort ? "rgba(125,255,138,0.95)" : "rgba(255,90,80,0.95)";
					ctx.lineWidth = Math.max(3.5, R.view.scale * 0.4);
					ctx.lineCap = "round";
					ctx.beginPath(); ctx.moveTo(seg2[0], seg2[1]); ctx.lineTo(seg2[2], seg2[3]); ctx.stroke();
				}
			}
		}

		// airborne paradrop mode: drop-range ring + hover validity
		if (uMine && typeof UI !== "undefined" && UI.dropMode && u.training === "airborne") {
			var pr = GameConfig.amphibious.paradropRange;
			ctx.strokeStyle = "rgba(125,220,255,0.7)";
			ctx.lineWidth = 1.8;
			ctx.setLineDash([7, 6]);
			ctx.beginPath();
			ctx.arc(p0[0], p0[1], pr * M.hopDeg * R.view.scale, 0, Math.PI * 2);
			ctx.stroke();
			ctx.setLineDash([]);
			if (R.hoverTile >= 0 && R.hoverTile !== u.tile) {
				var okDrop = M.distTiles(u.tile, R.hoverTile) <= pr && M.isPassable(R.hoverTile) &&
					!(G.cityAt[R.hoverTile] >= 0 && G.cities[G.cityAt[R.hoverTile]].owner !== u.owner) &&
					!unitsAt(R.hoverTile).some(function (x) { return x.owner !== u.owner; });
				drawTileHalo(ctx, R.hoverTile, okDrop ? "#7dff8a" : "#ff5a50", 0.3);
			}
		}
	}
}

// Red pulsing halos on everything an air unit could strike right now.
function drawAirTargets(ctx, u, range, pulse) {
	var seen = {};
	function mark(t) {
		if (seen[t]) return;
		seen[t] = true;
		if (M.distTiles(u.tile, t) > range) return;
		drawTileHalo(ctx, t, "#ff5a50", 0.14 + pulse * 0.1);
		drawTileHalo(ctx, t, "#ff5a50", 0.45 + pulse * 0.35, 2);
	}
	G.units.forEach(function (x) { if (x.owner !== u.owner && atWar(u.owner, x.owner)) mark(x.tile); });
	G.cities.forEach(function (c) { if (atWar(u.owner, c.owner)) mark(c.tile); });
	G.camps.forEach(function (c) { mark(c.tile); });
}

// Animated dashed path with a turn-count badge at the destination.
function drawPathPreview(ctx, u, target) {
	var data = computePathPreview(u, target);
	if (!data) return;
	var pl = G.players[u.owner];

	function strokePath(from, to, color, width) {
		ctx.strokeStyle = color;
		ctx.lineWidth = width;
		ctx.beginPath();
		var started = false;
		for (var i = from + 1; i <= to; i++) {
			var s = tileSegment(data.path[i - 1], data.path[i]);
			if (!segVisible(s)) { started = false; continue; }
			if (!started) { ctx.moveTo(s[0], s[1]); started = true; }
			ctx.lineTo(s[2], s[3]);
		}
		ctx.stroke();
	}

	ctx.save();
	ctx.lineCap = "round";
	ctx.setLineDash([8, 7]);
	ctx.lineDashOffset = -(performance.now() / 30) % 15;
	// this-turn portion bright, remainder dimmer
	strokePath(0, data.reachIdx, "rgba(255,255,255,0.95)", 3);
	if (data.reachIdx < data.path.length - 1) {
		strokePath(data.reachIdx, data.path.length - 1, "rgba(255,255,255,0.4)", 2.2);
	}
	ctx.setLineDash([]);
	ctx.restore();

	// destination marker + turn badge
	var end = tileScreen(data.path[data.path.length - 1]);
	ctx.beginPath();
	ctx.arc(end[0], end[1], 5, 0, Math.PI * 2);
	ctx.fillStyle = hexToRgba(pl.color, 0.9);
	ctx.fill();
	ctx.lineWidth = 2;
	ctx.strokeStyle = "#fff";
	ctx.stroke();
	var label = data.turns === 1 ? "this turn" : data.turns + " turns";
	ctx.font = "600 11px system-ui, sans-serif";
	ctx.textAlign = "center";
	var w = ctx.measureText(label).width;
	ctx.fillStyle = "rgba(10,17,28,0.85)";
	roundRect(ctx, end[0] - w / 2 - 6, end[1] - 26, w + 12, 16, 8);
	ctx.fill();
	ctx.fillStyle = "#f4f6f8";
	ctx.fillText(label, end[0], end[1] - 14);
}

function outlineTile(ctx, t, color, width) {
	var lat = M.latLon[t * 2], lonC = M.latLon[t * 2 + 1];
	var d = wrapLon(lonC - R.view.lonC);
	var poly = M.polys[t];
	ctx.beginPath();
	for (var k = 0; k < poly.length; k++) {
		var x = projX(d + (poly[k][0] - lonC)), y = projY(poly[k][1]);
		if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
	}
	ctx.closePath();
	ctx.strokeStyle = color;
	ctx.lineWidth = width;
	ctx.lineJoin = "round";
	ctx.stroke();
}

function renderLoop() {
	if (R.dirty || renderNeedsAnimation()) draw();
	requestAnimationFrame(renderLoop);
}
