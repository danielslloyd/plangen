// Three.js r125 compatibility shims
THREE.Face3 = function(a, b, c, normal, color, materialIndex) {
	this.a = a;
	this.b = b;
	this.c = c;
	this.normal = normal;
	this.color = color;
	this.materialIndex = materialIndex;
};

// Compatibility function to convert legacy vertices/faces to BufferGeometry
function convertLegacyGeometry(geometry, faceColors) {
	if (!geometry.vertices || !geometry.faces) {
		console.log("convertLegacyGeometry: No vertices or faces to convert");
		return;
	}
	
	console.log("convertLegacyGeometry: Converting", geometry.vertices.length, "vertices and", geometry.faces.length, "faces");
	
	var vertices = [];
	var colors = [];
	var normals = [];
	var indices = [];
	
	// Convert vertices to flat array
	for (var i = 0; i < geometry.vertices.length; i++) {
		var vertex = geometry.vertices[i];
		vertices.push(vertex.x, vertex.y, vertex.z);
	}
	
	// Convert faces and handle colors
	for (var i = 0; i < geometry.faces.length; i++) {
		var face = geometry.faces[i];
		if (face.a !== undefined && face.b !== undefined && face.c !== undefined) {
			// Try reversing face winding to fix inside-out faces
			indices.push(face.c, face.b, face.a);
			
			// Handle face colors - each face can have vertex colors or a single color
			if (face.color && Array.isArray(face.color)) {
				// Face has per-vertex colors
				for (var j = 0; j < 3; j++) {
					if (face.color[j]) {
						colors[face.a * 3 + j] = face.color[j].r;
						colors[face.b * 3 + j] = face.color[j].g; 
						colors[face.c * 3 + j] = face.color[j].b;
					}
				}
			} else if (face.color) {
				// Face has single color
				var faceColor = face.color;
				colors[face.a * 3] = faceColor.r; colors[face.a * 3 + 1] = faceColor.g; colors[face.a * 3 + 2] = faceColor.b;
				colors[face.b * 3] = faceColor.r; colors[face.b * 3 + 1] = faceColor.g; colors[face.b * 3 + 2] = faceColor.b;
				colors[face.c * 3] = faceColor.r; colors[face.c * 3 + 1] = faceColor.g; colors[face.c * 3 + 2] = faceColor.b;
			} else if (faceColors && faceColors[i]) {
				// Use external face colors array
				var extColor = faceColors[i];
				colors[face.a * 3] = extColor.r; colors[face.a * 3 + 1] = extColor.g; colors[face.a * 3 + 2] = extColor.b;
				colors[face.b * 3] = extColor.r; colors[face.b * 3 + 1] = extColor.g; colors[face.b * 3 + 2] = extColor.b;
				colors[face.c * 3] = extColor.r; colors[face.c * 3 + 1] = extColor.g; colors[face.c * 3 + 2] = extColor.b;
			}
		}
	}
	
	// Fill any missing colors with white
	for (var i = 0; i < vertices.length; i++) {
		if (colors[i] === undefined) {
			colors[i] = 1.0;
		}
	}
	
	// Set buffer attributes
	geometry.setIndex(indices);
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
	geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
	geometry.computeVertexNormals();
}

