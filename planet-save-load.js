// Planet Save/Load System
// Provides functionality to save planets to local files and load them back
// Also supports export to D3.js-compatible GeoJSON format

/**
 * Saves a planet in minimal format (seed + settings only)
 * This allows regenerating the exact same planet
 * File size: ~200 bytes
 */
function savePlanetMinimal(planet) {
	var data = {
		version: 1,
		type: 'minimal',
		seed: planet.seed,
		originalSeed: planet.originalSeed,
		settings: {
			subdivisions: generationSettings.subdivisions,
			distortionLevel: generationSettings.distortionLevel,
			plateCount: generationSettings.plateCount,
			oceanicRate: generationSettings.oceanicRate,
			heatLevel: generationSettings.heatLevel,
			moistureLevel: generationSettings.moistureLevel
		}
	};

	return JSON.stringify(data);
}

/**
 * Utility function to round numbers to reduce file size
 */
function roundValue(value, decimals) {
	if (typeof value === 'undefined' || value === null) return value;
	var multiplier = Math.pow(10, decimals);
	return Math.round(value * multiplier) / multiplier;
}

/**
 * Utility function to round Vector3 objects
 */
function roundVector3(vector, decimals) {
	if (!vector) return null;
	return {
		x: roundValue(vector.x, decimals),
		y: roundValue(vector.y, decimals),
		z: roundValue(vector.z, decimals)
	};
}

/**
 * Saves a planet in full format (all topology data)
 * This allows instant loading without regeneration
 * File size: varies by planet complexity (typically 1-5 MB for 60 subdivisions)
 *
 * Size optimization strategies:
 * - Round positions to 5 decimals (~1cm precision on Earth-sized planet)
 * - Round elevations to 4 decimals
 * - Round temperature/moisture to 3 decimals
 * - Store only IDs for references, not full objects
 * - Omit render data and statistics (can be regenerated quickly)
 * - Omit computed properties that can be recalculated (area, normal, boundingSphere)
 */
function savePlanetFull(planet) {
	var data = {
		version: 1,
		type: 'full',
		seed: planet.seed,
		originalSeed: planet.originalSeed,
		settings: {
			subdivisions: generationSettings.subdivisions,
			distortionLevel: generationSettings.distortionLevel,
			plateCount: generationSettings.plateCount,
			oceanicRate: generationSettings.oceanicRate,
			heatLevel: generationSettings.heatLevel,
			moistureLevel: generationSettings.moistureLevel
		},
		topology: serializeTopology(planet.topology),
		plates: serializePlates(planet.plates)
	};

	return JSON.stringify(data);
}

/**
 * Serialize topology data with size optimization
 */
function serializeTopology(topology) {
	return {
		corners: topology.corners.map(serializeCorner),
		borders: topology.borders.map(serializeBorder),
		tiles: topology.tiles.map(serializeTile)
	};
}

/**
 * Serialize a corner with essential data only
 */
function serializeCorner(corner) {
	var data = {
		id: corner.id,
		pos: roundVector3(corner.position, 5),
		// Store only IDs for references
		corners: corner.corners.map(c => c.id),
		borders: corner.borders.map(b => b.id),
		tiles: corner.tiles.map(t => t.id)
	};

	// Optional properties (only include if they exist)
	if (corner.elevation !== undefined) data.elev = roundValue(corner.elevation, 4);
	if (corner.elevationMedian !== undefined) data.elevMed = roundValue(corner.elevationMedian, 4);
	if (corner.elevationDisplacement !== undefined) data.elevDisp = roundValue(corner.elevationDisplacement, 2);
	if (corner.temperature !== undefined) data.temp = roundValue(corner.temperature, 3);
	if (corner.moisture !== undefined) data.moist = roundValue(corner.moisture, 3);
	if (corner.airCurrent) data.air = roundVector3(corner.airCurrent, 3);
	if (corner.pressure !== undefined) data.press = roundValue(corner.pressure, 3);
	if (corner.betweenPlates !== undefined) data.betPlates = corner.betweenPlates;
	if (corner.distanceToPlateBoundary !== undefined) data.distBound = roundValue(corner.distanceToPlateBoundary, 2);

	return data;
}

