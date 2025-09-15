// Copyright Â© 2014 Andy Gainey <andy@experilous.com>
//
// Usage of the works is permitted provided that this instrument 
// is retained with the works, so that any entity that uses the
// works is notified of this instrument.
//
// DISCLAIMER: THE WORKS ARE WITHOUT WARRANTY.

//const THREE = require('three');

// Global elevation change logging function for debugging
window.logElevationChange = function(tile, functionName, newElevation) {
	if (!tile.log) tile.log = [];
	tile.log.push(functionName + ': ' + newElevation.toFixed(4));
};

// Global Average Border Length (ABL) for triangle sizing
var averageBorderLength = 10; // Default fallback value

// Global array to track labeled tiles
var labeledTiles = [];

// Terrain Color Initialization - Generated from Color Picker
terrainColors = {
	oceanSurfaceWarm: new THREE.Color("#27efff"),
	oceanSurfaceCold: new THREE.Color("#383f75"),
	oceanDeepWarm: new THREE.Color("#072995"),
	oceanDeepCold: new THREE.Color("#29225e"),
	landLowDry: new THREE.Color("#cccc66"),
	landLowWet: new THREE.Color("#005000"),
	landHighDry: new THREE.Color("#777788"),
	landHighWet: new THREE.Color("#444455"),
	landCold: new THREE.Color("#555544")
};

// calculateAverageBorderLength function moved to utilities.js

var scene = null;
var camera = null;
var renderer = null;
var directionalLight = null;
var activeAction = null;
var planet = null;
var tileSelection = null;
var zoom = 1.0;
var zoomAnimationStartTime = null;
var zoomAnimationDuration = null;
var zoomAnimationStartValue = null;
var zoomAnimationEndValue = null;
var cameraLatitude = 0;
var cameraLongitude = 0;
var surfaceRenderMode = "terrain";
var renderSunlight = false;
var renderPlateBoundaries = false;
var renderPlateMovements = false;
var renderAirCurrents = false;
var renderRivers = true;
var renderMoon = false;
var renderLabels = true;
var elevationMultiplier = 80; // Controls how exaggerated the 3D terrain elevation appears
var useElevationDisplacement = false; // Binary parameter: use stored displacement values (true) or sphere positions (false)
var riverElevationDeltaThreshold = 0.1; // Minimum elevation difference for white waterfall rivers
var enableElevationDistributionReshaping = true; // Apply realistic elevation distribution
var elevationExponent = 4; // Exponential curve steepness for elevation distribution (higher = more contrast)
var renderEdgeCosts = false;
var sunTimeOffset = 0;
var pressedKeys = {};
var disableKeys = false;
var ui = {};
var watersheds = [];
var riverThreshold = .88 //percentile of flow to start rivers (was .88, lowered for debugging)
var logTimers = false; // Enable/disable console timer logging for performance analysis
var loadSeed = null;//1724331434621;//< lake error//1723240716239;//

// Timer logging wrapper functions
function ctime(label) {
	if (logTimers) console.time(label);
}

function ctimeEnd(label) {
	if (logTimers) console.timeEnd(label);
}

// FPS tracking variables
var fpsCounter = {
	frameCount: 0,
	lastTime: performance.now(),
	currentFPS: 0,
	updateInterval: 1000 // Update FPS display every 1000ms
};
var largeSeed = 1724774450630;//1724945514838;//<large error//1724255095950;
//1731616718950;//<
//1734463621626;//good one to test small ocean fix
//1741195374764;//ditto
//1741226579941;//edge cases for inland seas balancing
var loadSize = 60;
var fromVertex = null;
var toVertex = null;
//var path = null;

// Create the graph
const graph = createGraph();
//const pathFinder = ngraphPath.aStar(graph);

var medianBorderLength = null;
var averageEdgeCost = null;
//var deepCold = ;
//var deepHot = ;
//var shallowCold = ;
//var shallowHot = ;


var generationSettings = {
	subdivisions: 60,//60
	distortionLevel: 1,
	plateCount: 36,
	oceanicRate: 0.7,
	heatLevel: 1.0,
	moistureLevel: 1.0,
	seed: null,
};

var Vector3 = THREE.Vector3;

var KEY_ENTER = 13;
var KEY_SHIFT = 16;
var KEY_ESCAPE = 27;
var KEY_SPACE = 32;
var KEY_LEFTARROW = 37;
var KEY_UPARROW = 38;
var KEY_RIGHTARROW = 39;
var KEY_DOWNARROW = 40;
var KEY_PAGEUP = 33;
var KEY_PAGEDOWN = 34;
var KEY_NUMPAD_PLUS = 107;
var KEY_NUMPAD_MINUS = 109;
var KEY_FORWARD_SLASH = 191;

var KEY = {};
for (var k = 0; k < 10; ++k) KEY[String.fromCharCode(k + 48)] = k + 48;
for (var k = 0; k < 26; ++k) KEY[String.fromCharCode(k + 65)] = k + 65;

