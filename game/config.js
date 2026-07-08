// config.js — every tunable number in the game lives here.
// The Tuning tab auto-generates sliders from CONFIG_SCHEMA, so adding a new
// tunable = add the value + one schema row. AI personalities are in ai.js
// (AI_PERSONALITY_SCHEMA) and are equally slider-tunable per player.

var GameConfig = {
	setup: {
		numPlayers: 4,
		humanPlayer: 0,          // -1 = spectate (all AI)
		minStartDistance: 12,    // hops between starting positions
		startSettlers: 1,
		startGold: 50,
		maxTurns: 300
	},

	city: {
		claimRadius: 3,          // hops of territory a city can claim
		tilesPerPop: 2,          // worked tiles per population point
		baseFoodPerPop: 2,       // food a pop eats per turn
		growthBase: 15,          // food surplus to grow pop 1->2
		growthPerPop: 8,         // extra food needed per existing pop
		maxPop: 20,
		fortifyDefenseBonus: 0.5,   // defense mult bonus when attacked across a city-adjacent edge
		wallsDefenseBonus: 0.75,    // additional bonus from Walls
		cityBaseStrength: 8,
		cityStrengthPerPop: 0.6,
		cityMaxHP: 100,
		cityHealPerTurn: 10,
		captureRazePop: 0.5      // pop fraction kept when captured
	},

	territory: {
		occupationTurnsToFlip: 4,   // turns a hostile unit must hold a tile to annex it
		occupationDecay: 1          // occupation progress lost per turn unguarded
	},

	yields: {
		foodPerCalorie: 3.0,     // food yield multiplier on tile 'calories' (0..~1300 scaled)
		prodTimber: 3.0,         // production per timber suitability
		prodMinerals: 4.0,       // production per (iron+copper) suitability
		prodHills: 1.0,          // flat production on hills/mountains
		prodBase: 0.5,           // production floor per worked land tile
		goldRiver: 0.5,          // gold per worked river tile
		goldCoast: 0.5,          // gold per worked coast-adjacent tile
		sciencePerPop: 1.0,
		scienceCapital: 2.0
	},

	tech: {
		classicalCost: 220,      // accumulated science to reach Classical era
		imperialCost: 600        // a further era to keep long games interesting
	},

	units: {
		movePoints: 12,           // movement budget per turn (edge costs below)
		settlerCost: 40,
		militiaCost: 25,
		legionCost: 45,
		militiaStrength: 10,
		legionStrength: 17,
		settlerMaintenance: 0.5,  // gold upkeep per turn
		unitMaintenance: 1.0,
		maxUnitsPerPlayer: 18,
		healPerTurnFriendly: 15
	},

	movement: {
		flatCost: 3,             // land edge base
		hillsCost: 5,
		mountainCost: 9,
		forestExtra: 1,
		riverNoBridgeCost: 10,   // stepping across/onto river without a bridge
		roadFactor: 0.5,         // multiplies edge cost when a road exists
		impassableMountains: false
	},

	build: {
		roadCostGold: 6,         // per edge
		bridgeCostGold: 18,      // per river edge (in addition to road)
		wallsCost: 60,           // production
		marketCost: 50,          // production; +route slots & capacity
		granaryCost: 40          // production; +food kept on growth
	},

	combat: {
		damageBase: 30,          // damage at equal strength
		damageSpread: 0.25,      // +- randomness fraction
		strengthScale: 8,        // e^(diff/scale) damage curve
		terrainDefHills: 0.25,
		terrainDefForest: 0.2,
		terrainDefMountain: 0.4,
		cityAttackerPenalty: 0.0
	},

	trade: {
		// prices
		priceElasticity: 0.7,    // price = base * (demand/supply)^elasticity
		priceMin: 0.25,          // x base
		priceMax: 4.0,           // x base
		demandPerPop: 1.0,       // generic demand units per pop per commodity group weight
		luxuryDemandPerPop: 0.35,// gold/silver demand
		mineralDemandPerPop: 0.6,// iron/copper demand (military economies want more)
		supplySoftener: 0.5,     // added to supply to damp division

		// routes
		routesPerCity: 2,        // base outgoing route slots
		marketExtraRoutes: 1,
		routeCapacity: 6,        // units of goods per turn
		marketCapacityBonus: 3,
		transportCostPerMove: 0.012, // gold per unit per accumulated edge move-cost
		seaMoveFactor: 0.5,      // sea edges are cheaper for trade
		portCost: 2,             // embark/disembark surcharge on coast edges
		minRouteMargin: 0.15,    // don't run routes below this margin per unit
		maxRouteLength: 220,     // path cost cap for route search

		// tolls
		tollMax: 1.0,            // max toll per foreign-territory tile crossed
		tollDefault: 0.1,

		// subsidies
		subsidyMax: 3.0,         // max per-unit subsidy on a commodity in a city
		subsidyStep: 0.25,

		// crop knowledge spread
		nativeThreshold: 0.25,   // avg region suitability for a crop to start as native
		spreadPerTurn: 0.04,     // familiarity gained per turn per importing route
		spreadThreshold: 1.0,    // familiarity needed to learn a crop/animal

		// piracy & banditry
		trafficDecay: 0.9,       // per-turn decay of tile traffic memory
		remoteDistance: 4,       // min hops from any territory to be "remote"
		campSpawnTraffic: 8,     // traffic level enabling camp spawn
		campSpawnChance: 0.08,   // per eligible tile per turn
		campMinSeparation: 6,    // hops between camps
		campRaidRadius: 2,       // camps raid routes passing within this
		campLootFraction: 0.35,  // share of route value stolen per raid
		campStrengthBase: 8,
		campStrengthGrowth: 0.35,// per turn, fed by loot
		campMaxCount: 12,
		riskPremiumPerCamp: 8    // pathing cost penalty per nearby camp
	},

	ui: {
		autoplayDelayMs: 150,
		logLength: 120
	}
};

