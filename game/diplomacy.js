// diplomacy.js — negotiated deals between players: gold, tile-by-tile territory
// cession, per-turn tribute, and peace clauses. AIs value each side of a deal
// with their own personality and knowledge, accept/reject with a computable
// "what would close the gap" counter-hint, sue for peace with tribute when
// losing, and extort tribute from much weaker neighbours (threats).
//
// Data:
//   deal = { from, to, give: side, get: side, peace: bool, threat: bool }
//   side = { gold, tiles: [tileIds], tributePerTurn, tributeTurns }
//   G.tributes = [{ from, to, amount, turnsLeft }]   (ongoing payments)
//   G.offers   = [{ deal, turn }]                    (pending, human recipient)

function emptyDealSide() {
	return { gold: 0, tiles: [], cities: [], tributePerTurn: 0, tributeTurns: 0 };
}

function makeDeal(from, to) {
	return { from: from, to: to, give: emptyDealSide(), get: emptyDealSide(), peace: false, threat: false };
}

// ---------------------------------------------------------------------------
// Valuation
// ---------------------------------------------------------------------------

// Gold-denominated worth of one tile to player pl (their knowledge, their
// geography: tiles near their cities are administrable, far ones are not).
function dealTileValue(pl, t) {
	var D = GameConfig.diplomacy;
	var v = 2; // land itself
	v += tileFoodFor(pl, t) * 0.8 + tileProd(t) * 0.8 + tileGold(t);
	v += M.layer("cityPriority")[t] * 4 +
		(M.layer("transit")[t] + M.layer("transitCross")[t]) * 2 +
		M.layer("shoreDelta")[t] * 2;
	v += (M.layer("iron")[t] + M.layer("copper")[t]) * 3 +
		(M.layer("gold")[t] + M.layer("silver")[t]) * 5;

	var myCities = G.cities.filter(function (c) { return c.owner === pl.id; });
	var d = Infinity;
	myCities.forEach(function (c) { d = Math.min(d, M.distTiles(t, c.tile)); });
	var R2 = GameConfig.city.claimRadius;
	var admin = d <= R2 + 1 ? 1.3 : d <= R2 + 4 ? 0.9 : 0.35;
	return v * admin * D.tileValueScale;
}

// Gold-denominated worth of a whole city (population, buildings, and the
// territory it administers). Cities are worth far more than loose tiles.
function dealCityValue(pl, cityId) {
	var city = G.cities[cityId];
	if (!city) return 0;
	var v = 60 + city.pop * 25;
	v += (city.buildings.walls ? 40 : 0) + (city.buildings.market ? 35 : 0) + (city.buildings.granary ? 25 : 0);
	if (city.id === G.players[city.owner].capital) v += 80; // capitals are prized
	// the land it works
	(city.territory || []).forEach(function (t) { if (G.cityAt[t] < 0) v += dealTileValue(pl, t) * 0.25; });
	return v;
}

function dealSideValue(pl, side) {
	var D = GameConfig.diplomacy;
	var v = side.gold || 0;
	if (side.tributePerTurn > 0 && side.tributeTurns > 0) {
		v += side.tributePerTurn * side.tributeTurns * D.tributeDiscount;
	}
	(side.tiles || []).forEach(function (t) { v += dealTileValue(pl, t); });
	(side.cities || []).forEach(function (cid) { v += dealCityValue(pl, cid); });
	return v;
}

// How much peace with `otherId` is worth to pl right now. Positive when
// losing or war-weary; negative when clearly winning (peace = lost spoils).
function peaceValue(pl, otherId) {
	if (!atWar(pl.id, otherId)) return 0;
	var D = GameConfig.diplomacy;
	var mine = playerPower(pl.id), theirs = playerPower(otherId);
	var ratio = theirs / Math.max(1, mine);
	var dur = G.wars[warKey(pl.id, otherId)] || 0;
	var v = D.peaceBaseValue + (ratio - 1) * 80 + dur * 1.5;
	v *= (1.2 - pl.ai.aggression * 0.6);
	return Math.max(-80, v);
}

