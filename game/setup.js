// setup.js — the new-game setup screen: pick opponents (count + human/AI +
// personality), independents fill, seed, and the "choose your start on the
// map" flow. Shown at boot and via the "New game" button.

var SETUP = {
	slots: [
		{ control: "human", preset: "random" },
		{ control: "ai", preset: "random" },
		{ control: "ai", preset: "random" },
		{ control: "ai", preset: "random" }
	],
	npcFill: true,
	startPick: true,
	seed: 12345
};

var SETUP_MAX_PLAYERS = 8;

function showSetupScreen() {
	if (UI.autoplay) toggleAutoplay();
	renderSetupScreen();
	$id("setupScreen").classList.remove("hidden");
}

function hideSetupScreen() {
	$id("setupScreen").classList.add("hidden");
}

function renderSetupScreen() {
	var scr = $id("setupScreen");
	var mapName = M && M.meta ? (M.meta.name || "map seed " + (M.meta.seed || "?")) : "no map";
	var landInfo = M ? M.landTiles.length + " land tiles" : "";

	var html = "<div id='setupCard'>";
	html += "<h1>NEW <b>GAME</b></h1>";
	html += "<div class='suSub'>" + esc(mapName) + " · " + landInfo + "</div>";

	html += "<div class='suSection'>Players</div><div id='suSlots'>";
	SETUP.slots.forEach(function (sl, i) {
		html += "<div class='suSlot'>" +
			"<span class='chip' style='background:" + PLAYER_COLORS[i % PLAYER_COLORS.length] + "'></span>" +
			"<span class='suName'>Player " + (i + 1) + "</span>" +
			"<select class='suControl' data-i='" + i + "'>" +
			"<option value='human'" + (sl.control === "human" ? " selected" : "") + ">👤 Human</option>" +
			"<option value='ai|random'" + (sl.control === "ai" && sl.preset === "random" ? " selected" : "") + ">🤖 AI — random</option>";
		AI_PRESET_ORDER.forEach(function (pr) {
			html += "<option value='ai|" + pr + "'" + (sl.control === "ai" && sl.preset === pr ? " selected" : "") +
				">🤖 AI — " + pr + "</option>";
		});
		html += "</select>" +
			(SETUP.slots.length > 2 ? "<button class='sm suRemove' data-i='" + i + "' title='remove'>✕</button>" : "") +
			"</div>";
	});
	html += "</div>";
	if (SETUP.slots.length < SETUP_MAX_PLAYERS) {
		html += "<button id='suAdd' class='sm'>＋ Add player</button>";
	}

	html += "<div class='suSection'>World</div>";
	html += "<label class='suOpt'><input type='checkbox' id='suNpc'" + (SETUP.npcFill ? " checked" : "") +
		"> Fill sparse land with independents <span class='sub'>(peaceful city-states & bandit camps)</span></label>";
	html += "<label class='suOpt'><input type='checkbox' id='suPick'" + (SETUP.startPick ? " checked" : "") +
		"> Choose starting location on the map <span class='sub'>(otherwise placed automatically)</span></label>";
	html += "<label class='suOpt'>Seed <input id='suSeed' value='" + SETUP.seed + "' size='10'>" +
		" <button id='suSeedRnd' class='sm'>🎲</button></label>";

	html += "<div class='suActions'><button id='suStart' class='primary'>Start Game ⏵</button>" +
		(G ? "<button id='suBack'>Back</button>" : "") + "</div>";
	html += "</div>";
	scr.innerHTML = html;

	// wire
	scr.querySelectorAll(".suControl").forEach(function (sel) {
		sel.onchange = function () {
			var i = +sel.dataset.i;
			if (sel.value === "human") SETUP.slots[i] = { control: "human", preset: "random" };
			else SETUP.slots[i] = { control: "ai", preset: sel.value.split("|")[1] };
		};
	});
	scr.querySelectorAll(".suRemove").forEach(function (b) {
		b.onclick = function () { SETUP.slots.splice(+b.dataset.i, 1); renderSetupScreen(); };
	});
	var w;
	if ((w = $id("suAdd"))) w.onclick = function () {
		SETUP.slots.push({ control: "ai", preset: "random" });
		renderSetupScreen();
	};
	if ((w = $id("suNpc"))) w.onchange = function () { SETUP.npcFill = this.checked; };
	if ((w = $id("suPick"))) w.onchange = function () { SETUP.startPick = this.checked; };
	if ((w = $id("suSeedRnd"))) w.onclick = function () {
		SETUP.seed = Math.floor(Math.random() * 1e9);
		$id("suSeed").value = SETUP.seed;
	};
	if ((w = $id("suSeed"))) w.onchange = function () { SETUP.seed = parseInt(this.value) || 12345; };
	if ((w = $id("suBack"))) w.onclick = hideSetupScreen;
	if ((w = $id("suStart"))) w.onclick = setupStartGame;
}

function setupStartGame() {
	SETUP.seed = parseInt($id("suSeed").value) || Math.floor(Math.random() * 1e9);
	GameConfig.setup.players = SETUP.slots.map(function (s) { return { control: s.control, preset: s.preset }; });
	GameConfig.setup.npcFill = SETUP.npcFill;
	GameConfig.setup.humanStartPick = SETUP.startPick;

	newGame(SETUP.seed);
	R.selectedUnit = null; R.selectedCity = null; R.selectedTile = -1; R.selectedRoute = null;
	R.routeCreateFrom = null;
	UI.dropMode = false; UI.roadTargetMode = null; UI.dealPick = null; UI.deal = null;
	R._fillsKey = ""; R.dirty = true;
	hideSetupScreen();

	if (G.pendingStarts && G.pendingStarts.length) {
		// zoom out so the whole world is on screen for the start pick
		R.view.lonC = 0; R.view.latC = 10;
		R.view.scale = Math.max(1.5, R.canvas.width / 400);
		setupPrepareStartPick();
	} else if (G.cities.length) {
		var h = UI.humanId();
		var me = h >= 0 ? G.players[h] : null;
		var cap = me && me.capital >= 0 ? G.cities[me.capital] : G.cities[0];
		R.view.lonC = M.latLon[cap.tile * 2 + 1];
		R.view.latC = M.latLon[cap.tile * 2];
	}
	UI.tab = "info";
	document.querySelectorAll("#tabs button").forEach(function (x) { x.classList.toggle("active", x.dataset.tab === "info"); });
	refreshUI();
}

// Compute recommended starting sites for the next picking player: the top
// scoring, well-separated tiles by a balanced site valuation.
function setupPrepareStartPick() {
	if (!G.pendingStarts || !G.pendingStarts.length) return;
	var pl = G.players[G.pendingStarts[0]];
	var scored = [];
	for (var i = 0; i < M.landTiles.length; i++) {
		var t = M.landTiles[i];
		if (startPickProblem(t)) continue;
		scored.push([aiSiteScore(pl, t), t]);
	}
	scored.sort(function (a, b) { return b[0] - a[0]; });
	var picks = [];
	for (var j = 0; j < scored.length && picks.length < 6; j++) {
		var t2 = scored[j][1];
		var clear = picks.every(function (p) { return M.distTiles(t2, p) >= GameConfig.setup.minStartDistance * 0.8; });
		if (clear) picks.push(t2);
	}
	G._recommendedStarts = picks;
	R.dirty = true;
}
