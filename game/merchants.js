// merchants.js — concrete trade (features.merchants): cities spawn merchant
// CARAVANS (population + livestock + gold) and coastal cities build merchant
// FLEETS (population + timber + gold). Each merchant autonomously plans a
// round trip from remembered price histories (an EMA per city x commodity),
// buys low, hauls cargo along a real path, sells high, buys a backhaul, and
// banks the trip profit into its home city's wealth — which feeds growth.
//
// Tolling (merchant.tollMode): 0 = per-tile toll GATES the owner places on
// individual tiles (charged per passage), 1 = a territory-wide ENTRANCE FEE
// charged once per trip on first entry. Both scale off the owner's toll-rate
// slider and are priced into merchant route planning.

// ---------------------------------------------------------------------------
// State & spawning
// ---------------------------------------------------------------------------

function initMerchants() {
	G.merchants = [];
	G.tollGates = new Uint8Array(M.n); // 1 = gated (owner = tile owner)
	G.priceMem = {};                   // cityId -> { cmId: EMA price }
}

function merchantsFrom(cityId) {
	return G.merchants.filter(function (m) { return m.home === cityId; });
}

function cityMerchantSlots(city) {
	var slots = GameConfig.merchant.maxPerCity;
	if (GameConfig.features.policies) {
		slots += Math.floor(GameConfig.policy.openRouteSlots * (G.players[city.owner].policies.openness || 0) * 0.5);
	}
	if (puHas(G.players[city.owner], "silkRoads")) slots += 1;
	return slots;
}

// Spawn a merchant from a city. Returns null on success or a reason string.
function spawnMerchant(cityId, kind) {
	var MC = GameConfig.merchant;
	var city = G.cities[cityId];
	if (!city) return "No city.";
	var pl = G.players[city.owner];
	if (merchantsFrom(cityId).length >= cityMerchantSlots(city)) return "No merchant slots left here.";
	var goldCost = kind === "fleet" ? MC.fleetGoldCost : MC.caravanGoldCost;
	var popCost = kind === "fleet" ? MC.fleetPopCost : MC.caravanPopCost;
	if (kind === "fleet") {
		if (!cityIsCoastal(city)) return "Fleets need a coastal city.";
		if ((city.supply.timber || 0) < MC.fleetNeedsTimber) return "Not enough timber here to build ships.";
	} else {
		if ((city.supply.livestock || 0) < MC.caravanNeedsLivestock) return "No horses or camels here (needs livestock).";
	}
	if (pl.gold < goldCost) return "Need " + goldCost + " gold.";
	if (city.pop <= popCost) return "Need population to spare (pop ≥ " + (popCost + 1) + ").";
	pl.gold -= goldCost;
	city.pop -= popCost;
	var m = {
		id: G.nextId++,
		owner: city.owner,
		home: cityId,
		kind: kind,
		tile: city.tile,
		state: "idle",       // idle | outbound | returning
		plan: null,          // { to, outCm, backCm, path, backPath, expected }
		pathIdx: 0,
		cargo: null,         // { cm, qty, cost }
		tollsPaid: 0,
		spent: 0, earned: 0, // running trip ledger
		enteredTerritories: {},
		lastProfit: 0,
		trips: 0,
		idleTurns: 0
	};
	G.merchants.push(m);
	gameLog(pl.name + (kind === "fleet" ? " launches a merchant fleet from " : " outfits a caravan in ") + city.name);
	return null;
}

function removeMerchant(m) {
	var i = G.merchants.indexOf(m);
	if (i >= 0) G.merchants.splice(i, 1);
}

// ---------------------------------------------------------------------------
// Price memory: every merchant "knows" the recent price history of all cities
// as an exponential moving average, updated once per turn.
// ---------------------------------------------------------------------------

function updatePriceMemory() {
	var a = GameConfig.merchant.priceMemAlpha;
	G.cities.forEach(function (c) {
		var mem = G.priceMem[c.id] = G.priceMem[c.id] || {};
		COMMODITIES.forEach(function (cm) {
			var p = c.prices[cm.id];
			if (p === undefined) return;
			mem[cm.id] = mem[cm.id] === undefined ? p : mem[cm.id] * (1 - a) + p * a;
		});
	});
}

function memPrice(cityId, cmId) {
	var mem = G.priceMem[cityId];
	return mem && mem[cmId] !== undefined ? mem[cmId] : null;
}

// ---------------------------------------------------------------------------
// Merchant pathfinding: caravans travel over land, fleets over water (between
// coastal cities). Costs include expected tolls so merchants route around
// greedy toll-setters, in either toll mode.
// ---------------------------------------------------------------------------