// ---------------------------------------------------------------------------
// Commodities: which map layers are tradeable and how they behave.
// kind: crop/animal need knowledge to produce; gather/mineral do not.
// ---------------------------------------------------------------------------
var COMMODITIES = [
	{ id: "wheat",     layer: "wheat",   kind: "crop",    basePrice: 1.0, demandGroup: "food" },
	{ id: "corn",      layer: "corn",    kind: "crop",    basePrice: 1.0, demandGroup: "food" },
	{ id: "rice",      layer: "rice",    kind: "crop",    basePrice: 1.0, demandGroup: "food" },
	{ id: "livestock", layer: "pasture", kind: "animal",  basePrice: 1.4, demandGroup: "food" },
	{ id: "fish",      layer: "fish",    kind: "gather",  basePrice: 1.2, demandGroup: "food" },
	{ id: "timber",    layer: "timber",  kind: "gather",  basePrice: 0.8, demandGroup: "material" },
	{ id: "iron",      layer: "iron",    kind: "mineral", basePrice: 2.5, demandGroup: "mineral" },
	{ id: "copper",    layer: "copper",  kind: "mineral", basePrice: 2.2, demandGroup: "mineral" },
	{ id: "gold",      layer: "gold",    kind: "mineral", basePrice: 5.0, demandGroup: "luxury" },
	{ id: "silver",    layer: "silver",  kind: "mineral", basePrice: 4.0, demandGroup: "luxury" }
];

