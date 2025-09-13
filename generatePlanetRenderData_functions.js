// Legacy Three.js r68 compatibility code removed - now using direct BufferGeometry creation
// Note: terrainColors is now defined in planet-generator.js

function buildSurfaceRenderObject(tiles, watersheds, random, action, customMaterial) {
	
	// Calculate geometry requirements (independent triangles - no vertex sharing)
	var totalVertices = 0;
	var totalFaces = 0;
	
	for (var i = 0; i < tiles.length; i++) {
		var cornersCount = tiles[i].corners.length;
		totalVertices += cornersCount * 3; // 3 vertices per triangle
		totalFaces += cornersCount; // N triangles per tile
	}
	
	
	// Pre-allocate typed arrays for BufferGeometry
	var positions = new Float32Array(totalVertices * 3);
	var colors = new Float32Array(totalVertices * 3);
	var indices = new Uint32Array(totalFaces * 3);
	
	var vertexIndex = 0;
	var triangleIndex = 0;
	var finalResult = null; // Store the final result here
	
	var minShore = Math.min.apply(0, tiles.map((data) => data.shore));
	var maxShore = Math.max.apply(0, tiles.map((data) => data.shore));
	var minBody = Math.min.apply(0, tiles.map((data) => data.body.id));
	var maxBody = Math.max.apply(0, tiles.map((data) => data.body.id));
	let maxSediment = Math.max(...tiles.map(t => t.sediment? t.sediment:0));

	var i = 0;
	action.executeSubaction(function (action) {
		//console.log("*** TILE LOOP EXECUTING! i =", i, "tiles.length =", tiles.length, "***");
		
		if (i >= tiles.length) {
			//console.log("*** TILE LOOP ENDING - reached tiles.length ***");
			action.provideResult("completed");
			return;
		}

		if (i % 100 === 0) {
			//console.log("Processing tile", i, "of", tiles.length);
		}

		var tile = tiles[i];
		
		
		// Calculate terrain color using extracted function
		var terrainColor = calculateTerrainColor(tile);
		
		// Calculate tile center position (with elevation)
		var centerPos = tile.averagePosition.clone();
		if (tile.elevation > 0) {
			var centerDistance = centerPos.length();
			var displacement = useElevationDisplacement ? tile.elevationDisplacement : 0;
			centerPos.normalize().multiplyScalar(centerDistance + displacement);
		}
		
		// Calculate corner positions (with elevation)
		var cornerPositions = [];
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
			
			cornerPositions.push(cornerPos);
		}
		
		// Create independent triangles (no vertex sharing)
		for (var j = 0; j < tile.corners.length; j++) {
			var nextJ = (j + 1) % tile.corners.length;
			
			// Triangle vertices: center -> corner[j] -> corner[j+1]
			var vertex1 = centerPos;
			var vertex2 = cornerPositions[j];
			var vertex3 = cornerPositions[nextJ];
			
			// Add vertex 1 (center)
			positions[vertexIndex * 3] = vertex1.x;
			positions[vertexIndex * 3 + 1] = vertex1.y;
			positions[vertexIndex * 3 + 2] = vertex1.z;
			colors[vertexIndex * 3] = terrainColor.r;
			colors[vertexIndex * 3 + 1] = terrainColor.g;
			colors[vertexIndex * 3 + 2] = terrainColor.b;
			indices[triangleIndex * 3] = vertexIndex;
			vertexIndex++;
			
			// Add vertex 2 (corner j)
			positions[vertexIndex * 3] = vertex2.x;
			positions[vertexIndex * 3 + 1] = vertex2.y;
			positions[vertexIndex * 3 + 2] = vertex2.z;
			colors[vertexIndex * 3] = terrainColor.r;
			colors[vertexIndex * 3 + 1] = terrainColor.g;
			colors[vertexIndex * 3 + 2] = terrainColor.b;
			indices[triangleIndex * 3 + 1] = vertexIndex;
			vertexIndex++;
			
			// Add vertex 3 (corner j+1)
			positions[vertexIndex * 3] = vertex3.x;
			positions[vertexIndex * 3 + 1] = vertex3.y;
			positions[vertexIndex * 3 + 2] = vertex3.z;
			colors[vertexIndex * 3] = terrainColor.r;
			colors[vertexIndex * 3 + 1] = terrainColor.g;
			colors[vertexIndex * 3 + 2] = terrainColor.b;
			indices[triangleIndex * 3 + 2] = vertexIndex;
			vertexIndex++;
			
			triangleIndex++;
		}
		
		++i;

		if (i < tiles.length) {
			action.loop(i / tiles.length);
		} else {
			// All tiles processed
		}
	});

	// Create BufferGeometry after executeSubaction completes
	action.executeSubaction(function(action) {
		
		var planetGeometry = new THREE.BufferGeometry();
		
		// Set buffer attributes directly
		var positionAttribute = new THREE.BufferAttribute(positions, 3);
		var colorAttribute = new THREE.BufferAttribute(colors, 3);
		var indexAttribute = new THREE.BufferAttribute(indices, 1);
		
		planetGeometry.setAttribute('position', positionAttribute);
		planetGeometry.setAttribute('color', colorAttribute);
		planetGeometry.setIndex(indexAttribute);
		
		// Force buffer updates for GPU synchronization
		positionAttribute.needsUpdate = true;
		colorAttribute.needsUpdate = true;
		indexAttribute.needsUpdate = true;
		
		// Compute normals and bounding box
		planetGeometry.computeVertexNormals();
		planetGeometry.computeBoundingBox();
		
		// Ensure normal buffer is marked for update
		if (planetGeometry.attributes.normal) {
			planetGeometry.attributes.normal.needsUpdate = true;
		}
		
		// Create material
		var planetMaterial;
		if (customMaterial) {
			planetMaterial = customMaterial;
		} else {
			planetMaterial = new THREE.MeshBasicMaterial({
				vertexColors: true,
				wireframe: false,
				side: THREE.DoubleSide,
				color: 0xFFFFFF
			});
		}
		
		var planetRenderObject = new THREE.Mesh(planetGeometry, planetMaterial);
		
		// Force geometry update notification
		planetGeometry.attributes.position.needsUpdate = true;
		planetGeometry.attributes.color.needsUpdate = true;
		
		finalResult = {
			geometry: planetGeometry,
			material: planetMaterial,
			renderObject: planetRenderObject
		};
		
		// Store result but don't call provideResult here
	}, 1, "Building Final Geometry");
	
	// Provide result as a function that returns finalResult when called
	action.provideResult(function() {
		console.log("=== MAIN FUNCTION RESULT FUNCTION CALLED ===");
		console.log("Returning finalResult:", finalResult);
		return finalResult;
	});
}