function buildSurfaceRenderObject(tiles, watersheds, random, action) {
	console.log("=== MODERN BUFFER GEOMETRY CREATION ===");
	console.log("tiles.length:", tiles.length);
	
	// Calculate geometry requirements (simple triangle fan per tile)
	var totalVertices = 0;
	var totalFaces = 0;
	
	for (var i = 0; i < tiles.length; i++) {
		var cornersCount = tiles[i].corners.length;
		totalVertices += 1 + cornersCount; // 1 center + N corners
		totalFaces += cornersCount; // N triangles (triangle fan)
	}
	
	console.log("Estimated vertices:", totalVertices);
	console.log("Estimated faces:", totalFaces);
	
	// Pre-allocate typed arrays for BufferGeometry
	var positions = new Float32Array(totalVertices * 3);
	var colors = new Float32Array(totalVertices * 3);
	var indices = new Uint32Array(totalFaces * 3);
	
	var vertexIndex = 0;
	var triangleIndex = 0;
	
	var minShore = Math.min.apply(0, tiles.map((data) => data.shore));
	var maxShore = Math.max.apply(0, tiles.map((data) => data.shore));
	var minBody = Math.min.apply(0, tiles.map((data) => data.body.id));
	var maxBody = Math.max.apply(0, tiles.map((data) => data.body.id));
	let maxSediment = Math.max(...tiles.map(t => t.sediment? t.sediment:0));

	var i = 0;
	action.executeSubaction(function (action) {
		if (i >= tiles.length) return;

		//if (i % 100 === 0) {
		//	console.log("Processing tile", i, "of", tiles.length);
		//}

		var tile = tiles[i];
		
		// Calculate terrain color using extracted function
		var terrainColor = calculateTerrainColor(tile);
		
		// Store tile center index
		var centerIndex = vertexIndex;
		
		// Add center vertex
		var centerPos = tile.averagePosition.clone();
		if (tile.elevation > 0) {
			var centerDistance = centerPos.length();
			centerPos.normalize().multiplyScalar(centerDistance + (useElevationDisplacement ? tile.elevationDisplacement : 0));
		}
		
		// Add center position
		positions[vertexIndex * 3] = centerPos.x;
		positions[vertexIndex * 3 + 1] = centerPos.y;
		positions[vertexIndex * 3 + 2] = centerPos.z;
		
		// Add center color  
		colors[vertexIndex * 3] = terrainColor.r;
		colors[vertexIndex * 3 + 1] = terrainColor.g;
		colors[vertexIndex * 3 + 2] = terrainColor.b;
		
		vertexIndex++;
		
		// Add corner vertices and create triangle fan
		for (var j = 0; j < tile.corners.length; j++) {
			var corner = tile.corners[j];
			var cornerPos = corner.position.clone();
			
			// Apply elevation to corners
			var hasOceanTile = false;
			for (var k = 0; k < corner.tiles.length; k++) {
				if (corner.tiles[k].elevation <= 0) {
					hasOceanTile = true;
					break;
				}
			}
			
			if (!hasOceanTile && corner.elevationMedian > 0) {
				var cornerDistance = cornerPos.length();
				cornerPos.normalize().multiplyScalar(cornerDistance + (useElevationDisplacement ? corner.elevationDisplacement : 0));
			}
			
			// Add corner position
			positions[vertexIndex * 3] = cornerPos.x;
			positions[vertexIndex * 3 + 1] = cornerPos.y;
			positions[vertexIndex * 3 + 2] = cornerPos.z;
			
			// Add corner color (same as center for now)
			colors[vertexIndex * 3] = terrainColor.r;
			colors[vertexIndex * 3 + 1] = terrainColor.g;
			colors[vertexIndex * 3 + 2] = terrainColor.b;
			
			// Create triangle: center -> corner[j] -> corner[j+1]
			var nextJ = (j + 1) % tile.corners.length;
			indices[triangleIndex * 3] = centerIndex;
			indices[triangleIndex * 3 + 1] = vertexIndex;
			indices[triangleIndex * 3 + 2] = centerIndex + 1 + nextJ;
			
			triangleIndex++;
			vertexIndex++;
		}
		
		++i;

		action.loop(i / tiles.length);
	});

	// Create BufferGeometry directly (no conversion needed)
	//console.log("=== CREATING MODERN BUFFER GEOMETRY ===");
	//console.log("Final vertexIndex:", vertexIndex);
	//console.log("Final triangleIndex:", triangleIndex);
	
	var planetGeometry = new THREE.BufferGeometry();
	
	// Set buffer attributes directly
	planetGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	planetGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	planetGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
	
	// Compute normals for proper lighting
	planetGeometry.computeVertexNormals();
	planetGeometry.computeBoundingBox();
	
	/* console.log("=== MODERN GEOMETRY VALIDATION ===");
	console.log("Position attribute:", planetGeometry.getAttribute('position'));
	console.log("Color attribute:", planetGeometry.getAttribute('color'));
	console.log("Index:", planetGeometry.getIndex());
	if (planetGeometry.getAttribute('position')) {
		console.log("Vertex count:", planetGeometry.getAttribute('position').count);
	}
	if (planetGeometry.getIndex()) {
		console.log("Index count:", planetGeometry.getIndex().count);
		console.log("Face count:", planetGeometry.getIndex().count / 3);
	}
	console.log("Bounding box:", planetGeometry.boundingBox);
	console.log("=== END VALIDATION ==="); */
	
	// Create material with vertex colors - set color to white so it doesn't interfere
	var planetMaterial = new THREE.MeshBasicMaterial({
		vertexColors: true,
		wireframe: false,
		side: THREE.DoubleSide,
		color: 0xFFFFFF  // White base color doesn't affect vertex colors
	});
	
	//console.log("Using vertex color material for terrain visualization");
	var planetRenderObject = new THREE.Mesh(planetGeometry, planetMaterial);
	console.log("Created planetRenderObject:", planetRenderObject);
	
 	// Add a simple test cube to verify basic rendering works
/* 	var testGeometry = new THREE.BoxGeometry(100, 100, 100);
	var testMaterial = new THREE.MeshBasicMaterial({ color: 0x00FFFF, wireframe: true });
	var testCube = new THREE.Mesh(testGeometry, testMaterial);
	testCube.position.set(1500, 0, 0); // Position it off to the side
	console.log("Adding test cube at position:", testCube.position);
*/
	action.provideResult({
		geometry: planetGeometry,
		material: planetMaterial,
		renderObject: planetRenderObject,
		//testCube: testCube  // Add test cube for debugging
	});  
}

function buildPlateBoundariesRenderObject(borders, action) {
	var geometry = new THREE.BufferGeometry();
	geometry.vertices = [];
	geometry.faces = [];

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

	// Convert legacy geometry to BufferGeometry
	convertLegacyGeometry(geometry);
	
	geometry.boundingSphere = new THREE.Sphere(new Vector3(0, 0, 0), 1000 + elevationMultiplier + 60);
	var material = new THREE.MeshBasicMaterial({
		vertexColors: true,
	});
	var renderObject = new THREE.Mesh(geometry, material);

	action.provideResult({
		geometry: geometry,
		material: material,
		renderObject: renderObject,
	});
}

function buildPlateMovementsRenderObject(tiles, action) {
	var geometry = new THREE.BufferGeometry();
	geometry.vertices = [];
	geometry.faces = [];

	var i = 0;
	action.executeSubaction(function (action) {
		if (i >= tiles.length) return;

		var tile = tiles[i];
		var plate = tile.plate;
		var movement = plate.calculateMovement(tile.position);
		var plateMovementColor = new THREE.Color(1 - plate.r, 1 - plate.color.g, 1 - plate.color.b);

		// Calculate elevated position for arrow start
		var arrowPosition = tile.position.clone();
		if (tile.elevation > 0) {
			// Use stored elevation displacement
			var distance = arrowPosition.length();
			arrowPosition.normalize().multiplyScalar(distance + (useElevationDisplacement ? tile.elevationDisplacement : 0) + 2);
		} else {
			arrowPosition.multiplyScalar(1.002);
		}
		
		buildArrow(geometry, arrowPosition, movement.clone().multiplyScalar(0.5), tile.position.clone().normalize(), Math.min(movement.length(), 4), plateMovementColor);

		tile.plateMovement = movement;

		++i;

		action.loop(i / tiles.length);
	});

	// Convert legacy geometry to BufferGeometry
	convertLegacyGeometry(geometry);

	geometry.boundingSphere = new THREE.Sphere(new Vector3(0, 0, 0), 1000 + elevationMultiplier + 60);
	var material = new THREE.MeshBasicMaterial({
		vertexColors: true,
	});
	var renderObject = new THREE.Mesh(geometry, material);

	action.provideResult({
		geometry: geometry,
		material: material,
		renderObject: renderObject,
	});
}

