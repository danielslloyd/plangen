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
	
	
	// Pre-allocate typed arrays for BufferGeometry (will expand dynamically if needed)
	var positions = new Float32Array(totalVertices * 3);
	var colors = new Float32Array(totalVertices * 3);
	var indices = new Uint32Array(totalFaces * 3);

	// Dynamic buffer expansion functions
	var expandBuffersIfNeeded = function(requiredVertices, requiredTriangles) {
		var currentVertexCapacity = positions.length / 3;
		var currentTriangleCapacity = indices.length / 3;

		if (requiredVertices > currentVertexCapacity || requiredTriangles > currentTriangleCapacity) {
			console.log("Expanding buffers - Vertices:", currentVertexCapacity, "->", requiredVertices, "Triangles:", currentTriangleCapacity, "->", requiredTriangles);

			// Calculate new capacity (add 50% more for future growth)
			var newVertexCapacity = Math.max(requiredVertices, currentVertexCapacity) * 1.5;
			var newTriangleCapacity = Math.max(requiredTriangles, currentTriangleCapacity) * 1.5;

			// Create new larger arrays
			var newPositions = new Float32Array(newVertexCapacity * 3);
			var newColors = new Float32Array(newVertexCapacity * 3);
			var newIndices = new Uint32Array(newTriangleCapacity * 3);

			// Copy existing data
			newPositions.set(positions);
			newColors.set(colors);
			newIndices.set(indices);

			// Replace arrays
			positions = newPositions;
			colors = newColors;
			indices = newIndices;
		}
	};
	
	var vertexIndex = 0;
	var triangleIndex = 0;
	var finalResult = null; // Store the final result here
	
	var minShore = Math.min.apply(0, tiles.map((data) => data.shore));
	var maxShore = Math.max.apply(0, tiles.map((data) => data.shore));
	var minBody = Math.min.apply(0, tiles.map((data) => data.body.id));
	var maxBody = Math.max.apply(0, tiles.map((data) => data.body.id));
	let maxSediment = Math.max(...tiles.map(t => t.sediment? t.sediment:0));

	// Note: Preserving original tile order to maintain color overlay mapping

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

		// Debug coordinate system - mark tiles based on different criteria
		var spherical = cartesianToSpherical(tile.averagePosition);
		var pos = tile.averagePosition;

		// Test 11: Create 180° meridian with yellow-to-red gradient (north to south)
		// Narrow range to only tiles that actually contain the 180° meridian line
		var meridian180 = Math.abs(Math.abs(spherical.theta) - Math.PI); // Distance from ±180°
		if (meridian180 < 0.05) { // 180° meridian ±2.9 degrees (much narrower)
			// Create gradient from yellow (north pole, phi=π/2) to red (south pole, phi=-π/2)
			// Normalize phi from [-π/2, π/2] to [0, 1] where 0=south, 1=north
			var normalizedLat = (spherical.phi + Math.PI/2) / Math.PI; // 0 to 1, south to north

			// Lerp from red (south) to yellow (north)
			var red = new THREE.Color(0xFF0000);   // South pole color
			var yellow = new THREE.Color(0xFFFF00); // North pole color
			var gradientColor = red.clone().lerp(yellow, normalizedLat);

			// Convert to hex string for tile.error
			tile.error = '#' + gradientColor.getHexString();
		}

		// Debug logging for first few tiles to understand coordinate mapping
		if (i < 5) {
			console.log("Tile", i, "Cartesian:", pos.x.toFixed(2), pos.y.toFixed(2), pos.z.toFixed(2),
						"Spherical theta:", (spherical.theta * 180/Math.PI).toFixed(1), "phi:", (spherical.phi * 180/Math.PI).toFixed(1));
		}

		// Calculate terrain color using extracted function
		var terrainColor = calculateTerrainColor(tile);
		
		// Calculate tile center position (with elevation and projection)
		var centerPos = tile.averagePosition.clone();
		if (projectionMode === "mercator") {
			// Project to Mercator coordinates
			var mercatorCoords = cartesianToMercator(centerPos, mercatorCenterLat, mercatorCenterLon);
			// Scale coordinates for experimental zoom range (larger world)
			// Add small Z-offset based on tile index to prevent Z-fighting
			var zOffset = i * 0.001;
			centerPos = new THREE.Vector3(mercatorCoords.x * 2.0, mercatorCoords.y * 2.0, zOffset);

			// Debug logging for first few tiles
			if (i < 3) {
				console.log("Tile", i, "center - Original:", tile.averagePosition, "Mercator:", mercatorCoords, "Final:", centerPos);
			}
		} else {
			// Original 3D positioning
			if (tile.elevation > 0) {
				var centerDistance = centerPos.length();
				var displacement = useElevationDisplacement ? tile.elevationDisplacement : 0;
				centerPos.normalize().multiplyScalar(centerDistance + displacement);
			}
		}
		
		// Calculate corner positions (with elevation and projection)
		var cornerPositions = [];
		var cornerMercatorCoords = []; // Track original mercator coords for wraparound detection
		for (var j = 0; j < tile.corners.length; j++) {
			var corner = tile.corners[j];
			var cornerPos = corner.position.clone();

			if (projectionMode === "mercator") {
				// Project to Mercator coordinates
				var mercatorCoords = cartesianToMercator(cornerPos, mercatorCenterLat, mercatorCenterLon);
				cornerMercatorCoords.push(mercatorCoords);

				// Scale coordinates for experimental zoom range (larger world)
				// Use same Z-offset as tile center to keep triangle coplanar
				var zOffset = i * 0.001;
				cornerPos = new THREE.Vector3(mercatorCoords.x * 2.0, mercatorCoords.y * 2.0, zOffset);

				// Debug logging for first tile's corners
				if (i < 1 && j < 3) {
					console.log("Tile", i, "corner", j, "- Original:", corner.position, "Mercator:", mercatorCoords, "Final:", cornerPos);
				}
			} else {
				// Original 3D positioning with elevation
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
			}

			cornerPositions.push(cornerPos);
		}

		// Check for antimeridian wrapping in Mercator mode
		var tileVersions = [{ center: centerPos, corners: cornerPositions }]; // Default version
		if (projectionMode === "mercator" && cornerMercatorCoords.length > 0) {
			// Find min and max longitude coordinates
			var lonCoords = cornerMercatorCoords.map(coord => coord.x);
			var minLon = Math.min.apply(Math, lonCoords);
			var maxLon = Math.max.apply(Math, lonCoords);

			// If longitude span > π, tile crosses antimeridian
			if (maxLon - minLon > Math.PI) {
				console.log("Tile", i, "crosses antimeridian! MinLon:", minLon.toFixed(3), "MaxLon:", maxLon.toFixed(3), "Span:", (maxLon - minLon).toFixed(3));

				// Create two versions: left side (subtract 2π from positive coords) and right side (add 2π to negative coords)
				var leftCorners = [];
				var rightCorners = [];
				var zOffset = i * 0.001;

				for (var k = 0; k < cornerMercatorCoords.length; k++) {
					var coord = cornerMercatorCoords[k];

					// Left side: shift positive longitudes left by 2π
					var leftX = coord.x > 0 ? coord.x - 2 * Math.PI : coord.x;
					leftCorners.push(new THREE.Vector3(leftX * 2.0, coord.y * 2.0, zOffset));

					// Right side: shift negative longitudes right by 2π
					var rightX = coord.x < 0 ? coord.x + 2 * Math.PI : coord.x;
					rightCorners.push(new THREE.Vector3(rightX * 2.0, coord.y * 2.0, zOffset));
				}

				// Replace default version with both wrapped versions
				tileVersions = [
					{ center: centerPos, corners: leftCorners },
					{ center: centerPos, corners: rightCorners }
				];
			}
		}

		// Create independent triangles for each tile version (handles wraparound)
		for (var versionIndex = 0; versionIndex < tileVersions.length; versionIndex++) {
			var version = tileVersions[versionIndex];
			var versionCenter = version.center;
			var versionCorners = version.corners;

			for (var j = 0; j < versionCorners.length; j++) {
				var nextJ = (j + 1) % versionCorners.length;

				// Triangle vertices: center -> corner[j] -> corner[j+1]
				var vertex1 = versionCenter;
				var vertex2 = versionCorners[j];
				var vertex3 = versionCorners[nextJ];

				// Check if this triangle spans the map boundary in Mercator mode and fix coordinates in-place
				if (projectionMode === "mercator") {
					var triangleVertices = [vertex1, vertex2, vertex3];
					var xCoords = triangleVertices.map(v => v.x);
					var minX = Math.min.apply(Math, xCoords);
					var maxX = Math.max.apply(Math, xCoords);

					// If triangle spans more than half the map width, it's wrapping
					if (maxX - minX > Math.PI * 2.0) { // 2π * 2.0 scaling = map width
						console.log("Triangle", i, j, "spans map boundary! MinX:", minX.toFixed(3), "MaxX:", maxX.toFixed(3), "- Fixing coordinates in-place");

						// Fix coordinates in-place by moving outlying vertices to the correct side
						var mapWidth = Math.PI * 4.0; // Full map width in scaled coordinates
						var avgX = (vertex1.x + vertex2.x + vertex3.x) / 3;

						// Correct each vertex that is far from the average
						if (Math.abs(vertex1.x - avgX) > Math.PI * 2.0) {
							vertex1.x += vertex1.x > avgX ? -mapWidth : mapWidth;
							console.log("  Corrected vertex1 X coordinate");
						}
						if (Math.abs(vertex2.x - avgX) > Math.PI * 2.0) {
							vertex2.x += vertex2.x > avgX ? -mapWidth : mapWidth;
							console.log("  Corrected vertex2 X coordinate");
						}
						if (Math.abs(vertex3.x - avgX) > Math.PI * 2.0) {
							vertex3.x += vertex3.x > avgX ? -mapWidth : mapWidth;
							console.log("  Corrected vertex3 X coordinate");
						}
					}
				}

			// Check if we need to expand buffers for 3 more vertices and 1 more triangle
			expandBuffersIfNeeded(vertexIndex + 3, triangleIndex + 1);

			// Add vertex 1 (center) - normal triangle rendering
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
		
		// Create final buffer attributes with only the used portion
		// (buffers may have been expanded and contain unused space at the end)
		var finalPositions = positions.slice(0, vertexIndex * 3);
		var finalColors = colors.slice(0, vertexIndex * 3);
		var finalIndices = indices.slice(0, triangleIndex * 3);

		console.log("Final buffer sizes - Vertices used:", vertexIndex, "Triangles used:", triangleIndex);

		// Set buffer attributes directly
		var positionAttribute = new THREE.BufferAttribute(finalPositions, 3);
		var colorAttribute = new THREE.BufferAttribute(finalColors, 3);
		var indexAttribute = new THREE.BufferAttribute(finalIndices, 1);
		
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
				wireframe: renderWireframe,
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

	// Error tiles for debugging with custom color support
	if (tile.error) {
		// Try to parse tile.error as a Three.js color
		try {
			var customColor = new THREE.Color(tile.error);
			// Check if the color was successfully parsed (not black/0 unless intentionally 0x000000)
			if (customColor.getHex() !== 0 || tile.error === '0x000000' || tile.error === '#000000' || tile.error === 'black') {
				terrainColor = customColor;
			} else {
				terrainColor = new THREE.Color(0xFF00FF); // Default magenta for invalid colors
			}
		} catch (e) {
			terrainColor = new THREE.Color(0xFF00FF); // Default magenta for non-color values
		}
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

		// IMPORTANT: Must replicate the exact wraparound logic from buildSurfaceRenderObject
		// to maintain vertex index synchronization

		// Calculate corner positions for wraparound detection (Mercator mode only)
		var tileVersions = [{ corners: tile.corners }]; // Default: single version

		if (projectionMode === "mercator") {
			var cornerMercatorCoords = [];
			for (var j = 0; j < tile.corners.length; j++) {
				var corner = tile.corners[j];
				var mercatorCoords = cartesianToMercator(corner.position, mercatorCenterLat, mercatorCenterLon);
				cornerMercatorCoords.push(mercatorCoords);
			}

			// Check if tile wraps around antimeridian
			var minX = Math.min.apply(Math, cornerMercatorCoords.map(c => c.x));
			var maxX = Math.max.apply(Math, cornerMercatorCoords.map(c => c.x));

			if (maxX - minX > Math.PI) {
				// Tile spans antimeridian - create two versions
				var leftCorners = [];
				var rightCorners = [];

				for (var j = 0; j < cornerMercatorCoords.length; j++) {
					var mercatorCoords = cornerMercatorCoords[j];

					// Left version: shift positive longitudes to negative side
					var leftX = mercatorCoords.x > 0 ? mercatorCoords.x - 2 * Math.PI : mercatorCoords.x;
					leftCorners.push({ x: leftX * 2.0, y: mercatorCoords.y * 2.0 });

					// Right version: shift negative longitudes to positive side
					var rightX = mercatorCoords.x < 0 ? mercatorCoords.x + 2 * Math.PI : mercatorCoords.x;
					rightCorners.push({ x: rightX * 2.0, y: mercatorCoords.y * 2.0 });
				}

				tileVersions = [
					{ corners: leftCorners },
					{ corners: rightCorners }
				];
			}
		}

		// Process each tile version (1 for normal tiles, 2 for wraparound tiles)
		for (var versionIndex = 0; versionIndex < tileVersions.length; versionIndex++) {
			var version = tileVersions[versionIndex];
			var versionCorners = version.corners;

			// Each tile version creates versionCorners.length triangles
			// Each triangle has 3 vertices: center -> corner[j] -> corner[j+1]
			for (var j = 0; j < versionCorners.length; j++) {
				// Set color for all 3 vertices of this triangle (center, corner j, corner j+1)
				colorAttribute.setXYZ(vertexIndex, tileColor.r, tileColor.g, tileColor.b); // center vertex
				vertexIndex++;
				colorAttribute.setXYZ(vertexIndex, tileColor.r, tileColor.g, tileColor.b); // corner j vertex
				vertexIndex++;
				colorAttribute.setXYZ(vertexIndex, tileColor.r, tileColor.g, tileColor.b); // corner j+1 vertex
				vertexIndex++;
			}
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
		wireframe: renderWireframe,
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
		wireframe: renderWireframe
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
/* 
registerColorOverlay("heat", "Heat Map", "Red-hot visualization based on elevation and temperature", function(tile) {
	var intensity = Math.max(0, Math.min(1, (tile.elevation || 0) + (tile.temperature || 0) * 0.5));
	return new THREE.Color(intensity, 0, 0);
}, "basic"); */

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
registerColorOverlay("pathDensity", "Path Density", "Shows density of paths between boundary tiles within land/sea bodies using bright colors", function(tile) {
	// Check if path density calculation is enabled
	if (typeof enablePathDensityCalculation !== 'undefined' && !enablePathDensityCalculation) {
		return new THREE.Color(0x666666); // Dark gray when disabled
	}

	if (!tile.hasOwnProperty('pathDensity')) {
		return new THREE.Color(0x888888); // Gray fallback if not pre-calculated
	}

	if (tile.pathDensity === 0) {
		// Show zero-density tiles in base terrain colors
		if (tile.elevation >= 0) {
			// Land: use minimum land color (bright orange)
			return new THREE.Color(0xFF8000);  // Bright orange
		} else {
			// Ocean: use minimum ocean color (bright cyan)
			return new THREE.Color(0x00FFFF);  // Bright cyan
		}
	}

	// Use the same color scheme as reverseShore
	// Land tiles get positive values, ocean tiles get negative values
	var isLand = tile.elevation >= 0;
	var densityValue = isLand ? tile.pathDensity : -tile.pathDensity;

	if (densityValue < 0) {
		// Ocean tiles: negative values
		// Bright cyan (low density) to deep blue (high density) - more vibrant
		var allOceanDensities = planet.topology.tiles
			.filter(t => t.elevation < 0 && t.hasOwnProperty('pathDensity'))
			.map(t => t.pathDensity);
		if (allOceanDensities.length === 0) return new THREE.Color(0x888888);

		var maxOceanDensity = Math.max(...allOceanDensities);
		if (maxOceanDensity === 0) return new THREE.Color(0x888888);

		var normalizedValue = tile.pathDensity / maxOceanDensity;
		var brightCyan = new THREE.Color(0x00FFFF);   // Bright cyan
		var deepBlue = new THREE.Color(0x000080);     // Deep blue
		return brightCyan.clone().lerp(deepBlue, normalizedValue);
	} else {
		// Land tiles: positive values
		// Bright orange (low density) to deep red (high density) - more vibrant
		var allLandDensities = planet.topology.tiles
			.filter(t => t.elevation >= 0 && t.hasOwnProperty('pathDensity'))
			.map(t => t.pathDensity);
		if (allLandDensities.length === 0) return new THREE.Color(0x888888);

		var maxLandDensity = Math.max(...allLandDensities);
		if (maxLandDensity === 0) return new THREE.Color(0x888888);

		var normalizedValue = tile.pathDensity / maxLandDensity;
		var brightOrange = new THREE.Color(0xFF8000);  // Bright orange
		var deepRed = new THREE.Color(0x800000);       // Deep red
		return brightOrange.clone().lerp(deepRed, normalizedValue);
	}
}, "basic", "precompute");

// Function to calculate path density for all tiles - incremental version
function calculatePathDensityIncremental(action) {
	// Only prevent if starting fresh calculation (no existing state)
	if (window.pathDensityCalculating && !action.pathDensityState) {
		console.log("Path density calculation already in progress, skipping");
		return;
	}
	if (!action.pathDensityState) {
		window.pathDensityCalculating = true;
	}

	// Only show debug info on first run
	if (!action.pathDensityState) {
		ctime("calculatePathDensity");

		console.log("=== Path Density Calculation Starting ===");
		console.log(`Total tiles: ${planet.topology.tiles.length}`);
		console.log(`Total bodies: ${planet.topology.bodies.length}`);

		// Count city tiles for debugging
		var cityCount = 0;
		for (var i = 0; i < planet.topology.tiles.length; i++) {
			if (planet.topology.tiles[i].isCity === true) {
				cityCount++;
			}
		}
		console.log(`Found ${cityCount} city locations`);

		// Initialize path density for all tiles
		for (var i = 0; i < planet.topology.tiles.length; i++) {
			planet.topology.tiles[i].pathDensity = 0;
		}
	}

	// Collect all city locations globally (land cities only)
	var allCities = [];
	if (!action.pathDensityState) {
		for (var i = 0; i < planet.topology.tiles.length; i++) {
			var tile = planet.topology.tiles[i];
			if (tile.isCity === true && tile.elevation >= 0) {
				allCities.push(tile);
			}
		}

		// Limit to prevent computational explosion
		if (allCities.length > 50) {
			var step = Math.floor(allCities.length / 50);
			var sampledCities = [];
			for (var i = 0; i < allCities.length; i += step) {
				sampledCities.push(allCities[i]);
			}
			allCities = sampledCities;
		}

		console.log(`Found ${allCities.length} land cities for global trade network`);
	}

	// State variables for incremental processing
	if (!action.pathDensityState) {
		action.pathDensityState = {
			currentPairIndex: 0,
			cities: allCities,
			totalPairs: (allCities.length * (allCities.length - 1)) / 2,
			processedPairs: 0
		};
	}

	var state = action.pathDensityState;
	var batchSize = 5; // Smaller batch size for global pathfinding

	// Process all city-to-city pairs globally
	var processedInBatch = 0;
	for (var i = 0; i < state.cities.length && processedInBatch < batchSize; i++) {
		for (var j = i + 1; j < state.cities.length && processedInBatch < batchSize; j++) {
			// Skip pairs we've already processed
			var pairIndex = i * (state.cities.length - 1) - (i * (i - 1)) / 2 + (j - i - 1);
			if (pairIndex < state.currentPairIndex) continue;

			var startTile = state.cities[i];
			var endTile = state.cities[j];

			// Use A* pathfinding for global city-to-city routes
			var path = aStarPathfinding(startTile, endTile, planet);
			if (path && path.length > 0) {
				// Count usage for each tile in the path
				for (var k = 0; k < path.length; k++) {
					path[k].pathDensity += 1;
				}
			}

			state.currentPairIndex++;
			state.processedPairs++;
			processedInBatch++;

			// Progress feedback
			if (state.processedPairs % 50 === 0) {
				console.log(`Computed ${state.processedPairs}/${state.totalPairs} global city trade routes`);
			}
		}
	}

	// Check if all pairs are complete
	if (state.currentPairIndex >= state.totalPairs) {
		// All city-to-city paths computed
		console.log("Global city trade network complete");
	} else {
		// Yield control after each batch
		var overallProgress = state.currentPairIndex / state.totalPairs;
		action.loop(overallProgress);
		return; // Exit to yield control
	}

	// Final debug summary
	var totalDensity = 0;
	var nonZeroTiles = 0;
	for (var i = 0; i < planet.topology.tiles.length; i++) {
		if (planet.topology.tiles[i].pathDensity > 0) {
			totalDensity += planet.topology.tiles[i].pathDensity;
			nonZeroTiles++;
		}
	}

	console.log("=== Path Density Calculation Complete ===");
	console.log(`Total density: ${totalDensity}`);
	console.log(`Non-zero tiles: ${nonZeroTiles} out of ${planet.topology.tiles.length}`);
	console.log(`Max density: ${Math.max(...planet.topology.tiles.map(t => t.pathDensity || 0))}`);

	// Cleanup and finish
	delete action.pathDensityState;
	window.pathDensityCalculating = false;
	ctimeEnd("calculatePathDensity");
}

// Legacy function for backward compatibility
function calculatePathDensity() {
	// Create a minimal action object for the incremental version
	var mockAction = {
		loop: function() {} // No-op for synchronous version
	};
	calculatePathDensityIncremental(mockAction);
}

// Resource overlay color functions
function calculateCornColor(tile) {
	var terrainColor = calculateTerrainColor(tile);
	var magenta = new THREE.Color(0xFF00FF);
	var cornValue = Math.min(1, Math.max(0, tile.corn || 0));
	return terrainColor.clone().lerp(magenta, cornValue);
}

function calculateWheatColor(tile) {
	var terrainColor = calculateTerrainColor(tile);
	var magenta = new THREE.Color(0xFF00FF);
	var wheatValue = Math.min(1, Math.max(0, tile.wheat || 0));
	return terrainColor.clone().lerp(magenta, wheatValue);
}

function calculateRiceColor(tile) {
	var terrainColor = calculateTerrainColor(tile);
	var magenta = new THREE.Color(0xFF00FF);
	var riceValue = Math.min(1, Math.max(0, tile.rice || 0));
	return terrainColor.clone().lerp(magenta, riceValue);
}

function calculateFishColor(tile) {
	var terrainColor = calculateTerrainColor(tile);
	var magenta = new THREE.Color(0xFF00FF);
	var fishValue = Math.min(1, Math.max(0, tile.fish || 0));
	return terrainColor.clone().lerp(magenta, fishValue);
}

function calculatePastureColor(tile) {
	var terrainColor = calculateTerrainColor(tile);
	var magenta = new THREE.Color(0xFF00FF);
	var pastureValue = Math.min(1, Math.max(0, tile.pasture || 0));
	return terrainColor.clone().lerp(magenta, pastureValue);
}

function calculateCaloriesColor(tile) {
	// Find the maximum calories value across all tiles for normalization
	var maxCalories = 0;
	for (var i = 0; i < planet.topology.tiles.length; i++) {
		var tileCalories = planet.topology.tiles[i].calories || 0;
		if (tileCalories > maxCalories) {
			maxCalories = tileCalories;
		}
	}

	// Normalize the current tile's calories value (0-1)
	var normalizedCalories = maxCalories > 0 ? (tile.calories || 0) / maxCalories : 0;
	normalizedCalories = Math.min(1, Math.max(0, normalizedCalories));

	// Lerp terrain color toward magenta based on normalized calories
	var terrainColor = calculateTerrainColor(tile);
	var magenta = new THREE.Color(0xFF00FF);
	return terrainColor.clone().lerp(magenta, normalizedCalories);
}

function calculateUpstreamCaloriesColor(tile) {
	// Find the maximum city priority score across all tiles for normalization
	var maxCityPriorityScore = 0;
	for (var i = 0; i < planet.topology.tiles.length; i++) {
		var tilePriorityScore = planet.topology.tiles[i].cityPriorityScore || 0;
		if (tilePriorityScore > maxCityPriorityScore) {
			maxCityPriorityScore = tilePriorityScore;
		}
	}

	// Normalize the current tile's city priority score (0-1)
	var normalizedPriorityScore = maxCityPriorityScore > 0 ? (tile.cityPriorityScore || 0) / maxCityPriorityScore : 0;
	normalizedPriorityScore = Math.min(1, Math.max(0, normalizedPriorityScore));

	// Lerp terrain color toward magenta based on normalized city priority score
	var terrainColor = calculateTerrainColor(tile);
	var magenta = new THREE.Color(0xFF00FF);
	return terrainColor.clone().lerp(magenta, normalizedPriorityScore);
}

// Register resource overlays
registerColorOverlay("corn", "Corn Resources", "Terrain colored toward magenta based on corn resource values", calculateCornColor, "lambert");
registerColorOverlay("wheat", "Wheat Resources", "Terrain colored toward magenta based on wheat resource values", calculateWheatColor, "lambert");
registerColorOverlay("rice", "Rice Resources", "Terrain colored toward magenta based on rice resource values", calculateRiceColor, "lambert");
registerColorOverlay("fish", "Fish Resources", "Terrain colored toward magenta based on fish resource values", calculateFishColor, "lambert");
registerColorOverlay("pasture", "Pasture Resources", "Terrain colored toward magenta based on pasture resource values", calculatePastureColor, "lambert");
registerColorOverlay("calories", "Calories (Normalized)", "Terrain colored toward magenta based on normalized calories values (max = 1)", calculateCaloriesColor, "lambert");
registerColorOverlay("upstreamCalories", "City Priority Score", "Terrain colored toward magenta based on city priority score (calorie flux + bonuses)", calculateUpstreamCaloriesColor, "lambert");

// ============================================================================
// GLOBAL STRIPE SYSTEM FOR RESOURCES
// ============================================================================

// Configurable stripe system for displaying resource overlays with horizontal bands
var stripeConfig = {
	coverage: 0.5,        // 50% of tile area covered by stripes (0.0 to 1.0)
	stripeCount: 7,       // Number of stripes per average tile
	colors: {
		oil: '#000000',   // Black stripes for oil
		gold: '#FFD700',  // Gold stripes for gold
		iron: '#8B4513',  // Brown stripes for iron
		coal: '#2F2F2F',  // Dark gray stripes for coal
		copper: '#B87333', // Copper color stripes
		silver: '#C0C0C0', // Silver stripes
		uranium: '#00FF00' // Green stripes for uranium
	}
};

// Convert Cartesian coordinates to spherical coordinates
function cartesianToSpherical(position) {
	var r = position.length();

	// CORRECTED: Return proper geographic coordinates
	// From our testing: front-facing was phi=0, north pole was theta=π/2,phi=π/2
	// This suggests Y-axis points to north pole, Z-axis points to front-facing
	// For standard coordinates: Z should point to north pole, X to prime meridian

	// Corrected axis rotation: adjust longitude offset by π/2
	// From testing: front-facing should be prime meridian, Y-axis points to north pole
	var geo_x = position.z;  // Front-facing (Z) becomes prime meridian (X-axis)
	var geo_y = position.x;  // Original X becomes 90°E direction (Y-axis)
	var geo_z = position.y;  // North pole (Y) becomes Z-axis

	// Calculate standard spherical coordinates
	var phi = Math.asin(Math.max(-1, Math.min(1, geo_z / r))); // latitude (-π/2 to π/2)
	var theta = Math.atan2(geo_y, geo_x); // longitude (-π to π)

	return { r: r, theta: theta, phi: phi };
}

// Calculate if a position is within a stripe based on global coordinates
function isPositionInStripe(position, stripeConfig) {
	var spherical = cartesianToSpherical(position);

	// Use latitude (phi) for horizontal stripes around the planet
	// phi ranges from 0 (north pole) to π (south pole)
	var normalizedLatitude = spherical.phi / Math.PI; // 0 to 1 from north to south

	// Calculate stripe boundaries
	// Each stripe covers (coverage / stripeCount) of the total latitude range
	var stripeWidth = stripeConfig.coverage / stripeConfig.stripeCount;
	var totalStripedArea = stripeConfig.coverage;
	var nonStripedArea = 1.0 - totalStripedArea;
	var stripeStart = nonStripedArea / 2.0; // Center the striped area

	// Check if we're within the overall striped region
	if (normalizedLatitude < stripeStart || normalizedLatitude > (stripeStart + totalStripedArea)) {
		return false;
	}

	// Calculate position within the striped area
	var positionInStripedArea = (normalizedLatitude - stripeStart) / totalStripedArea;

	// Determine which stripe band we're in
	var scaledPosition = positionInStripedArea * stripeConfig.stripeCount;
	var stripeIndex = Math.floor(scaledPosition);

	// Alternate between stripe and non-stripe bands
	return (stripeIndex % 2) === 0;
}

// Generic resource solid color calculation function
function calculateResourceStripesColor(tile, resourceType) {
	var resourceValue = tile[resourceType] || 0;

	// Only show resource color if the resource is present
	if (resourceValue <= 0) {
		return calculateTerrainColor(tile);
	}

	// Return solid color for this resource type
	var resourceColor = stripeConfig.colors[resourceType] || '#FF00FF'; // Fallback to magenta
	return new THREE.Color(resourceColor);
}

// Specific resource stripe functions
function calculateOilStripesColor(tile) {
	return calculateResourceStripesColor(tile, 'oil');
}

function calculateGoldStripesColor(tile) {
	return calculateResourceStripesColor(tile, 'gold');
}

function calculateIronStripesColor(tile) {
	return calculateResourceStripesColor(tile, 'iron');
}

function calculateCoalStripesColor(tile) {
	return calculateResourceStripesColor(tile, 'coal');
}

function calculateCopperStripesColor(tile) {
	return calculateResourceStripesColor(tile, 'copper');
}

function calculateSilverStripesColor(tile) {
	return calculateResourceStripesColor(tile, 'silver');
}

function calculateUraniumStripesColor(tile) {
	return calculateResourceStripesColor(tile, 'uranium');
}

// Function to update stripe configuration at runtime
function updateStripeConfig(newConfig) {
	if (newConfig.coverage !== undefined) stripeConfig.coverage = Math.max(0.0, Math.min(1.0, newConfig.coverage));
	if (newConfig.stripeCount !== undefined) stripeConfig.stripeCount = Math.max(1, Math.floor(newConfig.stripeCount));
	if (newConfig.colors !== undefined) {
		for (var resource in newConfig.colors) {
			stripeConfig.colors[resource] = newConfig.colors[resource];
		}
	}

	// If planet is loaded, trigger a re-render to show changes
	if (planet && planet.renderData && planet.renderData.surface) {
		// The active overlay will automatically pick up the new config on next render
		console.log("Stripe configuration updated:", stripeConfig);
	}
}

// Register resource overlays in the color system
registerColorOverlay("oilStripes", "Oil Resources", "Shows oil resources with solid black coloring", calculateOilStripesColor, "lambert");
registerColorOverlay("goldStripes", "Gold Resources", "Shows gold resources with solid gold coloring", calculateGoldStripesColor, "lambert");
registerColorOverlay("ironStripes", "Iron Resources", "Shows iron resources with solid brown coloring", calculateIronStripesColor, "lambert");
registerColorOverlay("coalStripes", "Coal Resources", "Shows coal resources with solid dark gray coloring", calculateCoalStripesColor, "lambert");
registerColorOverlay("copperStripes", "Copper Resources", "Shows copper resources with solid copper coloring", calculateCopperStripesColor, "lambert");
registerColorOverlay("silverStripes", "Silver Resources", "Shows silver resources with solid silver coloring", calculateSilverStripesColor, "lambert");
registerColorOverlay("uraniumStripes", "Uranium Resources", "Shows uranium resources with solid green coloring", calculateUraniumStripesColor, "lambert");