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

function showHideEdgeCosts(show) {
    if (typeof (show) === "boolean") renderEdgeCosts = show;
    else renderEdgeCosts = !renderEdgeCosts;
    //if (renderEdgeCosts) ui.showEdgeCostsButton.addClass("toggled");
    //if (!renderEdgeCosts) ui.showEdgeCostsButton.removeClass("toggled");
    if (!planet) return;
    if (renderEdgeCosts) scene.add(planet.edgeCostsRenderObject);
    else scene.remove(planet.edgeCostsRenderObject);
}
