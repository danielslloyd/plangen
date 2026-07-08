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

var UNIT_TYPES = {
	settler: { name: "Settler", combat: false, icon: "⚑" },
	militia: { name: "Militia", combat: true, era: 0, icon: "⚔" },
	legion:  { name: "Legion",  combat: true, era: 1, icon: "✠" }
};
function unitCost(type) {
	var u = GameConfig.units;
	return type === "settler" ? u.settlerCost : type === "militia" ? u.militiaCost : u.legionCost;
}
function unitStrength(type) {
	var u = GameConfig.units;
	return type === "militia" ? u.militiaStrength : type === "legion" ? u.legionStrength : 0;
}

var ERA_NAMES = ["Ancient", "Classical", "Imperial"];

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
			score: 0
		});
	}

	placeStartingPositions(rng);
	G.players.forEach(function (pl) { initNativeKnowledge(pl); });
	recomputeTerritory();
	gameLog("New game: " + G.players.length + " players, map seed " + (M.meta.seed || "?"));
	return G;
}

function gameLog(msg) {
	G.log.push("[T" + G.turn + "] " + msg);
	if (G.log.length > GameConfig.ui.logLength) G.log.shift();
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
		var item = city.producing, cost = productionCost(item);
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

function productionCost(item) {
	var B = GameConfig.build;
	if (item === "settler") return unitCost("settler");
	if (item === "militia") return unitCost("militia");
	if (item === "legion") return unitCost("legion");
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
		spawnUnit(city.owner, item, city.tile);
		gameLog(city.name + " trains a " + UNIT_TYPES[item].name);
	}
	city.producing = null;
}

function availableProduction(city) {
	var pl = G.players[city.owner];
	var items = ["settler", "militia"];
	if (pl.era >= 1) items.push("legion");
	if (!city.buildings.walls) items.push("walls");
	if (!city.buildings.market) items.push("market");
	if (!city.buildings.granary) items.push("granary");
	return items;
}

// ---------------------------------------------------------------------------
// Units, movement, combat
// ---------------------------------------------------------------------------

function spawnUnit(owner, type, tile) {
	var u = { id: G.nextId++, owner: owner, type: type, tile: tile, hp: 100, moves: GameConfig.units.movePoints };
	G.units.push(u);
	return u;
}
function removeUnit(u) {
	var i = G.units.indexOf(u);
	if (i >= 0) G.units.splice(i, 1);
}
function unitsAt(tile) { return G.units.filter(function (u) { return u.tile === tile; }); }

// Movement cost for a LAND unit stepping from a->b (game rules, tunable).
function stepCost(a, b) {
	var mv = GameConfig.movement;
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

// Unit movement pathfinding (land only). Enemy-held tiles block pathing
// except as the final (attack) step.
function unitPathfind(start, goal, owner) {
	return dijkstraPath(start, goal, stepCost, function (t) {
		var us = unitsAt(t);
		if (us.length && us[0].owner !== owner) return true;
		if (G.campAt[t] >= 0) return true;
		return false;
	});
}

// Move a unit as far along the path to target as this turn's points allow.
// Attacks if the last reachable step is an enemy/camp/city tile.
function moveUnitTowards(u, target) {
	var pf = unitPathfind(u.tile, target, u.owner);
	if (!pf) return false;
	var path = pf.path;
	var fullMoves = GameConfig.units.movePoints;
	for (var i = 1; i < path.length; i++) {
		var next = path[i];
		var c = stepCost(u.tile, next);
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

		u.moves -= c;
		u.tile = next;
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

function attackUnit(att, def) {
	var strA = unitStrength(att.type) * (att.hp / 100 * 0.5 + 0.5);
	var strD = unitStrength(def.type) * (def.hp / 100 * 0.5 + 0.5) * combatModifiers(def.tile, att);
	if (strD <= 0) strD = 1; // settlers etc.
	def.hp -= combatDamage(strA, strD);
	att.hp -= combatDamage(strD, strA) * 0.7;
	if (def.hp <= 0) {
		var tile = def.tile;
		removeUnit(def);
		gameLog(G.players[att.owner].name + " destroys a " + UNIT_TYPES[def.type].name);
		if (att.hp > 0 && unitsAt(tile).length === 0 && G.cityAt[tile] < 0) att.tile = tile;
	}
	if (att.hp <= 0) removeUnit(att);
}

function attackCity(att, city) {
	var C = GameConfig.city;
	var strA = unitStrength(att.type) * (att.hp / 100 * 0.5 + 0.5);
	var strD = (C.cityBaseStrength + C.cityStrengthPerPop * city.pop) * combatModifiers(city.tile, att);
	var defUnits = unitsAt(city.tile).filter(function (x) { return x.owner === city.owner && unitStrength(x.type) > 0; });
	if (defUnits.length) { attackUnit(att, defUnits[0]); return; }
	city.hp -= combatDamage(strA, strD);
	att.hp -= combatDamage(strD, strA) * 0.5;
	if (att.hp <= 0) { removeUnit(att); return; }
	if (city.hp <= 0) captureCity(att.owner, city, att);
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
	var strA = unitStrength(att.type) * (att.hp / 100 * 0.5 + 0.5);
	var strD = camp.strength;
	camp.strength -= combatDamage(strA, strD) / 10;
	att.hp -= combatDamage(strD, strA) * 0.5;
	if (att.hp <= 0) { removeUnit(att); return; }
	if (camp.strength <= 0) {
		gameLog(G.players[att.owner].name + " clears a " + camp.kind + " camp (loot " + Math.round(camp.loot) + "g)");
		G.players[att.owner].gold += camp.loot;
		G.campAt[camp.tile] = -1;
		G.camps.splice(G.camps.indexOf(camp), 1);
		att.tile = camp.tile;
	}
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
// Eras & science
// ---------------------------------------------------------------------------

function updateEra(pl) {
	var T = GameConfig.tech;
	var newEra = pl.science >= T.imperialCost ? 2 : pl.science >= T.classicalCost ? 1 : 0;
	if (newEra > pl.era) {
		pl.era = newEra;
		gameLog(pl.name + " enters the " + ERA_NAMES[newEra] + " era!");
	}
}

// ---------------------------------------------------------------------------
// Turn driver
// ---------------------------------------------------------------------------

function endTurn() {
	if (G.winner !== null) return;
	G.turn++;

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

	// 5. Upkeep, healing, era, elimination
	G.players.forEach(function (pl) {
		if (!pl.alive) return;
		var myUnits = G.units.filter(function (u) { return u.owner === pl.id; });
		var upkeep = 0;
		myUnits.forEach(function (u) {
			upkeep += u.type === "settler" ? GameConfig.units.settlerMaintenance : GameConfig.units.unitMaintenance;
		});
		pl.gold -= upkeep;
		if (pl.gold < 0) {
			// disband to solvency
			var band = myUnits.filter(function (u) { return u.type !== "settler"; });
			if (band.length) { removeUnit(band[band.length - 1]); gameLog(pl.name + " disbands a unit (bankrupt)"); }
			pl.gold = 0;
		}
		myUnits.forEach(function (u) {
			u.moves = GameConfig.units.movePoints;
			if (G.owner[u.tile] === pl.id) u.hp = Math.min(100, u.hp + GameConfig.units.healPerTurnFriendly);
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
