// powerups.js — civ power-ups (features.powerups): every powerups.everyTurns
// turns each civilization banks one pick and chooses a permanent bonus from a
// four-category menu. AIs choose along their personality; several picks
// deliberately synergize with policies (e.g. Toll Houses x toll rate,
// Conscription x militarism) so doctrine choices compound.

var POWERUPS = {
	trade: [
		{ id: "silkRoads", name: "Silk Roads", desc: "+1 merchant/route slot in every city" },
		{ id: "caravanserai", name: "Caravanserai", desc: "caravans carry 50% more and travel 25% faster" },
		{ id: "navigators", name: "Navigators", desc: "fleets carry 50% more and sail 25% faster" },
		{ id: "tollHouses", name: "Toll Houses", desc: "toll and entrance-fee revenue +50% (stacks with your toll rate)" }
	],
	military: [
		{ id: "drill", name: "Professional Drill", desc: "all units +8% effective strength" },
		{ id: "logistics", name: "Logistics Corps", desc: "supply range +8 hops, supply costs −20%" },
		{ id: "siegecraft", name: "Siegecraft", desc: "siege units +50% bonus vs cities" },
		{ id: "conscription", name: "Conscription", desc: "combat units 15% cheaper (stacks with Militarism)" }
	],
	building: [
		{ id: "engineering", name: "Engineering", desc: "roads/bridges half price; forts and walls 30% cheaper" },
		{ id: "masonry", name: "Masonry", desc: "city defenses +30%, edge walls +50% bonus" },
		{ id: "aqueducts", name: "Aqueducts", desc: "cities can grow 5 population larger" },
		{ id: "urbanPlanning", name: "Urban Planning", desc: "cities claim territory 1 tile further" }
	],
	growth: [
		{ id: "husbandry", name: "Husbandry", desc: "+25% food from livestock" },
		{ id: "irrigation", name: "Irrigation", desc: "+20% food from crops" },
		{ id: "medicine", name: "Medicine", desc: "cities grow 20% faster" },
		{ id: "homesteading", name: "Homesteading", desc: "rural population +25% (more demand and goods)" }
	]
};
var POWERUP_CATEGORIES = ["trade", "military", "building", "growth"];

function puHas(pl, id) {
	return !!(GameConfig.features.powerups && pl && pl.powerups && pl.powerups[id]);
}

function puFind(id) {
	for (var c = 0; c < POWERUP_CATEGORIES.length; c++) {
		var list = POWERUPS[POWERUP_CATEGORIES[c]];
		for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
	}
	return null;
}

function puAvailable(pl, category) {
	return POWERUPS[category].filter(function (p) { return !pl.powerups[p.id]; });
}

// Take a power-up. Returns null on success or a reason.
function pickPowerup(pl, id) {
	if (!GameConfig.features.powerups) return "Power-ups disabled.";
	if ((pl.powerupPicks || 0) <= 0) return "No picks available yet.";
	if (pl.powerups[id]) return "Already taken.";
	if (!puFind(id)) return "Unknown power-up.";
	pl.powerups[id] = true;
	pl.powerupPicks--;
	gameLog(pl.name + " adopts " + puFind(id).name);
	// immediate structural effects
	if (id === "urbanPlanning") recomputeTerritory();
	if (id === "homesteading" && G.tilePop) initTilePopulation();
	return null;
}

// AI: pick a category by personality/policy, then the first untaken power-up.
function aiPickPowerup(pl) {
	var a = pl.ai, pol = pl.policies || {};
	var weights = {
		trade: a.trade + (pol.openness || 0) * 0.5,
		military: a.military + a.aggression * 0.5 + (pol.militarism || 0) * 0.5,
		building: (pol.infrastructure || 0) + a.riskAversion * 0.5,
		growth: a.expansion + a.wFood * 0.3
	};
	var order = POWERUP_CATEGORIES.slice().sort(function (x, y) { return weights[y] - weights[x]; });
	for (var i = 0; i < order.length; i++) {
		var avail = puAvailable(pl, order[i]);
		if (avail.length) {
			pickPowerup(pl, avail[Math.floor(G.rng() * avail.length)].id);
			if (typeof aiLogGoal === "function") {
				aiLogGoal(pl, "powerup", "adopted a " + order[i] + " power-up");
			}
			return;
		}
	}
}

// Grant picks on schedule; AIs (and minors) spend theirs immediately.
function powerupsTurn() {
	if (!GameConfig.features.powerups) return;
	var P = GameConfig.powerups;
	var grant = G.turn > 0 && G.turn % P.everyTurns === 0;
	G.players.forEach(function (pl) {
		if (!pl.alive) return;
		if (pl.powerups === undefined) { pl.powerups = {}; pl.powerupPicks = P.startPicks; }
		if (grant) pl.powerupPicks = (pl.powerupPicks || 0) + 1;
		if (!pl.isHuman) {
			while ((pl.powerupPicks || 0) > 0) aiPickPowerup(pl);
		}
	});
}