function merchantEdgeCost(a, b, kind, merchantOwner, destOwner) {
	var mv = GameConfig.movement, MC = GameConfig.merchant;
	var bw = M.isWater(b);
	var c;
	if (kind === "fleet") {
		if (!bw) return Infinity; // fleets stay at sea (endpoints handled via coastal water tiles)
		c = mv.flatCost * GameConfig.trade.seaMoveFactor;
	} else {
		if (bw) return Infinity;  // caravans stay ashore
		var ter = M.layer("terrain")[b];
		if (ter === M.T.glacier) return Infinity;
		c = ter === M.T.hills ? mv.hillsCost : ter === M.T.mountain ? mv.mountainCost : mv.flatCost;
		var e = M.edgeBetween(a, b);
		if (e >= 0) {
			if (M.edgeLayer("riverCross")[e] && G.roads[e] < 2) c += mv.riverNoBridgeCost * 0.5;
			if (G.roads[e] >= 1) c *= mv.roadFactor;
		}
	}
	// expected tolls as pathing cost
	var ow = G.owner[b];
	if (ow >= 0 && ow !== merchantOwner && ow !== destOwner) {
		if (MC.tollMode === 0) {
			if (G.tollGates[b]) c += G.players[ow].tollRate * MC.gateScale * 3;
		} else {
			c += G.players[ow].tollRate * 1.5; // spread the entrance fee over the crossing
		}
	}
	if (G._campNear && G._campNear[b] > 0) c += G._campNear[b] * GameConfig.trade.riskPremiumPerCamp;
	return c;
}

// Path between two cities for a merchant kind; fleets path between adjacent
// water tiles of the two (coastal) cities.
function merchantPathfind(fromCity, toCity, kind, merchantOwner) {
	var a = fromCity.tile, b = toCity.tile;
	if (kind === "fleet") {
		a = adjacentWaterTile(a); b = adjacentWaterTile(b);
		if (a < 0 || b < 0) return null;
	}
	return dijkstraPath(a, b, function (x, y) {
		return merchantEdgeCost(x, y, kind, merchantOwner, toCity.owner);
	}, null, GameConfig.trade.maxRouteLength);
}

// ---------------------------------------------------------------------------
// Trip planning: expected return of the best round trip from home.
// ---------------------------------------------------------------------------

function planMerchantTrip(m) {
	var MC = GameConfig.merchant;
	var home = G.cities[m.home];
	if (!home) { removeMerchant(m); return; }
	var cap = merchantCapacity(m);
	var best = null;

	G.cities.forEach(function (dest) {
		if (dest.id === home.id || atWar(m.owner, dest.owner)) return;
		if (m.kind === "fleet" && !cityIsCoastal(dest)) return;

		// best commodity to carry out (home must actually produce it)
		var outCm = null, outMargin = 0;
		var backCm = null, backMargin = 0;
		COMMODITIES.forEach(function (cm) {
			var ph = memPrice(home.id, cm.id), pd = memPrice(dest.id, cm.id);
			if (ph === null || pd === null) return;
			if ((home.supply[cm.id] || 0) > 0.5 && pd - ph > outMargin) { outMargin = pd - ph; outCm = cm.id; }
			if ((dest.supply[cm.id] || 0) > 0.5 && ph - pd > backMargin) { backMargin = ph - pd; backCm = cm.id; }
		});
		if (!outCm && !backCm) return;

		var pf = merchantPathfind(home, dest, m.kind, m.owner);
		if (!pf) return;
		var transport = pf.cost * 2 * GameConfig.trade.transportCostPerMove * cap;
		var expected = (outMargin + backMargin) * cap - transport - merchantExpectedTolls(pf.path, m, dest.owner);
		if (!best || expected > best.expected) {
			best = { to: dest.id, outCm: outCm, backCm: backCm, path: pf.path, expected: expected };
		}
	});

	if (best && best.expected >= MC.minExpectedReturn) {
		m.plan = best;
		m.state = "outbound";
		m.pathIdx = 0;
		m.tollsPaid = 0; m.spent = 0; m.earned = 0;
		m.enteredTerritories = {};
		m.tile = best.path[0];
		// buy the outbound cargo at home (registers on the price ledger)
		if (best.outCm) {
			var qty = Math.min(cap, (home.supply[best.outCm] || 0) + (home.flowIn[best.outCm] || 0));
			var price = home.prices[best.outCm] || memPrice(home.id, best.outCm) || 1;
			m.cargo = { cm: best.outCm, qty: qty, cost: price * qty };
			m.spent += price * qty;
			home.flowOut[best.outCm] = (home.flowOut[best.outCm] || 0) + qty;
		} else {
			m.cargo = null; // deadhead out, haul back
		}
		m.idleTurns = 0;
	} else {
		m.idleTurns++;
	}
}

