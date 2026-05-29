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
	window.ambientLight = new THREE.AmbientLight(0xFFFFFF, 0.8); // Bright ambient light
	scene.add(window.ambientLight);

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

	// Resume the render loop on any user interaction (it idle-pauses after 15s of
	// no activity - see markRenderActivity in rendering-3d.js). Document-level so
	// it also catches control-panel clicks, dropdowns and sliders.
	if (typeof markRenderActivity === "function") {
		$(document).on("mousemove mousedown wheel keydown touchstart touchmove", markRenderActivity);
	}

	ui.helpPanel = $("#helpPanel");

	ui.controlPanel = $("#controlPanel");
	ui.colorOverlayDropdown = $("#colorOverlayDropdown");

	// Global variable to track selected overlay category
	window.selectedOverlayCategory = 'geography'; // Default to geography

	// Set up category button handlers. Clicking a category rebuilds the dropdown and
	// switches to that category's default view (unless the current view already
	// belongs to the category, which populateColorOverlayDropdown preserves).
	$('.categoryButton').click(function() {
		window.selectedOverlayCategory = $(this).data('category');
		updateCategoryButtonStates();
		populateColorOverlayDropdown();
		var sel = ui.colorOverlayDropdown.val();
		if (sel) setSurfaceRenderMode(sel);
	});
	updateCategoryButtonStates(); // reflect the default category at startup

	// Populate color overlay dropdown with registered overlays
	populateColorOverlayDropdown();

	// Set up change handler for dropdown
	ui.colorOverlayDropdown.change(function() {
		var selectedOverlay = $(this).val();
		setSurfaceRenderMode(selectedOverlay);
	});

	// Feature-detection tuning sliders -> regenerateFeatureOverlays (live).
	setupFeatureDetectionControls();
	// Merged-watershed merge tuning sliders -> regenerateMergedWatersheds (live).
	setupMergedWatershedControls();

	// Projection buttons
	ui.projectGlobe = $("#projectGlobe");
	ui.projectRaisedGlobe = $("#projectRaisedGlobe");
	ui.projectMercatorMap = $("#projectMercatorMap");
	ui.projectRaisedMercator = $("#projectRaisedMercator");

	// Switch to a target (projection, raised) state, using the cache so repeat switches are instant.
	function applyProjectionMode(targetProjection, targetRaised) {
		if (projectionMode === targetProjection && useElevationDisplacement === targetRaised) {
			return; // already there
		}
		var previousCacheKey = (typeof getProjectionCacheKey === "function") ? getProjectionCacheKey() : null;
		projectionMode = targetProjection;
		useElevationDisplacement = targetRaised;
		if (typeof updateCamera === "function") updateCamera();
		if (typeof updateProjectionButtonStates === "function") updateProjectionButtonStates();
		if (planet && planet.topology && typeof applyProjectionStateChange === "function") {
			applyProjectionStateChange(previousCacheKey);
		}
	}

	ui.projectGlobe.click(function() { applyProjectionMode("globe", false); });
	ui.projectRaisedGlobe.click(function() { applyProjectionMode("globe", true); });
	ui.projectMercatorMap.click(function() { applyProjectionMode("mercator", false); });
	ui.projectRaisedMercator.click(function() { applyProjectionMode("mercator", true); });
	
	// Overlay buttons
	ui.showSunlightButton = $("#showSunlightButton");
	ui.showPlateBoundariesButton = $("#showPlateBoundariesButton");
	ui.showRiversButton = $("#showRiversButton");
	ui.showRiverLinesButton = $("#showRiverLinesButton");
	ui.showAirCurrentsButton = $("#showAirCurrentsButton");
	ui.showCoastlineButton = $("#showCoastlineButton");
	ui.showPlateOutlineButton = $("#showPlateOutlineButton");


	ui.showSunlightButton.click(showHideSunlight);
	ui.showPlateBoundariesButton.click(showHidePlateBoundaries);
	ui.showRiversButton.click(showHideRivers);
	ui.showRiverLinesButton.click(showHideRiverLines);
	ui.showAirCurrentsButton.click(showHideAirCurrents);
	ui.showCoastlineButton.click(showHideCoastline);
	ui.showPlateOutlineButton.click(showHidePlateOutline);

	// Removed detail level and generate buttons
	ui.advancedSettingsButton = $("#advancedSettingsButton");
	ui.advancedSettingsButton.click(showAdvancedSettings);

	// Save/Load Planet buttons
	ui.savePlanetMinimalButton = $("#savePlanetMinimalButton");
	ui.savePlanetFullButton = $("#savePlanetFullButton");
	ui.savePlanetGeoJSONButton = $("#savePlanetGeoJSONButton");
	ui.loadPlanetButton = $("#loadPlanetButton");
	ui.exportRegionsGeoJSONButton = $("#exportRegionsGeoJSONButton");
	ui.importGeoJSONButton = $("#importGeoJSONButton");

	ui.savePlanetMinimalButton.click(function() {
		savePlanetToFile('minimal');
	});

	ui.savePlanetFullButton.click(function() {
		savePlanetToFile('full');
	});

	ui.savePlanetGeoJSONButton.click(function() {
		savePlanetToFile('geojson');
	});

	ui.loadPlanetButton.click(function() {
		loadPlanetFromFile();
	});

	ui.exportRegionsGeoJSONButton.click(function() {
		savePlanetToFile('geojson-regions');
	});

	ui.importGeoJSONButton.click(function() {
		loadGeoJSONAsPlanet();
	});

	// Removed ui.dataPanel - statistics panel no longer exists

	ui.progressPanel = $("#progressPanel");
	ui.progressActionLabel = $("#progressActionLabel");
	ui.progressBarFrame = $("#progressBarFrame");
	ui.progressBar = $("#progressBar");
	ui.progressBarLabel = $("#progressBarLabel");
	ui.progressCancelButton = $("#progressCancelButton");
	ui.progressCancelButton.click(cancelButtonHandler);
	ui.progressPanel.hide();

	ui.backgroundProgressPanel = $("#backgroundProgressPanel");
	ui.backgroundProgressActionLabel = $("#backgroundProgressActionLabel");
	ui.backgroundProgressBarFrame = $("#backgroundProgressBarFrame");
	ui.backgroundProgressBar = $("#backgroundProgressBar");
	ui.backgroundProgressBarLabel = $("#backgroundProgressBarLabel");
	ui.backgroundProgressPanel.hide();

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
	// Initialize projection button states from the actual mode state.
	if (typeof updateProjectionButtonStates === "function") {
		updateProjectionButtonStates();
	}
	
	// Initialize overlay button states  
	showHideSunlight(renderSunlight);
	showHidePlateBoundaries(renderPlateBoundaries);
	showHidePlateMovements(renderPlateMovements);
	showHideAirCurrents(renderAirCurrents);
	//showHideEdgeCosts(renderEdgeCosts);
	showHideRivers(renderRivers);
	showHideRiverLines(renderRiverLines);

	// Set default subdivisions to low detail (20) since buttons are removed
	setSubdivisions(20);

	//saveToFileSystem(serializePlanetMesh(planet.mesh, "function getPregeneratedPlanetMesh() { return ", "; }\n"));

	window.addEventListener("resize", resizeHandler);
	resizeHandler();
	// Removed showHideInterface() call - both panels now start hidden by default
    document.addEventListener('mousemove', (event) => {
        const rect = renderer.domElement.getBoundingClientRect();
        mouseX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouseY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    });

	generatePlanetAsynchronous();
	
	// Initialize terrain color pickers
	initializeTerrainColorPickers();
});

