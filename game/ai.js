// ai.js — tunable AI personalities. Every weight is slider-editable per player
// (Players tab). Site valuation leans on the map's exported strategic layers
// (cityPriority, transit, transitCross, shoreDelta) so PlanGen's automatic
// strategic-spot detection directly drives where AIs want to settle.

var AI_PRESETS = {
	balanced: {
		wFood: 1.0, wProd: 0.8, wMinerals: 0.6, wCityPriority: 1.0, wTransit: 0.6,
		wShoreDelta: 0.4, wCoast: 0.4, wRiver: 0.5,
		expansion: 0.6, military: 0.5, trade: 0.6, aggression: 0.3,
		tollGreed: 0.3, subsidyBias: 0.4, riskAversion: 0.5
	},
	expansionist: {
		wFood: 1.2, wProd: 0.7, wMinerals: 0.4, wCityPriority: 1.1, wTransit: 0.5,
		wShoreDelta: 0.3, wCoast: 0.5, wRiver: 0.6,
		expansion: 1.0, military: 0.35, trade: 0.45, aggression: 0.2,
		tollGreed: 0.25, subsidyBias: 0.3, riskAversion: 0.6
	},
	warmonger: {
		wFood: 0.8, wProd: 1.1, wMinerals: 1.0, wCityPriority: 0.8, wTransit: 0.9,
		wShoreDelta: 0.7, wCoast: 0.3, wRiver: 0.4,
		expansion: 0.4, military: 1.0, trade: 0.3, aggression: 0.9,
		tollGreed: 0.6, subsidyBias: 0.2, riskAversion: 0.25
	},
	merchant: {
		wFood: 0.9, wProd: 0.6, wMinerals: 0.8, wCityPriority: 1.2, wTransit: 1.2,
		wShoreDelta: 0.8, wCoast: 0.9, wRiver: 0.8,
		expansion: 0.5, military: 0.35, trade: 1.0, aggression: 0.1,
		tollGreed: 0.15, subsidyBias: 0.8, riskAversion: 0.7
	},
	isolationist: {
		wFood: 1.1, wProd: 0.9, wMinerals: 0.6, wCityPriority: 0.7, wTransit: 0.2,
		wShoreDelta: 0.3, wCoast: 0.2, wRiver: 0.5,
		expansion: 0.5, military: 0.6, trade: 0.2, aggression: 0.15,
		tollGreed: 0.9, subsidyBias: 0.5, riskAversion: 0.8
	},
	// Independent city-states: defend and trade, never expand or attack.
	cityState: {
		wFood: 1.0, wProd: 0.8, wMinerals: 0.7, wCityPriority: 1.1, wTransit: 0.9,
		wShoreDelta: 0.6, wCoast: 0.7, wRiver: 0.7,
		expansion: 0, military: 0.55, trade: 0.9, aggression: 0,
		tollGreed: 0.2, subsidyBias: 0.6, riskAversion: 0.9
	}
};
var AI_PRESET_ORDER = ["balanced", "expansionist", "warmonger", "merchant", "isolationist"];

// Slider ranges for the per-player personality editor.
var AI_PERSONALITY_SCHEMA = [
	{ k: "wFood", max: 2 }, { k: "wProd", max: 2 }, { k: "wMinerals", max: 2 },
	{ k: "wCityPriority", max: 2 }, { k: "wTransit", max: 2 }, { k: "wShoreDelta", max: 2 },
	{ k: "wCoast", max: 2 }, { k: "wRiver", max: 2 },
	{ k: "expansion", max: 1.2 }, { k: "military", max: 1.2 }, { k: "trade", max: 1.2 },
	{ k: "aggression", max: 1 }, { k: "tollGreed", max: 1 }, { k: "subsidyBias", max: 1 },
	{ k: "riskAversion", max: 1 }
];

function makePersonality(playerIndex, rng, preset) {
	if (!preset || preset === "random" || !AI_PRESETS[preset]) {
		preset = AI_PRESET_ORDER[playerIndex % AI_PRESET_ORDER.length];
	}
	var p = { preset: preset };
	var src = AI_PRESETS[preset];
	for (var k in src) p[k] = Math.max(0, src[k] * (0.9 + rng() * 0.2)); // slight jitter
	return p;
}

