// post-generation.js
// Post-generation analysis functions that run after all planet attributes are finalized
// Includes region generation, clustering, and other analysis that requires complete planet data

// ============================================================================
// WATERSHED REGION FUNCTIONS
// ============================================================================

// Simplified watershed region assignment using land-only BFS to joint tiles
function performWatershedAbsorption(watersheds) {

	console.log("Starting simplified watershed region assignment...");

	// Step 1: Find all joint tiles (marked as extrema in previous processing)
	var jointTiles = [];
	var allTiles = [];

	// Collect all tiles from all watersheds
	for (var i = 0; i < watersheds.length; i++) {
		for (var j = 0; j < watersheds[i].tiles.length; j++) {
			var tile = watersheds[i].tiles[j];
			allTiles.push(tile);
			if (tile.joint === true) {
				jointTiles.push(tile);
			}
		}
	}

	console.log(`Found ${jointTiles.length} joint tiles from ${watersheds.length} watersheds`);

	// Step 2: Assign each watershed to its closest joint tile using land-only BFS from watershed mouth
	var regions = [];
	var regionMap = new Map(); // joint tile -> region

	for (var i = 0; i < watersheds.length; i++) {
		var watershed = watersheds[i];
		var watershedMouth = watershed.tiles[0]; // First tile is the mouth (drains to ocean)

		// Find closest joint tile using land-only BFS
		var closestJoint = findClosestJointTile(watershedMouth, jointTiles, allTiles);

		if (closestJoint) {
			// Get or create region for this joint tile
			var region;
			if (regionMap.has(closestJoint)) {
				region = regionMap.get(closestJoint);
			} else {
				region = {
					id: regionMap.size + 1,
					jointTile: closestJoint,
					tiles: [],
					neighbors: new Set()
				};
				regions.push(region);
				regionMap.set(closestJoint, region);
			}

			// Add all watershed tiles to this region
			for (var j = 0; j < watershed.tiles.length; j++) {
				var tile = watershed.tiles[j];
				tile.finalRegionId = region.id;
				region.tiles.push(tile);
			}

			//console.log(`Assigned watershed ${watershed.id} (${watershed.tiles.length} tiles) to joint tile region ${region.id}`);
		} else {
			//console.warn(`Could not find joint tile for watershed ${watershed.id}`);
		}
	}

	//console.log(`Created ${regions.length} watershed regions from ${watersheds.length} watersheds`);

	// Step 3: Calculate neighbors for each region
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

	// Land-only BFS to find closest joint tile
	function findClosestJointTile(startTile, jointTiles, allTiles) {
		if (!startTile || !jointTiles || jointTiles.length === 0) {
			return null;
		}

		// BFS queue: [{tile, distance}]
		var queue = [{tile: startTile, distance: 0}];
		var visited = new Set();
		visited.add(startTile.id || startTile.index);

		while (queue.length > 0) {
			var current = queue.shift();
			var currentTile = current.tile;

			// Check if current tile is a joint tile
			if (currentTile.joint === true) {
				return currentTile;
			}

			// Add land neighbors to queue
			if (currentTile.tiles) {
				for (var i = 0; i < currentTile.tiles.length; i++) {
					var neighbor = currentTile.tiles[i];
					var neighborId = neighbor.id || neighbor.index;

					// Only traverse land tiles and avoid revisiting
					if (neighbor.elevation > 0 && !visited.has(neighborId)) {
						visited.add(neighborId);
						queue.push({tile: neighbor, distance: current.distance + 1});
					}
				}
			}
		}

		// If no joint tile found via BFS, return closest joint tile by direct distance
		var closestJoint = null;
		var closestDistance = Infinity;

		for (var i = 0; i < jointTiles.length; i++) {
			var joint = jointTiles[i];
			if (joint.averagePosition && startTile.averagePosition) {
				var distance = joint.averagePosition.distanceTo(startTile.averagePosition);
				if (distance < closestDistance) {
					closestDistance = distance;
					closestJoint = joint;
				}
			}
		}

		return closestJoint;
	}

	// Step 4: Update region neighbors and finalize
	updateNeighbors();

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

	// Enhanced adjacency function for simple regions
	function getRegionAdjacencies(region, allRegions) {
		var adjacentIds = Array.from(region.neighbors);
		return adjacentIds;
	}

	// Apply the working graph coloring algorithm
	applyGraphColoring(regions, getRegionAdjacencies, 'color', 'watershedRegion');
}