// The recipient's decision on a deal. Returns { accept, deficit } where
// deficit is roughly the extra gold that would make them say yes.
function aiDealDecision(recipient, deal) {
	var D = GameConfig.diplomacy;
	var a = recipient.ai;
	var proposer = G.players[deal.from];

	// Warring players can only talk peace.
	if (atWar(deal.from, deal.to) && !deal.peace) return { accept: false, deficit: Infinity };

	var get = dealSideValue(recipient, deal.give);   // what proposer gives, recipient gets
	var give = dealSideValue(recipient, deal.get);   // what recipient must hand over
	if (deal.peace) get += peaceValue(recipient, deal.from);

	// Implicit threat: refusing may mean war with a stronger power.
	if (deal.threat && !atWar(deal.from, deal.to)) {
		var ratio = playerPower(deal.from) / Math.max(1, playerPower(recipient.id));
		if (ratio > 1) get += (ratio - 1) * D.threatWeight * (0.5 + a.riskAversion);
	}

	var margin = D.acceptMarginBase + a.riskAversion * 0.2;
	var needed = give * margin + 1;
	return { accept: get >= needed, deficit: Math.max(0, needed - get) };
}

// ---------------------------------------------------------------------------
// Validation & execution
// ---------------------------------------------------------------------------

function dealValid(deal) {
	var A = G.players[deal.from], B = G.players[deal.to];
	if (!A || !B || !A.alive || !B.alive) return false;
	var ok = true;
	(deal.give.tiles || []).forEach(function (t) {
		if (G.owner[t] !== deal.from || G.cityAt[t] >= 0) ok = false;
	});
	(deal.get.tiles || []).forEach(function (t) {
		if (G.owner[t] !== deal.to || G.cityAt[t] >= 0) ok = false;
	});
	// city cessions: the city must belong to the giver, and no side may cede
	// away its very last city.
	function checkCities(giverId, list) {
		var owned = G.cities.filter(function (c) { return c.owner === giverId; }).length;
		(list || []).forEach(function (cid) {
			var c = G.cities[cid];
			if (!c || c.owner !== giverId) ok = false;
		});
		if ((list || []).length >= owned) ok = false; // must keep at least one city
	}
	checkCities(deal.from, deal.give.cities);
	checkCities(deal.to, deal.get.cities);
	if (atWar(deal.from, deal.to) && !deal.peace) ok = false;
	return ok;
}

function dealSideSummary(side, fromName) {
	var bits = [];
	if (side.gold > 0) bits.push(side.gold + "g");
	if ((side.cities || []).length) {
		bits.push((side.cities || []).map(function (cid) { return G.cities[cid] ? G.cities[cid].name : "?"; }).join(" & "));
	}
	if ((side.tiles || []).length) bits.push(side.tiles.length + " tile" + (side.tiles.length > 1 ? "s" : ""));
	if (side.tributePerTurn > 0 && side.tributeTurns > 0) {
		bits.push(side.tributePerTurn + "g/turn ×" + side.tributeTurns);
	}
	return bits.length ? fromName + " gives " + bits.join(" + ") : null;
}

function dealSummary(deal) {
	var A = G.players[deal.from], B = G.players[deal.to];
	var bits = [];
	var s1 = dealSideSummary(deal.give, A.name); if (s1) bits.push(s1);
	var s2 = dealSideSummary(deal.get, B.name); if (s2) bits.push(s2);
	if (deal.peace) bits.push("peace");
	if (deal.threat) bits.push("(under threat)");
	return bits.join("; ") || "empty deal";
}

function transferDealSide(fromPl, toPl, side) {
	var g = Math.min(side.gold || 0, fromPl.gold);
	fromPl.gold -= g; toPl.gold += g;
	(side.tiles || []).forEach(function (t) {
		if (G.owner[t] === fromPl.id && G.cityAt[t] < 0) {
			G.annexed[t] = toPl.id;
			delete G.occupation[t];
		}
	});
	(side.cities || []).forEach(function (cid) { cedeCity(cid, toPl.id); });
	if (side.tributePerTurn > 0 && side.tributeTurns > 0) {
		G.tributes.push({ from: fromPl.id, to: toPl.id, amount: side.tributePerTurn, turnsLeft: side.tributeTurns });
	}
}