function generatePlanetAsynchronous() {
	var planet;

	var subdivisions = generationSettings.subdivisions;

	var distortionRate;
	if (generationSettings.distortionLevel < 0.25) distortionRate = adjustRange(generationSettings.distortionLevel, 0.00, 0.25, 0.000, 0.040);
	else if (generationSettings.distortionLevel < 0.50) distortionRate = adjustRange(generationSettings.distortionLevel, 0.25, 0.50, 0.040, 0.050);
	else if (generationSettings.distortionLevel < 0.75) distortionRate = adjustRange(generationSettings.distortionLevel, 0.50, 0.75, 0.050, 0.075);
	else distortionRate = adjustRange(generationSettings.distortionLevel, 0.75, 1.00, 0.075, 0.150);

	var originalSeed = generationSettings.seed;
	var seed;
	if (typeof (originalSeed) === "number") seed = originalSeed;
	else if (typeof (originalSeed) === "string") seed = hashString(originalSeed);
	else seed = loadSeed
	loadSeed = Date.now();
	var random = new XorShift128(seed);

	var plateCount = generationSettings.plateCount;
	var oceanicRate = generationSettings.oceanicRate;
	var heatLevel = generationSettings.heatLevel;
	var moistureLevel = generationSettings.moistureLevel;

	activeAction = new SteppedAction(updateProgressUI)
		.executeSubaction(function (action) {
			ui.progressPanel.show();
		}, 0)
		.executeSubaction(function (action) {
			generatePlanet(subdivisions, distortionRate, plateCount, oceanicRate, heatLevel, moistureLevel, random, action);
		}, 1, "Generating Planet")
		.getResult(function (result) {
			planet = result;
			planet.seed = seed;
			planet.originalSeed = originalSeed;
		})
		.executeSubaction(function (action) {
			displayPlanet(planet);
			setSeed(null);
		}, 0)		
        .executeSubaction(function (action) {
            setDistances(planet, action); // Build the graph here
        }, 0)
		.finalize(function (action) {
			activeAction = null;
			ui.progressPanel.hide();
		}, 0)
		.execute();
}
function Planet() {}

// Function to collect all tiles with labels into the global labeledTiles array
function collectLabeledTiles(tiles, overlayMode) {
	console.log('DEBUG: collectLabeledTiles called with overlayMode:', overlayMode);
	labeledTiles = []; // Clear previous labels
	if (!tiles) {
		console.log('DEBUG: No tiles provided');
		return labeledTiles;
	}

	var foundLabeled = [];
	var landRegionCount = 0;
	var watershedRegionCount = 0;
	var regularLabelCount = 0;

	for (var i = 0; i < tiles.length; i++) {
		if (tiles[i].landRegionLabel) landRegionCount++;
		if (tiles[i].watershedRegionLabel) watershedRegionCount++;
		if (tiles[i].label) regularLabelCount++;

		var tileToAdd = null;
		var labelToShow = null;

		// Determine which label to show based on overlay mode
		if (overlayMode === "landRegions" && tiles[i].landRegionLabel) {
			labelToShow = tiles[i].landRegionLabel;
			// Create a clone with the region label as the main label
			tileToAdd = {
				label: labelToShow,
				averagePosition: tiles[i].averagePosition,
				elevation: tiles[i].elevation,
				elevationDisplacement: tiles[i].elevationDisplacement
			};
		} else if (overlayMode === "watershedRegions" && tiles[i].watershedRegionLabel) {
			labelToShow = tiles[i].watershedRegionLabel;
			// Create a clone with the watershed label as the main label
			tileToAdd = {
				label: labelToShow,
				averagePosition: tiles[i].averagePosition,
				elevation: tiles[i].elevation,
				elevationDisplacement: tiles[i].elevationDisplacement
			};
		} else if (overlayMode !== "landRegions" && overlayMode !== "watershedRegions" && tiles[i].label) {
			// Show regular labels (like Mount Everest) for all other overlays
			labelToShow = tiles[i].label;
			tileToAdd = tiles[i];
		}

		if (tileToAdd && labelToShow) {
			labeledTiles.push(tileToAdd);
			foundLabeled.push({label: labelToShow, elevation: tiles[i].elevation, id: tiles[i].id});
		}
	}

	console.log('DEBUG: Found tiles with labels - landRegion:', landRegionCount, 'watershedRegion:', watershedRegionCount, 'regular:', regularLabelCount);
	console.log('DEBUG: Collected', labeledTiles.length, 'tiles for display in mode:', overlayMode);

	return labeledTiles;
}