// Initialize terrain color picker system
function initializeTerrainColorPickers() {
	// Ocean color pickers - new four-color system
	document.getElementById('oceanSurfaceWarm').addEventListener('change', function() {
		terrainColors.oceanSurfaceWarm.setHex(parseInt(this.value.replace('#', '0x')));
		updateTerrainColorsAndRefresh();
	});
	
	document.getElementById('oceanSurfaceCold').addEventListener('change', function() {
		terrainColors.oceanSurfaceCold.setHex(parseInt(this.value.replace('#', '0x')));
		updateTerrainColorsAndRefresh();
	});
	
	document.getElementById('oceanDeepWarm').addEventListener('change', function() {
		terrainColors.oceanDeepWarm.setHex(parseInt(this.value.replace('#', '0x')));
		updateTerrainColorsAndRefresh();
	});
	
	document.getElementById('oceanDeepCold').addEventListener('change', function() {
		terrainColors.oceanDeepCold.setHex(parseInt(this.value.replace('#', '0x')));
		updateTerrainColorsAndRefresh();
	});
	
	// Land color pickers
	document.getElementById('landLowDry').addEventListener('change', function() {
		terrainColors.landLowDry.setHex(parseInt(this.value.replace('#', '0x')));
		updateTerrainColorsAndRefresh();
	});
	
	document.getElementById('landLowWet').addEventListener('change', function() {
		terrainColors.landLowWet.setHex(parseInt(this.value.replace('#', '0x')));
		updateTerrainColorsAndRefresh();
	});
	
	document.getElementById('landHighDry').addEventListener('change', function() {
		terrainColors.landHighDry.setHex(parseInt(this.value.replace('#', '0x')));
		updateTerrainColorsAndRefresh();
	});
	
	document.getElementById('landHighWet').addEventListener('change', function() {
		terrainColors.landHighWet.setHex(parseInt(this.value.replace('#', '0x')));
		updateTerrainColorsAndRefresh();
	});
	
	document.getElementById('landCold').addEventListener('change', function() {
		terrainColors.landCold.setHex(parseInt(this.value.replace('#', '0x')));
		updateTerrainColorsAndRefresh();
	});

	// Export Colors Button
	document.getElementById('exportColorsButton').addEventListener('click', function() {
		var colorCode = generateColorExportCode();
		navigator.clipboard.writeText(colorCode).then(function() {
			// Visual feedback - briefly change button text
			var button = document.getElementById('exportColorsButton');
			var originalText = button.textContent;
			button.textContent = 'Copied!';
			button.style.backgroundColor = 'rgba(0, 128, 0, 0.8)';
			setTimeout(function() {
				button.textContent = originalText;
				button.style.backgroundColor = '';
			}, 2000);
		}).catch(function() {
			// Fallback if clipboard API fails
			alert('Color code copied to console (clipboard API not available)');
		});
	});
}

