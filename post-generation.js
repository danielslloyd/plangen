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
// BIOMES AND RESOURCES FUNCTIONS
// ============================================================================

function generatePlanetBiomesResources(tiles, planetRadius, action) {
	tiles.sort((a, b) => parseFloat(b.elevation) - parseFloat(a.elevation));
	var flows = tiles.filter(t => t.outflow > 0).sort((a, b) => parseFloat(a.outflow) - parseFloat(b.outflow));
	var flowThreshold = flows[Math.floor(flows.length * riverThreshold)].outflow;
	var seaTemps = tiles.filter(t => t.elevation < 0).sort((a, b) => parseFloat(a.temperature) - parseFloat(b.temperature));
	var optimalTemp = seaTemps[Math.floor(seaTemps.length * .4)].temperature;
	const fibVectors = generateEvenVectors(Math.floor(Math.pow(tiles.length,0.5)), 1000)
	//console.log(fibVectors);
	function calculateAngleBetweenVectors(v1, v2) {
		// Calculate the dot product of the vectors
		const dotProduct = v1.dot(v2);

		// Calculate the magnitudes of the vectors
		const magnitudeV1 = v1.length();
		const magnitudeV2 = v2.length();

		// Calculate the cosine of the angle
		const cosTheta = dotProduct / (magnitudeV1 * magnitudeV2);

		// Calculate the angle in radians
		let angle = Math.acos(cosTheta);

		// Ensure the angle is between -pi and pi
		if (v1.cross(v2).z < 0) {
			angle = -angle;
		}

		return angle;
	}

	function generateEvenVectors(N, M) {
		const vectors = [];
		const goldenRatio = (1 + Math.sqrt(5)) / 2;
		const angleIncrement = Math.PI * 2 * goldenRatio;

		for (let i = 0; i < N; i++) {
			const t = i / N;
			const inclination = Math.acos(1 - 2 * t);
			const azimuth = angleIncrement * i;

			const x = Math.sin(inclination) * Math.cos(azimuth);
			const y = Math.sin(inclination) * Math.sin(azimuth);
			const z = Math.cos(inclination);

			const vector = new THREE.Vector3(x, y, z);
			vector.multiplyScalar(M);

			vectors.push(vector);
		}

		return vectors;
	}
	function findClosestVector(inputVector, vectorArray) {
		if (vectorArray.length === 0) {
			throw new Error('Vector array is empty');
		}

		let closestVector = vectorArray[0];
		let minDistance = inputVector.distanceTo(closestVector);

		for (let i = 1; i < vectorArray.length; i++) {
			const currentDistance = inputVector.distanceTo(vectorArray[i]);

			if (currentDistance < minDistance) {
				minDistance = currentDistance;
				closestVector = vectorArray[i];
			}
		}

		return minDistance;
	}
	let maxDist = 1;

	for (t of tiles) {
		t.fibNoise = findClosestVector(t.position, fibVectors);
		if (t.fibNoise > maxDist) {
			maxDist = t.fibNoise;
		}
		t.wheat = 0;
		t.corn = 0;
		t.rice = 0;
		t.fish = 0;
		t.pasture = 0;
		t.timber =0;
		t.calories = 0;
		t.iron = 0;
		t.bauxite = 0;
		t.oil = 0;
		t.gold = 0;
		t.copper = 0;
	}

	for (t of tiles) {
		t.fibNoise = 1 - t.fibNoise / maxDist;
	}

	for (var i = 0; i < tiles.length; ++i) {
		var tile = tiles[i];
		var elevation = Math.max(0, tile.elevation);
		tile.slope = Math.max(...tile.tiles.map(n => Math.abs(tile.elevation - n.elevation)));
		tile.latitudeAbs = Math.asin(Math.abs(tile.position.y) / planetRadius)/(Math.PI/2);
		var temperature = tile.temperature;
		var distanceToPlateBoundary = Math.min(...tile.corners.map(c => c.distanceToPlateBoundary));

		if (elevation <= 0) {
			if (temperature > 0) {
				tile.biome = "ocean";
				let hemisphere = Math.sign(tile.averagePosition.y);
				let higherShoreNeighbors = tile.tiles.filter(n => n.shore > tile.shore);
				let shoreVector = higherShoreNeighbors.reduce((acc, n) => {
					let vector = n.position.clone().sub(tile.position);
					return acc.add(vector);
				}, new THREE.Vector3()).divideScalar(higherShoreNeighbors.length);
				let airCurrent = tile.corners.reduce((acc, corner) => {
					return acc.add(corner.airCurrent);
				}, new THREE.Vector3()).divideScalar(tile.corners.length);
				let angle = calculateAngleBetweenVectors(shoreVector, airCurrent);
				let nearShore = [...tile.tiles.map(n => Math.min(-1,n.shore))].reduce((sum, num) => sum - num, 0);
				//if (tile.shore > -3) {
					//not sure why z matters, I think because the sign of the angle difference switches
					tile.fish = 0.1*tile.slope+7*Math.max(0,Math.sin(angle)*(-Math.sign(tile.averagePosition.y)*Math.sign(tile.averagePosition.z)))/nearShore+0.1*(1-Math.pow(temperature-optimalTemp,2));
				//}
			} else {
				tile.biome = "seaIce";
			}
		} else if (tile.elevation > 0.9 || tile.temperature < 0 || (tile.temperature < 0 && (Math.min(tile.moisture, 1) > 0.45 || (tile.drain && tile.outflow > flowThreshold)))) { //
			tile.biome = "glacier";
		} else if (tile.lake) {
			tile.biome = "lake";
			tile.fish = tile.upstream.length/20;
		} else if (tile.drain) {
			// Check if any individual inflow (not total) exceeds threshold
			var hasSignificantInflow = false;
			var alreadyRiver = false;
			var significantSources = [];

			if (tile.sources && tile.sources.length > 0) {
				for (var source of tile.sources) {
					if (source.outflow > flowThreshold) {
						hasSignificantInflow = true;
						alreadyRiver = source.river;
						significantSources.push(source);
					}
				}
			}

			if (hasSignificantInflow && (alreadyRiver||(tile.downstream && tile.downstream.length > 0))) {
				tile.river = true;
				tile.riverSources = significantSources; // Store which sources qualify for rendering
				tile.fish = Math.max(.125,Math.min(.25,tile.upstream.length/20))+Math.min(.75,(tile.upstream.length/(tile.downstream.length+1))/45);
			}
		} else {
			if (tile.elevation <= 0.8 && tile.elevation >= 0 && tile.lake === undefined && tile.temperature > 0.2) {
				tile.wheat = Math.round(100 * Math.max(0, 1 - 2 * (Math.abs(tile.temperature - .3) + Math.abs(tile.moisture - .3))));
			}
			if (tile.elevation <= 0.6 && tile.elevation >= 0 && tile.lake === undefined && tile.temperature > 0.4 && tile.moisture >= 0.1) {
				tile.corn = Math.round(100 * Math.max(0, 1 - 2 * (Math.abs(tile.temperature - .6) + Math.abs(tile.moisture - .4))));
			}
			if (tile.elevation <= 0.6 && tile.elevation >= 0 && tile.lake === undefined && tile.temperature >= .5 && tile.moisture >= 0.2) {
				tile.rice = Math.round(100 * (Math.pow(nrm(tile.temperature, 'logistic', .9, 7), 3) * Math.pow(nrm(tile.moisture, 'logistic', .6, 7), 3)));
			}
			if (tile.elevation <= 0.9) {
				tile.pasture = tile.moisture*2;
			}
			if (tile.temperature > 0.2 && tile.elevation < 0.8) {
				tile.timber = tile.moisture;
			}

			if (tile.elevation > 0.6) {
				tile.gold = tile.fibNoise * (1-5*Math.abs(tile.elevation-0.8)) / Math.max(1,Math.pow(distanceToPlateBoundary,3));
			} else if (tile.elevation > 0.4) {
				tile.iron = Math.abs(0.5-tile.fibNoise) / Math.max(1,Math.pow(distanceToPlateBoundary,5));
			}
			tile.oil = (1-tile.fibNoise) * Math.max(0,1-Math.pow(tile.slope,0.125)-tile.moisture);
			tile.bauxite = (tile.fibNoise) * Math.max(0,tile.slope*tile.moisture*tile.temperature);
			tile.copper = (10 / (1 + Math.exp(-0.003 * (tile.elevation - 1200)))) *
				(1 / (1 + Math.exp(-0.1 * (tile.temperature - 20)))) *
				Math.exp(-0.2 * distanceToPlateBoundary) *
				Math.exp(-0.002 * tile.rain);
		}
		tile.calories = Math.max(0, tile.wheat * 7, tile.corn * 15, tile.rice * 11, tile.pasture*1000,tile.fish*1300);
	}

	//}
	for (t of tiles.filter(t => t.upstream)) {
		t.upstreamCalories = t.upstream.reduce((s, v) => s + v.calories, 0)
	}


	const percentiles = {
		iron: 90,
		oil: 95,
		bauxite: 98,
		copper: 97,
		gold: 99
	};

	function normalizeTiles(tiles, percentiles) {
		if (!tiles || tiles.length === 0) return [];

		for (const attr in percentiles) {
			const perc = percentiles[attr];
			const values = tiles.map(tile => tile[attr]);
			const sorted = [...values].sort((a, b) => a - b);
			const index = Math.floor((perc / 100) * (sorted.length - 1));
			const pVal = sorted[index];
			const maxVal = Math.max(...values);

			for (const tile of tiles) {
			if (maxVal === pVal) {
				tile[attr] = tile[attr] >= maxVal ? 1.0 : 0.0;
			} else {
				tile[attr] = Math.max(0, Math.min(1, (tile[attr] - pVal) / (maxVal - pVal)));
			}
			}
		}

		//return tiles;
	}
	normalizeTiles(tiles.filter(t => t.elevation > 0), percentiles);

	const weights = {
		calories: 1,
		iron: 10,
		oil: 20,
		bauxite: 10,
		copper: 25,
		gold: 100
	};

	function sumUpstreamWeights(tiles, weights) {
		for (const tile of tiles) {
			let sum = 0;

			for (const upstreamTile of tile.upstream || []) {
				for (const attr in weights) {
					if (typeof upstreamTile[attr] === 'number') {
					sum += upstreamTile[attr] * weights[attr];
					}
				}
			}

			tile.upstreamWeight = sum;
		}
	}

	sumUpstreamWeights(tiles.filter(t => t.elevation > 0), weights);
	normalizeTiles(tiles.filter(t => t.elevation > 0), {upstreamWeight: 0});
	/*

		//fish color
		var fishColor = terrainColor.clone()
		if (tile.elevation < 0 && tile.biome != "seaIce"&&tile.shore>-5) {// && tile.elevation >= -0.2) {
			tile.fish = 100-100*Math.pow(Math.abs(tile.elevation+0.2),0.15);
			fishColor = fishColor.lerp(new THREE.Color(0xFF00FF), tile.fish / 100);
		}
		var calorieColor = terrainColor.clone()
		calorieColor = calorieColor.lerp(new THREE.Color(0xFF00FF), tile.calories / 1500);


		function assignResourceDeposits(tiles) {
			tiles.forEach(tile => {
				if (tile.elevation > 0) { // Only assign resources to land tiles
					// Gold deposits are often found in mountainous regions and near plate boundaries
					tile.goldDeposits = (tile.elevation > 0.5 && tile.plate.boundaryBorders.length > 0) ? Math.random() * 100 : 0;

					// Iron ore deposits are often found in ancient geological formations, typically away from plate boundaries
					tile.ironOreDeposits = (tile.elevation > 0.3 && tile.plate.boundaryBorders.length === 0) ? Math.random() * 200 : 0;

					// Oil deposits are often found in sedimentary basins, typically in low elevation areas
					tile.oilDeposits = (tile.elevation < 0.2 && tile.moisture > 0.5) ? Math.random() * 50 : 0;

					// Aluminum ore deposits (bauxite) are often found in tropical regions with high moisture
					tile.aluminumOreDeposits = (tile.moisture * tile.temperature) ? Math.random() * 150 : 0;
				} else {
					tile.goldDeposits = 0;
					tile.ironOreDeposits = 0;
					tile.oilDeposits = 0;
					tile.aluminumOreDeposits = 0;
				}
			});
		}
			*/

	// Add labeling system - find highest elevation tile and label it
	console.log('DEBUG: Starting label assignment phase');
	if (tiles && tiles.length > 0) {
		console.log('DEBUG: Processing', tiles.length, 'tiles for labeling');
		// Find tile with highest elevation (tiles are already sorted by elevation descending at line 1134)
		var highestTile = tiles[0];
		for (var i = 1; i < tiles.length; i++) {
			if (tiles[i].elevation > highestTile.elevation) {
				highestTile = tiles[i];
			}
		}

		console.log('DEBUG: Found highest tile with elevation:', highestTile.elevation);
		console.log('DEBUG: Highest tile ID/position:', highestTile.id || 'no-id', highestTile.averagePosition);

		// Add label to highest elevation tile
		if (highestTile && highestTile.elevation > 0) {
			highestTile.label = 'Mount Everest';
			console.log('DEBUG: Successfully assigned label "Mount Everest" to tile');
			console.log('DEBUG: Tile now has label property:', highestTile.label);
		} else {
			console.log('DEBUG: No suitable tile found for labeling (highest elevation <= 0)');
		}
	} else {
		console.log('DEBUG: No tiles provided for labeling');
	}

	// Add K-means clustering for geographical features
	clusterLandFeatures(tiles);

	action.provideResult("Biomes and resources complete");
}