function generatePlanet(icosahedronSubdivision, topologyDistortionRate, plateCount, oceanicRate, heatLevel, moistureLevel, random, action) {
	ctime('Total Generation Time');
	var planet = new Planet();
	var mesh;
	
	action
		.executeSubaction(function (action) {
			ctime('1. Mesh Generation');
			generatePlanetMesh(icosahedronSubdivision, topologyDistortionRate, random, action);
		}, 6, "Generating Mesh")
		.getResult(function (result) {
			ctimeEnd('1. Mesh Generation');
			mesh = result;
		})
		.executeSubaction(function (action) {
			ctime('2. Topology Generation');
			generatePlanetTopology(mesh, action);
		}, 1, "Generating Topology")
		.getResult(function (result) {
			ctimeEnd('2. Topology Generation');
			planet.topology = result;
			planet.topology.watersheds = [];
			
			// Calculate Average Border Length (ABL) for triangle sizing
			averageBorderLength = calculateAverageBorderLength(planet.topology.borders);
		})
		.executeSubaction(function (action) {
			ctime('3. Spatial Partitions');
			generatePlanetPartition(planet.topology.tiles, action);
		}, 1, "Generating Spatial Partitions")
		.getResult(function (result) {
			ctimeEnd('3. Spatial Partitions');
			planet.partition = result;
		})
		.executeSubaction(function (action) {
			ctime('4. Terrain Generation');
			generatePlanetTerrain(planet, plateCount, oceanicRate, heatLevel, moistureLevel, random, action);
		}, 9, "Generating Terrain")
		.getResult(function (result) {
			ctimeEnd('4. Terrain Generation');
		})
		.executeSubaction(function (action) {
			ctime('5. Statistics');
			generatePlanetStatistics(planet.topology, planet.plates, action);
		}, 1, "Compiling Statistics")
		.getResult(function (result) {
			ctimeEnd('5. Statistics');
			planet.statistics = result;
			ctimeEnd('Total Generation Time');
		})
		.provideResult(planet);
}

function generatePlanetTerrain(planet, plateCount, oceanicRate, heatLevel, moistureLevel, random, action) {
	
	action
		.executeSubaction(function (action) {
			ctime('4a. Tectonic Plates');
			generatePlanetTectonicPlates(planet.topology, plateCount, oceanicRate, random, action);
		}, 3, "Generating Tectonic Plates")
		.getResult(function (result) {
			ctimeEnd('4a. Tectonic Plates');
			planet.plates = result;
		})
		.executeSubaction(function (action) {
			ctime('4b. Base Elevation');
			generatePlanetElevation(planet.topology, planet.plates, action);
		}, 4, "Generating Elevation")
		.executeSubaction(function (action) {
			ctimeEnd('4b. Base Elevation');
			ctime('4c. Weather & Climate');
			generatePlanetWeather(planet.topology, planet.partition, heatLevel, moistureLevel, random, action);
		}, 16, "Generating Weather")
		.executeSubaction(function (action) {
			ctimeEnd('4c. Weather & Climate');
			ctime('4d. Erosion Process');
			erodeElevation(planet, action);
		}, 8, "Weathering Elevation")
		.executeSubaction(function (action) {
			ctimeEnd('4d. Erosion Process');
			ctime('4e. Tile Elevation Processing');
			tileElevationProcs(planet.topology.tiles, action);
		}, 2)
		.executeSubaction(function (action) {
			ctimeEnd('4e. Tile Elevation Processing');
			ctime('4f. Final Elevation Processing');
			reshapeLandElevations(planet.topology.tiles, action);
		}, 1, "Reshaping Land Elevation Distribution")
		.executeSubaction(function (action) {
			calculateCornerElevationMedians(planet.topology, action);
		}, 1, "Calculating Final Corner Elevation Medians")
		.executeSubaction(function (action) {
			calculateElevationDisplacements(planet.topology, action);
		}, 1, "Calculating Final Elevation Displacements")
		.executeSubaction(function (action) {
			validateDisplacements(planet.topology);
		}, 1, "Validating Final Displacement Calculations")
		.executeSubaction(function (action) {
			ctimeEnd('4f. Final Elevation Processing');
			ctime('4g. Distance Calculations');
			setDistances(planet, action);
		}, 8, "Creating Distances")

		//erode
		.executeSubaction(function (action) {
			ctimeEnd('4g. Distance Calculations');
			ctime('4h. Post-Generation Analysis');
			runPostGeneration(planet, action);
		}, 3, "Generating Biomes & Regions")
		.executeSubaction(function (action) {
			// Collect labeled tiles after biomes are generated
			collectLabeledTiles(planet.topology.tiles, surfaceRenderMode);
		}, 0)
		.executeSubaction(function (action) {
			ctimeEnd('4h. Post-Generation Analysis');
			ctime('4i. Render Data Generation');
			generatePlanetRenderData(planet.topology, random, action);
		}, 1, "Building Visuals")
		.getResult(function (result) {
			ctimeEnd('4j. Render Data Generation');
			// Store render data in planet object 
			planet.renderData = result;
		});

}

