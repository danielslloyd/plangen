// Copyright Â© 2014 Andy Gainey <andy@experilous.com>
//
// Usage of the works is permitted provided that this instrument 
// is retained with the works, so that any entity that uses the
// works is notified of this instrument.
//
// DISCLAIMER: THE WORKS ARE WITHOUT WARRANTY.

//const THREE = require('three');

var scene = null;
var camera = null;
var renderer = null;
var projector = null;
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
var renderEdgeCosts = false;
var sunTimeOffset = 0;
var pressedKeys = {};
var disableKeys = false;
var ui = {};
var watersheds = [];
var riverThreshold = .0001
var loadSeed = null;//1724331434621;//< lake error//1723240716239;//
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

$(document).ready(function onDocumentReady() {
	scene = new THREE.Scene();
	camera = new THREE.PerspectiveCamera(70, 1, 0.2, 2000); //(75, 1, 0.2, 2000)
	renderer = new THREE.WebGLRenderer({
		antialias: true,
		alpha: true
	});
	projector = new THREE.Projector();

	renderer.setFaceCulling(THREE.CullFaceFront, THREE.FrontFaceDirectionCW);

	var ambientLight = new THREE.AmbientLight(0xFFFFFF);
	scene.add(ambientLight);

	directionalLight = new THREE.DirectionalLight(0xFFFFFF);
	directionalLight.position.set(-3, 3, 7).normalize();
	scene.add(directionalLight);

	requestAnimationFrame(render);

	resetCamera();
	updateCamera();

	ui.body = $("body");
	ui.frame = $("#viewportFrame");
	ui.rendererElement = $(renderer.domElement);
	ui.frame.append(ui.rendererElement);
	ui.rendererElement.on("mousewheel", zoomHandler);
	ui.rendererElement.on("click", clickHandler);
	ui.body.on("keydown", keyDownHandler);
	ui.body.on("keyup", keyUpHandler);
	ui.body.focus();

	ui.helpPanel = $("#helpPanel");

	ui.controlPanel = $("#controlPanel");
	ui.surfaceDisplayButtons = {
		terrain: $("#showTerrainButton"),
		plates: $("#showPlatesButton"),
		elevation: $("#showElevationButton"),
		temperature: $("#showTemperatureButton"),
		moisture: $("#showMoistureButton"),
	};

	ui.surfaceDisplayButtons.terrain.click(setSurfaceRenderMode.bind(null, "terrain"));
	ui.surfaceDisplayButtons.plates.click(setSurfaceRenderMode.bind(null, "plates"));
	ui.surfaceDisplayButtons.elevation.click(setSurfaceRenderMode.bind(null, "elevation"));
	ui.surfaceDisplayButtons.temperature.click(setSurfaceRenderMode.bind(null, "temperature"));
	ui.surfaceDisplayButtons.moisture.click(setSurfaceRenderMode.bind(null, "moisture"));

	ui.showSunlightButton = $("#showSunlightButton");
	ui.showPlateBoundariesButton = $("#showPlateBoundariesButton");
	ui.showPlateMovementsButton = $("#showPlateMovementsButton");
	ui.showAirCurrentsButton = $("#showAirCurrentsButton");

	ui.showSunlightButton.click(showHideSunlight);
	ui.showPlateBoundariesButton.click(showHidePlateBoundaries);
	ui.showPlateMovementsButton.click(showHidePlateMovements);
	ui.showAirCurrentsButton.click(showHideAirCurrents);

	ui.lowDetailButton = $("#lowDetailButton");
	ui.mediumDetailButton = $("#mediumDetailButton");
	ui.highDetailButton = $("#highDetailButton");
	ui.generatePlanetButton = $("#generatePlanetButton");
	ui.advancedSettingsButton = $("#advancedSettingsButton");

	ui.lowDetailButton.click(setSubdivisions.bind(null, 20));
	ui.mediumDetailButton.click(setSubdivisions.bind(null, 40));
	ui.highDetailButton.click(setSubdivisions.bind(null, 60));
	ui.generatePlanetButton.click(generatePlanetAsynchronous);
	ui.advancedSettingsButton.click(showAdvancedSettings);

	ui.dataPanel = $("#dataPanel");

	ui.progressPanel = $("#progressPanel");
	ui.progressActionLabel = $("#progressActionLabel");
	ui.progressBarFrame = $("#progressBarFrame");
	ui.progressBar = $("#progressBar");
	ui.progressBarLabel = $("#progressBarLabel");
	ui.progressCancelButton = $("#progressCancelButton");
	ui.progressCancelButton.click(cancelButtonHandler);
	ui.progressPanel.hide();

	ui.tileCountLabel = $("#tileCountLabel");
	ui.pentagonCountLabel = $("#pentagonCountLabel");
	ui.hexagonCountLabel = $("#hexagonCountLabel");
	ui.heptagonCountLabel = $("#heptagonCountLabel");
	ui.plateCountLabel = $("#plateCountLabel");
	ui.waterPercentageLabel = $("#waterPercentageLabel");
	ui.rawSeedLabel = $("#rawSeedLabel");
	ui.originalSeedLabel = $("#originalSeedLabel");

	ui.minAirCurrentSpeedLabel = $("#minAirCurrentSpeedLabel");
	ui.avgAirCurrentSpeedLabel = $("#avgAirCurrentSpeedLabel");
	ui.maxAirCurrentSpeedLabel = $("#maxAirCurrentSpeedLabel");

	ui.minElevationLabel = $("#minElevationLabel");
	ui.avgElevationLabel = $("#avgElevationLabel");
	ui.maxElevationLabel = $("#maxElevationLabel");

	ui.minTemperatureLabel = $("#minTemperatureLabel");
	ui.avgTemperatureLabel = $("#avgTemperatureLabel");
	ui.maxTemperatureLabel = $("#maxTemperatureLabel");

	ui.minMoistureLabel = $("#minMoistureLabel");
	ui.avgMoistureLabel = $("#avgMoistureLabel");
	ui.maxMoistureLabel = $("#maxMoistureLabel");

	ui.minPlateMovementSpeedLabel = $("#minPlateMovementSpeedLabel");
	ui.avgPlateMovementSpeedLabel = $("#avgPlateMovementSpeedLabel");
	ui.maxPlateMovementSpeedLabel = $("#maxPlateMovementSpeedLabel");

	ui.minTileAreaLabel = $("#minTileAreaLabel");
	ui.avgTileAreaLabel = $("#avgTileAreaLabel");
	ui.maxTileAreaLabel = $("#maxTileAreaLabel");

	ui.minPlateAreaLabel = $("#minPlateAreaLabel");
	ui.avgPlateAreaLabel = $("#avgPlateAreaLabel");
	ui.maxPlateAreaLabel = $("#maxPlateAreaLabel");

	ui.minPlateCircumferenceLabel = $("#minPlateCircumferenceLabel");
	ui.avgPlateCircumferenceLabel = $("#avgPlateCircumferenceLabel");
	ui.maxPlateCircumferenceLabel = $("#maxPlateCircumferenceLabel");

	ui.generationSettingsPanel = $("#generationSettingsPanel");

	ui.detailLevelLabel = $("#detailLevelLabel");
	ui.detailLevelRange = $("#detailLevelRange");
	ui.distortionLevelLabel = $("#distortionLevelLabel");
	ui.distortionLevelRange = $("#distortionLevelRange");
	ui.tectonicPlateCountLabel = $("#tectonicPlateCountLabel");
	ui.tectonicPlateCountRange = $("#tectonicPlateCountRange");
	ui.oceanicRateLabel = $("#oceanicRateLabel");
	ui.oceanicRateRange = $("#oceanicRateRange");
	ui.heatLevelLabel = $("#heatLevelLabel");
	ui.heatLevelRange = $("#heatLevelRange");
	ui.moistureLevelLabel = $("#moistureLevelLabel");
	ui.moistureLevelRange = $("#moistureLevelRange");
	ui.seedTextBox = $("#seedTextBox");
	ui.seed2 = $("#seed2");
	ui.advancedGeneratePlanetButton = $("#advancedGeneratePlanetButton");
	ui.advancedCancelButton = $("#advancedCancelButton");

	ui.detailLevelRange.on("input", function () {
		setSubdivisions(parseInt(ui.detailLevelRange.val()));
	});
	ui.distortionLevelRange.on("input", function () {
		setDistortionLevel(parseInt(ui.distortionLevelRange.val()) / 100);
	});
	ui.tectonicPlateCountRange.on("input", function () {
		setPlateCount(Math.floor(Math.pow(2, parseInt(ui.tectonicPlateCountRange.val()) / 300 * (Math.log(1000) / Math.log(2) - 1) + 1)));
	});
	ui.oceanicRateRange.on("input", function () {
		setOceanicRate(parseInt(ui.oceanicRateRange.val()) / 100);
	});
	ui.heatLevelRange.on("input", function () {
		setHeatLevel(parseInt(ui.heatLevelRange.val()) / 100 + 1);
	});
	ui.moistureLevelRange.on("input", function () {
		setMoistureLevel(parseInt(ui.moistureLevelRange.val()) / 100 + 1);
	});
	ui.seedTextBox.on("input", function () {
		setSeed(ui.seedTextBox.val());
	});
	ui.advancedGeneratePlanetButton.click(function () {
		hideAdvancedSettings();
		generatePlanetAsynchronous();
	});
	ui.advancedCancelButton.click(hideAdvancedSettings);

	ui.updatePanel = $("#updatePanel");

	$("button").on("click", function (b) {
		$(this).blur();
	});
	$("button").on("focus", function () {
		disableKeys = true;
	});
	$("input").on("focus", function () {
		disableKeys = true;
	});
	$("button").on("blur", function () {
		disableKeys = false;
	});
	$("input").on("blur", function () {
		disableKeys = false;
	});

	hideAdvancedSettings();
	setPlateCount(50);

	setSurfaceRenderMode(surfaceRenderMode, true);
	showHideSunlight(renderSunlight);
	showHidePlateBoundaries(renderPlateBoundaries);
	showHidePlateMovements(renderPlateMovements);
	showHideAirCurrents(renderAirCurrents);
	//showHideEdgeCosts(renderEdgeCosts);
	showHideRivers(renderRivers);

	ui.lowDetailButton.click();

	//saveToFileSystem(serializePlanetMesh(planet.mesh, "function getPregeneratedPlanetMesh() { return ", "; }\n"));

	window.addEventListener("resize", resizeHandler);
	resizeHandler();
	showHideInterface();
    document.addEventListener('mousemove', (event) => {
        const rect = renderer.domElement.getBoundingClientRect();
        mouseX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouseY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    });

	ui.generatePlanetButton.click();
});

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

