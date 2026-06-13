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

// Propagate one front of air heat along the air currents. The previous version
// pushed every downstream neighbour once per inflowing edge (so the next front
// held many duplicates that were re-scanned and re-committed) and used
// splice(0, count) (O(active)) to drop the processed front. Here we dedupe the
// next front with a `_heatQueued` flag and rebuild the frontier in place from a
// scratch array, so work is proportional to the (deduped) front size.
var _heatNext = [];
function processAirHeat(activeCorners, action) {
	var consumedHeat = 0;
	var next = _heatNext;
	next.length = 0;
	for (var i = 0; i < activeCorners.length; ++i) {
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
				var nb = corner.corners[j];
				if (!nb._heatQueued) { nb._heatQueued = true; next.push(nb); }
				nb.newAirHeat += remainingCornerAirHeat * outflow;
			}
		}
	}

	activeCorners.length = 0;
	for (var i = 0; i < next.length; ++i) {
		var c = next[i];
		c.airHeat = c.newAirHeat;
		c.newAirHeat = 0;
		c._heatQueued = false;
		activeCorners.push(c);
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

// See processAirHeat: deduped next front + in-place rebuild (no O(active) splice).
var _moistNext = [];
function processAirMoisture(activeCorners, action) {
	var consumedMoisture = 0;
	var next = _moistNext;
	next.length = 0;
	for (var i = 0; i < activeCorners.length; ++i) {
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
				var nb = corner.corners[j];
				if (!nb._moistQueued) { nb._moistQueued = true; next.push(nb); }
				nb.newAirMoisture += remainingCornerAirMoisture * outflow;
			}
		}
	}

	activeCorners.length = 0;
	for (var i = 0; i < next.length; ++i) {
		var c = next[i];
		c.airMoisture = c.newAirMoisture;
		c.newAirMoisture = 0;
		c._moistQueued = false;
		activeCorners.push(c);
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