function calculateCornerDistancesToPlateRoot(plates, action) {
	var distanceCornerQueue = [];
	for (var i = 0; i < plates.length; ++i) {
		var corner = plates[i].root;
		corner.distanceToPlateRoot = 0;
		for (var j = 0; j < corner.corners.length; ++j) {
			distanceCornerQueue.push({
				corner: corner.corners[j],
				distanceToPlateRoot: corner.borders[j].length()
			});
		}
	}

	var distanceCornerQueueSorter = function (left, right) {
		return left.distanceToPlateRoot - right.distanceToPlateRoot;
	};

	action.executeSubaction(function (action) {
		if (distanceCornerQueue.length === 0) return;

		var iEnd = iEnd = distanceCornerQueue.length;
		for (var i = 0; i < iEnd; ++i) {
			var front = distanceCornerQueue[i];
			var corner = front.corner;
			var distanceToPlateRoot = front.distanceToPlateRoot;
			if (!corner.distanceToPlateRoot || corner.distanceToPlateRoot > distanceToPlateRoot) {
				corner.distanceToPlateRoot = distanceToPlateRoot;
				for (var j = 0; j < corner.corners.length; ++j) {
					distanceCornerQueue.push({
						corner: corner.corners[j],
						distanceToPlateRoot: distanceToPlateRoot + corner.borders[j].length()
					});
				}
			}
		}
		distanceCornerQueue.splice(0, iEnd);
		distanceCornerQueue.sort(distanceCornerQueueSorter);

		action.loop();
	});
}

// groupBodies function moved to generatePlanetTerrain_functions.js

function generatePlanetRenderData(topology, random, action) {
	var renderData = {};

	action
		.executeSubaction(function (action) {
			var lambertMaterial = new THREE.MeshLambertMaterial({
				vertexColors: true,
				wireframe: false,
				side: THREE.DoubleSide,
				flatShading: true
			});
			buildSurfaceRenderObject(topology.tiles, topology.watersheds, random, action, lambertMaterial);
		}, 8, "Building Surface Visuals")
		.getResult(function (result) {
			renderData.surface = result;
		})
		
		.executeSubaction(function (action) {
			buildTestTileObject(topology.tiles, random, action);
		}, 1, "Building Test Tile Object")
		.getResult(function (result) {
			renderData.testTiles = result;
		})
		
		.executeSubaction(function (action) {
			buildSimpleTestObject(action);
		}, 1, "Building Simple Test Object")
		.getResult(function (result) {
			renderData.simpleTest = result;
		})
		.executeSubaction(function (action) {
			buildPlateBoundariesRenderObject(topology.borders, action);
		}, 1, "Building Plate Boundary Visuals")
		.getResult(function (result) {
			renderData.plateBoundaries = result;
		})
		.executeSubaction(function (action) {
			buildPlateMovementsRenderObject(topology.tiles, action);
		}, 2, "Building Plate Movement Visuals")
		.getResult(function (result) {
			renderData.plateMovements = result;
		})
		.executeSubaction(function (action) {
			buildAirCurrentsRenderObject(topology.corners, action);
		}, 2, "Building Air Current Visuals")
		.getResult(function (result) {
			renderData.airCurrents = result;
		})
		.executeSubaction(function (action) {
			buildRiversRenderObject(topology.tiles, action);
		}, 2, "Building River Visuals")
		.getResult(function (result) {
			renderData.Rivers = result;
		})
		.executeSubaction(function (action) {
			buildMoonRenderObject(action);
		}, 1, "Building Moon for Material Testing")
		.getResult(function (result) {
			renderData.moon = result;
		})
		.executeSubaction(function (action) {
			renderData.labels = buildLabelsRenderObject();
		}, 1, "Building Label Visuals");

	action.provideResult(renderData);
}

function nrm(input = Math.random(), tr = 'logistic', p = 0, q = 1) {
	//bigger q=steeper ramp
	if (tr == 'logistic') {
		return 1 / (1 + Math.pow(Math.E, -(q * (input - (p - 0.5)))));
	}
}