// Sphere-constrained K-means clustering for land features
function clusterLandFeatures(tiles) {
	console.log('DEBUG: Starting land feature clustering');

	if (!tiles || tiles.length === 0) {
		console.log('DEBUG: No tiles for clustering');
		return;
	}

	// Filter land tiles only
	var landTiles = tiles.filter(function(tile) {
		return tile.elevation > 0;
	});

	console.log('DEBUG: Found', landTiles.length, 'land tiles for clustering');

	if (landTiles.length === 0) {
		console.log('DEBUG: No land tiles found for clustering');
		return;
	}

	// Calculate number of clusters (land tiles / 100, minimum 1)
	var k = Math.max(1, Math.floor(landTiles.length / 100));
	console.log('DEBUG: Using', k, 'clusters for', landTiles.length, 'land tiles');

	// Extract 3D positions from land tiles
	var positions = landTiles.map(function(tile) {
		return tile.averagePosition.clone();
	});

	// Perform K-means clustering
	var clusterResult = kMeansSphereClustering(positions, landTiles, k);
	var clusters = clusterResult.centers;
	var assignments = clusterResult.assignments;

	// Store cluster assignments on tiles for color overlay
	for (var i = 0; i < landTiles.length; i++) {
		landTiles[i].landRegion = assignments[i] + 1; // 1-based indexing for display
	}

	// Apply graph-based coloring to land regions
	// Note: Land region graph coloring moved to post-generation.js

	// Assign labels to tiles closest to cluster centers
	for (var i = 0; i < clusters.length; i++) {
		var center = clusters[i];
		var closestTile = findClosestTile(landTiles, center);
		if (closestTile && !closestTile.landRegionLabel) { // Don't override existing land region labels
			closestTile.landRegionLabel = 'Land ' + (i + 1);
			console.log('DEBUG: Created land region label:', closestTile.landRegionLabel, 'at tile with elevation:', closestTile.elevation);
		} else {
			console.log('DEBUG: Skipping land region label - closestTile:', !!closestTile, 'existing label:', closestTile ? closestTile.landRegionLabel : 'N/A');
		}
	}
}