function buildAirCurrentsRenderObject(corners, action) {
	console.log("Building air currents with synchronous processing");
	
	// Use line-based arrows for cleaner air current visualization
	var positions = [];
	var colors = [];

	var totalCorners = corners.length;
	var cornersWithAirCurrent = 0;
	var cornersAboveThreshold = 0;
	
	// Process all corners synchronously
	for (var i = 0; i < corners.length; i++) {
		var corner = corners[i];
		
		if (corner.airCurrent) cornersWithAirCurrent++;
		if (corner.airCurrent && corner.airCurrent.length() >= 0.05) cornersAboveThreshold++;
		
		// Skip corners without significant air current
		if (!corner.airCurrent || corner.airCurrent.length() < 0.05) {
			continue;
		}
		
		// Position air currents at atmospheric level (above terrain but not too high)
		var basePosition = corner.position.clone();
		var airCurrentAltitude = 1050; // Just above terrain
		basePosition.normalize().multiplyScalar(airCurrentAltitude);
		
		// Calculate arrow properties
		var airDirection = corner.airCurrent.clone().normalize();
		var airStrength = Math.min(corner.airCurrent.length() * 20, 25); // Scale for visibility
		
		// Create arrow shaft (line from base to tip)
		var tipPosition = basePosition.clone().add(airDirection.clone().multiplyScalar(airStrength));
		
		// Arrow shaft
		positions.push(basePosition.x, basePosition.y, basePosition.z);
		positions.push(tipPosition.x, tipPosition.y, tipPosition.z);
		
		// Create perpendicular vectors for arrowhead
		var perpendicular1 = new THREE.Vector3();
		var perpendicular2 = new THREE.Vector3();
		
		// Find two perpendicular directions for arrowhead
		var upVector = corner.position.clone().normalize(); // Surface normal
		perpendicular1.crossVectors(airDirection, upVector).normalize();
		perpendicular2.crossVectors(airDirection, perpendicular1).normalize();
		
		// Create arrowhead lines
		var arrowheadSize = airStrength * 0.3;
		var arrowheadBack = airDirection.clone().multiplyScalar(-arrowheadSize * 0.7);
		
		// Arrowhead line 1
		var arrowhead1 = tipPosition.clone().add(arrowheadBack).add(perpendicular1.clone().multiplyScalar(arrowheadSize * 0.5));
		positions.push(tipPosition.x, tipPosition.y, tipPosition.z);
		positions.push(arrowhead1.x, arrowhead1.y, arrowhead1.z);
		
		// Arrowhead line 2
		var arrowhead2 = tipPosition.clone().add(arrowheadBack).add(perpendicular2.clone().multiplyScalar(arrowheadSize * 0.5));
		positions.push(tipPosition.x, tipPosition.y, tipPosition.z);
		positions.push(arrowhead2.x, arrowhead2.y, arrowhead2.z);
		
		// Arrowhead line 3
		var arrowhead3 = tipPosition.clone().add(arrowheadBack).add(perpendicular1.clone().multiplyScalar(-arrowheadSize * 0.5));
		positions.push(tipPosition.x, tipPosition.y, tipPosition.z);
		positions.push(arrowhead3.x, arrowhead3.y, arrowhead3.z);
		
		// Arrowhead line 4
		var arrowhead4 = tipPosition.clone().add(arrowheadBack).add(perpendicular2.clone().multiplyScalar(-arrowheadSize * 0.5));
		positions.push(tipPosition.x, tipPosition.y, tipPosition.z);
		positions.push(arrowhead4.x, arrowhead4.y, arrowhead4.z);
		
		// Color based on air current strength (white to cyan gradient)
		var intensity = Math.min(corner.airCurrent.length() * 5, 1);
		var arrowColor = [0.8 + intensity * 0.2, 0.9 + intensity * 0.1, 1]; // Light blue to white
		
		// Add colors for all line segments (10 vertices = 5 line segments)
		for (var j = 0; j < 10; j++) {
			colors.push(arrowColor[0], arrowColor[1], arrowColor[2]);
		}
	}

	// Create BufferGeometry for line rendering  
	var geometry = new THREE.BufferGeometry();
	
	console.log("=== AIR CURRENT DEBUG STATS ===");
	console.log("Total corners:", totalCorners);
	console.log("Corners with airCurrent:", cornersWithAirCurrent);
	console.log("Corners above threshold (>= 0.05):", cornersAboveThreshold);
	console.log("Air currents created with", positions.length / 20, "arrows (", positions.length / 2, "line segments)");
	
	if (positions.length > 0) {
		// Create buffer attributes
		geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
		
		// Compute bounding sphere
		geometry.computeBoundingSphere();
		
		console.log("Air currents BufferGeometry created successfully");
	} else {
		console.log("No air current data found - empty geometry created");
	}

	// Use LineSegments with vertex colors for clean arrow visualization
	var material = new THREE.LineBasicMaterial({
		vertexColors: true,
		linewidth: 1,
		transparent: true,
		opacity: 0.7
	});

	var renderObject = new THREE.LineSegments(geometry, material);

	action.provideResult({
		geometry: geometry,
		material: material,
		renderObject: renderObject,
	});
}

