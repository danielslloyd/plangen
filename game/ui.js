// ui.js — DOM panels and interactions: selection, orders, city management
// (production, routes, subsidies), player personalities, the auto-generated
// tuning panel, and the event log.

var UI = {
	tab: "info",
	autoplay: false,
	autoplayTimer: null,
	humanId: function () { return GameConfig.setup.humanPlayer; },
	isHumanCity: function (c) { return c && c.owner === GameConfig.setup.humanPlayer; },
	roadTargetMode: null // city id when picking a road destination
};

function $id(x) { return document.getElementById(x); }
function el(html) {
	var d = document.createElement("div");
	d.innerHTML = html.trim();
	return d.firstChild;
}
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }

function initUI() {
	// --- top bar ---
	$id("endTurnBtn").onclick = function () { doEndTurn(); };
	$id("autoplayBtn").onclick = function () { toggleAutoplay(); };
	$id("speedSel").onchange = function () {
		GameConfig.ui.autoplayDelayMs = +this.value;
		if (UI.autoplay) { toggleAutoplay(); toggleAutoplay(); }
	};
	$id("overlaySel").onchange = function () {
		R.overlay = this.value;
		$id("commoditySel").style.display = this.value === "prices" ? "" : "none";
		R._fillsKey = ""; R.dirty = true;
	};
	var cs = $id("commoditySel");
	COMMODITIES.forEach(function (cm) {
		cs.appendChild(el("<option value='" + cm.id + "'>" + cm.id + "</option>"));
	});
	cs.onchange = function () { R.priceCommodity = this.value; R._fillsKey = ""; R.dirty = true; };
	$id("routesChk").onchange = function () { R.showRoutes = this.checked; R.dirty = true; };
	$id("newGameBtn").onclick = function () {
		var seed = parseInt($id("seedInput").value) || Math.floor(Math.random() * 1e9);
		$id("seedInput").value = seed;
		newGame(seed);
		R.selectedUnit = null; R.selectedCity = null; R.selectedTile = -1; R.selectedRoute = null;
		R._fillsKey = ""; R.dirty = true;
		refreshUI();
	};
	$id("mapFile").onchange = function (ev) {
		var f = ev.target.files[0];
		if (!f) return;
		var reader = new FileReader();
		reader.onload = function (e2) {
			loadMapData(JSON.parse(e2.target.result));
			$id("newGameBtn").onclick();
		};
		reader.readAsText(f);
	};

	// --- tabs ---
	document.querySelectorAll("#tabs button").forEach(function (b) {
		b.onclick = function () {
			UI.tab = b.dataset.tab;
			document.querySelectorAll("#tabs button").forEach(function (x) { x.classList.toggle("active", x === b); });
			refreshUI();
		};
	});

	// --- canvas interactions ---
	var canvas = R.canvas, dragging = false, moved = false, lastX = 0, lastY = 0;
	canvas.addEventListener("mousedown", function (e) { dragging = true; moved = false; lastX = e.clientX; lastY = e.clientY; });
	window.addEventListener("mouseup", function () { dragging = false; });
	canvas.addEventListener("mousemove", function (e) {
		if (dragging) {
			var dx = e.clientX - lastX, dy = e.clientY - lastY;
			if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
			R.view.lonC = wrapLon(R.view.lonC - dx / R.view.scale);
			R.view.latC = Math.max(-85, Math.min(85, R.view.latC + dy / R.view.scale));
			lastX = e.clientX; lastY = e.clientY;
			R.dirty = true;
		} else {
			var rect = canvas.getBoundingClientRect();
			var t = pickTile(e.clientX - rect.left, e.clientY - rect.top);
			if (t !== R.hoverTile) {
				R.hoverTile = t; R.dirty = true;
				if (UI.tab === "info") renderInfoTab();
			}
		}
	});
	canvas.addEventListener("wheel", function (e) {
		e.preventDefault();
		var f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
		R.view.scale = Math.max(1.5, Math.min(60, R.view.scale * f));
		R.dirty = true;
	}, { passive: false });
	canvas.addEventListener("click", function (e) {
		if (moved) return;
		var rect = canvas.getBoundingClientRect();
		var t = pickTile(e.clientX - rect.left, e.clientY - rect.top);
		if (t < 0) return;
		handleTileClick(t);
	});

	refreshUI();
}