// Generate JavaScript code for color initialization
function generateColorExportCode() {
	var oceanSurfaceWarm = document.getElementById('oceanSurfaceWarm').value;
	var oceanSurfaceCold = document.getElementById('oceanSurfaceCold').value;
	var oceanDeepWarm = document.getElementById('oceanDeepWarm').value;
	var oceanDeepCold = document.getElementById('oceanDeepCold').value;
	var landLowDry = document.getElementById('landLowDry').value;
	var landLowWet = document.getElementById('landLowWet').value;
	var landHighDry = document.getElementById('landHighDry').value;
	var landHighWet = document.getElementById('landHighWet').value;
	var landCold = document.getElementById('landCold').value;

	return `// Terrain Color Initialization - Generated from Color Picker
terrainColors = {
	oceanSurfaceWarm: new THREE.Color("${oceanSurfaceWarm}"),
	oceanSurfaceCold: new THREE.Color("${oceanSurfaceCold}"),
	oceanDeepWarm: new THREE.Color("${oceanDeepWarm}"),
	oceanDeepCold: new THREE.Color("${oceanDeepCold}"),
	landLowDry: new THREE.Color("${landLowDry}"),
	landLowWet: new THREE.Color("${landLowWet}"),
	landHighDry: new THREE.Color("${landHighDry}"),
	landHighWet: new THREE.Color("${landHighWet}"),
	landCold: new THREE.Color("${landCold}")
};`;
}