function buildRiversRenderObject(tiles, action) {
	console.log("Building rivers with modern BufferGeometry approach");
	
	// Use LineSegments for cleaner river visualization
	var positions = [];
	var colors = [];
	
	var totalRiverTiles = 0;
	var totalTiles = tiles.length;
	
	// Process all tiles synchronously
	for (var i = 0; i < tiles.length; i++) {
		var tile = tiles[i];
		if (tile.river) totalRiverTiles++;
		
		if (tile.river && tile.riverSources && tile.drain) {
			// Create river flow lines from each source through tile to drain
			for (var j = 0; j < tile.riverSources.length; j++) {
				var source = tile.riverSources[j];
				
				// Calculate proper elevated positions following terrain
				var sourcePos = source.averagePosition.clone();
				var tilePos = tile.averagePosition.clone();
				var drainPos = tile.drain.averagePosition.clone();
				
				// Apply elevation with small offset above terrain
				if (source.elevation > 0) {
					var sourceDistance = sourcePos.length();
					sourcePos.normalize().multiplyScalar(sourceDistance + source.elevation * elevationMultiplier + 3);
				} else {
					sourcePos.multiplyScalar(1.003);
				}
				
				if (tile.elevation > 0) {
					var tileDistance = tilePos.length();
					tilePos.normalize().multiplyScalar(tileDistance + tile.elevation * elevationMultiplier + 3);
				} else {
					tilePos.multiplyScalar(1.003);
				}
				
				if (tile.drain.elevation > 0) {
					var drainDistance = drainPos.length();
					drainPos.normalize().multiplyScalar(drainDistance + tile.drain.elevation * elevationMultiplier + 3);
				} else {
					drainPos.multiplyScalar(1.003);
				}
				
				// Create two line segments: source->tile and tile->drain
				// Source to tile segment
				positions.push(sourcePos.x, sourcePos.y, sourcePos.z);
				positions.push(tilePos.x, tilePos.y, tilePos.z);
				
				// Tile to drain segment
				positions.push(tilePos.x, tilePos.y, tilePos.z);
				positions.push(drainPos.x, drainPos.y, drainPos.z);
				
				// Calculate elevation drops for waterfall detection
				var sourceTileDrop = (source.elevation || 0) - (tile.elevation || 0);
				var tileDrainDrop = (tile.elevation || 0) - (tile.drain.elevation || 0);
				var waterfallThreshold = riverElevationDeltaThreshold || 0.1;
				
				// Color based on elevation drop (waterfalls are white, normal rivers are blue)
				var sourceColor = sourceTileDrop >= waterfallThreshold ? [1, 1, 1] : [0.2, 0.6, 1];
				var drainColor = tileDrainDrop >= waterfallThreshold ? [1, 1, 1] : [0.2, 0.6, 1];
				
				// Add colors for source->tile segment
				colors.push(sourceColor[0], sourceColor[1], sourceColor[2]); // Source
				colors.push(sourceColor[0], sourceColor[1], sourceColor[2]); // Tile
				
				// Add colors for tile->drain segment
				colors.push(drainColor[0], drainColor[1], drainColor[2]); // Tile
				colors.push(drainColor[0], drainColor[1], drainColor[2]); // Drain
			}
		}
	}

	// Create BufferGeometry for line rendering
	var geometry = new THREE.BufferGeometry();
	
	console.log("=== RIVER DEBUG STATS ===");
	console.log("Total tiles:", totalTiles);
	console.log("Tiles with river=true:", totalRiverTiles);
	console.log("Rivers created with", positions.length / 6, "river segments (", positions.length / 3, "vertices)");
	console.log("River threshold (percentile):", riverThreshold);
	
	if (positions.length > 0) {
		// Create buffer attributes
		geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
		
		// Compute bounding sphere
		geometry.computeBoundingSphere();
		
		console.log("Rivers BufferGeometry created successfully");
	} else {
		console.log("No river data found - empty geometry created");
	}

	// Use LineSegments with vertex colors for clean river lines
	var material = new THREE.LineBasicMaterial({
		vertexColors: true,
		linewidth: 2,
		transparent: true,
		opacity: 0.8
	});

	var renderObject = new THREE.LineSegments(geometry, material);

	action.provideResult({
		geometry: geometry,
		material: material,
		renderObject: renderObject,
	});
}

// Utility functions for terrain-following arrow rendering

// Utility function to find the border between two adjacent tiles
function findBorderBetweenTiles(tile1, tile2) {
	// Search through tile1's borders to find one that connects to tile2
	for (var i = 0; i < tile1.borders.length; i++) {
		var border = tile1.borders[i];
		// Check if this border connects tile1 to tile2
		if ((border.tiles[0] === tile1 && border.tiles[1] === tile2) ||
			(border.tiles[0] === tile2 && border.tiles[1] === tile1)) {
			return border;
		}
	}
	return null; // No border found (tiles not adjacent)
}

// Utility function to calculate elevation at the border between two tiles
function calculateBorderElevation(tile1, tile2) {
	// Find the shared corners between the two tiles
	var sharedCorners = [];
	for (var i = 0; i < tile1.corners.length; i++) {
		for (var j = 0; j < tile2.corners.length; j++) {
			if (tile1.corners[i] === tile2.corners[j]) {
				sharedCorners.push(tile1.corners[i]);
			}
		}
	}
	
	if (sharedCorners.length === 0) {
		// No shared border, use average of tile elevations
		return (tile1.elevation + tile2.elevation) / 2;
	}
	
	// Calculate average elevation of shared corners (using elevationMedian)
	var totalElevation = 0;
	var validCorners = 0;
	for (var k = 0; k < sharedCorners.length; k++) {
		if (typeof sharedCorners[k].elevationMedian !== 'undefined') {
			totalElevation += sharedCorners[k].elevationMedian;
			validCorners++;
		}
	}
	
	if (validCorners > 0) {
		return totalElevation / validCorners;
	} else {
		// Fallback to average of tile elevations
		return (tile1.elevation + tile2.elevation) / 2;
	}
}