// ---------------------------------------------------------------------------
// Site valuation (used for start placement AND settler targeting)
// ---------------------------------------------------------------------------

function aiSiteScore(pl, t) {
	if (!M.isPassable(t) || G && G.cityAt && G.cityAt[t] >= 0) return -Infinity;
	var a = pl.ai;
	var s = 0;

	// neighborhood economics (tile + ring 1)
	var hood = [t].concat(M.neighbors[t]);
	for (var i = 0; i < hood.length; i++) {
		var x = hood[i], w = i === 0 ? 1.5 : 1.0;
		// food: crops we know count fully, unknown crops half (we might learn them)
		var food = 0;
		COMMODITIES.forEach(function (cm) {
			if (cm.demandGroup !== "food") return;
			var v = M.layer(cm.layer)[x];
			if ((cm.kind === "crop" || cm.kind === "animal") && !pl.knowledge[cm.id]) v *= 0.5;
			if (v > food) food = v;
		});
		s += w * a.wFood * food * 2;
		s += w * a.wProd * (M.layer("timber")[x] * 0.8 + (M.T.hills === M.layer("terrain")[x] ? 0.4 : 0));
		s += w * a.wMinerals * (M.layer("iron")[x] + M.layer("copper")[x] + M.layer("gold")[x] * 1.5 + M.layer("silver")[x]);
	}

	// PlanGen strategic layers at the site itself
	s += a.wCityPriority * M.layer("cityPriority")[t] * 4;
	s += a.wTransit * (M.layer("transit")[t] + M.layer("transitCross")[t]) * 3;
	s += a.wShoreDelta * M.layer("shoreDelta")[t] * 2;

	if (M.layer("shore")[t] === 1) s += a.wCoast * 1.2;
	if (M.layer("river")[t] || M.neighbors[t].some(function (n) { return M.layer("river")[n] > 0; })) s += a.wRiver * 1.2;

	return s;
}

// ---------------------------------------------------------------------------
// Per-turn AI
// ---------------------------------------------------------------------------

function aiTakeTurn(pl) {
	var a = pl.ai;
	var myCities = G.cities.filter(function (c) { return c.owner === pl.id; });
	var myUnits = G.units.filter(function (u) { return u.owner === pl.id; });
	if (!myCities.length && !myUnits.length) { pl.alive = false; return; }

	aiWarPeace(pl, myCities, myUnits);
	aiDiplomacy(pl);
	aiDesigns(pl);
	aiMoveUnits(pl, myCities, myUnits);
	aiProduction(pl, myCities, myUnits);
	aiTradeRoutes(pl, myCities);
	aiTollsAndSubsidies(pl, myCities);
	aiBuildRoads(pl, myCities);
}

// Set ship/plane designs from personality, once per era reached. Aggressive
// players favour firepower; traders/expansionists favour speed/range.
function aiDesigns(pl) {
	if (pl._designedEra === pl.era) return;
	pl._designedEra = pl.era;
	var a = pl.ai;
	var power = 1 + (a.aggression + a.military) * 0.35;   // ~1.0 .. 1.7
	var speed = 1 + (a.trade + a.expansion) * 0.25;
	designableTypes().forEach(function (t) {
		if (UNIT_TYPES[t].era !== pl.era) return;
		var cls = UNIT_TYPES[t].design;
		if (cls === "plane") setDesign(pl, t, clampAttr(speed), clampAttr(power));      // a=range, b=power
		else if (cls === "carrier") setDesign(pl, t, clampAttr(speed), clampAttr(power));// a=speed, b=airwing
		else setDesign(pl, t, clampAttr(speed), clampAttr(power));                       // ship a=speed b=power
	});
	pl.retool = {}; // designing at era start shouldn't self-penalize
}

