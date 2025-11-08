// Earth Recreation System
// Generates a planet that recreates Earth's actual geography using lat/lon lookups

/**
 * Convert Cartesian coordinates to geographic lat/lon
 * Returns { lat, lon } in degrees
 */
function cartesianToLatLon(position) {
	var r = Math.sqrt(position.x * position.x + position.y * position.y + position.z * position.z);

	// Apply axis rotation to match standard geography (from CLAUDE.md coordinate system)
	var geo_x = position.z;  // Front-facing becomes prime meridian
	var geo_y = position.x;  // Original X becomes 90°E direction
	var geo_z = position.y;  // North pole becomes Z-axis

	var phi = Math.asin(geo_z / r);      // Latitude in radians
	var theta = Math.atan2(geo_y, geo_x); // Longitude in radians

	return {
		lat: phi * 180 / Math.PI,      // Convert to degrees (-90 to 90)
		lon: theta * 180 / Math.PI     // Convert to degrees (-180 to 180)
	};
}

/**
 * Earth Elevation Lookup
 * Returns elevation in meters for given lat/lon
 * Approximates major features of Earth's topography
 */
function getEarthElevation(lat, lon) {
	// Normalize longitude to 0-360 for easier continental boundaries
	var lon360 = lon < 0 ? lon + 360 : lon;

	// Default ocean depth
	var elevation = -4000;

	// AFRICA (mostly 10°W to 50°E, 35°S to 35°N)
	if (lat > -35 && lat < 38 && lon360 > 350 || (lon360 >= 0 && lon360 < 55)) {
		elevation = 600; // Average African elevation

		// Atlas Mountains (Morocco)
		if (lat > 28 && lat < 35 && lon360 > 352 && lon360 < 358) {
			elevation = 2500 + Math.random() * 1500;
		}
		// Ethiopian Highlands
		if (lat > 5 && lat < 15 && lon360 > 35 && lon360 < 43) {
			elevation = 2000 + Math.random() * 1500;
		}
		// East African Rift
		if (lat > -5 && lat < 5 && lon360 > 35 && lon360 < 40) {
			elevation = 1500 + Math.random() * 1000;
		}
		// Congo Basin
		if (lat > -5 && lat < 5 && lon360 > 15 && lon360 < 30) {
			elevation = 300 + Math.random() * 200;
		}
		// Sahara Desert
		if (lat > 15 && lat < 30 && lon360 > 355 || (lon360 >= 0 && lon360 < 35)) {
			elevation = 400 + Math.random() * 300;
		}
		// Kalahari
		if (lat > -28 && lat < -20 && lon360 > 20 && lon360 < 28) {
			elevation = 900 + Math.random() * 200;
		}
	}

	// EURASIA
	// Europe (10°W to 60°E, 35°N to 71°N)
	if (lat > 35 && lat < 71 && lon360 > 350 || (lon360 >= 0 && lon360 < 65)) {
		elevation = 300; // Average European elevation

		// Alps
		if (lat > 43 && lat < 48 && lon360 > 6 && lon360 < 17) {
			elevation = 2000 + Math.random() * 2800; // Up to ~4800m (Mont Blanc)
		}
		// Pyrenees
		if (lat > 42 && lat < 43.5 && lon360 > 358 || (lon360 >= 0 && lon360 < 3)) {
			elevation = 1500 + Math.random() * 2000;
		}
		// Scandinavian Mountains
		if (lat > 60 && lat < 70 && lon360 > 5 && lon360 < 25) {
			elevation = 800 + Math.random() * 1600;
		}
		// Carpathians
		if (lat > 45 && lat < 49 && lon360 > 20 && lon360 < 27) {
			elevation = 1000 + Math.random() * 1600;
		}
		// Ural Mountains
		if (lat > 50 && lat < 68 && lon360 > 55 && lon360 < 62) {
			elevation = 600 + Math.random() * 1300;
		}
	}

	// Asia (60°E to 150°E, -10°N to 80°N)
	if (lat > -10 && lat < 80 && lon360 > 60 && lon360 < 150) {
		elevation = 500; // Average Asian elevation

		// Himalayas (THE BIG ONE - 70°E to 95°E, 27°N to 35°N)
		if (lat > 27 && lat < 36 && lon360 > 70 && lon360 < 95) {
			var distFromCenter = Math.abs(lat - 31) + Math.abs(lon360 - 82.5) * 0.5;
			if (distFromCenter < 4) {
				elevation = 6000 + Math.random() * 2848; // Up to 8848m (Everest)
			} else if (distFromCenter < 8) {
				elevation = 4000 + Math.random() * 3000;
			} else {
				elevation = 2000 + Math.random() * 2000;
			}
		}
		// Tibetan Plateau (75°E to 105°E, 28°N to 38°N)
		if (lat > 28 && lat < 38 && lon360 > 75 && lon360 < 105) {
			elevation = 4000 + Math.random() * 1500;
		}
		// Karakoram
		if (lat > 34 && lat < 37 && lon360 > 74 && lon360 < 78) {
			elevation = 5000 + Math.random() * 3611; // Up to K2
		}
		// Hindu Kush
		if (lat > 34 && lat < 38 && lon360 > 68 && lon360 < 74) {
			elevation = 3500 + Math.random() * 3900;
		}
		// Tian Shan
		if (lat > 40 && lat < 43 && lon360 > 75 && lon360 < 85) {
			elevation = 3000 + Math.random() * 4400;
		}
		// Altai Mountains
		if (lat > 46 && lat < 51 && lon360 > 85 && lon360 < 92) {
			elevation = 2000 + Math.random() * 2500;
		}
		// Siberian Plateau
		if (lat > 60 && lat < 70 && lon360 > 90 && lon360 < 140) {
			elevation = 300 + Math.random() * 400;
		}
		// Deccan Plateau (India)
		if (lat > 15 && lat < 25 && lon360 > 73 && lon360 < 80) {
			elevation = 600 + Math.random() * 400;
		}
		// Western Ghats (India)
		if (lat > 10 && lat < 20 && lon360 > 73 && lon360 < 77) {
			elevation = 900 + Math.random() * 1700;
		}
	}

	// Southeast Asia / Indonesia
	if (lat > -10 && lat < 25 && lon360 > 95 && lon360 < 145) {
		// Islands and peninsulas
		if ((lat > 0 && lat < 7 && lon360 > 100 && lon360 < 108) || // Sumatra/Java
		    (lat > -8 && lat < -1 && lon360 > 105 && lon360 < 120) || // Java/Borneo
		    (lat > 10 && lat < 20 && lon360 > 100 && lon360 < 110)) { // Indochina
			elevation = 200 + Math.random() * 1500;
		}
	}

	// NORTH AMERICA (170°W to 50°W, 25°N to 75°N)
	if (lat > 25 && lat < 75 && ((lon360 > 190 && lon360 < 360) || (lon360 >= 0 && lon360 < 30))) {
		// Convert back for easier NA handling
		var lonNA = lon360 > 180 ? lon360 - 360 : lon360;

		elevation = 500; // Average NA elevation

		// Rocky Mountains (110°W to 105°W, 40°N to 60°N)
		if (lat > 35 && lat < 60 && lonNA > -120 && lonNA < -105) {
			elevation = 2000 + Math.random() * 2400; // Up to ~4400m
		}
		// Appalachian Mountains (83°W to 76°W, 35°N to 45°N)
		if (lat > 34 && lat < 46 && lonNA > -84 && lonNA < -75) {
			elevation = 800 + Math.random() * 1300;
		}
		// Sierra Nevada (120°W to 118°W, 36°N to 40°N)
		if (lat > 35 && lat < 41 && lonNA > -121 && lonNA < -117) {
			elevation = 2000 + Math.random() * 2400;
		}
		// Cascade Range (122°W to 120°W, 40°N to 50°N)
		if (lat > 40 && lat < 50 && lonNA > -123 && lonNA < -119) {
			elevation = 1500 + Math.random() * 2900;
		}
		// Alaska Range (152°W to 148°W, 62°N to 64°N)
		if (lat > 61 && lat < 65 && lonNA > -154 && lonNA < -147) {
			elevation = 2500 + Math.random() * 3700; // Denali
		}
		// Great Plains (105°W to 95°W, 35°N to 50°N)
		if (lat > 35 && lat < 50 && lonNA > -106 && lonNA < -94) {
			elevation = 600 + Math.random() * 1000;
		}
		// Canadian Shield
		if (lat > 45 && lat < 65 && lonNA > -100 && lonNA < -70) {
			elevation = 300 + Math.random() * 400;
		}
		// Mexican Plateau
		if (lat > 20 && lat < 28 && lonNA > -105 && lonNA < -98) {
			elevation = 1800 + Math.random() * 500;
		}
	}

	// SOUTH AMERICA (82°W to 34°W, 56°S to 13°N)
	if (lat > -56 && lat < 13 && lon360 > 278 && lon360 < 326) {
		var lonSA = lon360 - 360; // Convert to negative

		elevation = 400; // Average SA elevation

		// Andes Mountains (THE LONGEST RANGE - 75°W to 65°W, 56°S to 10°N)
		if (lonSA > -80 && lonSA < -65) {
			var distFromAndes = Math.abs(lonSA + 72.5);
			if (distFromCenter < 3) {
				elevation = 4000 + Math.random() * 2900; // Up to Aconcagua
			} else if (distFromAndes < 7) {
				elevation = 2500 + Math.random() * 2500;
			} else {
				elevation = 1500 + Math.random() * 2000;
			}
		}
		// Amazon Basin (75°W to 50°W, 5°S to 5°N)
		if (lat > -5 && lat < 5 && lonSA > -76 && lonSA < -49) {
			elevation = 100 + Math.random() * 100;
		}
		// Brazilian Highlands (50°W to 40°W, 25°S to 5°S)
		if (lat > -26 && lat < -4 && lonSA > -51 && lonSA < -39) {
			elevation = 800 + Math.random() * 1200;
		}
		// Guiana Highlands (65°W to 58°W, 0° to 8°N)
		if (lat > 0 && lat < 8 && lonSA > -66 && lonSA < -57) {
			elevation = 1000 + Math.random() * 1800;
		}
		// Patagonian Plateau
		if (lat > -50 && lat < -40 && lonSA > -73 && lonSA < -65) {
			elevation = 500 + Math.random() * 1000;
		}
	}

	// AUSTRALIA (110°E to 155°E, 44°S to 10°S)
	if (lat > -44 && lat < -10 && lon360 > 110 && lon360 < 155) {
		elevation = 300; // Average Australian elevation (very flat continent)

		// Great Dividing Range (145°E to 153°E, 37°S to 16°S)
		if (lat > -38 && lat < -16 && lon360 > 144 && lon360 < 154) {
			elevation = 600 + Math.random() * 1600; // Up to ~2200m
		}
		// Central Australian ranges
		if (lat > -28 && lat < -20 && lon360 > 130 && lon360 < 140) {
			elevation = 400 + Math.random() * 1000;
		}
		// Western Plateau
		if (lat > -32 && lat < -20 && lon360 > 115 && lon360 < 125) {
			elevation = 400 + Math.random() * 200;
		}
	}

	// ANTARCTICA (all longitudes, 60°S to 90°S)
	if (lat < -60) {
		elevation = 2000 + Math.random() * 2000; // Ice sheet elevation

		// Transantarctic Mountains
		if (lat < -75 && lat > -85 && ((lon360 > 150 && lon360 < 180) || (lon360 > 0 && lon360 < 30))) {
			elevation = 3000 + Math.random() * 1700;
		}
	}

	// GREENLAND (73°W to 12°W, 60°N to 84°N)
	if (lat > 60 && lat < 84 && ((lon360 > 287 && lon360 < 360) || (lon360 >= 0 && lon360 < 12))) {
		elevation = 2000 + Math.random() * 1000; // Ice sheet
	}

	// Ocean basins and trenches
	if (elevation < 0) {
		// Mariana Trench (deepest point on Earth)
		if (lat > 11 && lat < 12 && lon360 > 142 && lon360 < 143) {
			elevation = -10994; // Challenger Deep
		}
		// Mid-Atlantic Ridge
		if (lon360 > 340 || lon360 < 20) {
			elevation = -2500 + Math.random() * 1000;
		}
		// Pacific trenches
		if (lat > -30 && lat < 50 && lon360 > 140 && lon360 < 150) {
			elevation = -6000 - Math.random() * 4000;
		}
		// Atlantic Ocean
		if ((lon360 > 280 && lon360 < 350) || (lon360 > 0 && lon360 < 20)) {
			elevation = -3500 - Math.random() * 2000;
		}
		// Indian Ocean
		if (lat > -50 && lat < 25 && lon360 > 40 && lon360 < 100) {
			elevation = -3800 - Math.random() * 2000;
		}
		// Pacific Ocean (default)
		if (lon360 > 150 && lon360 < 280) {
			elevation = -4200 - Math.random() * 2000;
		}
	}

	return elevation;
}

