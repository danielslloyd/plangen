// ui.js — DOM panels and interactions: selection, orders, city management
// (production, routes, subsidies), player personalities, the auto-generated
// tuning panel, the event log, the Layers panel and the contextual action bar.

var UI = {
	tab: "info",
	autoplay: false,
	autoplayTimer: null,
	humanId: function () { return GameConfig.setup.humanPlayer; },
	isHumanCity: function (c) { return c && c.owner === GameConfig.setup.humanPlayer; },
	roadTargetMode: null, // city id when picking a road destination
	deal: null,           // deal being built in the Diplomacy tab
	dealPick: null,       // 'give'|'get' while picking tiles on the map
	dropMode: false,      // airborne paradrop targeting mode
	fortifyMode: null,    // {level: 1|2} while picking an edge to fortify/wall
	settleMode: false,    // picking a settlement-mission target
	layersOpen: false
};

function uiClearModes() {
	UI.dropMode = false;
	UI.fortifyMode = null;
	UI.settleMode = false;
	UI.roadTargetMode = null;
	R.routeCreateFrom = null;
}

function uiResetDeal(partnerId) {
	var h = UI.humanId();
	UI.deal = makeDeal(h, partnerId);
	if (h >= 0 && partnerId >= 0 && atWar(h, partnerId)) UI.deal.peace = true;
	UI.dealPick = null;
}

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
	$id("layersBtn").onclick = function () { toggleLayersPanel(); };
	$id("newGameBtn").onclick = function () { showSetupScreen(); };
	$id("mapFile").onchange = function (ev) {
		var f = ev.target.files[0];
		if (!f) return;
		var reader = new FileReader();
		reader.onload = function (e2) {
			loadMapData(JSON.parse(e2.target.result));
			G = null;
			R._fillsKey = ""; R.dirty = true;
			showSetupScreen();
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
	canvas.addEventListener("mouseleave", function () {
		if (R.hoverTile !== -1) { R.hoverTile = -1; R.dirty = true; }
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

	renderLayersPanel();
	refreshUI();
}

function doEndTurn() {
	if (!G || (G.pendingStarts && G.pendingStarts.length)) return;
	endTurn();
	R._fillsKey = ""; R.dirty = true;
	refreshUI();
	showTurnToasts();
}

// ---------------------------------------------------------------------------
// Layers panel: optional map detail, with three quick presets.
// ---------------------------------------------------------------------------

var LAYER_LABELS = [
	["borders", "Territory borders"],
	["rivers", "Rivers"],
	["roads", "Roads & bridges"],
	["routes", "Trade routes"],
	["forts", "Fortifications & walls"],
	["orders", "Unit orders (⚑)"],
	["cities", "Cities"],
	["cityNames", "City names"],
	["healthBars", "Health bars"],
	["units", "Units"],
	["supplyWarnings", "Supply status"],
	["occupation", "Occupation hatching"],
	["camps", "Bandit / pirate camps"],
	["ranges", "Movement ranges"],
	["grid", "Tile grid"]
];

function toggleLayersPanel(force) {
	UI.layersOpen = force !== undefined ? force : !UI.layersOpen;
	$id("layersPanel").classList.toggle("hidden", !UI.layersOpen);
	$id("layersBtn").classList.toggle("active", UI.layersOpen);
	if (UI.layersOpen) renderLayersPanel();
}

function renderLayersPanel() {
	var panel = $id("layersPanel");
	var html = "<div class='lpTitle'>Map detail <button class='sm' id='lpClose'>✕</button></div>";
	html += "<div class='lpPresets'>";
	["minimal", "standard", "full"].forEach(function (p) {
		html += "<button class='sm lpPreset' data-p='" + p + "'>" + p + "</button>";
	});
	html += "</div>";
	LAYER_LABELS.forEach(function (pair) {
		html += "<label class='lpRow'><input type='checkbox' data-k='" + pair[0] + "'" +
			(R.layers[pair[0]] ? " checked" : "") + "> " + pair[1] + "</label>";
	});
	panel.innerHTML = html;
	panel.querySelectorAll("input[type=checkbox]").forEach(function (cb) {
		cb.onchange = function () {
			R.layers[cb.dataset.k] = cb.checked;
			R.dirty = true;
		};
	});
	panel.querySelectorAll(".lpPreset").forEach(function (b) {
		b.onclick = function () {
			var src = LAYER_PRESETS[b.dataset.p];
			for (var k in src) R.layers[k] = src[k];
			R.dirty = true;
			renderLayersPanel();
		};
	});
	var lc = $id("lpClose");
	if (lc) lc.onclick = function () { toggleLayersPanel(false); };
}

// ---------------------------------------------------------------------------
// Player strip & toast notifications
// ---------------------------------------------------------------------------

function renderPlayerStrip() {
	var strip = $id("playerStrip");
	if (!strip || !G) return;
	var html = "";
	G.players.forEach(function (pl) {
		var wars = G.players.filter(function (o) { return o.id !== pl.id && atWar(pl.id, o.id); });
		var cities = G.cities.filter(function (c) { return c.owner === pl.id; }).length;
		html += "<div class='pchip" + (pl.alive ? "" : " dead") + (pl.minor ? " minor" : "") +
			(pl.id === UI.humanId() ? " me" : "") + "' data-p='" + pl.id + "' title='" +
			esc(pl.name) + " — " + ERA_NAMES[pl.era] + ", score " + pl.score +
			(pl.minor ? " (independent city-state)" : "") +
			(pl.isHuman && pl.id !== UI.humanId() ? " — click to switch to this player" : "") +
			(wars.length ? ", at war with " + wars.map(function (w) { return w.name; }).join(", ") : "") + "'>" +
			"<span class='chip' style='background:" + pl.color + "'></span>" +
			esc(pl.name) + (pl.isHuman ? " 👤" : "") +
			" <span class='sub'>" + cities + "🏛 " + pl.score + "pt" + (wars.length ? " ⚔" : "") + "</span></div>";
	});
	strip.innerHTML = html;
	strip.querySelectorAll(".pchip").forEach(function (d) {
		d.onclick = function () {
			var pl = G.players[+d.dataset.p];
			// hotseat: clicking another human player switches the UI perspective
			if (pl.isHuman && pl.id !== UI.humanId()) {
				GameConfig.setup.humanPlayer = pl.id;
				showToast("Now playing as " + pl.name);
				refreshUI();
			}
			var cap = G.cities[pl.capital];
			if (cap) {
				R.view.lonC = M.latLon[cap.tile * 2 + 1];
				R.view.latC = M.latLon[cap.tile * 2];
				R.dirty = true;
			}
		};
	});
}

var TOAST_PATTERN = /declares war|captures|eliminated|enters the|Deal agreed|offers a deal|wins|annexes a tile|Tribute .* cancelled|starves \(out of supply\)/;

function showToast(text) {
	var wrap = $id("toasts");
	if (!wrap) return;
	var d = document.createElement("div");
	d.className = "toast";
	d.textContent = text;
	wrap.appendChild(d);
	setTimeout(function () { d.classList.add("fade"); }, 3500);
	setTimeout(function () { d.remove(); }, 4300);
	while (wrap.children.length > 6) wrap.firstChild.remove();
}

function showTurnToasts() {
	if (!G.replay || !G.replay.turns.length) return;
	var entry = G.replay.turns[G.replay.turns.length - 1];
	entry.events.filter(function (ev) { return TOAST_PATTERN.test(ev); }).slice(-4).forEach(showToast);
}

function toggleAutoplay() {
	UI.autoplay = !UI.autoplay;
	$id("autoplayBtn").textContent = UI.autoplay ? "⏸ Pause" : "▶ Autoplay";
	$id("autoplayBtn").classList.toggle("active", UI.autoplay);
	if (UI.autoplay) {
		UI.autoplayTimer = setInterval(function () {
			if (!G || G.winner !== null) { toggleAutoplay(); return; }
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

	// start-position picking (the very first action of a game)
	if (G.pendingStarts && G.pendingStarts.length) {
		var pid = G.pendingStarts[0];
		var problem = startPickProblem(t);
		if (problem) { showToast(problem); return; }
		humanPickStart(pid, t);
		if (G.pendingStarts && G.pendingStarts.length) {
			setupPrepareStartPick(); // next human picks
			showToast(G.players[pid].name + " has settled — next player, choose your start.");
		} else {
			G._recommendedStarts = null;
			showToast("All starting positions chosen — the game begins!");
			var cap = G.cities[G.players[pid].capital];
			if (cap) {
				R.view.lonC = M.latLon[cap.tile * 2 + 1];
				R.view.latC = M.latLon[cap.tile * 2];
				R.view.scale = Math.max(R.view.scale, 6);
			}
		}
		R._fillsKey = ""; R.dirty = true;
		refreshUI();
		return;
	}

	// diplomacy tile picking: toggle tiles (or whole cities) in the offer
	if (UI.tab === "diplo" && UI.dealPick && UI.deal) {
		var side = UI.dealPick === "give" ? UI.deal.give : UI.deal.get;
		var mustOwn = UI.dealPick === "give" ? h : UI.deal.to;
		var cidHere = G.cityAt[t];
		if (cidHere >= 0 && G.cities[cidHere].owner === mustOwn) {
			var ci = side.cities.indexOf(cidHere);
			if (ci >= 0) side.cities.splice(ci, 1); else side.cities.push(cidHere);
			R.dirty = true; refreshUI();
		} else if (G.owner[t] === mustOwn && cidHere < 0) {
			var i = side.tiles.indexOf(t);
			if (i >= 0) side.tiles.splice(i, 1); else side.tiles.push(t);
			R.dirty = true; refreshUI();
		} else {
			gameLog(UI.dealPick === "give" ? "Pick your own tiles or cities to offer."
				: "Pick the partner's tiles or cities to request.");
			refreshUI();
		}
		return;
	}

	// settlement-mission target pick
	if (UI.settleMode) {
		var err = launchSettlementMission(h, t);
		if (err) showToast(err);
		else {
			UI.settleMode = false;
			showToast("Settlement mission dispatched — the caravan marches (⚑ on the map).");
		}
		R.dirty = true; refreshUI();
		return;
	}

	// fortify/wall an edge: click the tile ACROSS the edge from the selected unit
	if (UI.fortifyMode && R.selectedUnit && R.selectedUnit.owner === h) {
		var fu = R.selectedUnit;
		if (t === fu.tile) { showToast("Click a neighboring tile to pick the edge to fortify."); return; }
		var fe = M.edgeBetween(fu.tile, t);
		if (fe < 0) { showToast("Pick a tile next to the unit."); return; }
		var ferr = buildFortEdge(h, fe, UI.fortifyMode.level);
		if (ferr) showToast(ferr);
		else {
			showToast(UI.fortifyMode.level === 2 ? "Wall built." : "Edge fortified — keep it manned or it decays.");
			UI.fortifyMode = null;
		}
		R.dirty = true; refreshUI();
		return;
	}

	// pending "new route" / "road to" target picks
	if (R.routeCreateFrom !== null) {
		var cid = G.cityAt[t];
		if (cid >= 0 && cid !== R.routeCreateFrom) {
			var from = G.cities[R.routeCreateFrom];
			var r = createRoute(from.owner, R.routeCreateFrom, cid);
			if (!r) showToast("Route failed (no slots, war, or unreachable)");
			else {
				// tell the player what the route will actually do
				var bestCm = null, bestMargin = -Infinity;
				COMMODITIES.forEach(function (cm) {
					var m2 = routeMargin(r, cm.id);
					if (m2 > bestMargin) { bestMargin = m2; bestCm = cm.id; }
				});
				showToast(bestMargin > 0
					? "Route opened — will carry " + bestCm + " for ~+" + bestMargin.toFixed(1) + "g/unit each turn."
					: "Route opened, but no commodity is profitable yet (it runs when prices diverge).");
			}
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

	// airborne paradrop mode: an airborne infantry drops onto the clicked tile
	if (R.selectedUnit && R.selectedUnit.owner === h && UI.dropMode &&
		R.selectedUnit.training === "airborne" && t !== R.selectedUnit.tile) {
		if (!airborneDrop(R.selectedUnit, t)) showToast("Can't drop there (range/occupied/terrain).");
		else UI.dropMode = false;
		R.dirty = true; refreshUI();
		return;
	}

	// air unit orders: click a friendly city/carrier to rebase, a target to strike
	if (R.selectedUnit && R.selectedUnit.owner === h &&
		UNIT_TYPES[R.selectedUnit.type].domain === "air" && t !== R.selectedUnit.tile) {
		var au = R.selectedUnit;
		var cid = G.cityAt[t];
		var carrierHere = unitsAt(t).find(function (x) { return x.owner === h && UNIT_TYPES[x.type].airbase; });
		if (cid >= 0 && G.cities[cid].owner === h) {
			if (!airRebase(au, cid)) showToast("Out of ferry range.");
		} else if (carrierHere) {
			if (!airRebaseCarrier(au, carrierHere)) showToast("Out of ferry range.");
		} else {
			var hasTarget = G.campAt[t] >= 0 ||
				unitsAt(t).some(function (x) { return x.owner !== h && atWar(h, x.owner); }) ||
				(cid >= 0 && atWar(h, G.cities[cid].owner));
			if (!hasTarget) showToast("No target there.");
			else if (!airStrike(au, t)) showToast("Out of strike range (or no mission left this turn).");
		}
		R.dirty = true; refreshUI();
		return;
	}

	// order a selected human unit to move/attack; the destination is remembered
	// across turns (features.persistentOrders) until it arrives or is blocked
	if (R.selectedUnit && R.selectedUnit.owner === h && t !== R.selectedUnit.tile && !myUnits.length &&
		UNIT_TYPES[R.selectedUnit.type].domain !== "air") {
		var mu = R.selectedUnit;
		// clicking an enemy/camp/hostile city is a one-off attack order, not a
		// standing destination
		var hostileAtT = G.campAt[t] >= 0 ||
			(G.cityAt[t] >= 0 && G.cities[G.cityAt[t]].owner !== h) ||
			unitsAt(t).some(function (x) { return x.owner !== h; });
		moveUnitTowards(mu, t);
		if (G.units.indexOf(mu) >= 0) {
			if (GameConfig.features.persistentOrders && mu.tile !== t && !hostileAtT) setUnitOrders(mu, "move", t);
			else mu.orders = null;
		}
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
// Action bar: always tells the player what they can do right now.
// ---------------------------------------------------------------------------

function renderActionBar() {
	var bar = $id("actionBar");
	if (!bar) return;
	if (!G) { bar.classList.add("hidden"); return; }
	var h = UI.humanId();
	var html = "";

	function modeBar(icon, title, hint, cancelId, cancelLabel) {
		return "<div class='abMode'><span class='abIcon'>" + icon + "</span><div class='abText'><b>" +
			title + "</b><span class='abHint'>" + hint + "</span></div>" +
			(cancelId ? "<button id='" + cancelId + "'>" + (cancelLabel || "Cancel") + "</button>" : "") + "</div>";
	}

	if (G.pendingStarts && G.pendingStarts.length) {
		var pl = G.players[G.pendingStarts[0]];
		html = modeBar("⚑", "Choose a starting location for <span style='color:" + pl.color + "'>" + esc(pl.name) + "</span>",
			"Gold halos mark recommended sites · hover: green = valid, red = invalid", null);
		bar.innerHTML = html;
		bar.classList.remove("hidden");
		return;
	}
	if (R.routeCreateFrom !== null) {
		html = modeBar("⇄", "New trade route from " + esc(G.cities[R.routeCreateFrom].name),
			"Click a destination city — each turn the route carries its most profitable commodity there for gold", "abCancelRoute");
	} else if (UI.settleMode) {
		html = modeBar("⚑", "Settlement mission (" + GameConfig.settle.goldCost + "g + " +
			GameConfig.settle.popCost + " pop)",
			"Click target land ≥4 tiles from any city — settlers march there and found the city on arrival", "abCancelSettle");
	} else if (UI.fortifyMode) {
		var lvl = UI.fortifyMode.level;
		html = modeBar("🛡", lvl === 2 ? "Build wall on an edge" : "Fortify an edge",
			"Click the tile ACROSS the edge from the selected unit — " +
			(lvl === 2 ? "permanent stone wall" : "decays if left unmanned"), "abCancelFort");
	} else if (UI.roadTargetMode !== null) {
		html = modeBar("🛣", "Build road from " + esc(G.cities[UI.roadTargetMode].name),
			"Click a destination tile — roads are built with gold along the path", "abCancelRoad");
	} else if (UI.dealPick) {
		html = modeBar("🤝", "Picking " + (UI.dealPick === "give" ? "tiles/cities you GIVE" : "tiles/cities you GET"),
			"Click tiles or cities on the map to toggle them in the deal", "abDonePick", "Done");
	} else if (UI.dropMode && R.selectedUnit && R.selectedUnit.owner === h) {
		html = modeBar("🪂", "Paradrop " + esc(UNIT_TYPES[R.selectedUnit.type].name),
			"Click a free tile within the blue ring (uses fuel)", "abCancelDrop");
	} else if (R.selectedUnit && R.selectedUnit.owner === h) {
		var u = R.selectedUnit;
		var def = UNIT_TYPES[u.type];
		var hint = def.domain === "air"
			? "Click an enemy in range to strike · your city / a carrier to rebase"
			: "Hover a tile to preview the path · click to move or attack";
		html = "<div class='abMode'><span class='abIcon' style='color:" + G.players[u.owner].color + "'>" + def.icon + "</span>" +
			"<div class='abText'><b>" + def.name + "</b><span class='abHint'>HP " + Math.round(u.hp) +
			" · " + (def.domain === "air" ? "missions " : "moves ") + Math.max(0, Math.round(u.moves)) +
			(u.training ? " · " + u.training : "") + " — " + hint + "</span></div>";
		if (u.type === "settler") html += "<button id='abFound' class='primary'>⚑ Found city</button>";
		if (def.trainable && !u.training) {
			var A = GameConfig.amphibious;
			html += "<button id='abTrainAir'>🪂 Airborne " + A.trainAirborneCost + "g</button>" +
				"<button id='abTrainAmp'>🌊 Amphibious " + A.trainAmphibiousCost + "g</button>";
		}
		if (u.training === "airborne" && u.moves > 0) html += "<button id='abDrop'>🪂 Paradrop…</button>";
		if (GameConfig.features.edgeFortifications && def.combat && def.domain === "land" && M.isLand(u.tile)) {
			var F = GameConfig.fort;
			html += "<button id='abFortify'>🛡 Fortify " + F.fortCostGold + "g</button>" +
				"<button id='abWallEdge'>🧱 Wall " + F.wallCostGold + "g</button>";
		}
		if (u.orders) html += "<button id='abCancelOrders'>⚑✕ Cancel orders</button>";
		html += "<button id='abDeselect'>✕</button></div>";
	} else if (R.selectedCity && UI.isHumanCity(R.selectedCity)) {
		var c = R.selectedCity;
		html = "<div class='abMode'><span class='abIcon' style='color:" + G.players[c.owner].color + "'>🏛</span>" +
			"<div class='abText'><b>" + esc(c.name) + "</b><span class='abHint'>" +
			(c.producing ? "producing " + (UNIT_TYPES[c.producing] ? UNIT_TYPES[c.producing].name : c.producing)
				: "idle — production converts to gold") + " · manage in the City tab</span></div>";
		if (GameConfig.features.merchants) {
			var full = merchantsFrom(c.id).length >= cityMerchantSlots(c);
			html += "<button id='abCaravan'" + (full ? " disabled" : "") + ">🐫 Caravan</button>";
			if (cityIsCoastal(c)) html += "<button id='abFleet'" + (full ? " disabled" : "") + ">⛵ Fleet</button>";
		} else {
			html += "<button id='abNewRoute'" + (routesFrom(c.id).length >= cityRouteSlots(c) ? " disabled" : "") + ">⇄ Route</button>";
		}
		html += "<button id='abRoadTo'>🛣 Road</button>";
		html += "<button id='abDeselect'>✕</button></div>";
	} else if (R.selectedTile >= 0 && !R.selectedUnit && !R.selectedCity &&
		GameConfig.features.merchants && GameConfig.merchant.tollMode === 0 &&
		h >= 0 && G.owner[R.selectedTile] === h) {
		// own empty tile selected: toll-gate placement (gate tolling mode)
		var gated = G.tollGates[R.selectedTile];
		html = "<div class='abMode'><span class='abIcon'>⛩</span><div class='abText'><b>" +
			(gated ? "Toll gate here" : "Your territory") +
			"</b><span class='abHint'>Gates charge foreign merchants " +
			fmtNum(G.players[h].tollRate * GameConfig.merchant.gateScale, 1) +
			"g per passage (toll-rate slider × gate scale) — merchants route around expensive gates</span></div>" +
			"<button id='abGate'>" + (gated ? "Remove gate" : "⛩ Place gate") + "</button>" +
			"<button id='abDeselect'>✕</button></div>";
	} else {
		// idle summary: what needs the player's attention
		if (h < 0) {
			html = modeBar("👁", "Spectating", "Autoplay to watch the AIs · pick a player in the Players tab to join", null);
		} else {
			var readyUnits = G.units.filter(function (u) { return u.owner === h && u.moves > 0; });
			var idleCities = G.cities.filter(function (c) { return c.owner === h && !c.producing; });
			var bits = [];
			if (readyUnits.length) bits.push(readyUnits.length + " unit" + (readyUnits.length > 1 ? "s" : "") + " ready");
			if (idleCities.length) bits.push(idleCities.length + " cit" + (idleCities.length > 1 ? "ies" : "y") + " idle");
			var picks = GameConfig.features.powerups ? (G.players[h].powerupPicks || 0) : 0;
			if (picks) bits.push(picks + " power-up pick" + (picks > 1 ? "s" : ""));
			html = "<div class='abMode'><span class='abIcon'>◎</span><div class='abText'><b>" +
				(bits.length ? bits.join(" · ") : "All orders given") +
				"</b><span class='abHint'>Click a unit or city to act · drag to pan · scroll to zoom</span></div>" +
				(picks ? "<button id='abPowerup' class='primary'>★ Choose power-up</button>" : "") +
				(readyUnits.length ? "<button id='abNext'>➤ Next unit</button>" : "") +
				(GameConfig.features.settlementMissions ? "<button id='abSettle'>⚑ Settle…</button>" : "") +
				(bits.length === 0 && !picks ? "<button id='abEnd' class='primary'>End Turn ⏵</button>" : "") + "</div>";
		}
	}
	bar.innerHTML = html;
	bar.classList.remove("hidden");

	// wire
	var w;
	if ((w = $id("abCancelRoute"))) w.onclick = function () { R.routeCreateFrom = null; R.dirty = true; refreshUI(); };
	if ((w = $id("abCancelRoad"))) w.onclick = function () { UI.roadTargetMode = null; R.dirty = true; refreshUI(); };
	if ((w = $id("abDonePick"))) w.onclick = function () { UI.dealPick = null; R.dirty = true; refreshUI(); };
	if ((w = $id("abCancelDrop"))) w.onclick = function () { UI.dropMode = false; R.dirty = true; refreshUI(); };
	if ((w = $id("abCancelSettle"))) w.onclick = function () { UI.settleMode = false; R.dirty = true; refreshUI(); };
	if ((w = $id("abCancelFort"))) w.onclick = function () { UI.fortifyMode = null; R.dirty = true; refreshUI(); };
	if ((w = $id("abSettle"))) w.onclick = function () { uiClearModes(); UI.settleMode = true; R.dirty = true; refreshUI(); };
	if ((w = $id("abFortify"))) w.onclick = function () { UI.fortifyMode = { level: 1 }; UI.dropMode = false; R.dirty = true; refreshUI(); };
	if ((w = $id("abWallEdge"))) w.onclick = function () { UI.fortifyMode = { level: 2 }; UI.dropMode = false; R.dirty = true; refreshUI(); };
	if ((w = $id("abCancelOrders"))) w.onclick = function () {
		if (R.selectedUnit) R.selectedUnit.orders = null;
		R.dirty = true; refreshUI();
	};
	if ((w = $id("abDeselect"))) w.onclick = function () {
		R.selectedUnit = null; R.selectedCity = null; R.selectedTile = -1;
		UI.dropMode = false; UI.fortifyMode = null; R.dirty = true; refreshUI();
	};
	if ((w = $id("abFound"))) w.onclick = function () {
		var c = foundCity(R.selectedUnit.owner, R.selectedUnit.tile, R.selectedUnit);
		if (c) { R.selectedUnit = null; R.selectedCity = c; UI.tab = "city"; }
		else showToast("Can't found a city here (too close to another city?).");
		R.dirty = true; refreshUI();
	};
	if ((w = $id("abTrainAir"))) w.onclick = function () {
		if (!trainUnit(R.selectedUnit, "airborne")) showToast("Can't train (need gold).");
		R.dirty = true; refreshUI();
	};
	if ((w = $id("abTrainAmp"))) w.onclick = function () {
		if (!trainUnit(R.selectedUnit, "amphibious")) showToast("Can't train (need gold).");
		R.dirty = true; refreshUI();
	};
	if ((w = $id("abDrop"))) w.onclick = function () { UI.dropMode = true; R.dirty = true; refreshUI(); };
	if ((w = $id("abNewRoute"))) w.onclick = function () { R.routeCreateFrom = R.selectedCity.id; refreshUI(); };
	if ((w = $id("abCaravan"))) w.onclick = function () {
		var err = spawnMerchant(R.selectedCity.id, "caravan");
		showToast(err || "Caravan outfitted.");
		R.dirty = true; refreshUI();
	};
	if ((w = $id("abFleet"))) w.onclick = function () {
		var err = spawnMerchant(R.selectedCity.id, "fleet");
		showToast(err || "Merchant fleet launched.");
		R.dirty = true; refreshUI();
	};
	if ((w = $id("abGate"))) w.onclick = function () {
		var err = toggleTollGate(h, R.selectedTile);
		if (err) showToast(err);
		R.dirty = true; refreshUI();
	};
	if ((w = $id("abPowerup"))) w.onclick = function () {
		UI.tab = "players";
		document.querySelectorAll("#tabs button").forEach(function (x) { x.classList.toggle("active", x.dataset.tab === "players"); });
		refreshUI();
	};
	if ((w = $id("abRoadTo"))) w.onclick = function () { UI.roadTargetMode = R.selectedCity.id; refreshUI(); };
	if ((w = $id("abNext"))) w.onclick = function () { selectNextReadyUnit(); };
	if ((w = $id("abEnd"))) w.onclick = function () { doEndTurn(); };
}

function selectNextReadyUnit() {
	var h = UI.humanId();
	var ready = G.units.filter(function (u) { return u.owner === h && u.moves > 0; });
	if (!ready.length) return;
	var idx = ready.indexOf(R.selectedUnit);
	var u = ready[(idx + 1) % ready.length];
	R.selectedUnit = u;
	R.selectedTile = u.tile;
	R.selectedCity = null;
	R.view.lonC = M.latLon[u.tile * 2 + 1];
	R.view.latC = M.latLon[u.tile * 2];
	R.dirty = true;
	refreshUI();
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

function refreshUI() {
	if (!G) {
		$id("statusSpan").textContent = "Set up a new game";
		renderActionBar();
		return;
	}
	var picking = G.pendingStarts && G.pendingStarts.length;
	var status = picking ? "Choose your start" : "Turn " + G.turn;
	var h = UI.humanId();
	if (!picking && h >= 0 && G.players[h]) {
		var me = G.players[h];
		status += " · " + ERA_NAMES[me.era];
		if (GameConfig.features.timedEras) {
			var E = GameConfig.eras;
			var next = me.era === 0 ? E.classicalTurns : me.era === 1 ? E.classicalTurns + E.napoleonicTurns : -1;
			if (next > 0) status += " (" + Math.max(0, next - G.turn) + "t left)";
		} else {
			status += " · 🔬" + Math.round(me.science);
		}
		status += " · 💰" + Math.round(me.gold);
	}
	if (G.winner !== null) status += " — " + G.players[G.winner].name + " WINS";
	$id("statusSpan").textContent = status;
	$id("endTurnBtn").disabled = !!picking || G.winner !== null;
	renderPlayerStrip();
	renderActionBar();

	// offer badge on the Diplomacy tab
	var diploBtn = document.querySelector("#tabs button[data-tab=diplo]");
	if (diploBtn) {
		var n = G.offers.filter(function (o) { return o.deal.to === UI.humanId(); }).length;
		diploBtn.textContent = n ? "Diplomacy (" + n + ")" : "Diplomacy";
	}

	if (UI.tab === "info") renderInfoTab();
	else if (UI.tab === "city") renderCityTab();
	else if (UI.tab === "players") renderPlayersTab();
	else if (UI.tab === "diplo") renderDiploTab();
	else if (UI.tab === "designs") renderDesignsTab();
	else if (UI.tab === "tuning") renderTuningTab();
	else if (UI.tab === "log") renderLogTab();
}

function fmtNum(v, d) { return (+v).toFixed(d === undefined ? 1 : d); }

function renderInfoTab() {
	var body = $id("tabBody");
	if (!G) return;
	var html = "";
	var h = UI.humanId();

	if (G.pendingStarts && G.pendingStarts.length) {
		html += "<h3>Founding a nation</h3><div class='hint'>Click the map to place your capital. " +
			"Gold halos mark sites your advisors recommend (food, production, trade corridors). " +
			"Hover a tile to inspect it below.</div><hr>";
	}

	if (R.selectedUnit) {
		var u = R.selectedUnit;
		var def = UNIT_TYPES[u.type];
		var pl0 = G.players[u.owner];
		var str = Math.round(effStrength(u));
		var baseStr = Math.round(u.str || unitStrength(u.type));

		// unit ability card: everything the unit can do, at a glance
		html += "<div class='unitCard' style='border-left-color:" + pl0.color + "'>";
		html += "<div class='ucHead'><span class='ucIcon'>" + def.icon + "</span><div><b>" +
			def.name + "</b><div class='sub'>" + esc(pl0.name) + " · " + def.domain +
			(u.training ? " · " + u.training : "") + "</div></div></div>";
		html += "<div class='ucStats'>";
		html += ucStat("⚔", str + (str !== baseStr ? "<span class='sub'>/" + baseStr + "</span>" : ""), "strength (effective/base)");
		html += ucStat("♥", Math.round(u.hp), "health");
		html += ucStat(def.domain === "air" ? "✈" : "➜", fmtNum(u.moves, 0),
			def.domain === "air" ? "missions left" : "move points left");
		if (def.domain === "air") html += ucStat("◎", Math.round((u.strikeRange || GameConfig.air.strikeRange) * carrierAirBonus(u)), "strike range");
		html += "</div>";
		// ability badges
		var badges = [];
		if (def.siege) badges.push("🏰 siege ×" + GameConfig.combat.siegeCityBonus + " vs cities, bombards safely");
		if (def.domain === "land" && def.combat) badges.push("🌊 can embark to cross water (weak at sea)");
		if (u.training === "airborne") badges.push("🪂 paradrop within " + GameConfig.amphibious.paradropRange + " tiles");
		if (u.training === "amphibious") badges.push("🌊 lands without disorganization");
		if (def.trainable && !u.training) badges.push("★ can train airborne / amphibious");
		if (def.airbase) badges.push("⊞ mobile airbase: aircraft can base here");
		if (def.design) badges.push("⚙ " + esc(designLabel(u.type, designOf(pl0, u.type))));
		if (u.type === "settler") badges.push("⚑ founds a city on suitable land");
		badges.forEach(function (b) { html += "<div class='ucBadge'>" + b + "</div>"; });
		// state warnings + orders
		if (M.isWater(u.tile) && def.domain === "land") html += "<div class='warn'>⚓ embarked at sea (weak)</div>";
		if (u.landedTurns > 0) html += "<div class='warn'>landing disorganization (" + u.landedTurns + "t)</div>";
		if (u.carrierId) html += "<div class='sub'>✈ aboard carrier</div>";
		if (u.orders) html += "<div class='sub'>⚑ standing orders: " + u.orders.type + " → tile " + u.orders.target + "</div>";
		// supply status
		var needs = unitNeeds(u);
		var supBits = [];
		if (needs.food) supBits.push((u.supply.food ? "🌾" : "<span class='warn'>🌾✗</span>") + "<span class='sub'>" + needs.food + "/t</span>");
		if (needs.ammo) supBits.push((u.supply.ammo ? "💥" : "<span class='warn'>💥✗</span>") + "<span class='sub'>" + needs.ammo + "/atk</span>");
		if (needs.fuel) supBits.push((u.supply.fuel ? "⛽" : "<span class='warn'>⛽✗</span>") + "<span class='sub'>" + needs.fuel + "/mv</span>");
		if (supBits.length) {
			html += "<div>supply: " + supBits.join(" ") +
				(u.supplyDist >= 0 ? " <span class='sub'>(line: " + u.supplyDist + " hops)</span>"
					: " <span class='warn'>OUT OF SUPPLY</span>") + "</div>";
		}
		html += "</div><hr>";
	}

	var t = R.hoverTile >= 0 ? R.hoverTile : R.selectedTile;
	if (t >= 0) {
		html += "<h3>Tile " + t + " — " + M.terrainName(t) + "</h3><table class='kv'>";
		html += row("elevation", fmtNum(M.layer("elevation")[t], 3));
		html += row("temp / moist", fmtNum(M.layer("temperature")[t], 2) + " / " + fmtNum(M.layer("moisture")[t], 2));
		var ow = G.owner[t];
		html += row("owner", ow >= 0 ? esc(G.players[ow].name) : "—");
		if (G.occupation[t]) {
			var oc = G.occupation[t];
			html += row("⚠ contested", esc(G.players[oc.by].name) + " occupying (" + oc.turns + "/" +
				GameConfig.territory.occupationTurnsToFlip + ")");
		}
		if (G.annexed[t] !== undefined) html += row("annexed", "yes (by " + esc(G.players[G.annexed[t]].name) + ")");
		html += row("province", M.layer("province")[t] || "—");
		if (GameConfig.features.tilePopulation && G.tilePop && G.tilePop[t] > 0.1) {
			html += row("population", fmtNum(G.tilePop[t], 1) + " <span class='sub'>(rural)</span>");
		}
		COMMODITIES.forEach(function (cm) {
			if (!cm.layer) return; // manufactured (city-made) commodities
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

	function row(k, v) { return "<tr><td>" + esc(k) + "</td><td>" + v + "</td></tr>"; }
}

function ucStat(icon, value, label) {
	return "<div class='ucStat' title='" + esc(label) + "'><span class='ucStatIcon'>" + icon +
		"</span><b>" + value + "</b><span class='ucStatLbl'>" + esc(label) + "</span></div>";
}

function renderCityTab() {
	var body = $id("tabBody");
	var c = R.selectedCity;
	if (!c) { body.innerHTML = "<div class='hint'>Click a city on the map.</div>"; return; }
	var pl = G.players[c.owner];
	var mine = UI.isHumanCity(c);
	var html = "<h3><span class='chip' style='background:" + pl.color + "'></span> " + esc(c.name) +
		" <span class='sub'>(" + esc(pl.name) + (pl.minor ? ", city-state" : "") + ")</span></h3>";
	html += "<div>Pop <b>" + c.pop + "</b> · HP " + Math.round(c.hp) + " · food " + fmtNum(c.foodStore) +
		(GameConfig.features.merchants ? " · 💎wealth " + fmtNum(c.wealth || 0, 0) : "") +
		" · " + (Object.keys(c.buildings).join(", ") || "no buildings") + "</div>";
	html += "<div>Yields: 🌾" + fmtNum(c.yields.food) + " ⚒" + fmtNum(c.yields.prod) +
		" 💰" + fmtNum(c.yields.gold) + " 🔬" + fmtNum(c.yields.sci) + "</div>";

	// production
	html += "<h4>Production</h4>";
	if (mine) {
		html += "<select id='prodSel'><option value=''>— idle (gold) —</option>";
		availableProduction(c).forEach(function (it) {
			var label = UNIT_TYPES[it] ? UNIT_TYPES[it].name : it;
			html += "<option value='" + it + "'" + (c.producing === it ? " selected" : "") + ">" +
				label + " (" + productionCost(it, c) + "⚒)</option>";
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

	// trade: merchant agents (features.merchants) or legacy abstract routes
	if (GameConfig.features.merchants) {
		var MC = GameConfig.merchant;
		var ms = merchantsFrom(c.id);
		html += "<h4>Merchants (" + ms.length + "/" + cityMerchantSlots(c) + ")</h4>";
		if (!ms.length) html += "<div class='hint'>None yet. Merchants plan their own round trips from price histories; profits build the city's 💎wealth, which feeds growth.</div>";
		ms.forEach(function (m) {
			var dest = m.plan && G.cities[m.plan.to];
			var stateTxt = m.state === "idle" ? "in port — looking for margins"
				: (m.state === "outbound" ? "→ " : "← ") + (dest ? esc(dest.name) : "?") +
				(m.cargo ? " carrying " + m.cargo.cm + " ×" + fmtNum(m.cargo.qty, 0) : " (empty)");
			html += "<div class='route'>" + (m.kind === "fleet" ? "⛵" : "🐫") + " " + stateTxt +
				" <span class='sub'>· " + m.trips + " trips, last " +
				(m.trips ? (m.lastProfit >= 0 ? "+" : "") + fmtNum(m.lastProfit, 1) + "g" : "—") + "</span></div>";
		});
		if (mine) {
			html += "<div class='trainrow'>" +
				"<button id='spawnCaravanBtn' class='sm'>🐫 Caravan (" + MC.caravanGoldCost + "g + " + MC.caravanPopCost + " pop + horses)</button>" +
				"<button id='spawnFleetBtn' class='sm'>⛵ Fleet (" + MC.fleetGoldCost + "g + " + MC.fleetPopCost + " pop + timber)</button></div>";
			html += "<button id='roadToBtn'>🛣 Build road to… (click tile)</button>";
		}
	} else {
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
	}
	body.innerHTML = html;

	var sc = $id("spawnCaravanBtn");
	if (sc) sc.onclick = function () {
		var err = spawnMerchant(c.id, "caravan");
		if (err) showToast(err); else showToast("Caravan outfitted — it will seek out price margins on its own.");
		R.dirty = true; refreshUI();
	};
	var sf = $id("spawnFleetBtn");
	if (sf) sf.onclick = function () {
		var err = spawnMerchant(c.id, "fleet");
		if (err) showToast(err); else showToast("Merchant fleet launched — it will trade between coastal cities.");
		R.dirty = true; refreshUI();
	};

	// wire
	var ps = $id("prodSel");
	if (ps) ps.onchange = function () { c.producing = this.value || null; refreshUI(); };
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
	if (nr) nr.onclick = function () { R.routeCreateFrom = c.id; refreshUI(); };
	var rt = $id("roadToBtn");
	if (rt) rt.onclick = function () { UI.roadTargetMode = c.id; refreshUI(); };
}

var POLICY_LABELS = [
	["taxation", "Taxation", "gold from population, at the cost of growth"],
	["militarism", "Militarism", "cheaper units and harder cities, favors the army"],
	["openness", "Openness", "more trade routes and faster crop learning"],
	["infrastructure", "Infrastructure", "keeps food through growth (granaries)"]
];

function renderPlayersTab() {
	var body = $id("tabBody");
	var html = "";
	var hh = UI.humanId();
	var me = hh >= 0 ? G.players[hh] : null;

	// --- your national controls first (power-ups + policies + doctrine) ---
	if (me && GameConfig.features.powerups) {
		var picks = me.powerupPicks || 0;
		var taken = Object.keys(me.powerups || {});
		html += "<h4>Power-ups" + (picks ? " — " + picks + " pick" + (picks > 1 ? "s" : "") + " available!" : "") + "</h4>";
		if (taken.length) {
			html += "<div class='sub'>adopted: " + taken.map(function (id) {
				var p = puFind(id); return p ? p.name : id;
			}).join(", ") + "</div>";
		}
		if (picks > 0) {
			POWERUP_CATEGORIES.forEach(function (cat) {
				var avail = puAvailable(me, cat);
				if (!avail.length) return;
				html += "<div class='puCat'>" + cat.toUpperCase() + "</div>";
				avail.forEach(function (p) {
					html += "<div class='puRow'><button class='sm puPick' data-id='" + p.id + "'>" +
						esc(p.name) + "</button> <span class='sub'>" + esc(p.desc) + "</span></div>";
				});
			});
		} else {
			html += "<div class='hint'>Next pick in " +
				(GameConfig.powerups.everyTurns - (G.turn % GameConfig.powerups.everyTurns)) + " turns.</div>";
		}
	}
	if (me && GameConfig.features.policies) {
		html += "<h4>Your policies</h4><div class='hint'>National sliders replace per-city buildings.</div>";
		POLICY_LABELS.forEach(function (p) {
			html += "<label class='slider' title='" + p[2] + "'>" + p[1] +
				" <input type='range' class='polSl' data-k='" + p[0] + "' min='0' max='1' step='0.05' value='" +
				(me.policies[p[0]] || 0) + "'><span>" + fmtNum(me.policies[p[0]] || 0, 2) + "</span></label>";
		});
	}
	if (me && GameConfig.features.recruitment) {
		html += "<h4>Force doctrine</h4><div class='hint'>Set how many of each unit the nation should field — idle cities recruit toward the quotas automatically.</div>";
		var counts = {};
		G.units.forEach(function (u) { if (u.owner === hh) counts[u.type] = (counts[u.type] || 0) + 1; });
		Object.keys(UNIT_TYPES).forEach(function (t) {
			var def = UNIT_TYPES[t];
			if (!def.combat || def.era !== me.era) return;
			html += "<div class='dealrow'>" + def.icon + " " + def.name +
				" <span class='sub'>(" + (counts[t] || 0) + " fielded · " + unitCost(t, me) + "⚒)</span>" +
				" <input type='number' class='quotaInp' data-t='" + t + "' min='0' max='30' value='" +
				(me.quotas[t] || 0) + "'></div>";
		});
	}

	G.players.forEach(function (pl) {
		var human = pl.id === UI.humanId();
		html += "<div class='player" + (pl.alive ? "" : " dead") + (pl.minor ? " minorP" : "") + "'>";
		html += "<h3><span class='chip' style='background:" + pl.color + "'></span> " + esc(pl.name) +
			(human ? " 👤" : "") + (pl.alive ? "" : " ☠") +
			" <span class='sub'>" + ERA_NAMES[pl.era] + (pl.minor ? " · city-state" : "") + "</span></h3>";
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
		G.players.filter(function (p) { return !p.minor; }).map(function (p) {
			return "<option value='" + p.id + "'" + (p.id === UI.humanId() ? " selected" : "") + ">" + esc(p.name) + "</option>";
		}).join("") +
		"</select></label>";
	body.innerHTML = html;

	body.querySelectorAll(".puPick").forEach(function (b) {
		b.onclick = function () {
			var err = pickPowerup(me, b.dataset.id);
			if (err) showToast(err);
			else showToast("Adopted " + puFind(b.dataset.id).name + "!");
			R._fillsKey = ""; R.dirty = true;
			refreshUI();
		};
	});
	body.querySelectorAll(".polSl").forEach(function (sl) {
		sl.oninput = function () {
			me.policies[sl.dataset.k] = +sl.value;
			sl.nextElementSibling.textContent = fmtNum(+sl.value, 2);
		};
	});
	body.querySelectorAll(".quotaInp").forEach(function (inp) {
		inp.onchange = function () {
			me.quotas[inp.dataset.t] = Math.max(0, +inp.value || 0);
		};
	});
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

// ---------------------------------------------------------------------------
// Diplomacy tab: incoming offers, deal builder with map tile-picking, tribute
// status, and relations overview.
// ---------------------------------------------------------------------------

function renderDiploTab() {
	var body = $id("tabBody");
	var h = UI.humanId();
	var html = "";

	if (h < 0) {
		html += "<div class='hint'>Spectating — no diplomacy. Active tributes:</div>";
		html += diploTributeList();
		body.innerHTML = html;
		return;
	}
	var me = G.players[h];

	// --- incoming offers ---
	var myOffers = G.offers.filter(function (o) { return o.deal.to === h; });
	if (myOffers.length) {
		html += "<h4>Incoming offers</h4>";
		myOffers.forEach(function (o, i) {
			var from = G.players[o.deal.from];
			html += "<div class='offer'><span class='chip' style='background:" + from.color + "'></span><b>" +
				esc(from.name) + "</b>: " + esc(dealSummary(o.deal)) +
				(o.deal.threat ? " <span class='warn'>⚠ refusing may mean war</span>" : "") +
				"<div><button class='sm offerAcc' data-i='" + i + "'>Accept</button> " +
				"<button class='sm offerRej' data-i='" + i + "'>Reject</button></div></div>";
		});
	}

	// --- partner picker ---
	var partners = G.players.filter(function (p) { return p.alive && p.id !== h; });
	if (!partners.length) { body.innerHTML = html + "<div class='hint'>No one left to talk to.</div>"; return; }
	if (!UI.deal || UI.deal.from !== h || !G.players[UI.deal.to] || !G.players[UI.deal.to].alive ||
		UI.deal.to === h) {
		uiResetDeal(partners[0].id);
	}
	var partner = G.players[UI.deal.to];

	html += "<h4>Negotiate</h4><label>with <select id='diploPartner'>";
	partners.forEach(function (p) {
		html += "<option value='" + p.id + "'" + (p.id === UI.deal.to ? " selected" : "") + ">" + esc(p.name) +
			(p.minor ? " (city-state)" : "") + "</option>";
	});
	html += "</select></label>";

	var war = atWar(h, partner.id);
	var myP = Math.round(playerPower(h)), thP = Math.round(playerPower(partner.id));
	html += "<div class='sub'>" + (war ? "⚔ AT WAR" : "at peace") + " · power " + myP + " vs " + thP +
		(!war ? " <button id='declareWarBtn' class='sm'>⚔ Declare war</button>" : "") + "</div>";

	// --- deal builder ---
	html += "<div class='dealbox'><div class='dealcol'><b>You give</b>" + dealSideEditor("give", UI.deal.give) + "</div>" +
		"<div class='dealcol'><b>You get</b>" + dealSideEditor("get", UI.deal.get) + "</div></div>";
	if (war) html += "<label><input type='checkbox' id='dealPeace' " + (UI.deal.peace ? "checked" : "") + "> peace treaty</label>";
	html += "<div><button id='dealPropose'>Propose deal</button> <button id='dealClear' class='sm'>Clear</button></div>";
	if (UI.dealHint) html += "<div class='hint'>" + esc(UI.dealHint) + "</div>";

	// --- tributes & wars ---
	html += "<h4>Active tributes</h4>" + diploTributeList();

	body.innerHTML = html;

	// wire
	var dw = $id("declareWarBtn");
	if (dw) dw.onclick = function () {
		declareWar(h, partner.id);
		showToast("You declared war on " + partner.name + " — enemy units and cities are now attackable.");
		R._fillsKey = ""; R.dirty = true;
		refreshUI();
	};
	var ps = $id("diploPartner");
	if (ps) ps.onchange = function () { uiResetDeal(+this.value); UI.dealHint = null; R.dirty = true; refreshUI(); };
	var pc = $id("dealPeace");
	if (pc) pc.onchange = function () { UI.deal.peace = this.checked; };
	body.querySelectorAll(".dealNum").forEach(function (inp) {
		inp.onchange = function () {
			var side = inp.dataset.side === "give" ? UI.deal.give : UI.deal.get;
			side[inp.dataset.k] = Math.max(0, +inp.value || 0);
		};
	});
	body.querySelectorAll(".pickBtn").forEach(function (b) {
		b.onclick = function () {
			UI.dealPick = UI.dealPick === b.dataset.side ? null : b.dataset.side;
			refreshUI();
		};
	});
	body.querySelectorAll(".clearTiles").forEach(function (b) {
		b.onclick = function () {
			var side = b.dataset.side === "give" ? UI.deal.give : UI.deal.get;
			side.tiles = []; side.cities = [];
			R.dirty = true; refreshUI();
		};
	});
	var pd = $id("dealPropose");
	if (pd) pd.onclick = function () {
		if (atWar(h, UI.deal.to)) UI.deal.peace = true;
		var res = proposeDeal(UI.deal);
		if (res.status === "accepted") UI.dealHint = partner.name + " accepts!";
		else if (res.status === "pending") UI.dealHint = "Offer delivered.";
		else if (res.invalid) UI.dealHint = "Invalid deal (check tile ownership).";
		else UI.dealHint = partner.name + " refuses — they'd want roughly " + Math.ceil(res.deficit) + "g more value.";
		if (res.status !== "rejected") uiResetDeal(UI.deal.to);
		R._fillsKey = ""; R.dirty = true;
		refreshUI();
	};
	var dc = $id("dealClear");
	if (dc) dc.onclick = function () { uiResetDeal(UI.deal.to); UI.dealHint = null; R.dirty = true; refreshUI(); };
	body.querySelectorAll(".offerAcc, .offerRej").forEach(function (b) {
		b.onclick = function () {
			var offers = G.offers.filter(function (o) { return o.deal.to === h; });
			var o = offers[+b.dataset.i];
			if (o) resolveOffer(o, b.classList.contains("offerAcc"));
			R._fillsKey = ""; R.dirty = true;
			refreshUI();
		};
	});
}

function dealSideEditor(sideName, side) {
	var picking = UI.dealPick === sideName;
	var html = "<label class='dealrow'>gold <input class='dealNum' data-side='" + sideName +
		"' data-k='gold' type='number' min='0' value='" + (side.gold || 0) + "'></label>";
	html += "<label class='dealrow'>tribute/turn <input class='dealNum' data-side='" + sideName +
		"' data-k='tributePerTurn' type='number' min='0' value='" + (side.tributePerTurn || 0) + "'></label>";
	html += "<label class='dealrow'>for turns <input class='dealNum' data-side='" + sideName +
		"' data-k='tributeTurns' type='number' min='0' value='" + (side.tributeTurns || 0) + "'></label>";
	var cityNames = (side.cities || []).map(function (cid) { return G.cities[cid] ? G.cities[cid].name : "?"; }).join(", ");
	html += "<div class='dealrow'>tiles: " + side.tiles.length +
		(side.cities && side.cities.length ? " · cities: " + esc(cityNames) : "") +
		" <button class='sm pickBtn" + (picking ? " active" : "") + "' data-side='" + sideName + "'>" +
		(picking ? "✓ picking… (tiles/cities)" : "pick on map") + "</button>" +
		(side.tiles.length || (side.cities && side.cities.length) ? " <button class='sm clearTiles' data-side='" + sideName + "'>✕</button>" : "") + "</div>";
	return html;
}

function diploTributeList() {
	if (!G.tributes.length) return "<div class='hint'>none</div>";
	return G.tributes.map(function (tr) {
		return "<div class='sub'>" + esc(G.players[tr.from].name) + " → " + esc(G.players[tr.to].name) +
			": " + tr.amount + "g/turn, " + tr.turnsLeft + " turns left</div>";
	}).join("");
}

// ---------------------------------------------------------------------------
// Designs tab: per-unit-type ship/plane design sliders with live cost + a
// retooling warning. Available for the era's designable units.
// ---------------------------------------------------------------------------

function renderDesignsTab() {
	var body = $id("tabBody");
	var h = UI.humanId();
	if (h < 0) { body.innerHTML = "<div class='hint'>Spectating — no designs to edit.</div>"; return; }
	var pl = G.players[h];
	initDesigns(pl);

	var current = designableTypes().filter(function (t) { return UNIT_TYPES[t].era === pl.era; });
	var html = "<div class='hint'>Configure your ship and aircraft classes. Higher attributes cost more; " +
		"changing a design slows production of that type for " + GameConfig.design.retoolTurns + " turns.</div>";

	if (!current.length) html += "<div class='hint'>No designable classes in the " + ERA_NAMES[pl.era] + " era.</div>";

	current.forEach(function (t) {
		var def = UNIT_TYPES[t], cls = DESIGN_CLASSES[def.design], d = designOf(pl, t);
		var retool = (pl.retool && pl.retool[t]) || 0;
		html += "<div class='designbox'><b>" + esc(def.name) + "</b> <span class='sub'>" + def.design + "</span>" +
			(retool ? " <span class='warn'>retooling " + retool + "t</span>" : "") +
			"<div class='sub'>base str " + unitBaseStrength(t) + " · cost " + unitCost(t, pl) + "⚒</div>";
		["a", "b"].forEach(function (slot) {
			var meta = cls[slot];
			html += "<label class='slider'>" + meta.label +
				" <input type='range' class='desSl' data-t='" + t + "' data-slot='" + slot +
				"' min='" + GameConfig.design.attrMin + "' max='" + GameConfig.design.attrMax +
				"' step='0.05' value='" + d[slot] + "'><span>" + d[slot].toFixed(2) + "</span></label>";
		});
		html += "</div>";
	});
	body.innerHTML = html;

	body.querySelectorAll(".desSl").forEach(function (sl) {
		// live label while dragging; commit (with retool) on release/change
		sl.oninput = function () { sl.nextElementSibling.textContent = (+sl.value).toFixed(2); };
		sl.onchange = function () {
			var t = sl.dataset.t, d = designOf(pl, t);
			var a = sl.dataset.slot === "a" ? +sl.value : d.a;
			var b = sl.dataset.slot === "b" ? +sl.value : d.b;
			setDesign(pl, t, a, b);
			refreshUI();
		};
	});
}

function renderLogTab() {
	var body = $id("tabBody");
	var html = "<div><button id='dlLogBtn' class='sm'>⬇ Download game log (JSON)</button> " +
		"<span class='sub'>" + (G.replay ? G.replay.turns.length : 0) + " turns recorded</span></div>";

	// recent AI goals, newest turn first
	if (G.replay && G.replay.turns.length) {
		html += "<h4>AI goals (recent turns)</h4>";
		G.replay.turns.slice(-3).reverse().forEach(function (entry) {
			if (!entry.goals.length) return;
			html += "<div class='sub'><b>Turn " + entry.turn + "</b></div>";
			entry.goals.forEach(function (g) {
				var pl = G.players[g.player];
				html += "<div class='goal'><span class='chip' style='background:" + pl.color + "'></span>" +
					"<span class='goalkind'>" + esc(g.kind) + "</span> " + esc(g.text) + "</div>";
			});
		});
	}

	html += "<h4>Events</h4><div class='log'>" + G.log.slice().reverse().map(esc).join("<br>") + "</div>";
	body.innerHTML = html;
	$id("dlLogBtn").onclick = downloadGameLog;
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
