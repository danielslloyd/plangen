// trade.js — commodities, per-city supply/demand prices with transport costs,
// player-managed trade routes, tolls, subsidies, crop-knowledge diffusion, and
// pirate/bandit camps that grow on remote, high-traffic route segments.

// ---------------------------------------------------------------------------
// Supply & demand
// ---------------------------------------------------------------------------

function commodityById(id) {
	for (var i = 0; i < COMMODITIES.length; i++) if (COMMODITIES[i].id === id) return COMMODITIES[i];
	return null;
}

// What a city's worked tiles produce, knowledge-gated for crops/animals.
function citySupply(city) {
	var pl = G.players[city.owner];
	var s = {};
	COMMODITIES.forEach(function (cm) { s[cm.id] = 0; });
	city.worked.forEach(function (t) {
		COMMODITIES.forEach(function (cm) {
			if ((cm.kind === "crop" || cm.kind === "animal") && !pl.knowledge[cm.id]) return;
			var v = M.layer(cm.layer)[t];
			if (cm.id === "fish" && M.isLand(t)) v *= 0.5; // river fishing
			if (v > 0.03) s[cm.id] += v;
		});
	});
	return s;
}

function cityDemand(city) {
	var T = GameConfig.trade;
	var pl = G.players[city.owner];
	var d = {};
	var foodComms = COMMODITIES.filter(function (c) { return c.demandGroup === "food"; });
	COMMODITIES.forEach(function (cm) {
		var base = 0;
		if (cm.demandGroup === "food") base = city.pop * T.demandPerPop / Math.max(1, foodComms.length * 0.6);
		else if (cm.demandGroup === "material") base = city.pop * T.demandPerPop * 0.4;
		else if (cm.demandGroup === "mineral") base = city.pop * T.mineralDemandPerPop * (1 + pl.era * 0.5);
		else if (cm.demandGroup === "luxury") base = city.pop * T.luxuryDemandPerPop;
		d[cm.id] = base;
	});
	return d;
}

// price = base * clamp((demand / (supply + imports + softener))^elasticity)
function updateCityPrices(city) {
	var T = GameConfig.trade;
	city.supply = citySupply(city);
	city.demand = cityDemand(city);
	city.prices = {};
	COMMODITIES.forEach(function (cm) {
		var supply = city.supply[cm.id] + (city.flowIn[cm.id] || 0) - (city.flowOut[cm.id] || 0) * 0.5;
		var demand = city.demand[cm.id];
		var ratio = demand / Math.max(0.01, supply + T.supplySoftener);
		var mult = Math.pow(ratio, T.priceElasticity);
		mult = Math.max(T.priceMin, Math.min(T.priceMax, mult));
		city.prices[cm.id] = cm.basePrice * mult;
	});
}

// ---------------------------------------------------------------------------
// Trade pathfinding: amphibious, toll-aware, risk-aware
// ---------------------------------------------------------------------------

function tradeEdgeCost(a, b, routeOwner, destOwner) {
	var T = GameConfig.trade, mv = GameConfig.movement;
	var aw = M.isWater(a), bw = M.isWater(b);
	var c;
	if (aw && bw) c = mv.flatCost * T.seaMoveFactor;
	else if (!aw && !bw) {
		var ter = M.layer("terrain")[b];
		if (ter === M.T.glacier) return Infinity;
		c = ter === M.T.hills ? mv.hillsCost : ter === M.T.mountain ? mv.mountainCost : mv.flatCost;
		var e = M.edgeBetween(a, b);
		if (e >= 0) {
			if (M.edgeLayer("riverCross")[e] && G.roads[e] < 2) c += mv.riverNoBridgeCost * 0.5;
			if (G.roads[e] >= 1) c *= mv.roadFactor;
		}
	} else c = mv.flatCost + T.portCost;

	// Tolls: entering foreign territory (not the route owner's, not the
	// destination owner's own land) costs the toll rate of that owner.
	var ow = G.owner[b];
	if (ow >= 0 && ow !== routeOwner && ow !== destOwner) {
		c += G.players[ow].tollRate * 10; // toll expressed as pathing cost too
	}
	// Risk: camps near this tile scare merchants.
	if (G._campNear && G._campNear[b] > 0) c += G._campNear[b] * T.riskPremiumPerCamp;
	return c;
}