// Update terrain colors and refresh the display
function updateTerrainColorsAndRefresh() {
	// Only update if we're currently viewing terrain mode and have a planet
	var currentOverlay = getCurrentColorOverlay();
	if (currentOverlay === 'terrain' && planet && planet.topology) {
		
		// Regenerate render data with new colors
		var startTime = Date.now();
		var regenerateAction = new SteppedAction("Updating Terrain Colors");
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
					if (key === 'surface' && renderData[key] && renderData[key].renderObject) {
						scene.add(renderData[key].renderObject);
					}
				});
				
				// Reapply current visibility settings
				showHideSunlight(renderSunlight);
				showHidePlateBoundaries(renderPlateBoundaries);
				showHidePlateMovements(renderPlateMovements);
				showHideAirCurrents(renderAirCurrents);
				showHideRivers(renderRivers);
				showHideRiverLines(renderRiverLines);
				
			})
			.execute();
	} else {
	}
}

// Get current color overlay selection
function getCurrentColorOverlay() {
	var dropdown = document.getElementById('colorOverlayDropdown');
	return dropdown ? dropdown.value : 'terrain';
}

function setSubdivisions(subdivisions) {
	if (typeof (subdivisions) === "number" && subdivisions >= 4) {
		generationSettings.subdivisions = subdivisions;
		// Removed detail button toggling since buttons no longer exist

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
	// Keep the active category in sync with the overlay being shown. Needed when an
	// overlay is selected outside the dropdown (e.g. keyboard shortcuts) so the
	// category buttons and the filtered dropdown reflect the visible view.
	var ov = (typeof getColorOverlay === "function") ? getColorOverlay(mode) : null;
	if (ov && ov.category && window.selectedOverlayCategory !== ov.category) {
		window.selectedOverlayCategory = ov.category;
		if (typeof updateCategoryButtonStates === "function") updateCategoryButtonStates();
		populateColorOverlayDropdown();
	}

	// Update the dropdown to match the new mode
	if (ui.colorOverlayDropdown) {
		ui.colorOverlayDropdown.val(mode);
	}

	// Apply the color overlay
	applyColorOverlay(mode);

	// Update the global variable for compatibility
	surfaceRenderMode = mode;

	// Update labels based on the new overlay mode
	if (planet && planet.topology && planet.topology.tiles) {
		collectLabeledTiles(planet.topology.tiles, mode);

		// Rebuild and update label render objects
		if (planet.renderData) {
			// Remove old labels from scene first
			if (planet.renderData.labels) {
				scene.remove(planet.renderData.labels);
			}

			planet.renderData.labels = buildLabelsRenderObject();

			// Add new labels to scene if labels are enabled
			if (renderLabels && planet.renderData.labels) {
				scene.add(planet.renderData.labels);
			}
		}
	}

	// Swap the top-left colour panel to match the active overlay.
	if (typeof refreshLayerColorPanel === "function") refreshLayerColorPanel(mode);

	// Rebuild feature root/node markers for the (possibly new) active overlay.
	if (typeof rebuildFeatureRoots === "function") rebuildFeatureRoots();
	// Show only the active feature overlay's tuning knobs.
	if (typeof updateFeatureControlsVisibility === "function") updateFeatureControlsVisibility();
	// Show the merged-watershed tuning knobs only for that overlay.
	if (typeof updateMergedWatershedControlsVisibility === "function") updateMergedWatershedControlsVisibility();
}

// Wire the feature-detection tuning sliders + "Show Feature Roots" toggle.
// Labels update live while dragging; the (heavier) recompute fires on release.
function setupFeatureDetectionControls() {
	var rootsButton = document.getElementById("showFeatureRootsButton");
	if (rootsButton) {
		rootsButton.addEventListener("click", function() {
			var on = !rootsButton.classList.contains("toggled");
			if (on) rootsButton.classList.add("toggled"); else rootsButton.classList.remove("toggled");
			if (typeof toggleFeatureRoots === "function") toggleFeatureRoots(on);
		});
	}

	// `toValue`  maps slider int -> config value; `fromValue` maps config -> slider
	// int (for init); `format` renders the value label.
	var sliders = [
		{ id: "fdPlateSmooth",  key: "plateSmooth" },
		{ id: "fdPlateMin",     key: "plateMinSize" },
		{ id: "fdPlateMerge",   key: "plateMerge" },
		{ id: "fdMaxErosion",   key: "maxErosion" },
		{ id: "fdLobeEdge",     key: "lobeEdgeWater" },
		{ id: "fdLobeMin",      key: "lobeMinSize" },
		{ id: "fdThickMax",     key: "thicknessMax" },
		{ id: "fdNeckWidth",    key: "neckWidth" },
		{ id: "fdEFollowBasins", key: "eFollowBasins",
		  toValue: function(v) { return v === 1; }, fromValue: function(v) { return v ? 1 : 0; },
		  format: function(v) { return v ? "on" : "off"; } },
		{ id: "fdClimateBands", key: "climateBands" },
		{ id: "fdClimateMin",   key: "climateMinSize" },
		{ id: "fdDarken",       key: "darkenPerLevel",
		  toValue: function(v) { return v / 100; }, fromValue: function(v) { return Math.round(v * 100); },
		  format: function(v) { return (v / 100).toFixed(2); } }
	];

	sliders.forEach(function(s) {
		var el = document.getElementById(s.id);
		if (!el) return;
		var label = document.getElementById(s.id + "Val");
		var fmt = function(v) { return s.format ? s.format(v) : String(v); };

		// Initialize the slider position from the live config when available.
		if (typeof featureDetectionConfig !== "undefined" && featureDetectionConfig) {
			var cfgVal = featureDetectionConfig[s.key];
			if (cfgVal !== undefined) {
				el.value = s.fromValue ? s.fromValue(cfgVal) : cfgVal;
			}
		}
		if (label) label.textContent = fmt(+el.value);

		el.addEventListener("input", function() {
			if (label) label.textContent = fmt(+el.value);
		});
		el.addEventListener("change", function() {
			if (typeof regenerateFeatureOverlays !== "function") return;
			var overrides = {};
			overrides[s.key] = s.toValue ? s.toValue(+el.value) : +el.value;
			regenerateFeatureOverlays(overrides);
		});
	});

	updateFeatureControlsVisibility();
}

// Wire the merged-watershed merge-tuning sliders. Mirrors
// setupFeatureDetectionControls: labels update live while dragging; the
// (heavier) re-merge fires on release via regenerateMergedWatersheds().
function setupMergedWatershedControls() {
	var pct2 = {
		toValue: function(v) { return v / 100; },
		fromValue: function(v) { return Math.round(v * 100); },
		format: function(v) { return (v / 100).toFixed(2); }
	};
	var sliders = [
		{ id: "mwBorderWeight", key: "borderWeight", map: pct2 },
		{ id: "mwSizeWeight",   key: "sizeWeight",   map: pct2 },
		{ id: "mwElevWeight",   key: "elevWeight",   map: pct2 },
		{ id: "mwTinySize",     key: "tinySize" },
		{ id: "mwTinyBonus",    key: "tinyBonus",    map: pct2 },
		{ id: "mwThreshold",    key: "threshold",    map: pct2 }
	];

	sliders.forEach(function(s) {
		var el = document.getElementById(s.id);
		if (!el) return;
		var label = document.getElementById(s.id + "Val");
		var fmt = function(v) { return s.map && s.map.format ? s.map.format(v) : String(v); };

		// Initialize slider position from the live config when available.
		if (typeof mergedWatershedConfig !== "undefined" && mergedWatershedConfig) {
			var cfgVal = mergedWatershedConfig[s.key];
			if (cfgVal !== undefined) {
				el.value = (s.map && s.map.fromValue) ? s.map.fromValue(cfgVal) : cfgVal;
			}
		}
		if (label) label.textContent = fmt(+el.value);

		el.addEventListener("input", function() {
			if (label) label.textContent = fmt(+el.value);
		});
		el.addEventListener("change", function() {
			if (typeof regenerateMergedWatersheds !== "function") return;
			var overrides = {};
			overrides[s.key] = (s.map && s.map.toValue) ? s.map.toValue(+el.value) : +el.value;
			regenerateMergedWatersheds(overrides);
		});
	});

	updateMergedWatershedControlsVisibility();
}

// Show the merged-watershed tuning panel only when that overlay is active.
function updateMergedWatershedControlsVisibility() {
	var panel = document.getElementById("mergedWatershedPanel");
	if (!panel) return;
	var mode = (typeof surfaceRenderMode !== "undefined") ? surfaceRenderMode : null;
	panel.style.display = (mode === "mergedWatersheds") ? "" : "none";
}

// Show the tuning panel (and only the active overlay's knob group) when a feature
// overlay is selected; hide the whole panel otherwise.
function updateFeatureControlsVisibility() {
	var panel = document.getElementById("featureDetectionPanel");
	if (!panel) return;
	var mode = (typeof surfaceRenderMode !== "undefined") ? surfaceRenderMode : null;
	var letter = (typeof featureApproachForMode === "function") ? featureApproachForMode(mode) : null;
	panel.style.display = letter ? "" : "none";
	var groups = panel.querySelectorAll(".fdGroup");
	for (var i = 0; i < groups.length; i++) {
		groups[i].style.display = (groups[i].getAttribute("data-approach") === letter) ? "" : "none";
	}
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
			window.orbitingSunLight = new THREE.DirectionalLight(0xFFFFFF, 1);
			window.orbitingSunLight.position.set(2000, 1000, 1000);
			scene.add(window.orbitingSunLight);
		}
		// Add orbiting hemisphere sky light that follows the sun
		if (!window.orbitingSkyLight) {
			var skyColor = 0x0000FF;//0x87CEEB;    // Sky blue for the upper hemisphere
			var groundColor = 0x443322; // Warm brown for ground reflection
			window.orbitingSkyLight = new THREE.HemisphereLight(skyColor, groundColor, 0.5);
			// Position it to orient the hemisphere relative to the sun
			var sunPos = window.orbitingSunLight.position.clone();
			window.orbitingSkyLight.position.copy(sunPos.normalize().multiplyScalar(100));
			scene.add(window.orbitingSkyLight);
		}
		// Make ambient light much dimmer and blue-tinted when sun is on
		if (window.ambientLight) {
			window.ambientLight.color.setHex(0x4488FF); // Blue tint
			window.ambientLight.intensity = 0.3; // Much dimmer
		}
	} else {
		// Remove orbiting sun light
		if (window.orbitingSunLight) {
			scene.remove(window.orbitingSunLight);
			window.orbitingSunLight = null;
		}
		// Remove orbiting sky light
		if (window.orbitingSkyLight) {
			scene.remove(window.orbitingSkyLight);
			window.orbitingSkyLight = null;
		}
		// Restore ambient light to normal when sun is off
		if (window.ambientLight) {
			window.ambientLight.color.setHex(0xFFFFFF); // White
			window.ambientLight.intensity = 0.8; // Bright
		}
	}
}