function generatePlanet(icosahedronSubdivision, topologyDistortionRate, plateCount, oceanicRate, heatLevel, moistureLevel, random, action) {
	console.log('🌍 Starting Planet Generation');
	console.time('Total Generation Time');
	var planet = new Planet();
	var mesh;
	
	action
		.executeSubaction(function (action) {
			console.time('1. Mesh Generation');
			generatePlanetMesh(icosahedronSubdivision, topologyDistortionRate, random, action);
		}, 6, "Generating Mesh")
		.getResult(function (result) {
			console.timeEnd('1. Mesh Generation');
			mesh = result;
			//console.log(mesh);
		})
		.executeSubaction(function (action) {
			console.time('2. Topology Generation');
			generatePlanetTopology(mesh, action);
		}, 1, "Generating Topology")
		.getResult(function (result) {
			console.timeEnd('2. Topology Generation');
			planet.topology = result;
			planet.topology.watersheds = [];
			//console.log(planet.topology);
		})
		.executeSubaction(function (action) {
			console.time('3. Spatial Partitions');
			generatePlanetPartition(planet.topology.tiles, action);
		}, 1, "Generating Spatial Partitions")
		.getResult(function (result) {
			console.timeEnd('3. Spatial Partitions');
			planet.partition = result;
		})
		.executeSubaction(function (action) {
			console.time('4. Terrain Generation');
			generatePlanetTerrain(planet, plateCount, oceanicRate, heatLevel, moistureLevel, random, action);
		}, 8, "Generating Terrain")
		.executeSubaction(function (action) {
			console.timeEnd('4. Terrain Generation');
			console.time('5. Render Data');
			generatePlanetRenderData(planet.topology, random, action);
		}, 1, "Building Visuals")
		.getResult(function (result) {
			console.timeEnd('5. Render Data');
			planet.renderData = result;
		})
		.executeSubaction(function (action) {
			console.time('6. Statistics');
			generatePlanetStatistics(planet.topology, planet.plates, action);
		}, 1, "Compiling Statistics")
		.getResult(function (result) {
			console.timeEnd('6. Statistics');
			planet.statistics = result;
			console.timeEnd('Total Generation Time');
			console.log('✅ Planet Generation Complete');
		})
		.provideResult(planet);
}

