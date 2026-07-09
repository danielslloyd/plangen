// engine.js — core game state and rules: players, cities (fortifying their
// surrounding edges), territory, yields, growth, production, roads/bridges,
// movement, combat, eras, victory. Trade lives in trade.js, AI in ai.js.

var G = null; // current game state

// Deterministic RNG (mulberry32) so a seed reproduces a whole game.
function makeRng(seed) {
	var s = seed >>> 0;
	return function () {
		s |= 0; s = s + 0x6D2B79F5 | 0;
		var t = Math.imul(s ^ s >>> 15, 1 | s);
		t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}

var PLAYER_COLORS = ["#e4572e", "#3d9be9", "#7ac74f", "#f2c14e", "#b56cd6", "#40c9a2", "#e05780", "#9a8c98"];
var CITY_NAMES = ["Ur", "Kish", "Thebes", "Argos", "Tyre", "Byblos", "Nineveh", "Susa", "Memphis", "Hattusa",
	"Mycenae", "Knossos", "Carthage", "Cumae", "Tanis", "Lagash", "Byzantion", "Sparta", "Veii", "Sidon",
	"Akkad", "Uruk", "Larsa", "Mari", "Ebla", "Ugarit", "Gordium", "Sardis", "Miletus", "Rhodes"];

// Unit roster. Each combat unit belongs to exactly ONE era (era transitions
// wipe the old roster — see updateEra). `domain` is land/sea/air. `needs`
// drives supply (food/turn, ammo/attack, fuel/move). `siege` units bombard
// (bonus vs cities, reduced counter-damage). `design` marks configurable
// ship/plane classes; `airbase` units carry aircraft.
var UNIT_TYPES = {
	settler:    { name: "Settler",         combat: false, era: -1, domain: "land", icon: "⚑", needs: { food: 0.5 } },
	// --- Classical ---
	militia:    { name: "Militia",         combat: true, era: 0, domain: "land", icon: "⚔", needs: { food: 1 } },
	legion:     { name: "Legion",          combat: true, era: 0, domain: "land", icon: "✠", needs: { food: 1.5 } },
	cavalry:    { name: "Cavalry",         combat: true, era: 0, domain: "land", icon: "♞", needs: { food: 1.5 } },
	trireme:    { name: "Trireme",         combat: true, era: 0, domain: "sea",  icon: "⛵", needs: { food: 1 } },
	// --- Napoleonic ---
	nInfantry:  { name: "Infantry",        combat: true, era: 1, domain: "land", icon: "♟", needs: { food: 1.5, ammo: 1 } },
	nCavalry:   { name: "Cavalry",         combat: true, era: 1, domain: "land", icon: "♞", needs: { food: 2, ammo: 0.5 } },
	artillery:  { name: "Artillery",       combat: true, era: 1, domain: "land", icon: "❂", needs: { food: 1.5, ammo: 1.5 }, siege: true },
	shipOfLine: { name: "Ship of the Line",combat: true, era: 1, domain: "sea",  icon: "⛵", needs: { food: 1, ammo: 1 }, design: "ship" },
	frigate:    { name: "Frigate",         combat: true, era: 1, domain: "sea",  icon: "⚓", needs: { food: 1, ammo: 1 }, design: "ship" },
	// --- WW2 ---
	wInfantry:  { name: "Infantry",        combat: true, era: 2, domain: "land", icon: "✚", needs: { food: 2, ammo: 1.5 }, trainable: true },
	wArtillery: { name: "Artillery",       combat: true, era: 2, domain: "land", icon: "❂", needs: { food: 2, ammo: 2 }, siege: true },
	armor:      { name: "Armor",           combat: true, era: 2, domain: "land", icon: "▣", needs: { food: 2, ammo: 2, fuel: 2 } },
	destroyer:  { name: "Destroyer",       combat: true, era: 2, domain: "sea",  icon: "♜", needs: { food: 2, ammo: 1.5, fuel: 2 }, design: "ship" },
	carrier:    { name: "Carrier",         combat: true, era: 2, domain: "sea",  icon: "⊞", needs: { food: 2, ammo: 1, fuel: 3 }, design: "carrier", airbase: true },
	fighter:    { name: "Fighter",         combat: true, era: 2, domain: "air",  icon: "✈", needs: { food: 1, ammo: 2, fuel: 3 }, design: "plane" },
	bomber:     { name: "Bomber",          combat: true, era: 2, domain: "air",  icon: "💣", needs: { food: 1, ammo: 3, fuel: 4 }, design: "plane" }
};

// Base (undesigned) stat lookups.
function unitBaseCost(type) {
	if (type === "settler") return GameConfig.units.settlerCost;
	var s = GameConfig.units.stats[type];
	return s ? s.cost : 50;
}
function unitBaseStrength(type) {
	var s = GameConfig.units.stats[type];
	return s ? s.str : 0;
}
function unitBaseMoves(type) {
	var s = GameConfig.units.stats[type];
	return s && s.moves ? s.moves : 1;
}
// Player-specific unit cost: applies the player's design (ships/planes) and a
// retooling penalty after a recent design change.
function unitCost(type, player) {
	var base = unitBaseCost(type);
	if (player && UNIT_TYPES[type] && UNIT_TYPES[type].design) {
		base *= designCostFactor(designOf(player, type));
		if (player.retool && player.retool[type] > 0) base *= 1 + GameConfig.design.retoolPenalty;
	}
	return Math.round(base);
}
// Undesigned strength (used for placement/AI estimates); per-unit strength is
// stamped at spawn (u.str) and read by effStrength.
function unitStrength(type) { return unitBaseStrength(type); }

// The needs of a specific unit (airborne training adds a fuel appetite).
function unitNeeds(u) {
	var needs = UNIT_TYPES[u.type].needs || {};
	if (u.training === "airborne" && !needs.fuel) {
		var n = {}; for (var k in needs) n[k] = needs[k]; n.fuel = 2; return n;
	}
	return needs;
}

// Per-turn movement budget for a spawned unit: air = 1 mission; land/sea use
// move points × the unit's (possibly designed) speed factor.
function unitMoveBudget(u) {
	var def = UNIT_TYPES[u.type];
	if (def.domain === "air") return 1;
	var mult = u.moveMult || unitBaseMoves(u.type);
	return Math.max(1, Math.round(GameConfig.units.movePoints * mult));
}

var ERA_NAMES = ["Classical", "Napoleonic", "WW2"];

var ERA_NAMES = ["Classical", "Napoleonic", "WW2"];

// ---------------------------------------------------------------------------
// Game creation
// ---------------------------------------------------------------------------

function newGame(seed) {
	var C = GameConfig;
	var rng = makeRng(seed || 12345);
	G = {
		seed: seed || 12345,
		rng: rng,
		turn: 0,
		players: [],
		cities: [],
		units: [],
		camps: [],
		routes: [],
		owner: new Int16Array(M.n).fill(-1),      // territory owner per tile
		ownerCity: new Int16Array(M.n).fill(-1),  // which city claims the tile
		cityAt: new Int16Array(M.n).fill(-1),
		campAt: new Int16Array(M.n).fill(-1),
		roads: new Uint8Array(M.nEdges),          // 0 none, 1 road, 2 road+bridge
		traffic: new Float32Array(M.n),
		annexed: {},                              // tile -> playerId (occupation/diplomacy overrides)
		occupation: {},                           // tile -> {by, turns} hostile occupation in progress
		tributes: [],                             // ongoing per-turn payments (diplomacy)
		offers: [],                               // pending deals awaiting the human player
		wars: {},                                 // "a|b" -> turnsAtWar
		log: [],
		nextId: 1,
		winner: null,
		usedNames: 0
	};

	for (var p = 0; p < C.setup.numPlayers; p++) {
		G.players.push({
			id: p,
			name: "Player " + (p + 1),
			color: PLAYER_COLORS[p % PLAYER_COLORS.length],
			isHuman: p === C.setup.humanPlayer,
			ai: makePersonality(p, rng),
			gold: C.setup.startGold,
			science: 0, era: 0,
			knowledge: {},      // commodityId -> true (can grow/raise it)
			familiarity: {},    // commodityId -> 0..1 progress toward learning
			tollRate: C.trade.tollDefault,
			alive: true,
			capital: -1,
			score: 0,
			designs: {},        // unitType -> { a, b } design attributes
			retool: {}          // unitType -> turns of production penalty left
		});
	}
	G.players.forEach(function (pl) { initDesigns(pl); });

	initReplay();
	placeStartingPositions(rng);
	G.players.forEach(function (pl) { initNativeKnowledge(pl); });
	recomputeTerritory();
	gameLog("New game: " + G.players.length + " players, map seed " + (M.meta.seed || "?"));
	return G;
}

function gameLog(msg) {
	G.log.push("[T" + G.turn + "] " + msg);
	if (G.log.length > GameConfig.ui.logLength) G.log.shift();
	if (G._turnEvents) G._turnEvents.push(msg); // structured replay log
}

function warKey(a, b) { return Math.min(a, b) + "|" + Math.max(a, b); }
function atWar(a, b) { return G.wars[warKey(a, b)] !== undefined; }
function declareWar(a, b) {
	if (a === b || atWar(a, b)) return;
	G.wars[warKey(a, b)] = 0;
	gameLog(G.players[a].name + " declares war on " + G.players[b].name + "!");
}
function makePeace(a, b) {
	delete G.wars[warKey(a, b)];
	gameLog(G.players[a].name + " and " + G.players[b].name + " make peace.");
}

// ---------------------------------------------------------------------------
// Start positions: personality-weighted site scores, spaced apart.
// ---------------------------------------------------------------------------

function placeStartingPositions(rng) {
	var C = GameConfig;
	var taken = [];
	var order = G.players.slice().sort(function () { return rng() - 0.5; });
	order.forEach(function (pl) {
		var best = -1, bestScore = -Infinity;
		for (var i = 0; i < M.landTiles.length; i++) {
			var t = M.landTiles[i];
			var ok = true;
			for (var j = 0; j < taken.length; j++) {
				if (M.distTiles(t, taken[j]) < C.setup.minStartDistance) { ok = false; break; }
			}
			if (!ok) continue;
			var s = aiSiteScore(pl, t) + rng() * 0.01;
			if (s > bestScore) { bestScore = s; best = t; }
		}
		if (best < 0) best = M.landTiles[Math.floor(rng() * M.landTiles.length)];
		taken.push(best);
		for (var k = 0; k < C.setup.startSettlers; k++) spawnUnit(pl.id, "settler", best);
		// Found the capital immediately so turn 1 isn't pure bookkeeping.
		var settler = G.units.find(function (u) { return u.owner === pl.id && u.type === "settler"; });
		foundCity(pl.id, best, settler);
	});
}

// Crops/animals native to the player's starting province (+ neighbours' averages).
function initNativeKnowledge(pl) {
	var C = GameConfig.trade;
	if (pl.capital < 0) return;
	var capTile = G.cities[pl.capital].tile;
	var provinceLayer = M.layer("province");
	var prov = provinceLayer[capTile];
	var sums = {}, count = 0;
	for (var t = 0; t < M.n; t++) {
		if (provinceLayer[t] !== prov || !M.isLand(t)) continue;
		count++;
		COMMODITIES.forEach(function (cm) {
			if (cm.kind !== "crop" && cm.kind !== "animal") return;
			sums[cm.id] = (sums[cm.id] || 0) + M.layer(cm.layer)[t];
		});
	}
	var bestId = null, bestAvg = 0;
	COMMODITIES.forEach(function (cm) {
		if (!(cm.id in sums)) return;
		var avg = count ? sums[cm.id] / count : 0;
		if (avg >= C.nativeThreshold) pl.knowledge[cm.id] = true;
		if (avg > bestAvg) { bestAvg = avg; bestId = cm.id; }
	});
	// Guarantee at least the province's best crop/animal.
	if (bestId) pl.knowledge[bestId] = true;
	gameLog(pl.name + " starts knowing: " + Object.keys(pl.knowledge).join(", "));
}

// ---------------------------------------------------------------------------
// Cities & territory
// ---------------------------------------------------------------------------

function foundCity(playerId, tile, settler) {
	if (!M.isPassable(tile) || G.cityAt[tile] >= 0) return null;
	if (nearestCityDistance(tile) < 3) return null;
	var pl = G.players[playerId];
	var city = {
		id: G.cities.length,
		tile: tile,
		owner: playerId,
		name: CITY_NAMES[G.usedNames++ % CITY_NAMES.length] + (G.usedNames > CITY_NAMES.length ? " " + Math.ceil(G.usedNames / CITY_NAMES.length) : ""),
		pop: 1,
		foodStore: 0,
		prodStore: 0,
		hp: GameConfig.city.cityMaxHP,
		buildings: {},
		producing: null,
		territory: [],
		worked: [],
		subsidies: {},   // commodityId -> per-unit subsidy
		prices: {}, supply: {}, demand: {}, flowIn: {}, flowOut: {},
		yields: { food: 0, prod: 0, gold: 0, sci: 0 }
	};
	G.cities.push(city);
	G.cityAt[tile] = city.id;
	if (pl.capital < 0) pl.capital = city.id;
	if (settler) removeUnit(settler);
	recomputeTerritory();
	gameLog(pl.name + " founds " + city.name);
	return city;
}

function nearestCityDistance(tile) {
	var best = Infinity;
	G.cities.forEach(function (c) {
		if (c.hp <= -1) return;
		var d = M.distTiles(tile, c.tile);
		if (d < best) best = d;
	});
	return best;
}

// Multi-source BFS: every tile within claimRadius of a city belongs to the
// nearest city (earlier city wins ties). Water is claimable (sea tolls).
function recomputeTerritory() {
	var C = GameConfig.city;
	G.owner.fill(-1); G.ownerCity.fill(-1);
	var dist = new Int32Array(M.n).fill(-1);
	var q = [], qi = 0;
	G.cities.forEach(function (c) {
		dist[c.tile] = 0;
		G.owner[c.tile] = c.owner;
		G.ownerCity[c.tile] = c.id;
		q.push(c.tile);
	});
	while (qi < q.length) {
		var cur = q[qi++];
		if (dist[cur] >= C.claimRadius) continue;
		var nb = M.neighbors[cur];
		for (var k = 0; k < nb.length; k++) {
			var t = nb[k];
			if (dist[t] !== -1) continue;
			dist[t] = dist[cur] + 1;
			G.owner[t] = G.owner[cur];
			G.ownerCity[t] = G.ownerCity[cur];
			q.push(t);
		}
	}
	// Annexation overrides (occupation flips, ceded territory): the tile belongs
	// to the annexing player and is administered by their nearest city.
	Object.keys(G.annexed).forEach(function (key) {
		var t = +key, pid = G.annexed[key];
		var pl = G.players[pid];
		var myCities = G.cities.filter(function (c) { return c.owner === pid; });
		if (!pl || !pl.alive || !myCities.length) { delete G.annexed[key]; return; }
		if (G.owner[t] === pid) { delete G.annexed[key]; return; } // natural claim now
		var bestC = myCities[0], bestD = Infinity;
		myCities.forEach(function (c) {
			var d = M.distTiles(t, c.tile);
			if (d < bestD) { bestD = d; bestC = c; }
		});
		G.owner[t] = pid;
		G.ownerCity[t] = bestC.id;
	});
	G.cities.forEach(function (c) { c.territory = []; });
	for (var t2 = 0; t2 < M.n; t2++) {
		if (G.ownerCity[t2] >= 0) G.cities[G.ownerCity[t2]].territory.push(t2);
	}
}

// ---------------------------------------------------------------------------
// Occupation: hostile combat units standing on enemy land slowly annex it.
// Progress decays when unguarded. City tiles flip only via capture.
// ---------------------------------------------------------------------------

function occupationTurn() {
	var C = GameConfig.territory;
	var held = {};
	var flipped = false;
	G.units.forEach(function (u) {
		if (!UNIT_TYPES[u.type].combat) return;
		var t = u.tile;
		var ow = G.owner[t];
		if (ow < 0 || ow === u.owner || !atWar(u.owner, ow)) return;
		if (G.cityAt[t] >= 0) return;
		if (held[t]) return; // one unit per tile counts
		held[t] = true;
		var oc = G.occupation[t];
		if (!oc || oc.by !== u.owner) oc = G.occupation[t] = { by: u.owner, turns: 0 };
		oc.turns++;
		if (oc.turns >= C.occupationTurnsToFlip) {
			G.annexed[t] = u.owner;
			delete G.occupation[t];
			gameLog(G.players[u.owner].name + " annexes a tile from " + G.players[ow].name);
			flipped = true;
		}
	});
	Object.keys(G.occupation).forEach(function (t) {
		if (held[t]) return;
		var oc = G.occupation[t];
		oc.turns -= C.occupationDecay;
		if (oc.turns <= 0) delete G.occupation[t];
	});
	if (flipped) recomputeTerritory();
}

// Food value of a tile for a given player: best food commodity they know how
// to exploit (crops/animals need knowledge; fish/gathering doesn't).
function tileFoodFor(pl, t) {
	var best = 0;
	for (var i = 0; i < COMMODITIES.length; i++) {
		var cm = COMMODITIES[i];
		if (cm.demandGroup !== "food") continue;
		if ((cm.kind === "crop" || cm.kind === "animal") && !pl.knowledge[cm.id]) continue;
		var s = M.layer(cm.layer)[t];
		if (s > best) best = s;
	}
	return best * GameConfig.yields.foodPerCalorie;
}

function tileProd(t) {
	var Y = GameConfig.yields;
	var ter = M.layer("terrain")[t];
	var p = M.isLand(t) ? Y.prodBase : 0;
	p += M.layer("timber")[t] * Y.prodTimber;
	p += (M.layer("iron")[t] + M.layer("copper")[t]) * Y.prodMinerals * 0.5;
	if (ter === M.T.hills || ter === M.T.mountain) p += Y.prodHills;
	return p;
}

function tileGold(t) {
	var Y = GameConfig.yields;
	var g = 0;
	if (M.layer("river")[t]) g += Y.goldRiver;
	if (M.layer("shore")[t] === 1) g += Y.goldCoast;
	g += (M.layer("gold")[t] + M.layer("silver")[t]) * 1.5;
	return g;
}

function updateWorkedTiles(city) {
	var C = GameConfig.city;
	var pl = G.players[city.owner];
	var cap = Math.min(city.territory.length, city.pop * C.tilesPerPop);
	var scored = city.territory.map(function (t) {
		var food = tileFoodFor(pl, t);
		if (M.isWater(t)) food = M.layer("fish")[t] * GameConfig.yields.foodPerCalorie;
		return { t: t, v: food * 1.5 + tileProd(t) + tileGold(t) };
	});
	scored.sort(function (a, b) { return b.v - a.v; });
	city.worked = scored.slice(0, cap).map(function (s) { return s.t; });
}

// ---------------------------------------------------------------------------
// Per-turn city economy
// ---------------------------------------------------------------------------

function cityEconomyTurn(city) {
	var C = GameConfig;
	var pl = G.players[city.owner];
	updateWorkedTiles(city);

	var food = 0, prod = 1, gold = 0;
	city.worked.forEach(function (t) {
		food += M.isWater(t) ? M.layer("fish")[t] * C.yields.foodPerCalorie : tileFoodFor(pl, t);
		prod += tileProd(t);
		gold += tileGold(t);
	});
	var sci = city.pop * C.yields.sciencePerPop + (pl.capital === city.id ? C.yields.scienceCapital : 0);

	// growth
	var eaten = city.pop * C.city.baseFoodPerPop;
	city.foodStore += food - eaten;
	var need = C.city.growthBase + C.city.growthPerPop * (city.pop - 1);
	if (city.foodStore >= need && city.pop < C.city.maxPop) {
		city.pop++;
		city.foodStore = city.buildings.granary ? need * 0.4 : 0;
		recomputeTerritory();
	} else if (city.foodStore < 0) {
		city.foodStore = 0;
		if (city.pop > 1 && G.rng() < 0.35) { city.pop--; gameLog(city.name + " starves."); }
	}

	// production
	if (city.producing) {
		city.prodStore += prod;
		var item = city.producing, cost = productionCost(item, city);
		if (city.prodStore >= cost) {
			city.prodStore -= cost;
			completeProduction(city, item);
		}
	} else {
		gold += prod * 0.25; // idle cities convert hammers to coin
	}

	pl.gold += gold;
	pl.science += sci;
	city.hp = Math.min(C.city.cityMaxHP, city.hp + C.city.cityHealPerTurn);
	city.yields = { food: food, prod: prod, gold: gold, sci: sci };
}

function productionCost(item, city) {
	var B = GameConfig.build;
	if (UNIT_TYPES[item]) return unitCost(item, city ? G.players[city.owner] : null);
	if (item === "walls") return B.wallsCost;
	if (item === "market") return B.marketCost;
	if (item === "granary") return B.granaryCost;
	return 50;
}

function completeProduction(city, item) {
	if (item === "walls" || item === "market" || item === "granary") {
		city.buildings[item] = true;
		gameLog(city.name + " completes " + item);
	} else {
		var u = spawnUnit(city.owner, item, city.tile);
		if (u) gameLog(city.name + " trains a " + UNIT_TYPES[item].name);
	}
	city.producing = null;
}

// Buildable items: only the CURRENT era's units (each era is a hard reset;
// see updateEra), sea units only in coastal cities, plus buildings and the
// era-agnostic settler.
function cityIsCoastal(city) { return adjacentWaterTile(city.tile) >= 0; }

function availableProduction(city) {
	var pl = G.players[city.owner];
	var items = ["settler"];
	var coastal = cityIsCoastal(city);
	Object.keys(UNIT_TYPES).forEach(function (t) {
		var def = UNIT_TYPES[t];
		if (!def.combat || def.era !== pl.era) return;
		if (def.domain === "sea" && !coastal) return;
		items.push(t);
	});
	if (!city.buildings.walls) items.push("walls");
	if (!city.buildings.market) items.push("market");
	if (!city.buildings.granary) items.push("granary");
	return items;
}

// ---------------------------------------------------------------------------
// Units, movement, combat
// ---------------------------------------------------------------------------

// Nearest water tile for launching ships (the tile itself if already water).
function adjacentWaterTile(tile) {
	if (M.isWater(tile)) return tile;
	var nb = M.neighbors[tile];
	for (var k = 0; k < nb.length; k++) if (M.isWater(nb[k])) return nb[k];
	return -1;
}

function spawnUnit(owner, type, tile) {
	var def = UNIT_TYPES[type];
	if (def.domain === "sea") {
		var w = adjacentWaterTile(tile);
		if (w < 0) return null;
		tile = w;
	}
	var pl = G.players[owner];
	var u = {
		id: G.nextId++, owner: owner, type: type, tile: tile, hp: 100,
		str: unitBaseStrength(type),          // designed strength stamped below
		moveMult: unitBaseMoves(type),        // designed speed factor
		strikeRange: GameConfig.air.strikeRange,
		base: def.domain === "air" ? G.cityAt[tile] : -1,  // air units live at a city/carrier
		training: null,                       // 'airborne' | 'amphibious' (WW2 infantry)
		landedTurns: 0,                       // opposed-landing disorganization timer
		stepsMoved: 0, attacksMade: 0,
		supply: { food: true, ammo: true, fuel: true },
		supplyDist: 0
	};
	// Apply the owner's design for configurable ship/plane classes.
	if (def.design) {
		var d = designOf(pl, type);
		if (def.design === "plane") {
			u.str = Math.round(u.str * d.b);          // firepower
			u.strikeRange = Math.round(GameConfig.air.strikeRange * d.a); // range
		} else if (def.design === "carrier") {
			u.moveMult = unitBaseMoves(type) * d.a;   // hull speed (airPower buffs planes elsewhere)
		} else { // ship
			u.str = Math.round(u.str * d.b);          // firepower
			u.moveMult = unitBaseMoves(type) * d.a;   // hull speed
		}
	}
	u.moves = unitMoveBudget(u);
	G.units.push(u);
	return u;
}
function removeUnit(u) {
	var i = G.units.indexOf(u);
	if (i >= 0) G.units.splice(i, 1);
}
function unitsAt(tile) { return G.units.filter(function (u) { return u.tile === tile; }); }

// Movement cost stepping a->b, by movement domain (game rules, tunable).
// Land units may traverse water (amphibious transport) at a high per-tile cost.
function stepCost(a, b, domain) {
	var mv = GameConfig.movement;
	if (domain === "sea") return M.isWater(b) ? mv.seaCost : Infinity;
	if (M.isWater(b)) return GameConfig.amphibious.transportCost; // land unit embarking / at sea
	if (!M.isPassable(b)) return Infinity;
	var ter = M.layer("terrain")[b];
	var c = mv.flatCost;
	if (ter === M.T.hills) c = mv.hillsCost;
	else if (ter === M.T.mountain) c = mv.mountainCost;
	if (ter === M.T.forest) c += mv.forestExtra;
	var e = M.edgeBetween(a, b);
	if (e >= 0) {
		if (M.edgeLayer("riverCross")[e] && G.roads[e] < 2) c += mv.riverNoBridgeCost;
		if (G.roads[e] >= 1) c *= mv.roadFactor;
	}
	return c;
}

// Unit movement pathfinding (land or sea domain). Enemy-held tiles block
// pathing except as the final (attack) step.
function unitPathfind(start, goal, owner, domain) {
	domain = domain || "land";
	return dijkstraPath(start, goal, function (a, b) { return stepCost(a, b, domain); }, function (t) {
		var us = unitsAt(t);
		if (us.length && us[0].owner !== owner) return true;
		if (G.campAt[t] >= 0) return true;
		return false;
	});
}

// Can this unit end up standing on tile t (after winning a fight there)?
// Land units may also sit on water (embarked on transports), where they are
// weak until they reach shore.
function unitCanOccupy(u, t) {
	var domain = UNIT_TYPES[u.type].domain;
	if (domain === "sea") return M.isWater(t);
	if (domain === "land") return M.isPassable(t) || M.isWater(t);
	return false;
}

// Move a unit as far along the path to target as this turn's points allow.
// Attacks if the last reachable step is an enemy/camp/city tile. Sea units
// aiming at a coastal land target sail to an adjacent water tile and
// bombard from there.
function moveUnitTowards(u, target) {
	var def = UNIT_TYPES[u.type];
	if (def.domain === "air") return false; // air units fly missions (airStrike/airRebase)

	var bombardTarget = -1;
	if (def.domain === "sea" && !M.isWater(target)) {
		bombardTarget = target;
		var w = -1, wd = Infinity;
		M.neighbors[target].forEach(function (n) {
			if (!M.isWater(n)) return;
			var d = M.distTiles(u.tile, n);
			if (d < wd) { wd = d; w = n; }
		});
		if (w < 0) return false; // landlocked target
		target = w;
	}

	var pf = unitPathfind(u.tile, target, u.owner, def.domain);
	if (!pf) return false;
	var path = pf.path;
	var fullMoves = unitMoveBudget(u);
	for (var i = 1; i < path.length; i++) {
		var next = path[i];
		var c = stepCost(u.tile, next, def.domain);
		// A unit with a full move budget may always take one step, even if the
		// step costs more than the budget (otherwise river-ringed capitals trap
		// their own units forever).
		if (u.moves < c && u.moves < fullMoves) break;
		if (c > u.moves) c = u.moves;

		// combat checks at destination tile
		var enemies = unitsAt(next).filter(function (x) { return x.owner !== u.owner && (atWar(u.owner, x.owner) || false); });
		var neutral = unitsAt(next).filter(function (x) { return x.owner !== u.owner; });
		var campId = G.campAt[next];
		var cityId = G.cityAt[next];
		var hostileCity = cityId >= 0 && G.cities[cityId].owner !== u.owner && atWar(u.owner, G.cities[cityId].owner);

		if (campId >= 0) { u.moves -= c; attackCamp(u, G.camps.find(function (cp) { return cp.id === campId; })); return true; }
		if (enemies.length) { u.moves -= c; attackUnit(u, enemies[0]); return true; }
		if (hostileCity) { u.moves -= c; attackCity(u, G.cities[cityId]); return true; }
		if (neutral.length || (cityId >= 0 && G.cities[cityId].owner !== u.owner)) break; // blocked, not at war

		// amphibious landing: a land unit coming ashore from the sea is
		// disorganized for a few turns unless trained for it.
		if (def.domain === "land" && M.isWater(u.tile) && !M.isWater(next) && u.training !== "amphibious") {
			u.landedTurns = GameConfig.amphibious.landingPenaltyTurns;
		}
		u.moves -= c;
		u.tile = next;
		u.stepsMoved++; // fuel consumption
	}

	// naval bombardment of the adjacent coastal target
	if (bombardTarget >= 0 && u.moves > 0 && M.neighbors[u.tile].indexOf(bombardTarget) >= 0) {
		var foes = unitsAt(bombardTarget).filter(function (x) { return x.owner !== u.owner && atWar(u.owner, x.owner); });
		var cid = G.cityAt[bombardTarget];
		var campId2 = G.campAt[bombardTarget];
		if (campId2 >= 0) attackCamp(u, G.camps.find(function (cp) { return cp.id === campId2; }));
		else if (foes.length) attackUnit(u, foes[0]);
		else if (cid >= 0 && atWar(u.owner, G.cities[cid].owner)) attackCity(u, G.cities[cid]);
	}
	return true;
}

function combatModifiers(defTile, attacker) {
	var C = GameConfig.combat, mult = 1;
	var ter = M.layer("terrain")[defTile];
	if (ter === M.T.hills) mult += C.terrainDefHills;
	else if (ter === M.T.forest) mult += C.terrainDefForest;
	else if (ter === M.T.mountain) mult += C.terrainDefMountain;
	// A city fortifies every edge around its tile: any attack into that tile
	// crosses a fortified edge.
	var cid = G.cityAt[defTile];
	if (cid >= 0) {
		var city = G.cities[cid];
		mult += GameConfig.city.fortifyDefenseBonus;
		if (city.buildings.walls) mult += GameConfig.city.wallsDefenseBonus;
	}
	return mult;
}

function combatDamage(strA, strD) {
	var C = GameConfig.combat;
	var base = C.damageBase * Math.exp((strA - strD) / C.strengthScale);
	var spread = 1 + (G.rng() * 2 - 1) * C.damageSpread;
	return Math.max(1, Math.round(base * spread));
}

// Effective strength: per-unit (designed) strength, health-scaled, reduced
// without ammunition, while embarked at sea, and while disorganized from a
// recent opposed landing.
function effStrength(u) {
	var A = GameConfig.amphibious;
	var s = (u.str || unitStrength(u.type)) * (u.hp / 100 * 0.5 + 0.5);
	var needs = unitNeeds(u);
	if (needs.ammo && u.supply && !u.supply.ammo) s *= GameConfig.supply.noAmmoPenalty;
	if (UNIT_TYPES[u.type].domain === "land" && M.isWater(u.tile)) s *= A.embarkedPenalty;
	if (u.landedTurns > 0) {
		// ramp from landingPenalty back to full over landingPenaltyTurns
		var frac = u.landedTurns / Math.max(1, A.landingPenaltyTurns);
		s *= A.landingPenalty + (1 - A.landingPenalty) * (1 - frac);
	}
	return s;
}

function attackUnit(att, def) {
	att.attacksMade++;
	var siege = UNIT_TYPES[att.type].siege;
	var strA = effStrength(att);
	var strD = effStrength(def) * combatModifiers(def.tile, att);
	if (strD <= 0) strD = 1; // settlers etc.
	def.hp -= combatDamage(strA, strD);
	// artillery bombards: it takes little counter-fire in the open
	att.hp -= combatDamage(strD, strA) * (siege ? GameConfig.combat.siegeCounterFactor : 0.7);
	if (def.hp <= 0) {
		var tile = def.tile;
		removeUnit(def);
		gameLog(G.players[att.owner].name + " destroys a " + UNIT_TYPES[def.type].name);
		if (att.hp > 0 && !siege && unitsAt(tile).length === 0 && G.cityAt[tile] < 0 && unitCanOccupy(att, tile)) att.tile = tile;
	}
	if (att.hp <= 0) removeUnit(att);
}

function attackCity(att, city) {
	var C = GameConfig.city;
	att.attacksMade++;
	var siege = UNIT_TYPES[att.type].siege;
	var strA = effStrength(att) * (siege ? GameConfig.combat.siegeCityBonus : 1);
	var strD = (C.cityBaseStrength + C.cityStrengthPerPop * city.pop) * combatModifiers(city.tile, att);
	var defUnits = unitsAt(city.tile).filter(function (x) { return x.owner === city.owner && unitStrength(x.type) > 0; });
	if (defUnits.length) { attackUnit(att, defUnits[0]); return; }
	city.hp -= combatDamage(strA, strD);
	att.hp -= combatDamage(strD, strA) * (siege ? GameConfig.combat.siegeCounterFactor : 0.5);
	if (att.hp <= 0) { removeUnit(att); return; }
	if (city.hp <= 0) {
		// only land forces can take a city; ships/artillery-only leave it at the brink
		if (UNIT_TYPES[att.type].domain === "land" && !siege && unitCanOccupy(att, city.tile)) captureCity(att.owner, city, att);
		else city.hp = 1;
	}
}

function captureCity(newOwner, city, unit) {
	var old = G.players[city.owner];
	gameLog(G.players[newOwner].name + " captures " + city.name + "!");
	city.owner = newOwner;
	city.hp = 25;
	city.pop = Math.max(1, Math.floor(city.pop * GameConfig.city.captureRazePop));
	city.producing = null;
	city.subsidies = {};
	if (unit) unit.tile = city.tile;
	// air units based here scramble to another friendly base or are lost
	G.units.slice().forEach(function (u) {
		if (UNIT_TYPES[u.type].domain !== "air" || u.base !== city.id || u.owner === newOwner) return;
		var alt = null, altD = Infinity;
		G.cities.forEach(function (c2) {
			if (c2.owner !== u.owner || c2.id === city.id) return;
			var d = M.distTiles(u.tile, c2.tile);
			if (d <= GameConfig.air.ferryRange && d < altD) { altD = d; alt = c2; }
		});
		if (alt) { u.base = alt.id; u.tile = alt.tile; }
		else { removeUnit(u); gameLog("Air unit lost with the fall of " + city.name); }
	});
	// routes touching the city break
	G.routes = G.routes.filter(function (r) { return r.from !== city.id && r.to !== city.id; });
	if (old.capital === city.id) {
		var remaining = G.cities.filter(function (c) { return c.owner === old.id; });
		if (!remaining.length) { old.alive = false; gameLog(old.name + " has been eliminated!"); }
		else old.capital = remaining[0].id;
	}
	recomputeTerritory();
}

function attackCamp(att, camp) {
	att.attacksMade++;
	var strA = effStrength(att);
	var strD = camp.strength;
	camp.strength -= combatDamage(strA, strD) / 10;
	att.hp -= combatDamage(strD, strA) * 0.5;
	if (att.hp <= 0) { removeUnit(att); return; }
	if (camp.strength <= 0) {
		gameLog(G.players[att.owner].name + " clears a " + camp.kind + " camp (loot " + Math.round(camp.loot) + "g)");
		G.players[att.owner].gold += camp.loot;
		G.campAt[camp.tile] = -1;
		G.camps.splice(G.camps.indexOf(camp), 1);
		if (unitCanOccupy(att, camp.tile)) att.tile = camp.tile;
	}
}

// ---------------------------------------------------------------------------
// Air missions: strike within range of the base, rebase between cities.
// One mission per turn (u.moves acts as the mission budget).
// ---------------------------------------------------------------------------

function airStrike(u, targetTile) {
	var A = GameConfig.air;
	var carrierBonus = carrierAirBonus(u);
	var range = (u.strikeRange || A.strikeRange) * carrierBonus;
	if (u.moves <= 0) return false;
	if (M.distTiles(u.tile, targetTile) > range) return false;

	// interception: an enemy fighter based in range of the target may engage
	var interceptor = null;
	for (var i = 0; i < G.units.length; i++) {
		var x = G.units[i];
		if (x.type === "fighter" && x.owner !== u.owner && atWar(u.owner, x.owner) &&
			M.distTiles(x.tile, targetTile) <= (x.strikeRange || A.strikeRange)) { interceptor = x; break; }
	}
	u.moves = 0;
	u.attacksMade++;
	if (interceptor && G.rng() < A.interceptChance) {
		gameLog(UNIT_TYPES[u.type].name + " intercepted by enemy fighters!");
		var strI = effStrength(interceptor), strU = effStrength(u);
		u.hp -= combatDamage(strI, strU);
		interceptor.hp -= combatDamage(strU, strI) * (u.type === "fighter" ? 1 : 0.4);
		if (interceptor.hp <= 0) removeUnit(interceptor);
		if (u.hp <= 0) { removeUnit(u); return true; }
		if (u.type === "bomber") return true; // bombers driven off by the dogfight
	}

	var strA = effStrength(u) * carrierBonus;
	var defended = false;
	var foes = unitsAt(targetTile).filter(function (x) { return x.owner !== u.owner && atWar(u.owner, x.owner); });
	var cid = G.cityAt[targetTile];
	var hostileCity = cid >= 0 && atWar(u.owner, G.cities[cid].owner);
	var campId = G.campAt[targetTile];

	if (foes.length) {
		defended = true;
		var def = foes.reduce(function (best, x) { return effStrength(x) > effStrength(best) ? x : best; });
		def.hp -= combatDamage(strA, effStrength(def) * 0.8);
		if (def.hp <= 0) { removeUnit(def); gameLog(G.players[u.owner].name + " air strike destroys a " + UNIT_TYPES[def.type].name); }
	} else if (hostileCity) {
		defended = true;
		var city = G.cities[cid];
		var mult = u.type === "bomber" ? A.bomberCityBonus : 1;
		var strD = GameConfig.city.cityBaseStrength + GameConfig.city.cityStrengthPerPop * city.pop;
		city.hp = Math.max(1, city.hp - combatDamage(strA * mult, strD)); // air can't capture
	} else if (campId >= 0) {
		var camp = G.camps.find(function (cp) { return cp.id === campId; });
		camp.strength -= combatDamage(strA, camp.strength) / 10;
		if (camp.strength <= 0) {
			gameLog(G.players[u.owner].name + " bombs out a " + camp.kind + " camp");
			G.campAt[camp.tile] = -1;
			G.camps.splice(G.camps.indexOf(camp), 1);
		}
	} else {
		return true; // nothing there; wasted sortie
	}
	if (defended) {
		u.hp -= A.aaDamage * (0.5 + G.rng());
		if (u.hp <= 0) { removeUnit(u); gameLog("A " + UNIT_TYPES[u.type].name + " is lost to flak."); }
	}
	return true;
}

function airRebase(u, cityId) {
	var city = G.cities[cityId];
	if (!city || city.owner !== u.owner) return false;
	if (M.distTiles(u.tile, city.tile) > GameConfig.air.ferryRange) return false;
	u.base = cityId;
	u.carrierId = null;
	u.tile = city.tile;
	u.moves = 0;
	return true;
}

// Rebase an air unit onto a friendly carrier (mobile airbase).
function airRebaseCarrier(u, carrier) {
	if (!carrier || carrier.owner !== u.owner || !UNIT_TYPES[carrier.type].airbase) return false;
	if (M.distTiles(u.tile, carrier.tile) > GameConfig.air.ferryRange) return false;
	u.base = -1;
	u.carrierId = carrier.id;
	u.tile = carrier.tile;
	u.moves = 0;
	return true;
}

// The plane-attribute multiplier a carrier confers on its embarked aircraft
// (carrier design "airPower").
function carrierAirBonus(u) {
	if (!u.carrierId) return 1;
	var c = G.units.find(function (x) { return x.id === u.carrierId; });
	if (!c) return 1;
	return designOf(G.players[c.owner], c.type).b;
}

// Keep carrier-based planes riding with their carrier; strand them if it sank.
function syncCarrierAircraft() {
	G.units.forEach(function (u) {
		if (!u.carrierId) return;
		var c = G.units.find(function (x) { return x.id === u.carrierId; });
		if (c) u.tile = c.tile; else u.carrierId = null;
	});
}

// Airborne paradrop: a trained WW2 infantry drops onto a tile within
// paradrop range, consuming fuel. Cannot drop onto enemy-occupied tiles or
// cities; lands adjacent and can attack next turn.
function airborneDrop(u, targetTile) {
	if (u.training !== "airborne" || u.moves <= 0) return false;
	if (M.distTiles(u.tile, targetTile) > GameConfig.amphibious.paradropRange) return false;
	if (!M.isPassable(targetTile)) return false;
	if (G.cityAt[targetTile] >= 0 && G.cities[G.cityAt[targetTile]].owner !== u.owner) return false;
	if (unitsAt(targetTile).some(function (x) { return x.owner !== u.owner; })) return false;
	u.tile = targetTile;
	u.moves = 0;
	u.stepsMoved += 4;       // the drop burns fuel
	u.landedTurns = 0;       // airborne troops are trained to land ready
	gameLog(G.players[u.owner].name + "'s airborne infantry drops behind the lines");
	return true;
}

// Train a WW2 infantry unit as airborne or amphibious (gold, once).
function trainUnit(u, kind) {
	if (!UNIT_TYPES[u.type].trainable) return false;
	if (u.training) return false;
	var pl = G.players[u.owner];
	var cost = kind === "airborne" ? GameConfig.amphibious.trainAirborneCost : GameConfig.amphibious.trainAmphibiousCost;
	if (pl.gold < cost) return false;
	pl.gold -= cost;
	u.training = kind;
	gameLog(pl.name + " trains " + kind + " infantry");
	return true;
}

// ---------------------------------------------------------------------------
// Roads & bridges (built with gold, on edges)
// ---------------------------------------------------------------------------

function edgeBuildCost(e) {
	var B = GameConfig.build;
	if (G.roads[e] >= 1) return 0;
	var needsBridge = M.edgeLayer("riverCross")[e] > 0;
	return B.roadCostGold + (needsBridge ? B.bridgeCostGold : 0);
}

function buildRoadOnEdge(playerId, e) {
	var pl = G.players[playerId];
	var cost = edgeBuildCost(e);
	if (cost <= 0) return false;
	if (M.edgeLayer("domain")[e] !== 1) return false; // land-land edges only
	if (pl.gold < cost) return false;
	pl.gold -= cost;
	G.roads[e] = M.edgeLayer("riverCross")[e] > 0 ? 2 : 1;
	return true;
}

// Build a road along a unit-path between two tiles; returns edges built.
function buildRoadPath(playerId, fromTile, toTile) {
	var pf = unitPathfind(fromTile, toTile, playerId);
	if (!pf) return 0;
	var built = 0;
	for (var i = 1; i < pf.path.length; i++) {
		var e = M.edgeBetween(pf.path[i - 1], pf.path[i]);
		if (e >= 0 && G.roads[e] === 0) {
			if (!buildRoadOnEdge(playerId, e)) break;
			built++;
		}
	}
	return built;
}

// ---------------------------------------------------------------------------
// Supply lines: every unit draws food (always), ammo (per attack made) and
// fuel (per movement) from the nearest friendly city. Delivery cost rises
// with supply-line length; lines can't run through enemy territory. Units
// out of range starve: attrition, no ammo, little fuel.
// ---------------------------------------------------------------------------

function supplyTurn(pl, myUnits) {
	var S = GameConfig.supply;
	var seeds = [];
	G.cities.forEach(function (c) { if (c.owner === pl.id) seeds.push(c.tile); });
	// Carriers are mobile supply bases for the fleet and its aircraft.
	myUnits.forEach(function (u) { if (UNIT_TYPES[u.type].airbase) seeds.push(u.tile); });
	var dist = null;
	if (seeds.length) {
		dist = M.bfsDistance(seeds, {
			domain: function (t) {
				var ow = G.owner[t];
				return !(ow >= 0 && ow !== pl.id && atWar(ow, pl.id));
			}
		});
	}
	var cost = 0;
	myUnits.forEach(function (u) {
		var needs = unitNeeds(u);
		var d = dist ? dist[u.tile] : -1;
		var reachable = d >= 0 && d <= S.maxRange;
		u.supplyDist = reachable ? d : -1;
		if (!reachable) {
			u.supply = {
				food: !needs.food, ammo: !needs.ammo, fuel: !needs.fuel
			};
			return;
		}
		var mult = 1 + d * S.perHop;
		if (needs.food) cost += needs.food * S.foodCost * mult;
		if (needs.ammo && u.attacksMade > 0) cost += needs.ammo * u.attacksMade * S.ammoCost * mult;
		if (needs.fuel && u.stepsMoved > 0) cost += needs.fuel * Math.min(1.5, u.stepsMoved / 4) * S.fuelCost * mult;
		u.supply = { food: true, ammo: true, fuel: true };
	});
	return cost;
}

// ---------------------------------------------------------------------------
// Eras & science
// ---------------------------------------------------------------------------

function updateEra(pl) {
	var T = GameConfig.tech;
	var newEra = pl.science >= T.ww2Cost ? 2 : pl.science >= T.napoleonicCost ? 1 : 0;
	if (newEra > pl.era) {
		pl.era = newEra;
		// A hard generational shift: the old army is obsolete and disbands, and
		// every city retools from scratch for the new era's units.
		var wiped = 0;
		G.units.slice().forEach(function (u) {
			if (u.owner === pl.id && UNIT_TYPES[u.type].combat) { removeUnit(u); wiped++; }
		});
		G.cities.forEach(function (c) {
			if (c.owner !== pl.id) return;
			c.producing = null;
			c.prodStore = 0;
		});
		pl.retool = {}; // fresh era, no legacy retooling penalties
		gameLog(pl.name + " enters the " + ERA_NAMES[newEra] + " era! (" + wiped +
			" obsolete units stand down; production resets)");
	}
}

// ---------------------------------------------------------------------------
// Turn driver
// ---------------------------------------------------------------------------

function endTurn() {
	if (G.winner !== null) return;
	G.turn++;

	// 0. Carrier-based aircraft ride with their carrier from last turn's moves
	syncCarrierAircraft();

	// 1. AI decisions (human already gave orders through the UI)
	G.players.forEach(function (pl) {
		if (pl.alive && !pl.isHuman) aiTakeTurn(pl);
	});

	// 2. Occupation: hostile units annex the ground they hold
	occupationTurn();

	// 3. Economy
	G.cities.forEach(function (city) {
		if (G.players[city.owner].alive) cityEconomyTurn(city);
	});

	// 4. Trade (prices, routes, tolls, subsidies, knowledge, pirates)
	tradeTurn();

	// 4b. Diplomacy bookkeeping: tribute payments, offer expiry
	diplomacyTurn();

	// 5. Upkeep + supply settlement, attrition, healing, era, elimination
	G.players.forEach(function (pl) {
		if (!pl.alive) return;
		var myUnits = G.units.filter(function (u) { return u.owner === pl.id; });
		var upkeep = 0;
		myUnits.forEach(function (u) {
			upkeep += u.type === "settler" ? GameConfig.units.settlerMaintenance : GameConfig.units.unitMaintenance;
		});
		upkeep += supplyTurn(pl, myUnits); // sets u.supply flags, returns delivery cost
		pl.gold -= upkeep;
		if (pl.gold < 0) {
			// disband to solvency
			var band = myUnits.filter(function (u) { return u.type !== "settler"; });
			if (band.length) { removeUnit(band[band.length - 1]); gameLog(pl.name + " disbands a unit (bankrupt)"); }
			pl.gold = 0;
		}
		myUnits.forEach(function (u) {
			if (G.units.indexOf(u) < 0) return; // disbanded above
			// starvation attrition for cut-off units
			if (!u.supply.food) {
				u.hp -= GameConfig.supply.attritionPerTurn;
				if (u.hp <= 0) {
					removeUnit(u);
					gameLog(pl.name + "'s " + UNIT_TYPES[u.type].name + " starves (out of supply)");
					return;
				}
			}
			// next turn's budget: air = 1 mission; no fuel = crawling pace
			var budget = unitMoveBudget(u);
			if (!u.supply.fuel) budget = Math.max(1, Math.round(budget * GameConfig.supply.noFuelPenalty));
			u.moves = budget;
			u.stepsMoved = 0;
			u.attacksMade = 0;
			if (u.landedTurns > 0) u.landedTurns--; // amphibious disorganization fades
			if (G.owner[u.tile] === pl.id && u.supply.food) {
				u.hp = Math.min(100, u.hp + GameConfig.units.healPerTurnFriendly);
			}
		});
		// design retooling penalty ages off
		Object.keys(pl.retool).forEach(function (k) {
			if (--pl.retool[k] <= 0) delete pl.retool[k];
		});
		updateEra(pl);
		pl.score = computeScore(pl);
	});

	// wars age; auto-peace after long stalemates
	Object.keys(G.wars).forEach(function (k) {
		G.wars[k]++;
		if (G.wars[k] > 40) {
			var ab = k.split("|");
			makePeace(+ab[0], +ab[1]);
		}
	});

	checkVictory();
	recordTurnLog();
}

function computeScore(pl) {
	var s = pl.science * 0.1 + pl.gold * 0.05;
	G.cities.forEach(function (c) { if (c.owner === pl.id) s += 10 + c.pop * 2; });
	s += Object.keys(pl.knowledge).length * 5;
	return Math.round(s);
}

function checkVictory() {
	var alive = G.players.filter(function (p) { return p.alive; });
	if (alive.length === 1) {
		G.winner = alive[0].id;
		gameLog("*** " + alive[0].name + " wins by conquest! ***");
		return;
	}
	if (G.turn >= GameConfig.setup.maxTurns) {
		var best = alive.slice().sort(function (a, b) { return b.score - a.score; })[0];
		G.winner = best.id;
		gameLog("*** Turn limit: " + best.name + " wins on score (" + best.score + ") ***");
	}
}
