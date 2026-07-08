// render.js — 2D equirectangular canvas renderer with pan/zoom, data overlays,
// territory, rivers, roads/bridges, trade routes, cities, units, camps.

var R = {
	canvas: null, ctx: null,
	view: { lonC: 0, latC: 10, scale: 6 },  // scale = px per degree
	overlay: "terrain",
	priceCommodity: "wheat",
	showRoutes: true, showTraffic: false, showGrid: false,
	hoverTile: -1, selectedTile: -1, selectedUnit: null, selectedCity: null,
	routeCreateFrom: null, // city id when in "new route" mode
	dirty: true,
	_fills: null, _fillsKey: ""
};

var TERRAIN_COLORS = {
	ocean: "#16324f", coast: "#1f4a73", lake: "#2e6a94", seaIce: "#b8ccd8",
	glacier: "#e8eef2", desert: "#d4bd7a", plains: "#c2b25c", grassland: "#7ba84e",
	forest: "#3e6f38", tundra: "#98a189", hills: "#8a7b56", mountain: "#6c6156"
};

function initRenderer(canvas) {
	R.canvas = canvas;
	R.ctx = canvas.getContext("2d");
	resizeCanvas();
	window.addEventListener("resize", resizeCanvas);
}

function resizeCanvas() {
	var parent = R.canvas.parentElement;
	R.canvas.width = parent.clientWidth;
	R.canvas.height = parent.clientHeight;
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
// Tile fill colors per overlay mode
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

function terrainFill(t) { return TERRAIN_COLORS[M.terrainName(t)] || "#555"; }

function overlayFill(t) {
	var mode = R.overlay;
	if (mode === "terrain") return terrainFill(t);

	if (mode === "political") {
		var ow = G ? G.owner[t] : -1;
		if (ow < 0) return terrainFill(t);
		return lerpColor(terrainFill(t).startsWith("#") ? terrainFill(t) : "#666666", G.players[ow].color, 0.45);
	}
	if (mode === "food") {
		var f = 0;
		COMMODITIES.forEach(function (cm) {
			if (cm.demandGroup === "food") f = Math.max(f, M.layer(cm.layer)[t]);
		});
		return M.isWater(t) && f < 0.05 ? terrainFill(t) : heatColor(f);
	}
	if (mode === "minerals") {
		var v = M.layer("iron")[t] + M.layer("copper")[t] + M.layer("gold")[t] + M.layer("silver")[t];
		return v > 0.05 ? heatColor(Math.min(1, v)) : terrainFill(t);
	}
	if (mode === "cityPriority" || mode === "transit" || mode === "shoreDelta") {
		var s = M.layer(mode)[t];
		if (mode === "transit") s = Math.max(s, M.layer("transitCross")[t]);
		return s > 0.03 ? heatColor(s) : terrainFill(t);
	}
	if (mode === "prices") {
		if (!G) return terrainFill(t);
		var cid = G.ownerCity[t];
		if (cid < 0) return terrainFill(t);
		var city = G.cities[cid];
		var pr = city.prices[R.priceCommodity];
		if (pr === undefined) return terrainFill(t);
		var cm = commodityById(R.priceCommodity);
		var rel = (pr / cm.basePrice - GameConfig.trade.priceMin) / (GameConfig.trade.priceMax - GameConfig.trade.priceMin);
		return heatColor(rel);
	}
	if (mode === "traffic") {
		if (!G) return terrainFill(t);
		var tr = G.traffic[t];
		return tr > 0.5 ? heatColor(Math.min(1, tr / 30)) : terrainFill(t);
	}
	if (mode === "province") {
		var pv = M.layer("province")[t];
		if (!pv) return terrainFill(t);
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
// Main draw
// ---------------------------------------------------------------------------

function draw() {
	if (!M) return;
	var ctx = R.ctx, W = R.canvas.width, H = R.canvas.height;
	computeFills();
	ctx.fillStyle = "#0b1520";
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
		if (sc > 10) { ctx.strokeStyle = "rgba(0,0,0,0.15)"; ctx.lineWidth = 0.5; ctx.stroke(); }
	}

	if (G) {
		drawTerritoryBorders(ctx);
		if (R.overlay === "political") drawContestedTiles(ctx);
		drawRivers(ctx);
		drawRoads(ctx);
		if (R.showRoutes) drawRoutes(ctx);
		drawCamps(ctx);
		drawCities(ctx);
		drawUnits(ctx);
		drawSelection(ctx);
	} else {
		drawRivers(ctx);
	}
	R.dirty = false;
}

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

function drawTerritoryBorders(ctx) {
	ctx.lineWidth = Math.max(1.2, R.view.scale * 0.18);
	for (var e = 0; e < M.nEdges; e++) {
		var a = M.edgeA[e], b = M.edgeB[e];
		var oa = G.owner[a], ob = G.owner[b];
		if (oa === ob) continue;
		var s;
		if (oa >= 0) {
			s = edgeScreenSegment(e);
			if (!segVisible(s)) continue;
			ctx.strokeStyle = G.players[oa].color;
			ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.lineTo(s[2], s[3]); ctx.stroke();
		}
		if (ob >= 0) {
			s = s || edgeScreenSegment(e);
			if (!segVisible(s)) continue;
			ctx.strokeStyle = G.players[ob].color;
			ctx.setLineDash(oa >= 0 ? [3, 3] : []);
			ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.lineTo(s[2], s[3]); ctx.stroke();
			ctx.setLineDash([]);
		}
	}
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
		ctx.globalAlpha = R.selectedRoute === r ? 0.95 : 0.45;
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

function drawCities(ctx) {
	G.cities.forEach(function (c) {
		var p = tileScreen(c.tile);
		if (p[0] < -40 || p[0] > R.canvas.width + 40 || p[1] < -40 || p[1] > R.canvas.height + 40) return;
		var rad = 4 + Math.min(8, c.pop * 0.7);
		ctx.beginPath();
		ctx.arc(p[0], p[1], rad, 0, Math.PI * 2);
		ctx.fillStyle = G.players[c.owner].color;
		ctx.fill();
		ctx.lineWidth = c.buildings.walls ? 3 : 1.5;
		ctx.strokeStyle = c.buildings.walls ? "#f2f2f2" : "#111";
		ctx.stroke();
		if (c.hp < GameConfig.city.cityMaxHP) {
			ctx.fillStyle = "#000"; ctx.fillRect(p[0] - rad, p[1] - rad - 6, rad * 2, 3);
			ctx.fillStyle = "#e33"; ctx.fillRect(p[0] - rad, p[1] - rad - 6, rad * 2 * c.hp / GameConfig.city.cityMaxHP, 3);
		}
		if (R.view.scale > 4) {
			ctx.font = "11px sans-serif";
			ctx.textAlign = "center";
			ctx.fillStyle = "#fff";
			ctx.strokeStyle = "rgba(0,0,0,0.8)";
			ctx.lineWidth = 2.5;
			ctx.strokeText(c.name + " (" + c.pop + ")", p[0], p[1] + rad + 11);
			ctx.fillText(c.name + " (" + c.pop + ")", p[0], p[1] + rad + 11);
		}
	});
}

function drawUnits(ctx) {
	var byTile = {};
	G.units.forEach(function (u) { (byTile[u.tile] = byTile[u.tile] || []).push(u); });
	Object.keys(byTile).forEach(function (tile) {
		var us = byTile[tile];
		var p = tileScreen(+tile);
		us.forEach(function (u, i) {
			var x = p[0] + (i - (us.length - 1) / 2) * 9, y = p[1] - 9;
			ctx.beginPath();
			ctx.arc(x, y, 5.5, 0, Math.PI * 2);
			ctx.fillStyle = G.players[u.owner].color;
			ctx.fill();
			ctx.strokeStyle = R.selectedUnit === u ? "#fff" : "#111";
			ctx.lineWidth = R.selectedUnit === u ? 2.5 : 1;
			ctx.stroke();
			ctx.font = "8px sans-serif";
			ctx.textAlign = "center";
			ctx.fillStyle = "#fff";
			ctx.fillText(UNIT_TYPES[u.type].icon, x, y + 3);
			if (u.hp < 100) {
				ctx.fillStyle = "#000"; ctx.fillRect(x - 5, y - 9, 10, 2);
				ctx.fillStyle = "#3d3"; ctx.fillRect(x - 5, y - 9, 10 * u.hp / 100, 2);
			}
		});
	});
}

function drawCamps(ctx) {
	G.camps.forEach(function (c) {
		var p = tileScreen(c.tile);
		ctx.font = "13px sans-serif";
		ctx.textAlign = "center";
		ctx.fillStyle = c.kind === "pirates" ? "#7fd8ff" : "#ffb37f";
		ctx.strokeStyle = "rgba(0,0,0,0.9)";
		ctx.lineWidth = 3;
		ctx.strokeText("☠", p[0], p[1] + 4);
		ctx.fillText("☠", p[0], p[1] + 4);
		ctx.font = "9px sans-serif";
		ctx.fillStyle = "#eee";
		ctx.fillText(Math.round(c.strength), p[0], p[1] + 14);
	});
}

function drawSelection(ctx) {
	// deal-builder tile highlights (Diplomacy tab)
	if (typeof UI !== "undefined" && UI.tab === "diplo" && UI.deal) {
		UI.deal.give.tiles.forEach(function (t) { outlineTile(ctx, t, "#ff7d6b", 3); });
		UI.deal.get.tiles.forEach(function (t) { outlineTile(ctx, t, "#7dff8a", 3); });
	}
	if (R.hoverTile >= 0) outlineTile(ctx, R.hoverTile, "rgba(255,255,255,0.5)", 1.5);
	if (R.selectedTile >= 0) outlineTile(ctx, R.selectedTile, "#ffffff", 2);
	if (R.selectedUnit) outlineTile(ctx, R.selectedUnit.tile, "#ffe97f", 2);
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
	ctx.stroke();
}

function renderLoop() {
	if (R.dirty) draw();
	requestAnimationFrame(renderLoop);
}