function buildPlateBoundariesRenderObject(borders, action) {
	var positions = [];
	var colors = [];
	var indices = [];
	var vertexIndex = 0;

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

			// Create 6 vertices for the boundary visualization
			var vertices = [
				borderPoint0.clone().add(offset),
				borderPoint1.clone().add(offset),
				tilePoint0.clone().sub(borderPoint0).multiplyScalar(0.2).add(borderPoint0).add(offset),
				tilePoint0.clone().sub(borderPoint1).multiplyScalar(0.2).add(borderPoint1).add(offset),
				tilePoint1.clone().sub(borderPoint0).multiplyScalar(0.2).add(borderPoint0).add(offset),
				tilePoint1.clone().sub(borderPoint1).multiplyScalar(0.2).add(borderPoint1).add(offset)
			];

			var pressure = Math.max(-1, Math.min((border.corners[0].pressure + border.corners[1].pressure) / 2, 1));
			var shear = Math.max(0, Math.min((border.corners[0].shear + border.corners[1].shear) / 2, 1));
			var innerColor = (pressure <= 0) ? {r: 1 + pressure, g: 1, b: 0} : {r: 1, g: 1 - pressure, b: 0};
			var outerColor = {r: 0, g: shear / 2, b: shear};

			// Add vertices to positions array
			for (var v = 0; v < vertices.length; v++) {
				positions.push(vertices[v].x, vertices[v].y, vertices[v].z);
			}
			
			// Add vertex colors
			colors.push(innerColor.r, innerColor.g, innerColor.b); // vertex 0
			colors.push(innerColor.r, innerColor.g, innerColor.b); // vertex 1  
			colors.push(outerColor.r, outerColor.g, outerColor.b); // vertex 2
			colors.push(outerColor.r, outerColor.g, outerColor.b); // vertex 3
			colors.push(outerColor.r, outerColor.g, outerColor.b); // vertex 4
			colors.push(outerColor.r, outerColor.g, outerColor.b); // vertex 5

			// Add 4 triangles using indices (matching original Face3 pattern)
			var baseIdx = vertexIndex;
			indices.push(baseIdx + 0, baseIdx + 1, baseIdx + 2); // Face3(0, 1, 2)
			indices.push(baseIdx + 1, baseIdx + 3, baseIdx + 2); // Face3(1, 3, 2)  
			indices.push(baseIdx + 1, baseIdx + 0, baseIdx + 5); // Face3(1, 0, 5)
			indices.push(baseIdx + 0, baseIdx + 4, baseIdx + 5); // Face3(0, 4, 5)
			
			vertexIndex += 6;
		}

		++i;

		action.loop(i / borders.length);
	});

	// Create BufferGeometry directly
	var geometry = new THREE.BufferGeometry();
	if (positions.length > 0) {
		geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
		geometry.setIndex(indices);
	}
	
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
	var positions = [];
	var colors = [];
	var indices = [];
	var vertexIndex = 0;

	var i = 0;
	action.executeSubaction(function (action) {
		if (i >= tiles.length) return;

		var tile = tiles[i];
		var plate = tile.plate;
		var movement = plate.calculateMovement(tile.position);
		var plateMovementColor = {
			r: 1 - plate.r, 
			g: 1 - plate.color.g, 
			b: 1 - plate.color.b
		};

		// Calculate elevated position for arrow start
		var arrowPosition = tile.position.clone();
		if (tile.elevation > 0) {
			// Use stored elevation displacement
			var distance = arrowPosition.length();
			arrowPosition.normalize().multiplyScalar(distance + (useElevationDisplacement ? tile.elevationDisplacement : 0) + 2);
		} else {
			arrowPosition.multiplyScalar(1.002);
		}
		
		vertexIndex = buildArrow(positions, colors, indices, vertexIndex, arrowPosition, movement.clone().multiplyScalar(0.5), tile.position.clone().normalize(), Math.min(movement.length(), 4), plateMovementColor);

		tile.plateMovement = movement;

		++i;

		action.loop(i / tiles.length);
	});

	// Create BufferGeometry directly
	var geometry = new THREE.BufferGeometry();
	if (positions.length > 0) {
		geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
		geometry.setIndex(indices);
	}

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

