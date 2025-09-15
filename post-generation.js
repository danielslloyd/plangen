// post-generation.js
// Post-generation analysis functions that run after all planet attributes are finalized
// Includes region generation, clustering, and other analysis that requires complete planet data

// ============================================================================
// WATERSHED REGION FUNCTIONS
// ============================================================================

// Clean watershed region absorption algorithm based on Ocean-Land (O-L) ratios
function performWatershedAbsorption(watersheds) {
	console.log("Starting clean watershed absorption algorithm...");

	// Step 1: Initialize regions directly from watersheds (simple structure)
	var regions = [];
	for (var i = 0; i < watersheds.length; i++) {
		var watershed = watersheds[i];
		var region = {
			id: i + 1,
			tiles: watershed.tiles.slice(), // Copy tile array
			neighbors: new Set()
		};

		// Set direct reference on each tile
		for (var j = 0; j < region.tiles.length; j++) {
			region.tiles[j].finalRegionId = region.id;
		}

		regions.push(region);
	}

	console.log("Initialized", regions.length, "regions from watersheds");

	// Step 2: Calculate neighbors for each region
	function updateNeighbors() {
		// Clear all neighbor sets
		for (var i = 0; i < regions.length; i++) {
			regions[i].neighbors.clear();
		}

		// Find neighbors by checking tile adjacencies
		for (var i = 0; i < regions.length; i++) {
			var region = regions[i];
			for (var j = 0; j < region.tiles.length; j++) {
				var tile = region.tiles[j];
				if (tile.tiles) {
					for (var k = 0; k < tile.tiles.length; k++) {
						var neighbor = tile.tiles[k];
						if (neighbor.finalRegionId && neighbor.finalRegionId !== region.id) {
							region.neighbors.add(neighbor.finalRegionId);
						}
					}
				}
			}
		}
	}

	// Step 3: Calculate O-L ratio for a region
	function calculateOLRatio(region) {
		var oceanBorders = 0;
		var landBorders = 0;

		for (var i = 0; i < region.tiles.length; i++) {
			var tile = region.tiles[i];
			if (tile.tiles) {
				for (var j = 0; j < tile.tiles.length; j++) {
					var neighbor = tile.tiles[j];
					// Count external borders (to other regions or ocean)
					if (!neighbor.finalRegionId || neighbor.finalRegionId !== region.id) {
						if (neighbor.elevation <= 0) {
							oceanBorders++;
						} else {
							landBorders++;
						}
					}
				}
			}
		}

		return oceanBorders - landBorders;
	}

	// Step 4: Calculate combined O-L ratio if two regions were merged
	function calculateCombinedOLRatio(region1, region2) {
		var combinedOceanBorders = 0;
		var combinedLandBorders = 0;
		var combinedTileIds = new Set();

		// Collect all tile IDs in combined region
		for (var i = 0; i < region1.tiles.length; i++) {
			combinedTileIds.add(region1.tiles[i].index || region1.tiles[i].id);
		}
		for (var i = 0; i < region2.tiles.length; i++) {
			combinedTileIds.add(region2.tiles[i].index || region2.tiles[i].id);
		}

		// Count external borders for combined region
		var allTiles = region1.tiles.concat(region2.tiles);
		for (var i = 0; i < allTiles.length; i++) {
			var tile = allTiles[i];
			if (tile.tiles) {
				for (var j = 0; j < tile.tiles.length; j++) {
					var neighbor = tile.tiles[j];
					var neighborTileId = neighbor.index || neighbor.id;
					// If neighbor is not in combined region
					if (!combinedTileIds.has(neighborTileId)) {
						if (neighbor.elevation <= 0) {
							combinedOceanBorders++;
						} else {
							combinedLandBorders++;
						}
					}
				}
			}
		}

		return combinedOceanBorders - combinedLandBorders;
	}

	// Step 5: Main absorption loop
	var round = 1;
	while (true) {
		updateNeighbors();

		// Sort regions by O-L ratio (highest first)
		regions.sort(function(a, b) {
			return calculateOLRatio(b) - calculateOLRatio(a);
		});

		var anyAbsorptions = false;

		for (var i = 0; i < regions.length; i++) {
			var region = regions[i];
			var currentOL = calculateOLRatio(region);

			// Only regions with positive or zero O-L can absorb (coastal/ocean-favorable regions)
			if (currentOL < 0) {
				continue; // Skip inland regions
			}

			// Try to absorb each neighbor
			var neighborsArray = Array.from(region.neighbors);
			for (var j = 0; j < neighborsArray.length; j++) {
				var neighborId = neighborsArray[j];
				var neighborRegion = null;

				// Find neighbor region
				for (var k = 0; k < regions.length; k++) {
					if (regions[k].id === neighborId) {
						neighborRegion = regions[k];
						break;
					}
				}

				if (neighborRegion) {
					var combinedOL = calculateCombinedOLRatio(region, neighborRegion);

					// If combined O-L is same or better, absorb
					if (combinedOL >= currentOL) {
						console.log("Region", region.id, "(O-L:", currentOL, ") absorbing region", neighborRegion.id, "-> combined O-L:", combinedOL);

						// Merge neighbor into region
						for (var l = 0; l < neighborRegion.tiles.length; l++) {
							var tile = neighborRegion.tiles[l];
							tile.finalRegionId = region.id;
							region.tiles.push(tile);
						}

						// Remove neighbor from regions array
						regions.splice(regions.indexOf(neighborRegion), 1);
						anyAbsorptions = true;
						break; // Process this region again with new neighbors
					}
				}
			}

			if (anyAbsorptions) break; // Start over with updated regions
		}

		console.log("Round", round, "complete.", regions.length, "regions remaining");
		if (!anyAbsorptions) {
			console.log("No more absorptions possible. Algorithm complete.");
			break;
		}
		round++;
	}

	// Step 6: Assign final sequential IDs
	for (var i = 0; i < regions.length; i++) {
		var newId = i + 1;
		var oldId = regions[i].id;
		regions[i].id = newId;

		// Update all tile references
		for (var j = 0; j < regions[i].tiles.length; j++) {
			regions[i].tiles[j].finalRegionId = newId;
		}
	}

	console.log("Watershed absorption complete.", regions.length, "final regions created.");

	// Store regions globally for coloring and labeling
	if (typeof window !== 'undefined') {
		window.watershedFinalRegions = regions;
	}

	// Apply graph coloring and create labels
	applySimpleGraphColoring(regions);
	createSimpleRegionLabels(regions);

	return regions;
}

