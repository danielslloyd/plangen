// gamelog.js — structured turn-by-turn replay log: per-player snapshots, AI
// goals/priorities (recorded via aiLogGoal in ai.js/diplomacy.js), and the
// human-readable events of each turn. Exportable as JSON so games can be
// analyzed offline and used to tune/improve the AI.

function initReplay() {
	G.replay = {
		format: "plangen-game-log",
		version: 1,
		seed: G.seed,
		mapMeta: M.meta,
		startedAt: new Date().toISOString(),
		personalities: G.players.map(function (pl) {
			var w = {};
			for (var k in pl.ai) if (typeof pl.ai[k] === "number") w[k] = +pl.ai[k].toFixed(3);
			return { id: pl.id, name: pl.name, preset: pl.ai.preset, weights: w };
		}),
		config: JSON.parse(JSON.stringify(GameConfig)),
		turns: []
	};
	G._aiGoals = [];
	G._turnEvents = [];
}

// Snapshot of everything that describes the game state this turn.
function recordTurnLog() {
	if (!G.replay) return;

	// tiles owned per player
	var tilesOwned = {};
	for (var t = 0; t < M.n; t++) {
		var ow = G.owner[t];
		if (ow >= 0) tilesOwned[ow] = (tilesOwned[ow] || 0) + 1;
	}

	var entry = {
		turn: G.turn,
		players: G.players.map(function (pl) {
			var units = {}, pop = 0;
			G.units.forEach(function (u) { if (u.owner === pl.id) units[u.type] = (units[u.type] || 0) + 1; });
			G.cities.forEach(function (c) { if (c.owner === pl.id) pop += c.pop; });
			return {
				id: pl.id,
				alive: pl.alive,
				gold: Math.round(pl.gold),
				science: Math.round(pl.science),
				era: pl.era,
				score: pl.score,
				power: Math.round(playerPower(pl.id)),
				cities: G.cities.filter(function (c) { return c.owner === pl.id; }).length,
				pop: pop,
				tiles: tilesOwned[pl.id] || 0,
				units: units,
				routes: G.routes.filter(function (r) { return r.owner === pl.id; }).length,
				knowledge: Object.keys(pl.knowledge),
				tollRate: +pl.tollRate.toFixed(2)
			};
		}),
		goals: G._aiGoals || [],
		events: G._turnEvents || [],
		wars: Object.keys(G.wars),
		tributes: G.tributes.map(function (tr) { return { from: tr.from, to: tr.to, amount: tr.amount, turnsLeft: tr.turnsLeft }; }),
		contested: Object.keys(G.occupation).length,
		camps: G.camps.length
	};
	G.replay.turns.push(entry);
	G._aiGoals = [];
	G._turnEvents = [];
}

function downloadGameLog() {
	if (!G.replay) return;
	G.replay.endedAt = new Date().toISOString();
	G.replay.winner = G.winner;
	var blob = new Blob([JSON.stringify(G.replay)], { type: "application/json" });
	var a = document.createElement("a");
	a.href = URL.createObjectURL(blob);
	a.download = "plangen-gamelog-seed" + G.seed + "-t" + G.turn + ".json";
	document.body.appendChild(a);
	a.click();
	setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 100);
	gameLog("Game log downloaded (" + G.replay.turns.length + " turns).");
}