// Legacy buildInflowRiverArrows function removed - now using direct triangle rendering

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
			// Three-step ocean color lerp: (Surface/Deep) × (Warm/Cold)
			var normalizedTemperature = Math.min(Math.max(tile.temperature, 0), 1);
			
			// Step 1: Lerp surface colors warm→cold based on temperature
			var surfaceColor = terrainColors.oceanSurfaceWarm.clone()
				.lerp(terrainColors.oceanSurfaceCold, 1 - normalizedTemperature);
				
			// Step 2: Lerp deep colors warm→cold based on temperature  
			var deepColor = terrainColors.oceanDeepWarm.clone()
				.lerp(terrainColors.oceanDeepCold, 1 - normalizedTemperature);
				
			// Step 3: Lerp surface→deep based on depth
			terrainColor = surfaceColor
				.lerp(deepColor, Math.pow(normalizedDepth, 1 / 3));
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
		

		// Sophisticated land color blend using picker colors
		// Step 1: Lerp low elevation colors A (dry) and B (wet) based on moisture
		var lowElevationColor = terrainColors.landLowDry.clone()
			.lerp(terrainColors.landLowWet, Math.pow(normalizedMoisture, 0.25));
		
		// Step 2: Lerp high elevation colors C (dry) and D (wet) based on moisture  
		var highElevationColor = terrainColors.landHighDry.clone()
			.lerp(terrainColors.landHighWet, Math.pow(normalizedMoisture, 0.25));
		
		// Step 3: Lerp between AB and CD based on elevation
		var elevationColor = lowElevationColor
			.lerp(highElevationColor, Math.pow(normalizedElevation, 2));
		
		// Step 4: Final lerp to cold temperature color E
		terrainColor = elevationColor
			.lerp(terrainColors.landCold, (1 - tile.temperature));
		
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