// Peaceful handover of a city (population and buildings intact, unlike a
// wartime capture). Clears prior annexation of the old owner's nearby tiles.
function cedeCity(cityId, newOwnerId) {
	var city = G.cities[cityId];
	if (!city || city.owner === newOwnerId) return;
	var old = G.players[city.owner];
	city.producing = null;
	city.subsidies = {};
	// annexed tiles held by the old owner around here revert to normal claim
	Object.keys(G.annexed).forEach(function (t) { if (G.annexed[t] === old.id) delete G.annexed[t]; });
	city.owner = newOwnerId;
	G.routes = G.routes.filter(function (r) { return r.from !== cityId && r.to !== cityId; });
	gameLog(old.name + " cedes " + city.name + " to " + G.players[newOwnerId].name);
	if (old.capital === cityId) {
		var remaining = G.cities.filter(function (c) { return c.owner === old.id; });
		if (remaining.length) old.capital = remaining[0].id;
		else { old.alive = false; gameLog(old.name + " has been eliminated (ceded last city)!"); }
	}
}

function executeDeal(deal) {
	var A = G.players[deal.from], B = G.players[deal.to];
	transferDealSide(A, B, deal.give);
	transferDealSide(B, A, deal.get);
	if (deal.peace) makePeace(deal.from, deal.to);
	recomputeTerritory();
	gameLog("Deal agreed: " + dealSummary(deal));
}

// Propose a deal. AI recipients answer immediately; human recipients get a
// pending offer. Returns { status: 'accepted'|'rejected'|'pending', deficit }.
function proposeDeal(deal) {
	if (!dealValid(deal)) return { status: "rejected", deficit: 0, invalid: true };
	var recipient = G.players[deal.to];
	if (recipient.isHuman) {
		G.offers.push({ deal: deal, turn: G.turn });
		gameLog(G.players[deal.from].name + " offers a deal: " + dealSummary(deal));
		return { status: "pending" };
	}
	var dec = aiDealDecision(recipient, deal);
	if (dec.accept) {
		executeDeal(deal);
		return { status: "accepted" };
	}
	gameLog(recipient.name + " rejects the deal (" + dealSummary(deal) + ")");
	diplomacyOfferRejected(deal);
	return { status: "rejected", deficit: dec.deficit };
}

// A refused threat can mean war.
function diplomacyOfferRejected(deal) {
	var proposer = G.players[deal.from];
	if (deal.threat && !proposer.isHuman && !atWar(deal.from, deal.to)) {
		if (G.rng() < proposer.ai.aggression * 0.7) declareWar(deal.from, deal.to);
	}
}

// Human decision on a pending offer.
function resolveOffer(offer, accept) {
	var i = G.offers.indexOf(offer);
	if (i >= 0) G.offers.splice(i, 1);
	if (accept) {
		if (dealValid(offer.deal)) executeDeal(offer.deal);
		else gameLog("The deal is no longer valid.");
	} else {
		gameLog("You reject the offer from " + G.players[offer.deal.from].name + ".");
		diplomacyOfferRejected(offer.deal);
	}
}

// ---------------------------------------------------------------------------
// Per-turn processing: tribute payments, offer expiry
// ---------------------------------------------------------------------------

function diplomacyTurn() {
	// tribute payments (war between the pair cancels the obligation)
	G.tributes = G.tributes.filter(function (tr) {
		if (atWar(tr.from, tr.to)) {
			gameLog("Tribute from " + G.players[tr.from].name + " to " + G.players[tr.to].name + " cancelled by war.");
			return false;
		}
		var payer = G.players[tr.from], recv = G.players[tr.to];
		if (!payer.alive || !recv.alive) return false;
		var pay = Math.min(tr.amount, payer.gold);
		payer.gold -= pay; recv.gold += pay;
		tr.turnsLeft--;
		if (tr.turnsLeft <= 0) {
			gameLog("Tribute from " + payer.name + " to " + recv.name + " has been paid in full.");
			return false;
		}
		return true;
	});

	// pending offers expire
	var E = GameConfig.diplomacy.offerExpiry;
	G.offers = G.offers.filter(function (o) {
		if (G.turn - o.turn > E) {
			gameLog("The offer from " + G.players[o.deal.from].name + " expires.");
			return false;
		}
		return dealValid(o.deal);
	});
}