// Utility function to build segmented arrows for better terrain following
function buildSegmentedArrow(geometry, fromTile, toTile, direction, baseWidth, color) {
	// Find the actual border between the two tiles
	var border = findBorderBetweenTiles(fromTile, toTile);
	var borderDisplacement = 0;
	
	if (border && useElevationDisplacement) {
		// Use the pre-calculated border displacement
		borderDisplacement = border.elevationDisplacement;
	}
	
	// Calculate border elevation for fallback (still needed for elevation check)
	var borderElevation = calculateBorderElevation(fromTile, toTile);
	
	// Calculate positions with elevation
	var fromPos = fromTile.averagePosition.clone();
	var toPos = toTile.averagePosition.clone();
	
	// Use actual border geographic position instead of interpolating between tile centers
	var midPos;
	if (border && border.midpoint) {
		// Use the actual border midpoint (average of border corners)
		midPos = border.midpoint.clone();
	} else {
		// Fallback to interpolation if border not found
		midPos = fromPos.clone().add(toPos).multiplyScalar(0.5);
	}
	
	// Apply elevation displacement
	if (fromTile.elevation > 0) {
		var fromDistance = fromPos.length();
		fromPos.normalize().multiplyScalar(fromDistance + (useElevationDisplacement ? fromTile.elevationDisplacement : 0) + 2);
	} else {
		fromPos.multiplyScalar(1.002);
	}
	
	if (toTile.elevation > 0) {
		var toDistance = toPos.length();
		toPos.normalize().multiplyScalar(toDistance + (useElevationDisplacement ? toTile.elevationDisplacement : 0) + 2);
	} else {
		toPos.multiplyScalar(1.002);
	}
	
	// Apply border displacement to midpoint
	if (borderElevation > 0) {
		var midDistance = midPos.length();
		// Use the stored border displacement (calculated during terrain generation)
		midPos.normalize().multiplyScalar(midDistance + borderDisplacement + 2);
	} else {
		midPos.multiplyScalar(1.002);
	}
	
	// Build arrow segments: fromPos -> midPos (always), midPos -> toPos (only if not ocean)
	var firstSegment = midPos.clone().sub(fromPos);
	
	// Always create first segment (from source to border)
	buildArrow(geometry, fromPos, firstSegment, fromTile.averagePosition.clone().normalize(), baseWidth, color);
	
	// Only create second segment if downstream tile is not ocean
	if (toTile.elevation > 0) {
		var secondSegment = toPos.clone().sub(midPos);
		buildArrow(geometry, midPos, secondSegment, toTile.averagePosition.clone().normalize(), baseWidth, color);
	}
}

function buildSegmentedArrowWithWaterfalls(geometry, fromTile, toTile, direction, baseWidth, waterfallThreshold) {
	// Find the actual border between the two tiles
	var border = findBorderBetweenTiles(fromTile, toTile);
	var borderDisplacement = 0;
	
	if (border && useElevationDisplacement) {
		// Use the pre-calculated border displacement
		borderDisplacement = border.elevationDisplacement;
	}
	
	// Calculate border elevation for fallback (still needed for elevation check)
	var borderElevation = calculateBorderElevation(fromTile, toTile);
	
	// Calculate positions with elevation
	var fromPos = fromTile.averagePosition.clone();
	var toPos = toTile.averagePosition.clone();
	
	// Use actual border geographic position instead of interpolating between tile centers
	var midPos;
	if (border && border.midpoint) {
		// Use the actual border midpoint (average of border corners)
		midPos = border.midpoint.clone();
	} else {
		// Fallback to interpolation if border not found
		midPos = fromPos.clone().add(toPos).multiplyScalar(0.5);
	}
	
	// Apply elevation displacement
	if (fromTile.elevation > 0) {
		var fromDistance = fromPos.length();
		fromPos.normalize().multiplyScalar(fromDistance + (useElevationDisplacement ? fromTile.elevationDisplacement : 0) + 2);
	} else {
		fromPos.multiplyScalar(1.002);
	}
	
	if (toTile.elevation > 0) {
		var toDistance = toPos.length();
		toPos.normalize().multiplyScalar(toDistance + (useElevationDisplacement ? toTile.elevationDisplacement : 0) + 2);
	} else {
		toPos.multiplyScalar(1.002);
	}
	
	// Apply border displacement to midpoint
	if (borderElevation > 0) {
		var midDistance = midPos.length();
		// Use the stored border displacement (calculated during terrain generation)
		midPos.normalize().multiplyScalar(midDistance + borderDisplacement + 2);
	} else {
		midPos.multiplyScalar(1.002);
	}
	
	// Calculate elevation drops for each segment independently
	var firstSegmentDrop = fromTile.elevation - Math.max(0, borderElevation);
	var secondSegmentDrop = Math.max(0, borderElevation) - Math.max(0, toTile.elevation);
	
	// Determine colors for each segment
	var firstSegmentColor = firstSegmentDrop >= waterfallThreshold ? new THREE.Color(0xFFFFFF) : new THREE.Color(0x003F85);
	var secondSegmentColor = secondSegmentDrop >= waterfallThreshold ? new THREE.Color(0xFFFFFF) : new THREE.Color(0x003F85);
	
	// Build arrow segments with individual colors
	var firstSegment = midPos.clone().sub(fromPos);
	
	// Always create first segment (from source to border)
	buildArrow(geometry, fromPos, firstSegment, fromTile.averagePosition.clone().normalize(), baseWidth, firstSegmentColor);
	
	// Only create second segment if downstream tile is not ocean
	if (toTile.elevation > 0) {
		var secondSegment = toPos.clone().sub(midPos);
		buildArrow(geometry, midPos, secondSegment, toTile.averagePosition.clone().normalize(), baseWidth, secondSegmentColor);
	}
}

