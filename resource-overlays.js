// Resource & Food color overlays (extracted from generatePlanetRenderData_functions.js).
//
// LOAD ORDER: this file MUST load AFTER generatePlanetRenderData_functions.js, which
// defines the globals these overlays rely on at registration/runtime:
//   registerColorOverlay, calculateTerrainColor, getOverlayAggregate, cartesianToSpherical.
// All overlay color functions only run when an overlay is applied (runtime), so the
// only load-time requirement is that registerColorOverlay already exists.

// ---- Food overlays (crops + calories) ------------------------------------

function calculateCornColor(tile) {
	var terrainColor = calculateTerrainColor(tile);
	var magenta = new THREE.Color(0xFF00FF);
	var cornValue = Math.min(1, Math.max(0, tile.corn || 0));
	return terrainColor.clone().lerp(magenta, cornValue);
}

function calculateWheatColor(tile) {
	var terrainColor = calculateTerrainColor(tile);
	var magenta = new THREE.Color(0xFF00FF);
	var wheatValue = Math.min(1, Math.max(0, tile.wheat || 0));
	return terrainColor.clone().lerp(magenta, wheatValue);
}

function calculateRiceColor(tile) {
	var terrainColor = calculateTerrainColor(tile);
	var magenta = new THREE.Color(0xFF00FF);
	var riceValue = Math.min(1, Math.max(0, tile.rice || 0));
	return terrainColor.clone().lerp(magenta, riceValue);
}

function calculateFishColor(tile) {
	var terrainColor = calculateTerrainColor(tile);
	var magenta = new THREE.Color(0xFF00FF);
	var fishValue = Math.min(1, Math.max(0, tile.fish || 0));
	return terrainColor.clone().lerp(magenta, fishValue);
}

function calculatePastureColor(tile) {
	var terrainColor = calculateTerrainColor(tile);
	var magenta = new THREE.Color(0xFF00FF);
	var pastureValue = Math.min(1, Math.max(0, tile.pasture || 0));
	return terrainColor.clone().lerp(magenta, pastureValue);
}

function calculateCaloriesColor(tile) {
	// Max calories across all tiles, computed once per planet (was O(N) per tile).
	var maxCalories = getOverlayAggregate("calories", function() {
		var m = 0, ts = planet.topology.tiles;
		for (var i = 0; i < ts.length; i++) { var v = ts[i].calories || 0; if (v > m) m = v; }
		return m;
	});

	// Normalize the current tile's calories value (0-1)
	var normalizedCalories = maxCalories > 0 ? (tile.calories || 0) / maxCalories : 0;
	normalizedCalories = Math.min(1, Math.max(0, normalizedCalories));

	// Lerp terrain color toward magenta based on normalized calories
	var terrainColor = calculateTerrainColor(tile);
	var magenta = new THREE.Color(0xFF00FF);
	return terrainColor.clone().lerp(magenta, normalizedCalories);
}

function calculateUpstreamCaloriesColor(tile) {
	// Max city priority score across all tiles, computed once per planet (was O(N) per tile).
	var maxCityPriorityScore = getOverlayAggregate("upstreamCalories", function() {
		var m = 0, ts = planet.topology.tiles;
		for (var i = 0; i < ts.length; i++) { var v = ts[i].cityPriorityScore || 0; if (v > m) m = v; }
		return m;
	});

	// Normalize the current tile's city priority score (0-1)
	var normalizedPriorityScore = maxCityPriorityScore > 0 ? (tile.cityPriorityScore || 0) / maxCityPriorityScore : 0;
	normalizedPriorityScore = Math.min(1, Math.max(0, normalizedPriorityScore));

	// Lerp terrain color toward magenta based on normalized city priority score
	var terrainColor = calculateTerrainColor(tile);
	var magenta = new THREE.Color(0xFF00FF);
	return terrainColor.clone().lerp(magenta, normalizedPriorityScore);
}

registerColorOverlay("corn", "Corn Resources", "Terrain colored toward magenta based on corn resource values", calculateCornColor, "lambert", "lazy", "food");
registerColorOverlay("wheat", "Wheat Resources", "Terrain colored toward magenta based on wheat resource values", calculateWheatColor, "lambert", "lazy", "food");
registerColorOverlay("rice", "Rice Resources", "Terrain colored toward magenta based on rice resource values", calculateRiceColor, "lambert", "lazy", "food");
registerColorOverlay("fish", "Fish Resources", "Terrain colored toward magenta based on fish resource values", calculateFishColor, "lambert", "lazy", "food");
registerColorOverlay("pasture", "Pasture Resources", "Terrain colored toward magenta based on pasture resource values", calculatePastureColor, "lambert", "lazy", "food");
registerColorOverlay("calories", "Calories (Normalized)", "Terrain colored toward magenta based on normalized calories values (max = 1)", calculateCaloriesColor, "lambert", "lazy", "food");
registerColorOverlay("upstreamCalories", "City Priority Score", "Terrain colored toward magenta based on city priority score (calorie flux + bonuses)", calculateUpstreamCaloriesColor, "lambert", "lazy", "food");