// Dijkstra from a city tile to another city tile over the amphibious graph.
function tradePathfind(fromTile, toTile, routeOwner, destOwner) {
	return dijkstraPath(fromTile, toTile, function (a, b) {
		return tradeEdgeCost(a, b, routeOwner, destOwner);
	}, null, GameConfig.trade.maxRouteLength);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

function cityRouteSlots(city) {
	var T = GameConfig.trade;
	return T.routesPerCity + (city.buildings.market ? T.marketExtraRoutes : 0);
}
function cityRouteCapacity(city) {
	var T = GameConfig.trade;
	return T.routeCapacity + (city.buildings.market ? T.marketCapacityBonus : 0);
}
function routesFrom(cityId) {
	return G.routes.filter(function (r) { return r.from === cityId; });
}

function createRoute(ownerPlayer, fromCityId, toCityId, pinnedCommodity) {
	if (fromCityId === toCityId) return null;
	var from = G.cities[fromCityId], to = G.cities[toCityId];
	if (!from || !to) return null;
	if (routesFrom(fromCityId).length >= cityRouteSlots(from)) return null;
	if (atWar(from.owner, to.owner)) return null;
	var pf = tradePathfind(from.tile, to.tile, ownerPlayer, to.owner);
	if (!pf) return null;
	var r = {
		id: G.nextId++,
		owner: ownerPlayer,
		from: fromCityId, to: toCityId,
		path: pf.path, pathCost: pf.cost,
		pinned: pinnedCommodity || null,
		commodity: null, lastFlow: 0, lastProfit: 0, lastLoss: 0, active: false,
		age: 0
	};
	G.routes.push(r);
	gameLog(G.players[ownerPlayer].name + ": route " + from.name + " → " + to.name);
	return r;
}

function removeRoute(r) {
	var i = G.routes.indexOf(r);
	if (i >= 0) G.routes.splice(i, 1);
}

// Tolls actually paid along a path (gold per unit of goods).
function pathTollPerUnit(path, routeOwner, destOwner) {
	var total = 0;
	for (var i = 1; i < path.length; i++) {
		var ow = G.owner[path[i]];
		if (ow >= 0 && ow !== routeOwner && ow !== destOwner) total += G.players[ow].tollRate;
	}
	return total;
}
function pathCamps(path) {
	var T = GameConfig.trade;
	var found = [];
	G.camps.forEach(function (camp) {
		for (var i = 0; i < path.length; i += 2) {
			if (M.distTiles(camp.tile, path[i]) <= T.campRaidRadius * 1.2) { found.push(camp); return; }
		}
	});
	return found;
}

// Margin per unit for commodity cm on route r (also used by the AI to choose
// routes, so decisions match execution).
function routeMargin(r, cmId) {
	var T = GameConfig.trade;
	var from = G.cities[r.from], to = G.cities[r.to];
	var subsidy = to.subsidies[cmId] || 0;
	var buy = from.prices[cmId], sell = to.prices[cmId] + subsidy;
	if (buy === undefined || sell === undefined) return -Infinity;
	// only export what the source actually produces or imports
	var avail = (from.supply[cmId] || 0) + (from.flowIn[cmId] || 0) * 0.5;
	if (avail < 0.5) return -Infinity;
	var transport = r.pathCost * T.transportCostPerMove;
	var tolls = pathTollPerUnit(r.path, r.owner, to.owner);
	var expectedLoss = Math.min(0.9, pathCamps(r.path).length * T.campLootFraction) * sell;
	return sell - buy - transport - tolls - expectedLoss;
}

function runRoute(r) {
	var T = GameConfig.trade;
	var from = G.cities[r.from], to = G.cities[r.to];
	r.age++;

	// re-path occasionally (roads built, tolls changed, camps moved)
	if (r.age % 5 === 1) {
		var pf = tradePathfind(from.tile, to.tile, r.owner, to.owner);
		if (pf) { r.path = pf.path; r.pathCost = pf.cost; }
	}

	// pick the commodity
	var bestCm = null, bestMargin = -Infinity;
	if (r.pinned) { bestCm = r.pinned; bestMargin = routeMargin(r, r.pinned); }
	else {
		COMMODITIES.forEach(function (cm) {
			var m2 = routeMargin(r, cm.id);
			if (m2 > bestMargin) { bestMargin = m2; bestCm = cm.id; }
		});
	}
	r.commodity = bestCm;
	if (bestMargin < T.minRouteMargin) { r.active = false; r.lastFlow = 0; r.lastProfit = 0; return; }
	r.active = true;

	var flow = Math.min(cityRouteCapacity(from), (from.supply[bestCm] || 0) + (from.flowIn[bestCm] || 0) * 0.5);
	r.lastFlow = flow;

	// ledger: goods move (affects next turn's prices)
	to.flowIn[bestCm] = (to.flowIn[bestCm] || 0) + flow;
	from.flowOut[bestCm] = (from.flowOut[bestCm] || 0) + flow;

	// money moves
	var cmDef = commodityById(bestCm);
	var owner = G.players[r.owner];
	var subsidy = to.subsidies[bestCm] || 0;
	var sell = to.prices[bestCm] + subsidy;
	var value = sell * flow;

	// tolls to territory owners
	for (var i = 1; i < r.path.length; i++) {
		var ow = G.owner[r.path[i]];
		if (ow >= 0 && ow !== r.owner && ow !== to.owner) {
			var toll = G.players[ow].tollRate * flow / Math.max(1, r.path.length / 8);
			G.players[ow].gold += toll;
			owner.gold -= toll;
		}
	}
	// subsidy paid by destination owner to the merchant
	if (subsidy > 0) {
		var subCost = subsidy * flow;
		G.players[to.owner].gold -= subCost;
	}

	// piracy: camps near the path raid the cargo
	var camps = pathCamps(r.path);
	var loss = 0;
	if (camps.length) {
		loss = Math.min(0.9, camps.length * T.campLootFraction) * value;
		camps.forEach(function (camp) {
			var share = loss / camps.length;
			camp.loot += share;
			camp.strength += T.campStrengthGrowth * (share / Math.max(1, value)) * 10;
		});
	}
	r.lastLoss = loss;

	var profit = bestMargin * flow; // margin already accounts for expected loss
	owner.gold += Math.max(0, profit);
	r.lastProfit = profit;

	// traffic memory feeds pirate spawning
	for (var j = 0; j < r.path.length; j++) G.traffic[r.path[j]] += flow * 0.5;

	// knowledge diffusion: destination owner (and the merchant) get familiar
	// with imported crops/animals they can't yet grow
	if (cmDef.kind === "crop" || cmDef.kind === "animal") {
		[G.players[to.owner], owner].forEach(function (pl) {
			if (pl.knowledge[bestCm]) return;
			pl.familiarity[bestCm] = (pl.familiarity[bestCm] || 0) + T.spreadPerTurn;
			if (pl.familiarity[bestCm] >= T.spreadThreshold) {
				pl.knowledge[bestCm] = true;
				gameLog(pl.name + " learns to produce " + bestCm + " (via trade)!");
			}
		});
	}
}

// ---------------------------------------------------------------------------
// Pirates & bandits
// ---------------------------------------------------------------------------

function updateCampProximity() {
	var T = GameConfig.trade;
	G._campNear = new Float32Array(M.n);
	G.camps.forEach(function (camp) {
		var dist = M.bfsDistance([camp.tile]);
		for (var t = 0; t < M.n; t++) {
			if (dist[t] >= 0 && dist[t] <= T.campRaidRadius) G._campNear[t]++;
		}
	});
}

function spawnCamps() {
	var T = GameConfig.trade;
	if (G.camps.length >= T.campMaxCount) return;

	// remoteness = hops from any owned territory
	var seeds = [];
	for (var t = 0; t < M.n; t++) if (G.owner[t] >= 0) seeds.push(t);
	if (!seeds.length) return;
	var remoteness = M.bfsDistance(seeds);

	for (t = 0; t < M.n; t++) {
		if (G.camps.length >= T.campMaxCount) break;
		if (G.traffic[t] < T.campSpawnTraffic) continue;
		if (remoteness[t] >= 0 && remoteness[t] < T.remoteDistance) continue;
		if (G.cityAt[t] >= 0 || G.campAt[t] >= 0) continue;
		if (G.rng() >= T.campSpawnChance) continue;

		// pirates live on land near the sea lane (so armies can clear them);
		// find a passable land tile within 2 hops of the hot tile
		var site = -1;
		if (M.isPassable(t)) site = t;
		else {
			var near = M.bfsDistance([t]);
			var bestD = 99;
			for (var x = 0; x < M.n; x++) {
				if (near[x] >= 0 && near[x] <= 2 && near[x] < bestD && M.isPassable(x) &&
					G.campAt[x] < 0 && G.cityAt[x] < 0 && G.owner[x] < 0) { site = x; bestD = near[x]; }
			}
		}
		if (site < 0) continue;
		// separation from other camps
		var tooClose = G.camps.some(function (c) { return M.distTiles(c.tile, site) < T.campMinSeparation; });
		if (tooClose) continue;

		var kind = M.isWater(t) ? "pirates" : "bandits";
		var camp = { id: G.nextId++, tile: site, kind: kind, strength: T.campStrengthBase, loot: 0, born: G.turn };
		G.camps.push(camp);
		G.campAt[site] = camp.id;
		gameLog((kind === "pirates" ? "A pirate haven" : "A bandit camp") + " appears on a trade route!");
	}
}

// ---------------------------------------------------------------------------
// The trade phase of every turn
// ---------------------------------------------------------------------------

function tradeTurn() {
	var T = GameConfig.trade;

	updateCampProximity();

	// prices from last turn's flows, then reset the ledger for this turn
	G.cities.forEach(function (city) {
		updateCityPrices(city);
	});
	G.cities.forEach(function (city) { city.flowIn = {}; city.flowOut = {}; });

	// run every route
	G.routes.slice().forEach(function (r) {
		var from = G.cities[r.from], to = G.cities[r.to];
		if (!from || !to || atWar(from.owner, to.owner)) { removeRoute(r); return; }
		runRoute(r);
	});

	// traffic decay + camp lifecycle
	for (var t = 0; t < M.n; t++) G.traffic[t] *= T.trafficDecay;
	spawnCamps();
}