// Record a notable AI decision (goal) — picked up by the structured turn log
// (gamelog.js). `data` is optional machine-readable detail for AI tuning.
function aiLogGoal(pl, kind, text, data) {
	if (!G) return;
	G._aiGoals = G._aiGoals || [];
	G._aiGoals.push({ turn: G.turn, player: pl.id, kind: kind, text: text, data: data || null });
}

function playerPower(pid) {
	var s = 0;
	G.units.forEach(function (u) { if (u.owner === pid) s += unitStrength(u.type) * u.hp / 100; });
	G.cities.forEach(function (c) { if (c.owner === pid) s += 5 + c.pop; });
	return s;
}

function aiWarPeace(pl, myCities, myUnits) {
	var a = pl.ai;
	if (a.aggression <= 0.05) return;
	var myPower = playerPower(pl.id);
	G.players.forEach(function (other) {
		if (other.id === pl.id || !other.alive) return;
		var theirPower = playerPower(other.id);
		if (atWar(pl.id, other.id)) {
			// peace now comes through diplomacy (aiDiplomacy offers tribute),
			// or the long-stalemate auto-peace in endTurn.
			return;
		}
		// consider war: strong enough, aggressive enough, and borders near
		if (myPower > theirPower * (2.0 - a.aggression) && G.rng() < a.aggression * 0.08) {
			var near = G.cities.some(function (c) {
				return c.owner === other.id && myCities.some(function (mc) { return M.distTiles(mc.tile, c.tile) < 14; });
			});
			if (near) {
				declareWar(pl.id, other.id);
				aiLogGoal(pl, "war", "declared war on " + other.name,
					{ target: other.id, myPower: Math.round(myPower), theirPower: Math.round(theirPower) });
			}
		}
	});
}

function aiMoveUnits(pl, myCities, myUnits) {
	var a = pl.ai;

	// camps raiding my routes or territory -> military target
	var problemCamps = G.camps.filter(function (camp) {
		return myCities.some(function (c) { return M.distTiles(camp.tile, c.tile) < 12; }) ||
			G.routes.some(function (r) { return r.owner === pl.id && pathCamps(r.path).indexOf(camp) >= 0; });
	});

	var enemies = G.players.filter(function (o) { return o.alive && atWar(pl.id, o.id); });
	var enemyCities = G.cities.filter(function (c) { return enemies.some(function (e) { return e.id === c.owner; }); });

	var missions = { settle: 0, clearCamps: 0, attack: 0, garrison: 0, naval: 0, air: 0 };

	myUnits.forEach(function (u) {
		if (u.orders) return; // standing orders (settlement missions) run themselves
		var dom = UNIT_TYPES[u.type].domain;
		if (dom === "sea") { missions.naval++; aiNavalUnit(pl, u, enemyCities, problemCamps); return; }
		if (dom === "air") { missions.air++; aiAirUnit(pl, u, enemyCities); return; }
		if (u.type === "settler") {
			var target = aiBestSettleSite(pl, u);
			missions.settle++;
			if (target === u.tile) {
				foundCity(pl.id, u.tile, u);
			} else if (target >= 0) {
				moveUnitTowards(u, target);
				if (u.tile === target) foundCity(pl.id, u.tile, u);
			}
			return;
		}
		if (!UNIT_TYPES[u.type].combat) return;

		// 0. WW2 infantry: train elite variants (militaristic AIs, when flush)
		if (UNIT_TYPES[u.type].trainable && !u.training && pl.gold > 90 && a.military > 0.4 && G.rng() < 0.4) {
			trainUnit(u, G.rng() < 0.5 ? "amphibious" : "airborne");
		}
		// 0b. airborne infantry: drop next to an enemy city in range
		if (u.training === "airborne" && u.moves > 0 && enemyCities.length && u.supply.fuel) {
			var near = enemyCities.filter(function (c) { return M.distTiles(u.tile, c.tile) <= GameConfig.amphibious.paradropRange; })
				.sort(function (x, y) { return M.distTiles(u.tile, x.tile) - M.distTiles(u.tile, y.tile); })[0];
			if (near) {
				var lz = M.neighbors[near.tile].filter(function (n) {
					return M.isPassable(n) && G.cityAt[n] < 0 && unitsAt(n).length === 0 &&
						M.distTiles(u.tile, n) <= GameConfig.amphibious.paradropRange;
				})[0];
				if (lz !== undefined && airborneDrop(u, lz)) { missions.attack++; return; }
			}
		}

		// 1. clear problem camps (braver AIs go earlier)
		if (problemCamps.length && (u.hp > 50) && G.rng() > a.riskAversion * 0.4) {
			var camp = problemCamps.reduce(function (best, c) {
				return M.distTiles(u.tile, c.tile) < M.distTiles(u.tile, best.tile) ? c : best;
			});
			if (M.distTiles(u.tile, camp.tile) < 16) { missions.clearCamps++; moveUnitTowards(u, camp.tile); return; }
		}
		// 2. war: attack nearest enemy city / defend
		if (enemyCities.length) {
			var tgt = enemyCities.reduce(function (best, c) {
				return M.distTiles(u.tile, c.tile) < M.distTiles(u.tile, best.tile) ? c : best;
			});
			missions.attack++;
			moveUnitTowards(u, tgt.tile);
			return;
		}
		// 3. peace: garrison the least-defended city
		var open = myCities.filter(function (c) {
			return !unitsAt(c.tile).some(function (x) { return x.owner === pl.id && UNIT_TYPES[x.type].combat; });
		});
		if (open.length && u.tile !== open[0].tile) { missions.garrison++; moveUnitTowards(u, open[0].tile); }
	});

	if (missions.settle + missions.clearCamps + missions.attack + missions.garrison + missions.naval + missions.air > 0) {
		var parts = [];
		if (missions.settle) parts.push(missions.settle + " settling");
		if (missions.clearCamps) parts.push(missions.clearCamps + " clearing camps");
		if (missions.attack) parts.push(missions.attack + " attacking");
		if (missions.garrison) parts.push(missions.garrison + " garrisoning");
		if (missions.naval) parts.push(missions.naval + " at sea");
		if (missions.air) parts.push(missions.air + " air");
		aiLogGoal(pl, "movement", parts.join(", "), missions);
	}
}