function showHidePlateBoundaries(show) {
	if (typeof (show) === "boolean") renderPlateBoundaries = show;
	else renderPlateBoundaries = !renderPlateBoundaries;
	if (renderPlateBoundaries) ui.showPlateBoundariesButton.addClass("toggled");
	if (!renderPlateBoundaries) ui.showPlateBoundariesButton.removeClass("toggled");

	if (!planet) {
		return;
	}
	if (!planet.renderData) {
		return;
	}
	if (!planet.renderData.plateBoundaries) {
		return;
	}
	if (!planet.renderData.plateBoundaries.renderObject) {
		return;
	}

	if (renderPlateBoundaries) planet.renderData.surface.renderObject.add(planet.renderData.plateBoundaries.renderObject);
	else planet.renderData.surface.renderObject.remove(planet.renderData.plateBoundaries.renderObject);
}

// Toggle the thin black coastline outline (land/water boundary). The geometry is
// projection-specific, so rebuildCoastlineOutline (rendering-3d.js) builds it for
// the current view; it is also re-run on projection switches and planet load.
function showHideCoastline(show) {
	if (typeof (show) === "boolean") renderCoastline = show;
	else renderCoastline = !renderCoastline;
	if (ui.showCoastlineButton) {
		if (renderCoastline) ui.showCoastlineButton.addClass("toggled");
		else ui.showCoastlineButton.removeClass("toggled");
	}
	if (typeof rebuildCoastlineOutline === "function") rebuildCoastlineOutline();
}