function buildInflowRiverArrows(geometry, sourceTile, centerTile, drainTile, baseWidth, waterfallThreshold) {
	// Draw two arrows entirely within the centerTile:
	// 1. From source border to tile center
	// 2. From tile center to drain border
	
	// Find the borders
	var sourceBorder = findBorderBetweenTiles(sourceTile, centerTile);
	var drainBorder = findBorderBetweenTiles(centerTile, drainTile);
	
	if (!sourceBorder || !drainBorder) {
		// Fallback to old rendering if borders not found
		console.warn("Could not find borders for inflow river rendering");
		return;
	}
	
	// Calculate positions
	var centerPos = centerTile.averagePosition.clone();
	
	// Source border position (where water flows in)
	var sourceBorderPos;
	if (sourceBorder.midpoint) {
		sourceBorderPos = sourceBorder.midpoint.clone();
	} else {
		// Fallback to corner average
		sourceBorderPos = sourceBorder.corners[0].position.clone().add(sourceBorder.corners[1].position).multiplyScalar(0.5);
	}
	
	// Drain border position (where water flows out)
	var drainBorderPos;
	if (drainBorder.midpoint) {
		drainBorderPos = drainBorder.midpoint.clone();
	} else {
		// Fallback to corner average
		drainBorderPos = drainBorder.corners[0].position.clone().add(drainBorder.corners[1].position).multiplyScalar(0.5);
	}
	
	// Apply elevation displacement
	if (centerTile.elevation > 0) {
		var centerDistance = centerPos.length();
		centerPos.normalize().multiplyScalar(centerDistance + (useElevationDisplacement ? centerTile.elevationDisplacement : 0) + 2);
	} else {
		centerPos.multiplyScalar(1.002);
	}
	
	// Apply elevation to source border
	var sourceBorderElevation = calculateBorderElevation(sourceTile, centerTile);
	if (sourceBorderElevation > 0) {
		var sourceBorderDistance = sourceBorderPos.length();
		var sourceBorderDisplacement = sourceBorder.elevationDisplacement || sourceBorderElevation * elevationMultiplier;
		sourceBorderPos.normalize().multiplyScalar(sourceBorderDistance + (useElevationDisplacement ? sourceBorderDisplacement : 0) + 2);
	} else {
		sourceBorderPos.multiplyScalar(1.002);
	}
	
	// Apply elevation to drain border  
	var drainBorderElevation = calculateBorderElevation(centerTile, drainTile);
	if (drainBorderElevation > 0) {
		var drainBorderDistance = drainBorderPos.length();
		var drainBorderDisplacement = drainBorder.elevationDisplacement || drainBorderElevation * elevationMultiplier;
		drainBorderPos.normalize().multiplyScalar(drainBorderDistance + (useElevationDisplacement ? drainBorderDisplacement : 0) + 2);
	} else {
		drainBorderPos.multiplyScalar(1.002);
	}
	
	// Calculate elevation drops for waterfall detection
	var inflowDrop = Math.max(0, sourceBorderElevation) - Math.max(0, centerTile.elevation);
	var outflowDrop = Math.max(0, centerTile.elevation) - Math.max(0, drainBorderElevation);
	
	// Determine colors
	var inflowColor = inflowDrop >= waterfallThreshold ? new THREE.Color(0xFFFFFF) : new THREE.Color(0x003F85);
	var outflowColor = outflowDrop >= waterfallThreshold ? new THREE.Color(0xFFFFFF) : new THREE.Color(0x003F85);
	
	// Build the two arrow segments
	var inflowSegment = centerPos.clone().sub(sourceBorderPos);
	var outflowSegment = drainBorderPos.clone().sub(centerPos);
	
	// Draw arrows: source border → center → drain border
	buildArrow(geometry, sourceBorderPos, inflowSegment, centerTile.averagePosition.clone().normalize(), baseWidth, inflowColor);
	
	// Always draw outflow arrow since it's contained within the center tile
	// (No longer need to check if drain is ocean since arrow stays in current tile)
	if (drainTile) {
		buildArrow(geometry, centerPos, outflowSegment, centerTile.averagePosition.clone().normalize(), baseWidth, outflowColor);
	}
}

// Color calculation functions for different render modes
function calculateTerrainColor(tile) {
	var terrainColor;
	var elevationColor;
	
	// First calculate elevation color for land areas
	if (tile.elevation <= 0) elevationColor = new THREE.Color(0x224488).lerp(new THREE.Color(0xAADDFF), Math.max(0, Math.min((tile.elevation + 3 / 4) / (3 / 4), 1)));
	else elevationColor = new THREE.Color(0x997755).lerp(new THREE.Color(0x222222), Math.max(0, Math.min(tile.elevation, 1)));

	if (tile.elevation <= 0 || tile.lake) {
		// Water areas - sophisticated depth and temperature-based coloring
		if (tile.elevation <= 0) {
			var normalizedDepth = Math.min(-tile.elevation, 1);
		} else {
			if (tile.lake.log === 'filled') {
				var normalizedDepth = 0.1
			} else if (tile.lake.log === 'kept no drain') {
				var normalizedDepth = 0.5
			} else var normalizedDepth = 1
		}
		
		if ((tile.temperature < 0 || (Math.min(tile.elevation, 1) - Math.min(Math.max(tile.temperature, 0), 1) / 1.5 > 0.75)) && tile.lake) {
			terrainColor = new THREE.Color(0xDDEEFF) // glacier
		} else if (tile.biome === "ocean" || tile.lake) {
			// Complex ocean color with depth and temperature
			terrainColor = new THREE.Color(0x27efff)
				.lerp(new THREE.Color(0x072995), Math.pow(normalizedDepth, 1 / 3))
				.lerp(new THREE.Color(0x072995).lerp(new THREE.Color(0x222D5E), Math.pow(normalizedDepth, 1 / 5)), 1 - 1.1 * tile.temperature);
		} else if (tile.biome === "seaIce") {
			terrainColor = new THREE.Color(0x9EE1FF);
		} else {
			terrainColor = new THREE.Color(0xFF0000); // Error case
		}
	} else {
		// Land areas - complex blend based on elevation, moisture, temperature
		var normalizedElevation = Math.min(tile.elevation, 1);
		var normalizedMoisture = Math.min(tile.moisture, 1);
		var normalizedTemperature = Math.min(Math.max(tile.temperature, 0), 1);

		// Base terrain color - sophisticated blend
		terrainColor = new THREE.Color(0xCCCC66) // Base yellowish color
			.lerp(new THREE.Color(0x005000), Math.pow(normalizedMoisture, .25))  // Green for moisture
			.lerp(new THREE.Color(0x777788), Math.pow(normalizedElevation, 2))   // Gray for elevation
			.lerp(new THREE.Color(0x555544), (1 - tile.temperature));           // Brown for cold
		
		// Additional elevation blending for realistic mountain appearance
		//var elevationBlend = Math.max(0, Math.min(1, Math.pow(Math.max(normalizedElevation - .4, 0), .7) - normalizedMoisture));
		//terrainColor = terrainColor.lerp(elevationColor, elevationBlend);
		//terrainColor = terrainColor.lerp(new THREE.Color(0x808079), Math.pow(normalizedTemperature, .01));

		// Special biome overrides
		if (tile.biome === "glacier" || tile.temperature < 0) {
			terrainColor = new THREE.Color(0xDDEEFF); // Snow/glacier
		}
		else if (tile.biome === "lake") {
			terrainColor = new THREE.Color(0x00FFFF); // Lake cyan
		}
	}

	// Error tiles for debugging
	if (tile.error) { 
		terrainColor = new THREE.Color(0xFF00FF) // Bright magenta
	}
	
	return terrainColor;
}