/**
 * Earth Temperature Lookup
 * Returns temperature in range 0-1 for given lat/lon and elevation
 */
function getEarthTemperature(lat, lon, elevation) {
	// Base temperature from latitude (0.9 at equator, 0.0 at poles)
	var latFactor = Math.abs(lat) / 90.0;
	var baseTemp = 0.9 - (latFactor * 0.9);

	// Elevation adjustment (temperature decreases with altitude)
	// Roughly 6.5°C per 1000m
	var elevationAdjustment = 0;
	if (elevation > 0) {
		elevationAdjustment = -(elevation / 1000) * 0.065;
	}

	// Ocean vs land (oceans moderate temperature)
	var oceanModeration = 0;
	if (elevation < 0) {
		// Oceans are more moderate
		if (Math.abs(lat) > 40) {
			oceanModeration = 0.1; // Warmer in polar regions
		} else {
			oceanModeration = -0.05; // Slightly cooler in tropics
		}
	}

	// Continental effect (interior continents more extreme)
	var continentalEffect = 0;
	var lon360 = lon < 0 ? lon + 360 : lon;

	// Siberia (very cold)
	if (lat > 50 && lat < 70 && lon360 > 80 && lon360 < 140) {
		continentalEffect = -0.2;
	}
	// Sahara (very hot)
	if (lat > 15 && lat < 30 && ((lon360 > 350 && lon360 < 360) || (lon360 >= 0 && lon360 < 35))) {
		continentalEffect = 0.15;
	}
	// Arabia (hot)
	if (lat > 15 && lat < 30 && lon360 > 35 && lon360 < 60) {
		continentalEffect = 0.15;
	}
	// Central Asia (cold winters)
	if (lat > 35 && lat < 50 && lon360 > 60 && lon360 < 90) {
		continentalEffect = -0.1;
	}
	// North American interior (continental climate)
	if (lat > 40 && lat < 55 && ((lon360 > 250 && lon360 < 270))) {
		continentalEffect = -0.05;
	}

	var temperature = baseTemp + elevationAdjustment + oceanModeration + continentalEffect;

	// Clamp to 0-1 range
	return Math.max(0, Math.min(1, temperature));
}