// Simple region label creation
function createSimpleRegionLabels(regions) {

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
			}
		}
	}
}

// ============================================================================
// LAND REGION FUNCTIONS
// ============================================================================

// Graph coloring for land regions (K-means clustered)
function applyLandRegionGraphColoring(landTiles, regionCount) {
	if (!landTiles || landTiles.length === 0) {
		return;
	}

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
				tile.fish = 0.1*tile.slope+7*Math.max(0,Math.sin(angle)*(-Math.sign(tile.averagePosition.y)*Math.sign(tile.averagePosition.z)))/nearShore+0.1*(1-Math.pow(temperature-optimalTemp,2));
			} else {
				tile.biome = "seaIce";
			}
		} else if (tile.elevation > 0.9 || tile.temperature < 0 || (tile.temperature < 0 && (Math.min(tile.moisture, 1) > 0.45 || (tile.drain && tile.outflow > flowThreshold)))) {
			tile.biome = "glacier";
		} else if (tile.lake) {
			tile.biome = "lake";
			tile.fish = tile.upstream.length/20;
		} else {
			if (tile.drain) {
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
			}
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
		tile.calories = Math.max(0, tile.wheat * 7, tile.corn * 15, tile.rice * 11, tile.pasture*200, tile.fish*1300);
	}

	for (t of tiles.filter(t => t.upstream)) {
		t.upstreamCalories = t.upstream.reduce((s, v) => s + v.calories, 0)
	}
	//console.log("Upstream Calories calculated");

	const percentiles = {
		corn: 50,
		rice: 60,
		wheat: 30,
		pasture: 15,
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

	// Add labeling system - find highest elevation tile and label it
	if (tiles && tiles.length > 0) {
		// Find tile with highest elevation
		var highestTile = tiles[0];
		for (var i = 1; i < tiles.length; i++) {
			if (tiles[i].elevation > highestTile.elevation) {
				highestTile = tiles[i];
			}
		}

		// Add label to highest elevation tile
		if (highestTile && highestTile.elevation > 0) {
			highestTile.label = 'Mount Everest';
		}
	}

	// Add K-means clustering for geographical features
	clusterLandFeatures(tiles);
	selectTopCityLocations(tiles);
	
	action.provideResult("Biomes and resources complete");
}