function generatePlanetTerrain(planet, plateCount, oceanicRate, heatLevel, moistureLevel, random, action) {
	
	action
		.executeSubaction(function (action) {
			console.time('4a. Tectonic Plates');
			generatePlanetTectonicPlates(planet.topology, plateCount, oceanicRate, random, action);
		}, 3, "Generating Tectonic Plates")
		.getResult(function (result) {
			console.timeEnd('4a. Tectonic Plates');
			planet.plates = result;
		})
		.executeSubaction(function (action) {
			console.time('4b. Base Elevation');
			generatePlanetElevation(planet.topology, planet.plates, action);
		}, 4, "Generating Elevation")
		.executeSubaction(function (action) {
			console.timeEnd('4b. Base Elevation');
			console.time('4c. Weather & Climate');
			generatePlanetWeather(planet.topology, planet.partition, heatLevel, moistureLevel, random, action);
		}, 16, "Generating Weather")
		.executeSubaction(function (action) {
			console.timeEnd('4c. Weather & Climate');
			console.time('4d. Erosion Process');
			erodeElevation(planet, action);
		}, 8, "Weathering Elevation")
		.executeSubaction(function (action) {
			console.timeEnd('4d. Erosion Process');
			console.time('4e. Tile Elevation Processing');
			tileElevationProcs(planet.topology.tiles, action);
		}, 2)
		.executeSubaction(function (action) {
			console.timeEnd('4e. Tile Elevation Processing');
			console.time('4f. Distance Calculations');
			setDistances(planet, action);
		}, 8, "Creating Distances")

		//erode
		.executeSubaction(function (action) {
			console.timeEnd('4f. Distance Calculations');
			console.time('4g. Biomes & Resources');
			generatePlanetBiomesResources(planet.topology.tiles, 1000, action);
		}, 1, "Generating Biomes")
		.getResult(function (result) {
			console.timeEnd('4g. Biomes & Resources');
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

function setDistances(planet, action) {
    planet.aStarVertices = [];
    for (let i = 0; i < planet.topology.tiles.length; i++) {
        planet.aStarVertices.push(planet.topology.tiles[i]);
    }
    var maxWind = Math.max(...planet.topology.corners.map(c => c.airCurrent.length()));
    planet.aStarEdges = [];
    for (let i = 0; i < planet.topology.borders.length; i++) {
        const edge = planet.topology.borders[i];
        const fromTile = edge.tiles[0];
        const toTile = edge.tiles[1];
        const deltaElevation = toTile.elevation - fromTile.elevation;
        const wind = edge.tiles.reduce((acc, tile) => {
            let tileAirCurrent = tile.corners.reduce((cornerAcc, corner) => {
                return cornerAcc.add(corner.airCurrent);
            }, new THREE.Vector3()).divideScalar(tile.corners.length);
            return acc.add(tileAirCurrent);
        }, new THREE.Vector3()).divideScalar(edge.tiles.length);
        
		let cost = 100;
		let reverseCost = 100;

		const isRiver = tile => tile.river === true;
		const isOcean = tile => tile.elevation < 0;
		const isLand = tile => tile.elevation >= 0 && !tile.river;

		const fromIsRiver = isRiver(fromTile);
		const toIsRiver = isRiver(toTile);
		const fromIsOcean = isOcean(fromTile);
		const toIsOcean = isOcean(toTile);
		const fromIsLand = isLand(fromTile);
		const toIsLand = isLand(toTile);
		
		if (fromIsRiver && toIsRiver) {
			// River to Ocean or Downriver: cost = 1
			if (fromTile.drain === toTile) {//if ((fromIsRiver && toIsOcean) || (fromIsRiver && toIsRiver && fromTile.downstream?.includes(toTile))) {
				cost = 1;
				reverseCost = 3;
			}
			// Ocean to River or Upriver: cost = 5
			else if (toTile.drain === fromTile) {//((fromIsOcean && toIsRiver) || (fromIsRiver && toIsRiver && toTile.downstream?.includes(fromTile))) {
				cost = 3;
				reverseCost = 1;
			}
			// River crossing: cost = 25
			const crossPoints = edge.corners.flatMap(corner => corner.tiles).filter(tile => !edge.tiles.includes(tile));
			if (crossPoints[0].elevation > 0 && !crossPoints[0].river && crossPoints[1].elevation > 0 && !crossPoints[1].river) {
				planet.aStarEdges.push({ from: crossPoints[0], to: crossPoints[1], cost: 25, reverseCost: 25 });
			}
		}
		else if (fromIsRiver && toIsOcean) {
			// River to Ocean or Downriver: cost = 1
			if (fromTile.drain === toTile) {//if ((fromIsRiver && toIsOcean) || (fromIsRiver && toIsRiver && fromTile.downstream?.includes(toTile))) {
				cost = 1;
				reverseCost = 3;
			}
		}
		else if (fromIsOcean && toIsRiver) {
			// Ocean to River or Upriver: cost = 5
			if (toTile.drain === fromTile) {//((fromIsOcean && toIsRiver) || (fromIsRiver && toIsRiver && toTile.downstream?.includes(fromTile))) {
				cost = 3;
				reverseCost = 1;
			}
		}
		// River-Land or Land-River: high penalty
		else if ((fromIsRiver && toIsLand) || (fromIsLand && toIsRiver)) {
			cost = reverseCost = 30;
		}
		else if (fromTile.elevation > 0 && toTile.elevation > 0) {
            if (deltaElevation <= 0) {
                cost = 5 + 1000 * Math.pow(deltaElevation, 2);
                reverseCost = 5 + 4000 * Math.pow(deltaElevation, 2);
            } else {
                cost = 5 + 4000 * Math.pow(deltaElevation, 2);
                reverseCost = 5 + 1000 * Math.pow(deltaElevation, 2);
            }
        } else if (fromIsOcean && toIsOcean) {
            const vector = toTile.position.clone().sub(fromTile.position);
            const normalizedWind = Math.pow(Math.min(1, Math.max(0, wind.length() / maxWind)), 1);
            const pos = sailSpeedFactor(pointofSailInDegrees(vector, wind.clone().negate()));
            cost = Math.min(5, Math.max(.5, 10 / (20 * normalizedWind * Math.max(.2,pos))));
            const vectorRev = fromTile.position.clone().sub(toTile.position);
            const posRev = sailSpeedFactor(pointofSailInDegrees(vector.clone().negate(), wind.clone().negate()));
            reverseCost = Math.min(5, Math.max(.5, 10 / (20 * normalizedWind * Math.max(.2,posRev))));
        } else {
            cost = reverseCost = 100;
        }
        planet.aStarEdges.push({ from: fromTile, to: toTile, cost: cost, reverseCost: reverseCost });
    }
    planet.graph = buildGraph(planet.aStarVertices, planet.aStarEdges);

}

function pointofSailInDegrees(v1, v2) {

    // Calculate the dot product of the vectors
    const dotProduct = v1.dot(v2);

    // Calculate the magnitudes of the vectors
    const magV1 = v1.length();
    const magV2 = v2.length();

    // Calculate the cosine of the angle
    const cosTheta = dotProduct / (magV1 * magV2);

    // Calculate the angle in radians
    const angleInRadians = Math.acos(cosTheta);

    // Convert the angle to degrees
    const angleInDegrees = angleInRadians * (180 / Math.PI);

    return angleInDegrees;
}

function sailSpeedFactor(t) {
	return Math.min(1,Math.max(0,-0.000000000226*Math.pow(t,5)+0.000000123805*Math.pow(t,4)-0.000024472499*Math.pow(t,3)+0.001992907194*Math.pow(t,2)-0.044968355344*t-0.151735480749));

}

function groupBodies(planet) {
	// Reset body assignments and body array
	for (const t of planet.topology.tiles) {
	  t.body = null;
	}
	planet.topology.bodies = [];
	
	// Pre-filter tiles into water and land
	const water = planet.topology.tiles.filter(t => t.elevation < 0);
	const land = planet.topology.tiles.filter(t => t.elevation >= 0);
	
	// Create sets for faster lookups
	const waterSet = new Set(water);
	const landSet = new Set(land);
	
	// Process water bodies first, then land bodies
	processBodyType(water, false, waterSet);
	processBodyType(land, true, landSet);
	
	function processBodyType(tiles, isLand, tileSet) {
	  let bodyTypeCount = 0;
	  
	  for (const tile of tiles) {
		if (tile.body) continue; // Skip tiles already assigned to a body
		
		bodyTypeCount++;
		const bodyId = isLand ? bodyTypeCount : -bodyTypeCount;
		const bodyIndex = planet.topology.bodies.length;
		
		// Create new body
		const newBody = { 
		  id: bodyId, 
		  tiles: [] 
		};
		planet.topology.bodies.push(newBody);
		
		// Use iterative approach instead of recursive
		const bodyTiles = findConnectedTiles(tile, isLand, tileSet);
		
		// Assign tiles to body
		for (const bodyTile of bodyTiles) {
		  bodyTile.body = newBody;
		  newBody.tiles.push(bodyTile);
		}
	  }
	}
	
	function findConnectedTiles(startTile, isLand, tileSet) {
	  const body = [startTile];
	  const queue = [startTile];
	  const visited = new Set([startTile]);
	  
	  while (queue.length > 0) {
		const current = queue.shift();
		const neighbors = current.tiles || [];
		
		for (const neighbor of neighbors) {
		  // Skip if already visited, already has a body, or wrong type (land/water)
		  if (visited.has(neighbor) || neighbor.body || !tileSet.has(neighbor)) {
			continue;
		  }
		  
		  visited.add(neighbor);
		  queue.push(neighbor);
		  body.push(neighbor);
		}
	  }
	  
	  return body;
	}
	
	// Process water bodies based on water-to-land ratio
	const waterToLandRatioThreshold = 1; // Water body size / bordering land tiles <= 1
	
	// For each water body
	const waterBodies = planet.topology.bodies.filter(body => body.id < 0);
	
	for (const waterBody of waterBodies) {
	  // Find all neighboring land tiles and their bodies
	  const neighboringLandTiles = new Set();
	  const neighboringLandBodies = new Set();
	  
	  // Check each water tile for land neighbors
	  for (const waterTile of waterBody.tiles) {
		const neighbors = waterTile.tiles || [];
		
		for (const neighbor of neighbors) {
		  // If neighbor is land and belongs to a land body
		  if (neighbor.elevation >= 0 && neighbor.body && neighbor.body.id > 0) {
			neighboringLandTiles.add(neighbor);
			neighboringLandBodies.add(neighbor.body);
		  }
		}
	  }
	  
	  // Calculate water-to-land ratio
	  const waterTileCount = waterBody.tiles.length;
	  const landTileCount = neighboringLandTiles.size;
	  const waterToLandRatio = waterTileCount / landTileCount;
	  
	  // Convert neighboring land bodies to array for easier processing
	  const landBodiesArray = Array.from(neighboringLandBodies);
	  
	  // If ratio is <= threshold and there's exactly one neighboring land body
	  if (waterToLandRatio <= waterToLandRatioThreshold && landBodiesArray.length === 1) {
		const landBody = landBodiesArray[0];
		
		// Find the lowest elevation among neighboring land tiles
		let lowestLandElevation = Infinity;
		for (const landTile of neighboringLandTiles) {
		  if (landTile.elevation < lowestLandElevation) {
			lowestLandElevation = landTile.elevation;
		  }
		}
		
		// Change elevation of water tiles and reassign to land body
		for (const waterTile of waterBody.tiles) {
		  // Set elevation based on the lowest land elevation + a small increment based on tile id
		  waterTile.elevation = lowestLandElevation + 0.0000001 * Math.abs(waterTile.id || 0);
		  
		  // Reassign to land body
		  waterTile.body = landBody;
		  landBody.tiles.push(waterTile);
		}
		
		// Mark this water body for removal
		waterBody.tiles = [];
	  }
	}
	
	// Remove empty water bodies
	planet.topology.bodies = planet.topology.bodies.filter(body => body.tiles.length > 0);
	
	for (b of planet.topology.bodies.filter(b => b.id > 0 && b.tiles.length > 20)) {
		b.features =[];
		let featureCount = 0;
		for (t of b.tiles) {
			t.s = t.shore;
		}
		let blanks = b.tiles.filter(t=>t.s > 0);
		for (let i = 0; i < 12; i++) { 
			if (blanks.length > 0) {
				blanks.sort((a, b) => b.shore - a.shore || b.elevation - a.elevation);
				featureCount++;
				b.features.push({id: 'b'+b.id+'f'+featureCount, tiles: [blanks[0]], color: undefined});

				let newFeature = b.features[featureCount-1];
				let hash = Math.random();
				if (hash < 0.5) {
					newFeature.color = new THREE.Color(0xFFFF00).lerp(new THREE.Color(0x009966), hash*2);
				} else {
					newFeature.color = new THREE.Color(0x009966).lerp(new THREE.Color(0x800080), (hash-0.5)*2);
				}
				
				blanks[0].s=0;
				blanks[0].feature = newFeature;

				let lastRing = newFeature.tiles;
				let nextRing = [...new Set(lastRing.map(nft => nft.tiles).flat().filter(nr => nr.s > 0))];
				while (nextRing.filter(t=>t.shore > 0).length/nextRing.length>0.95) {
					for (t of nextRing.filter(t=>t.s > 0)) {
						newFeature.tiles.push(t);
						t.s=0;
						t.feature = newFeature;
					}
					lastRing = nextRing;
					nextRing = [...new Set(lastRing.map(nft => nft.tiles).flat().filter(nr=>!newFeature.tiles.includes(nr)))];
					//console.log(nextRing.filter(t=>t.s > 0).length,nextRing.length);
				}

				blanks = b.tiles.filter(t=>t.s > 0);
			}
		}

	}
	
	console.log(planet.topology.bodies);



	return planet.topology.bodies;
}

function generatePlanetRenderData(topology, random, action) {
	var renderData = {};

	action
		.executeSubaction(function (action) {
			buildSurfaceRenderObject(topology.tiles, topology.watersheds, random, action);
		}, 8, "Building Surface Visuals")
		.getResult(function (result) {
			renderData.surface = result;
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
		});

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

function zoomHandler(event) {
	if (zoomAnimationStartTime === null) {
		zoomAnimationStartTime = Date.now();
		zoomAnimationStartValue = zoom;
		zoomAnimationEndValue = Math.max(0, Math.min(zoomAnimationStartValue - event.deltaY * 0.04, 1));
		zoomAnimationDuration = Math.abs(zoomAnimationStartValue - zoomAnimationEndValue) * 1000;
	} else {
		zoomAnimationStartTime = Date.now();
		zoomAnimationStartValue = zoom;
		zoomAnimationEndValue = Math.max(0, Math.min(zoomAnimationEndValue - event.deltaY * 0.04, 1));
		zoomAnimationDuration = Math.abs(zoomAnimationStartValue - zoomAnimationEndValue) * 1000;
	}
}

function clickHandler(event) {
	//console.log(event);
	if (planet) {
		var x = event.pageX / renderer.domElement.width * 2 - 1;
		var y = 1 - event.pageY / renderer.domElement.height * 2;
		var rayCaster = projector.pickingRay(new Vector3(x, y, 0), camera);
		var intersection = planet.partition.intersectRay(rayCaster.ray);
		if (intersection !== false) {
			console.log(intersection);
			selectTile(intersection); }
		else
			deselectTile();
	}
}

function keyDownHandler(event) {
	if (disableKeys === true) return;

	switch (event.which) {
		//case KEY.W:
		//case KEY.A:
		//case KEY.S:
		//case KEY.D:
		//case KEY.Z:
		//case KEY.Q:
		case KEY_LEFTARROW:
		case KEY_RIGHTARROW:
		case KEY_UPARROW:
		case KEY_DOWNARROW:
		case KEY_PAGEUP:
		case KEY_PAGEDOWN:
		case KEY_NUMPAD_PLUS:
		case KEY_NUMPAD_MINUS:
			pressedKeys[event.which] = true;
			event.preventDefault();
			break;
	}
}



function keyUpHandler(event) {
	if (disableKeys === true) return;

	switch (event.which) {
		case KEY.W:
			setSurfaceRenderMode("wheat");
			event.preventDefault();
			break;
		case KEY.C:
			setSurfaceRenderMode("corn");
			event.preventDefault();
			break;
		case KEY.F:
			setSurfaceRenderMode("fish");
			event.preventDefault();
			break;
		case KEY.A:
            setFromVertex(event);
            event.preventDefault();
            break;
		case KEY.X:
			setSurfaceRenderMode("shoreA");
			event.preventDefault();
			break;
		case KEY.B:
			setToVertex(event);
			event.preventDefault();
			break;
		case KEY.S:
			setSurfaceRenderMode("shore");
			event.preventDefault();
			break;
		case KEY.D:
			setSurfaceRenderMode("rice");
			event.preventDefault();
			break;
		case KEY.Z:
			setSurfaceRenderMode("shoreZ");
			event.preventDefault();
			break;
		case KEY.Q:
			setSurfaceRenderMode("port");
			event.preventDefault();
			break;
		case KEY_LEFTARROW:
		case KEY_RIGHTARROW:
		case KEY_UPARROW:
		case KEY_DOWNARROW:
		case KEY_PAGEUP:
		case KEY_PAGEDOWN:
		case KEY_NUMPAD_PLUS:
		case KEY_NUMPAD_MINUS:
			pressedKeys[event.which] = false;
			event.preventDefault();
			break;
		case KEY_ESCAPE:
			if (activeAction !== null) {
				ui.progressCancelButton.click();
				event.preventDefault();
			}
			break;
		case KEY_FORWARD_SLASH:
		case KEY["0"]:
			showHideInterface();
			event.preventDefault();
			break;
		case KEY_SPACE:
			generatePlanetAsynchronous();
			event.preventDefault();
			break;
		case KEY["1"]:
			setSubdivisions(20);
			generatePlanetAsynchronous();
			event.preventDefault();
			break;
		case KEY["2"]:
			setSubdivisions(40);
			generatePlanetAsynchronous();
			event.preventDefault();
			break;
		case KEY["3"]:
			setSubdivisions(60);
			setSeed(largeSeed);
			generatePlanetAsynchronous();
			event.preventDefault();
			break;
		case KEY["5"]:
			setSurfaceRenderMode("terrain");
			event.preventDefault();
			break;
		case KEY["6"]:
			setSurfaceRenderMode("plates");
			event.preventDefault();
			break;
		case KEY["7"]:
			setSurfaceRenderMode("elevation");
			event.preventDefault();
			break;
		case KEY["8"]:
			setSurfaceRenderMode("temperature");
			event.preventDefault();
			break;
		case KEY["9"]:
			setSurfaceRenderMode("moisture"); //moisture
			event.preventDefault();
			break;
		case KEY.K:
			setSurfaceRenderMode("calorie");
			event.preventDefault();
			break;
		case KEY.U:
			showHideSunlight();
			event.preventDefault();
			break;
		case KEY.I:
			showHidePlateBoundaries();
			event.preventDefault();
			break;
		case KEY.O:
			showHidePlateMovements();
			event.preventDefault();
			break;
		case KEY.P:
			showHideAirCurrents();
			event.preventDefault();
			break;
		case KEY.R:
			showHideRivers();
			event.preventDefault();
			break;
        case KEY.J:
            showHideEdgeCosts();
            event.preventDefault();
            break;
	}
}

function cancelButtonHandler() {
	if (activeAction !== null) {
		activeAction.cancel();
	}
}

function displayPlanet(newPlanet) {
    if (planet) {
        tileSelection = null;
        scene.remove(planet.renderData.surface.renderObject);
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

function showHideInterface() {
	ui.helpPanel.toggle();
	ui.controlPanel.toggle();
	ui.dataPanel.toggle();
	ui.updatePanel.toggle();
}

function renderPath(path) {
    // Remove any existing path render object
    if (planet.pathRenderObject) {
        for (let i = planet.pathRenderObject.length - 1; i >= 0; i--) {
            scene.remove(planet.pathRenderObject[i]);
        }
    }
    planet.pathRenderObject = [];
    if (!fromVertex || !toVertex || !path) {
        return;
    }
    for (let i = 0; i < path.length - 1; i++) {
        const fromTile = path[i];
        const toTile = path[i + 1];
        const direction = toTile.position.clone().sub(fromTile.position);
        const arrow = new THREE.ArrowHelper(
			direction.clone().normalize(),
			fromTile.position.clone().multiplyScalar(1.0006), // closer to surface
			direction.length(),
			0xff0000
		);
        scene.add(arrow);
        planet.pathRenderObject.push(arrow);
    }
}

function setFromVertex(event) {
    if (planet) {
        var rayCaster = projector.pickingRay(new Vector3(mouseX, mouseY, 0), camera);
        var intersection = planet.partition.intersectRay(rayCaster.ray);
        if (intersection !== false) {
            fromVertex = intersection;
        } else {
            fromVertex = null;
        }
        if (fromVertex && toVertex) {
            path = aStarPathfinding(fromVertex, toVertex, planet);
            if (path) {
                renderPath(path);
            } else {
                console.log('No path found');
                renderPath([]);
            }
        }
    }
}

function setToVertex(event) {
    if (planet) {
        var rayCaster = projector.pickingRay(new Vector3(mouseX, mouseY, 0), camera);
        var intersection = planet.partition.intersectRay(rayCaster.ray);
        if (intersection !== false) {
            toVertex = intersection;
        } else {
            toVertex = null;
        }
        if (fromVertex && toVertex) {
			
            path = aStarPathfinding(fromVertex, toVertex, planet);
            if (path) {
                renderPath(path);
            } else {
                console.log('No path found');
                renderPath([]);
            }
        }
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

////////////////////////////////////////////////////////////////////////////////
// UTILITIES                                                                  //
////////////////////////////////////////////////////////////////////////////////



function aStarPathfinding(startTile, goalTile, planet) {
    console.time("aStarPathfinding");

    const pathFinder = ngraphPath.aStar(planet.graph, {
        oriented: true,
        distance(fromNode, toNode, link) {
            return link.data.weight;
        }
    });

    const foundPath = pathFinder.find(goalTile.id, startTile.id);
    const path = foundPath.map(node => planet.topology.tiles.find(tile => tile.id === node.id));

    let totalCost = 0;
    for (let i = 0; i < foundPath.length - 1; i++) {
        const fromId = foundPath[i].id;
        const toId = foundPath[i + 1].id;
        const links = [...planet.graph.getLinks(fromId)];
        const link = links.find(l => l.toId === toId);
        if (link) {
			console.log(link.data.weight);
            totalCost += link.data.weight;
        }
    }

    console.log("Actual Path Cost (graph weights):", totalCost);
    console.timeEnd("aStarPathfinding");

    return path;
}


/*     let totalCost = 0;
    for (let i = 0; i < path.length - 1; i++) {
        const fromTile = path[i];
        const toTile = path[i + 1];
        totalCost += sphericalDistance(fromTile.position, toTile.position);
    }
    console.log("Total Path Cost:", totalCost);
    console.timeEnd("aStarPathfinding"); */