function calculateElevationColor(tile) {
	if (tile.elevation <= 0) {
		// Ocean depths - blue gradient
		var normalizedDepth = Math.min(-tile.elevation, 1);
		return new THREE.Color(0x224488).lerp(new THREE.Color(0x000044), normalizedDepth);
	} else {
		// Land elevation - brown to white gradient
		var normalizedElevation = Math.min(tile.elevation, 1);
		return new THREE.Color(0x4B2F20).lerp(new THREE.Color(0xFFFFFF), normalizedElevation);
	}
}

function calculateTemperatureColor(tile) {
	var normalizedTemp = Math.max(-1, Math.min(tile.temperature || 0, 1));
	if (normalizedTemp < 0) {
		// Cold - blue to cyan
		return new THREE.Color(0x0000FF).lerp(new THREE.Color(0x00FFFF), Math.abs(normalizedTemp));
	} else {
		// Warm - yellow to red
		return new THREE.Color(0xFFFF00).lerp(new THREE.Color(0xFF0000), normalizedTemp);
	}
}

function calculateMoistureColor(tile) {
	var normalizedMoisture = Math.max(0, Math.min(tile.moisture || 0, 1));
	// Dry (brown) to wet (green)
	return new THREE.Color(0x8B4513).lerp(new THREE.Color(0x00FF00), normalizedMoisture);
}

function calculatePlatesColor(tile) {
	if (tile.plate && tile.plate.color) {
		return new THREE.Color(tile.plate.color.r, tile.plate.color.g, tile.plate.color.b);
	}
	return new THREE.Color(0x888888); // Default gray
}

// Function to recalculate colors for BufferGeometry based on render mode
function recalculateBufferGeometryColors(tiles, geometry, overlayId) {
	var colorAttribute = geometry.getAttribute('color');
	if (!colorAttribute) {
		console.error("No color attribute found in geometry");
		return;
	}

	// Get color calculation function from overlay registry
	var overlay = getColorOverlay(overlayId);
	var calculateColor = overlay ? overlay.colorFunction : calculateTerrainColor;

	var vertexIndex = 0;
	
	// Process each tile and update vertex colors
	for (var i = 0; i < tiles.length; i++) {
		var tile = tiles[i];
		var tileColor = calculateColor(tile);
		
		// Update center vertex color
		colorAttribute.setXYZ(vertexIndex, tileColor.r, tileColor.g, tileColor.b);
		vertexIndex++;
		
		// Update corner vertex colors (same as center for consistency)
		for (var j = 0; j < tile.corners.length; j++) {
			colorAttribute.setXYZ(vertexIndex, tileColor.r, tileColor.g, tileColor.b);
			vertexIndex++;
		}
	}
	
	// Mark the color attribute for update
	colorAttribute.needsUpdate = true;
}