// Toggle the red tectonic plate-boundary outline. Projection-specific geometry is
// built by rebuildPlateOutline (rendering-3d.js); it is also re-run on projection
// switches and planet load.
function showHidePlateOutline(show) {
	if (typeof (show) === "boolean") renderPlateOutline = show;
	else renderPlateOutline = !renderPlateOutline;
	if (ui.showPlateOutlineButton) {
		if (renderPlateOutline) ui.showPlateOutlineButton.addClass("toggled");
		else ui.showPlateOutlineButton.removeClass("toggled");
	}
	if (typeof rebuildPlateOutline === "function") rebuildPlateOutline();
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
	if (typeof (show) === "boolean") renderAirCurrents = show;
	else renderAirCurrents = !renderAirCurrents;
	if (renderAirCurrents) ui.showAirCurrentsButton.addClass("toggled");
	if (!renderAirCurrents) ui.showAirCurrentsButton.removeClass("toggled");

	if (!planet) {
		return;
	}
	if (!planet.renderData) {
		return;
	}
	if (!planet.renderData.airCurrents) {
		return;
	}
	if (!planet.renderData.airCurrents.renderObject) {
		return;
	}

	if (renderAirCurrents) planet.renderData.surface.renderObject.add(planet.renderData.airCurrents.renderObject);
	else planet.renderData.surface.renderObject.remove(planet.renderData.airCurrents.renderObject);
}