/**
 * Serialize a border with essential data only
 */
function serializeBorder(border) {
	var data = {
		id: border.id,
		corners: border.corners.map(c => c.id),
		tiles: border.tiles.map(t => t.id),
		borders: border.borders.map(b => b.id)
	};

	// Optional properties
	if (border.betweenPlates !== undefined) data.betPlates = border.betweenPlates;
	if (border.elevationDisplacement !== undefined) data.elevDisp = roundValue(border.elevationDisplacement, 2);
	if (border.flow !== undefined) data.flow = roundValue(border.flow, 5);

	return data;
}

/**
 * Serialize a tile with essential data only
 */
function serializeTile(tile) {
	var data = {
		id: tile.id,
		pos: roundVector3(tile.position, 5),
		corners: tile.corners.map(c => c.id),
		borders: tile.borders.map(b => b.id),
		tiles: tile.tiles.map(t => t.id)
	};

	// Essential terrain properties
	if (tile.elevation !== undefined) data.elev = roundValue(tile.elevation, 4);
	if (tile.elevationDisplacement !== undefined) data.elevDisp = roundValue(tile.elevationDisplacement, 2);
	if (tile.temperature !== undefined) data.temp = roundValue(tile.temperature, 3);
	if (tile.moisture !== undefined) data.moist = roundValue(tile.moisture, 3);
	if (tile.biome) data.biome = tile.biome;
	if (tile.plate) data.plate = tile.plate.id || 0;

	// Optional geographic properties
	if (tile.averagePosition) data.avgPos = roundVector3(tile.averagePosition, 5);
	if (tile.plateMovement) data.plateMove = roundVector3(tile.plateMovement, 3);

	// Water flow properties
	if (tile.river) data.river = true;
	if (tile.lake) data.lake = true;
	if (tile.drain) data.drain = tile.drain.id;
	if (tile.upstream && tile.upstream.length > 0) data.upstream = tile.upstream.map(t => t.id);
	if (tile.downstream && tile.downstream.length > 0) data.downstream = tile.downstream.map(t => t.id);
	if (tile.sources && tile.sources.length > 0) data.sources = tile.sources.map(t => t.id);
	if (tile.shore !== undefined) data.shore = tile.shore;

	// Resource properties (rounded to 2 decimals for file size)
	if (tile.wheat) data.wheat = roundValue(tile.wheat, 1);
	if (tile.corn) data.corn = roundValue(tile.corn, 1);
	if (tile.rice) data.rice = roundValue(tile.rice, 1);
	if (tile.pasture) data.pasture = roundValue(tile.pasture, 2);
	if (tile.timber) data.timber = roundValue(tile.timber, 2);
	if (tile.fish) data.fish = roundValue(tile.fish, 2);
	if (tile.gold) data.gold = roundValue(tile.gold, 3);
	if (tile.iron) data.iron = roundValue(tile.iron, 3);
	if (tile.oil) data.oil = roundValue(tile.oil, 3);
	if (tile.bauxite) data.bauxite = roundValue(tile.bauxite, 3);
	if (tile.copper) data.copper = roundValue(tile.copper, 3);
	if (tile.calories) data.calories = roundValue(tile.calories, 0);

	// City and label properties
	if (tile.isCity) data.isCity = true;
	if (tile.cityLabel) data.cityLabel = tile.cityLabel;
	if (tile.label) data.label = tile.label;

	return data;
}

/**
 * Serialize plates data
 */
function serializePlates(plates) {
	return plates.map(function(plate, index) {
		// Assign plate IDs if not already set
		if (!plate.id) plate.id = index;

		return {
			id: plate.id,
			color: '#' + plate.color.getHexString(),
			driftAxis: roundVector3(plate.driftAxis, 5),
			driftRate: roundValue(plate.driftRate, 5),
			spinRate: roundValue(plate.spinRate, 5),
			elevation: roundValue(plate.elevation, 3),
			oceanic: plate.oceanic,
			root: plate.root.id
		};
	});
}