/**
 * Earth Moisture/Precipitation Lookup
 * Returns moisture in range 0-1 for given lat/lon and elevation
 */
function getEarthMoisture(lat, lon, elevation) {
	var lon360 = lon < 0 ? lon + 360 : lon;

	// Base moisture from latitude (ITCZ, subtropical highs, mid-latitude lows)
	var latAbs = Math.abs(lat);
	var baseMoisture = 0.5;

	// ITCZ (Intertropical Convergence Zone) - wet equatorial region
	if (latAbs < 10) {
		baseMoisture = 0.8;
	}
	// Subtropical highs (Hadley cell descending air) - dry
	else if (latAbs > 20 && latAbs < 35) {
		baseMoisture = 0.2;
	}
	// Mid-latitude storm tracks - moderate to wet
	else if (latAbs > 40 && latAbs < 60) {
		baseMoisture = 0.6;
	}
	// Polar regions - dry (cold air holds less moisture)
	else if (latAbs > 60) {
		baseMoisture = 0.3;
	}

	// Ocean vs land
	if (elevation < 0) {
		baseMoisture += 0.2; // Oceans provide moisture
	}

	// Coastal proximity effect
	var coastalBonus = 0;
	if (elevation > 0 && elevation < 500) {
		// Near sea level land (likely coastal)
		coastalBonus = 0.2;
	}

	// Specific wet regions
	var regionalAdjustment = 0;

	// Amazon Rainforest
	if (lat > -10 && lat < 5 && lon360 > 285 && lon360 < 315) {
		regionalAdjustment = 0.5; // Very wet
	}
	// Congo Rainforest
	if (lat > -5 && lat < 5 && lon360 > 15 && lon360 < 30) {
		regionalAdjustment = 0.4;
	}
	// Southeast Asian Monsoon
	if (lat > 10 && lat < 25 && lon360 > 95 && lon360 < 110) {
		regionalAdjustment = 0.4;
	}
	// Indonesian wet zone
	if (lat > -10 && lat < 10 && lon360 > 100 && lon360 < 140) {
		regionalAdjustment = 0.4;
	}
	// Eastern North America (wet)
	if (lat > 30 && lat < 45 && lon360 > 270 && lon360 < 290) {
		regionalAdjustment = 0.2;
	}
	// Pacific Northwest (wet)
	if (lat > 45 && lat < 50 && lon360 > 235 && lon360 < 245) {
		regionalAdjustment = 0.3;
	}
	// Western Europe (moderate rainfall)
	if (lat > 45 && lat < 60 && lon360 > 350 || (lon360 >= 0 && lon360 < 15)) {
		regionalAdjustment = 0.2;
	}

	// Specific dry regions (deserts)
	// Sahara Desert
	if (lat > 15 && lat < 30 && ((lon360 > 350 && lon360 < 360) || (lon360 >= 0 && lon360 < 35))) {
		regionalAdjustment = -0.5; // Very dry
	}
	// Arabian Desert
	if (lat > 15 && lat < 30 && lon360 > 35 && lon360 < 60) {
		regionalAdjustment = -0.5;
	}
	// Gobi Desert
	if (lat > 40 && lat < 50 && lon360 > 95 && lon360 < 110) {
		regionalAdjustment = -0.4;
	}
	// Kalahari Desert
	if (lat > -28 && lat < -20 && lon360 > 20 && lon360 < 28) {
		regionalAdjustment = -0.3;
	}
	// Australian Outback
	if (lat > -30 && lat < -20 && lon360 > 120 && lon360 < 140) {
		regionalAdjustment = -0.4;
	}
	// Atacama Desert (driest place on Earth)
	if (lat > -25 && lat < -18 && lon360 > 290 && lon360 < 295) {
		regionalAdjustment = -0.7;
	}
	// Patagonian Desert
	if (lat > -50 && lat < -40 && lon360 > 290 && lon360 < 300) {
		regionalAdjustment = -0.3;
	}
	// Great Basin (western US)
	if (lat > 38 && lat < 42 && lon360 > 245 && lon360 < 255) {
		regionalAdjustment = -0.3;
	}
	// Sonoran/Mojave Deserts
	if (lat > 30 && lat < 36 && lon360 > 245 && lon360 < 255) {
		regionalAdjustment = -0.4;
	}

	// Rain shadow effect (leeward side of mountains is dry)
	// Simplified: high elevation with specific geographic context
	if (elevation > 2000) {
		// Himalayas - wet on south side, dry on north
		if (lat > 27 && lat < 36 && lon360 > 70 && lon360 < 95) {
			if (lat < 31) {
				regionalAdjustment += 0.3; // South side (monsoon)
			} else {
				regionalAdjustment -= 0.3; // North side (Tibetan plateau)
			}
		}
		// Andes - wet on east, dry on west
		if (lat > -45 && lat < 10 && lon360 > 280 && lon360 < 300) {
			// West coast is dry (Atacama)
			regionalAdjustment -= 0.2;
		}
	}

	var moisture = baseMoisture + coastalBonus + regionalAdjustment;

	// Clamp to 0-1 range
	return Math.max(0, Math.min(1, moisture));
}

