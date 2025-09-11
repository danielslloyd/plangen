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
	
	// Calculate geometry requirements (simple triangle fan per tile)
	var totalVertices = 0;
	var totalFaces = 0;
	
	for (var i = 0; i < tiles.length; i++) {
		var cornersCount = tiles[i].corners.length;
		totalVertices += 1 + cornersCount; // 1 center + N corners
		totalFaces += cornersCount; // N triangles (triangle fan)
	}
	
	
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
			var displacement = useElevationDisplacement ? tile.elevationDisplacement : 0;
			centerPos.normalize().multiplyScalar(centerDistance + displacement);
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
				var cornerDisplacement = useElevationDisplacement ? corner.elevationDisplacement : 0;
				cornerPos.normalize().multiplyScalar(cornerDistance + cornerDisplacement);
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
	
	var planetRenderObject = new THREE.Mesh(planetGeometry, planetMaterial);
	
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
	// Use global Average Border Length (ABL) for sizing
	var ABL = averageBorderLength;
	
	// Arrays for r125 BufferGeometry triangle rendering
	var airCurrentPositions = [];
	var airCurrentColors = [];
	var airCurrentIndices = [];
	var airCurrentVertexIndex = 0;

	var totalCorners = corners.length;
	var cornersWithAirCurrent = 0;
	var cornersAboveThreshold = 0;
	
	// Find maximum wind strength for normalization
	var maxWindStrength = 0;
	for (var i = 0; i < corners.length; i++) {
		var corner = corners[i];
		if (corner.airCurrent) {
			maxWindStrength = Math.max(maxWindStrength, corner.airCurrent.length());
		}
	}
	
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
		
		// Calculate arrow properties based on SBL
		var airDirection = corner.airCurrent.clone().normalize();
		var airCurrentStrength = corner.airCurrent.length();
		
		// Normalize wind strength (0 to 1) and multiply by ABL
		var normalizedWindStrength = maxWindStrength > 0 ? airCurrentStrength / maxWindStrength : 0;
		var triangleLength = normalizedWindStrength * ABL;
		
		// Base width = 1/8 ABL
		var triangleWidth = ABL / 8;
		
		// Create single triangle pointing in flow direction
		var tipPosition = basePosition.clone().add(airDirection.clone().multiplyScalar(triangleLength));
		
		// Create perpendicular vectors for triangle base
		var upVector = corner.position.clone().normalize(); // Surface normal
		var perpendicular = new THREE.Vector3();
		perpendicular.crossVectors(airDirection, upVector).normalize();
		
		// Color based on air current strength (white to cyan gradient)
		var intensity = Math.min(corner.airCurrent.length() * 5, 1);
		var triangleColor = {
			r: 0.8 + intensity * 0.2,
			g: 0.9 + intensity * 0.1, 
			b: 1
		};
		
		// Create single triangle: tip at flow direction, base perpendicular
		var baseLeft = basePosition.clone().add(perpendicular.clone().multiplyScalar(-triangleWidth));
		var baseRight = basePosition.clone().add(perpendicular.clone().multiplyScalar(triangleWidth));
		
		// Add triangle vertices
		var tipIndex = airCurrentVertexIndex;
		airCurrentPositions.push(tipPosition.x, tipPosition.y, tipPosition.z);
		airCurrentColors.push(triangleColor.r, triangleColor.g, triangleColor.b);
		airCurrentVertexIndex++;
		
		var baseLeftIndex = airCurrentVertexIndex;
		airCurrentPositions.push(baseLeft.x, baseLeft.y, baseLeft.z);
		airCurrentColors.push(triangleColor.r, triangleColor.g, triangleColor.b);
		airCurrentVertexIndex++;
		
		var baseRightIndex = airCurrentVertexIndex;
		airCurrentPositions.push(baseRight.x, baseRight.y, baseRight.z);
		airCurrentColors.push(triangleColor.r, triangleColor.g, triangleColor.b);
		airCurrentVertexIndex++;
		
		// Create single triangle
		airCurrentIndices.push(tipIndex, baseLeftIndex, baseRightIndex);
	}

	// Create BufferGeometry for triangle rendering  
	var geometry = new THREE.BufferGeometry();
	
	
	if (airCurrentPositions.length > 0) {
		// Create buffer attributes
		geometry.setAttribute('position', new THREE.Float32BufferAttribute(airCurrentPositions, 3));
		geometry.setAttribute('color', new THREE.Float32BufferAttribute(airCurrentColors, 3));
		geometry.setIndex(airCurrentIndices);
		
		// Compute normals and bounding sphere
		geometry.computeVertexNormals();
		geometry.computeBoundingSphere();
	}

	// Use MeshBasicMaterial with vertex colors for triangle rendering
	var material = new THREE.MeshBasicMaterial({
		vertexColors: true,
		side: THREE.DoubleSide,
		transparent: true,
		opacity: 0.7
	});

	var renderObject = new THREE.Mesh(geometry, material);

	action.provideResult({
		geometry: geometry,
		material: material,
		renderObject: renderObject,
	});
}

