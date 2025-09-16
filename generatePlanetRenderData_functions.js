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
	// This must match the vertex creation logic in buildSurfaceRenderObject
	for (var i = 0; i < tiles.length; i++) {
		var tile = tiles[i];
		var tileColor = calculateColor(tile);

		// Each tile creates tile.corners.length triangles
		// Each triangle has 3 vertices: center -> corner[j] -> corner[j+1]
		for (var j = 0; j < tile.corners.length; j++) {
			// Set color for all 3 vertices of this triangle (center, corner j, corner j+1)
			colorAttribute.setXYZ(vertexIndex, tileColor.r, tileColor.g, tileColor.b); // center vertex
			vertexIndex++;
			colorAttribute.setXYZ(vertexIndex, tileColor.r, tileColor.g, tileColor.b); // corner j vertex
			vertexIndex++;
			colorAttribute.setXYZ(vertexIndex, tileColor.r, tileColor.g, tileColor.b); // corner j+1 vertex
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
	
	// Use only first 50 tiles for testing (smaller, faster)
	var testTiles = tiles.slice(0, Math.min(50, tiles.length));
	
	// Create Lambert material for testing
	var testMaterial = new THREE.MeshLambertMaterial({
		vertexColors: true,
		wireframe: false,
		side: THREE.DoubleSide
	});
	
	// Use the same buildSurfaceRenderObject function with custom material
	action.executeSubaction(function(action) {
		buildSurfaceRenderObject(testTiles, null, random, action, testMaterial);
	}, 1, "Building Test Tile Object")
	.getResult(function(result) {
		
		// Enhanced debugging for geometry comparison
		if (result && result.geometry) {
			
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
				
			}
			
		}
		
		// Position the test object between moon and planet
		if (result && result.renderObject) {
			result.renderObject.position.set(800, 200, 600);
			result.renderObject.scale.set(0.3, 0.3, 0.3); // Make it smaller
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
	
	// Create a simple cube geometry
	var testGeometry = new THREE.BoxGeometry(100, 100, 100);
	
	// Create bright red Lambert material to test normals
	var testMaterial = new THREE.MeshLambertMaterial({
		color: 0xFF0000,  // Bright red
		wireframe: false
	});
	
	// Create mesh
	var testRenderObject = new THREE.Mesh(testGeometry, testMaterial);
	
	// Position at same location as tile test object
	testRenderObject.position.set(800, 200, 600);
	testRenderObject.scale.set(0.3, 0.3, 0.3);
	
	
	// Debug normals on simple geometry
	
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
		
	} else {
		console.error("ERROR: Simple geometry has no normals!");
	}
	
	action.provideResult({
		geometry: testGeometry,
		material: testMaterial,
		renderObject: testRenderObject
	});
}

// Modular Color Overlay System
var colorOverlayRegistry = {};

// Material management system
var materialCache = {};
var currentMaterialType = 'basic';

// Create planet material of specified type
function createPlanetMaterial(materialType) {
	if (materialCache[materialType]) {
		return materialCache[materialType];
	}

	var material;
	if (materialType === 'lambert') {
		material = new THREE.MeshLambertMaterial({
			vertexColors: true,
			side: THREE.DoubleSide
		});
	} else {
		// Default to basic material
		material = new THREE.MeshBasicMaterial({
			vertexColors: true,
			side: THREE.DoubleSide
		});
	}

	materialCache[materialType] = material;
	return material;
}

// Register a color overlay function
function registerColorOverlay(id, name, description, colorFunction, materialType, computationType) {
	colorOverlayRegistry[id] = {
		id: id,
		name: name,
		description: description,
		colorFunction: colorFunction,
		materialType: materialType || 'basic', // Default to basic material if not specified
		computationType: computationType || 'lazy' // 'precompute', 'lazy', or 'immediate'
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

	// Check if material type needs to change
	var needsMaterialChange = (currentMaterialType !== overlay.materialType);

	if (needsMaterialChange) {
		recreateGeometryWithMaterial(overlay.materialType);
		currentMaterialType = overlay.materialType;
	}

	recalculateBufferGeometryColors(planet.topology.tiles, planet.renderData.surface.geometry, overlayId);
}

// Recreate geometry with new material type
function recreateGeometryWithMaterial(materialType) {
	if (!planet || !planet.renderData || !planet.renderData.surface) {
		return;
	}

	var surfaceRenderObject = planet.renderData.surface.renderObject;
	var oldGeometry = planet.renderData.surface.geometry;

	// Create new material
	var newMaterial = createPlanetMaterial(materialType);

	// Create new mesh with same geometry but new material
	var newMesh = new THREE.Mesh(oldGeometry, newMaterial);
	newMesh.position.copy(surfaceRenderObject.position);
	newMesh.rotation.copy(surfaceRenderObject.rotation);
	newMesh.scale.copy(surfaceRenderObject.scale);

	// Replace in scene
	if (scene) {
		scene.remove(surfaceRenderObject);
		scene.add(newMesh);
	}

	// Update planet render data reference
	planet.renderData.surface.renderObject = newMesh;
}

// Register the existing color overlays
registerColorOverlay("terrain", "Realistic Terrain", "Realistic biome-based terrain coloring", calculateTerrainColor, "lambert");
registerColorOverlay("elevation", "Elevation Map", "Height-based visualization from brown (low) to white (high)", calculateElevationColor, "lambert");
registerColorOverlay("temperature", "Temperature Map", "Thermal visualization from blue (cold) to red (hot)", calculateTemperatureColor, "lambert");
registerColorOverlay("moisture", "Moisture Map", "Precipitation visualization from brown (dry) to green (wet)", calculateMoistureColor, "lambert");
registerColorOverlay("plates", "Tectonic Plates", "Tectonic plate boundaries and colors", calculatePlatesColor, "basic");

// Example: Add new overlays - demonstrating how easy it is to extend
registerColorOverlay("simple", "Simple Land/Water", "Basic land (green) vs water (blue) visualization", function(tile) {
	return tile.elevation <= 0 ? new THREE.Color(0x0066CC) : new THREE.Color(0x00AA44);
}, "basic");

registerColorOverlay("heat", "Heat Map", "Red-hot visualization based on elevation and temperature", function(tile) {
	var intensity = Math.max(0, Math.min(1, (tile.elevation || 0) + (tile.temperature || 0) * 0.5));
	return new THREE.Color(intensity, 0, 0);
}, "basic");

// Watersheds color overlay - shows drainage basins in different colors
registerColorOverlay("watersheds", "Watersheds", "Shows drainage basins with distinct colors", function(tile) {
	// Ocean tiles get flat blue-gray
	if (tile.elevation <= 0) {
		return new THREE.Color(0x6699CC);
	}

	if (tile.watershed && tile.watershed.graphColor) {
		return new THREE.Color(tile.watershed.graphColor);
	}
	// Fall back to original color if graph coloring not available
	if (tile.watershed && tile.watershed.color) {
		return new THREE.Color(tile.watershed.color);
	}
	// Default color for land tiles without watershed assignment
	return new THREE.Color(0x888888);
}, "basic");

// Shore distance color overlay - shows distance from shoreline
registerColorOverlay("shore", "Shore Distance", "Distance from shore: light blue (ocean edge) to dark blue (deep ocean), bright yellow (land edge) to dark green (inland)", function(tile) {
	if (!tile.hasOwnProperty('shore')) {
		return new THREE.Color(0x888888); // Gray fallback if shore not calculated
	}

	if (tile.shore === 0) {
		return new THREE.Color(0x888888); // Gray for uncategorized tiles
	}

	if (tile.shore < 0) {
		// Ocean tiles: negative values
		// Light blue (-1) to dark blue (very negative)
		var maxNegative = Math.min(...planet.topology.tiles.map(t => t.shore || 0));
		var normalizedValue = Math.abs(tile.shore) / Math.abs(maxNegative);

		// Lerp from light blue to dark blue
		var lightBlue = new THREE.Color(0x87CEEB); // Light blue
		var darkBlue = new THREE.Color(0x000080);  // Dark blue
		return lightBlue.clone().lerp(darkBlue, normalizedValue);
	} else {
		// Land tiles: positive values
		// Bright yellow (1) to dark green (very positive)
		var maxPositive = Math.max(...planet.topology.tiles.map(t => t.shore || 0));
		var normalizedValue = tile.shore / maxPositive;

		// Lerp from bright yellow to dark green
		var brightYellow = new THREE.Color(0xFFFF00); // Bright yellow
		var darkGreen = new THREE.Color(0x006400);    // Dark green
		return brightYellow.clone().lerp(darkGreen, normalizedValue);
	}
}, "basic");

// Reverse shore distance color overlay - shows distance from the extreme inland/deep ocean points
registerColorOverlay("reverseShore", "Reverse Shore Distance", "Distance from extreme inland/deep ocean points: same color scheme as shore distance", function(tile) {
	if (!tile.hasOwnProperty('reverseShore')) {
		return new THREE.Color(0x888888); // Gray fallback if reverse shore not calculated
	}

	if (tile.reverseShore === 0) {
		return new THREE.Color(0x888888); // Gray for uncategorized tiles
	}

	if (tile.reverseShore < 0) {
		// Ocean tiles: negative values
		// Light blue (-1) to dark blue (very negative)
		var maxNegative = Math.min(...planet.topology.tiles.map(t => t.reverseShore || 0));
		var normalizedValue = Math.abs(tile.reverseShore) / Math.abs(maxNegative);

		// Lerp from light blue to dark blue
		var lightBlue = new THREE.Color(0x87CEEB); // Light blue
		var darkBlue = new THREE.Color(0x000080);  // Dark blue
		return lightBlue.clone().lerp(darkBlue, normalizedValue);
	} else {
		// Land tiles: positive values
		// Bright yellow (1) to dark green (very positive)
		var maxPositive = Math.max(...planet.topology.tiles.map(t => t.reverseShore || 0));
		var normalizedValue = tile.reverseShore / maxPositive;

		// Lerp from bright yellow to dark green
		var brightYellow = new THREE.Color(0xFFFF00); // Bright yellow
		var darkGreen = new THREE.Color(0x006400);    // Dark green
		return brightYellow.clone().lerp(darkGreen, normalizedValue);
	}
}, "basic");

// Net Shore color overlay - shows reverseShore minus shore
registerColorOverlay("shoreRatio", "Net Shore", "Net shore distance (reverseShore - shore) with custom color schemes", function(tile) {
	if (!tile.hasOwnProperty('shore') || !tile.hasOwnProperty('reverseShore')) {
		return new THREE.Color(0x888888); // Gray fallback if data not calculated
	}

	if (tile.shore === 0 || tile.reverseShore === 0) {
		return new THREE.Color(0x888888); // Gray for uncategorized tiles
	}

	// Calculate net shore: reverseShore - shore
	var netShore = tile.reverseShore - tile.shore;

	if (tile.shore > 0) {
		// Land tiles: red (negative) -> yellow (0) -> dark green (positive)
		var landNetShores = planet.topology.tiles
			.filter(t => t.shore > 0 && t.hasOwnProperty('reverseShore'))
			.map(t => t.reverseShore - t.shore);

		if (landNetShores.length === 0) {
			return new THREE.Color(0x888888);
		}

		var minLandNet = Math.min(...landNetShores);
		var maxLandNet = Math.max(...landNetShores);

		if (netShore < 0) {
			// Negative: interpolate from yellow (0) to red (most negative)
			var normalizedValue = Math.abs(netShore) / Math.abs(minLandNet);
			var yellow = new THREE.Color(0xFFFF00);   // Yellow at 0
			var red = new THREE.Color(0xFF0000);      // Red at most negative
			return yellow.clone().lerp(red, normalizedValue);
		} else if (netShore === 0) {
			return new THREE.Color(0xFFFF00); // Yellow at exactly 0
		} else {
			// Positive: interpolate from yellow (0) to dark green (most positive)
			var normalizedValue = netShore / maxLandNet;
			var yellow = new THREE.Color(0xFFFF00);   // Yellow at 0
			var darkGreen = new THREE.Color(0x006400); // Dark green at most positive
			return yellow.clone().lerp(darkGreen, normalizedValue);
		}
	} else {
		// Ocean tiles: dark blue (negative) -> blue (0) -> magenta (positive)
		var oceanNetShores = planet.topology.tiles
			.filter(t => t.shore < 0 && t.hasOwnProperty('reverseShore'))
			.map(t => t.reverseShore - t.shore);

		if (oceanNetShores.length === 0) {
			return new THREE.Color(0x888888);
		}

		var minOceanNet = Math.min(...oceanNetShores);
		var maxOceanNet = Math.max(...oceanNetShores);

		if (netShore < 0) {
			// Negative: interpolate from blue (0) to dark blue (most negative)
			var normalizedValue = Math.abs(netShore) / Math.abs(minOceanNet);
			var blue = new THREE.Color(0x0000FF);     // Blue at 0
			var darkBlue = new THREE.Color(0x000080); // Dark blue at most negative
			return blue.clone().lerp(darkBlue, normalizedValue);
		} else if (netShore === 0) {
			return new THREE.Color(0x0000FF); // Blue at exactly 0
		} else {
			// Positive: interpolate from blue (0) to magenta (most positive)
			var normalizedValue = netShore / maxOceanNet;
			var blue = new THREE.Color(0x0000FF);     // Blue at 0
			var magenta = new THREE.Color(0xFF00FF);  // Magenta at most positive
			return blue.clone().lerp(magenta, normalizedValue);
		}
	}
}, "basic");

// Land Regions color overlay - shows K-means clustered land regions
registerColorOverlay("landRegions", "Land Regions", "Shows clustered land regions in different colors", function(tile) {
	// Ocean tiles get flat blue-gray
	if (tile.elevation <= 0) {
		return new THREE.Color(0x6699CC);
	}

	// Land tiles get colored by their region using graph coloring
	if (tile.landRegion && tile.landRegion > 0) {
		// Use graph-based color if available
		if (tile.landRegionGraphColor) {
			return new THREE.Color(tile.landRegionGraphColor);
		}

		// Fallback to original hue-based coloring
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
}, "basic");

// Watershed Regions color overlay - shows watersheds after coastal absorption
registerColorOverlay("watershedRegions", "Watershed Regions", "Shows watersheds with coastal absorption based on O:L ratios", function(tile) {
	// Ocean tiles get flat blue-gray
	if (tile.elevation <= 0) {
		return new THREE.Color(0x6699CC);
	}

	// Direct lookup using simple final region structure
	if (tile.finalRegionId && window.watershedFinalRegions) {
		// Direct array access since IDs are now sequential 1, 2, 3...
		var finalRegion = window.watershedFinalRegions[tile.finalRegionId - 1];

		if (finalRegion && finalRegion.color) {
			return new THREE.Color(finalRegion.color);
		}

		// Fallback: Use constrained palette if region exists but missing color
		if (finalRegion) {
			var paletteColors = ["#606c38","#283618","#fefae0","#dda15e","#bc6c25"];
			var paletteIndex = (tile.finalRegionId - 1) % 5;
			return new THREE.Color(paletteColors[paletteIndex]);
		}
	}

	// Priority 5: Fallback to regular watershed coloring
	if (tile.watershed && tile.watershed.graphColor) {
		return new THREE.Color(tile.watershed.graphColor);
	}
	if (tile.watershed && tile.watershed.color) {
		return new THREE.Color(tile.watershed.color);
	}

	// Default color for land tiles without watershed assignment
	console.warn("Land tile without watershed assignment found");
	return new THREE.Color(0x888888);
}, "basic");

// Color palette arrays for different region types
var WATERSHED_COLORS = ["#606c38","#283618","#fefae0","#dda15e","#bc6c25"];
var WATERSHED_REGION_COLORS = ["#606c38","#283618","#fefae0","#dda15e","#bc6c25"];
var LAND_REGION_COLORS = ["#606c38","#283618","#fefae0","#dda15e","#bc6c25"];

// Generate color palette for specific region type
function getRegionColorPalette(regionType) {
	switch (regionType) {
		case 'watershed':
			return WATERSHED_COLORS.slice(); // Return copy
		case 'watershedRegion':
			return WATERSHED_REGION_COLORS.slice(); // Return copy
		case 'landRegion':
			return LAND_REGION_COLORS.slice(); // Return copy
		default:
			return WATERSHED_COLORS.slice(); // Default fallback
	}
}

// Graph coloring algorithm using Welsh-Powell (greedy with degree sorting)
function applyGraphColoring(regions, getAdjacencies, colorProperty, regionType) {
	if (!regions || regions.length === 0) {
		return;
	}

	// Get the appropriate color palette
	var colorPalette = getRegionColorPalette(regionType);

	// Build adjacency information
	var adjacencyMap = {};
	var regionIds = [];

	// Initialize adjacency lists
	for (var i = 0; i < regions.length; i++) {
		var region = regions[i];
		var regionId = region.id || region.finalId || region.landRegion || i;
		regionIds.push(regionId);
		adjacencyMap[regionId] = [];
	}

	// Populate adjacencies using the provided function
	for (var i = 0; i < regions.length; i++) {
		var region = regions[i];
		var regionId = regionIds[i];
		var adjacentIds = getAdjacencies(region, regions);

		for (var j = 0; j < adjacentIds.length; j++) {
			var adjacentId = adjacentIds[j];
			if (adjacencyMap[regionId] && adjacencyMap[adjacentId]) {
				adjacencyMap[regionId].push(adjacentId);
				adjacencyMap[adjacentId].push(regionId);
			}
		}
	}

	// Calculate degrees (number of neighbors)
	var degrees = {};
	for (var i = 0; i < regionIds.length; i++) {
		var regionId = regionIds[i];
		degrees[regionId] = adjacencyMap[regionId].length;
	}

	// Sort regions by degree (descending) for better coloring
	var sortedRegionIds = regionIds.slice().sort(function(a, b) {
		return degrees[b] - degrees[a];
	});

	// Color assignment with strict 5-color limit and even distribution
	var coloring = {};
	var colorUsage = {}; // Track how many times each color is used

	// Initialize color usage counter
	for (var i = 0; i < colorPalette.length; i++) {
		colorUsage[i] = 0;
	}

	// First pass: Assign colors greedily while respecting constraints
	for (var i = 0; i < sortedRegionIds.length; i++) {
		var regionId = sortedRegionIds[i];
		var usedColors = {};

		// Check colors used by neighbors
		var neighbors = adjacencyMap[regionId] || [];
		for (var j = 0; j < neighbors.length; j++) {
			var neighborId = neighbors[j];
			if (coloring[neighborId] !== undefined) {
				usedColors[coloring[neighborId]] = true;
			}
		}

		// Find best available color (prioritize least used colors)
		var bestColorIndex = -1;
		var minUsage = Infinity;

		for (var colorIndex = 0; colorIndex < colorPalette.length; colorIndex++) {
			if (!usedColors[colorIndex] && colorUsage[colorIndex] < minUsage) {
				minUsage = colorUsage[colorIndex];
				bestColorIndex = colorIndex;
			}
		}

		// If no color available from original palette, force assignment
		if (bestColorIndex === -1) {
			// This should not happen with proper planar graphs, but handle gracefully
			// Find the least-used color among neighbors (breaking adjacency constraint minimally)
			console.warn("Graph coloring conflict detected for region", regionId, "- using least conflicting color");

			var minConflictUsage = Infinity;
			var fallbackColorIndex = 0;

			for (var colorIndex = 0; colorIndex < colorPalette.length; colorIndex++) {
				if (colorUsage[colorIndex] < minConflictUsage) {
					minConflictUsage = colorUsage[colorIndex];
					fallbackColorIndex = colorIndex;
				}
			}
			bestColorIndex = fallbackColorIndex;
		}

		coloring[regionId] = bestColorIndex;
		colorUsage[bestColorIndex]++;
	}

	// Second pass: Redistribute colors for better balance
	// COMMENTED OUT FOR DEBUGGING - Testing if adjacency issues are in initial coloring or redistribution
	/*
	// Try to swap colors to achieve more even distribution
	var targetUsagePerColor = Math.ceil(sortedRegionIds.length / colorPalette.length);
	var maxIterations = 10;
	var iteration = 0;

	while (iteration < maxIterations) {
		var swapMade = false;

		// Find overused and underused colors
		var overusedColors = [];
		var underusedColors = [];

		for (var colorIndex = 0; colorIndex < colorPalette.length; colorIndex++) {
			if (colorUsage[colorIndex] > targetUsagePerColor) {
				overusedColors.push(colorIndex);
			} else if (colorUsage[colorIndex] < targetUsagePerColor) {
				underusedColors.push(colorIndex);
			}
		}

		// Try to swap regions from overused to underused colors
		for (var i = 0; i < overusedColors.length && !swapMade; i++) {
			var overusedColor = overusedColors[i];

			// Find regions using the overused color
			for (var j = 0; j < sortedRegionIds.length && !swapMade; j++) {
				var regionId = sortedRegionIds[j];

				if (coloring[regionId] === overusedColor) {
					// Check if we can assign an underused color to this region
					var neighbors = adjacencyMap[regionId] || [];
					var neighborColors = {};

					for (var k = 0; k < neighbors.length; k++) {
						var neighborId = neighbors[k];
						if (coloring[neighborId] !== undefined) {
							neighborColors[coloring[neighborId]] = true;
						}
					}

					// Try underused colors
					for (var l = 0; l < underusedColors.length; l++) {
						var underusedColor = underusedColors[l];

						if (!neighborColors[underusedColor]) {
							// Safe to swap
							coloring[regionId] = underusedColor;
							colorUsage[overusedColor]--;
							colorUsage[underusedColor]++;
							swapMade = true;
							break;
						}
					}
				}
			}
		}

		if (!swapMade) break;
		iteration++;
	}
	*/
	var iteration = 0; // Set to 0 since redistribution is commented out

	// Apply colors to regions
	for (var i = 0; i < regions.length; i++) {
		var region = regions[i];
		var regionId = regionIds[i];
		var colorIndex = coloring[regionId];

		if (colorIndex !== undefined && colorPalette[colorIndex]) {
			region[colorProperty] = colorPalette[colorIndex];
		}
	}

	// Graph coloring complete - statistics calculated for internal use
	var usageCounts = Object.values(colorUsage);
	var minUsage = Math.min.apply(Math, usageCounts);
	var maxUsage = Math.max.apply(Math, usageCounts);
	var avgUsage = usageCounts.reduce(function(a, b) { return a + b; }, 0) / usageCounts.length;
}

// Path Density color overlay - shows density of paths between boundary tiles within land/sea bodies
registerColorOverlay("pathDensity", "Path Density", "Shows density of paths between boundary tiles within land/sea bodies using reverseShore color scheme", function(tile) {
	if (!tile.hasOwnProperty('pathDensity')) {
		return new THREE.Color(0x888888); // Gray fallback if not pre-calculated
	}

	if (tile.pathDensity === 0) {
		return new THREE.Color(0x888888); // Gray for tiles not used in any paths
	}

	// Use the same color scheme as reverseShore
	// Land tiles get positive values, ocean tiles get negative values
	var isLand = tile.elevation >= 0;
	var densityValue = isLand ? tile.pathDensity : -tile.pathDensity;

	if (densityValue < 0) {
		// Ocean tiles: negative values
		// Light blue (low density) to dark blue (high density)
		var allOceanDensities = planet.topology.tiles
			.filter(t => t.elevation < 0 && t.hasOwnProperty('pathDensity'))
			.map(t => t.pathDensity);
		if (allOceanDensities.length === 0) return new THREE.Color(0x888888);

		var maxOceanDensity = Math.max(...allOceanDensities);
		if (maxOceanDensity === 0) return new THREE.Color(0x888888);

		var normalizedValue = tile.pathDensity / maxOceanDensity;
		var lightBlue = new THREE.Color(0x87CEEB); // Light blue
		var darkBlue = new THREE.Color(0x000080);  // Dark blue
		return lightBlue.clone().lerp(darkBlue, normalizedValue);
	} else {
		// Land tiles: positive values
		// Bright yellow (low density) to dark green (high density)
		var allLandDensities = planet.topology.tiles
			.filter(t => t.elevation >= 0 && t.hasOwnProperty('pathDensity'))
			.map(t => t.pathDensity);
		if (allLandDensities.length === 0) return new THREE.Color(0x888888);

		var maxLandDensity = Math.max(...allLandDensities);
		if (maxLandDensity === 0) return new THREE.Color(0x888888);

		var normalizedValue = tile.pathDensity / maxLandDensity;
		var brightYellow = new THREE.Color(0xFFFF00); // Bright yellow
		var darkGreen = new THREE.Color(0x006400);    // Dark green
		return brightYellow.clone().lerp(darkGreen, normalizedValue);
	}
}, "basic", "precompute");

// Function to calculate path density for all tiles
function calculatePathDensity() {
	ctime("calculatePathDensity");

	// Initialize path density for all tiles
	for (var i = 0; i < planet.topology.tiles.length; i++) {
		planet.topology.tiles[i].pathDensity = 0;
	}

	// Process each body separately
	for (var bodyIndex = 0; bodyIndex < planet.topology.bodies.length; bodyIndex++) {
		var body = planet.topology.bodies[bodyIndex];
		if (!body.tiles || body.tiles.length === 0) continue;

		// Determine if this is a land or sea body
		var isLandBody = body.id > 0;

		// Find boundary tiles - those without neighbors having higher/lower reverseShore values
		var boundaryTiles = [];
		for (var i = 0; i < body.tiles.length; i++) {
			var tile = body.tiles[i];
			if (!tile.hasOwnProperty('reverseShore')) continue;

			var isBoundary = true;
			var neighbors = tile.tiles || [];

			for (var j = 0; j < neighbors.length; j++) {
				var neighbor = neighbors[j];
				if (neighbor.body === body && neighbor.hasOwnProperty('reverseShore')) {
					// Check if neighbor has higher or lower reverseShore value
					// For land bodies, boundary tiles have no neighbors with higher reverseShore
					// For sea bodies, boundary tiles have no neighbors with lower reverseShore
					if (isLandBody && neighbor.reverseShore > tile.reverseShore) {
						isBoundary = false;
						break;
					} else if (!isLandBody && neighbor.reverseShore < tile.reverseShore) {
						isBoundary = false;
						break;
					}
				}
			}

			if (isBoundary) {
				boundaryTiles.push(tile);
			}
		}

		// Skip if no boundary tiles found
		if (boundaryTiles.length < 2) continue;

		// Create unweighted graph for this body
		var bodyGraph = createUnweightedBodyGraph(body);

		// Find paths between all pairs of boundary tiles
		for (var i = 0; i < boundaryTiles.length; i++) {
			for (var j = i + 1; j < boundaryTiles.length; j++) {
				var startTile = boundaryTiles[i];
				var endTile = boundaryTiles[j];

				var path = findUnweightedPath(startTile, endTile, bodyGraph);
				if (path && path.length > 0) {
					// Count usage for each tile in the path
					for (var k = 0; k < path.length; k++) {
						path[k].pathDensity += 1;
					}
				}
			}
		}
	}

	ctimeEnd("calculatePathDensity");
}

// Create an unweighted graph for tiles within a body
function createUnweightedBodyGraph(body) {
	var graph = {};
	var bodyTileSet = new Set(body.tiles);

	for (var i = 0; i < body.tiles.length; i++) {
		var tile = body.tiles[i];
		graph[tile.id] = [];

		var neighbors = tile.tiles || [];
		for (var j = 0; j < neighbors.length; j++) {
			var neighbor = neighbors[j];
			if (bodyTileSet.has(neighbor)) {
				graph[tile.id].push(neighbor);
			}
		}
	}

	return graph;
}

// Find unweighted path using BFS
function findUnweightedPath(startTile, endTile, graph) {
	if (startTile.id === endTile.id) return [startTile];

	var queue = [[startTile]];
	var visited = new Set([startTile.id]);

	while (queue.length > 0) {
		var path = queue.shift();
		var currentTile = path[path.length - 1];

		var neighbors = graph[currentTile.id] || [];
		for (var i = 0; i < neighbors.length; i++) {
			var neighbor = neighbors[i];

			if (neighbor.id === endTile.id) {
				return path.concat([neighbor]);
			}

			if (!visited.has(neighbor.id)) {
				visited.add(neighbor.id);
				queue.push(path.concat([neighbor]));
			}
		}
	}

	return null; // No path found
}