// Sphere-constrained K-means clustering for land features
function clusterLandFeatures(tiles) {

	if (!tiles || tiles.length === 0) {
		return;
	}

	// Filter land tiles only
	var landTiles = tiles.filter(function(tile) {
		return tile.elevation > 0;
	});

	if (landTiles.length === 0) {
		return;
	}

	// Calculate number of clusters (land tiles / 100, minimum 1)
	var k = Math.max(1, Math.floor(landTiles.length / 100));

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

	// Assign labels to tiles closest to cluster centers
	for (var i = 0; i < clusters.length; i++) {
		var center = clusters[i];
		var closestTile = findClosestTile(landTiles, center);
		if (closestTile && !closestTile.landRegionLabel) { // Don't override existing land region labels
			closestTile.landRegionLabel = 'Land ' + (i + 1);
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
			break;
		}
	}

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
// SHORE DISTANCE FUNCTIONS
// ============================================================================

// Calculate shore distance values for all tiles
// Shore values: -1 for ocean tiles bordering land, 1 for land tiles bordering ocean
// Then -2 for ocean neighbors of -1 tiles, 2 for land neighbors of 1 tiles, etc.
function calculateShoreDistances(tiles) {
	// Initialize all shore values to 0
	for (var i = 0; i < tiles.length; i++) {
		tiles[i].shore = 0;
	}

	// First pass: identify immediate shore tiles
	for (var i = 0; i < tiles.length; i++) {
		var tile = tiles[i];
		if (tile.shore == 0) {
			if (tile.elevation > 0) {
				// Land tile: check if any neighbors are ocean
				if (Math.min.apply(0, tile.tiles.map(function(neighbor) { return neighbor.elevation; })) < 0) {
					tile.shore = 1;
				}
			} else if (tile.elevation < 0) {
				// Ocean tile: check if any neighbors are land
				if (Math.max.apply(0, tile.tiles.map(function(neighbor) { return neighbor.elevation; })) > 0) {
					tile.shore = -1;
				}
			}
		}
	}

	// Iterative expansion: propagate shore values outward
	var currentDistance = 1;
	while (!Math.min.apply(0, tiles.map(function(tile) { return Math.abs(tile.shore); })) > 0) {
		for (var i = 0; i < tiles.length; i++) {
			var tile = tiles[i];

			if (Math.abs(tile.shore) == currentDistance) {
				for (var j = 0; j < tile.tiles.length; j++) {
					var neighbor = tile.tiles[j];
					if (neighbor.shore == 0) {
						if (neighbor.elevation > 0) {
							// Land neighbor gets positive value
							neighbor.shore = tile.shore + 1;
						} else {
							// Ocean neighbor gets negative value
							neighbor.shore = tile.shore - 1;
						}
					}
				}
			}
		}
		currentDistance += 1;

		// Safety check to prevent infinite loops
		if (currentDistance > tiles.length) {
			break;
		}
	}

	// After shore calculation, find local extrema and mark them
	markLocalExtrema(tiles);
}

// Mark tiles that are local extrema of shore values
function markLocalExtrema(tiles) {
	// First pass: identify potential local extrema
	var potentialExtrema = [];

	for (var i = 0; i < tiles.length; i++) {
		var tile = tiles[i];
		var neighbors = tile.tiles || [];

		if (neighbors.length === 0) continue;

		var isLocalMax = true;
		var isLocalMin = true;

		// Check if this tile is a local extremum compared to its neighbors
		for (var j = 0; j < neighbors.length; j++) {
			var neighbor = neighbors[j];

			// For land tiles (positive shore), look for local maxima
			// For ocean tiles (negative shore), look for local minima (most negative)
			if (tile.elevation >= 0) {
				// Land tile: check if it's a local maximum
				if (neighbor.shore > tile.shore) {
					isLocalMax = false;
				}
			} else {
				// Ocean tile: check if it's a local minimum (most negative)
				if (neighbor.shore < tile.shore) {
					isLocalMin = false;
				}
			}
		}

		// Collect potential extrema - only those close to shore (|shore| <= 4) for significance
		if ((tile.elevation >= 0 && isLocalMax && tile.shore > 1 && tile.shore <= 4) ||
		    (tile.elevation < 0 && isLocalMin && tile.shore < -1 && tile.shore >= -4)) {
			potentialExtrema.push(tile);
		}
	}

	// Second pass: consolidate contiguous groups of extrema
	consolidateExtremaGroups(potentialExtrema);
}

// Calculate calorie flux for river junctions and coastal bonus
function calculateCalorieFlux(tiles) {
	//console.log("Calculating calorie flux for city prioritization...");

	for (var i = 0; i < tiles.length; i++) {
		var tile = tiles[i];
		tile.cityPriorityScore = 0;

		// Skip ocean tiles
		if (tile.elevation <= 0) {
			continue;
		}

		var tileUpstreamCalories = tile.upstreamCalories || 0;

		// Check if tile is coastal (shore = 1)
		if (tile.shore === 1) {
			// Coastal tiles get their full upstream calories value
			tile.cityPriorityScore = tileUpstreamCalories;
		} else {
			// Non-coastal tiles: tile.upstreamCalories - [highest upstreamCalories of upstream neighbors]
			var maxNeighborUpstreamCalories = 0;

			if (tile.upstream && tile.upstream.length > 0) {
				// Find highest upstream calories among upstream neighbors
				for (var j = 0; j < tile.upstream.length; j++) {
					var upstreamNeighbor = tile.upstream[j];
					var neighborUpstreamCalories = upstreamNeighbor.upstreamCalories || 0;
					if (neighborUpstreamCalories > maxNeighborUpstreamCalories) {
						maxNeighborUpstreamCalories = neighborUpstreamCalories;
					}
				}
			}

			// Calculate flux as difference (prioritizes river junctions where calories accumulate)
			tile.cityPriorityScore = Math.max(0, tileUpstreamCalories - maxNeighborUpstreamCalories);
		}
	}

	//console.log("Calorie flux calculation complete");
}

// Select top city locations based on calorie flux, preferring non-river neighbors
function selectTopCityLocations(tiles) {
	// Calculate calorie flux for all tiles
	calculateCalorieFlux(tiles);

	// Find all land tiles (elevation > 0) for city consideration
	var landTiles = tiles.filter(tile => tile.elevation > 0);

	// Sort by city priority score (descending)
	landTiles.sort((a, b) => b.cityPriorityScore - a.cityPriorityScore);

	// Clear previous city markers
	for (var i = 0; i < tiles.length; i++) {
		tiles[i].isCity = false;
	}

	var cityCount = Math.max(1, Math.floor(Math.pow(landTiles.length,0.35))); // 0.5% of land tiles
	var selectedCities = [];
	var candidateIndex = 0;

	console.log(`Selecting ${cityCount} cities from ${landTiles.length} land tiles...`);

	while (selectedCities.length < cityCount && candidateIndex < landTiles.length) {
		var candidate = landTiles[candidateIndex];
		candidateIndex++;

		// If candidate is a river tile, try to find the best non-river neighbor
		if (candidate.river && candidate.tiles) {
			var bestNeighbor = null;
			var bestNeighborScore = -1;

			// Check if this is a coastal river tile
			var isCoastalRiver = candidate.shore === 1;
			var oceanDrainTile = null;

			if (isCoastalRiver && candidate.drain && candidate.drain.elevation <= 0) {
				oceanDrainTile = candidate.drain;
			}

			for (var j = 0; j < candidate.tiles.length; j++) {
				var neighbor = candidate.tiles[j];

				// Skip rivers and oceans
				if (neighbor.river || neighbor.elevation <= 0) {
					continue;
				}

				// Skip if already selected as city
				if (neighbor.isCity) {
					continue;
				}

				var neighborScore = 0;

				if (isCoastalRiver && oceanDrainTile) {
					// Coastal river logic: prefer neighbor that is also adjacent to the ocean drain tile
					var isNeighborToOcean = false;
					if (neighbor.tiles) {
						for (var k = 0; k < neighbor.tiles.length; k++) {
							if (neighbor.tiles[k] === oceanDrainTile) {
								isNeighborToOcean = true;
								break;
							}
						}
					}

					if (isNeighborToOcean) {
						neighborScore = 1000 - neighbor.elevation; // High bonus for river-ocean adjacency
						//console.log(`Found neighbor adjacent to both river and ocean drain`);
					} else {
						neighborScore = -neighbor.elevation; // Standard elevation preference
					}
				} else {
					// Non-coastal river logic: prefer neighbor with most river neighbors
					var riverNeighborCount = 0;
					if (neighbor.tiles) {
						for (var k = 0; k < neighbor.tiles.length; k++) {
							if (neighbor.tiles[k].river) {
								riverNeighborCount++;
							}
						}
					}

					neighborScore = riverNeighborCount * 100 - neighbor.elevation; // Prioritize river connectivity
				}

				if (neighborScore > bestNeighborScore) {
					bestNeighbor = neighbor;
					bestNeighborScore = neighborScore;
				}
			}

			if (bestNeighbor) {
				bestNeighbor.isCity = true;
				selectedCities.push(bestNeighbor);
			}
		} else if (!candidate.river && candidate.elevation > 0) {
			// Non-river land tile is suitable for city
			candidate.isCity = true;
			selectedCities.push(candidate);
		}
	}

/* 	// Debug information
	console.log("=== CITY LOCATION DEBUG ===");
	console.log(`Number of land tiles: ${landTiles.length}`);
	console.log(`Number of cities: ${selectedCities.length}`);
	if (selectedCities.length > 0) {
		var scores = selectedCities.map(city => city.cityPriorityScore || 0);
		var minScore = Math.min(...scores);
		var maxScore = Math.max(...scores);
		console.log(`City priority scores range: ${maxScore.toFixed(1)} (highest) to ${minScore.toFixed(1)} (lowest)`);
	}
	console.log("==========================="); */

	return selectedCities;
}

// Consolidate contiguous groups of local extrema, keeping only the most extreme tile
function consolidateExtremaGroups(extremaTiles) {
	var visited = new Set();

	for (var i = 0; i < extremaTiles.length; i++) {
		var startTile = extremaTiles[i];
		if (visited.has(startTile.id)) continue;

		// Find all connected extrema tiles
		var group = [];
		var queue = [startTile];
		var groupVisited = new Set([startTile.id]);

		while (queue.length > 0) {
			var currentTile = queue.shift();
			group.push(currentTile);
			visited.add(currentTile.id);

			// Check neighbors for other extrema tiles
			var neighbors = currentTile.tiles || [];
			for (var j = 0; j < neighbors.length; j++) {
				var neighbor = neighbors[j];

				// If neighbor is also an extrema tile and not visited
				if (extremaTiles.includes(neighbor) && !groupVisited.has(neighbor.id)) {
					queue.push(neighbor);
					groupVisited.add(neighbor.id);
				}
			}
		}

		// Find the most extreme tile in this group
		var bestTile = group[0];
		for (var j = 1; j < group.length; j++) {
			var tile = group[j];

			if (tile.elevation >= 0) {
				// For land: highest elevation (furthest from sea level)
				if (tile.elevation > bestTile.elevation) {
					bestTile = tile;
				}
			} else {
				// For ocean: lowest elevation (deepest)
				if (tile.elevation < bestTile.elevation) {
					bestTile = tile;
				}
			}
		}

		// Mark only the best tile in the group
		bestTile.joint = true;

		// Debug: Log body assignment
		//console.log(`Marked extrema tile ${bestTile.id}: elevation=${bestTile.elevation}, shore=${bestTile.shore}, body=${bestTile.body ? bestTile.body.id : 'no body'}`);
	}
}

// Calculate reverse shore distances for each connected land/ocean body
// Finds the max/min shore tile in each body, then calculates distances from those points
function calculateReverseShoreDistances(tiles) {
	// Initialize reverse shore values to 0
	for (var i = 0; i < tiles.length; i++) {
		tiles[i].reverseShore = 0;
		tiles[i].visited = false;
	}

	// Find all connected bodies (land and ocean separately)
	var bodies = [];

	for (var i = 0; i < tiles.length; i++) {
		var tile = tiles[i];
		if (tile.visited) continue;

		// Start a new body
		var body = {
			tiles: [],
			isLand: tile.elevation > 0,
			extremeTile: null
		};

		// Flood fill to find all tiles in this connected body
		var queue = [tile];
		tile.visited = true;

		while (queue.length > 0) {
			var currentTile = queue.shift();
			body.tiles.push(currentTile);

			// Check neighbors
			for (var j = 0; j < currentTile.tiles.length; j++) {
				var neighbor = currentTile.tiles[j];
				if (!neighbor.visited &&
					((body.isLand && neighbor.elevation > 0) || (!body.isLand && neighbor.elevation <= 0))) {
					neighbor.visited = true;
					queue.push(neighbor);
				}
			}
		}

		bodies.push(body);
	}

	// For each body, find the extreme shore tile (max for land, min for ocean)
	for (var i = 0; i < bodies.length; i++) {
		var body = bodies[i];
		var extremeTile = body.tiles[0];

		for (var j = 1; j < body.tiles.length; j++) {
			var tile = body.tiles[j];
			var isExtreme = false;

			if (body.isLand) {
				// Land: find max shore (furthest inland)
				if (tile.shore > extremeTile.shore) {
					isExtreme = true;
				} else if (tile.shore === extremeTile.shore && tile.elevation > extremeTile.elevation) {
					isExtreme = true;
				}
			} else {
				// Ocean: find min shore (furthest from land)
				if (tile.shore < extremeTile.shore) {
					isExtreme = true;
				} else if (tile.shore === extremeTile.shore && tile.elevation < extremeTile.elevation) {
					isExtreme = true;
				}
			}

			if (isExtreme) {
				extremeTile = tile;
			}
		}

		body.extremeTile = extremeTile;
	}

	// Calculate reverse shore distances from each extreme tile
	for (var i = 0; i < bodies.length; i++) {
		var body = bodies[i];
		if (!body.extremeTile) continue;

		// Reset visited flags for this body
		for (var j = 0; j < body.tiles.length; j++) {
			body.tiles[j].visited = false;
		}

		// BFS from extreme tile
		var queue = [{tile: body.extremeTile, distance: body.isLand ? 1 : -1}];
		body.extremeTile.reverseShore = body.isLand ? 1 : -1;
		body.extremeTile.visited = true;

		while (queue.length > 0) {
			var current = queue.shift();
			var currentTile = current.tile;
			var currentDistance = current.distance;

			// Check neighbors within the same body
			for (var j = 0; j < currentTile.tiles.length; j++) {
				var neighbor = currentTile.tiles[j];

				if (!neighbor.visited &&
					((body.isLand && neighbor.elevation > 0) || (!body.isLand && neighbor.elevation <= 0))) {

					var nextDistance = body.isLand ? currentDistance + 1 : currentDistance - 1;
					neighbor.reverseShore = nextDistance;
					neighbor.visited = true;
					queue.push({tile: neighbor, distance: nextDistance});
				}
			}
		}
	}

	// Clean up visited flags
	for (var i = 0; i < tiles.length; i++) {
		delete tiles[i].visited;
	}
}

// ============================================================================
// MAIN POST-GENERATION FUNCTION
// ============================================================================

// Main post-generation analysis function - runs after all planet attributes are finalized
function runPostGeneration(planet, action) {

	action
		.executeSubaction(function(action) {
			generatePlanetBiomesResources(planet.topology.tiles, 1000, action);
		}, 1, "Generating Biomes & Resources")
		.executeSubaction(function(action) {
			// Shore distances now calculated earlier in terrain generation
			action.provideResult("Shore distances complete");
		}, 0, "Shore Distances (already calculated)")
		.executeSubaction(function(action) {

			if (planet.topology && planet.topology.watersheds) {
				performWatershedAbsorption(planet.topology.watersheds);
			}

			action.provideResult("Watershed regions complete");
		}, 1, "Generating Watershed Regions")
		.executeSubaction(function(action) {

			var landTiles = planet.topology.tiles.filter(function(tile) {
				return tile.elevation > 0 && tile.landRegion && tile.landRegion > 0;
			});

			if (landTiles.length > 0) {
				var maxRegion = Math.max.apply(Math, landTiles.map(function(tile) { return tile.landRegion; }));
				applyLandRegionGraphColoring(landTiles, maxRegion);
			}

			action.provideResult("Land regions complete");
		}, 1, "Processing Land Regions")
		.executeSubaction(function(action) {
			action.provideResult("Post-generation complete");
		}, 0);
}