// Naval AI: hunt enemy ships, bombard coastal enemy cities, shell camps
// that sit near the water; otherwise hold station.
function aiNavalUnit(pl, u, enemyCities, problemCamps) {
	var target = -1, td = Infinity;
	G.units.forEach(function (x) {
		if (x.owner === pl.id || UNIT_TYPES[x.type].domain !== "sea" || !atWar(pl.id, x.owner)) return;
		var d = M.distTiles(u.tile, x.tile);
		if (d < td) { td = d; target = x.tile; }
	});
	if (target < 0) {
		var cc = null, cd = Infinity;
		enemyCities.forEach(function (c) {
			if (adjacentWaterTile(c.tile) < 0) return; // landlocked
			var d = M.distTiles(u.tile, c.tile);
			if (d < cd) { cd = d; cc = c; }
		});
		if (cc) target = cc.tile;
	}
	if (target < 0 && problemCamps.length) {
		var camp = null, kd = Infinity;
		problemCamps.forEach(function (cp) {
			if (adjacentWaterTile(cp.tile) < 0) return;
			var d = M.distTiles(u.tile, cp.tile);
			if (d < kd && d < 20) { kd = d; camp = cp; }
		});
		if (camp) target = camp.tile;
	}
	if (target >= 0) moveUnitTowards(u, target);
}