function buildRiversRenderObject(tiles, action) {
	// Use global Average Border Length (ABL) for sizing
	var ABL = averageBorderLength;
	
	// Arrays for r125 BufferGeometry triangle rendering
	var riverPositions = [];
	var riverColors = [];
	var riverIndices = [];
	var riverVertexIndex = 0;
	
	var totalRiverTiles = 0;
	var totalTiles = tiles.length;
	var totalInflowTriangles = 0;
	var totalOutflowTriangles = 0;
	
	// Process all tiles synchronously
	for (var i = 0; i < tiles.length; i++) {
		var tile = tiles[i];
		if (tile.river) totalRiverTiles++;
		
		if (tile.river && tile.riverSources && tile.drain) {
			// Calculate tile center position with elevation (respecting elevation toggle)
			var tileCenterPos = tile.averagePosition.clone();
			if (tile.elevation > 0) {
				var tileDistance = tileCenterPos.length();
				tileCenterPos.normalize().multiplyScalar(tileDistance + (useElevationDisplacement ? tile.elevationDisplacement : 0) + 3);
			} else {
				tileCenterPos.multiplyScalar(1.003);
			}
			
			// River triangle dimensions (same for both inflow and outflow)
			var triangleWidth = ABL / 4; // River base width = 1/4 ABL
			var waterfallThreshold = riverElevationDeltaThreshold || 0.1;
			
			// Create one OUTFLOW triangle: tile center → drain border
			if (tile.drain) {
				// Find border with drain tile
				var drainBorder = findBorderBetweenTiles(tile, tile.drain);
				var drainBorderPos;
				
				if (drainBorder && drainBorder.midpoint) {
					drainBorderPos = drainBorder.midpoint.clone();
				} else {
					// Fallback to midpoint between tile centers
					drainBorderPos = tile.averagePosition.clone().add(tile.drain.averagePosition).multiplyScalar(0.5);
				}
				
				// Apply elevation to drain border
				var drainBorderElevation = calculateBorderElevation(tile, tile.drain);
				if (drainBorderElevation > 0) {
					var drainBorderDistance = drainBorderPos.length();
					var drainBorderDisplacement = drainBorder ? drainBorder.elevationDisplacement : drainBorderElevation * elevationMultiplier;
					drainBorderPos.normalize().multiplyScalar(drainBorderDistance + (useElevationDisplacement ? drainBorderDisplacement : 0) + 3);
				} else {
					drainBorderPos.multiplyScalar(1.003);
				}
				
				// Calculate outflow triangle color (waterfall detection)
				var outflowDrop = (tile.elevation || 0) - (Math.max(0,tile.drain.elevation || 0));
				var outflowColor = outflowDrop >= waterfallThreshold ? 
					{ r: 1, g: 1, b: 1 } : { r: 0.2, g: 0.6, b: 1 };
				
				// Create outflow triangle: tip at drain border, base perpendicular at tile center
				var outflowDirection = drainBorderPos.clone().sub(tileCenterPos).normalize();
				var upVector = tileCenterPos.clone().normalize();
				var perpendicular = new THREE.Vector3();
				perpendicular.crossVectors(outflowDirection, upVector).normalize();
				
				var baseLeft = tileCenterPos.clone().add(perpendicular.clone().multiplyScalar(-triangleWidth));
				var baseRight = tileCenterPos.clone().add(perpendicular.clone().multiplyScalar(triangleWidth));
				
				// Add outflow triangle vertices
				var tipIndex = riverVertexIndex;
				riverPositions.push(drainBorderPos.x, drainBorderPos.y, drainBorderPos.z);
				riverColors.push(outflowColor.r, outflowColor.g, outflowColor.b);
				riverVertexIndex++;
				
				var baseLeftIndex = riverVertexIndex;
				riverPositions.push(baseLeft.x, baseLeft.y, baseLeft.z);
				riverColors.push(outflowColor.r, outflowColor.g, outflowColor.b);
				riverVertexIndex++;
				
				var baseRightIndex = riverVertexIndex;
				riverPositions.push(baseRight.x, baseRight.y, baseRight.z);
				riverColors.push(outflowColor.r, outflowColor.g, outflowColor.b);
				riverVertexIndex++;
				
				// Create outflow triangle
				riverIndices.push(tipIndex, baseLeftIndex, baseRightIndex);
				totalOutflowTriangles++;
			}
			
			// Create INFLOW triangles: source border → tile center (for each significant inflow)
			for (var j = 0; j < tile.riverSources.length; j++) {
				var source = tile.riverSources[j];
				
				// Find border with source tile  
				var sourceBorder = findBorderBetweenTiles(source, tile);
				var sourceBorderPos;
				
				if (sourceBorder && sourceBorder.midpoint) {
					sourceBorderPos = sourceBorder.midpoint.clone();
				} else {
					// Fallback to midpoint between tile centers
					sourceBorderPos = source.averagePosition.clone().add(tile.averagePosition).multiplyScalar(0.5);
				}
				
				// Apply elevation to source border
				var sourceBorderElevation = calculateBorderElevation(source, tile);
				if (sourceBorderElevation > 0) {
					var sourceBorderDistance = sourceBorderPos.length();
					var sourceBorderDisplacement = sourceBorder ? sourceBorder.elevationDisplacement : sourceBorderElevation * elevationMultiplier;
					sourceBorderPos.normalize().multiplyScalar(sourceBorderDistance + (useElevationDisplacement ? sourceBorderDisplacement : 0) + 3);
				} else {
					sourceBorderPos.multiplyScalar(1.003);
				}
				
				// Calculate inflow triangle color (waterfall detection)
				var inflowDrop = (source.elevation || 0) - (tile.elevation || 0);
				var inflowColor = inflowDrop >= waterfallThreshold ? 
					{ r: 1, g: 1, b: 1 } : { r: 0.2, g: 0.6, b: 1 };
				
				// Create inflow triangle: tip at tile center, base perpendicular at source border
				var inflowDirection = tileCenterPos.clone().sub(sourceBorderPos).normalize();
				var upVector2 = sourceBorderPos.clone().normalize();
				var perpendicular2 = new THREE.Vector3();
				perpendicular2.crossVectors(inflowDirection, upVector2).normalize();
				
				var baseLeft2 = sourceBorderPos.clone().add(perpendicular2.clone().multiplyScalar(-triangleWidth));
				var baseRight2 = sourceBorderPos.clone().add(perpendicular2.clone().multiplyScalar(triangleWidth));
				
				// Add inflow triangle vertices
				var tipIndex2 = riverVertexIndex;
				riverPositions.push(tileCenterPos.x, tileCenterPos.y, tileCenterPos.z);
				riverColors.push(inflowColor.r, inflowColor.g, inflowColor.b);
				riverVertexIndex++;
				
				var baseLeftIndex2 = riverVertexIndex;
				riverPositions.push(baseLeft2.x, baseLeft2.y, baseLeft2.z);
				riverColors.push(inflowColor.r, inflowColor.g, inflowColor.b);
				riverVertexIndex++;
				
				var baseRightIndex2 = riverVertexIndex;
				riverPositions.push(baseRight2.x, baseRight2.y, baseRight2.z);
				riverColors.push(inflowColor.r, inflowColor.g, inflowColor.b);
				riverVertexIndex++;
				
				// Create inflow triangle
				riverIndices.push(tipIndex2, baseLeftIndex2, baseRightIndex2);
				totalInflowTriangles++;
			}
		}
	}

	// Create BufferGeometry for triangle rendering
	var geometry = new THREE.BufferGeometry();
	
	
	if (riverPositions.length > 0) {
		// Create buffer attributes
		geometry.setAttribute('position', new THREE.Float32BufferAttribute(riverPositions, 3));
		geometry.setAttribute('color', new THREE.Float32BufferAttribute(riverColors, 3));
		geometry.setIndex(riverIndices);
		
		// Compute normals and bounding sphere
		geometry.computeVertexNormals();
		geometry.computeBoundingSphere();
	}

	// Use MeshBasicMaterial with vertex colors for triangle rendering
	var material = new THREE.MeshBasicMaterial({
		vertexColors: true,
		side: THREE.DoubleSide,
		transparent: true,
		opacity: 0.8
	});

	var renderObject = new THREE.Mesh(geometry, material);

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
	// Create simple sphere geometry for the moon
	var moonRadius = 100;
	var moonGeometry = new THREE.SphereGeometry(moonRadius, 32, 16);
	
	// Create moon material
	var moonMaterial = new THREE.MeshBasicMaterial({
		color: 0x888888    // Light gray color
	});
	
	// Create moon mesh
	var moonRenderObject = new THREE.Mesh(moonGeometry, moonMaterial);
	
	// Position moon relative to planet
	moonRenderObject.position.set(1500, 300, 800);
	
	action.provideResult({
		geometry: moonGeometry,
		material: moonMaterial,
		renderObject: moonRenderObject
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