/**
 * Generate Earth planet by applying real geographic data to each tile
 * BRUTE FORCE VERSION: Uses detail=100, distortion=100 for maximum tile variation
 */
function generateEarthPlanet() {
	console.log('Starting Earth planet brute-force generation...');
	console.log('Using detail=100, distortion=100 for maximum geographic detail');

	// Use MAXIMUM detail and distortion as requested
	generationSettings.subdivisions = 100;
	generationSettings.distortionLevel = 100; // Maximum distortion for varied tile shapes
	generationSettings.plateCount = 15; // Match Earth's plates (won't be used for elevation)
	generationSettings.oceanicRate = 0.71; // 71% ocean
	generationSettings.heatLevel = 1.0;
	generationSettings.moistureLevel = 1.0;
	generationSettings.seed = 'earth-brute-force-v1';

	// Generate base planet
	activeAction = new SteppedAction(updateProgressUI)
		.executeSubaction(function (action) {
			ui.progressPanel.show();
		}, 0)
		.executeSubaction(function (action) {
			generatePlanet(
				generationSettings.subdivisions,
				generationSettings.distortionLevel, // Use requested distortion level
				generationSettings.plateCount,
				generationSettings.oceanicRate,
				generationSettings.heatLevel,
				generationSettings.moistureLevel,
				new XorShift128(hashString('earth-brute-force-v1')),
				action
			);
		}, 1, "Generating Base Geometry (100 subdivisions, 100 distortion)")
		.getResult(function (result) {
			planet = result;
			planet.seed = 'earth-brute-force-v1';
			planet.originalSeed = 'earth-brute-force-v1';
		})
		.executeSubaction(function(action) {
			console.log('Applying Earth geographic data to tiles...');
			applyEarthDataToTiles(planet, action);
		}, 1, "Applying Earth Geography")
		.executeSubaction(function (action) {
			// Recalculate corner values from tiles
			calculateCornerElevationMedians(planet.topology, action);
		}, 1, "Calculating Corner Elevations")
		.executeSubaction(function (action) {
			calculateElevationDisplacements(planet.topology, action);
		}, 1, "Calculating Elevation Displacements")
		.executeSubaction(function (action) {
			// Display planet
			displayPlanet(planet);
			setSeed(null);
			ui.progressPanel.hide();
		}, 0)
		.executeSubaction(function (action) {
			// Regenerate render data with Earth colors
			console.log('Generating Earth visuals...');
			var random = new XorShift128(hashString('earth-brute-force-v1'));
			generatePlanetRenderData(planet.topology, random, action);
		}, 1, "Building Earth Visuals")
		.getResult(function (result) {
			planet.renderData = result;
			scene.remove(scene.children.find(c => c === planet.renderData.surface.renderObject));
			scene.add(planet.renderData.surface.renderObject);
		})
		.finalize(function (action) {
			activeAction = null;
			console.log('='.repeat(60));
			console.log('EARTH BRUTE-FORCE GENERATION COMPLETE!');
			console.log('='.repeat(60));
			console.log('Configuration:');
			console.log('  - Subdivisions: 100 (maximum detail)');
			console.log('  - Distortion: 100 (maximum variation)');
			console.log('  - Total Tiles:', planet.topology.tiles.length);
			console.log('  - Total Corners:', planet.topology.corners.length);
			console.log('  - Total Borders:', planet.topology.borders.length);
			console.log('');
			console.log('Auto-saving planet file...');

			// Auto-save as full format
			var data = savePlanetFull(planet);
			var filename = 'earth-brute-force-detail100-distortion100.json';
			downloadPlanetFile(data, filename);

			console.log('File saved: ' + filename);
			console.log('File size: ' + (data.length / 1024 / 1024).toFixed(2) + ' MB');
			console.log('='.repeat(60));
		}, 0)
		.execute();
}