// ---- Strategic mineral resources -----------------------------------------

// Solid color per mineral resource (no longer striped; solid fill when present).
var stripeConfig = {
	coverage: 0.5,        // (legacy) fraction of tile covered when stripes were used
	stripeCount: 7,       // (legacy) stripes per average tile
	colors: {
		oil: '#000000',   // Black for oil
		gold: '#FFD700',  // Gold
		iron: '#8B4513',  // Brown for iron
		coal: '#2F2F2F',  // Dark gray for coal
		copper: '#B87333', // Copper
		silver: '#C0C0C0', // Silver
		uranium: '#00FF00' // Green for uranium
	}
};

// Generic resource solid color: terrain unless the resource is present, then its color.
function calculateResourceStripesColor(tile, resourceType) {
	var resourceValue = tile[resourceType] || 0;
	if (resourceValue <= 0) {
		return calculateTerrainColor(tile);
	}
	var resourceColor = stripeConfig.colors[resourceType] || '#FF00FF'; // Fallback to magenta
	return new THREE.Color(resourceColor);
}

function calculateOilStripesColor(tile)     { return calculateResourceStripesColor(tile, 'oil'); }
function calculateGoldStripesColor(tile)    { return calculateResourceStripesColor(tile, 'gold'); }
function calculateIronStripesColor(tile)    { return calculateResourceStripesColor(tile, 'iron'); }
function calculateCoalStripesColor(tile)    { return calculateResourceStripesColor(tile, 'coal'); }
function calculateCopperStripesColor(tile)  { return calculateResourceStripesColor(tile, 'copper'); }
function calculateSilverStripesColor(tile)  { return calculateResourceStripesColor(tile, 'silver'); }
function calculateUraniumStripesColor(tile) { return calculateResourceStripesColor(tile, 'uranium'); }

// Update stripe configuration at runtime (e.g. recolor resources).
function updateStripeConfig(newConfig) {
	if (newConfig.coverage !== undefined) stripeConfig.coverage = Math.max(0.0, Math.min(1.0, newConfig.coverage));
	if (newConfig.stripeCount !== undefined) stripeConfig.stripeCount = Math.max(1, Math.floor(newConfig.stripeCount));
	if (newConfig.colors !== undefined) {
		for (var resource in newConfig.colors) {
			stripeConfig.colors[resource] = newConfig.colors[resource];
		}
	}
}

registerColorOverlay("oilStripes", "Oil Resources", "Shows oil resources with solid black coloring", calculateOilStripesColor, "lambert", "lazy", "resources");
registerColorOverlay("goldStripes", "Gold Resources", "Shows gold resources with solid gold coloring", calculateGoldStripesColor, "lambert", "lazy", "resources");
registerColorOverlay("ironStripes", "Iron Resources", "Shows iron resources with solid brown coloring", calculateIronStripesColor, "lambert", "lazy", "resources");
registerColorOverlay("coalStripes", "Coal Resources", "Shows coal resources with solid dark gray coloring", calculateCoalStripesColor, "lambert", "lazy", "resources");
registerColorOverlay("copperStripes", "Copper Resources", "Shows copper resources with solid copper coloring", calculateCopperStripesColor, "lambert", "lazy", "resources");
registerColorOverlay("silverStripes", "Silver Resources", "Shows silver resources with solid silver coloring", calculateSilverStripesColor, "lambert", "lazy", "resources");
registerColorOverlay("uraniumStripes", "Uranium Resources", "Shows uranium resources with solid green coloring", calculateUraniumStripesColor, "lambert", "lazy", "resources");

// Combined view: all mineral resources at once.
function calculateCombinedStrategicResourcesColor(tile) {
	// Ocean tiles get flat blue-gray
	if (tile.elevation <= 0) {
		return new THREE.Color(0x6699CC);
	}

	// Count which resources this tile has
	var resourceTypes = [];
	if (tile.oil) resourceTypes.push('oil');
	if (tile.gold) resourceTypes.push('gold');
	if (tile.iron) resourceTypes.push('iron');
	if (tile.coal) resourceTypes.push('coal');
	if (tile.copper) resourceTypes.push('copper');
	if (tile.silver) resourceTypes.push('silver');
	if (tile.uranium) resourceTypes.push('uranium');
	var resourceCount = resourceTypes.length;

	// If no resources, show terrain
	if (resourceCount === 0) {
		return calculateTerrainColor(tile);
	}

	// Single resource: use its specific color
	if (resourceCount === 1) {
		return new THREE.Color(stripeConfig.colors[resourceTypes[0]] || '#FF00FF');
	}

	// Multiple resources: brighten the terrain proportionally to how many.
	var terrainColor = calculateTerrainColor(tile);
	return terrainColor.clone().multiplyScalar(Math.max(0.8, 1 + (resourceCount - 1) * 0.15));
}

registerColorOverlay("strategicResources", "All Strategic Resources", "Combined view of all mineral resources (oil, gold, iron, coal, copper, silver, uranium)", calculateCombinedStrategicResourcesColor, "lambert", "lazy", "resources");