// Air AI: strike the strongest enemy in range (prefer intruders on our own
// soil), else the enemy city in range; otherwise rebase toward the front.
function aiAirUnit(pl, u, enemyCities) {
	if (u.moves <= 0) return;
	var A = GameConfig.air;
	var best = -1, bestScore = 0;
	G.units.forEach(function (x) {
		if (x.owner === pl.id || !atWar(pl.id, x.owner)) return;
		var d = M.distTiles(u.tile, x.tile);
		if (d > A.strikeRange) return;
		var s = effStrength(x) + (G.owner[x.tile] === pl.id ? 25 : 0);
		if (s > bestScore) { bestScore = s; best = x.tile; }
	});
	if (best < 0) {
		var cityScore = u.type === "bomber" ? 30 : 8;
		enemyCities.forEach(function (c) {
			if (M.distTiles(u.tile, c.tile) > A.strikeRange) return;
			if (cityScore > bestScore) { bestScore = cityScore; best = c.tile; }
		});
	}
	if (best >= 0) { airStrike(u, best); return; }

	// nothing in range: rebase to the own city closest to the nearest enemy city
	if (!enemyCities.length) return;
	var myCities = G.cities.filter(function (c) { return c.owner === pl.id; });
	var bestCity = null, bestD = Infinity;
	myCities.forEach(function (c) {
		if (c.id === u.base) return;
		if (M.distTiles(u.tile, c.tile) > A.ferryRange) return;
		enemyCities.forEach(function (ec) {
			var d = M.distTiles(c.tile, ec.tile);
			if (d < bestD) { bestD = d; bestCity = c; }
		});
	});
	var curD = Infinity;
	enemyCities.forEach(function (ec) { curD = Math.min(curD, M.distTiles(u.tile, ec.tile)); });
	if (bestCity && bestD < curD) airRebase(u, bestCity.id);
}

function aiBestSettleSite(pl, settler) {
	return aiBestSettleSiteFrom(pl, settler.tile);
}
function aiBestSettleSiteFrom(pl, fromTile) {
	var best = -1, bestScore = 0.5; // require minimum quality
	for (var i = 0; i < M.landTiles.length; i++) {
		var t = M.landTiles[i];
		if (M.distTiles(fromTile, t) > 15) continue;
		if (nearestCityDistance(t) < 4) continue;
		var s = aiSiteScore(pl, t) - M.distTiles(fromTile, t) * 0.15;
		if (s > bestScore) { bestScore = s; best = t; }
	}
	return best;
}

// Strongest buildable unit of a domain from this city's available list.
function aiBestUnit(avail, domain) {
	var best = null, bestStr = -1;
	avail.forEach(function (t) {
		var def = UNIT_TYPES[t];
		if (!def || !def.combat || def.domain !== domain) return;
		if (unitStrength(t) > bestStr) { bestStr = unitStrength(t); best = t; }
	});
	return best;
}

// A land unit with combined-arms variety: a siege piece every third build to
// crack cities, an (often trainable) infantry every fourth for numbers and
// airborne/amphibious roles, otherwise the heavy hitter.
function aiPickLand(avail, soldiers) {
	var siege = avail.filter(function (t) { return UNIT_TYPES[t] && UNIT_TYPES[t].siege; })[0];
	var infantry = avail.filter(function (t) { return UNIT_TYPES[t] && UNIT_TYPES[t].trainable; })[0];
	if (siege && soldiers % 3 === 2) return siege;
	if (infantry && soldiers % 4 === 1) return infantry;
	return aiBestUnit(avail, "land");
}