function merchantCapacity(m) {
	var MC = GameConfig.merchant;
	var cap = m.kind === "fleet" ? MC.fleetCapacity : MC.caravanCapacity;
	var pl = G.players[m.owner];
	if (m.kind === "fleet" && puHas(pl, "navigators")) cap *= 1.5;
	if (m.kind === "caravan" && puHas(pl, "caravanserai")) cap *= 1.5;
	return Math.round(cap);
}

function merchantSpeed(m) {
	var MC = GameConfig.merchant;
	var s = m.kind === "fleet" ? MC.fleetSpeed : MC.caravanSpeed;
	var pl = G.players[m.owner];
	if (m.kind === "fleet" && puHas(pl, "navigators")) s *= 1.25;
	if (m.kind === "caravan" && puHas(pl, "caravanserai")) s *= 1.25;
	return s;
}

// Expected toll bill for a round trip along path (both modes).
function merchantExpectedTolls(path, m, destOwner) {
	var MC = GameConfig.merchant;
	var total = 0, seen = {};
	for (var i = 1; i < path.length; i++) {
		var ow = G.owner[path[i]];
		if (ow < 0 || ow === m.owner || ow === destOwner) continue;
		if (MC.tollMode === 0) {
			if (G.tollGates[path[i]]) total += G.players[ow].tollRate * MC.gateScale;
		} else if (!seen[ow]) {
			seen[ow] = true;
			total += G.players[ow].tollRate * MC.entranceFeeScale;
		}
	}
	return total * 2; // out and back
}

// ---------------------------------------------------------------------------
// Movement & trading
// ---------------------------------------------------------------------------

// Toll charged as the merchant steps onto tile t. Returns gold paid.
function merchantPayTolls(m, t) {
	var MC = GameConfig.merchant;
	var ow = G.owner[t];
	if (ow < 0 || ow === m.owner) return 0;
	var destCity = m.plan && G.cities[m.plan.to];
	if (destCity && ow === destCity.owner) return 0; // hosts don't toll their customers
	var owner = G.players[ow];
	var fee = 0;
	if (MC.tollMode === 0) {
		if (G.tollGates[t]) fee = owner.tollRate * MC.gateScale;
	} else {
		if (!m.enteredTerritories[ow]) {
			m.enteredTerritories[ow] = true;
			fee = owner.tollRate * MC.entranceFeeScale;
		}
	}
	if (fee > 0) {
		if (puHas(owner, "tollHouses")) fee *= 1.5;
		owner.gold += fee;
		m.tollsPaid += fee;
	}
	return fee;
}

// Camps raid passing cargo (once per camp per leg).
function merchantRaidCheck(m) {
	if (!m.cargo || !G._campNear || G._campNear[m.tile] <= 0) return;
	var T = GameConfig.trade;
	G.camps.forEach(function (camp) {
		if (M.distTiles(camp.tile, m.tile) > T.campRaidRadius) return;
		var key = "raid" + camp.id;
		if (m[key]) return;
		m[key] = true;
		var lost = m.cargo.qty * T.campLootFraction;
		m.cargo.qty -= lost;
		var value = lost * (memPrice(m.plan ? m.plan.to : m.home, m.cargo.cm) || 1);
		camp.loot += value;
		camp.strength += T.campStrengthGrowth * 2;
		if (m.owner === GameConfig.setup.humanPlayer) {
			gameLog("Your " + m.kind + " is raided near a " + camp.kind + " camp!");
		}
	});
}

function merchantStep(m) {
	if (!m.plan) return;
	var budget = merchantSpeed(m);
	var path = m.plan.path;
	var dir = m.state === "outbound" ? 1 : -1;
	while (budget > 0) {
		var next = m.pathIdx + dir;
		if (next < 0 || next >= path.length) break;
		var c = merchantEdgeCost(path[m.pathIdx], path[next], m.kind, m.owner,
			G.cities[m.plan.to] ? G.cities[m.plan.to].owner : -1);
		if (!isFinite(c)) { merchantAbort(m); return; }
		if (c > budget) break;
		budget -= c;
		m.pathIdx = next;
		m.tile = path[next];
		merchantPayTolls(m, m.tile);
		merchantRaidCheck(m);
	}
	// arrivals
	if (m.state === "outbound" && m.pathIdx === path.length - 1) merchantArriveDest(m);
	else if (m.state === "returning" && m.pathIdx === 0) merchantArriveHome(m);
}