// Enhanced graph coloring with iterative balancing
function applySimpleGraphColoring(regions) {
	console.log("Applying enhanced 5-color graph coloring to", regions.length, "regions");

	// Enhanced adjacency function for simple regions
	function getRegionAdjacencies(region, allRegions) {
		var adjacentIds = Array.from(region.neighbors);
		return adjacentIds;
	}

	// Apply the enhanced graph coloring algorithm
	applyGraphColoring(regions, getRegionAdjacencies, 'color', 'watershedRegion');

	// Validation
	var regionsWithColors = 0;
	var colorDistribution = {};

	for (var i = 0; i < regions.length; i++) {
		var region = regions[i];
		if (region.color) {
			regionsWithColors++;
			var colorKey = region.color;
			if (!colorDistribution[colorKey]) {
				colorDistribution[colorKey] = 0;
			}
			colorDistribution[colorKey]++;
		}
	}

	console.log("=== FINAL REGION COLOR VALIDATION ===");
	console.log("Regions with colors:", regionsWithColors, "/", regions.length);
	console.log("Color distribution by region:", colorDistribution);
	console.log("Number of unique colors used:", Object.keys(colorDistribution).length);
}

// Simple region label creation
function createSimpleRegionLabels(regions) {
	console.log("Creating simple region labels...");

	var regionsLabeled = 0;

	for (var i = 0; i < regions.length; i++) {
		var region = regions[i];

		// Calculate ocean/land border ratio for label
		var oceanBorders = 0;
		var landBorders = 0;

		// Count border types by examining tile neighbors
		for (var j = 0; j < region.tiles.length; j++) {
			var tile = region.tiles[j];
			if (tile.tiles) {
				for (var k = 0; k < tile.tiles.length; k++) {
					var neighbor = tile.tiles[k];
					if (neighbor.finalRegionId !== region.id) {
						// This is a border with another region or outside
						if (neighbor.elevation <= 0) {
							oceanBorders++;
						} else {
							landBorders++;
						}
					}
				}
			}
		}

		var netOcean = oceanBorders - landBorders;
		var neighborCount = region.neighbors ? region.neighbors.size : 0;
		var labelText = "Coast " + region.id + " (" + (netOcean > 0 ? "+" : "") + netOcean + ", N:" + neighborCount + ")";

		// Find land tiles in this region
		var landTiles = region.tiles.filter(function(tile) {
			return tile.elevation > 0;
		});

		if (landTiles.length > 0) {
			// Find the highest elevation tile in the region to place the label
			var highestTile = landTiles.reduce(function(highest, current) {
				return current.elevation > highest.elevation ? current : highest;
			}, landTiles[0]);

			// Place exactly one label per region on the highest tile
			if (!highestTile.watershedRegionLabel) {
				highestTile.watershedRegionLabel = labelText;
				highestTile.watershedRegionLabelId = region.id;
				regionsLabeled++;

				console.log("DEBUG: Created region label for region", region.id, ':"', labelText, '" at elevation', highestTile.elevation.toFixed(3), "(", region.tiles.length, "total tiles,", landTiles.length, "land tiles)");
			}
		} else {
			console.log("DEBUG: No land tiles found in region", region.id, "- skipping label (", region.tiles.length, "total tiles)");
		}
	}

	console.log("=== REGION LABEL VALIDATION ===");
	console.log("Regions labeled:", regionsLabeled, "/", regions.length);
	console.log("Label creation complete");
}