function showHideRivers(show) {
	if (typeof (show) === "boolean") renderRivers = show;
	else renderRivers = !renderRivers;
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
		return;
	}
	if (!planet.renderData) {
		return;
	}
	if (!planet.renderData.Rivers) {
		return;
	}
	if (!planet.renderData.Rivers.renderObject) {
		return;
	}

	if (renderRivers) {
		planet.renderData.surface.renderObject.add(planet.renderData.Rivers.renderObject);
	} else {
		planet.renderData.surface.renderObject.remove(planet.renderData.Rivers.renderObject);
	}
}

function showHideRiverLines(show) {
	if (typeof (show) === "boolean") renderRiverLines = show;
	else renderRiverLines = !renderRiverLines;
	if (ui.showRiverLinesButton) {
		if (renderRiverLines) ui.showRiverLinesButton.addClass("toggled");
		else ui.showRiverLinesButton.removeClass("toggled");
	}

	if (!planet || !planet.renderData || !planet.renderData.RiverLines || !planet.renderData.RiverLines.renderObject) {
		return;
	}

	if (renderRiverLines) {
		planet.renderData.surface.renderObject.add(planet.renderData.RiverLines.renderObject);
	} else {
		planet.renderData.surface.renderObject.remove(planet.renderData.RiverLines.renderObject);
	}
}