// K-means clustering with sphere constraint
function kMeansSphereClustering(positions, landTiles, k) {
	var sphereRadius = 1000; // Match planet radius
	var maxIterations = 50;
	var convergenceThreshold = 1.0; // Stop when centers move less than this distance

	// Initialize cluster centers randomly on sphere surface
	var centers = [];
	for (var i = 0; i < k; i++) {
		// Random point on sphere surface
		var center = new THREE.Vector3(
			Math.random() - 0.5,
			Math.random() - 0.5,
			Math.random() - 0.5
		);
		center.normalize().multiplyScalar(sphereRadius);
		centers.push(center);
	}

	console.log('DEBUG: Initialized', k, 'cluster centers on sphere surface');

	var finalAssignments = [];

	// K-means iterations
	for (var iteration = 0; iteration < maxIterations; iteration++) {
		// Assign each position to closest cluster
		var assignments = [];
		var clusterSums = [];
		var clusterCounts = [];

		// Initialize cluster accumulators
		for (var i = 0; i < k; i++) {
			clusterSums.push(new THREE.Vector3(0, 0, 0));
			clusterCounts.push(0);
		}

		// Assign positions to clusters
		for (var i = 0; i < positions.length; i++) {
			var pos = positions[i];
			var closestCluster = 0;
			var minDistance = pos.distanceTo(centers[0]);

			for (var j = 1; j < k; j++) {
				var distance = pos.distanceTo(centers[j]);
				if (distance < minDistance) {
					minDistance = distance;
					closestCluster = j;
				}
			}

			assignments.push(closestCluster);
			clusterSums[closestCluster].add(pos);
			clusterCounts[closestCluster]++;
		}

		// Store the final assignments
		finalAssignments = assignments;

		// Calculate new cluster centers
		var maxMovement = 0;
		for (var i = 0; i < k; i++) {
			if (clusterCounts[i] > 0) {
				var newCenter = clusterSums[i].divideScalar(clusterCounts[i]);
				newCenter.normalize().multiplyScalar(sphereRadius); // Project back to sphere surface

				var movement = centers[i].distanceTo(newCenter);
				maxMovement = Math.max(maxMovement, movement);
				centers[i] = newCenter;
			}
		}

		// Check for convergence
		if (maxMovement < convergenceThreshold) {
			console.log('DEBUG: K-means converged after', iteration + 1, 'iterations');
			break;
		}
	}

	console.log('DEBUG: K-means clustering completed, returning', centers.length, 'cluster centers and assignments');
	return {
		centers: centers,
		assignments: finalAssignments
	};
}

function findClosestTile(tiles, position) {
	var closestTile = null;
	var minDistance = Infinity;

	for (var i = 0; i < tiles.length; i++) {
		var distance = tiles[i].averagePosition.distanceTo(position);
		if (distance < minDistance) {
			minDistance = distance;
			closestTile = tiles[i];
		}
	}

	return closestTile;
}

// ============================================================================
// MAIN POST-GENERATION FUNCTION
// ============================================================================

// Main post-generation analysis function - runs after all planet attributes are finalized
function runPostGeneration(planet, action) {
	console.log("=== STARTING POST-GENERATION ANALYSIS ===");

	action
		.executeSubaction(function(action) {
			console.log("Running biomes and resources generation...");
			generatePlanetBiomesResources(planet.topology.tiles, 1000, action);
		}, 1, "Generating Biomes & Resources")
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