/**
 * Load a planet from minimal format (requires regeneration)
 */
function loadPlanetMinimal(data, callback) {
	// Set generation settings
	generationSettings.subdivisions = data.settings.subdivisions;
	generationSettings.distortionLevel = data.settings.distortionLevel;
	generationSettings.plateCount = data.settings.plateCount;
	generationSettings.oceanicRate = data.settings.oceanicRate;
	generationSettings.heatLevel = data.settings.heatLevel;
	generationSettings.moistureLevel = data.settings.moistureLevel;
	generationSettings.seed = data.seed;

	// Regenerate the planet
	generatePlanetAsynchronous();

	if (callback) callback();
}

/**
 * Load a planet from full format (instant, no regeneration needed)
 */
function loadPlanetFull(data, callback) {
	// Create a new planet object
	var loadedPlanet = new Planet();
	loadedPlanet.seed = data.seed;
	loadedPlanet.originalSeed = data.originalSeed;

	// Deserialize topology
	loadedPlanet.topology = deserializeTopology(data.topology);

	// Deserialize plates
	loadedPlanet.plates = deserializePlates(data.plates, loadedPlanet.topology);

	// Link plate references in tiles
	linkPlateReferences(loadedPlanet.topology.tiles, loadedPlanet.plates);

	// Generate statistics
	var action = new SteppedAction(updateProgressUI);
	action
		.executeSubaction(function(a) {
			generatePlanetStatistics(loadedPlanet.topology, loadedPlanet.plates, a);
		}, 1, "Compiling Statistics")
		.getResult(function(result) {
			loadedPlanet.statistics = result;
		})
		.executeSubaction(function(a) {
			// Generate render data
			var random = new XorShift128(data.seed);
			generatePlanetRenderData(loadedPlanet.topology, random, a);
		}, 1, "Building Visuals")
		.getResult(function(result) {
			loadedPlanet.renderData = result;
		})
		.finalize(function() {
			// Display the loaded planet
			displayPlanet(loadedPlanet);
			if (callback) callback();
		})
		.execute();
}

/**
 * Deserialize topology data
 */
function deserializeTopology(data) {
	// First pass: create all objects
	var corners = data.corners.map(deserializeCorner);
	var borders = data.borders.map(deserializeBorder);
	var tiles = data.tiles.map(deserializeTile);

	// Second pass: link references
	linkTopologyReferences(corners, borders, tiles, data);

	return {
		corners: corners,
		borders: borders,
		tiles: tiles,
		watersheds: []
	};
}

/**
 * Deserialize a corner
 */
function deserializeCorner(data) {
	var corner = new Corner(
		data.id,
		new THREE.Vector3(data.pos.x, data.pos.y, data.pos.z),
		data.corners.length,
		data.borders.length,
		data.tiles.length
	);

	// Restore optional properties
	if (data.elev !== undefined) corner.elevation = data.elev;
	if (data.elevMed !== undefined) corner.elevationMedian = data.elevMed;
	if (data.elevDisp !== undefined) corner.elevationDisplacement = data.elevDisp;
	if (data.temp !== undefined) corner.temperature = data.temp;
	if (data.moist !== undefined) corner.moisture = data.moist;
	if (data.air) corner.airCurrent = new THREE.Vector3(data.air.x, data.air.y, data.air.z);
	if (data.press !== undefined) corner.pressure = data.press;
	if (data.betPlates !== undefined) corner.betweenPlates = data.betPlates;
	if (data.distBound !== undefined) corner.distanceToPlateBoundary = data.distBound;

	// Store reference IDs temporarily for linking
	corner._cornerIds = data.corners;
	corner._borderIds = data.borders;
	corner._tileIds = data.tiles;

	return corner;
}

/**
 * Deserialize a border
 */
function deserializeBorder(data) {
	var border = new Border(
		data.id,
		data.corners.length,
		data.borders.length,
		data.tiles.length
	);

	// Restore optional properties
	if (data.betPlates !== undefined) border.betweenPlates = data.betPlates;
	if (data.elevDisp !== undefined) border.elevationDisplacement = data.elevDisp;
	if (data.flow !== undefined) border.flow = data.flow;

	// Store reference IDs temporarily for linking
	border._cornerIds = data.corners;
	border._tileIds = data.tiles;
	border._borderIds = data.borders;

	return border;
}