function doEndTurn() {
	endTurn();
	R._fillsKey = ""; R.dirty = true;
	refreshUI();
}

function toggleAutoplay() {
	UI.autoplay = !UI.autoplay;
	$id("autoplayBtn").textContent = UI.autoplay ? "⏸ Pause" : "▶ Autoplay";
	if (UI.autoplay) {
		UI.autoplayTimer = setInterval(function () {
			if (G.winner !== null) { toggleAutoplay(); return; }
			doEndTurn();
		}, GameConfig.ui.autoplayDelayMs);
	} else {
		clearInterval(UI.autoplayTimer);
	}
}

// ---------------------------------------------------------------------------
// Map click logic
// ---------------------------------------------------------------------------

function handleTileClick(t) {
	var h = UI.humanId();

	// pending "new route" / "road to" target picks
	if (R.routeCreateFrom !== null) {
		var cid = G.cityAt[t];
		if (cid >= 0 && cid !== R.routeCreateFrom) {
			var from = G.cities[R.routeCreateFrom];
			var r = createRoute(from.owner, R.routeCreateFrom, cid);
			if (!r) gameLog("Route failed (no slots, war, or unreachable)");
		}
		R.routeCreateFrom = null;
		refreshUI(); R.dirty = true;
		return;
	}
	if (UI.roadTargetMode !== null) {
		var fromCity = G.cities[UI.roadTargetMode];
		buildRoadPath(fromCity.owner, fromCity.tile, t);
		UI.roadTargetMode = null;
		refreshUI(); R.dirty = true;
		return;
	}

	var units = unitsAt(t);
	var myUnits = units.filter(function (u) { return u.owner === h; });

	// order a selected human unit to move/attack
	if (R.selectedUnit && R.selectedUnit.owner === h && t !== R.selectedUnit.tile && !myUnits.length) {
		moveUnitTowards(R.selectedUnit, t);
		R.dirty = true; refreshUI();
		return;
	}

	R.selectedTile = t;
	R.selectedCity = G.cityAt[t] >= 0 ? G.cities[G.cityAt[t]] : null;

	// cycle through own units on the tile
	if (myUnits.length) {
		var idx = myUnits.indexOf(R.selectedUnit);
		R.selectedUnit = myUnits[(idx + 1) % myUnits.length];
	} else if (!units.length) {
		R.selectedUnit = null;
	}

	if (R.selectedCity) UI.tab = "city";
	else if (UI.tab === "city") UI.tab = "info";
	document.querySelectorAll("#tabs button").forEach(function (x) { x.classList.toggle("active", x.dataset.tab === UI.tab); });
	R.dirty = true;
	refreshUI();
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

function refreshUI() {
	if (!G) return;
	var status = "Turn " + G.turn;
	if (G.winner !== null) status += " — " + G.players[G.winner].name + " WINS";
	$id("statusSpan").textContent = status;

	var body = $id("tabBody");
	if (UI.tab === "info") renderInfoTab();
	else if (UI.tab === "city") renderCityTab();
	else if (UI.tab === "players") renderPlayersTab();
	else if (UI.tab === "tuning") renderTuningTab();
	else if (UI.tab === "log") {
		body.innerHTML = "<div class='log'>" + G.log.slice().reverse().map(esc).join("<br>") + "</div>";
	}
}

function fmtNum(v, d) { return (+v).toFixed(d === undefined ? 1 : d); }

function renderInfoTab() {
	var body = $id("tabBody");
	var html = "";
	var h = UI.humanId();

	if (R.selectedUnit) {
		var u = R.selectedUnit;
		html += "<h3>" + UNIT_TYPES[u.type].name + " (" + esc(G.players[u.owner].name) + ")</h3>" +
			"<div>HP " + Math.round(u.hp) + " · moves " + fmtNum(u.moves, 0) + "</div>";
		if (u.owner === h && u.type === "settler") {
			html += "<button id='foundBtn'>Found city here</button>";
		}
		html += "<div class='hint'>Click a tile to move/attack.</div><hr>";
	}

	var t = R.hoverTile >= 0 ? R.hoverTile : R.selectedTile;
	if (t >= 0) {
		html += "<h3>Tile " + t + " — " + M.terrainName(t) + "</h3><table class='kv'>";
		html += row("elevation", fmtNum(M.layer("elevation")[t], 3));
		html += row("temp / moist", fmtNum(M.layer("temperature")[t], 2) + " / " + fmtNum(M.layer("moisture")[t], 2));
		var ow = G.owner[t];
		html += row("owner", ow >= 0 ? esc(G.players[ow].name) : "—");
		html += row("province", M.layer("province")[t] || "—");
		COMMODITIES.forEach(function (cm) {
			var v = M.layer(cm.layer)[t];
			if (v > 0.05) html += row(cm.id, fmtNum(v, 2));
		});
		["cityPriority", "transit", "transitCross", "shoreDelta"].forEach(function (k) {
			var v = M.layer(k)[t];
			if (v > 0.02) html += row("★ " + k, fmtNum(v, 2));
		});
		if (G.traffic[t] > 0.5) html += row("trade traffic", fmtNum(G.traffic[t], 1));
		if (M.layer("river")[t]) html += row("river", "yes");
		html += "</table>";
	} else {
		html += "<div class='hint'>Hover the map for tile details. Click to select.</div>";
	}
	body.innerHTML = html;
	var fb = $id("foundBtn");
	if (fb) fb.onclick = function () {
		var c = foundCity(R.selectedUnit.owner, R.selectedUnit.tile, R.selectedUnit);
		if (c) { R.selectedUnit = null; R.selectedCity = c; UI.tab = "city"; }
		R.dirty = true; refreshUI();
	};

	function row(k, v) { return "<tr><td>" + esc(k) + "</td><td>" + v + "</td></tr>"; }
}

function renderCityTab() {
	var body = $id("tabBody");
	var c = R.selectedCity;
	if (!c) { body.innerHTML = "<div class='hint'>Click a city on the map.</div>"; return; }
	var pl = G.players[c.owner];
	var mine = UI.isHumanCity(c);
	var html = "<h3><span class='chip' style='background:" + pl.color + "'></span> " + esc(c.name) +
		" <span class='sub'>(" + esc(pl.name) + ")</span></h3>";
	html += "<div>Pop <b>" + c.pop + "</b> · HP " + Math.round(c.hp) + " · food " + fmtNum(c.foodStore) +
		" · " + Object.keys(c.buildings).join(", ") + "</div>";
	html += "<div>Yields: 🌾" + fmtNum(c.yields.food) + " ⚒" + fmtNum(c.yields.prod) +
		" 💰" + fmtNum(c.yields.gold) + " 🔬" + fmtNum(c.yields.sci) + "</div>";

	// production
	html += "<h4>Production</h4>";
	if (mine) {
		html += "<select id='prodSel'><option value=''>— idle (gold) —</option>";
		availableProduction(c).forEach(function (it) {
			html += "<option value='" + it + "'" + (c.producing === it ? " selected" : "") + ">" +
				it + " (" + productionCost(it) + "⚒)</option>";
		});
		html += "</select> <span class='sub'>" + fmtNum(c.prodStore, 0) + "⚒ stored</span>";
	} else {
		html += "<div>" + (c.producing || "idle") + " (" + fmtNum(c.prodStore, 0) + "⚒)</div>";
	}

	// market table with subsidies
	html += "<h4>Market (prices, supply → demand)</h4><table class='market'><tr><th></th><th>price</th><th>sup</th><th>dem</th><th>subsidy</th></tr>";
	COMMODITIES.forEach(function (cm) {
		var known = !(cm.kind === "crop" || cm.kind === "animal") || pl.knowledge[cm.id];
		var sub = c.subsidies[cm.id] || 0;
		html += "<tr class='" + (known ? "" : "unknown") + "'><td>" + cm.id + (known ? "" : " 🔒") + "</td>" +
			"<td>" + fmtNum(c.prices[cm.id] || 0, 2) + "</td>" +
			"<td>" + fmtNum(c.supply[cm.id] || 0) + "</td>" +
			"<td>" + fmtNum(c.demand[cm.id] || 0) + "</td>" +
			"<td>" + (mine
				? "<button class='sm sub-' data-cm='" + cm.id + "'>−</button> " + fmtNum(sub, 2) +
				  " <button class='sm sub+' data-cm='" + cm.id + "'>+</button>"
				: fmtNum(sub, 2)) + "</td></tr>";
	});
	html += "</table><div class='hint'>🔒 = this player can't grow it yet; imports teach it over time. Subsidies raise the price paid here (from " + esc(pl.name) + "'s treasury), attracting routes.</div>";

	// routes
	html += "<h4>Trade routes from here (" + routesFrom(c.id).length + "/" + cityRouteSlots(c) + ")</h4>";
	routesFrom(c.id).forEach(function (r) {
		var to = G.cities[r.to];
		html += "<div class='route' data-rid='" + r.id + "'>→ " + esc(to.name) +
			" · " + (r.active ? (r.commodity + " ×" + fmtNum(r.lastFlow) + " (+" + fmtNum(r.lastProfit) + "g" +
			(r.lastLoss > 0 ? ", ☠−" + fmtNum(r.lastLoss) : "") + ")") : "idle") +
			(mine || r.owner === UI.humanId() ? " <button class='sm delroute' data-rid='" + r.id + "'>✕</button>" : "") +
			"</div>";
	});
	if (mine) {
		html += "<button id='newRouteBtn'" + (routesFrom(c.id).length >= cityRouteSlots(c) ? " disabled" : "") + ">＋ New route (click target city)</button> ";
		html += "<button id='roadToBtn'>🛣 Build road to… (click tile)</button>";
	}
	body.innerHTML = html;

	// wire
	var ps = $id("prodSel");
	if (ps) ps.onchange = function () { c.producing = this.value || null; };
	body.querySelectorAll(".sub\\+, .sub-").forEach(function (b) {
		b.onclick = function () {
			var cm = b.dataset.cm, step = GameConfig.trade.subsidyStep;
			var cur = c.subsidies[cm] || 0;
			cur += b.classList.contains("sub+") ? step : -step;
			cur = Math.max(0, Math.min(GameConfig.trade.subsidyMax, cur));
			if (cur > 0) c.subsidies[cm] = cur; else delete c.subsidies[cm];
			refreshUI();
		};
	});
	body.querySelectorAll(".delroute").forEach(function (b) {
		b.onclick = function (ev) {
			ev.stopPropagation();
			var r = G.routes.find(function (x) { return x.id === +b.dataset.rid; });
			if (r) removeRoute(r);
			R.dirty = true; refreshUI();
		};
	});
	body.querySelectorAll(".route").forEach(function (d) {
		d.onclick = function () {
			R.selectedRoute = G.routes.find(function (x) { return x.id === +d.dataset.rid; }) || null;
			R.dirty = true;
		};
	});
	var nr = $id("newRouteBtn");
	if (nr) nr.onclick = function () { R.routeCreateFrom = c.id; };
	var rt = $id("roadToBtn");
	if (rt) rt.onclick = function () { UI.roadTargetMode = c.id; };
}

function renderPlayersTab() {
	var body = $id("tabBody");
	var html = "";
	G.players.forEach(function (pl) {
		var human = pl.id === UI.humanId();
		html += "<div class='player" + (pl.alive ? "" : " dead") + "'>";
		html += "<h3><span class='chip' style='background:" + pl.color + "'></span> " + esc(pl.name) +
			(human ? " 👤" : "") + (pl.alive ? "" : " ☠") + " <span class='sub'>" + ERA_NAMES[pl.era] + "</span></h3>";
		html += "<div>💰" + fmtNum(pl.gold, 0) + " · 🔬" + fmtNum(pl.science, 0) + " · score " + pl.score +
			" · cities " + G.cities.filter(function (x) { return x.owner === pl.id; }).length + "</div>";
		html += "<div class='sub'>knows: " + Object.keys(pl.knowledge).join(", ") + "</div>";
		var learning = Object.keys(pl.familiarity).filter(function (k) { return !pl.knowledge[k]; });
		if (learning.length) {
			html += "<div class='sub'>learning: " + learning.map(function (k) {
				return k + " " + Math.round((pl.familiarity[k] || 0) * 100) + "%";
			}).join(", ") + "</div>";
		}
		html += "<label class='slider'>toll rate <input type='range' class='tollSl' data-p='" + pl.id +
			"' min='0' max='" + GameConfig.trade.tollMax + "' step='0.05' value='" + pl.tollRate + "'>" +
			"<span>" + fmtNum(pl.tollRate, 2) + "</span></label>";
		// personality editor
		html += "<details><summary>AI personality (" + (pl.ai.preset || "custom") + ")</summary>";
		html += "<select class='presetSel' data-p='" + pl.id + "'><option value=''>— preset —</option>";
		AI_PRESET_ORDER.forEach(function (pr) {
			html += "<option value='" + pr + "'>" + pr + "</option>";
		});
		html += "</select>";
		AI_PERSONALITY_SCHEMA.forEach(function (s) {
			html += "<label class='slider'>" + s.k + " <input type='range' class='persSl' data-p='" + pl.id +
				"' data-k='" + s.k + "' min='0' max='" + s.max + "' step='0.05' value='" + (pl.ai[s.k] || 0) + "'>" +
				"<span>" + fmtNum(pl.ai[s.k] || 0, 2) + "</span></label>";
		});
		html += "</details></div>";
	});
	html += "<label class='slider'>Human player <select id='humanSel'><option value='-1'>spectate</option>" +
		G.players.map(function (p) { return "<option value='" + p.id + "'" + (p.id === UI.humanId() ? " selected" : "") + ">" + esc(p.name) + "</option>"; }).join("") +
		"</select></label>";
	body.innerHTML = html;

	body.querySelectorAll(".tollSl").forEach(function (sl) {
		sl.oninput = function () {
			var pl = G.players[+sl.dataset.p];
			pl.tollRate = +sl.value;
			sl.nextElementSibling.textContent = fmtNum(pl.tollRate, 2);
		};
	});
	body.querySelectorAll(".persSl").forEach(function (sl) {
		sl.oninput = function () {
			var pl = G.players[+sl.dataset.p];
			pl.ai[sl.dataset.k] = +sl.value;
			pl.ai.preset = "custom";
			sl.nextElementSibling.textContent = fmtNum(+sl.value, 2);
		};
	});
	body.querySelectorAll(".presetSel").forEach(function (sel) {
		sel.onchange = function () {
			if (!sel.value) return;
			var pl = G.players[+sel.dataset.p];
			var src = AI_PRESETS[sel.value];
			for (var k in src) pl.ai[k] = src[k];
			pl.ai.preset = sel.value;
			refreshUI();
		};
	});
	var hs = $id("humanSel");
	if (hs) hs.onchange = function () {
		GameConfig.setup.humanPlayer = +hs.value;
		G.players.forEach(function (p) { p.isHuman = p.id === GameConfig.setup.humanPlayer; });
		refreshUI();
	};
}

function renderTuningTab() {
	var body = $id("tabBody");
	var html = "<div class='hint'>Live game-balance knobs. Changes apply from the next turn. " +
		"<button id='exportCfgBtn' class='sm'>Copy config JSON</button></div>";
	var lastGroup = null;
	CONFIG_SCHEMA.forEach(function (s, i) {
		if (s.g !== lastGroup) {
			if (lastGroup !== null) html += "</details>";
			html += "<details" + (i === 0 ? " open" : "") + "><summary>" + s.g + "</summary>";
			lastGroup = s.g;
		}
		var v = configGet(s.p);
		html += "<label class='slider'>" + s.p.split(".").pop() +
			" <input type='range' class='cfgSl' data-p='" + s.p + "' min='" + s.min + "' max='" + s.max +
			"' step='" + s.step + "' value='" + v + "'><span>" + v + "</span></label>";
	});
	html += "</details>";
	body.innerHTML = html;
	body.querySelectorAll(".cfgSl").forEach(function (sl) {
		sl.oninput = function () {
			configSet(sl.dataset.p, +sl.value);
			sl.nextElementSibling.textContent = sl.value;
			R._fillsKey = ""; R.dirty = true;
		};
	});
	$id("exportCfgBtn").onclick = function () {
		var txt = JSON.stringify(GameConfig, null, "\t");
		navigator.clipboard && navigator.clipboard.writeText(txt);
		console.log(txt);
		gameLog("Config copied to clipboard (and console).");
	};
}