function aiProduction(pl, myCities, myUnits) {
	var a = pl.ai;
	var settlers = 0, soldiers = 0, ships = 0, planes = 0;
	myUnits.forEach(function (u) {
		var def = UNIT_TYPES[u.type];
		if (u.type === "settler") settlers++;
		else if (def.domain === "sea") ships++;
		else if (def.domain === "air") planes++;
		else if (def.combat) soldiers++;
	});
	var atWarNow = Object.keys(G.wars).some(function (k) { return k.split("|").indexOf("" + pl.id) >= 0; });
	var wantSoldiers = Math.ceil(myCities.length * (0.6 + a.military * 1.4)) + (atWarNow ? 2 : 0);
	var wantShips = Math.round(myCities.filter(cityIsCoastal).length * (0.25 + a.military * 0.3 + a.trade * 0.15));
	var wantPlanes = pl.era >= 2 ? Math.ceil(myCities.length * a.military * 0.7) : 0;
	var wantSettler = !pl.minor && settlers === 0 && myCities.length < 2 + a.expansion * 6 &&
		myUnits.length < GameConfig.units.maxUnitsPerPlayer;

	// Settlement missions replace settler production: pay gold + pop up front.
	if (wantSettler && GameConfig.features.settlementMissions) {
		if (pl.gold >= GameConfig.settle.goldCost * 1.5 && myCities.length) {
			var site = aiBestSettleSiteFrom(pl, G.cities[pl.capital >= 0 ? pl.capital : myCities[0].id].tile);
			if (site >= 0 && launchSettlementMission(pl.id, site) === null) {
				aiLogGoal(pl, "settle", "launched a settlement mission", { target: site });
			}
		}
		wantSettler = false;
	}

	var queued = [];
	var unitBudgetLeft = function () { return myUnits.length + queued.length < GameConfig.units.maxUnitsPerPlayer; };

	myCities.forEach(function (city) {
		if (city.producing) return;
		var avail = availableProduction(city);

		function setProd(item) { city.producing = item; queued.push(city.name + ":" + item); }

		if (wantSettler && avail.indexOf("settler") >= 0 && city.pop >= 2) { setProd("settler"); wantSettler = false; return; }
		if (soldiers < wantSoldiers && unitBudgetLeft()) {
			var land = aiPickLand(avail, soldiers);
			if (land) { setProd(land); soldiers++; return; }
		}
		if (planes < wantPlanes && unitBudgetLeft()) {
			var airType = avail.indexOf("bomber") >= 0 && (planes % 2 === 1) ? "bomber" :
				avail.indexOf("fighter") >= 0 ? "fighter" : null;
			if (airType) { setProd(airType); planes++; return; }
		}
		if (ships < wantShips && unitBudgetLeft()) {
			// one carrier for an air-capable navy, otherwise the best warship
			var hasCarrier = myUnits.some(function (x) { return x.type === "carrier"; }) ||
				queued.some(function (q) { return /:carrier$/.test(q); });
			var sea = (avail.indexOf("carrier") >= 0 && !hasCarrier && ships >= 1 && a.military > 0.4) ?
				"carrier" : aiBestUnit(avail, "sea");
			if (sea) { setProd(sea); ships++; return; }
		}
		if (atWarNow && !city.buildings.walls) { setProd("walls"); return; }
		if (a.trade > 0.4 && !city.buildings.market) { setProd("market"); return; }
		if (!city.buildings.granary && city.pop >= 4) { setProd("granary"); return; }
		if (!city.buildings.walls && a.military > 0.5) { setProd("walls"); return; }
		// nothing pressing: idle (production converts to gold)
	});

	aiLogGoal(pl, "production",
		"army " + soldiers + "/" + wantSoldiers + ", navy " + ships + "/" + wantShips +
		(pl.era >= 2 ? ", air " + planes + "/" + wantPlanes : "") +
		(wantSettler ? ", wants settler" : "") +
		(queued.length ? " — queued " + queued.join(", ") : " — nothing queued"),
		{ soldiers: soldiers, wantSoldiers: wantSoldiers, ships: ships, wantShips: wantShips,
		  planes: planes, wantPlanes: wantPlanes, settlers: settlers, wantSettler: wantSettler, queued: queued });
}