// ---------------------------------------------------------------------------
// AI-initiated diplomacy (called each turn from aiTakeTurn)
// ---------------------------------------------------------------------------

function aiCanOffer(pl, otherId) {
	pl._lastOffer = pl._lastOffer || {};
	return (G.turn - (pl._lastOffer[otherId] || -99)) >= GameConfig.diplomacy.offerCooldown;
}
function aiMarkOffer(pl, otherId) {
	pl._lastOffer = pl._lastOffer || {};
	pl._lastOffer[otherId] = G.turn;
}

function aiDiplomacy(pl) {
	var D = GameConfig.diplomacy;
	var a = pl.ai;
	var myPower = playerPower(pl.id);

	// 1. Sue for peace (with tribute if needed) when losing or war-weary.
	G.players.forEach(function (enemy) {
		if (!enemy.alive || enemy.id === pl.id || !atWar(pl.id, enemy.id)) return;
		var theirPower = playerPower(enemy.id);
		var losing = myPower < theirPower * 0.6;
		var weary = (G.wars[warKey(pl.id, enemy.id)] || 0) > 18 && a.aggression < 0.5;
		if (!losing && !weary) return;
		if (!aiCanOffer(pl, enemy.id)) return;

		var deal = makeDeal(pl.id, enemy.id);
		deal.peace = true;
		var dec = aiDealDecision(enemy, deal);
		if (!dec.accept && isFinite(dec.deficit)) {
			// sweeten with tribute the enemy would accept, if affordable
			var turns = 12;
			var perTurn = Math.ceil(dec.deficit / (turns * D.tributeDiscount));
			var affordable = Math.max(1, Math.floor(pl.gold * 0.06) + 3);
			if (perTurn > affordable) {
				perTurn = affordable;
				deal.give.gold = Math.min(Math.floor(pl.gold * 0.4), Math.ceil(dec.deficit * 0.5));
			}
			deal.give.tributePerTurn = perTurn;
			deal.give.tributeTurns = turns;
		}
		aiMarkOffer(pl, enemy.id);
		var res = proposeDeal(deal);
		if (res.status === "accepted") aiLogGoal(pl, "peace", "bought peace with " + enemy.name + " (" + dealSummary(deal) + ")");
	});

	// 2. Extort tribute from much weaker neighbours.
	if (a.aggression > 0.35 && G.rng() < D.demandChance * a.aggression * 2) {
		var myCities = G.cities.filter(function (c) { return c.owner === pl.id; });
		var victim = null, victimPower = Infinity;
		G.players.forEach(function (other) {
			if (!other.alive || other.id === pl.id || atWar(pl.id, other.id)) return;
			if (other.isHuman && GameConfig.setup.humanPlayer < 0) return;
			var p = playerPower(other.id);
			if (p > myPower * 0.55) return;
			var near = G.cities.some(function (c) {
				return c.owner === other.id && myCities.some(function (mc) { return M.distTiles(mc.tile, c.tile) < 16; });
			});
			if (near && p < victimPower && aiCanOffer(pl, other.id)) { victim = other; victimPower = p; }
		});
		if (victim) {
			var demand = makeDeal(pl.id, victim.id);
			demand.threat = true;
			demand.get.tributePerTurn = Math.max(2, Math.ceil(victim.gold * 0.02) + 2);
			demand.get.tributeTurns = 10;
			aiMarkOffer(pl, victim.id);
			var r = proposeDeal(demand);
			aiLogGoal(pl, "extort", "demanded tribute from " + victim.name + " → " + r.status);
		}
	}
}
