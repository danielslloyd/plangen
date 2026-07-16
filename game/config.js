// config.js — every tunable number in the game lives here.
// The Tuning tab auto-generates sliders from CONFIG_SCHEMA, so adding a new
// tunable = add the value + one schema row. AI personalities are in ai.js
// (AI_PERSONALITY_SCHEMA) and are equally slider-tunable per player.

var GameConfig = {
	// Each new game dynamic is behind its own flag (1 = on, 0 = off) so they
	// can be kept or dropped independently. Toggles live in the Tuning tab
	// ("Features" group); most take effect from the next new game.
	features: {
		persistentOrders: 1,    // units keep a destination across turns
		unitStackLimit: 3,      // max own ground/sea units per tile (0 = unlimited)
		edgeFortifications: 1,  // fortify/wall individual edges
		timedEras: 1,           // eras advance on a fixed turn schedule (science scrapped)
		settlementMissions: 1,  // found cities via gold+pop missions instead of settler builds
		recruitment: 1,         // per-type army quotas; your cities auto-produce to fill them
		tilePopulation: 1,      // per-tile population drives food demand + city "goods"
		policies: 1,            // player-level policy sliders replace per-city building micro
		merchants: 1,           // concrete caravan/fleet agents replace abstract trade routes
		powerups: 1             // periodic civ power-up picks (trade/military/building/growth)
	},

	// Merchant agents (features.merchants): caravans and fleets are spawned by
	// cities, plan round trips from remembered prices, and bank profit into the
	// origin city's wealth (which feeds growth).
	merchant: {
		caravanGoldCost: 10,
		caravanPopCost: 1,
		caravanNeedsLivestock: 0.5, // home supply of livestock (horses/camels)
		fleetGoldCost: 40,          // covers timber fittings, cloth sails, wages
		fleetPopCost: 1,
		fleetNeedsTimber: 0.5,      // home supply of timber
		caravanCapacity: 8,         // units of cargo
		fleetCapacity: 16,
		caravanSpeed: 8,            // path-cost budget per turn
		fleetSpeed: 16,
		minExpectedReturn: 4,       // gold per round trip to bother leaving
		priceMemAlpha: 0.1,         // EMA weight of the latest observed price
		maxPerCity: 2,              // merchant slots per city (+openness/power-ups)
		wealthFoodFactor: 0.4,      // city wealth spent -> bonus food (growth)
		wealthSpendRate: 0.2,       // fraction of wealth a city can spend per turn
		// Tolling: 0 = per-tile toll GATES (⛩, each gated tile charges per
		// passage), 1 = territory-wide ENTRANCE FEE (charged once per trip on
		// first entry). Both scale off the owner's toll-rate slider.
		tollMode: 0,
		gateScale: 2.0,             // per-gate charge = ownerTollRate x scale
		entranceFeeScale: 10        // entrance fee = ownerTollRate x scale
	},

	// Power-ups (features.powerups): every N turns each civ picks one.
	powerups: {
		everyTurns: 75,
		startPicks: 1
	},

	// Timed eras (features.timedEras): each era lasts a defined number of turns.
	eras: {
		classicalTurns: 250,
		napoleonicTurns: 300     // WW2 starts at classicalTurns + napoleonicTurns
	},

	// Edge fortifications (features.edgeFortifications).
	fort: {
		fortCostGold: 8,         // dig in on one edge
		wallCostGold: 26,        // stone wall on one edge (permanent)
		upgradeDiscount: 0.4,    // fort -> wall upgrade costs (1 - discount) * wallCost
		fortDefenseBonus: 0.35,  // defense mult bonus behind a manned fortification
		wallDefenseBonus: 0.7,
		decayTurns: 5            // unmanned fortifications crumble after this many turns
	},

	// Settlement missions (features.settlementMissions).
	settle: {
		goldCost: 60,
		popCost: 1               // population drawn from the nearest city (pop must stay >= 1)
	},

	// Tile population (features.tilePopulation).
	population: {
		popPerFood: 6,           // rural pop per point of best food suitability
		ruralFoodDemandPerPop: 0.12, // rural pop adds to the governing city's food demand
		goodsPerPop: 0.5,        // city "goods" output per pop (x wealth factor)
		goodsDemandPerPop: 0.3,  // everyone wants manufactured goods (more each era)
		ruralGoodsDemandFactor: 0.04
	},

	// Player-level policies (features.policies), each 0..1.
	policy: {
		taxGoldPerPop: 0.15,     // taxation: gold per pop per turn at slider 1
		taxGrowthPenalty: 0.35,  // taxation: food-surplus fraction lost at slider 1
		milUnitCostDiscount: 0.25, // militarism: unit production discount at slider 1
		milWallsBonus: 0.6,      // militarism: city defense bonus at slider 1
		openRouteSlots: 2,       // openness: extra route slots at slider 1
		openSpreadBonus: 1.0,    // openness: crop-knowledge spread multiplier bonus
		infraGranaryKeep: 0.5    // infrastructure: food kept on growth at slider 1
	},

	setup: {
		numPlayers: 4,
		humanPlayer: 0,          // -1 = spectate (all AI)
		// Per-slot control, built by the setup screen. Each entry:
		// { control: "human"|"ai", preset: <AI_PRESETS key or "random"> }.
		// When null, numPlayers slots are generated (slot humanPlayer = human).
		players: null,
		humanStartPick: true,    // humans click their starting tile on the map
		npcFill: true,           // fill sparse land with city-states & bandit camps
		npcLandPerEntity: 150,   // land tiles per major+minor entity ("sparse" gauge)
		npcMaxCityStates: 6,
		npcBanditLandDivisor: 400, // one starting bandit camp per this many land tiles
		minStartDistance: 12,    // hops between starting positions
		minHumanStartDistance: 7,// hops a human pick must keep from other capitals
		startSettlers: 1,
		startGold: 50,
		maxTurns: 1500
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

	diplomacy: {
		tileValueScale: 2.5,     // gold value multiplier for a ceded tile's yields
		peaceBaseValue: 25,      // baseline value of peace to a war-weary side
		tributeDiscount: 0.7,    // present value per gold of promised future tribute
		acceptMarginBase: 1.1,   // AI accepts when value received >= given * margin
		offerCooldown: 8,        // turns between AI offers to the same player
		offerExpiry: 6,          // turns a pending offer stays on the table
		demandChance: 0.05,      // per-turn chance an aggressive stronger AI demands tribute
		threatWeight: 60         // value of avoiding war with a stronger power
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
		sciencePerPop: 0.25,
		scienceCapital: 0.5
	},

	// Era pacing: with the slowed science yields above, each era is meant to
	// take a few hundred turns to play out at default settings.
	tech: {
		napoleonicCost: 3500,    // accumulated science to reach the Napoleonic era
		ww2Cost: 12000           // ... and the WW2 era
	},

	units: {
		movePoints: 12,           // base movement budget per turn (× type moves factor)
		settlerCost: 40,
		settlerMaintenance: 0.5,  // gold upkeep per turn
		unitMaintenance: 1.0,
		maxUnitsPerPlayer: 28,
		healPerTurnFriendly: 15,
		// per-type cost / strength / speed factor (era, domain & needs live in
		// UNIT_TYPES). Designable ship/plane stats are further scaled per player.
		stats: {
			// Classical
			militia:    { cost: 25,  str: 10, moves: 1.0 },
			legion:     { cost: 45,  str: 18, moves: 1.0 },
			cavalry:    { cost: 55,  str: 20, moves: 1.7 },
			trireme:    { cost: 40,  str: 12, moves: 1.4 },
			// Napoleonic
			nInfantry:  { cost: 60,  str: 30, moves: 1.0 },
			nCavalry:   { cost: 80,  str: 34, moves: 1.7 },
			artillery:  { cost: 90,  str: 26, moves: 0.8 },
			shipOfLine: { cost: 110, str: 40, moves: 1.2 },
			frigate:    { cost: 75,  str: 26, moves: 1.8 },
			// WW2
			wInfantry:  { cost: 70,  str: 42, moves: 1.0 },
			wArtillery: { cost: 100, str: 40, moves: 0.9 },
			armor:      { cost: 130, str: 62, moves: 1.8 },
			destroyer:  { cost: 120, str: 50, moves: 2.0 },
			carrier:    { cost: 200, str: 28, moves: 1.4 },
			fighter:    { cost: 100, str: 34, moves: 0 },
			bomber:     { cost: 130, str: 44, moves: 0 }
		}
	},

	// Amphibious transport, opposed-landing penalty, and WW2 infantry training.
	amphibious: {
		transportCost: 5,        // movement cost per water edge for a land unit at sea
		embarkCost: 12,          // extra cost stepping from land onto water (stops units
		                         // "shortcutting" over the sea instead of crossing a river)
		embarkedPenalty: 0.3,    // strength mult while a land unit sits on water
		landingPenaltyTurns: 3,  // turns of reduced strength after an untrained landing
		landingPenalty: 0.45,    // strength mult on the landing turn (ramps back to 1)
		trainAmphibiousCost: 45, // gold to train a unit for amphibious landings
		trainAirborneCost: 60,   // gold to train WW2 infantry as airborne
		paradropRange: 12        // tiles an airborne unit can drop (consumes fuel)
	},

	// Configurable design classes for Napoleonic+ ships and WW2 ships/planes.
	design: {
		retoolTurns: 4,          // turns of production penalty after changing a design
		retoolPenalty: 0.45,     // extra production cost fraction while retooling
		attrMin: 0.6,            // design attribute range (1.0 = balanced baseline)
		attrMax: 1.6,
		costBase: 0.4            // cost = base*(costBase + (1-costBase)/2*(a+b))
	},

	// Supply lines: every unit draws its needs from the nearest friendly city.
	// Delivering 1 unit of a resource costs its base price plus a per-hop
	// surcharge — long supply lines are expensive; cut ones starve the army.
	supply: {
		foodCost: 0.15,          // gold per unit of food delivered
		ammoCost: 0.35,          // gold per unit of ammunition
		fuelCost: 0.45,          // gold per unit of fuel
		perHop: 0.10,            // +10% delivery cost per supply-line hop
		maxRange: 22,            // hops beyond which units are out of supply
		attritionPerTurn: 12,    // hp lost per turn without food
		noAmmoPenalty: 0.45,     // strength multiplier when ammunition ran out
		noFuelPenalty: 0.35      // movement multiplier when fuel ran out
	},

	air: {
		strikeRange: 9,          // tiles an air unit can strike from its base
		ferryRange: 25,          // tiles it can rebase between friendly cities
		aaDamage: 12,            // flak damage taken striking a defended tile
		interceptChance: 0.45,   // enemy fighter in range intercepts a strike
		bomberCityBonus: 1.6     // bomber strength multiplier vs cities
	},

	movement: {
		flatCost: 3,             // land edge base
		hillsCost: 5,
		mountainCost: 9,
		forestExtra: 1,
		riverNoBridgeCost: 10,   // stepping across/onto river without a bridge
		roadFactor: 0.5,         // multiplies edge cost when a road exists
		seaCost: 2,              // per water edge for naval units
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
		cityAttackerPenalty: 0.0,
		siegeCityBonus: 1.9,     // artillery strength multiplier vs cities
		siegeCounterFactor: 0.35 // counter-damage artillery takes attacking (bombard)
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
	{ id: "silver",    layer: "silver",  kind: "mineral", basePrice: 4.0, demandGroup: "luxury" },
	// Manufactured in cities (no map layer): output scales with population and
	// wealth; demanded everywhere. Only flows when features.tilePopulation is on.
	{ id: "goods",     layer: null,      kind: "manufactured", basePrice: 2.0, demandGroup: "goods" }
];

// ---------------------------------------------------------------------------
// Tuning-panel schema: group, path into GameConfig, range. The panel builds
// itself from this list (see ui.js), so tweak freely.
// ---------------------------------------------------------------------------
var CONFIG_SCHEMA = [
	{ g: "Features (0=off 1=on)", p: "features.persistentOrders", min: 0, max: 1, step: 1 },
	{ g: "Features (0=off 1=on)", p: "features.unitStackLimit", min: 0, max: 6, step: 1 },
	{ g: "Features (0=off 1=on)", p: "features.edgeFortifications", min: 0, max: 1, step: 1 },
	{ g: "Features (0=off 1=on)", p: "features.timedEras", min: 0, max: 1, step: 1 },
	{ g: "Features (0=off 1=on)", p: "features.settlementMissions", min: 0, max: 1, step: 1 },
	{ g: "Features (0=off 1=on)", p: "features.recruitment", min: 0, max: 1, step: 1 },
	{ g: "Features (0=off 1=on)", p: "features.tilePopulation", min: 0, max: 1, step: 1 },
	{ g: "Features (0=off 1=on)", p: "features.policies", min: 0, max: 1, step: 1 },
	{ g: "Features (0=off 1=on)", p: "features.merchants", min: 0, max: 1, step: 1 },
	{ g: "Features (0=off 1=on)", p: "features.powerups", min: 0, max: 1, step: 1 },

	{ g: "Merchants", p: "merchant.tollMode", min: 0, max: 1, step: 1 },
	{ g: "Merchants", p: "merchant.caravanGoldCost", min: 0, max: 80, step: 5 },
	{ g: "Merchants", p: "merchant.fleetGoldCost", min: 0, max: 200, step: 5 },
	{ g: "Merchants", p: "merchant.caravanCapacity", min: 1, max: 40, step: 1 },
	{ g: "Merchants", p: "merchant.fleetCapacity", min: 1, max: 80, step: 1 },
	{ g: "Merchants", p: "merchant.caravanSpeed", min: 2, max: 30, step: 1 },
	{ g: "Merchants", p: "merchant.fleetSpeed", min: 2, max: 40, step: 1 },
	{ g: "Merchants", p: "merchant.minExpectedReturn", min: 0, max: 30, step: 1 },
	{ g: "Merchants", p: "merchant.maxPerCity", min: 0, max: 8, step: 1 },
	{ g: "Merchants", p: "merchant.gateScale", min: 0, max: 10, step: 0.5 },
	{ g: "Merchants", p: "merchant.entranceFeeScale", min: 0, max: 40, step: 1 },
	{ g: "Merchants", p: "merchant.wealthFoodFactor", min: 0, max: 2, step: 0.05 },

	{ g: "Power-ups", p: "powerups.everyTurns", min: 10, max: 300, step: 5 },

	{ g: "Eras (timed)", p: "eras.classicalTurns", min: 20, max: 1000, step: 10 },
	{ g: "Eras (timed)", p: "eras.napoleonicTurns", min: 20, max: 1000, step: 10 },

	{ g: "Fortifications", p: "fort.fortCostGold", min: 0, max: 50, step: 1 },
	{ g: "Fortifications", p: "fort.wallCostGold", min: 0, max: 120, step: 2 },
	{ g: "Fortifications", p: "fort.upgradeDiscount", min: 0, max: 1, step: 0.05 },
	{ g: "Fortifications", p: "fort.fortDefenseBonus", min: 0, max: 2, step: 0.05 },
	{ g: "Fortifications", p: "fort.wallDefenseBonus", min: 0, max: 2, step: 0.05 },
	{ g: "Fortifications", p: "fort.decayTurns", min: 1, max: 20, step: 1 },

	{ g: "Settlement", p: "settle.goldCost", min: 0, max: 300, step: 5 },

	{ g: "Population", p: "population.popPerFood", min: 0, max: 20, step: 0.5 },
	{ g: "Population", p: "population.ruralFoodDemandPerPop", min: 0, max: 1, step: 0.02 },
	{ g: "Population", p: "population.goodsPerPop", min: 0, max: 3, step: 0.05 },
	{ g: "Population", p: "population.goodsDemandPerPop", min: 0, max: 2, step: 0.05 },

	{ g: "Policies", p: "policy.taxGoldPerPop", min: 0, max: 1, step: 0.05 },
	{ g: "Policies", p: "policy.taxGrowthPenalty", min: 0, max: 1, step: 0.05 },
	{ g: "Policies", p: "policy.milUnitCostDiscount", min: 0, max: 0.8, step: 0.05 },
	{ g: "Policies", p: "policy.milWallsBonus", min: 0, max: 2, step: 0.05 },
	{ g: "Policies", p: "policy.openRouteSlots", min: 0, max: 5, step: 1 },
	{ g: "Policies", p: "policy.infraGranaryKeep", min: 0, max: 1, step: 0.05 },

	{ g: "Setup", p: "setup.minStartDistance", min: 4, max: 30, step: 1 },
	{ g: "Setup", p: "setup.maxTurns", min: 50, max: 3000, step: 50 },
	{ g: "Setup", p: "setup.npcLandPerEntity", min: 100, max: 1200, step: 25 },
	{ g: "Setup", p: "setup.npcMaxCityStates", min: 0, max: 12, step: 1 },

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

	{ g: "Diplomacy", p: "diplomacy.tileValueScale", min: 0.5, max: 10, step: 0.25 },
	{ g: "Diplomacy", p: "diplomacy.peaceBaseValue", min: 0, max: 150, step: 5 },
	{ g: "Diplomacy", p: "diplomacy.tributeDiscount", min: 0.1, max: 1, step: 0.05 },
	{ g: "Diplomacy", p: "diplomacy.acceptMarginBase", min: 1, max: 2, step: 0.05 },
	{ g: "Diplomacy", p: "diplomacy.demandChance", min: 0, max: 0.3, step: 0.01 },
	{ g: "Diplomacy", p: "diplomacy.threatWeight", min: 0, max: 200, step: 5 },

	{ g: "Territory", p: "territory.occupationTurnsToFlip", min: 1, max: 15, step: 1 },
	{ g: "Territory", p: "territory.occupationDecay", min: 0, max: 5, step: 1 },

	{ g: "Yields", p: "yields.foodPerCalorie", min: 0.5, max: 8, step: 0.1 },
	{ g: "Yields", p: "yields.prodTimber", min: 0, max: 8, step: 0.1 },
	{ g: "Yields", p: "yields.prodMinerals", min: 0, max: 10, step: 0.1 },
	{ g: "Yields", p: "yields.prodHills", min: 0, max: 4, step: 0.1 },
	{ g: "Yields", p: "yields.sciencePerPop", min: 0, max: 5, step: 0.05 },
	{ g: "Yields", p: "yields.scienceCapital", min: 0, max: 5, step: 0.05 },

	{ g: "Tech", p: "tech.napoleonicCost", min: 50, max: 10000, step: 50 },
	{ g: "Tech", p: "tech.ww2Cost", min: 200, max: 30000, step: 100 },

	{ g: "Units", p: "units.movePoints", min: 4, max: 30, step: 1 },
	{ g: "Units", p: "units.settlerCost", min: 10, max: 120, step: 5 },
	{ g: "Units", p: "units.maxUnitsPerPlayer", min: 4, max: 60, step: 1 },
	// per-unit cost/str rows are appended programmatically below.

	{ g: "Amphibious", p: "amphibious.transportCost", min: 1, max: 15, step: 1 },
	{ g: "Amphibious", p: "amphibious.embarkCost", min: 0, max: 30, step: 1 },
	{ g: "Amphibious", p: "amphibious.embarkedPenalty", min: 0.1, max: 1, step: 0.05 },
	{ g: "Amphibious", p: "amphibious.landingPenaltyTurns", min: 0, max: 8, step: 1 },
	{ g: "Amphibious", p: "amphibious.landingPenalty", min: 0.1, max: 1, step: 0.05 },
	{ g: "Amphibious", p: "amphibious.trainAmphibiousCost", min: 0, max: 150, step: 5 },
	{ g: "Amphibious", p: "amphibious.trainAirborneCost", min: 0, max: 150, step: 5 },
	{ g: "Amphibious", p: "amphibious.paradropRange", min: 3, max: 30, step: 1 },

	{ g: "Design", p: "design.retoolTurns", min: 0, max: 12, step: 1 },
	{ g: "Design", p: "design.retoolPenalty", min: 0, max: 1, step: 0.05 },

	{ g: "Supply", p: "supply.foodCost", min: 0, max: 1, step: 0.05 },
	{ g: "Supply", p: "supply.ammoCost", min: 0, max: 2, step: 0.05 },
	{ g: "Supply", p: "supply.fuelCost", min: 0, max: 2, step: 0.05 },
	{ g: "Supply", p: "supply.perHop", min: 0, max: 0.5, step: 0.01 },
	{ g: "Supply", p: "supply.maxRange", min: 4, max: 60, step: 1 },
	{ g: "Supply", p: "supply.attritionPerTurn", min: 0, max: 40, step: 1 },
	{ g: "Supply", p: "supply.noAmmoPenalty", min: 0.1, max: 1, step: 0.05 },
	{ g: "Supply", p: "supply.noFuelPenalty", min: 0.1, max: 1, step: 0.05 },

	{ g: "Air", p: "air.strikeRange", min: 3, max: 25, step: 1 },
	{ g: "Air", p: "air.ferryRange", min: 5, max: 60, step: 1 },
	{ g: "Air", p: "air.aaDamage", min: 0, max: 40, step: 1 },
	{ g: "Air", p: "air.interceptChance", min: 0, max: 1, step: 0.05 },
	{ g: "Air", p: "air.bomberCityBonus", min: 1, max: 4, step: 0.1 },

	{ g: "Movement", p: "movement.flatCost", min: 1, max: 10, step: 1 },
	{ g: "Movement", p: "movement.hillsCost", min: 1, max: 15, step: 1 },
	{ g: "Movement", p: "movement.mountainCost", min: 2, max: 30, step: 1 },
	{ g: "Movement", p: "movement.riverNoBridgeCost", min: 0, max: 30, step: 1 },
	{ g: "Movement", p: "movement.roadFactor", min: 0.1, max: 1, step: 0.05 },
	{ g: "Movement", p: "movement.seaCost", min: 1, max: 10, step: 0.5 },

	{ g: "Build", p: "build.roadCostGold", min: 1, max: 30, step: 1 },
	{ g: "Build", p: "build.bridgeCostGold", min: 2, max: 80, step: 2 },
	{ g: "Build", p: "build.wallsCost", min: 10, max: 200, step: 5 },
	{ g: "Build", p: "build.marketCost", min: 10, max: 200, step: 5 },

	{ g: "Combat", p: "combat.damageBase", min: 10, max: 60, step: 2 },
	{ g: "Combat", p: "combat.damageSpread", min: 0, max: 0.6, step: 0.05 },
	{ g: "Combat", p: "combat.strengthScale", min: 3, max: 20, step: 1 },
	{ g: "Combat", p: "combat.terrainDefHills", min: 0, max: 1, step: 0.05 },
	{ g: "Combat", p: "combat.terrainDefForest", min: 0, max: 1, step: 0.05 },
	{ g: "Combat", p: "combat.siegeCityBonus", min: 1, max: 4, step: 0.1 },
	{ g: "Combat", p: "combat.siegeCounterFactor", min: 0, max: 1, step: 0.05 },

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

// Per-unit cost/strength sliders, generated from the stats table so the roster
// stays the single source of truth (grouped under "Units: <era>").
(function () {
	var eraOf = { militia: "Classical", legion: "Classical", cavalry: "Classical", trireme: "Classical",
		nInfantry: "Napoleonic", nCavalry: "Napoleonic", artillery: "Napoleonic", shipOfLine: "Napoleonic", frigate: "Napoleonic",
		wInfantry: "WW2", wArtillery: "WW2", armor: "WW2", destroyer: "WW2", carrier: "WW2", fighter: "WW2", bomber: "WW2" };
	Object.keys(GameConfig.units.stats).forEach(function (id) {
		var g = "Units: " + (eraOf[id] || "?");
		CONFIG_SCHEMA.push({ g: g, p: "units.stats." + id + ".cost", min: 10, max: 400, step: 5 });
		CONFIG_SCHEMA.push({ g: g, p: "units.stats." + id + ".str", min: 4, max: 120, step: 2 });
	});
})();

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