function aiTradeRoutes(pl, myCities) {
	var a = pl.ai;
	if (GameConfig.features.merchants) return; // merchant agents replace routes
	if (a.trade <= 0.05) return;
	if ((G.turn + pl.id) % 3 !== 0) return; // stagger the expensive search

	// prune hopeless routes
	G.routes.filter(function (r) { return r.owner === pl.id && !r.active && r.age > 8; })
		.forEach(function (r) { if (r.lastProfit <= 0) removeRoute(r); });

	myCities.forEach(function (city) {
		if (routesFrom(city.id).length >= cityRouteSlots(city)) return;
		if (!city.prices || !Object.keys(city.prices).length) return;

		// shortlist candidate destinations by crude distance, then verify best by margin
		var candidates = G.cities.filter(function (c2) {
			return c2.id !== city.id && !atWar(pl.id, c2.owner) &&
				c2.prices && Object.keys(c2.prices).length;
		}).map(function (c2) {
			// optimistic margin ignoring path: best price gap
			var bestGap = 0, dist = M.distTiles(city.tile, c2.tile);
			COMMODITIES.forEach(function (cm) {
				if ((city.supply[cm.id] || 0) < 0.5) return;
				var gap = (c2.prices[cm.id] + (c2.subsidies[cm.id] || 0)) - city.prices[cm.id];
				if (gap > bestGap) bestGap = gap;
			});
			return { c: c2, est: bestGap - dist * 0.02 };
		}).filter(function (x) { return x.est > 0; })
			.sort(function (x, y) { return y.est - x.est; })
			.slice(0, 3);

		for (var i = 0; i < candidates.length; i++) {
			var r = createRoute(pl.id, city.id, candidates[i].c.id);
			if (r) {
				// verify it's actually worth running; else drop immediately
				var best = -Infinity;
				COMMODITIES.forEach(function (cm) { best = Math.max(best, routeMargin(r, cm.id)); });
				if (best < GameConfig.trade.minRouteMargin * a.trade) removeRoute(r);
				else {
					aiLogGoal(pl, "trade", "opened route " + city.name + " → " + G.cities[candidates[i].c.id].name,
						{ from: city.id, to: candidates[i].c.id, margin: best });
					break;
				}
			}
		}
	});
}

function aiTollsAndSubsidies(pl, myCities) {
	var a = pl.ai;
	var T = GameConfig.trade;
	pl.tollRate = a.tollGreed * T.tollMax;

	if (a.subsidyBias <= 0.05) return;
	myCities.forEach(function (city) {
		// starving: subsidize the best food commodity we can't produce enough of
		var foodShort = city.yields.food < city.pop * GameConfig.city.baseFoodPerPop;
		COMMODITIES.forEach(function (cm) { // reset, then re-apply the ones we want
			if (city.subsidies[cm.id]) delete city.subsidies[cm.id];
		});
		if (foodShort) {
			var best = null, bestPrice = 0;
			COMMODITIES.forEach(function (cm) {
				if (cm.demandGroup !== "food") return;
				if ((city.prices[cm.id] || 0) > bestPrice) { bestPrice = city.prices[cm.id]; best = cm.id; }
			});
			if (best) {
				city.subsidies[best] = a.subsidyBias * T.subsidyMax * 0.6;
				aiLogGoal(pl, "famine", city.name + " is short on food — subsidizing " + best,
					{ city: city.id, commodity: best });
			}
		}
		// learning: subsidize an unknown crop to attract imports (tech via trade)
		if (city.id === pl.capital) {
			var unknown = COMMODITIES.filter(function (cm) {
				return (cm.kind === "crop" || cm.kind === "animal") && !pl.knowledge[cm.id];
			});
			if (unknown.length && pl.gold > 40) {
				city.subsidies[unknown[0].id] = Math.max(city.subsidies[unknown[0].id] || 0, a.subsidyBias * T.subsidyMax * 0.4);
			}
		}
	});
}

// Connect own cities with roads when rich enough; merchants prioritize this.
function aiBuildRoads(pl, myCities) {
	var a = pl.ai;
	if (myCities.length < 2) return;
	var budget = 30 + a.trade * 80;
	if (pl.gold < budget * 1.5) return;
	if ((G.turn + pl.id) % 7 !== 0) return;

	// connect the two closest unconnected own cities (crude: no road on the
	// direct path yet)
	for (var i = 0; i < myCities.length; i++) {
		for (var j = i + 1; j < myCities.length; j++) {
			var A = myCities[i], B = myCities[j];
			if (M.distTiles(A.tile, B.tile) > 12) continue;
			var pf = unitPathfind(A.tile, B.tile, pl.id);
			if (!pf) continue;
			var missing = 0;
			for (var k = 1; k < pf.path.length; k++) {
				var e = M.edgeBetween(pf.path[k - 1], pf.path[k]);
				if (e >= 0 && G.roads[e] === 0) missing++;
			}
			if (missing > 0 && missing * GameConfig.build.roadCostGold < pl.gold * 0.5) {
				buildRoadPath(pl.id, A.tile, B.tile);
				return;
			}
		}
	}
}