/**
 * Get Earth biome for given lat/lon and environmental parameters
 */
function getEarthBiome(lat, lon, elevation, temperature, moisture) {
	var latAbs = Math.abs(lat);
	var lon360 = lon < 0 ? lon + 360 : lon;

	// Ocean
	if (elevation < 0) {
		return 'ocean';
	}

	// Ice/Snow (polar and high altitude)
	if (latAbs > 66 || elevation > 0.45) { // Arctic/Antarctic circles or very high elevation
		return 'snow';
	}

	// Tundra
	if (latAbs > 60 || (elevation > 0.35 && latAbs > 40)) {
		return 'tundra';
	}

	// Taiga (boreal forest)
	if (latAbs > 50 && latAbs < 65 && moisture > 0.3) {
		return 'taiga';
	}

	// Desert (hot and cold)
	if (moisture < 0.25) {
		if (temperature > 0.6) {
			return 'desert'; // Hot desert
		} else {
			return 'tundra'; // Cold desert
		}
	}

	// Tropical rainforest
	if (latAbs < 10 && moisture > 0.7) {
		return 'tropicalRainforest';
	}

	// Tropical seasonal forest / savanna
	if (latAbs < 25 && temperature > 0.6) {
		if (moisture > 0.5) {
			return 'tropicalSeasonalForest';
		} else if (moisture > 0.3) {
			return 'grassland'; // Savanna
		}
	}

	// Temperate rainforest
	if (latAbs > 40 && latAbs < 55 && moisture > 0.7) {
		return 'temperateRainforest';
	}

	// Temperate deciduous forest
	if (latAbs > 30 && latAbs < 55 && moisture > 0.4 && temperature > 0.4) {
		return 'temperateDeciduousForest';
	}

	// Grassland
	if (moisture > 0.25 && moisture < 0.5) {
		if (temperature > 0.5) {
			return 'grassland';
		} else {
			return 'shrubland';
		}
	}

	// Shrubland (Mediterranean, chaparral)
	if (moisture > 0.2 && moisture < 0.5 && temperature > 0.5) {
		return 'shrubland';
	}

	// Default to temperate forest
	return 'temperateDeciduousForest';
}