// Function to create a simple moon for material testing
function buildMoonRenderObject(action) {
	console.log("Creating moon render object for material testing");
	
	// Create simple sphere geometry for the moon
	var moonRadius = 100;
	var moonGeometry = new THREE.SphereGeometry(moonRadius, 32, 16);
	
	// Create material for testing - start with Phong to see lighting effects
	var moonMaterial = new THREE.MeshBasicMaterial({
		color: 0x888888,    // Light gray base color
		shininess: 100,       // Low shininess for moon-like appearance  
		specular: 0x222222   // Dark specular for realistic moon surface
	});
	
	// Create moon mesh
	var moonRenderObject = new THREE.Mesh(moonGeometry, moonMaterial);
	
	// Position moon relative to planet (distance ~1500, slightly offset)
	moonRenderObject.position.set(1500, 300, 800);
	
	// Add test geometry using the same approach as the working moon
	console.log("Adding test geometry using THREE.BoxGeometry (same pattern as moon)");
	
	// COMPREHENSIVE DEBUGGING: Create multiple test objects to isolate positioning/material issues
	console.log("Creating comprehensive debugging test objects");
	
	var planetRadius = 1000;
	var testObjects = [];
	
	// TEST 1: High Altitude Rivers (solid cyan, way above terrain)
	var test1Geometry = new THREE.BufferGeometry();
	var test1Vertices = new Float32Array([
		1200, 0, 0,     // tip (high altitude)
		1180, 20, 0,    // base left
		1180, -20, 0    // base right
	]);
	test1Geometry.setAttribute('position', new THREE.BufferAttribute(test1Vertices, 3));
	test1Geometry.computeVertexNormals();
	var test1Material = new THREE.MeshBasicMaterial({ color: 0x00FFFF, side: THREE.DoubleSide }); // Bright cyan
	var test1Object = new THREE.Mesh(test1Geometry, test1Material);
	test1Object.position.set(0, 0, 0);
	testObjects.push({ name: "High Altitude Rivers", object: test1Object });
	
	// TEST 2: Wireframe Debug (same position as test 1, but wireframe)
	var test2Geometry = test1Geometry.clone();
	var test2Material = new THREE.MeshBasicMaterial({ color: 0xFFFF00, wireframe: true }); // Yellow wireframe
	var test2Object = new THREE.Mesh(test2Geometry, test2Material);
	test2Object.position.set(0, 100, 0); // Offset slightly
	testObjects.push({ name: "Wireframe Debug", object: test2Object });
	
	// TEST 3: Massive Scale Test (10x larger triangles)
	var test3Geometry = new THREE.BufferGeometry();
	var test3Vertices = new Float32Array([
		1150, 0, 0,     // Much larger triangle
		1100, 100, 0,   // 
		1100, -100, 0   //
	]);
	test3Geometry.setAttribute('position', new THREE.BufferAttribute(test3Vertices, 3));
	test3Geometry.computeVertexNormals();
	var test3Material = new THREE.MeshBasicMaterial({ color: 0xFF00FF, side: THREE.DoubleSide }); // Magenta
	var test3Object = new THREE.Mesh(test3Geometry, test3Material);
	test3Object.position.set(0, 0, 100); // Offset
	testObjects.push({ name: "Massive Scale", object: test3Object });
	
	// TEST 4: Line Segments (using LineBasicMaterial)
	var test4Geometry = new THREE.BufferGeometry();
	var test4Vertices = new Float32Array([
		1100, 0, 0,     // Line start
		1300, 0, 0      // Line end
	]);
	test4Geometry.setAttribute('position', new THREE.BufferAttribute(test4Vertices, 3));
	var test4Material = new THREE.LineBasicMaterial({ color: 0x00FF00, linewidth: 5 }); // Green line
	var test4Object = new THREE.Line(test4Geometry, test4Material);
	test4Object.position.set(0, 0, -100); // Offset
	testObjects.push({ name: "Line Segments", object: test4Object });
	
	// TEST 5: Box Reference (using working approach)
	var test5Geometry = new THREE.BoxGeometry(50, 50, 50);
	var test5Material = new THREE.MeshBasicMaterial({ color: 0xFFFFFF }); // White box
	var test5Object = new THREE.Mesh(test5Geometry, test5Material);
	test5Object.position.set(1200, 50, 50); // Near test 1
	testObjects.push({ name: "Box Reference", object: test5Object });
	
	console.log("Created", testObjects.length, "debugging test objects");
	for (var i = 0; i < testObjects.length; i++) {
		console.log("  -", testObjects[i].name, "at position:", testObjects[i].object.position);
	}
	
	// DEBUGGING: Add rivers to moon object for visibility testing
	console.log("=== MOON DEBUGGING: Adding Rivers ===");
	if (planet && planet.renderData && planet.renderData.Rivers && planet.renderData.Rivers.renderObject) {
		console.log("Adding rivers render object to moon for debugging");
		moonRenderObject.add(planet.renderData.Rivers.renderObject);
		testObjects.push({ name: "Rivers Debug via Moon", object: planet.renderData.Rivers.renderObject });
	} else {
		console.log("Rivers render object not available for moon debugging");
	}
	
	// DEBUGGING: Add air currents to moon object for visibility testing
	if (planet && planet.renderData && planet.renderData.airCurrents && planet.renderData.airCurrents.renderObject) {
		console.log("Adding air currents render object to moon for debugging");
		moonRenderObject.add(planet.renderData.airCurrents.renderObject);
		testObjects.push({ name: "Air Currents Debug via Moon", object: planet.renderData.airCurrents.renderObject });
	} else {
		console.log("Air currents render object not available for moon debugging");
	}
	
	console.log("Created moon at position:", moonRenderObject.position);
	
	action.provideResult({
		geometry: moonGeometry,
		material: moonMaterial,
		renderObject: moonRenderObject,
		testObjects: testObjects  // Include all test objects for debugging
	});
}

// Modular Color Overlay System
var colorOverlayRegistry = {};

// Register a color overlay function
function registerColorOverlay(id, name, description, colorFunction) {
	colorOverlayRegistry[id] = {
		id: id,
		name: name,
		description: description,
		colorFunction: colorFunction
	};
}

// Get all registered overlays
function getColorOverlays() {
	return Object.values(colorOverlayRegistry);
}

// Get specific overlay by ID
function getColorOverlay(id) {
	return colorOverlayRegistry[id];
}

// Apply a color overlay to the planet
function applyColorOverlay(overlayId) {
	var overlay = getColorOverlay(overlayId);
	if (!overlay) {
		console.error("Color overlay not found:", overlayId);
		return;
	}
	
	if (!planet || !planet.topology || !planet.topology.tiles) {
		console.error("Cannot apply color overlay - missing planet data");
		return;
	}
	
	recalculateBufferGeometryColors(planet.topology.tiles, planet.renderData.surface.geometry, overlayId);
}

// Register the existing color overlays
registerColorOverlay("terrain", "Realistic Terrain", "Realistic biome-based terrain coloring", calculateTerrainColor);
registerColorOverlay("elevation", "Elevation Map", "Height-based visualization from brown (low) to white (high)", calculateElevationColor);
registerColorOverlay("temperature", "Temperature Map", "Thermal visualization from blue (cold) to red (hot)", calculateTemperatureColor);
registerColorOverlay("moisture", "Moisture Map", "Precipitation visualization from brown (dry) to green (wet)", calculateMoistureColor);
registerColorOverlay("plates", "Tectonic Plates", "Tectonic plate boundaries and colors", calculatePlatesColor);

// Example: Add new overlays - demonstrating how easy it is to extend
registerColorOverlay("simple", "Simple Land/Water", "Basic land (green) vs water (blue) visualization", function(tile) {
	return tile.elevation <= 0 ? new THREE.Color(0x0066CC) : new THREE.Color(0x00AA44);
});

registerColorOverlay("heat", "Heat Map", "Red-hot visualization based on elevation and temperature", function(tile) {
	var intensity = Math.max(0, Math.min(1, (tile.elevation || 0) + (tile.temperature || 0) * 0.5));
	return new THREE.Color(intensity, 0, 0);
});