// ============================================================================
// LAND REGION FUNCTIONS
// ============================================================================

// Graph coloring for land regions (K-means clustered)
function applyLandRegionGraphColoring(landTiles, regionCount) {
	if (!landTiles || landTiles.length === 0) {
		console.log("No land tiles provided for land region graph coloring");
		return;
	}

	console.log("Applying graph coloring to", regionCount, "land regions");

	// Extract unique regions from land tiles
	var regionMap = {};
	for (var i = 0; i < landTiles.length; i++) {
		var tile = landTiles[i];
		if (tile.landRegion && tile.landRegion > 0) {
			if (!regionMap[tile.landRegion]) {
				regionMap[tile.landRegion] = {
					id: tile.landRegion,
					tiles: []
				};
			}
			regionMap[tile.landRegion].tiles.push(tile);
		}
	}

	var regions = Object.values(regionMap);
	console.log("Found", regions.length, "land regions from tiles");

	// Adjacency function for land regions
	function getLandRegionAdjacencies(region, allRegions) {
		var adjacentIds = [];
		var regionTileSet = new Set(region.tiles);

		// Check each tile in this region for neighbors in other regions
		for (var i = 0; i < region.tiles.length; i++) {
			var tile = region.tiles[i];
			if (tile.tiles) {
				for (var j = 0; j < tile.tiles.length; j++) {
					var neighbor = tile.tiles[j];
					if (neighbor.landRegion &&
						neighbor.landRegion !== region.id &&
						adjacentIds.indexOf(neighbor.landRegion) === -1) {
						adjacentIds.push(neighbor.landRegion);
					}
				}
			}
		}

		return adjacentIds;
	}

	// Apply graph coloring to land regions
	applyGraphColoring(regions, getLandRegionAdjacencies, 'graphColor', 'landRegion');

	// Propagate colors back to tiles
	for (var i = 0; i < regions.length; i++) {
		var region = regions[i];
		if (region.graphColor) {
			for (var j = 0; j < region.tiles.length; j++) {
				region.tiles[j].landRegionGraphColor = region.graphColor;
			}
		}
	}

	console.log("Land region graph coloring complete");
}

// ============================================================================
// MAIN POST-GENERATION FUNCTION
// ============================================================================

// Main post-generation analysis function - runs after all planet attributes are finalized
function runPostGeneration(planet, action) {
	console.log("=== STARTING POST-GENERATION ANALYSIS ===");

	action
		.executeSubaction(function(action) {
			console.log("Running watershed region analysis...");

			if (planet.topology && planet.topology.watersheds) {
				console.log(planet.topology.watersheds);
				performWatershedAbsorption(planet.topology.watersheds);
			} else {
				console.warn("No watersheds found for region analysis");
			}

			action.provideResult("Watershed regions complete");
		}, 1, "Generating Watershed Regions")
		.executeSubaction(function(action) {
			console.log("Running land region analysis...");

			var landTiles = planet.topology.tiles.filter(function(tile) {
				return tile.elevation > 0 && tile.landRegion && tile.landRegion > 0;
			});

			if (landTiles.length > 0) {
				var maxRegion = Math.max.apply(Math, landTiles.map(function(tile) { return tile.landRegion; }));
				applyLandRegionGraphColoring(landTiles, maxRegion);
			} else {
				console.warn("No land regions found for coloring");
			}

			action.provideResult("Land regions complete");
		}, 1, "Processing Land Regions")
		.executeSubaction(function(action) {
			console.log("=== POST-GENERATION ANALYSIS COMPLETE ===");
			action.provideResult("Post-generation complete");
		}, 0);
}