/**
 * Deserialize a tile
 */
function deserializeTile(data) {
	var tile = new Tile(
		data.id,
		new THREE.Vector3(data.pos.x, data.pos.y, data.pos.z),
		data.corners.length,
		data.borders.length,
		data.tiles.length
	);

	// Restore essential terrain properties
	if (data.elev !== undefined) tile.elevation = data.elev;
	if (data.elevDisp !== undefined) tile.elevationDisplacement = data.elevDisp;
	if (data.temp !== undefined) tile.temperature = data.temp;
	if (data.moist !== undefined) tile.moisture = data.moist;
	if (data.biome) tile.biome = data.biome;

	// Restore optional geographic properties
	if (data.avgPos) tile.averagePosition = new THREE.Vector3(data.avgPos.x, data.avgPos.y, data.avgPos.z);
	if (data.plateMove) tile.plateMovement = new THREE.Vector3(data.plateMove.x, data.plateMove.y, data.plateMove.z);

	// Restore water flow properties
	if (data.river) tile.river = true;
	if (data.lake) tile.lake = true;
	if (data.shore !== undefined) tile.shore = data.shore;

	// Restore resource properties
	if (data.wheat) tile.wheat = data.wheat;
	if (data.corn) tile.corn = data.corn;
	if (data.rice) tile.rice = data.rice;
	if (data.pasture) tile.pasture = data.pasture;
	if (data.timber) tile.timber = data.timber;
	if (data.fish) tile.fish = data.fish;
	if (data.gold) tile.gold = data.gold;
	if (data.iron) tile.iron = data.iron;
	if (data.oil) tile.oil = data.oil;
	if (data.bauxite) tile.bauxite = data.bauxite;
	if (data.copper) tile.copper = data.copper;
	if (data.calories) tile.calories = data.calories;

	// Restore city and label properties
	if (data.isCity) tile.isCity = true;
	if (data.cityLabel) tile.cityLabel = data.cityLabel;
	if (data.label) tile.label = data.label;

	// Calculate computed properties that can be derived from position
	tile.normal = tile.position.clone().normalize();

	// Store reference IDs temporarily for linking (including plate ID)
	tile._cornerIds = data.corners;
	tile._borderIds = data.borders;
	tile._tileIds = data.tiles;
	tile._plateId = data.plate;
	tile._drainId = data.drain;
	tile._upstreamIds = data.upstream;
	tile._downstreamIds = data.downstream;
	tile._sourceIds = data.sources;

	return tile;
}

/**
 * Link all topology references (convert IDs to object references)
 */