/**
 * Apply Earth geographic data to all tiles
 */
function applyEarthDataToTiles(planet, action) {
	var tiles = planet.topology.tiles;
	var totalTiles = tiles.length;
	var processedCount = 0;

	action.executeSubaction(function(subAction) {
		// Process tiles in batches for progress updates
		var batchSize = 1000;
		var currentIndex = 0;

		function processBatch() {
			var endIndex = Math.min(currentIndex + batchSize, totalTiles);

			for (var i = currentIndex; i < endIndex; i++) {
				var tile = tiles[i];

				// Convert tile position to lat/lon
				var latLon = cartesianToLatLon(tile.position);

				// Get Earth data for this location
				var elevationMeters = getEarthElevation(latLon.lat, latLon.lon);
				var temperature = getEarthTemperature(latLon.lat, latLon.lon, elevationMeters);
				var moisture = getEarthMoisture(latLon.lat, latLon.lon, elevationMeters);

				// Convert elevation from meters to normalized scale
				// Earth range: ~-11000m to +8848m
				// Normalize to -1 to 1 range (roughly)
				tile.elevation = elevationMeters / 10000.0;
				tile.elevation = Math.max(-1, Math.min(1, tile.elevation));

				tile.temperature = temperature;
				tile.moisture = moisture;

				// Assign biome based on Earth data
				tile.biome = getEarthBiome(latLon.lat, latLon.lon, tile.elevation, temperature, moisture);

				// Store lat/lon for reference (useful for debugging)
				tile.latitude = latLon.lat;
				tile.longitude = latLon.lon;

				// Apply to corners as well
				if (tile.corners) {
					for (var j = 0; j < tile.corners.length; j++) {
						var corner = tile.corners[j];
						var cornerLatLon = cartesianToLatLon(corner.position);
						var cornerElev = getEarthElevation(cornerLatLon.lat, cornerLatLon.lon);

						corner.elevation = cornerElev / 10000.0;
						corner.elevation = Math.max(-1, Math.min(1, corner.elevation));
						corner.temperature = getEarthTemperature(cornerLatLon.lat, cornerLatLon.lon, cornerElev);
						corner.moisture = getEarthMoisture(cornerLatLon.lat, cornerLatLon.lon, cornerElev);
					}
				}
			}

			processedCount = endIndex;
			currentIndex = endIndex;

			// Continue processing or finish
			if (currentIndex < totalTiles) {
				subAction.loop();
			}
		}

		processBatch();
	});
}

// Add UI button to generate Earth in main interface
$(document).ready(function() {
	// Add Earth generation button to control panel if it exists
	if ($('#controlPanel').length > 0) {
		var earthButton = $('<button id="generateEarthBtn" class="editor-button" style="margin-top: 0.5em; width: 100%; padding: 0.75em; background-color: rgba(64, 128, 64, 0.8);">Generate Earth (Brute Force)</button>');

		earthButton.click(function() {
			if (confirm('Generate Earth with MAXIMUM detail?\n\nConfiguration:\n- Detail: 100 subdivisions (~60,000+ tiles)\n- Distortion: 100 (maximum variation)\n\nThis will take 3-5 minutes and auto-save when complete.\n\nWarning: This creates a very large file (10-20 MB).\n\nContinue?')) {
				generateEarthPlanet();
			}
		});

		// Add to control panel
		$('#controlPanel .panel-section:last').before('<div class="panel-section"><div class="section-title">Earth Recreation (Brute Force)</div></div>');
		$('#controlPanel .panel-section:last').prev().append(earthButton);
	}
});
