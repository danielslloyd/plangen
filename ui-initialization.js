$(document).ready(function onDocumentReady() {
	scene = new THREE.Scene();
	camera = new THREE.PerspectiveCamera(70, 1, 0.2, 2000); //(75, 1, 0.2, 2000)
	renderer = new THREE.WebGLRenderer({
		antialias: true,
		alpha: true
	});
	// Projector removed in r125, using Raycaster directly in click handlers

	// Disable face culling to ensure all faces are visible
	renderer.shadowMap.enabled = false; // Disable shadows for debugging
	renderer.setClearColor(0x000033, 1); // Dark blue background instead of black

	// Add multiple debug lights for better illumination
	var ambientLight = new THREE.AmbientLight(0xFFFFFF, 0.8); // Bright ambient light
	scene.add(ambientLight);

	// Main directional light
	directionalLight = new THREE.DirectionalLight(0xFFFFFF, 0.6);
	directionalLight.position.set(-3, 3, 7).normalize();
	scene.add(directionalLight);
	
	// Additional lights from different angles
	var light2 = new THREE.DirectionalLight(0xFFFFFF, 0.4);
	light2.position.set(3, -3, -7).normalize();
	scene.add(light2);
	
	var light3 = new THREE.DirectionalLight(0xFFFFFF, 0.3);
	light3.position.set(0, 10, 0).normalize();
	scene.add(light3);
	
	var light4 = new THREE.DirectionalLight(0xFFFFFF, 0.3);
	light4.position.set(0, -10, 0).normalize();
	scene.add(light4);

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
	ui.colorOverlayDropdown = $("#colorOverlayDropdown");
	
	// Populate color overlay dropdown with registered overlays
	populateColorOverlayDropdown();
	
	// Set up change handler for dropdown
	ui.colorOverlayDropdown.change(function() {
		var selectedOverlay = $(this).val();
		applyColorOverlay(selectedOverlay);
	});

	// Projection buttons
	ui.projectGlobe = $("#projectGlobe");
	ui.projectRaisedGlobe = $("#projectRaisedGlobe");
	ui.projectMercatorMap = $("#projectMercatorMap");
	
	ui.projectRaisedGlobe.click(toggleElevationExaggeration);
	
	// Overlay buttons
	ui.showSunlightButton = $("#showSunlightButton");
	ui.showPlateBoundariesButton = $("#showPlateBoundariesButton");
	ui.showRiversButton = $("#showRiversButton");
	ui.showAirCurrentsButton = $("#showAirCurrentsButton");
	
	console.log("UI button elements found:");
	console.log("  showRiversButton:", ui.showRiversButton.length);
	console.log("  showPlateBoundariesButton:", ui.showPlateBoundariesButton.length);
	console.log("  showAirCurrentsButton:", ui.showAirCurrentsButton.length);

	ui.showSunlightButton.click(showHideSunlight);
	ui.showPlateBoundariesButton.click(showHidePlateBoundaries);
	ui.showRiversButton.click(showHideRivers);
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

	// Initialize the dropdown after it's populated
	setTimeout(function() {
		setSurfaceRenderMode(surfaceRenderMode, true);
	}, 100);
	// Initialize projection button states
	if (elevationMultiplier > 0) {
		ui.projectRaisedGlobe.addClass("toggled");
	}
	
	// Initialize overlay button states  
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

function showAdvancedSettings() {
	ui.generationSettingsPanel.show();
}

function hideAdvancedSettings() {
	ui.generationSettingsPanel.hide();
}

function setSurfaceRenderMode(mode, force) {
	// Update the dropdown to match the new mode
	if (ui.colorOverlayDropdown) {
		ui.colorOverlayDropdown.val(mode);
	}
	
	// Apply the color overlay
	applyColorOverlay(mode);
	
	// Update the global variable for compatibility
	surfaceRenderMode = mode;
}

function showHideSunlight(show) {
	if (typeof (show) === "boolean") renderSunlight = show;
	else renderSunlight = !renderSunlight;
	if (renderSunlight) ui.showSunlightButton.addClass("toggled");
	if (!renderSunlight) ui.showSunlightButton.removeClass("toggled");

	if (!planet) return;

	if (renderSunlight) {
		// Add orbiting sun light if it doesn't exist
		if (!window.orbitingSunLight) {
			window.orbitingSunLight = new THREE.DirectionalLight(0xFFFFDD, 2.0);
			window.orbitingSunLight.position.set(2000, 1000, 1000);
			scene.add(window.orbitingSunLight);
			console.log("Added orbiting sun light:", window.orbitingSunLight);
		}
	} else {
		// Remove orbiting sun light
		if (window.orbitingSunLight) {
			scene.remove(window.orbitingSunLight);
			console.log("Removed orbiting sun light");
			window.orbitingSunLight = null;
		}
	}
}

function showHidePlateBoundaries(show) {
	console.log("showHidePlateBoundaries called with:", show);
	if (typeof (show) === "boolean") renderPlateBoundaries = show;
	else renderPlateBoundaries = !renderPlateBoundaries;
	if (renderPlateBoundaries) ui.showPlateBoundariesButton.addClass("toggled");
	if (!renderPlateBoundaries) ui.showPlateBoundariesButton.removeClass("toggled");

	if (!planet) {
		console.log("Planet not available for plate boundaries");
		return;
	}
	if (!planet.renderData) {
		console.log("Planet renderData not available for plate boundaries");
		return;
	}
	if (!planet.renderData.plateBoundaries) {
		console.log("Planet renderData.plateBoundaries not available");
		return;
	}
	if (!planet.renderData.plateBoundaries.renderObject) {
		console.log("Planet renderData.plateBoundaries.renderObject not available");
		return;
	}

	if (renderPlateBoundaries) planet.renderData.surface.renderObject.add(planet.renderData.plateBoundaries.renderObject);
	else planet.renderData.surface.renderObject.remove(planet.renderData.plateBoundaries.renderObject);
}

function showHidePlateMovements(show) {
	if (typeof (show) === "boolean") renderPlateMovements = show;
	else renderPlateMovements = !renderPlateMovements;
	// Note: No UI button for plate movements anymore - accessed via O key only

	if (!planet) return;

	if (renderPlateMovements) planet.renderData.surface.renderObject.add(planet.renderData.plateMovements.renderObject);
	else planet.renderData.surface.renderObject.remove(planet.renderData.plateMovements.renderObject);

}

function showHideAirCurrents(show) {
	console.log("showHideAirCurrents called with:", show);
	if (typeof (show) === "boolean") renderAirCurrents = show;
	else renderAirCurrents = !renderAirCurrents;
	if (renderAirCurrents) ui.showAirCurrentsButton.addClass("toggled");
	if (!renderAirCurrents) ui.showAirCurrentsButton.removeClass("toggled");

	if (!planet) {
		console.log("Planet not available for air currents");
		return;
	}
	if (!planet.renderData) {
		console.log("Planet renderData not available for air currents");
		return;
	}
	if (!planet.renderData.airCurrents) {
		console.log("Planet renderData.airCurrents not available");
		return;
	}
	if (!planet.renderData.airCurrents.renderObject) {
		console.log("Planet renderData.airCurrents.renderObject not available");
		return;
	}

	if (renderAirCurrents) planet.renderData.surface.renderObject.add(planet.renderData.airCurrents.renderObject);
	else planet.renderData.surface.renderObject.remove(planet.renderData.airCurrents.renderObject);
}

function showHideRivers(show) {
	console.log("showHideRivers called with:", show, "- renderRivers was:", renderRivers);
	if (typeof (show) === "boolean") renderRivers = show;
	else renderRivers = !renderRivers;
	console.log("renderRivers is now:", renderRivers);
	if (renderRivers) ui.showRiversButton.addClass("toggled");
	if (!renderRivers) ui.showRiversButton.removeClass("toggled");

/* 	console.log("Rivers debug - planet exists:", !!planet);
	if (planet) {
		console.log("Rivers debug - renderData exists:", !!planet.renderData);
		if (planet.renderData) {
			console.log("Rivers debug - renderData keys:", Object.keys(planet.renderData));
			if (planet.renderData.Rivers) {
				console.log("Rivers debug - Rivers object exists:", !!planet.renderData.Rivers);
				console.log("Rivers debug - Rivers keys:", Object.keys(planet.renderData.Rivers));
				console.log("Rivers debug - Rivers.renderObject exists:", !!planet.renderData.Rivers.renderObject);
			}
		}
	} */
	
	if (!planet) {
		console.log("Planet not available for rivers");
		return;
	}
	if (!planet.renderData) {
		console.log("Planet renderData not available for rivers");
		return;
	}
	if (!planet.renderData.Rivers) {
		console.log("Planet renderData.Rivers not available");
		return;
	}
	if (!planet.renderData.Rivers.renderObject) {
		console.log("Planet renderData.Rivers.renderObject not available");
		return;
	}

	if (renderRivers) {
		console.log("Adding rivers to scene");
		planet.renderData.surface.renderObject.add(planet.renderData.Rivers.renderObject);
	} else {
		console.log("Removing rivers from scene");
		planet.renderData.surface.renderObject.remove(planet.renderData.Rivers.renderObject);
	}
}

function showHideMoon(show) {
	if (typeof (show) === "boolean") renderMoon = show;
	else renderMoon = !renderMoon;
	
	if (!planet || !planet.renderData.moon) return;

	if (renderMoon) {
		scene.add(planet.renderData.moon.renderObject);
		console.log("Added moon to scene for material testing");
		
		// Add all debugging test objects if they exist
		if (planet.renderData.moon.testObjects) {
			console.log("Adding", planet.renderData.moon.testObjects.length, "debugging test objects to scene");
			for (var i = 0; i < planet.renderData.moon.testObjects.length; i++) {
				var testObj = planet.renderData.moon.testObjects[i];
				scene.add(testObj.object);
				console.log("  - Added", testObj.name, "at position:", testObj.object.position);
			}
		}
	} else {
		scene.remove(planet.renderData.moon.renderObject);
		console.log("Removed moon from scene");
		
		// Remove all debugging test objects if they exist
		if (planet.renderData.moon.testObjects) {
			console.log("Removing debugging test objects from scene");
			for (var i = 0; i < planet.renderData.moon.testObjects.length; i++) {
				var testObj = planet.renderData.moon.testObjects[i];
				scene.remove(testObj.object);
				console.log("  - Removed", testObj.name);
			}
		}
	}
}

function populateColorOverlayDropdown() {
	var dropdown = ui.colorOverlayDropdown;
	dropdown.empty(); // Clear existing options
	
	var overlays = getColorOverlays();
	for (var i = 0; i < overlays.length; i++) {
		var overlay = overlays[i];
		var option = $('<option>', {
			value: overlay.id,
			text: overlay.name,
			title: overlay.description
		});
		dropdown.append(option);
	}
	
	// Set default to terrain
	dropdown.val("terrain");
}

function toggleElevationExaggeration() {
	// Toggle binary displacement parameter
	useElevationDisplacement = !useElevationDisplacement;
	console.log("3D elevation", useElevationDisplacement ? "enabled (elevated terrain)" : "disabled (flat terrain)");
	
	// Update button state if we have the UI button
	if (typeof ui !== 'undefined' && ui.projectRaisedGlobe) {
		if (useElevationDisplacement) {
			ui.projectRaisedGlobe.addClass("toggled");
		} else {
			ui.projectRaisedGlobe.removeClass("toggled");
		}
	}
	
	// Simple render data regeneration (no displacement recalculation needed)
	if (planet && planet.topology) {
		console.log("Applying instant elevation toggle...");
		var startTime = Date.now();
		
		// Regenerate render data using existing displacement values and new binary parameter
		var regenerateAction = new SteppedAction("Updating 3D Elevation");
		regenerateAction
			.executeSubaction(function(action) {
				return generatePlanetRenderData(planet.topology, planet.random, action);
			})
			.getResult(function(renderData) {
				// Update the planet's render data
				Object.keys(renderData).forEach(function(key) {
					if (planet.renderData[key] && planet.renderData[key].renderObject) {
						// Remove old render object from scene
						scene.remove(planet.renderData[key].renderObject);
					}
					planet.renderData[key] = renderData[key];
					
					// Only automatically add the surface render object to the scene
					// Overlays will be handled by their visibility functions
					if (key === 'surface' && renderData[key] && renderData[key].renderObject) {
						scene.add(renderData[key].renderObject);
					}
				});
				
				// Reapply current visibility settings (this will add/remove overlays as needed)
				showHideSunlight(renderSunlight);
				showHidePlateBoundaries(renderPlateBoundaries);
				showHidePlateMovements(renderPlateMovements);
				showHideAirCurrents(renderAirCurrents);
				showHideRivers(renderRivers);
				
				console.log("Instant elevation toggle complete in", (Date.now() - startTime), "ms");
			})
			.execute();
	}
}


function showHideEdgeCosts(show) {
    if (typeof (show) === "boolean") renderEdgeCosts = show;
    else renderEdgeCosts = !renderEdgeCosts;
    //if (renderEdgeCosts) ui.showEdgeCostsButton.addClass("toggled");
    //if (!renderEdgeCosts) ui.showEdgeCostsButton.removeClass("toggled");
    if (!planet) return;
    if (renderEdgeCosts) scene.add(planet.edgeCostsRenderObject);
    else scene.remove(planet.edgeCostsRenderObject);
}