function linkTopologyReferences(corners, borders, tiles, data) {
	// Link corners
	for (var i = 0; i < corners.length; i++) {
		var corner = corners[i];
		for (var j = 0; j < corner._cornerIds.length; j++) {
			corner.corners[j] = corners[corner._cornerIds[j]];
		}
		for (var j = 0; j < corner._borderIds.length; j++) {
			corner.borders[j] = borders[corner._borderIds[j]];
		}
		for (var j = 0; j < corner._tileIds.length; j++) {
			corner.tiles[j] = tiles[corner._tileIds[j]];
		}
		// Clean up temporary IDs
		delete corner._cornerIds;
		delete corner._borderIds;
		delete corner._tileIds;
	}

	// Link borders
	for (var i = 0; i < borders.length; i++) {
		var border = borders[i];
		for (var j = 0; j < border._cornerIds.length; j++) {
			border.corners[j] = corners[border._cornerIds[j]];
		}
		for (var j = 0; j < border._tileIds.length; j++) {
			border.tiles[j] = tiles[border._tileIds[j]];
		}
		for (var j = 0; j < border._borderIds.length; j++) {
			border.borders[j] = borders[border._borderIds[j]];
		}
		// Clean up temporary IDs
		delete border._cornerIds;
		delete border._tileIds;
		delete border._borderIds;
	}

	// Link tiles
	for (var i = 0; i < tiles.length; i++) {
		var tile = tiles[i];
		for (var j = 0; j < tile._cornerIds.length; j++) {
			tile.corners[j] = corners[tile._cornerIds[j]];
		}
		for (var j = 0; j < tile._borderIds.length; j++) {
			tile.borders[j] = borders[tile._borderIds[j]];
		}
		for (var j = 0; j < tile._tileIds.length; j++) {
			tile.tiles[j] = tiles[tile._tileIds[j]];
		}

		// Link water flow references
		if (tile._drainId !== undefined) {
			tile.drain = tiles[tile._drainId];
		}
		if (tile._upstreamIds) {
			tile.upstream = tile._upstreamIds.map(function(id) { return tiles[id]; });
		} else {
			tile.upstream = [];
		}
		if (tile._downstreamIds) {
			tile.downstream = tile._downstreamIds.map(function(id) { return tiles[id]; });
		} else {
			tile.downstream = [];
		}
		if (tile._sourceIds) {
			tile.sources = tile._sourceIds.map(function(id) { return tiles[id]; });
		} else {
			tile.sources = [];
		}

		// Calculate area and bounding sphere from corners
		var area = 0;
		var maxDistanceToCorner = 0;
		tile.averagePosition = tile.averagePosition || new THREE.Vector3(0, 0, 0);

		for (var j = 0; j < tile.corners.length; j++) {
			var distanceToCorner = tile.averagePosition.distanceTo(tile.corners[j].position);
			if (distanceToCorner > maxDistanceToCorner) {
				maxDistanceToCorner = distanceToCorner;
			}
		}

		tile.boundingSphere = new THREE.Sphere(tile.averagePosition, maxDistanceToCorner);

		// Clean up temporary IDs
		delete tile._cornerIds;
		delete tile._borderIds;
		delete tile._tileIds;
		delete tile._drainId;
		delete tile._upstreamIds;
		delete tile._downstreamIds;
		delete tile._sourceIds;
		// Keep _plateId for later linking
	}
}

/**
 * Deserialize plates
 */
function deserializePlates(data, topology) {
	return data.map(function(plateData) {
		var plate = new Plate(
			new THREE.Color(plateData.color),
			new THREE.Vector3(plateData.driftAxis.x, plateData.driftAxis.y, plateData.driftAxis.z),
			plateData.driftRate,
			plateData.spinRate,
			plateData.elevation,
			plateData.oceanic,
			topology.corners[plateData.root]
		);
		plate.id = plateData.id;
		return plate;
	});
}

/**
 * Link plate references in tiles
 */
function linkPlateReferences(tiles, plates) {
	for (var i = 0; i < tiles.length; i++) {
		var tile = tiles[i];
		if (tile._plateId !== undefined) {
			tile.plate = plates[tile._plateId];
			tile.plate.tiles.push(tile);
		}
		delete tile._plateId;
	}
}

/**
 * Download planet data as a file
 */