function generatePlanetStatistics(topology, plates, action) {
	var statistics = {};

	var updateMinMaxAvg = function (stats, value) {
		stats.min = Math.min(stats.min, value);
		stats.max = Math.max(stats.max, value);
		stats.avg += value;
	};

	statistics.corners = {
		count: topology.corners.length,
		airCurrent: {
			min: Number.POSITIVE_INFINITY,
			max: Number.NEGATIVE_INFINITY,
			avg: 0
		},
		elevation: {
			min: Number.POSITIVE_INFINITY,
			max: Number.NEGATIVE_INFINITY,
			avg: 0
		},
		temperature: {
			min: Number.POSITIVE_INFINITY,
			max: Number.NEGATIVE_INFINITY,
			avg: 0
		},
		moisture: {
			min: Number.POSITIVE_INFINITY,
			max: Number.NEGATIVE_INFINITY,
			avg: 0
		},
		distanceToPlateBoundary: {
			min: Number.POSITIVE_INFINITY,
			max: Number.NEGATIVE_INFINITY,
			avg: 0
		},
		distanceToPlateRoot: {
			min: Number.POSITIVE_INFINITY,
			max: Number.NEGATIVE_INFINITY,
			avg: 0
		},
		pressure: {
			min: Number.POSITIVE_INFINITY,
			max: Number.NEGATIVE_INFINITY,
			avg: 0
		},
		shear: {
			min: Number.POSITIVE_INFINITY,
			max: Number.NEGATIVE_INFINITY,
			avg: 0
		},
		doublePlateBoundaryCount: 0,
		triplePlateBoundaryCount: 0,
		innerLandBoundaryCount: 0,
		outerLandBoundaryCount: 0,
	};

	for (var i = 0; i < topology.corners.length; ++i) {
		corner = topology.corners[i];
		updateMinMaxAvg(statistics.corners.airCurrent, corner.airCurrent.length());
		updateMinMaxAvg(statistics.corners.elevation, corner.elevation);
		updateMinMaxAvg(statistics.corners.temperature, corner.temperature);
		updateMinMaxAvg(statistics.corners.moisture, corner.moisture);
		updateMinMaxAvg(statistics.corners.distanceToPlateBoundary, corner.distanceToPlateBoundary);
		updateMinMaxAvg(statistics.corners.distanceToPlateRoot, corner.distanceToPlateRoot);
		if (corner.betweenPlates) {
			updateMinMaxAvg(statistics.corners.pressure, corner.pressure);
			updateMinMaxAvg(statistics.corners.shear, corner.shear);
			if (!corner.borders[0].betweenPlates || !corner.borders[1].betweenPlates || !corner.borders[2].betweenPlates) {
				statistics.corners.doublePlateBoundaryCount += 1;
			} else {
				statistics.corners.triplePlateBoundaryCount += 1;
			}
		}
		var landCount = ((corner.tiles[0].elevation > 0) ? 1 : 0) + ((corner.tiles[1].elevation > 0) ? 1 : 0) + ((corner.tiles[2].elevation > 0) ? 1 : 0);
		if (landCount === 2) {
			statistics.corners.innerLandBoundaryCount += 1;
		} else if (landCount === 1) {
			statistics.corners.outerLandBoundaryCount += 1;
		}
		if (corner.corners.length !== 3) throw "Corner has as invalid number of neighboring corners.";
		if (corner.borders.length !== 3) throw "Corner has as invalid number of borders.";
		if (corner.tiles.length !== 3) throw "Corner has as invalid number of tiles.";
	}

	statistics.corners.airCurrent.avg /= statistics.corners.count;
	statistics.corners.elevation.avg /= statistics.corners.count;
	statistics.corners.temperature.avg /= statistics.corners.count;
	statistics.corners.moisture.avg /= statistics.corners.count;
	statistics.corners.distanceToPlateBoundary.avg /= statistics.corners.count;
	statistics.corners.distanceToPlateRoot.avg /= statistics.corners.count;
	statistics.corners.pressure.avg /= (statistics.corners.doublePlateBoundaryCount + statistics.corners.triplePlateBoundaryCount);
	statistics.corners.shear.avg /= (statistics.corners.doublePlateBoundaryCount + statistics.corners.triplePlateBoundaryCount);

	statistics.borders = {
		count: topology.borders.length,
		length: {
			min: Number.POSITIVE_INFINITY,
			max: Number.NEGATIVE_INFINITY,
			avg: 0
		},
		plateBoundaryCount: 0,
		plateBoundaryPercentage: 0,
		landBoundaryCount: 0,
		landBoundaryPercentage: 0,
	};

	for (var i = 0; i < topology.borders.length; ++i) {
		border = topology.borders[i];
		var length = border.length();
		updateMinMaxAvg(statistics.borders.length, length);
		if (border.betweenPlates) {
			statistics.borders.plateBoundaryCount += 1;
			statistics.borders.plateBoundaryPercentage += length;
		}
		if (border.isLandBoundary()) {
			statistics.borders.landBoundaryCount += 1;
			statistics.borders.landBoundaryPercentage += length;
		}
		if (border.corners.length !== 2) throw "Border has as invalid number of corners.";
		if (border.borders.length !== 4) throw "Border has as invalid number of neighboring borders.";
		if (border.tiles.length !== 2) throw "Border has as invalid number of tiles.";
	}

	statistics.borders.plateBoundaryPercentage /= statistics.borders.length.avg;
	statistics.borders.landBoundaryPercentage /= statistics.borders.length.avg;
	statistics.borders.length.avg /= statistics.borders.count;

	statistics.tiles = {
		count: topology.tiles.length,
		totalArea: 0,
		area: {
			min: Number.POSITIVE_INFINITY,
			max: Number.NEGATIVE_INFINITY,
			avg: 0
		},
		elevation: {
			min: Number.POSITIVE_INFINITY,
			max: Number.NEGATIVE_INFINITY,
			avg: 0
		},
		temperature: {
			min: Number.POSITIVE_INFINITY,
			max: Number.NEGATIVE_INFINITY,
			avg: 0
		},
		moisture: {
			min: Number.POSITIVE_INFINITY,
			max: Number.NEGATIVE_INFINITY,
			avg: 0
		},
		plateMovement: {
			min: Number.POSITIVE_INFINITY,
			max: Number.NEGATIVE_INFINITY,
			avg: 0
		},
		biomeCounts: {},
		biomeAreas: {},
		pentagonCount: 0,
		hexagonCount: 0,
		heptagonCount: 0,
	};

	for (var i = 0; i < topology.tiles.length; ++i) {
		var tile = topology.tiles[i];
		updateMinMaxAvg(statistics.tiles.area, tile.area);
		updateMinMaxAvg(statistics.tiles.elevation, tile.elevation);
		updateMinMaxAvg(statistics.tiles.temperature, tile.temperature);
		updateMinMaxAvg(statistics.tiles.moisture, tile.moisture);
		updateMinMaxAvg(statistics.tiles.plateMovement, tile.plateMovement.length());
		if (!statistics.tiles.biomeCounts[tile.biome]) statistics.tiles.biomeCounts[tile.biome] = 0;
		statistics.tiles.biomeCounts[tile.biome] += 1;
		if (!statistics.tiles.biomeAreas[tile.biome]) statistics.tiles.biomeAreas[tile.biome] = 0;
		statistics.tiles.biomeAreas[tile.biome] += tile.area;
		if (tile.tiles.length === 5) statistics.tiles.pentagonCount += 1;
		else if (tile.tiles.length === 6) statistics.tiles.hexagonCount += 1;
		else if (tile.tiles.length === 7) statistics.tiles.heptagonCount += 1;
		else throw ("Tile has an invalid number of neighboring tiles.", tile); //throw tile;
		//tile neighbors
		if (tile.tiles.length !== tile.borders.length) throw "Tile has a neighbor and border count that do not match.";
		if (tile.tiles.length !== tile.corners.length) throw "Tile has a neighbor and corner count that do not match.";
	}

	statistics.tiles.totalArea = statistics.tiles.area.avg;
	statistics.tiles.area.avg /= statistics.tiles.count;
	statistics.tiles.elevation.avg /= statistics.tiles.count;
	statistics.tiles.temperature.avg /= statistics.tiles.count;
	statistics.tiles.moisture.avg /= statistics.tiles.count;
	statistics.tiles.plateMovement.avg /= statistics.tiles.count;

	statistics.plates = {
		count: plates.length,
		tileCount: {
			min: Number.POSITIVE_INFINITY,
			max: Number.NEGATIVE_INFINITY,
			avg: 0
		},
		area: {
			min: Number.POSITIVE_INFINITY,
			max: Number.NEGATIVE_INFINITY,
			avg: 0
		},
		boundaryElevation: {
			min: Number.POSITIVE_INFINITY,
			max: Number.NEGATIVE_INFINITY,
			avg: 0
		},
		boundaryBorders: {
			min: Number.POSITIVE_INFINITY,
			max: Number.NEGATIVE_INFINITY,
			avg: 0
		},
		circumference: {
			min: Number.POSITIVE_INFINITY,
			max: Number.NEGATIVE_INFINITY,
			avg: 0
		},
	};

	for (var i = 0; i < plates.length; ++i) {
		var plate = plates[i];
		updateMinMaxAvg(statistics.plates.tileCount, plate.tiles.length);
		plate.area = 0;
		for (var j = 0; j < plate.tiles.length; ++j) {
			var tile = plate.tiles[j];
			plate.area += tile.area;
		}
		updateMinMaxAvg(statistics.plates.area, plate.area);
		var elevation = 0;
		for (var j = 0; j < plate.boundaryCorners.length; ++j) {
			var corner = plate.boundaryCorners[j];
			elevation += corner.elevation;
		}
		updateMinMaxAvg(statistics.plates.boundaryElevation, elevation / plate.boundaryCorners.length);
		updateMinMaxAvg(statistics.plates.boundaryBorders, plate.boundaryBorders.length);
		plate.circumference = 0;
		for (var j = 0; j < plate.boundaryBorders.length; ++j) {
			var border = plate.boundaryBorders[j];
			plate.circumference += border.length();
		}
		updateMinMaxAvg(statistics.plates.circumference, plate.circumference);
	}

	statistics.plates.tileCount.avg /= statistics.plates.count;
	statistics.plates.area.avg /= statistics.plates.count;
	statistics.plates.boundaryElevation.avg /= statistics.plates.count;
	statistics.plates.boundaryBorders.avg /= statistics.plates.count;
	statistics.plates.circumference.avg /= statistics.plates.count;

	action.provideResult(statistics);
}

