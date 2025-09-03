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

function setSubdivisions(subdivisions) {
	if (typeof (subdivisions) === "number" && subdivisions >= 4) {
		generationSettings.subdivisions = subdivisions;
		$("#detailDisplaylist>button.toggled").removeClass("toggled");
		if (subdivisions === 20) ui.lowDetailButton.addClass("toggled");
		else if (subdivisions === 40) ui.mediumDetailButton.addClass("toggled");
		else if (subdivisions === 60) ui.highDetailButton.addClass("toggled");

		subdivisions = subdivisions.toFixed(0);
		if (ui.detailLevelRange.val() !== subdivisions) ui.detailLevelRange.val(subdivisions);
		ui.detailLevelLabel.text("Detail Level (" + subdivisions + ")");
	}
}

function setDistortionLevel(distortionLevel) {
	if (typeof (distortionLevel) === "number" && distortionLevel >= 0 && distortionLevel <= 1) {
		generationSettings.distortionLevel = distortionLevel;

		distortionLevel = Math.floor(distortionLevel * 100 + 0.5).toFixed(0);

		if (ui.distortionLevelRange.val() !== distortionLevel) ui.distortionLevelRange.val(distortionLevel);
		ui.distortionLevelLabel.text("Distortion Level (" + distortionLevel + "%)");
	}
}

function setPlateCount(plateCount) {
	if (typeof (plateCount) === "number" && plateCount >= 0) {
		generationSettings.plateCount = plateCount;

		var sliderVal = Math.ceil((Math.log(plateCount) / Math.log(2) - 1) / (Math.log(1000) / Math.log(2) - 1) * 300).toFixed(0);
		if (ui.tectonicPlateCountRange.val() !== sliderVal) ui.tectonicPlateCountRange.val(sliderVal);
		ui.tectonicPlateCountLabel.text(plateCount.toFixed(0));
	}
}

function setOceanicRate(oceanicRate) {
	if (typeof (oceanicRate) === "number" && oceanicRate >= 0 && oceanicRate <= 1) {
		generationSettings.oceanicRate = oceanicRate;

		oceanicRate = Math.floor(oceanicRate * 100 + 0.5).toFixed(0);

		if (ui.oceanicRateRange.val() !== oceanicRate) ui.oceanicRateRange.val(oceanicRate);
		ui.oceanicRateLabel.text(oceanicRate);
	}
}

function setHeatLevel(heatLevel) {
	if (typeof (heatLevel) === "number" && heatLevel >= 0) {
		generationSettings.heatLevel = heatLevel;

		heatLevel = Math.floor(heatLevel * 100 - 100).toFixed(0);

		if (ui.heatLevelRange.val() !== heatLevel) ui.heatLevelRange.val(heatLevel);
		if (generationSettings.heatLevel > 1) heatLevel = "+" + heatLevel;
		else if (generationSettings.heatLevel < 1) heatLevel = "-" + heatLevel;
		ui.heatLevelLabel.text(heatLevel);
	}
}

function setMoistureLevel(moistureLevel) {
	if (typeof (moistureLevel) === "number" && moistureLevel >= 0) {
		generationSettings.moistureLevel = moistureLevel;

		moistureLevel = Math.floor(moistureLevel * 100 - 100).toFixed(0);

		if (ui.moistureLevelRange.val() !== moistureLevel) ui.moistureLevelRange.val(moistureLevel);
		if (generationSettings.moistureLevel > 1) moistureLevel = "+" + moistureLevel;
		else if (generationSettings.moistureLevel < 1) moistureLevel = "-" + moistureLevel;
		ui.moistureLevelLabel.text(moistureLevel);
	}
}

function setSeed(seed) {
	if (!seed && loadSeed) generationSettings.seed = loadSeed;
	if (typeof (seed) === "number") {
		generationSettings.seed = Math.floor(seed);
		ui.seedTextBox.val(generationSettings.seed.toFixed(0));
	} else if (typeof (seed) === "string") {
		var asInt = parseInt(seed);
		if (isNaN(asInt) || asInt.toFixed(0) !== seed) {
			generationSettings.seed = seed;
		} else {
			generationSettings.seed = asInt;
			ui.seedTextBox.val(generationSettings.seed.toFixed(0));
		}
	} else {
		generationSettings.seed = null;
		ui.seedTextBox.val("");
	}
	ui.seed2.val("seeeeeed");
}

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

function showAdvancedSettings() {
	ui.generationSettingsPanel.show();
}

function hideAdvancedSettings() {
	ui.generationSettingsPanel.hide();
}

function Planet() { }

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