// Function to create a test tile object with Lambert material for debugging
function buildTestTileObject(tiles, random, action) {
	console.log("=== BUILDING TEST TILE OBJECT ===");
	
	// Use only first 50 tiles for testing (smaller, faster)
	var testTiles = tiles.slice(0, Math.min(50, tiles.length));
	console.log("Using", testTiles.length, "tiles for test object");
	
	// Create Lambert material for testing
	var testMaterial = new THREE.MeshLambertMaterial({
		vertexColors: true,
		wireframe: false,
		side: THREE.DoubleSide
	});
	console.log("Created Lambert test material:", testMaterial.type);
	
	// Use the same buildSurfaceRenderObject function with custom material
	action.executeSubaction(function(action) {
		buildSurfaceRenderObject(testTiles, null, random, action, testMaterial);
	}, 1, "Building Test Tile Object")
	.getResult(function(result) {
		console.log("Test tile object result:", result);
		
		// Enhanced debugging for geometry comparison
		if (result && result.geometry) {
			console.log("=== TEST OBJECT GEOMETRY DEBUG ===");
			console.log("Test geometry vertices:", result.geometry.attributes.position ? result.geometry.attributes.position.count : 'none');
			console.log("Test geometry normals:", result.geometry.attributes.normal ? result.geometry.attributes.normal.count : 'none');
			console.log("Test geometry colors:", result.geometry.attributes.color ? result.geometry.attributes.color.count : 'none');
			
			if (result.geometry.attributes.normal) {
				var testNormals = result.geometry.attributes.normal.array;
				var testNormalCount = testNormals.length / 3;
				var testZeroNormals = 0;
				var testValidNormals = 0;
				
				for (var i = 0; i < testNormalCount; i++) {
					var x = testNormals[i * 3];
					var y = testNormals[i * 3 + 1];
					var z = testNormals[i * 3 + 2];
					
					if (x === 0 && y === 0 && z === 0) {
						testZeroNormals++;
					} else {
						testValidNormals++;
					}
				}
				
				console.log("TEST OBJECT Normal Analysis:");
				console.log("  Valid normals:", testValidNormals);
				console.log("  Zero normals:", testZeroNormals);
				console.log("  Normal sample (first 9):", Array.from(testNormals.slice(0, 9)));
			}
			
			console.log("Test material type:", result.material.type);
			console.log("Test material vertexColors:", result.material.vertexColors);
		}
		
		// Position the test object between moon and planet
		if (result && result.renderObject) {
			result.renderObject.position.set(800, 200, 600);
			result.renderObject.scale.set(0.3, 0.3, 0.3); // Make it smaller
			console.log("Positioned test object at (800, 200, 600) with 0.3 scale");
		}
		
		action.provideResult({
			geometry: result.geometry,
			material: result.material,
			renderObject: result.renderObject
		});
	});
}