var lastRenderFrameTime = null;

function getZoomDelta() {
	var zoomIn = (pressedKeys[KEY_NUMPAD_PLUS] || pressedKeys[KEY_PAGEUP]);
	var zoomOut = (pressedKeys[KEY_NUMPAD_MINUS] || pressedKeys[KEY_PAGEDOWN]);
	if (zoomIn && !zoomOut) return -1;
	if (zoomOut && !zoomIn) return +1;
	return 0;
}

function getLatitudeDelta() {
	var up = (pressedKeys[KEY.W] || pressedKeys[KEY.Z] || pressedKeys[KEY_UPARROW]);
	var down = (pressedKeys[KEY.S] || pressedKeys[KEY_DOWNARROW]);
	if (up && !down) return +1;
	if (down && !up) return -1;
	return 0;
}

function getLongitudeDelta() {
	var left = (pressedKeys[KEY.A] || pressedKeys[KEY.Q] || pressedKeys[KEY_LEFTARROW]);
	var right = (pressedKeys[KEY.D] || pressedKeys[KEY_RIGHTARROW]);
	if (right && !left) return +1;
	if (left && !right) return -1;
	return 0;
}

function displayPlanet(newPlanet) {
    if (planet) {
        tileSelection = null;
        scene.remove(planet.renderData.surface.renderObject);
        
        // Remove test cube if it exists
        if (planet.renderData.surface.testCube) {
            scene.remove(planet.renderData.surface.testCube);
        }
        
        // Remove existing path render object
        if (planet.pathRenderObject) {
            for (let i = planet.pathRenderObject.length - 1; i >= 0; i--) {
                scene.remove(planet.pathRenderObject[i]);
            }
            planet.pathRenderObject = [];
        }
        // Remove existing edge costs render object
        if (planet.edgeCostsRenderObject) {
            scene.remove(planet.edgeCostsRenderObject);
        }
        
        // Remove existing labels
        if (planet.renderData && planet.renderData.labels) {
            scene.remove(planet.renderData.labels);
        }
    } else {
        sunTimeOffset = Math.PI * 2 * (1 / 12 - Date.now() / 60000);
    }
    planet = newPlanet;
    scene.add(planet.renderData.surface.renderObject);
    setSurfaceRenderMode(surfaceRenderMode, true);
    showHideSunlight(renderSunlight);
    showHidePlateBoundaries(renderPlateBoundaries);
    showHidePlateMovements(renderPlateMovements);
    showHideAirCurrents(renderAirCurrents);
    showHideRivers(renderRivers);
    showHideMoon(renderMoon);
    showHideLabels(renderLabels);
    updateCamera();
    updateUI();

    // Reset path, fromVertex, and toVertex
    path = null;
    fromVertex = null;
    toVertex = null;
    renderPath([]);

    // Add edge costs render object
    planet.edgeCostsRenderObject = buildEdgeCostsRenderObject(planet.aStarEdges);
    if (renderEdgeCosts) {
        scene.add(planet.edgeCostsRenderObject);
    }

    // Create the graph and path finder
    //const graph = createGraph();

    // Add nodes and edges to the graph
    //buildGraph(planet.aStarVertices, planet.aStarEdges);
}