function downloadPlanetFile(data, filename) {
	var blob = new Blob([data], { type: 'application/json' });
	var url = URL.createObjectURL(blob);
	var a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

/**
 * Save planet to file (auto-detects format based on user preference)
 */
function savePlanetToFile(format) {
	if (!planet) {
		alert('No planet to save!');
		return;
	}

	var data, filename;

	if (format === 'minimal') {
		data = savePlanetMinimal(planet);
		filename = 'planet-' + planet.seed + '-minimal.json';
	} else if (format === 'full') {
		data = savePlanetFull(planet);
		filename = 'planet-' + planet.seed + '-full.json';
	} else if (format === 'geojson') {
		data = exportToGeoJSON(planet);
		filename = 'planet-' + planet.seed + '.geojson';
	} else {
		alert('Unknown format: ' + format);
		return;
	}

	downloadPlanetFile(data, filename);

	console.log('Saved planet as ' + filename);
	console.log('File size: ' + (data.length / 1024).toFixed(2) + ' KB');
}

/**
 * Load planet from file
 */
function loadPlanetFromFile() {
	var input = document.createElement('input');
	input.type = 'file';
	input.accept = '.json,.geojson';

	input.onchange = function(e) {
		var file = e.target.files[0];
		var reader = new FileReader();

		reader.onload = function(event) {
			try {
				var data = JSON.parse(event.target.result);

				if (data.type === 'minimal') {
					loadPlanetMinimal(data);
					console.log('Loaded minimal planet file, regenerating...');
				} else if (data.type === 'full') {
					loadPlanetFull(data);
					console.log('Loaded full planet file');
				} else if (data.type === 'FeatureCollection') {
					// This is a GeoJSON file - not supported for import yet
					alert('GeoJSON import is not yet implemented. Use minimal or full format.');
				} else {
					alert('Unknown planet file format');
				}
			} catch (error) {
				alert('Error loading planet file: ' + error.message);
				console.error('Error loading planet:', error);
			}
		};

		reader.readAsText(file);
	};

	input.click();
}

/**
 * Export planet to D3.js-compatible GeoJSON format
 * This creates a FeatureCollection where each tile is a polygon feature
 */
function exportToGeoJSON(planet) {
	var features = [];

	for (var i = 0; i < planet.topology.tiles.length; i++) {
		var tile = planet.topology.tiles[i];

		// Convert tile corners to GeoJSON coordinates [longitude, latitude]
		var coordinates = [[]];
		for (var j = 0; j < tile.corners.length; j++) {
			var corner = tile.corners[j];
			var spherical = cartesianToSpherical(corner.position);
			// GeoJSON uses [longitude, latitude] in degrees
			var lon = spherical.theta * 180 / Math.PI;
			var lat = spherical.phi * 180 / Math.PI;
			coordinates[0].push([lon, lat]);
		}
		// Close the polygon
		coordinates[0].push(coordinates[0][0]);

		// Create feature with properties
		var feature = {
			type: 'Feature',
			id: tile.id,
			geometry: {
				type: 'Polygon',
				coordinates: coordinates
			},
			properties: {
				elevation: roundValue(tile.elevation, 4),
				temperature: roundValue(tile.temperature, 3),
				moisture: roundValue(tile.moisture, 3),
				biome: tile.biome || 'unknown'
			}
		};

		// Add optional properties
		if (tile.isCity) feature.properties.city = tile.cityLabel || true;
		if (tile.label) feature.properties.label = tile.label;
		if (tile.river) feature.properties.river = true;
		if (tile.lake) feature.properties.lake = true;

		// Add resource properties (if significant)
		if (tile.wheat && tile.wheat > 10) feature.properties.wheat = roundValue(tile.wheat, 1);
		if (tile.corn && tile.corn > 10) feature.properties.corn = roundValue(tile.corn, 1);
		if (tile.rice && tile.rice > 10) feature.properties.rice = roundValue(tile.rice, 1);
		if (tile.fish && tile.fish > 0.1) feature.properties.fish = roundValue(tile.fish, 2);
		if (tile.calories && tile.calories > 100) feature.properties.calories = roundValue(tile.calories, 0);

		features.push(feature);
	}

	var geojson = {
		type: 'FeatureCollection',
		features: features,
		properties: {
			seed: planet.seed,
			generator: 'PlanGen',
			created: new Date().toISOString()
		}
	};

	return JSON.stringify(geojson);
}

/**
 * Utility function to convert Cartesian coordinates to spherical
 * Returns object with theta (longitude in radians) and phi (latitude in radians)
 */
function cartesianToSpherical(position) {
	var r = Math.sqrt(position.x * position.x + position.y * position.y + position.z * position.z);

	// Apply axis rotation to convert to standard geography
	var geo_x = position.z;  // Front-facing becomes prime meridian
	var geo_y = position.x;  // Original X becomes 90°E direction
	var geo_z = position.y;  // North pole becomes Z-axis

	var phi = Math.asin(geo_z / r);      // Standard latitude (-π/2 to π/2)
	var theta = Math.atan2(geo_y, geo_x); // Standard longitude (-π to π)

	return { theta: theta, phi: phi };
}