function merchantArriveDest(m) {
	var dest = G.cities[m.plan.to];
	var home = G.cities[m.home];
	if (!dest || !home) { merchantAbort(m); return; }
	// sell the outbound cargo at today's price (+ any subsidy)
	if (m.cargo && m.cargo.qty > 0) {
		var cm = m.cargo.cm;
		var price = (dest.prices[cm] || 1) + (dest.subsidies[cm] || 0);
		m.earned += price * m.cargo.qty;
		dest.flowIn[cm] = (dest.flowIn[cm] || 0) + m.cargo.qty;
		if ((dest.subsidies[cm] || 0) > 0) G.players[dest.owner].gold -= dest.subsidies[cm] * m.cargo.qty;
	}
	m.cargo = null;
	// buy the backhaul
	var backCm = m.plan.backCm;
	if (backCm && (dest.supply[backCm] || 0) > 0.5) {
		var cap = merchantCapacity(m);
		var qty = Math.min(cap, (dest.supply[backCm] || 0) + (dest.flowIn[backCm] || 0));
		var bPrice = dest.prices[backCm] || 1;
		m.cargo = { cm: backCm, qty: qty, cost: bPrice * qty };
		m.spent += bPrice * qty;
		dest.flowOut[backCm] = (dest.flowOut[backCm] || 0) + qty;
	}
	// clear per-leg raid markers, head home
	Object.keys(m).forEach(function (k) { if (k.indexOf("raid") === 0) delete m[k]; });
	m.enteredTerritories = {};
	m.state = "returning";
}

function merchantArriveHome(m) {
	var home = G.cities[m.home];
	if (!home) { merchantAbort(m); return; }
	if (m.cargo && m.cargo.qty > 0) {
		var cm = m.cargo.cm;
		var price = (home.prices[cm] || 1) + (home.subsidies[cm] || 0);
		m.earned += price * m.cargo.qty;
		home.flowIn[cm] = (home.flowIn[cm] || 0) + m.cargo.qty;
	}
	m.cargo = null;
	var profit = m.earned - m.spent - m.tollsPaid;
	m.lastProfit = profit;
	m.trips++;
	// trade surplus enriches the CITY (wealth drives growth — see
	// cityEconomyTurn), not the national treasury directly.
	home.wealth = Math.max(0, (home.wealth || 0) + profit);
	if (profit > 0 && m.owner === GameConfig.setup.humanPlayer && m.trips <= 3) {
		gameLog(home.name + "'s " + m.kind + " returns: +" + profit.toFixed(1) + "g to the city");
	}
	m.plan = null;
	m.state = "idle";
	m.tile = home.tile;
}

function merchantAbort(m) {
	// dump cargo, walk home free of charge (abstracted)
	m.cargo = null;
	m.plan = null;
	m.state = "idle";
	m.tile = G.cities[m.home] ? G.cities[m.home].tile : m.tile;
}

// ---------------------------------------------------------------------------
// Per-turn driver + AI spawning
// ---------------------------------------------------------------------------

function merchantsTurn() {
	if (!GameConfig.features.merchants) return;
	updatePriceMemory();

	G.merchants.slice().forEach(function (m) {
		var home = G.cities[m.home];
		if (!home || home.owner !== m.owner) { removeMerchant(m); return; } // home lost
		if (m.plan && atWar(m.owner, G.cities[m.plan.to] ? G.cities[m.plan.to].owner : -1)) {
			merchantAbort(m); // war closes the road
		}
		if (m.state === "idle") {
			if (m.idleTurns % 2 === 0) planMerchantTrip(m); else m.idleTurns++;
		} else {
			merchantStep(m);
		}
	});

	// AI cities outfit merchants (humans spawn from the City tab / action bar)
	G.players.forEach(function (pl) {
		if (!pl.alive || pl.isHuman) return;
		if ((G.turn + pl.id) % 4 !== 0) return;
		if (pl.ai.trade <= 0.1) return;
		G.cities.forEach(function (c) {
			if (c.owner !== pl.id || c.pop < 3) return;
			if (merchantsFrom(c.id).length >= cityMerchantSlots(c)) return;
			var kind = cityIsCoastal(c) && (c.supply.timber || 0) >= GameConfig.merchant.fleetNeedsTimber &&
				pl.gold > GameConfig.merchant.fleetGoldCost * 2 ? "fleet" : "caravan";
			var cost = kind === "fleet" ? GameConfig.merchant.fleetGoldCost : GameConfig.merchant.caravanGoldCost;
			if (pl.gold < cost * 2) return;
			spawnMerchant(c.id, kind);
		});
	});
}

// Toggle a toll gate on an owned tile (toll mode 0). Returns null or reason.
function toggleTollGate(playerId, t) {
	if (GameConfig.merchant.tollMode !== 0) return "Gates are disabled (border-fee tolling is active).";
	if (G.owner[t] !== playerId) return "You can only gate your own territory.";
	G.tollGates[t] = G.tollGates[t] ? 0 : 1;
	return null;
}