function showHideLabels(show) {
	
	renderLabels = show;
	if (!planet || !planet.renderData || !planet.renderData.labels) {
		return;
	}
	
	if (show) {
		scene.add(planet.renderData.labels);
	} else {
		scene.remove(planet.renderData.labels);
	}
}

function showHideInterface() {
	ui.helpPanel.toggle();
	ui.controlPanel.toggle();
	ui.updatePanel.toggle();
	
	// Toggle terrain color panel
	var terrainColorPanel = document.getElementById('terrainColorPanel');
	if (terrainColorPanel) {
		terrainColorPanel.style.display = terrainColorPanel.style.display === 'none' ? 'block' : 'none';
	}
	
	// Toggle FPS overlay - show with control panel
	var fpsOverlay = document.getElementById('fpsOverlay');
	if (fpsOverlay) {
		// Check if panels are visible to determine FPS overlay state
		var controlPanelVisible = ui.controlPanel.is(':visible');
		fpsOverlay.style.display = controlPanelVisible ? 'block' : 'none';
	}
}

function updateUI() {
	ui.tileCountLabel.text(planet.statistics.tiles.count.toFixed(0));
	ui.pentagonCountLabel.text(planet.statistics.tiles.pentagonCount.toFixed(0));
	ui.hexagonCountLabel.text(planet.statistics.tiles.hexagonCount.toFixed(0));
	ui.heptagonCountLabel.text(planet.statistics.tiles.heptagonCount.toFixed(0));
	ui.plateCountLabel.text(planet.statistics.plates.count.toFixed(0));
	ui.waterPercentageLabel.text(((planet.statistics.tiles.biomeAreas["ocean"] + planet.statistics.tiles.biomeAreas["seaIce"]) / planet.statistics.tiles.totalArea * 100).toFixed(0) + "%");

	ui.rawSeedLabel.val(planet.seed);
	ui.originalSeedLabel.val(planet.originalSeed !== null ? planet.originalSeed : "");

	ui.minAirCurrentSpeedLabel.text(planet.statistics.corners.airCurrent.min.toFixed(0));
	ui.avgAirCurrentSpeedLabel.text(planet.statistics.corners.airCurrent.avg.toFixed(0));
	ui.maxAirCurrentSpeedLabel.text(planet.statistics.corners.airCurrent.max.toFixed(0));

	ui.minElevationLabel.text((planet.statistics.tiles.elevation.min * 100).toFixed(0));
	ui.avgElevationLabel.text((planet.statistics.tiles.elevation.avg * 100).toFixed(0));
	ui.maxElevationLabel.text((planet.statistics.tiles.elevation.max * 100).toFixed(0));

	ui.minTemperatureLabel.text((planet.statistics.tiles.temperature.min * 100).toFixed(0));
	ui.avgTemperatureLabel.text((planet.statistics.tiles.temperature.avg * 100).toFixed(0));
	ui.maxTemperatureLabel.text((planet.statistics.tiles.temperature.max * 100).toFixed(0));

	ui.minMoistureLabel.text((planet.statistics.tiles.moisture.min * 100).toFixed(0));
	ui.avgMoistureLabel.text((planet.statistics.tiles.moisture.avg * 100).toFixed(0));
	ui.maxMoistureLabel.text((planet.statistics.tiles.moisture.max * 100).toFixed(0));

	ui.minPlateMovementSpeedLabel.text(planet.statistics.tiles.plateMovement.min.toFixed(0));
	ui.avgPlateMovementSpeedLabel.text(planet.statistics.tiles.plateMovement.avg.toFixed(0));
	ui.maxPlateMovementSpeedLabel.text(planet.statistics.tiles.plateMovement.max.toFixed(0));

	ui.minTileAreaLabel.text(planet.statistics.tiles.area.min.toFixed(0));
	ui.avgTileAreaLabel.text(planet.statistics.tiles.area.avg.toFixed(0));
	ui.maxTileAreaLabel.text(planet.statistics.tiles.area.max.toFixed(0));

	ui.minPlateAreaLabel.text((planet.statistics.plates.area.min / 1000).toFixed(0) + "K");
	ui.avgPlateAreaLabel.text((planet.statistics.plates.area.avg / 1000).toFixed(0) + "K");
	ui.maxPlateAreaLabel.text((planet.statistics.plates.area.max / 1000).toFixed(0) + "K");

	ui.minPlateCircumferenceLabel.text(planet.statistics.plates.circumference.min.toFixed(0));
	ui.avgPlateCircumferenceLabel.text(planet.statistics.plates.circumference.avg.toFixed(0));
	ui.maxPlateCircumferenceLabel.text(planet.statistics.plates.circumference.max.toFixed(0));
}