function showHideMoon(show) {
	if (typeof (show) === "boolean") renderMoon = show;
	else renderMoon = !renderMoon;
	
	if (!planet || !planet.renderData.moon) return;

	if (renderMoon) {
		scene.add(planet.renderData.moon.renderObject);
		
		// Add all debugging test objects if they exist
		if (planet.renderData.moon.testObjects) {
			for (var i = 0; i < planet.renderData.moon.testObjects.length; i++) {
				var testObj = planet.renderData.moon.testObjects[i];
				scene.add(testObj.object);
			}
		}
	} else {
		scene.remove(planet.renderData.moon.renderObject);
		
		// Remove all debugging test objects if they exist
		if (planet.renderData.moon.testObjects) {
			for (var i = 0; i < planet.renderData.moon.testObjects.length; i++) {
				var testObj = planet.renderData.moon.testObjects[i];
				scene.remove(testObj.object);
			}
		}
	}
}

// Rebuild the overlay dropdown to show only the active category's overlays.
// Preserves the current selection if it still belongs to the category; otherwise
// selects that category's default. Does NOT apply the overlay - callers that want
// a view switch (the category buttons) do that explicitly. This keeps incidental
// callers (feature-slider regeneration, planet load, dynamic overlay registration)
// from yanking the view back to a default.
function populateColorOverlayDropdown() {
	var dropdown = ui.colorOverlayDropdown;
	dropdown.empty(); // Clear existing options

	var selectedCategory = window.selectedOverlayCategory || 'geography';
	var current = (typeof surfaceRenderMode !== "undefined") ? surfaceRenderMode : null;

	var overlays = getColorOverlays();
	var defaultOverlay = null;
	var currentInCategory = false;

	for (var i = 0; i < overlays.length; i++) {
		var overlay = overlays[i];
		if (overlay.category !== selectedCategory) continue;
		// Pending (deferred) overlays get a spinner suffix; still selectable so the
		// user can watch them fill in (they show gray until their data is ready).
		var pending = (overlay.ready === false);
		var text = pending ? (overlay.name + " ⏳") : overlay.name;
		dropdown.append($('<option>', { value: overlay.id, text: text, title: overlay.description }));
		if (!defaultOverlay) defaultOverlay = overlay.id;
		if (overlay.id === current) currentInCategory = true;
	}

	// Keep showing the active overlay if it's in this category; else show the default.
	dropdown.val(currentInCategory ? current : defaultOverlay);
}

// Reflect the active overlay category on the category toggle buttons.
function updateCategoryButtonStates() {
	var active = window.selectedOverlayCategory || 'geography';
	$('.categoryButton').each(function() {
		if ($(this).data('category') === active) $(this).addClass('toggled');
		else $(this).removeClass('toggled');
	});
}

// Default overlay id for the active category (first registered in that category).
function defaultOverlayForCategory() {
	var selectedCategory = window.selectedOverlayCategory || 'geography';
	var overlays = getColorOverlays();
	for (var i = 0; i < overlays.length; i++) {
		if (overlays[i].category === selectedCategory) return overlays[i].id;
	}
	return null;
}

function toggleElevationExaggeration() {
	var previousCacheKey = (typeof getProjectionCacheKey === "function") ? getProjectionCacheKey() : null;

	// Toggle binary displacement parameter
	useElevationDisplacement = !useElevationDisplacement;

	// Update button state to reflect both projection and elevation toggle.
	if (typeof updateProjectionButtonStates === "function") {
		updateProjectionButtonStates();
	} else if (typeof ui !== 'undefined' && ui.projectRaisedGlobe) {
		if (useElevationDisplacement) {
			ui.projectRaisedGlobe.addClass("toggled");
		} else {
			ui.projectRaisedGlobe.removeClass("toggled");
		}
	}

	// Reuse the projection cache so toggling elevation is instant on repeat.
	if (planet && planet.topology && typeof applyProjectionStateChange === "function") {
		applyProjectionStateChange(previousCacheKey);
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