// Function to create a simple test object for position validation
function buildSimpleTestObject(action) {
	console.log("=== BUILDING SIMPLE TEST OBJECT ===");
	
	// Create a simple cube geometry
	var testGeometry = new THREE.BoxGeometry(100, 100, 100);
	console.log("Created test cube geometry");
	
	// Create bright red Lambert material to test normals
	var testMaterial = new THREE.MeshLambertMaterial({
		color: 0xFF0000,  // Bright red
		wireframe: false
	});
	console.log("Created bright red Lambert material for normal testing");
	
	// Create mesh
	var testRenderObject = new THREE.Mesh(testGeometry, testMaterial);
	
	// Position at same location as tile test object
	testRenderObject.position.set(800, 200, 600);
	testRenderObject.scale.set(0.3, 0.3, 0.3);
	
	console.log("Simple test object positioned at (800, 200, 600) with 0.3 scale");
	console.log("Simple test object material:", testMaterial.type);
	console.log("Simple test object color:", testMaterial.color);
	
	// Debug normals on simple geometry
	console.log("=== SIMPLE GEOMETRY NORMALS DEBUG ===");
	console.log("Simple geometry vertices:", testGeometry.attributes.position.count);
	console.log("Simple geometry normals:", testGeometry.attributes.normal ? testGeometry.attributes.normal.count : 'none');
	
	if (testGeometry.attributes.normal) {
		var simpleNormals = testGeometry.attributes.normal.array;
		var simpleNormalCount = simpleNormals.length / 3;
		var simpleZeroNormals = 0;
		var simpleValidNormals = 0;
		
		for (var i = 0; i < Math.min(simpleNormalCount, 10); i++) {
			var x = simpleNormals[i * 3];
			var y = simpleNormals[i * 3 + 1];
			var z = simpleNormals[i * 3 + 2];
			
			if (x === 0 && y === 0 && z === 0) {
				simpleZeroNormals++;
			} else {
				simpleValidNormals++;
			}
		}
		
		console.log("SIMPLE GEOMETRY Normal Analysis (first 10):");
		console.log("  Valid normals:", simpleValidNormals);
		console.log("  Zero normals:", simpleZeroNormals);
		console.log("  Normal sample (first 9):", Array.from(simpleNormals.slice(0, 9)));
	} else {
		console.log("ERROR: Simple geometry has no normals!");
	}
	
	action.provideResult({
		geometry: testGeometry,
		material: testMaterial,
		renderObject: testRenderObject
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

// Watersheds color overlay - shows drainage basins in different colors
registerColorOverlay("watersheds", "Watersheds", "Shows drainage basins with distinct colors", function(tile) {
	if (tile.watershed && tile.watershed.color) {
		return new THREE.Color(tile.watershed.color);
	}
	// Default color for tiles without watershed assignment
	return tile.elevation <= 0 ? new THREE.Color(0x0066CC) : new THREE.Color(0x888888);
});

// Land Regions color overlay - shows K-means clustered land regions
registerColorOverlay("landRegions", "Land Regions", "Shows clustered land regions in different colors", function(tile) {
	// Ocean tiles stay blue
	if (tile.elevation <= 0) {
		return calculateTerrainColor(tile); // Use standard ocean coloring
	}
	
	// Land tiles get colored by their region
	if (tile.landRegion && tile.landRegion > 0) {
		// Generate distinct colors for each region using hue rotation
		var hue = ((tile.landRegion - 1) * 137.5) % 360; // Golden angle for good distribution
		var saturation = 0.7;
		var lightness = 0.6;
		
		// Convert HSL to RGB
		var color = new THREE.Color();
		color.setHSL(hue / 360, saturation, lightness);
		return color;
	}
	
	// Fallback for land tiles without region assignment
	return new THREE.Color(0x888888); // Gray for unassigned land
});