function updateProgressUI(action) {
	var progress = action.getProgress();
	ui.progressBar.css("width", (progress * 100).toFixed(0) + "%");
	ui.progressBarLabel.text((progress * 100).toFixed(0) + "%");
	ui.progressActionLabel.text(action.getCurrentActionName());
}

function Plate(color, driftAxis, driftRate, spinRate, elevation, oceanic, root) {
	this.color = color;
	this.driftAxis = driftAxis;
	this.driftRate = driftRate;
	this.spinRate = spinRate;
	this.elevation = elevation;
	this.oceanic = oceanic;
	this.root = root;
	this.tiles = [];
	this.boundaryCorners = [];
	this.boundaryBorders = [];
}

Plate.prototype.calculateMovement = function Plate_calculateMovement(position) {
	var movement = this.driftAxis.clone().cross(position).setLength(this.driftRate * position.clone().projectOnVector(this.driftAxis).distanceTo(position));
	movement.add(this.root.position.clone().cross(position).setLength(this.spinRate * position.clone().projectOnVector(this.root.position).distanceTo(position)));
	return movement;
};

function SpatialPartition(boundingSphere, partitions, tiles) {
	this.boundingSphere = boundingSphere;
	this.partitions = partitions;
	this.tiles = tiles;
}

SpatialPartition.prototype.intersectRay = function SpatialPartition_intersectRay(ray) {
	if (intersectRayWithSphere(ray, this.boundingSphere)) {
		for (var i = 0; i < this.partitions.length; ++i) {
			var intersection = this.partitions[i].intersectRay(ray);
			if (intersection !== false) {
				return intersection;
			}
		}

		for (var i = 0; i < this.tiles.length; ++i) {
			if (this.tiles[i].intersectRay(ray)) {
				return this.tiles[i];
			}
		}
	}

	return false;
};