// ---------------------------------------------------------------------------
// Tuning-panel schema: group, path into GameConfig, range. The panel builds
// itself from this list (see ui.js), so tweak freely.
// ---------------------------------------------------------------------------
var CONFIG_SCHEMA = [
	{ g: "Setup", p: "setup.numPlayers", min: 2, max: 8, step: 1 },
	{ g: "Setup", p: "setup.minStartDistance", min: 4, max: 30, step: 1 },
	{ g: "Setup", p: "setup.maxTurns", min: 50, max: 1000, step: 10 },

	{ g: "City", p: "city.claimRadius", min: 1, max: 5, step: 1 },
	{ g: "City", p: "city.tilesPerPop", min: 1, max: 4, step: 1 },
	{ g: "City", p: "city.baseFoodPerPop", min: 0.5, max: 5, step: 0.25 },
	{ g: "City", p: "city.growthBase", min: 5, max: 40, step: 1 },
	{ g: "City", p: "city.growthPerPop", min: 0, max: 25, step: 1 },
	{ g: "City", p: "city.maxPop", min: 5, max: 40, step: 1 },
	{ g: "City", p: "city.fortifyDefenseBonus", min: 0, max: 2, step: 0.05 },
	{ g: "City", p: "city.wallsDefenseBonus", min: 0, max: 2, step: 0.05 },
	{ g: "City", p: "city.cityBaseStrength", min: 2, max: 30, step: 1 },
	{ g: "City", p: "city.cityHealPerTurn", min: 0, max: 30, step: 1 },

	{ g: "Territory", p: "territory.occupationTurnsToFlip", min: 1, max: 15, step: 1 },
	{ g: "Territory", p: "territory.occupationDecay", min: 0, max: 5, step: 1 },

	{ g: "Yields", p: "yields.foodPerCalorie", min: 0.5, max: 8, step: 0.1 },
	{ g: "Yields", p: "yields.prodTimber", min: 0, max: 8, step: 0.1 },
	{ g: "Yields", p: "yields.prodMinerals", min: 0, max: 10, step: 0.1 },
	{ g: "Yields", p: "yields.prodHills", min: 0, max: 4, step: 0.1 },
	{ g: "Yields", p: "yields.sciencePerPop", min: 0, max: 5, step: 0.1 },

	{ g: "Tech", p: "tech.classicalCost", min: 50, max: 1000, step: 10 },
	{ g: "Tech", p: "tech.imperialCost", min: 200, max: 3000, step: 25 },

	{ g: "Units", p: "units.movePoints", min: 4, max: 30, step: 1 },
	{ g: "Units", p: "units.settlerCost", min: 10, max: 120, step: 5 },
	{ g: "Units", p: "units.militiaCost", min: 10, max: 100, step: 5 },
	{ g: "Units", p: "units.legionCost", min: 15, max: 150, step: 5 },
	{ g: "Units", p: "units.militiaStrength", min: 4, max: 30, step: 1 },
	{ g: "Units", p: "units.legionStrength", min: 6, max: 50, step: 1 },
	{ g: "Units", p: "units.maxUnitsPerPlayer", min: 4, max: 60, step: 1 },

	{ g: "Movement", p: "movement.flatCost", min: 1, max: 10, step: 1 },
	{ g: "Movement", p: "movement.hillsCost", min: 1, max: 15, step: 1 },
	{ g: "Movement", p: "movement.mountainCost", min: 2, max: 30, step: 1 },
	{ g: "Movement", p: "movement.riverNoBridgeCost", min: 0, max: 30, step: 1 },
	{ g: "Movement", p: "movement.roadFactor", min: 0.1, max: 1, step: 0.05 },

	{ g: "Build", p: "build.roadCostGold", min: 1, max: 30, step: 1 },
	{ g: "Build", p: "build.bridgeCostGold", min: 2, max: 80, step: 2 },
	{ g: "Build", p: "build.wallsCost", min: 10, max: 200, step: 5 },
	{ g: "Build", p: "build.marketCost", min: 10, max: 200, step: 5 },

	{ g: "Combat", p: "combat.damageBase", min: 10, max: 60, step: 2 },
	{ g: "Combat", p: "combat.damageSpread", min: 0, max: 0.6, step: 0.05 },
	{ g: "Combat", p: "combat.strengthScale", min: 3, max: 20, step: 1 },
	{ g: "Combat", p: "combat.terrainDefHills", min: 0, max: 1, step: 0.05 },
	{ g: "Combat", p: "combat.terrainDefForest", min: 0, max: 1, step: 0.05 },

	{ g: "Trade: prices", p: "trade.priceElasticity", min: 0.1, max: 2, step: 0.05 },
	{ g: "Trade: prices", p: "trade.priceMin", min: 0.05, max: 1, step: 0.05 },
	{ g: "Trade: prices", p: "trade.priceMax", min: 1, max: 10, step: 0.25 },
	{ g: "Trade: prices", p: "trade.demandPerPop", min: 0.1, max: 4, step: 0.1 },
	{ g: "Trade: prices", p: "trade.luxuryDemandPerPop", min: 0, max: 2, step: 0.05 },
	{ g: "Trade: prices", p: "trade.mineralDemandPerPop", min: 0, max: 3, step: 0.05 },

	{ g: "Trade: routes", p: "trade.routesPerCity", min: 0, max: 6, step: 1 },
	{ g: "Trade: routes", p: "trade.routeCapacity", min: 1, max: 30, step: 1 },
	{ g: "Trade: routes", p: "trade.transportCostPerMove", min: 0, max: 0.1, step: 0.002 },
	{ g: "Trade: routes", p: "trade.seaMoveFactor", min: 0.1, max: 2, step: 0.05 },
	{ g: "Trade: routes", p: "trade.minRouteMargin", min: 0, max: 2, step: 0.05 },

	{ g: "Trade: tolls", p: "trade.tollMax", min: 0, max: 4, step: 0.1 },

	{ g: "Trade: subsidies", p: "trade.subsidyMax", min: 0, max: 8, step: 0.25 },

	{ g: "Trade: knowledge", p: "trade.nativeThreshold", min: 0.05, max: 0.8, step: 0.05 },
	{ g: "Trade: knowledge", p: "trade.spreadPerTurn", min: 0, max: 0.3, step: 0.01 },

	{ g: "Pirates & bandits", p: "trade.remoteDistance", min: 1, max: 12, step: 1 },
	{ g: "Pirates & bandits", p: "trade.campSpawnTraffic", min: 1, max: 40, step: 1 },
	{ g: "Pirates & bandits", p: "trade.campSpawnChance", min: 0, max: 0.5, step: 0.01 },
	{ g: "Pirates & bandits", p: "trade.campRaidRadius", min: 1, max: 5, step: 1 },
	{ g: "Pirates & bandits", p: "trade.campLootFraction", min: 0, max: 1, step: 0.05 },
	{ g: "Pirates & bandits", p: "trade.campStrengthGrowth", min: 0, max: 2, step: 0.05 },
	{ g: "Pirates & bandits", p: "trade.campMaxCount", min: 0, max: 40, step: 1 },
	{ g: "Pirates & bandits", p: "trade.riskPremiumPerCamp", min: 0, max: 40, step: 1 }
];

function configGet(path) {
	var parts = path.split("."), o = GameConfig;
	for (var i = 0; i < parts.length; i++) o = o[parts[i]];
	return o;
}
function configSet(path, v) {
	var parts = path.split("."), o = GameConfig;
	for (var i = 0; i < parts.length - 1; i++) o = o[parts[i]];
	o[parts[parts.length - 1]] = v;
}