function generatePlanetTectonicPlates(topology, plateCount, oceanicRate, random, action) {
	var plates = [];
	var platelessTiles = [];
	var platelessTilePlates = [];
	action.executeSubaction(function (action) {
		var failedCount = 0;
		while (plates.length < plateCount && failedCount < 10000) {
			var corner = topology.corners[random.integerExclusive(0, topology.corners.length)];
			var adjacentToExistingPlate = false;
			for (var i = 0; i < corner.tiles.length; ++i) {
				if (corner.tiles[i].plate) {
					adjacentToExistingPlate = true;
					failedCount += 1;
					break;
				}
			}
			if (adjacentToExistingPlate) continue;

			failedCount = 0;

			var oceanic = (random.unit() < oceanicRate);
			var plate = new Plate(
				new THREE.Color(random.integer(0, 0xFFFFFF)),
				randomUnitVector(random),
				random.realInclusive(-Math.PI / 30, Math.PI / 30),
				random.realInclusive(-Math.PI / 30, Math.PI / 30),
				oceanic ? random.realInclusive(-0.8, -0.3) : random.realInclusive(0.1, 0.5),
				oceanic,
				corner);

			plates.push(plate);

			for (var i = 0; i < corner.tiles.length; ++i) {
				corner.tiles[i].plate = plate;
				plate.tiles.push(corner.tiles[i]);
			}

			for (var i = 0; i < corner.tiles.length; ++i) {
				var tile = corner.tiles[i];
				for (var j = 0; j < tile.tiles.length; ++j) {
					var adjacentTile = tile.tiles[j];
					if (!adjacentTile.plate) {
						platelessTiles.push(adjacentTile);
						platelessTilePlates.push(plate);
					}
				}
			}
		}
	});

	action.executeSubaction(function (action) {
		while (platelessTiles.length > 0) {
			var tileIndex = Math.floor(Math.pow(random.unit(), 2) * platelessTiles.length);
			var tile = platelessTiles[tileIndex];
			var plate = platelessTilePlates[tileIndex];
			platelessTiles.splice(tileIndex, 1);
			platelessTilePlates.splice(tileIndex, 1);
			if (!tile.plate) {
				tile.plate = plate;
				plate.tiles.push(tile);
				for (var j = 0; j < tile.tiles.length; ++j) {
					if (!tile.tiles[j].plate) {
						platelessTiles.push(tile.tiles[j]);
						platelessTilePlates.push(plate);
					}
				}
			}
		}
	});

	action.executeSubaction(calculateCornerDistancesToPlateRoot.bind(null, plates));

	action.provideResult(plates);
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

function erodeElevation(planet, action) {
	let tiles = planet.topology.tiles
	let watersheds = planet.topology.watersheds

	console.time("groupBodies");
	groupBodies(planet);
	console.timeEnd("groupBodies");

	console.time("randomLocalMax");
	randomLocalMax();
	//randomLocalMax();
	console.timeEnd("randomLocalMax");
	
	tiles.sort((a, b) => parseFloat(a.elevation) - parseFloat(b.elevation));

	console.time("newerDrain");
	newerDrain();
	console.timeEnd("newerDrain");

	console.time("reMoisture");
	reMoisture()
	console.timeEnd("reMoisture");
	
	//console.log(planet)

	function randomLocalMax() {
		tiles.sort((a, b) => parseFloat(a.elevation) - parseFloat(b.elevation));
		for (let i = 0; i < tiles.length; i++) {
			tiles[i].tiles.sort((a, b) => parseFloat(a.elevation) - parseFloat(b.elevation));
		}
		for (let i = tiles.length - 1; i >= 0; i--) {
			if (tiles[i].elevation > 0) {
				if (tiles[i].elevation > tiles[i].tiles[0].elevation) { //if not local min
					if (tiles[i].elevation < tiles[i].tiles[tiles[i].tiles.length - 1].elevation) { //if not local max
						//console.log('try')
						if (tiles[i].id / Math.PI % 1 > 0.85) {
							//console.log('success')
							tiles[i].elevation = tiles[i].tiles[tiles[i].tiles.length - 1].elevation * 1.05 //make local max
							//tiles[i].error = 'forcedmax'
						}
					}
				}
			}
		}
		tiles.sort((a, b) => parseFloat(a.elevation) - parseFloat(b.elevation));
		for (let i = 0; i < tiles.length; i++) {
			tiles[i].tiles.sort((a, b) => parseFloat(a.elevation) - parseFloat(b.elevation));
		}
	}
	function calculateUpstreamDownstream(tiles) {
		//console.log('calculateUpstreamDownstream')
		// Initialize upstream and downstream arrays for each tile
		tiles.forEach(tile => {
			if (tile.elevation > 0) {
				tile.upstream = [];
				tile.downstream = [];
			}
		});
	
		// Calculate upstream and downstream arrays
		tiles.forEach(tile => {
			if (tile.elevation > 0 && tile.drain) {
				// Add current tile to the downstream array of the tile it drains into
				if (tile.drain.elevation > 0) {
					//tile.drain.downstream.push(tile);
					tile.downstream.push(tile.drain);
				}
				if (tile === tile.drain.drain) {
					tile.error = 'self drain';
				}
	
				// Add all upstream tiles to the current tile's upstream array
				let current = tile;
				while (current.drain && current.drain.elevation > 0) {
					if (current.drain.upstream.length > current.body.tiles.length) {
						current.error='.drain.upstream.length > body';
						break;
					}
					if (current.drain.drain === current) {
						current.error='drain loop';
						break;
					}
					if (!current.drain.upstream.includes(tile)) {
						current.drain.upstream.push(tile);
					}
					current = current.drain;
				}
			}
		});
	
		// Recursively add downstream tiles to the downstream array
		function addDownstreamTiles(tile, downstreamTiles) {
			tile.downstream.forEach(downstreamTile => {
				if (!downstreamTiles.includes(downstreamTile)) {
					downstreamTiles.push(downstreamTile);
					addDownstreamTiles(downstreamTile, downstreamTiles);
				}
			});
		}
	
		// Populate downstream arrays with all downstream tiles
		tiles.forEach(tile => {
			if (tile.elevation > 0) {
				let downstreamTiles = [];
				addDownstreamTiles(tile, downstreamTiles);
				tile.downstream = downstreamTiles;
			}
		});
	}
	function newerDrain() {
		const runoffFraction = 0.1;
		const minRiver = 0.5*Math.max(...tiles.map(t => t.rain));
		const evapRatio = 0.25;
		let lakeCounter = 0;
		let lakes = [];
		let land = tiles.filter(t=>t.elevation>0);
		for (t of land) {
			t.tiles.sort((a, b) => parseFloat(a.elevation) - parseFloat(b.elevation));
			t.sources = [];
			t.drain = undefined;
			if (t.elevation > 0 && t.elevation > t.tiles[0].elevation) {
				t.drain = t.tiles[0]
			}
			t.log = '';
			t.lake = undefined;
			t.coast = undefined;
			t.dirty = true;
			t.inflow = 0;
			t.outflow = 0;
			t.upstream = [];
			t.downstream = [];
		}
		calculateUpstreamDownstream(land);

		for (let i = 1; i <= 3; i++) {
			console.time("bowlLoop");

			let bowls = land.filter(t => t.downstream.length < 1 && !t.drain);
			bowls.sort((a, b) => parseFloat(b.elevation) - parseFloat(a.elevation));
			for (b of bowls) {
				let bowl = [];
				let bowlRim = [];
				let bowlRimOuter = [];
				let bowlRimEscapeOptions = [];
				let bowlEscapeRoute = undefined;
				if (b.upstream[0]) {
					bowl = [b,...b.upstream].sort((a, b) => parseFloat(a.elevation) - parseFloat(b.elevation));
					//console.log(bowl);
					bowlRim = bowl.filter(u => u.tiles.filter(n => !bowl.includes(n)).length > 0);
					//console.log(bowlRim);
					bowlRimOuter = [...new Set(bowlRim.map(br => br.tiles).flat().filter(bro=>!bowl.includes(bro)))];
					//console.log(bowlRimOuter);
					for (t of bowlRim) {
						for (o of bowlRimOuter.filter(o=>t.tiles.includes(o))) {
							bowlRimEscapeOptions.push({maxElevation: Math.max(t.elevation, o.elevation), routeA: t, routeB: o});
						}
					}
					bowlEscapeRoute = bowlRimEscapeOptions.sort((a, b) => a.maxElevation - b.maxElevation)[0];
					//console.log(bowlEscapeRoute);
					bowlRimLow = bowlRim.sort((a, b) => parseFloat(a.elevation) - parseFloat(b.elevation))[0];
					//bowlRimLow.error='rim';
					let bowlLake = bowl.filter(u => u.elevation <= bowlEscapeRoute.maxElevation);
					lakeCounter++;
					let newLake = lakes[lakes.push({id: lakeCounter, log: '', tiles: [...bowlLake], shore:[], sources:[], outflow:0, drain:undefined})-1];
					//console.log(newLake);
					lakeCleanup(newLake);
					bowlFill(newLake,bowlEscapeRoute);
				} else {
					b.elevation = (b.tiles[0].elevation+b.tiles[1].elevation)/2+0.000001*b.id;
				}
			}		
			if (i===3) {
				console.time("randomLocalMax");
				randomLocalMax();
				console.timeEnd("randomLocalMax");
			}
			calculateUpstreamDownstream(land);
			land.sort((a, b) => a.upstream.length - b.upstream.length);
			for (t of land) {
				t.sources = t.tiles.filter(n => n.drain === t);
				t.inflow = t.sources.reduce((sum, n) => sum + (n.outflow || 0), 0);
				t.outflow = t.rain*runoffFraction + t.inflow;
			}

			console.timeEnd("bowlLoop");
		}

		watershedBuilder();

		function lakeCleanup(lake) {
			var tempNeighbors = [];
			for (t of lake.tiles) {
				t.lake = lake;
				tempNeighbors.push(...t.tiles);
			}
			lake.shore = tempNeighbors.filter(n => !lake.tiles.includes(n));
			lake.sources = lake.shore.filter(s => lake.tiles.includes(s.drain));
		}
		function bowlFill(lake,bowlEscapeRoute) {
			if (!lake.tiles.includes(bowlEscapeRoute.routeA)) {
				console.log('routeA not in lake', lake, bowlEscapeRoute);
				bowlEscapeRoute.routeA.error = 'routeA not in lake';
				return;
			}
			if (!lake.shore.includes(bowlEscapeRoute.routeB)) {
				throw('routeB not in shore', lake, bowlEscapeRoute.routeB);
			}

			const minE = bowlEscapeRoute.maxElevation;
			let backStop = lake.tiles.filter(t=>t.elevation>bowlEscapeRoute.maxElevation)[0];
			const maxE = minE+0.00001
			if (backStop) {
				const maxE = backStop.elevation;
			}

			let order = findMouthOrder(lake,bowlEscapeRoute.routeA);
			const step = (maxE-minE)/(lake.tiles.length+1);
			let j = 1;
			//console.log('step',step);
			for (o of order) {
				for (t of o) {
					t.sediment = 0;
					var eOld = t.elevation;
					t.elevation = minE+(step*(j+.0000000001*t.id));
					if (t.tiles.some(a => a.elevation === t.elevation)) {
						t.error = 'same elevation as neighbor, had to bump';
						t.elevation = t.elevation+.00000001*t.id;
					}
					t.sediment += t.elevation - eOld;
					j++;
					//console.log(t.elevation,t.tiles.map(n => n.elevation))
				}
			}
			let reDrain = [...new Set([...lake.tiles,...lake.shore])];
			for (t of reDrain) {
				t.tiles.sort((a, b) => a.elevation - b.elevation);
				t.drain = t.tiles.filter(n => n.elevation < t.elevation)[0];
				t.lake = undefined;
			}
			lake.tiles=[];

			function findMouthOrder(lake,mouth) {
				var finished = [mouth];
				var order = [[mouth]];
				while (lake.tiles.filter(t => !finished.includes(t)).length>0) {
					const next = lake.tiles.filter(t => !finished.includes(t) && t.tiles.some(n => finished.includes(n)));
					order.push(next);
					finished.push(...next);
				}
				return order;
			}

		}
		function watershedBuilder() {
			watersheds = [];
			let watershedCount = 0;
			for (w of land.filter(t=> t.downstream.length < 1)) {
				watershedCount++;
				let ws = [w,...w.upstream];
				let i = watersheds.push({id: watershedCount, tiles: ws, color: undefined});
				for (t of ws) {
					t.watershed = watersheds[i-1];
				}
			}
			assignWatershedColors(watersheds, 6);
			
			if (watersheds.some(w=>!w.color)) {
				console.log(watersheds.filter(w=>!w.color));
			}

			for (w of watersheds.filter(w=>!w.color)) {
				w.color = new THREE.Color(0x000000);
			}
			function assignWatershedColors(watersheds, N) {
				var colors = [];
				//for (var i = 0; i < N; i++) {colors.push(new THREE.Color().setHSL((i) / (1.5*N), 1, 0.5));}
				//colors = [new THREE.Color(0xB2E59A), new THREE.Color(0xD7E98C), new THREE.Color(0xA3C282), new THREE.Color(0x8DB464), new THREE.Color(0x6F9B4B), new THREE.Color(0x51783D)];
				colors = [new THREE.Color(0xE2E8C6), new THREE.Color(0xB7C779), new THREE.Color(0x7D8A42), new THREE.Color(0xA67B5B), new THREE.Color(0x6F5A4D), new THREE.Color(0x4D3B2E)];

				var assignedColors = {};
				
				// Sort watersheds by the number of distinct neighboring watersheds in descending order
				watersheds.sort((a, b) => {
					var aNeighbors = [...new Set(a.tiles.map(t => t.tiles).flat().filter(n => !a.tiles.includes(n) && n.watershed && n.watershed !== a).map(n => n.watershed.id))].length;
					var bNeighbors = [...new Set(b.tiles.map(t => t.tiles).flat().filter(n => !b.tiles.includes(n) && n.watershed && n.watershed !== b).map(n => n.watershed.id))].length;
					return bNeighbors - aNeighbors;
				});
			
				for (var i = 0; i < watersheds.length; i++) {
					var watershed = watersheds[i];
					var watershedNeighbors = [...new Set(watershed.tiles.map(t => t.tiles).flat().filter(n => !watershed.tiles.includes(n) && n.watershed && n.watershed !== watershed))];
					var availableColors = colors.slice();
					for (var neighbor of watershedNeighbors) {
						if (neighbor.watershed && assignedColors[neighbor.watershed.id]) {
							var index = availableColors.indexOf(assignedColors[neighbor.watershed.id]);
							if (index !== -1) {
								availableColors.splice(index, 1);
							}
						}
					}
					watershed.color = availableColors[0];
					assignedColors[watershed.id] = watershed.color;
				}
			}
		}
	}
	function reMoisture() {
		var maxRain = Math.max(...tiles.map(element => element.rain));
		
		var shareFraction = 0.4;
		var shareIteration = 4;

		land = tiles.filter(t=>t.elevation>0);
		land.sort((a, b) => a.upstream.length - b.upstream.length);
		for (t of land) {
			t.moisture = Math.min(t.rain + 0.1 * t.inflow, maxRain * 1.2);
		};
		for (let i = 0; i < shareIteration; i++) {
			for (t of land) {
				t.moisture = Math.max(t.moisture,shareFraction*Math.max(...t.tiles.map(n => n.moisture)));
			}
		};
	}
}

function generatePlanetElevation(topology, plates, action) {
	var boundaryCorners;
	var boundaryCornerInnerBorderIndexes;
	var elevationBorderQueue;
	var elevationBorderQueueSorter = function (left, right) {
		return left.distanceToPlateBoundary - right.distanceToPlateBoundary;
	};

	action
		.executeSubaction(function (action) {
			identifyBoundaryBorders(topology.borders, action);
		}, 1)
		.executeSubaction(function (action) {
			collectBoundaryCorners(topology.corners, action);
		}, 1)
		.getResult(function (result) {
			boundaryCorners = result;
		})
		.executeSubaction(function (action) {
			calculatePlateBoundaryStress(boundaryCorners, action);
		}, 2)
		.getResult(function (result) {
			boundaryCornerInnerBorderIndexes = result;
		})
		.executeSubaction(function (action) {
			blurPlateBoundaryStress(boundaryCorners, 3, 0.4, action);
		}, 2)
		.executeSubaction(function (action) {
			populateElevationBorderQueue(boundaryCorners, boundaryCornerInnerBorderIndexes, action);
		}, 2)
		.getResult(function (result) {
			elevationBorderQueue = result;
		})
		.executeSubaction(function (action) {
			processElevationBorderQueue(elevationBorderQueue, elevationBorderQueueSorter, action);
		}, 10)
		.executeSubaction(function (action) {
			calculateTileAverageElevations(topology.tiles, action);
		}, 2);
}

function identifyBoundaryBorders(borders, action) {
	for (var i = 0; i < borders.length; ++i) {
		var border = borders[i];
		if (border.tiles[0].plate !== border.tiles[1].plate) {
			border.betweenPlates = true;
			border.corners[0].betweenPlates = true;
			border.corners[1].betweenPlates = true;
			border.tiles[0].plate.boundaryBorders.push(border);
			border.tiles[1].plate.boundaryBorders.push(border);
		}
	}
}

function collectBoundaryCorners(corners, action) {
	var boundaryCorners = [];
	for (var j = 0; j < corners.length; ++j) {
		var corner = corners[j];
		if (corner.betweenPlates) {
			boundaryCorners.push(corner);
			corner.tiles[0].plate.boundaryCorners.push(corner);
			if (corner.tiles[1].plate !== corner.tiles[0].plate) corner.tiles[1].plate.boundaryCorners.push(corner);
			if (corner.tiles[2].plate !== corner.tiles[0].plate && corner.tiles[2].plate !== corner.tiles[1].plate) corner.tiles[2].plate.boundaryCorners.push(corner);
		}
	}

	action.provideResult(boundaryCorners);
}

function calculatePlateBoundaryStress(boundaryCorners, action) {
	var boundaryCornerInnerBorderIndexes = new Array(boundaryCorners.length);
	for (var i = 0; i < boundaryCorners.length; ++i) {
		var corner = boundaryCorners[i];
		corner.distanceToPlateBoundary = 0;

		var innerBorder;
		var innerBorderIndex;
		for (var j = 0; j < corner.borders.length; ++j) {
			var border = corner.borders[j];
			if (!border.betweenPlates) {
				innerBorder = border;
				innerBorderIndex = j;
				break;
			}
		}

		if (innerBorder) {
			boundaryCornerInnerBorderIndexes[i] = innerBorderIndex;
			var outerBorder0 = corner.borders[(innerBorderIndex + 1) % corner.borders.length];
			var outerBorder1 = corner.borders[(innerBorderIndex + 2) % corner.borders.length]
			var farCorner0 = outerBorder0.oppositeCorner(corner);
			var farCorner1 = outerBorder1.oppositeCorner(corner);
			var plate0 = innerBorder.tiles[0].plate;
			var plate1 = outerBorder0.tiles[0].plate !== plate0 ? outerBorder0.tiles[0].plate : outerBorder0.tiles[1].plate;
			var boundaryVector = farCorner0.vectorTo(farCorner1);
			var boundaryNormal = boundaryVector.clone().cross(corner.position);
			var stress = calculateStress(plate0.calculateMovement(corner.position), plate1.calculateMovement(corner.position), boundaryVector, boundaryNormal);
			corner.pressure = stress.pressure;
			corner.shear = stress.shear;
		} else {
			boundaryCornerInnerBorderIndexes[i] = null;
			var plate0 = corner.tiles[0].plate;
			var plate1 = corner.tiles[1].plate;
			var plate2 = corner.tiles[2].plate;
			var boundaryVector0 = corner.corners[0].vectorTo(corner);
			var boundaryVector1 = corner.corners[1].vectorTo(corner);
			var boundaryVector2 = corner.corners[2].vectorTo(corner);
			var boundaryNormal0 = boundaryVector0.clone().cross(corner.position);
			var boundaryNormal1 = boundaryVector1.clone().cross(corner.position);
			var boundaryNormal2 = boundaryVector2.clone().cross(corner.position);
			var stress0 = calculateStress(plate0.calculateMovement(corner.position), plate1.calculateMovement(corner.position), boundaryVector0, boundaryNormal0);
			var stress1 = calculateStress(plate1.calculateMovement(corner.position), plate2.calculateMovement(corner.position), boundaryVector1, boundaryNormal1);
			var stress2 = calculateStress(plate2.calculateMovement(corner.position), plate0.calculateMovement(corner.position), boundaryVector2, boundaryNormal2);

			corner.pressure = (stress0.pressure + stress1.pressure + stress2.pressure) / 3;
			corner.shear = (stress0.shear + stress1.shear + stress2.shear) / 3;
		}
	}

	action.provideResult(boundaryCornerInnerBorderIndexes);
}

function calculateStress(movement0, movement1, boundaryVector, boundaryNormal) {
	var relativeMovement = movement0.clone().sub(movement1);
	var pressureVector = relativeMovement.clone().projectOnVector(boundaryNormal);
	var pressure = pressureVector.length();
	if (pressureVector.dot(boundaryNormal) > 0) pressure = -pressure;
	var shear = relativeMovement.clone().projectOnVector(boundaryVector).length();
	return {
		pressure: 2 / (1 + Math.exp(-pressure / 30)) - 1,
		shear: 2 / (1 + Math.exp(-shear / 30)) - 1
	};
}

function blurPlateBoundaryStress(boundaryCorners, stressBlurIterations, stressBlurCenterWeighting, action) {
	var newCornerPressure = new Array(boundaryCorners.length);
	var newCornerShear = new Array(boundaryCorners.length);
	for (var i = 0; i < stressBlurIterations; ++i) {
		for (var j = 0; j < boundaryCorners.length; ++j) {
			var corner = boundaryCorners[j];
			var averagePressure = 0;
			var averageShear = 0;
			var neighborCount = 0;
			for (var k = 0; k < corner.corners.length; ++k) {
				var neighbor = corner.corners[k];
				if (neighbor.betweenPlates) {
					averagePressure += neighbor.pressure;
					averageShear += neighbor.shear;
					++neighborCount;
				}
			}
			newCornerPressure[j] = corner.pressure * stressBlurCenterWeighting + (averagePressure / neighborCount) * (1 - stressBlurCenterWeighting);
			newCornerShear[j] = corner.shear * stressBlurCenterWeighting + (averageShear / neighborCount) * (1 - stressBlurCenterWeighting);
		}

		for (var j = 0; j < boundaryCorners.length; ++j) {
			var corner = boundaryCorners[j];
			if (corner.betweenPlates) {
				corner.pressure = newCornerPressure[j];
				corner.shear = newCornerShear[j];
			}
		}
	}
}

function populateElevationBorderQueue(boundaryCorners, boundaryCornerInnerBorderIndexes, action) {
	var elevationBorderQueue = [];
	for (var i = 0; i < boundaryCorners.length; ++i) {
		var corner = boundaryCorners[i];

		var innerBorderIndex = boundaryCornerInnerBorderIndexes[i];
		if (innerBorderIndex !== null) {
			var innerBorder = corner.borders[innerBorderIndex];
			var outerBorder0 = corner.borders[(innerBorderIndex + 1) % corner.borders.length];
			var plate0 = innerBorder.tiles[0].plate;
			var plate1 = outerBorder0.tiles[0].plate !== plate0 ? outerBorder0.tiles[0].plate : outerBorder0.tiles[1].plate;

			var calculateElevation;

			if (corner.pressure > 0.3) {
				corner.elevation = Math.max(plate0.elevation, plate1.elevation) + corner.pressure;
				if (plate0.oceanic === plate1.oceanic)
					calculateElevation = calculateCollidingElevation;
				else if (plate0.oceanic)
					calculateElevation = calculateSubductingElevation;
				else
					calculateElevation = calculateSuperductingElevation;
			} else if (corner.pressure < -0.3) {
				corner.elevation = Math.max(plate0.elevation, plate1.elevation) - corner.pressure / 4;
				calculateElevation = calculateDivergingElevation;
			} else if (corner.shear > 0.3) {
				corner.elevation = Math.max(plate0.elevation, plate1.elevation) + corner.shear / 8;
				calculateElevation = calculateShearingElevation;
			} else {
				corner.elevation = (plate0.elevation + plate1.elevation) / 2;
				calculateElevation = calculateDormantElevation;
			}

			var nextCorner = innerBorder.oppositeCorner(corner);
			if (!nextCorner.betweenPlates) {
				elevationBorderQueue.push({
					origin: {
						corner: corner,
						pressure: corner.pressure,
						shear: corner.shear,
						plate: plate0,
						calculateElevation: calculateElevation
					},
					border: innerBorder,
					corner: corner,
					nextCorner: nextCorner,
					distanceToPlateBoundary: innerBorder.length(),
				});
			}
		} else {
			var plate0 = corner.tiles[0].plate;
			var plate1 = corner.tiles[1].plate;
			var plate2 = corner.tiles[2].plate;

			elevation = 0;

			if (corner.pressure > 0.3) {
				corner.elevation = Math.max(plate0.elevation, plate1.elevation, plate2.elevation) + corner.pressure;
			} else if (corner.pressure < -0.3) {
				corner.elevation = Math.max(plate0.elevation, plate1.elevation, plate2.elevation) + corner.pressure / 4;
			} else if (corner.shear > 0.3) {
				corner.elevation = Math.max(plate0.elevation, plate1.elevation, plate2.elevation) + corner.shear / 8;
			} else {
				corner.elevation = (plate0.elevation + plate1.elevation + plate2.elevation) / 3;
			}
		}

		//corner.elevation += (corner.distanceToPlateBoundary);//Math.random();
	}

	action.provideResult(elevationBorderQueue);
}

function calculateCollidingElevation(distanceToPlateBoundary, distanceToPlateRoot, boundaryElevation, plateElevation, pressure, shear) {
	var t = distanceToPlateBoundary / (distanceToPlateBoundary + distanceToPlateRoot);
	var e = 0
	if (t < 0.5) //0.5
	{
		t = t / 0.5;
		e = plateElevation + Math.pow(t - 1, 2) * (boundaryElevation - plateElevation);
	} else {
		e = plateElevation;
	}
	//e += distanceToPlateBoundary/distanceToPlateRoot*0.25;
	return e
}

function calculateSuperductingElevation(distanceToPlateBoundary, distanceToPlateRoot, boundaryElevation, plateElevation, pressure, shear) {
	var t = distanceToPlateBoundary / (distanceToPlateBoundary + distanceToPlateRoot);
	if (t < 0.2) {
		t = t / 0.2;
		return boundaryElevation + t * (plateElevation - boundaryElevation + pressure / 2);
	} else if (t < 0.5) {
		t = (t - 0.2) / 0.3;
		return plateElevation + Math.pow(t - 1, 2) * pressure / 2;
	} else {
		return plateElevation;
	}
}

function calculateSubductingElevation(distanceToPlateBoundary, distanceToPlateRoot, boundaryElevation, plateElevation, pressure, shear) {
	var t = distanceToPlateBoundary / (distanceToPlateBoundary + distanceToPlateRoot);
	return plateElevation + Math.pow(t - 1, 2) * (boundaryElevation - plateElevation);
}

function calculateDivergingElevation(distanceToPlateBoundary, distanceToPlateRoot, boundaryElevation, plateElevation, pressure, shear) {
	var t = distanceToPlateBoundary / (distanceToPlateBoundary + distanceToPlateRoot);
	if (t < 0.3) {
		t = t / 0.3;
		return plateElevation + Math.pow(t - 1, 2) * (boundaryElevation - plateElevation);
	} else {
		return plateElevation;
	}
}

function calculateShearingElevation(distanceToPlateBoundary, distanceToPlateRoot, boundaryElevation, plateElevation, pressure, shear) {

	var t = distanceToPlateBoundary / (distanceToPlateBoundary + distanceToPlateRoot);

	if (plateElevation > 0) var q = distanceToPlateBoundary / (distanceToPlateRoot);
	else var q = Math.min(distanceToPlateBoundary / (distanceToPlateRoot), distanceToPlateBoundary / (distanceToPlateBoundary + distanceToPlateRoot));

	if (t < 0.2) //0.2
	{
		t = t / 0.2;
		return plateElevation + Math.pow(t - 1, 2) * (boundaryElevation - plateElevation);
	} else {

		return plateElevation;
	}
}

function calculateDormantElevation(distanceToPlateBoundary, distanceToPlateRoot, boundaryElevation, plateElevation, pressure, shear) {
	var t = distanceToPlateBoundary / (distanceToPlateBoundary + distanceToPlateRoot);
	var elevationDifference = boundaryElevation - plateElevation;
	var a = 2 * elevationDifference;
	var b = -3 * elevationDifference;
	return (t * t * elevationDifference * (2 * t - 3) + boundaryElevation); //original
	//return (t * t * elevationDifference * (2 * t - 3) + boundaryElevation)*(1+((Math.random()-0.5)*0.5));
}

function processElevationBorderQueue(elevationBorderQueue, elevationBorderQueueSorter, action) {
	if (elevationBorderQueue.length === 0) return;

	var iEnd = iEnd = elevationBorderQueue.length;
	for (var i = 0; i < iEnd; ++i) {
		var front = elevationBorderQueue[i];
		var corner = front.nextCorner;
		if (!corner.elevation) {
			corner.distanceToPlateBoundary = front.distanceToPlateBoundary;
			corner.elevation = front.origin.calculateElevation(
				corner.distanceToPlateBoundary,
				corner.distanceToPlateRoot,
				front.origin.corner.elevation,
				front.origin.plate.elevation,
				front.origin.pressure,
				front.origin.shear);

			//better drainage
			//if (corner.elevation >= 0) corner.elevation += corner.distanceToPlateRoot/700 + Math.max(corner.distanceToPlateRoot/700,corner.distanceToPlateBoundary/700);
			if (corner.elevation >= 0) corner.elevation += corner.distanceToPlateBoundary / 700;

			for (var j = 0; j < corner.borders.length; ++j) {
				var border = corner.borders[j];
				if (!border.betweenPlates) {
					var nextCorner = corner.corners[j];
					var distanceToPlateBoundary = corner.distanceToPlateBoundary + border.length();
					if (!nextCorner.distanceToPlateBoundary || nextCorner.distanceToPlateBoundary > distanceToPlateBoundary) {
						elevationBorderQueue.push({
							origin: front.origin,
							border: border,
							corner: corner,
							nextCorner: nextCorner,
							distanceToPlateBoundary: distanceToPlateBoundary,
						});
					}
				}
			}
		}
	}
	var minElev = 0;
	var maxElev = 0;
	for (var i = 0; i < iEnd; ++i) {
		var front = elevationBorderQueue[i];
		var corner = front.nextCorner;
		if (corner.elevation > maxElev) maxElev = corner.elevation;
		if (corner.elevation < minElev) minElev = corner.elevation;
	}
	for (var i = 0; i < iEnd; ++i) {
		var front = elevationBorderQueue[i];
		var corner = front.nextCorner;
		if (corner.elevation >= 0) corner.elevation = corner.elevation / maxElev;
		if (corner.elevation < 0) corner.elevation = -corner.elevation / minElev;
	}
	elevationBorderQueue.splice(0, iEnd);
	elevationBorderQueue.sort(elevationBorderQueueSorter);

	action.loop();
}

function calculateTileAverageElevations(tiles, action) {
	for (var i = 0; i < tiles.length; ++i) {
		var tile = tiles[i];
		var elevation = 0;
		for (var j = 0; j < tile.corners.length; ++j) {
			elevation += tile.corners[j].elevation;
		}
		tile.elevation = (elevation / tile.corners.length);
		tile.shore = 0;
		tile.shoreZ = 0;
		tile.shoreA = 0;
	}
}

function tileElevationProcs(tiles, action) {
	//random sign Math.random() < 0.5 ? -1 : 1
	for (var i = 0; i < tiles.length; ++i) {
		var tile = tiles[i];
		if (tile.shore == 0) {
			if (tile.elevation > 0) {
				if (Math.min.apply(0, tile.tiles.map((data) => data.elevation)) < 0) {
					tile.shore = 1
				}
			} else
				if (tile.elevation < 0) {
					if (Math.max.apply(0, tile.tiles.map((data) => data.elevation)) > 0) {
						tile.shore = -1
					}
				}
		}
	}
	var s = 1;
	while (!Math.min.apply(0, tiles.map((data) => Math.abs(data.shore))) > 0) {

		for (var i = 0; i < tiles.length; ++i) {
			var tile = tiles[i];
			//var ts = tile.tiles.map((data) => data.shore);

			if (Math.abs(tile.shore) == s) {
				for (var j = 0; j < tile.tiles.length; ++j) {
					if (tile.tiles[j].shore == 0) {
						if (tile.tiles[j].elevation > 0) {
							tile.tiles[j].shore = tile.shore + 1
						} else {
							tile.tiles[j].shore = tile.shore - 1
						}
					}
				}
			}
		}
		s += 1;
		//console.log('shore loop',s);
	}

	for (var i = 0; i < tiles.length; ++i) {
		var tile = tiles[i];
		//if (tile.shore == 1) {tile.shoreZ = -1}
		if (tile.shore == 2) {
			tile.shoreZ = 1
			for (var j = 0; j < tile.tiles.length; ++j) {
				if (tile.tiles[j].shore == 1 && tile.tiles[j].shoreZ == 0) {
					tile.tiles[j].shoreZ = -1
				}
			}
		}
	}
	//console.log('z')
	s = 1;
	while (!Math.min.apply(0, tiles.map((data) => Math.abs(data.shoreZ))) > 0 && s < tiles.length) {

		for (var i = 0; i < tiles.length; ++i) {
			var tile = tiles[i];
			//var ts = tile.tiles.map((data) => data.shoreZ);

			if (Math.abs(tile.shoreZ) == s) {
				for (var j = 0; j < tile.tiles.length; ++j) {
					if (tile.tiles[j].shoreZ == 0) {
						if (tile.tiles[j].shore > 2) {
							tile.tiles[j].shoreZ = tile.shoreZ + 1
						} else {
							tile.tiles[j].shoreZ = tile.shoreZ - 1
						}
					}
				}
			}
		}
		s += 1;
	}

	for (var i = 0; i < tiles.length; ++i) {
		var tile = tiles[i];
		if (tile.shore == -3) {
			tile.shoreA = -1
			for (var j = 0; j < tile.tiles.length; ++j) {
				if (tile.tiles[j].shoreA == 0) {
					if (tile.shoreA == -1 && tile.shore < tile.tiles[j].shore) {
						tile.tiles[j].shoreA = 1
					}
				}
			}
		}
	}
	s = 1;
	while (!Math.min.apply(0, tiles.map((data) => Math.abs(data.shoreA))) > 0 && s < tiles.length) {
		for (var i = 0; i < tiles.length; ++i) {
			var tile = tiles[i];
			if (tile.shore < -3 && tile.shoreA == 0) {
				tile.shoreA = tile.shore + 2
			}
			else if (tile.shoreA == s) {
				for (var j = 0; j < tile.tiles.length; ++j) {
					if (tile.tiles[j].shoreA == 0) {
						//if (tile.tiles[j].shore > tile.shore) {
						tile.tiles[j].shoreA = tile.shoreA + 1
						//} else {
						//	tile.tiles[j].shoreA = tile.shoreA - 1
						//}
					}
				}
			}
		}
		s += 1;
	}
}

function nextASCII(c) {
	return String.fromCharCode(c.charCodeAt(0) + 1);
}

function body(tile, str, shr, min = -1) {
	for (var i = 0; i < tile.tiles.length; ++i) {
		var tileI = tile.tiles[i];
		console.log(tile.body, tileI.body);
		if (typeof tileI.body !== "undefined") {
			continue;
		}
		if (tileI.shore >= min) {
			continue;
		}
		tileI.body = str;
		body(tileI, str, shr, min);
	}
}

function generatePlanetWeather(topology, partitions, heatLevel, moistureLevel, random, action) {
	var planetRadius = 1000;
	var whorls;
	var activeCorners;
	var totalHeat;
	var remainingHeat;
	var totalMoisture;
	var remainingMoisture;

	action
		.executeSubaction(function (action) {
			console.time('Weather: Air Currents');
			generateAirCurrentWhorls(planetRadius, random, action);
		}, 1, "Generating Air Currents")
		.getResult(function (result) {
			console.timeEnd('Weather: Air Currents');
			whorls = result;
		})
		.executeSubaction(function (action) {
			console.time('Weather: Calculate Currents');
			calculateAirCurrents(topology.corners, whorls, planetRadius, action);
		}, 1, "Generating Air Currents")
		.getResult(function (result) {
			console.timeEnd('Weather: Calculate Currents');
		})
		.executeSubaction(function (action) {
			console.time('Weather: Heat Initialization');
			initializeAirHeat(topology.corners, heatLevel, action);
		}, 2, "Calculating Temperature")
		.getResult(function (result) {
			console.timeEnd('Weather: Heat Initialization');
			activeCorners = result.corners;
			totalHeat = result.airHeat;
			remainingHeat = result.airHeat;
		})
		.executeSubaction(function (action) {
			console.time('Weather: Heat Processing');
			var consumedHeat = processAirHeat(activeCorners, action);
			remainingHeat -= consumedHeat;
			if (remainingHeat > 0 && consumedHeat >= 0.0001) action.loop(1 - remainingHeat / totalHeat);
		}, 8, "Calculating Temperature")
		.executeSubaction(function (action) {
			console.timeEnd('Weather: Heat Processing');
			console.time('Weather: Temperature Calculation');
			calculateTemperature(topology.corners, topology.tiles, planetRadius, action);
		}, 1, "Calculating Temperature")
		.executeSubaction(function (action) {
			console.timeEnd('Weather: Temperature Calculation');
			console.time('Weather: Moisture Initialization');
			initializeAirMoisture(topology.corners, moistureLevel, action);
		}, 2, "Calculating Moisture")
		.getResult(function (result) {
			console.timeEnd('Weather: Moisture Initialization');
			activeCorners = result.corners;
			totalMoisture = result.airMoisture;
			remainingMoisture = result.airMoisture;
		})
		.executeSubaction(function (action) {
			console.time('Weather: Moisture Processing');
			var consumedMoisture = processAirMoisture(activeCorners, action);
			remainingMoisture -= consumedMoisture;
			if (remainingMoisture > 0 && consumedMoisture >= 0.0001) action.loop(1 - remainingMoisture / totalMoisture);
		}, 32, "Calculating Moisture")
		.executeSubaction(function (action) {
			console.timeEnd('Weather: Moisture Processing');
			console.time('Weather: Final Moisture Calculation');
			calculateMoisture(topology.corners, topology.tiles, action);
		}, 1, "Calculating Moisture")
		.getResult(function (result) {
			console.timeEnd('Weather: Final Moisture Calculation');
		});
}

function generateAirCurrentWhorls(planetRadius, random, action) {
	var whorls = [];
	var direction = random.integer(0, 1) ? 1 : -1;
	var layerCount = random.integer(4, 7);
	var circumference = Math.PI * 2 * planetRadius;
	var fullRevolution = Math.PI * 2;
	var baseWhorlRadius = circumference / (2 * (layerCount - 1));

	whorls.push({
		center: new Vector3(0, planetRadius, 0)
			.applyAxisAngle(new Vector3(1, 0, 0), random.realInclusive(0, fullRevolution / (2 * (layerCount + 4))))
			.applyAxisAngle(new Vector3(0, 1, 0), random.real(0, fullRevolution)),
		strength: random.realInclusive(fullRevolution / 36, fullRevolution / 24) * direction,
		radius: random.realInclusive(baseWhorlRadius * 0.8, baseWhorlRadius * 1.2)
	});

	for (var i = 1; i < layerCount - 1; ++i) {
		direction = -direction;
		var baseTilt = i / (layerCount - 1) * fullRevolution / 2;
		var layerWhorlCount = Math.ceil((Math.sin(baseTilt) * planetRadius * fullRevolution) / baseWhorlRadius);
		for (var j = 0; j < layerWhorlCount; ++j) {
			whorls.push({
				center: new Vector3(0, planetRadius, 0)
					.applyAxisAngle(new Vector3(1, 0, 0), random.realInclusive(0, fullRevolution / (2 * (layerCount + 4))))
					.applyAxisAngle(new Vector3(0, 1, 0), random.real(0, fullRevolution))
					.applyAxisAngle(new Vector3(1, 0, 0), baseTilt)
					.applyAxisAngle(new Vector3(0, 1, 0), fullRevolution * (j + (i % 2) / 2) / layerWhorlCount),
				strength: random.realInclusive(fullRevolution / 48, fullRevolution / 32) * direction,
				radius: random.realInclusive(baseWhorlRadius * 0.8, baseWhorlRadius * 1.2)
			});
		}
	}

	direction = -direction;
	whorls.push({
		center: new Vector3(0, planetRadius, 0)
			.applyAxisAngle(new Vector3(1, 0, 0), random.realInclusive(0, fullRevolution / (2 * (layerCount + 4))))
			.applyAxisAngle(new Vector3(0, 1, 0), random.real(0, fullRevolution))
			.applyAxisAngle(new Vector3(1, 0, 0), fullRevolution / 2),
		strength: random.realInclusive(fullRevolution / 36, fullRevolution / 24) * direction,
		radius: random.realInclusive(baseWhorlRadius * 0.8, baseWhorlRadius * 1.2)
	});

	action.provideResult(whorls);
}

function calculateAirCurrents(corners, whorls, planetRadius, action) {
	var i = 0;
	action.executeSubaction(function (action) {
		if (i >= corners.length) return;

		var corner = corners[i];
		var airCurrent = new Vector3(0, 0, 0);
		var weight = 0;
		for (var j = 0; j < whorls.length; ++j) {
			var whorl = whorls[j];
			var angle = whorl.center.angleTo(corner.position);
			var distance = angle * planetRadius;
			if (distance < whorl.radius) {
				var normalizedDistance = distance / whorl.radius;
				var whorlWeight = 1 - normalizedDistance;
				var whorlStrength = planetRadius * whorl.strength * whorlWeight * normalizedDistance;
				var whorlCurrent = whorl.center.clone().cross(corner.position).setLength(whorlStrength);
				airCurrent.add(whorlCurrent);
				weight += whorlWeight;
			}
		}
		airCurrent.divideScalar(weight);
		corner.airCurrent = airCurrent;
		corner.airCurrentSpeed = airCurrent.length(); //kilometers per hour

		corner.airCurrentOutflows = new Array(corner.borders.length);
		var airCurrentDirection = airCurrent.clone().normalize();
		var outflowSum = 0;
		for (var j = 0; j < corner.corners.length; ++j) {
			var vector = corner.vectorTo(corner.corners[j]).normalize();
			var dot = vector.dot(airCurrentDirection);
			if (dot > 0) {
				corner.airCurrentOutflows[j] = dot;
				outflowSum += dot;
			} else {
				corner.airCurrentOutflows[j] = 0;
			}
		}

		if (outflowSum > 0) {
			for (var j = 0; j < corner.borders.length; ++j) {
				corner.airCurrentOutflows[j] /= outflowSum;
			}
		}

		++i;
		action.loop(i / corners.length);
	});
}

function initializeAirHeat(corners, heatLevel, action) {
	var activeCorners = [];
	var airHeat = 0;
	for (var i = 0; i < corners.length; ++i) {
		var corner = corners[i];
		corner.airHeat = corner.area * heatLevel;
		corner.newAirHeat = 0;
		corner.heat = 0;

		corner.heatAbsorption = 0.1 * corner.area / Math.max(0.1, Math.min(corner.airCurrentSpeed, 1));
		if (corner.elevation <= 0) {
			corner.maxHeat = corner.area;
		} else {
			corner.maxHeat = corner.area;
			corner.heatAbsorption *= 2;
		}

		activeCorners.push(corner);
		airHeat += corner.airHeat;
	}

	action.provideResult({
		corners: activeCorners,
		airHeat: airHeat
	});
}

function processAirHeat(activeCorners, action) {
	var consumedHeat = 0;
	var activeCornerCount = activeCorners.length;
	for (var i = 0; i < activeCornerCount; ++i) {
		var corner = activeCorners[i];
		if (corner.airHeat === 0) continue;

		var heatChange = Math.max(0, Math.min(corner.airHeat, corner.heatAbsorption * (1 - corner.heat / corner.maxHeat)));
		corner.heat += heatChange;
		consumedHeat += heatChange;
		var heatLoss = corner.area * (corner.heat / corner.maxHeat) * 0.02;
		heatChange = Math.min(corner.airHeat, heatChange + heatLoss);

		var remainingCornerAirHeat = corner.airHeat - heatChange;
		corner.airHeat = 0;

		for (var j = 0; j < corner.corners.length; ++j) {
			var outflow = corner.airCurrentOutflows[j];
			if (outflow > 0) {
				corner.corners[j].newAirHeat += remainingCornerAirHeat * outflow;
				activeCorners.push(corner.corners[j]);
			}
		}
	}

	activeCorners.splice(0, activeCornerCount);

	for (var i = 0; i < activeCorners.length; ++i) {
		var corner = activeCorners[i];
		corner.airHeat = corner.newAirHeat;
	}
	for (var i = 0; i < activeCorners.length; ++i) {
		activeCorners[i].newAirHeat = 0;
	}

	return consumedHeat;
}

function calculateTemperature(corners, tiles, planetRadius, action) {
	for (var i = 0; i < corners.length; ++i) {
		var corner = corners[i];
		var latitudeEffect = Math.sqrt(1 - Math.abs(corner.position.y) / planetRadius);
		var elevationEffect = 1 - Math.pow(Math.max(0, Math.min(corner.elevation * 0.8, 1)), 2);
		var normalizedHeat = corner.heat / corner.area;
		corner.temperature = (latitudeEffect * elevationEffect * 0.7 + normalizedHeat * 0.3) * 5 / 3 - 2 / 3;
		delete corner.airHeat;
		delete corner.newAirHeat;
		delete corner.heat;
		delete corner.maxHeat;
		delete corner.heatAbsorption;
	}

	for (var i = 0; i < tiles.length; ++i) {
		var tile = tiles[i];
		tile.temperature = 0;
		for (var j = 0; j < tile.corners.length; ++j) {
			tile.temperature += tile.corners[j].temperature;
		}
		tile.temperature /= tile.corners.length;
	}
}

function initializeAirMoisture(corners, moistureLevel, action) {
	activeCorners = [];
	airMoisture = 0;
	for (var i = 0; i < corners.length; ++i) {
		var corner = corners[i];
		corner.airMoisture = (corner.elevation > 0) ? 0 : corner.area * moistureLevel * Math.max(0, Math.min(0.5 + corner.temperature * 0.5, 1));
		corner.newAirMoisture = 0;
		corner.precipitation = 0;

		corner.precipitationRate = 0.0075 * corner.area / Math.max(0.1, Math.min(corner.airCurrentSpeed, 1));
		corner.precipitationRate *= 1 + (1 - Math.max(0, Math.max(corner.temperature, 1))) * 0.1;
		if (corner.elevation > 0) {
			corner.precipitationRate *= 1 + corner.elevation * 0.5;
			corner.maxPrecipitation = corner.area * (0.25 + Math.max(0, Math.min(corner.elevation, 1)) * 0.25);
		} else {
			corner.maxPrecipitation = corner.area * 0.25;
		}

		activeCorners.push(corner);
		airMoisture += corner.airMoisture;
	}

	action.provideResult({
		corners: activeCorners,
		airMoisture: airMoisture
	});
}

function processAirMoisture(activeCorners, action) {
	var consumedMoisture = 0;
	var activeCornerCount = activeCorners.length;
	for (var i = 0; i < activeCornerCount; ++i) {
		var corner = activeCorners[i];
		if (corner.airMoisture === 0) continue;

		var moistureChange = Math.max(0, Math.min(corner.airMoisture, corner.precipitationRate * (1 - corner.precipitation / corner.maxPrecipitation)));
		corner.precipitation += moistureChange;
		consumedMoisture += moistureChange;
		var moistureLoss = corner.area * (corner.precipitation / corner.maxPrecipitation) * 0.02;
		moistureChange = Math.min(corner.airMoisture, moistureChange + moistureLoss);

		var remainingCornerAirMoisture = corner.airMoisture - moistureChange;
		corner.airMoisture = 0;

		for (var j = 0; j < corner.corners.length; ++j) {
			var outflow = corner.airCurrentOutflows[j];
			if (outflow > 0) {
				corner.corners[j].newAirMoisture += remainingCornerAirMoisture * outflow;
				activeCorners.push(corner.corners[j]);
			}
		}
	}

	activeCorners.splice(0, activeCornerCount);

	for (var i = 0; i < activeCorners.length; ++i) {
		var corner = activeCorners[i];
		corner.airMoisture = corner.newAirMoisture;
	}
	for (var i = 0; i < activeCorners.length; ++i) {
		activeCorners[i].newAirMoisture = 0;
	}

	return consumedMoisture;
}

function calculateMoisture(corners, tiles, action) {
	for (var i = 0; i < corners.length; ++i) {
		var corner = corners[i];
		corner.moisture = corner.precipitation / corner.area / 0.5;
		delete corner.airMoisture;
		delete corner.newAirMoisture;
		delete corner.precipitation;
		delete corner.maxPrecipitation;
		delete corner.precipitationRate;
	}

	for (var i = 0; i < tiles.length; ++i) {
		var tile = tiles[i];
		tile.moisture = 0;
		for (var j = 0; j < tile.corners.length; ++j) {
			tile.moisture += tile.corners[j].moisture;
		}
		tile.moisture /= tile.corners.length;
		tile.rain = tile.moisture
	}
}

function generatePlanetBiomesResources(tiles, planetRadius, action) {
	tiles.sort((a, b) => parseFloat(b.elevation) - parseFloat(a.elevation));
	var flows = tiles.filter(t => t.outflow > 0).sort((a, b) => parseFloat(a.outflow) - parseFloat(b.outflow));
	var flowThreshold = flows[Math.floor(flows.length * .88)].outflow;
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
		}		t.wheat = 0;
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
		} else if (tile.drain && tile.outflow > flowThreshold) {
			tile.river = true;
			tile.fish = Math.max(.125,Math.min(.25,tile.upstream.length/20))+Math.min(.75,(tile.upstream.length/(tile.downstream.length+1))/45);
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

function buildSurfaceRenderObject(tiles, watersheds, random, action) {
	var planetGeometry = new THREE.Geometry();
	var waterGeometry = new THREE.Geometry();
	var terrainColors = [];
	var plateColors = [];
	var elevationColors = [];
	var temperatureColors = [];
	var moistureColors = [];
	var wheatColors = [];
	var cornColors = [];
	var riceColors = [];
	var fishColors = [];
	var calorieColors = [];
	var portColors = [];
	var shoreColors = [];
	var shoreAColors = [];
	var shoreZColors = [];
	var minShore = Math.min.apply(0, tiles.map((data) => data.shore));
	var maxShore = Math.max.apply(0, tiles.map((data) => data.shore));
	var minBody = Math.min.apply(0, tiles.map((data) => data.body.id));
	var maxBody = Math.max.apply(0, tiles.map((data) => data.body.id));
	let maxSediment = Math.max(...tiles.map(t => t.sediment? t.sediment:0));

	var i = 0;
	action.executeSubaction(function (action) {
		if (i >= tiles.length) return;

		var tile = tiles[i];
		var terrainColor;

		var elevationColor;
		if (tile.elevation <= 0) elevationColor = new THREE.Color(0x224488).lerp(new THREE.Color(0xAADDFF), Math.max(0, Math.min((tile.elevation + 3 / 4) / (3 / 4), 1)));
		else elevationColor = new THREE.Color(0x997755).lerp(new THREE.Color(0x222222), Math.max(0, Math.min(tile.elevation, 1)));

		if (tile.elevation <= 0 || tile.lake) {
			if (tile.elevation <= 0) {
				var normalizedDepth = Math.min(-tile.elevation, 1);
			} else {
				if (tile.lake.log === 'filled') {
					var normalizedDepth = 0.1
				} else if (tile.lake.log === 'kept no drain') {
					var normalizedDepth = 0.5
				} else var normalizedDepth = 1
			}//Math.min(0.2 + 4 * (tile.lake.level - tile.elevation), 1) }
			if ((tile.temperature < 0 || (normalizedElevation - normalizedTemperature / 1.5 > 0.75)) && tile.lake) {
				terrainColor = new THREE.Color(0xDDEEFF) // glacier
			} else if (tile.biome === "ocean" || tile.lake) {
				terrainColor = new THREE.Color(0x27efff).lerp(new THREE.Color(0x072995), Math.pow(normalizedDepth, 1 / 3)).lerp(new THREE.Color(0x072995).lerp(new THREE.Color(0x222D5E), Math.pow(normalizedDepth, 1 / 5)), 1 - 1.1 * tile.temperature);
			} else if (tile.biome === "seaIce") {
				terrainColor = new THREE.Color(0x9EE1FF); //.lerp(colorDeviance, 0.10);
			} else {
				terrainColor = new THREE.Color(0xFF0000);
			}
		} else {
			var normalizedElevation = Math.min(tile.elevation, 1);
			var normalizedMoisture = Math.min(tile.moisture, 1);
			var normalizedTemperature = Math.min(Math.max(tile.temperature, 0), 1);

			terrainColor = new THREE.Color(0xCCCC66).lerp(new THREE.Color(0x005000), Math.pow(normalizedMoisture, .25)).lerp(new THREE.Color(0x777788), Math.pow(normalizedElevation, 2)).lerp(new THREE.Color(0x555544), (1 - tile.temperature));
			terrainColor = terrainColor.lerp(elevationColor, Math.pow(Math.max(normalizedElevation - .4, 0), .7) - normalizedMoisture);
			terrainColor = terrainColor.lerp(new THREE.Color(0x808079), (normalizedTemperature) ^ .01)

			if (tile.biome === "glacier" || tile.temperature < 0) { // && normalizedMoisture > 0.1)
				terrainColor = new THREE.Color(0xDDEEFF);//(0xDDEEFF)
			}
			else if (tile.biome === "lake") {
				//terrainColor =            new THREE.Color(0x04e8fc).lerp(new THREE.Color(0x072965), Math.sqrt(normalizedElevation)).lerp(new THREE.Color(0x2D2D5E),1-tile.temperature);//.lerp(colorDeviance, 0.10);//colder seas are greyer//
				terrainColor = new THREE.Color(0x00FFFF)
				//console.log("lake")
			}
		}

		if (tile.error) { terrainColor = new THREE.Color(0xFF00FF) }
		tile.terrainColor = terrainColor

		var plateColor = tile.plate.color.clone();

		var temperatureColor;
		if (tile.temperature <= 0) temperatureColor = new THREE.Color(0x0000FF).lerp(new THREE.Color(0xBBDDFF), Math.max(0, Math.min((tile.temperature + 2 / 3) / (2 / 3), 1)));
		else temperatureColor = new THREE.Color(0xFFFF00).lerp(new THREE.Color(0xFF0000), Math.max(0, Math.min((tile.temperature) / (3 / 3), 1)));

		var moistureColor = new THREE.Color(0xFFCC00).lerp(new THREE.Color(0x0066FF), Math.max(0, Math.min(tile.rain, 1)));

		//wheat color
		var wheatColor = terrainColor.clone()
		wheatColor = wheatColor.lerp(new THREE.Color(0xFF00FF), tile.wheat / 100);

		//corn color		
		var cornColor = terrainColor.clone()
		cornColor = cornColor.lerp(new THREE.Color(0xFF00FF), tile.corn / 100);

		//rice color		
		var riceColor = terrainColor.clone()
		riceColor = riceColor.lerp(new THREE.Color(0xFF00FF), tile.rice / 100);

		//fish color		
		var fishColor = terrainColor.clone()
		if (tile.fish>0) {
			fishColor = fishColor.lerp(new THREE.Color(0xFF00FF), tile.fish);
		}
		var calorieColor = terrainColor.clone()
		if (tile.upstreamWeight) {
			calorieColor = calorieColor.lerp(new THREE.Color(0xFF00FF), tile.upstreamWeight);
		}

		var portColor = elevationColor.clone()
		if (tile.elevation > 0) {
			var shrDim = maxShore / 4
			if (tile.shore < 3) {
				if (Math.abs(tile.shoreA - tile.shore) >= 4) {
					portColor = portColor.lerp(new THREE.Color(0xFF00FF), Math.abs(tile.shoreA - tile.shore) / 8)
				}
				if (Math.abs(tile.shoreZ - tile.shore) >= 3) {
					portColor = portColor.lerp(new THREE.Color(0x00FF00), Math.abs(tile.shoreZ - tile.shore) / 6)
				}
			}
		}

		var shoreColor = terrainColor.clone()
/* 		if (tile.shore >= 0) {
			if (!tile.tiles.some(n => n.shore > tile.shore)) {
				shoreColor = new THREE.Color(0xFF00FF)
			} else {
				shoreColor = new THREE.Color(0x008800).lerp(new THREE.Color(0xFFFF00), Math.min(1, tile.shore / (maxShore / 2))).lerp(new THREE.Color(0xBB0000), tile.shore / maxShore)
			}
		}
		else {
			shoreColor = new THREE.Color(0x00FFFF).lerp(new THREE.Color(0x0000FF), tile.shore / minShore)
		}; */
		
		//visualize tile.id layouts (dodecahedron?)
		//let maxID = Math.max(...tiles.map(t => t.id));
		//shoreColor = new THREE.Color(0x005500).lerp(new THREE.Color(0xFFFF00), tile.id/maxID);
		
		//visualize sediment
		//console.log(maxSediment);
		//shoreColor = shoreColor.lerp(new THREE.Color(0xFF00FF), (tile.sediment? tile.sediment:0)/maxSediment);

		//if (tile.fish) {
		//	shoreColor = shoreColor.lerp(new THREE.Color(0xFF00FF), tile.fish);
		//}

		//features
		//if (tile.feature) {
		//	shoreColor = tile.feature.color;
		//}

		//gold
		//if (tile.gold) {
		//	shoreColor = shoreColor.lerp(new THREE.Color(0xFF00FF), tile.gold);
		//}

		//timber
		//if (tile.timber) {
		//	shoreColor = shoreColor.lerp(new THREE.Color(0xFF00FF), tile.timber);
		//}
		//
		////gold and oil
		if (tile.oil || tile.gold || tile.bauxite || tile.copper || tile.iron) {
			//shoreColor = new THREE.Color(0xFFFFFF);
			if (tile.gold>0) {
				shoreColor = new THREE.Color(0xFFFF00);
			} else if (tile.oil > 0) {
				shoreColor = new THREE.Color(0x000000);
			} else if (tile.bauxite > 0) {
				shoreColor = new THREE.Color(0xFFA500);
			} else if (tile.copper > 0) {
				shoreColor = new THREE.Color(0xFF00FF);
			} else if (tile.iron > 0) {
				shoreColor = new THREE.Color(0xFF0000);
			}
		}

		//slope
		//if (tile.slope && tile.elevation>0) {
			//shoreColor = shoreColor.lerp(new THREE.Color(0xFF00FF), tile.slope);
		//}
		//fibNoise
		//if (tile.fibNoise) {
		//	shoreColor = shoreColor.lerp(new THREE.Color(0xFF00FF), (1+Math.sin(tile.fibNoise*Math.PI*6))/2);
		//}


		var shoreAColor = terrainColor.clone()
		if (tile.body.id > 0) {
			shoreAColor = new THREE.Color(0x005500).lerp(new THREE.Color(0xFFFF00), tile.body.id / maxBody)
		}
		else if (tile.body.id < 0) {
			shoreAColor = new THREE.Color(0x00FFFF).lerp(new THREE.Color(0x0000FF), tile.body.id / minBody)
		};

		var shoreZColor = terrainColor.clone()
		
		if (tile.watershed && tile.watershed.id >= 0 && !tile.lake) {
			shoreZColor = tile.watershed.color;
			//shoreZColor = new THREE.Color(0xFF0000).lerp(new THREE.Color(0x00FF00), tile.watershed.hash).lerp(new THREE.Color(0xFFFF88), tile.watershed.id % 0.758033988749895)

		};

		var baseIndex = planetGeometry.vertices.length;
		var centerPos = tile.averagePosition
		planetGeometry.vertices.push(tile.averagePosition);
		for (var j = 0; j < tile.corners.length; ++j) {
			var cornerPosition = tile.corners[j].position;
			planetGeometry.vertices.push(cornerPosition);
			planetGeometry.vertices.push(tile.averagePosition.clone().sub(cornerPosition).multiplyScalar(0.1).add(cornerPosition)); //0.1 border thickness as multiple of wedge length. low numbers can cause aliasing

			var i0 = j * 2;
			var i1 = ((j + 1) % tile.corners.length) * 2;
			buildTileWedge(planetGeometry.faces, baseIndex, i0, i1, tile.normal);

			//if (tile.elevation > 0.85) buildTileWedgeColors1(terrainColors, terrainColor, new THREE.Color(0xDDEEFF), terrainColor.clone().multiplyScalar(0.9)); //0.5 the smaller this number, the darker the border
			//else buildTileWedgeColors1(terrainColors, terrainColor, terrainColor, terrainColor.clone().multiplyScalar(0.9)); //0.5 the smaller this number, the darker the border

			buildTileWedgeColors(terrainColors, terrainColor, terrainColor.clone().multiplyScalar(0.95)); //0.5 the smaller this number, the darker the border
			buildTileWedgeColors(plateColors, plateColor, plateColor.clone().multiplyScalar(1));
			buildTileWedgeColors(elevationColors, elevationColor, elevationColor.clone().multiplyScalar(0.9));
			buildTileWedgeColors(temperatureColors, temperatureColor, temperatureColor.clone().multiplyScalar(1));
			buildTileWedgeColors(moistureColors, moistureColor, moistureColor.clone().multiplyScalar(1));
			buildTileWedgeColors(wheatColors, wheatColor, wheatColor.clone().multiplyScalar(0.95));
			buildTileWedgeColors(cornColors, cornColor, cornColor.clone().multiplyScalar(0.95));
			buildTileWedgeColors(riceColors, riceColor, riceColor.clone().multiplyScalar(0.95));
			buildTileWedgeColors(fishColors, fishColor, fishColor.clone().multiplyScalar(0.95));
			buildTileWedgeColors(calorieColors, calorieColor, calorieColor.clone().multiplyScalar(0.95));
			buildTileWedgeColors(portColors, portColor, portColor.clone().multiplyScalar(0.95));
			buildTileWedgeColors(shoreColors, shoreColor, shoreColor.clone().multiplyScalar(1));
			buildTileWedgeColors(shoreAColors, shoreAColor, shoreAColor.clone().multiplyScalar(1));
			buildTileWedgeColors(shoreZColors, shoreZColor, shoreZColor.clone().multiplyScalar(1));
			for (var k = planetGeometry.faces.length - 3; k < planetGeometry.faces.length; ++k) planetGeometry.faces[k].vertexColors = terrainColors[k];
		}
		//if (i<=1) console.log(tile)
		++i;

		action.loop(i / tiles.length);
	});

	planetGeometry.dynamic = true;
	planetGeometry.boundingSphere = new THREE.Sphere(new Vector3(0, 0, 0), 1000);
	var planetMaterial = new THREE.MeshLambertMaterial({
		color: new THREE.Color(0x000000),
		ambient: new THREE.Color(0xFFFFFF),
		vertexColors: THREE.VertexColors,
	});
	//var waterMaterial = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(0x000000),reflectivity: 0.7, ambient: new THREE.Color(0xFFFFFF), vertexColors: THREE.VertexColors, });
	var planetRenderObject = new THREE.Mesh(planetGeometry, planetMaterial);

	action.provideResult({
		geometry: planetGeometry,
		terrainColors: terrainColors,
		plateColors: plateColors,
		elevationColors: elevationColors,
		temperatureColors: temperatureColors,
		moistureColors: moistureColors,
		wheatColors: wheatColors,
		cornColors: cornColors,
		riceColors: riceColors,
		fishColors: fishColors,
		calorieColors: calorieColors,
		portColors: portColors,
		shoreColors: shoreColors,
		shoreAColors: shoreAColors,
		shoreZColors: shoreZColors,
		material: planetMaterial,
		renderObject: planetRenderObject,
	});
}

function nrm(input = Math.random(), tr = 'logistic', p = 0, q = 1) {
	//bigger q=steeper ramp
	if (tr == 'logistic') {
		return 1 / (1 + Math.pow(Math.E, -(q * (input - (p - 0.5)))));
	}
}

function buildPlateBoundariesRenderObject(borders, action) {
	var geometry = new THREE.Geometry();

	var i = 0;
	action.executeSubaction(function (action) {
		if (i >= borders.length) return;

		var border = borders[i];
		if (border.betweenPlates) {
			var normal = border.midpoint.clone().normalize();
			var offset = normal.clone().multiplyScalar(1);

			var borderPoint0 = border.corners[0].position;
			var borderPoint1 = border.corners[1].position;
			var tilePoint0 = border.tiles[0].averagePosition;
			var tilePoint1 = border.tiles[1].averagePosition;

			var baseIndex = geometry.vertices.length;
			geometry.vertices.push(borderPoint0.clone().add(offset));
			geometry.vertices.push(borderPoint1.clone().add(offset));
			geometry.vertices.push(tilePoint0.clone().sub(borderPoint0).multiplyScalar(0.2).add(borderPoint0).add(offset));
			geometry.vertices.push(tilePoint0.clone().sub(borderPoint1).multiplyScalar(0.2).add(borderPoint1).add(offset));
			geometry.vertices.push(tilePoint1.clone().sub(borderPoint0).multiplyScalar(0.2).add(borderPoint0).add(offset));
			geometry.vertices.push(tilePoint1.clone().sub(borderPoint1).multiplyScalar(0.2).add(borderPoint1).add(offset));

			var pressure = Math.max(-1, Math.min((border.corners[0].pressure + border.corners[1].pressure) / 2, 1));
			var shear = Math.max(0, Math.min((border.corners[0].shear + border.corners[1].shear) / 2, 1));
			var innerColor = (pressure <= 0) ? new THREE.Color(1 + pressure, 1, 0) : new THREE.Color(1, 1 - pressure, 0);
			var outerColor = new THREE.Color(0, shear / 2, shear);

			geometry.faces.push(new THREE.Face3(baseIndex + 0, baseIndex + 1, baseIndex + 2, normal, [innerColor, innerColor, outerColor]));
			geometry.faces.push(new THREE.Face3(baseIndex + 1, baseIndex + 3, baseIndex + 2, normal, [innerColor, outerColor, outerColor]));
			geometry.faces.push(new THREE.Face3(baseIndex + 1, baseIndex + 0, baseIndex + 5, normal, [innerColor, innerColor, outerColor]));
			geometry.faces.push(new THREE.Face3(baseIndex + 0, baseIndex + 4, baseIndex + 5, normal, [innerColor, outerColor, outerColor]));
		}

		++i;

		action.loop(i / borders.length);
	});

	geometry.boundingSphere = new THREE.Sphere(new Vector3(0, 0, 0), 1010);
	var material = new THREE.MeshBasicMaterial({
		vertexColors: THREE.VertexColors,
	});
	var renderObject = new THREE.Mesh(geometry, material);

	action.provideResult({
		geometry: geometry,
		material: material,
		renderObject: renderObject,
	});
}

function buildPlateMovementsRenderObject(tiles, action) {
	var geometry = new THREE.Geometry();

	var i = 0;
	action.executeSubaction(function (action) {
		if (i >= tiles.length) return;

		var tile = tiles[i];
		var plate = tile.plate;
		var movement = plate.calculateMovement(tile.position);
		var plateMovementColor = new THREE.Color(1 - plate.r, 1 - plate.color.g, 1 - plate.color.b);

		buildArrow(geometry, tile.position.clone().multiplyScalar(1.002), movement.clone().multiplyScalar(0.5), tile.position.clone().normalize(), Math.min(movement.length(), 4), plateMovementColor);

		tile.plateMovement = movement;

		++i;

		action.loop(i / tiles.length);
	});

	geometry.boundingSphere = new THREE.Sphere(new Vector3(0, 0, 0), 1010);
	var material = new THREE.MeshBasicMaterial({
		vertexColors: THREE.VertexColors,
	});
	var renderObject = new THREE.Mesh(geometry, material);

	action.provideResult({
		geometry: geometry,
		material: material,
		renderObject: renderObject,
	});
}

function buildAirCurrentsRenderObject(corners, action) {
	var geometry = new THREE.Geometry();

	var i = 0;
	action.executeSubaction(function (action) {
		if (i >= corners.length) return;

		var corner = corners[i];
		//buildArrow(geometry, position, direction, normal, baseWidth, color)
		buildArrow(geometry, corner.position.clone().multiplyScalar(1.002), corner.airCurrent.clone().multiplyScalar(0.5), corner.position.clone().normalize(), Math.min(corner.airCurrent.length(), 4));

		++i;

		action.loop(i / corners.length);
	});

	geometry.boundingSphere = new THREE.Sphere(new Vector3(0, 0, 0), 1010);
	//var material = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xFFFFFF), });
	var material = new THREE.MeshPhongMaterial({
		color: new THREE.Color(0xFFFFFF),
		opacity: 0.5,
		transparent: true,
	});
	var renderObject = new THREE.Mesh(geometry, material);

	action.provideResult({
		geometry: geometry,
		material: material,
		renderObject: renderObject,
	});
}

function buildRiversRenderObject(tiles, action) {
	var geometry = new THREE.Geometry();
	var i = 0;
	action.executeSubaction(function (action) {
		if (i >= tiles.length) return;
		var tile = tiles[i];
		if (tile.river) {
			var tile2 = tile.drain;
			var riverCurrent = new Vector3(0, 0, 0);
			riverCurrent.add(tile2.averagePosition.clone().add(tile.averagePosition.clone().multiplyScalar(-1)));
			buildArrow(geometry, tile.averagePosition.clone().multiplyScalar(1.002), riverCurrent, tile.averagePosition.clone().normalize(), 5, (tile.elevation > tile2.elevation * 1.1) ? new THREE.Color(0xFFFFFF) : new THREE.Color(0x003F85));//tiles[i].elevation = tiles[i].tiles[tiles[i].tiles.length - 1].elevation * 1.05
		}
		++i;

		action.loop(i / tiles.length);
	});

	geometry.boundingSphere = new THREE.Sphere(new Vector3(0, 0, 0), 1010);
	var material = new THREE.MeshBasicMaterial({
		color: new THREE.Color(0x234DD7)
	});
	//var material = new THREE.MeshPhongMaterial({	color: new THREE.Color(0x00AAFF),
	//							opacity: 1,
	//						shininess: 100});
	var renderObject = new THREE.Mesh(geometry, material);

	action.provideResult({
		geometry: geometry,
		material: material,
		renderObject: renderObject,
	});
}

function buildArrow(geometry, position, direction, normal, baseWidth, color) {
	if (direction.lengthSq() === 0) return;
	var sideOffset = direction.clone().cross(normal).setLength(baseWidth / 2);
	var baseIndex = geometry.vertices.length;
	geometry.vertices.push(position.clone().add(sideOffset), position.clone().add(direction), position.clone().sub(sideOffset));
	geometry.faces.push(new THREE.Face3(baseIndex, baseIndex + 2, baseIndex + 1, normal, [color, color, color]));
}

function buildTileWedge(f, b, s, t, n) {
	f.push(new THREE.Face3(b + s + 2, b + t + 2, b, n));
	f.push(new THREE.Face3(b + s + 1, b + t + 1, b + t + 2, n));
	f.push(new THREE.Face3(b + s + 1, b + t + 2, b + s + 2, n));
}

function buildTileWedgeColors(f, c, bc) {
	f.push([c, c, c]); //colors inner wedge with gradient from c to c
	f.push([bc, bc, c]); //colors half of the border wedge, gradient from c to bc
	f.push([bc, c, c]); //colors other half of the border wedge, gradient from c to bc
}

function buildTileWedgeColors1(f, c, d, bc) //used for snow cap effect
{
	f.push([c, c, d]); //colors inner wedge with gradient from c to c
	f.push([bc, bc, c]); //colors half of the border wedge, gradient from c to bc
	f.push([bc, c, c]); //colors other half of the border wedge, gradient from c to bc
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

function SteppedAction(progressUpdater, unbrokenInterval, sleepInterval) {
	this.callStack = null;
	this.subactions = [];
	this.finalizers = [];
	this.unbrokenInterval = (typeof (unbrokenInterval) === "number" && unbrokenInterval >= 0) ? unbrokenInterval : 16;
	this.sleepInterval = (typeof (sleepInterval) === "number" && sleepInterval >= 0) ? sleepInterval : 0;
	this.loopAction = false;
	this.started = false;
	this.canceled = false;
	this.completed = false;
	this.intervalIteration = 0; //number of times an unbroken interval has been completed
	this.stepIteration = 0; //number of times any of the stepper functions have been called
	this.intervalStepIteration = null; //number of times any of the stepper functions have been called during the current interval
	this.intervalStartTime = null; //begin time of the current interval
	this.intervalEndTime = null; //end time of the current interval
	this.progressUpdater = (typeof (progressUpdater) === "function") ? progressUpdater : null;
}

SteppedAction.prototype.execute = function SteppedAction_execute() {
	if (!this.canceled && !this.completed && this.callStack === null && this.started === false) {
		this.started = true;
		if (this.subactions.length > 0) {
			this.beginSubactions(0, 1);
			if (this.progressUpdater !== null) this.progressUpdater(this);
			window.setTimeout(this.step.bind(this), this.sleepInterval);
		} else {
			this.completed = true;
		}
	}
	return this;
};

SteppedAction.prototype.step = function SteppedAction_step() {
	this.intervalStartTime = Date.now();
	this.intervalEndTime = this.intervalStartTime + this.unbrokenInterval;
	this.intervalStepIteration = 0;
	while (Date.now() < this.intervalEndTime && !this.canceled && !this.completed) {
		var action = this.callStack.actions[this.callStack.index];

		this.callStack.loop = false;
		action.action(this);
		this.intervalStepIteration += 1;
		this.stepIteration += 1;

		if (this.subactions.length > 0) {
			this.beginSubactions(this.getProgress(), (this.callStack.loop) ? 0 : (1 - this.callStack.loopProgress) * action.proportion / this.callStack.proportionSum * this.callStack.parentProgressRange);
		} else {
			while (this.callStack !== null && this.callStack.loop === false && this.callStack.index === this.callStack.actions.length - 1) {
				for (var i = 0; i < this.callStack.finalizers.length; ++i) {
					this.callStack.finalizers[i](this);
				}
				this.callStack = this.callStack.parent;
			}
			if (this.callStack !== null) {
				if (this.callStack.loop === false) {
					this.callStack.loopProgress = 0;
					this.callStack.index += 1;
				}
			} else {
				this.completed = true;
			}
		}
	}
	this.intervalStartTime = null;
	this.intervalEndTime = null;
	this.intervalStepIteration = null;

	if (this.progressUpdater !== null) this.progressUpdater(this);

	this.intervalIteration += 1;
	if (this.canceled) {
		while (this.callStack !== null) {
			for (var i = 0; i < this.callStack.finalizers.length; ++i) {
				this.callStack.finalizers[i](this);
			}
			this.callStack = this.callStack.parent;
		}
	} else if (!this.completed) {
		window.setTimeout(this.step.bind(this), this.sleepInterval);
	}
};

SteppedAction.prototype.beginSubactions = function (parentProgress, parentProgressRange) {
	this.callStack = {
		actions: this.subactions,
		finalizers: this.finalizers,
		proportionSum: accumulateArray(this.subactions, 0, function (sum, subaction) {
			return sum + subaction.proportion;
		}),
		index: 0,
		loop: false,
		loopProgress: 0,
		parent: this.callStack,
		parentProgress: parentProgress,
		parentProgressRange: parentProgressRange,
	};
	this.subactions = [];
	this.finalizers = [];
};

SteppedAction.prototype.cancel = function SteppedAction_cancel() {
	this.canceled = true;
};

SteppedAction.prototype.provideResult = function SteppedAction_provideResult(resultProvider) {
	this.callStack.resultProvider = resultProvider;
};

SteppedAction.prototype.loop = function SteppedAction_loop(progress) {
	this.callStack.loop = true;
	if (typeof (progress) === "number" && progress >= 0 && progress < 1) {
		this.callStack.loopProgress = progress;
	}
};

SteppedAction.prototype.executeSubaction = function SteppedAction_executeSubaction(subaction, proportion, name) {
	proportion = (typeof (proportion) === "number" && proportion >= 0) ? proportion : 1;
	this.subactions.push({
		action: subaction,
		proportion: proportion,
		name: name
	});
	return this;
};

SteppedAction.prototype.getResult = function SteppedAction_getResult(recipient) {
	this.subactions.push({
		action: function (action) {
			var resultProvider = action.callStack.resultProvider;
			var resultProviderType = typeof (resultProvider);
			if (resultProviderType === "function")
				recipient(resultProvider());
			else if (resultProviderType !== "undefined")
				recipient(resultProvider);
			else
				recipient();
		},
		proportion: 0,
	});
	return this;
};

SteppedAction.prototype.finalize = function SteppedAction_finalize(finalizer) {
	this.finalizers.push(finalizer);
	return this;
};

SteppedAction.prototype.getTimeRemainingInInterval = function SteppedAction_getTimeRemainingInInterval() {
	if (this.intervalEndTime !== null) {
		return Math.max(0, this.intervalEndTime - Date.now());
	} else {
		return 0;
	}
};

SteppedAction.prototype.getProgress = function SteppedAction_getProgress() {
	if (this.callStack !== null) {
		if (this.callStack.proportionSum === 0) return this.callStack.parentProgress;

		var currentProportionSum = 0;
		for (var i = 0; i < this.callStack.index; ++i) {
			currentProportionSum += this.callStack.actions[i].proportion;
		}
		currentProportionSum += this.callStack.loopProgress * this.callStack.actions[this.callStack.index].proportion;
		return this.callStack.parentProgress + currentProportionSum / this.callStack.proportionSum * this.callStack.parentProgressRange;
	} else {
		return this.completed ? 1 : 0;
	}
};

SteppedAction.prototype.getCurrentActionName = function SteppedAction_getCurrentActionName() {
	var callStack = this.callStack;
	while (callStack !== null) {
		var action = callStack.actions[callStack.index];
		if (typeof (action.name) === "string") return action.name;
		callStack = callStack.parent;
	}

	return "";
};

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

function render() {
	var currentRenderFrameTime = Date.now();
	var frameDuration = lastRenderFrameTime !== null ? (currentRenderFrameTime - lastRenderFrameTime) * 0.001 : 0;

	var cameraNeedsUpdated = false;
	if (zoomAnimationStartTime !== null) {
		if (zoomAnimationStartTime + zoomAnimationDuration <= currentRenderFrameTime) {
			zoom = zoomAnimationEndValue;
			zoomAnimationStartTime = null;
			zoomAnimationDuration = null;
			zoomAnimationStartValue = null;
			zoomAnimationEndValue = null;
		} else {
			zoomAnimationProgress = (currentRenderFrameTime - zoomAnimationStartTime) / zoomAnimationDuration;
			zoom = (zoomAnimationEndValue - zoomAnimationStartValue) * zoomAnimationProgress + zoomAnimationStartValue;
		}
		cameraNeedsUpdated = true;
	}

	var cameraZoomDelta = getZoomDelta();
	if (frameDuration > 0 && cameraZoomDelta !== 0) {
		zoom = Math.max(0, Math.min(zoom + frameDuration * cameraZoomDelta * 0.5, 1));
		cameraNeedsUpdated = true;
	}

	var cameraLatitudeDelta = getLatitudeDelta();
	if (frameDuration > 0 && cameraLatitudeDelta !== 0) {
		cameraLatitude += frameDuration * -cameraLatitudeDelta * Math.PI * (zoom * 0.5 + (1 - zoom) * 1 / 20);
		cameraLatitude = Math.max(-Math.PI * 0.49, Math.min(cameraLatitude, Math.PI * 0.49));
		cameraNeedsUpdated = true;
	}

	var cameraLongitudeDelta = getLongitudeDelta();
	if (frameDuration > 0 && cameraLongitudeDelta !== 0) {
		cameraLongitude += frameDuration * cameraLongitudeDelta * Math.PI * (zoom * Math.PI / 8 + (1 - zoom) / (20 * Math.max(Math.cos(cameraLatitude), 0.1)));
		cameraLongitude = cameraLongitude - Math.floor(cameraLongitude / (Math.PI * 2)) * Math.PI * 2;
		cameraNeedsUpdated = true;
	}

	if (cameraNeedsUpdated) updateCamera();

	var sunTime = Math.PI * 2 * currentRenderFrameTime / 60000 + sunTimeOffset;
	directionalLight.position.set(Math.cos(sunTime), 0, Math.sin(sunTime)).normalize();

	requestAnimationFrame(render);
	renderer.render(scene, camera);

	lastRenderFrameTime = currentRenderFrameTime;
}

function resizeHandler() {
	updateCamera();
	renderer.setSize(window.innerWidth, window.innerHeight);
}

function resetCamera() {
	zoom = 1.0;
	zoomAnimationStartTime = null;
	zoomAnimationDuration = null;
	zoomAnimationStartValue = null;
	zoomAnimationEndValue = null;
	cameraLatitude = 0;
	cameraLongitude = 0;
}

function updateCamera() {
	camera.aspect = window.innerWidth / window.innerHeight;

	var transformation = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(cameraLatitude, cameraLongitude, 0, "YXZ"));
	camera.position.set(0, -50, 1050);
	camera.position.lerp(new Vector3(0, 0, 2000), Math.pow(zoom, 2.0));
	camera.position.applyMatrix4(transformation);
	camera.up.set(0, 1, 0);
	camera.up.applyMatrix4(transformation);
	camera.lookAt(new Vector3(0, 0, 1000).applyMatrix4(transformation));
	camera.updateProjectionMatrix();
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

function createTileSelectRenderObject(tile, color) {
    var outerColor = new THREE.Color(0x000000);
    var innerColor = color || new THREE.Color(0xFFFFFF);
    var geometry = new THREE.Geometry();
    geometry.vertices.push(new THREE.Vector3().lerp(tile.averagePosition, (1+Math.abs(tile.elevation)/10)));//1.07
    for (var i = 0; i < tile.corners.length; ++i) {
        geometry.vertices.push(new THREE.Vector3().lerp(tile.corners[i].position, 1.0005));
        geometry.faces.push(new THREE.Face3(i + 1, (i + 1) % tile.corners.length + 1, 0, tile.normal, [outerColor, outerColor, innerColor]));
    }
    geometry.boundingSphere = tile.boundingSphere.clone();
    var material = new THREE.MeshLambertMaterial({ vertexColors: THREE.VertexColors });
    material.transparent = true;
    material.opacity = 0.5;
    material.polygonOffset = true;
    material.polygonOffsetFactor = -2;
    material.polygonOffsetUnits = -2;
    return new THREE.Mesh(geometry, material);
}

function selectTile(tile) {
    if (tileSelection !== null) {
        if (tileSelection.tile === tile) return;
        deselectTile();
    }

    // Initialize tileSelection with an empty array for upstream render objects
    tileSelection = { tile: tile, renderObject: createTileSelectRenderObject(tile), xstreamRenderObjects: [] };

    // Highlight the selected tile
    planet.renderData.surface.renderObject.add(tileSelection.renderObject);

	//console.log(tile.id,'elevation:',tile.elevation,'neighbors elevation:',tile.tiles.map(n => n.elevation));
    // Highlight all tiles in the upstream array
    if (tile.upstream || tile.downstream) {
		for (t of tile.upstream) {
        	var xstreamRenderObject = createTileSelectRenderObject(t, new THREE.Color(0x00FF00)); // Green color for upstream tiles
			planet.renderData.surface.renderObject.add(xstreamRenderObject);
        	tileSelection.xstreamRenderObjects.push(xstreamRenderObject);
    	};
    	for (t of tile.downstream) {
        var xstreamRenderObject = createTileSelectRenderObject(t, new THREE.Color(0xFF0000)); // Red color for downstream tiles
		planet.renderData.surface.renderObject.add(xstreamRenderObject);
        tileSelection.xstreamRenderObjects.push(xstreamRenderObject);
    	};
	};
}

function deselectTile() {
    if (tileSelection !== null) {
        planet.renderData.surface.renderObject.remove(tileSelection.renderObject);
        if (tileSelection.xstreamRenderObjects) {
            tileSelection.xstreamRenderObjects.forEach(renderObject => {
                planet.renderData.surface.renderObject.remove(renderObject);
            });
        }
        tileSelection = { tile: null, renderObject: null, xstreamRenderObjects: [] };
    }
}

function isCyclic(obj) {
	var keys = [];
	var stack = [];
	var stackSet = new Set();
	var detected = false;

	function detect(obj, key) {
		if (obj && typeof obj != 'object') {
			return;
		}

		if (stackSet.has(obj)) { // it's cyclic! Print the object and its locations.
			var oldindex = stack.indexOf(obj);
			var l1 = keys.join('.') + '.' + key;
			var l2 = keys.slice(0, oldindex + 1).join('.');
			console.log('CIRCULAR: ' + l1 + ' = ' + l2 + ' = ' + obj);
			console.log(obj);
			detected = true;
			return;
		}

		keys.push(key);
		stack.push(obj);
		stackSet.add(obj);
		for (var k in obj) { //dive on the object's children
			if (Object.prototype.hasOwnProperty.call(obj, k)) {
				detect(obj[k], k);
			}
		}

		keys.pop();
		stack.pop();
		stackSet.delete(obj);
		return;
	}

	detect(obj, 'obj');
	return detected;
}

function uncursivePlanet(planetTop) {
	var newPlan = planetTop;

	for (i = 0; i < planetTop.tiles.length; i++) {
		delete newPlan.tiles[i].boundingSphere;
		delete newPlan.tiles[i].plate;
		delete newPlan.tiles[i].plateMovement;
		delete newPlan.tiles[i].averagePosition;
		delete newPlan.tiles[i].maxslope;
		delete newPlan.tiles[i].maxDownSlope;
		delete newPlan.tiles[i].maxk;
		delete newPlan.tiles[i].position;
		delete newPlan.tiles[i].airCurrent;
		delete newPlan.tiles[i].area;
		delete newPlan.tiles[i].normal;
		delete newPlan.tiles[i].biome;
		newPlan.tiles[i].elevation = Math.round(planetTop.tiles[i].elevation * 1000) / 1000;
		newPlan.tiles[i].temperature = Math.round(planetTop.tiles[i].temperature * 1000) / 1000;
		newPlan.tiles[i].moisture = Math.round(planetTop.tiles[i].moisture * 1000) / 1000;
		for (j = 0; j < planetTop.tiles[i].tiles.length; j++) {
			newPlan.tiles[i].tiles[j] = planetTop.tiles[i].tiles[j].id;
		}
		//for (j = 0; j < planetTop.tiles[i].plate.tiles.length; j++) {
		//	//console.log(planetTop.tiles[i]);
		//	//console.log(j);
		//	//console.log(planetTop.tiles[i].plate.tiles[j]);
		//	if (typeof planetTop.tiles[i].plate.tiles[j] !== 'undefined') {newPlan.tiles[i].plate.tiles[j] = planetTop.tiles[i].plate.tiles[j].id}
		//}

		delete newPlan.tiles[i].tiles;

		newPlan.tiles[i].wind = {
			"x": 0,
			"y": 0,
			"z": 0
		};
		for (j = 0; j < planetTop.tiles[i].corners.length; j++) {
			newPlan.tiles[i].wind.x += planetTop.tiles[i].corners[j].airCurrent.x
			newPlan.tiles[i].wind.y += planetTop.tiles[i].corners[j].airCurrent.y
			newPlan.tiles[i].wind.z += planetTop.tiles[i].corners[j].airCurrent.z
			newPlan.tiles[i].corners[j] = planetTop.tiles[i].corners[j].id;
		}
		newPlan.tiles[i].wind.x = Math.round((newPlan.tiles[i].wind.x / planetTop.tiles[i].corners.length) * 1000) / 1000
		newPlan.tiles[i].wind.y = Math.round((newPlan.tiles[i].wind.y / planetTop.tiles[i].corners.length) * 1000) / 1000
		newPlan.tiles[i].wind.z = Math.round((newPlan.tiles[i].wind.z / planetTop.tiles[i].corners.length) * 1000) / 1000
		for (j = 0; j < planetTop.tiles[i].borders.length; j++) {
			newPlan.tiles[i].borders[j] = planetTop.tiles[i].borders[j].id;
		}
		delete newPlan.tiles[i].borders;
	}
	for (i = 0; i < planetTop.corners.length; i++) {
		delete newPlan.corners[i].distanceToPlateBoundary;
		delete newPlan.corners[i].distanceToPlateRoot;
		delete newPlan.corners[i].airCurrentSpeed;
		delete newPlan.corners[i].airCurrentOutflows;
		delete newPlan.corners[i].area;
		delete newPlan.corners[i].elevation;
		delete newPlan.corners[i].temperature;
		delete newPlan.corners[i].moisture;
		delete newPlan.corners[i].betweenPlates;
		delete newPlan.corners[i].pressure;
		delete newPlan.corners[i].shear;
		delete newPlan.corners[i].airCurrent;
		for (j = 0; j < planetTop.corners[i].tiles.length; j++) {
			newPlan.corners[i].tiles[j] = planetTop.corners[i].tiles[j].id;
		}
		delete newPlan.corners[i].tiles;

		for (j = 0; j < planetTop.corners[i].corners.length; j++) {
			newPlan.corners[i].corners[j] = planetTop.corners[i].corners[j].id;
		}

		for (j = 0; j < planetTop.corners[i].borders.length; j++) {
			newPlan.corners[i].borders[j] = planetTop.corners[i].borders[j].id;
		}
		delete newPlan.corners[i].borders;
	}
	for (i = 0; i < planetTop.borders.length; i++) {
		delete newPlan.borders[i].midpoint;
		delete newPlan.borders[i].betweenPlates;
		for (j = 0; j < planetTop.borders[i].tiles.length; j++) {
			newPlan.borders[i].tiles[j] = planetTop.borders[i].tiles[j].id;
		}
		delete newPlan.borders[i].tiles;
		for (j = 0; j < planetTop.borders[i].corners.length; j++) {
			newPlan.borders[i].corners[j] = planetTop.borders[i].corners[j].id;
		}
		for (j = 0; j < planetTop.borders[i].borders.length; j++) {
			newPlan.borders[i].borders[j] = planetTop.borders[i].borders[j].id;
		}
		delete newPlan.borders[i].borders;
	}
	//console.log(newPlan);
	return newPlan

}

function download(content, fileName, contentType) {
	var a = document.createElement("a");
	var file = new Blob([content], {
		type: contentType
	});
	a.href = URL.createObjectURL(file);
	a.download = fileName;
	a.click();
}

function colorChange(color) {
	console.log(geometry);
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
		//saveToFileSystem(planet);
		//saveToFileSystem(serializePlanetMesh(planet.mesh, "function getPregeneratedPlanetMesh() { return ", "; }\n"));
		//console.log(isCyclic(planet.topology.tiles[0]));
		//download(JSON.stringify(breakCyclesInBFS(planet,)), 'json_planet.txt', 'application/json');

		//uncursivePlanet(planet.topology);
		//download(JSON.stringify(uncursivePlanet(planet.topology)), 'json_planet.js', 'application/json');

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

function setSurfaceRenderMode(mode, force) {
	if (mode !== surfaceRenderMode || force === true) {
		if (mode !== "wheat" && mode !== "rice" && mode !== "fish" && mode !== "corn" && mode !== "calorie" && mode !== "shore" && mode !== "shoreA" && mode !== "shoreZ" && mode !== "port") {
			$("#surfaceDisplayList>button").removeClass("toggled");
			ui.surfaceDisplayButtons[mode].addClass("toggled");
		}

		surfaceRenderMode = mode;

		if (!planet) return;

		var colors;
		if (mode === "terrain") colors = planet.renderData.surface.terrainColors;
		else if (mode === "plates") colors = planet.renderData.surface.plateColors;
		else if (mode === "elevation") colors = planet.renderData.surface.elevationColors;
		else if (mode === "temperature") colors = planet.renderData.surface.temperatureColors;
		else if (mode === "moisture") colors = planet.renderData.surface.moistureColors;
		else if (mode === "wheat") colors = planet.renderData.surface.wheatColors;
		else if (mode === "corn") colors = planet.renderData.surface.cornColors;
		else if (mode === "rice") colors = planet.renderData.surface.riceColors;
		else if (mode === "fish") colors = planet.renderData.surface.fishColors;
		else if (mode === "calorie") colors = planet.renderData.surface.calorieColors;
		else if (mode === "port") colors = planet.renderData.surface.portColors;
		else if (mode === "shore") colors = planet.renderData.surface.shoreColors;
		else if (mode === "shoreA") colors = planet.renderData.surface.shoreAColors;
		else if (mode === "shoreZ") colors = planet.renderData.surface.shoreZColors;
		else return;

		var faces = planet.renderData.surface.geometry.faces;
		for (var i = 0; i < faces.length; ++i) faces[i].vertexColors = colors[i];

		planet.renderData.surface.geometry.colorsNeedUpdate = true;
	}
}

function showHideSunlight(show) {
	if (typeof (show) === "boolean") renderSunlight = show;
	else renderSunlight = !renderSunlight;
	if (renderSunlight) ui.showSunlightButton.addClass("toggled");
	if (!renderSunlight) ui.showSunlightButton.removeClass("toggled");

	if (!planet) return;

	var material = planet.renderData.surface.material;
	if (renderSunlight) {
		material.color = new THREE.Color(0xFFFFBB);
		material.ambient = new THREE.Color(0x243D53); //
	} else {
		material.color = new THREE.Color(0x000000);
		material.ambient = new THREE.Color(0xFFFFFF);
	}
	material.needsUpdate = true;
}

function showHidePlateBoundaries(show) {
	if (typeof (show) === "boolean") renderPlateBoundaries = show;
	else renderPlateBoundaries = !renderPlateBoundaries;
	if (renderPlateBoundaries) ui.showPlateBoundariesButton.addClass("toggled");
	if (!renderPlateBoundaries) ui.showPlateBoundariesButton.removeClass("toggled");

	if (!planet) return;

	if (renderPlateBoundaries) planet.renderData.surface.renderObject.add(planet.renderData.plateBoundaries.renderObject);
	else planet.renderData.surface.renderObject.remove(planet.renderData.plateBoundaries.renderObject);
}



function showHidePlateMovements(show) {
	if (typeof (show) === "boolean") renderPlateMovements = show;
	else renderPlateMovements = !renderPlateMovements;
	if (renderPlateMovements) ui.showPlateMovementsButton.addClass("toggled");
	if (!renderPlateMovements) ui.showPlateMovementsButton.removeClass("toggled");

	if (!planet) return;

	if (renderPlateMovements) planet.renderData.surface.renderObject.add(planet.renderData.plateMovements.renderObject);
	else planet.renderData.surface.renderObject.remove(planet.renderData.plateMovements.renderObject);

}

function showHideAirCurrents(show) {
	if (typeof (show) === "boolean") renderAirCurrents = show;
	else renderAirCurrents = !renderAirCurrents;
	if (renderAirCurrents) ui.showAirCurrentsButton.addClass("toggled");
	if (!renderAirCurrents) ui.showAirCurrentsButton.removeClass("toggled");

	if (!planet) return;

	if (renderAirCurrents) planet.renderData.surface.renderObject.add(planet.renderData.airCurrents.renderObject);
	else planet.renderData.surface.renderObject.remove(planet.renderData.airCurrents.renderObject);
}

function showHideRivers(show) {
	if (typeof (show) === "boolean") renderRivers = show;
	else renderRivers = !renderRivers;
	//if (renderRivers) ui.showAirCurrentsButton.addClass("toggled");
	//if (!renderRivers) ui.showAirCurrentsButton.removeClass("toggled");

	if (!planet) return;

	if (renderRivers) planet.renderData.surface.renderObject.add(planet.renderData.Rivers.renderObject);
	else planet.renderData.surface.renderObject.remove(planet.renderData.Rivers.renderObject);
}
var renderEdgeCosts = false;

function showHideEdgeCosts(show) {
    if (typeof (show) === "boolean") renderEdgeCosts = show;
    else renderEdgeCosts = !renderEdgeCosts;
    //if (renderEdgeCosts) ui.showEdgeCostsButton.addClass("toggled");
    //if (!renderEdgeCosts) ui.showEdgeCostsButton.removeClass("toggled");
    if (!planet) return;
    if (renderEdgeCosts) scene.add(planet.edgeCostsRenderObject);
    else scene.remove(planet.edgeCostsRenderObject);
}

function buildEdgeCostsRenderObject(edges) {
    var geometry = new THREE.Geometry();
    var minCost = 0.2 //Math.min(...edges.map(edge => edge.cost));
    var maxCost = 50 //Math.max(...edges.map(edge => edge.cost));
	var portCost = 100
	var mincolor = new THREE.Color(0xFFFFBB);
	var maxcolor = new THREE.Color(0xFFFF00);

    for (let edge of edges) {
        var fromVertex = edge.from.position;
        var toVertex = edge.to.position;
        var midpoint = fromVertex.clone().add(toVertex).multiplyScalar(0.5);

        // Color for the edge cost
        var normalizedCostFromTo = (edge.cost - minCost) / (maxCost - minCost);
        var colorFromTo = new THREE.Color(0x00FF00).lerp(new THREE.Color(0xFF0000), normalizedCostFromTo)
		if (edge.cost<=0) {colorFromTo = new THREE.Color(0xFF00FF)}
        var normalizedCostToFrom = (edge.reverseCost - minCost) / (maxCost - minCost);
        var colorToFrom = new THREE.Color(0x00FF00).lerp(new THREE.Color(0xFF0000), normalizedCostToFrom)
		if (edge.reverseCost<=0) {colorFromTo = new THREE.Color(0xFF00FF)}
        //colorFromTo.setHSL((1 - normalizedCostFromTo) * 0.6, 1.0, 0.5); // Gradient from blue (0.6) to yellow (0.0)

        // Arrow from fromVertex to midpoint
        geometry.vertices.push(fromVertex, midpoint);
        geometry.colors.push(colorFromTo, colorFromTo);
        geometry.vertices.push(toVertex, midpoint);
        geometry.colors.push(colorToFrom, colorToFrom);

        // Arrow from toVertex to midpoint
        //geometry.vertices.push(toVertex, midpoint);
        //geometry.colors.push(colorFromTo, colorFromTo);
    }

    var material = new THREE.LineBasicMaterial({ vertexColors: THREE.VertexColors, linewidth: 1 });
    var renderObject = new THREE.Line(geometry, material, THREE.LinePieces);
    return renderObject;
}

function serializePlanetMesh(mesh, prefix, suffix) {
	var stringPieces = [];

	stringPieces.push(prefix, "{nodes:[");
	for (var i = 0; i < mesh.nodes.length; ++i) {
		var node = mesh.nodes[i];
		stringPieces.push(i !== 0 ? ",\n{p:new THREE.Vector3(" : "\n{p:new THREE.Vector3(", node.p.x.toString(), ",", node.p.y.toString(), ",", node.p.z.toString(), "),e:[", node.e[0].toFixed(0));
		for (var j = 1; j < node.e.length; ++j) stringPieces.push(",", node.e[j].toFixed(0));
		stringPieces.push("],f:[", node.f[0].toFixed(0));
		for (var j = 1; j < node.f.length; ++j) stringPieces.push(",", node.f[j].toFixed(0));
		stringPieces.push("]}");
	}
	stringPieces.push("\n],edges:[");
	for (var i = 0; i < mesh.edges.length; ++i) {
		var edge = mesh.edges[i];
		stringPieces.push(i !== 0 ? ",\n{n:[" : "\n{n:[", edge.n[0].toFixed(0), ",", edge.n[1].toFixed(0), "],f:[", edge.f[0].toFixed(0), ",", edge.f[1].toFixed(0), "]}");
	}
	stringPieces.push("\n],faces:[");
	for (var i = 0; i < mesh.faces.length; ++i) {
		var face = mesh.faces[i];
		stringPieces.push(i !== 0 ? ",\n{n:[" : "\n{n:[", face.n[0].toFixed(0), ",", face.n[1].toFixed(0), ",", face.n[2].toFixed(0), "],e:[", face.e[0].toFixed(0), ",", face.e[1].toFixed(0), ",", face.e[2].toFixed(0), "]}");
	}
	stringPieces.push("\n]}", suffix);

	return stringPieces.join("");
}

function Corner(id, position, cornerCount, borderCount, tileCount) {
	this.id = id;
	this.position = position;
	this.corners = new Array(cornerCount);
	this.borders = new Array(borderCount);
	this.tiles = new Array(tileCount);
}

Corner.prototype.vectorTo = function Corner_vectorTo(corner) {
	return corner.position.clone().sub(this.position);
};

Corner.prototype.toString = function Corner_toString() {
	return "Corner " + this.id.toFixed(0) + " < " + this.position.x.toFixed(0) + ", " + this.position.y.toFixed(0) + ", " + this.position.z.toFixed(0) + " >";
};

function Border(id, cornerCount, borderCount, tileCount) {
	this.id = id;
	this.corners = new Array(cornerCount);
	this.borders = new Array(borderCount);
	this.tiles = new Array(tileCount);
}

Border.prototype.oppositeCorner = function Border_oppositeCorner(corner) {
	return (this.corners[0] === corner) ? this.corners[1] : this.corners[0];
};

Border.prototype.oppositeTile = function Border_oppositeTile(tile) {
	return (this.tiles[0] === tile) ? this.tiles[1] : this.tiles[0];
};

Border.prototype.length = function Border_length() {
	return this.corners[0].position.distanceTo(this.corners[1].position);
};

Border.prototype.isLandBoundary = function Border_isLandBoundary() {
	return (this.tiles[0].elevation > 0) !== (this.tiles[1].elevation > 0);
};

Border.prototype.toString = function Border_toString() {
	return "Border " + this.id.toFixed(0);
};

function Tile(id, position, cornerCount, borderCount, tileCount) {
	this.id = id;
	this.position = position;
	this.corners = new Array(cornerCount);
	this.borders = new Array(borderCount);
	this.tiles = new Array(tileCount);
}

Tile.prototype.intersectRay = function Tile_intersectRay(ray) {
	if (!intersectRayWithSphere(ray, this.boundingSphere)) return false;

	var surface = new THREE.Plane().setFromNormalAndCoplanarPoint(this.normal, this.averagePosition);
	if (surface.distanceToPoint(ray.origin) <= 0) return false;

	var denominator = surface.normal.dot(ray.direction);
	if (denominator === 0) return false;

	var t = -(ray.origin.dot(surface.normal) + surface.constant) / denominator;
	var point = ray.direction.clone().multiplyScalar(t).add(ray.origin);

	var origin = new Vector3(0, 0, 0);
	for (var i = 0; i < this.corners.length; ++i) {
		var j = (i + 1) % this.corners.length;
		var side = new THREE.Plane().setFromCoplanarPoints(this.corners[j].position, this.corners[i].position, origin);

		if (side.distanceToPoint(point) < 0) return false;
	}

	return true;
};

Tile.prototype.toString = function Tile_toString() {
	return "Tile " + this.id.toFixed(0) + " (" + this.tiles.length.toFixed(0) + " Neighbors) < " + this.position.x.toFixed(0) + ", " + this.position.y.toFixed(0) + ", " + this.position.z.toFixed(0) + " >";
};

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

function Signal() {
	this.nextToken = 1;
	this.listeners = {};
}

Signal.prototype.addListener = function Signal_addListener(callback, token) {
	if (typeof (token) !== "string") {
		token = this.nextToken.toFixed(0);
		this.nextToken += 1;
	}
	this.listeners[token] = callback;
};

Signal.prototype.removeListener = function Signal_removeListener(token) {
	delete this.listeners[token];
};

Signal.prototype.fire = function Signal_fire() {
	for (var key in this.listeners) {
		if (this.listeners.hasOwnProperty(key)) {
			this.listeners[key].apply(null, arguments);
		}
	}
};

function XorShift128(x, y, z, w) {
	this.x = (x ? x >>> 0 : 123456789);
	this.y = (y ? y >>> 0 : 362436069);
	this.z = (z ? z >>> 0 : 521288629);
	this.w = (w ? w >>> 0 : 88675123);
}

XorShift128.prototype.next = function XorShift128_next() {
	var t = this.x ^ (this.x << 11) & 0x7FFFFFFF;
	this.x = this.y;
	this.y = this.z;
	this.z = this.w;
	this.w = (this.w ^ (this.w >> 19)) ^ (t ^ (t >> 8));
	return this.w;
};

XorShift128.prototype.unit = function XorShift128_unit() {
	return this.next() / 0x80000000;
};

XorShift128.prototype.unitInclusive = function XorShift128_unitInclusive() {
	return this.next() / 0x7FFFFFFF;
};

XorShift128.prototype.integer = function XorShift128_integer(min, max) {
	return this.integerExclusive(min, max + 1);
};

XorShift128.prototype.integerExclusive = function XorShift128_integerExclusive(min, max) {
	min = Math.floor(min);
	max = Math.floor(max);
	return Math.floor(this.unit() * (max - min)) + min;
};

XorShift128.prototype.real = function XorShift128_real(min, max) {
	return this.unit() * (max - min) + min;
};

XorShift128.prototype.realInclusive = function XorShift128_realInclusive(min, max) {
	return this.unitInclusive() * (max - min) + min;
};

XorShift128.prototype.reseed = function XorShift128_reseed(x, y, z, w) {
	this.x = (x ? x >>> 0 : 123456789);
	this.y = (y ? y >>> 0 : 362436069);
	this.z = (z ? z >>> 0 : 521288629);
	this.w = (w ? w >>> 0 : 88675123);
};

function saveToFileSystem(content) {
	var requestFileSystem = window.requestFileSystem || window.webkitRequestFileSystem;
	requestFileSystem(window.TEMPORARY, content.length,
		function (fs) {
			fs.root.getFile("planetMesh.js", {
				create: true
			},
				function (fileEntry) {
					fileEntry.createWriter(
						function (fileWriter) {
							fileWriter.addEventListener("writeend",
								function () {
									$("body").append("<a href=\"" + fileEntry.toURL() + "\" download=\"planetMesh.js\" target=\"_blank\">Mesh Data</a>");
									$("body>a").focus();
								}, false);

							fileWriter.write(new Blob([content]));
							console.log("wrnb(c)");
						},
						function (error) { });
				},
				function (error) { });
		},
		function (error) { });
}

function slerp(p0, p1, t) {
	var omega = Math.acos(p0.dot(p1));
	return p0.clone().multiplyScalar(Math.sin((1 - t) * omega)).add(p1.clone().multiplyScalar(Math.sin(t * omega))).divideScalar(Math.sin(omega));
}

function randomUnitVector(random) {
	var theta = random.real(0, Math.PI * 2);
	var phi = Math.acos(random.realInclusive(-1, 1));
	var sinPhi = Math.sin(phi);
	return new Vector3(
		Math.cos(theta) * sinPhi,
		Math.sin(theta) * sinPhi,
		Math.cos(phi));
}

function randomQuaternion(random) {
	var theta = random.real(0, Math.PI * 2);
	var phi = Math.acos(random.realInclusive(-1, 1));
	var sinPhi = Math.sin(phi);
	var gamma = random.real(0, Math.PI * 2);
	var sinGamma = Math.sin(gamma);
	return new Quaternion(
		Math.cos(theta) * sinPhi * sinGamma,
		Math.sin(theta) * sinPhi * sinGamma,
		Math.cos(phi) * sinGamma,
		Math.cos(gamma));
}

function intersectRayWithSphere(ray, sphere) {
	var v1 = sphere.center.clone().sub(ray.origin);
	var v2 = v1.clone().projectOnVector(ray.direction);
	var d = v1.distanceTo(v2);
	return (d <= sphere.radius);
}

function calculateTriangleArea(pa, pb, pc) {
	var vab = new THREE.Vector3().subVectors(pb, pa);
	var vac = new THREE.Vector3().subVectors(pc, pa);
	var faceNormal = new THREE.Vector3().crossVectors(vab, vac);
	var vabNormal = new THREE.Vector3().crossVectors(faceNormal, vab).normalize();
	var plane = new THREE.Plane().setFromNormalAndCoplanarPoint(vabNormal, pa);
	var height = plane.distanceToPoint(pc);
	var width = vab.length();
	var area = width * height * 0.5;
	return area;
}

function accumulateArray(array, state, accumulator) {
	for (var i = 0; i < array.length; ++i) {
		state = accumulator(state, array[i]);
	}
	return state;
}

function adjustRange(value, oldMin, oldMax, newMin, newMax) {
	return (value - oldMin) / (oldMax - oldMin) * (newMax - newMin) + newMin;
}

//Adapted from http://stackoverflow.com/a/7616484/3874364
function hashString(s) {
	var hash = 0;
	var length = s.length;
	if (length === 0) return hash;
	for (var i = 0; i < length; ++i) {
		var character = s.charCodeAt(1);
		hash = ((hash << 5) - hash) + character;
		hash |= 0;
	}
	return hash;
}

function sphericalDistance(point1, point2) {
	// Calculate the magnitudes of the vectors
	const magnitude1 = point1.length();
	const magnitude2 = point2.length();

	// Calculate the average magnitude (radius of the sphere)
	const averageRadius = (magnitude1 + magnitude2) / 2;

	// Normalize the vectors to project them onto the sphere
	const normalizedPoint1 = point1.clone().normalize();
	const normalizedPoint2 = point2.clone().normalize();

	// Calculate the angle between the two normalized vectors
	const angle = Math.acos(normalizedPoint1.dot(normalizedPoint2));

	// Calculate the spherical distance
	const distance = averageRadius * angle;
	return distance;
}

function buildGraph(vertices, edges) {
    const graph = createGraph();
    for (let vertex of vertices) {
        graph.addNode(vertex.id);
    }
    for (let edge of edges) {
        graph.addLink(edge.from.id, edge.to.id, { weight: edge.cost });
        graph.addLink(edge.to.id, edge.from.id, { weight: edge.reverseCost });
    }
    return graph;

}

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