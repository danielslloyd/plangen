// Legacy Three.js r68 compatibility code removed - now using direct BufferGeometry creation
// Note: terrainColors is now defined in planet-generator.js

// Raised Mercator: how much elevation contributes to vertex Z (in scaled-map units).
// Map width is ~25; ~3 units of relief gives noticeable but not overwhelming depth.
var MERCATOR_ELEVATION_Z_SCALE = 0.04;

// Hillshade light direction in 2D mercator XY (light comes from the NW).
var MERCATOR_SHADE_LIGHT_X = -0.7071;
var MERCATOR_SHADE_LIGHT_Y = 0.7071;

// Returns the Z component for a tile/corner in mercator. Raised mode uses
// elevationDisplacement to lift land above sea level.
function mercatorVertexZ(elevationDisplacement, isLand) {
	if (!useElevationDisplacement || projectionMode !== "mercator") {
		return 0.001;
	}
	if (!isLand || !elevationDisplacement || elevationDisplacement <= 0) {
		return 0.001;
	}
	return 0.001 + elevationDisplacement * MERCATOR_ELEVATION_Z_SCALE;
}

// For overlays drawn at a fixed layer above the surface (rivers, air currents),
// lift the layer by the underlying tile's elevation in raised mercator so the
// overlay rides on top of the relief rather than being buried.
function mercatorOverlayLayerZ(baseZ, tileOrCorner) {
	if (!useElevationDisplacement || projectionMode !== "mercator") return baseZ;
	if (!tileOrCorner) return baseZ;
	var disp = tileOrCorner.elevationDisplacement;
	if (disp === undefined && tileOrCorner.elevationMedian !== undefined) {
		// Corner-style input - approximate by elevation directly.
		if (tileOrCorner.elevationMedian > 0) {
			return baseZ + tileOrCorner.elevationMedian * 80 * MERCATOR_ELEVATION_Z_SCALE;
		}
		return baseZ;
	}
	if (!disp || disp <= 0) return baseZ;
	return baseZ + disp * MERCATOR_ELEVATION_Z_SCALE;
}

// Returns a multiplicative shade factor (~[0.6, 1.3]) for a land tile in raised
// mercator. Slopes facing the light (NW) brighten; back-facing slopes darken.
// Returns 1.0 in any other mode or for ocean tiles - cheap no-op then.
function computeMercatorTileShade(tile) {
	if (!useElevationDisplacement || projectionMode !== "mercator") return 1.0;
	if (!tile || !tile.tiles || tile.elevation === undefined || tile.elevation <= 0) return 1.0;

	var tileMerc = cartesianToMercator(tile.averagePosition, mercatorCenterLat, mercatorCenterLon);
	var gx = 0, gy = 0, n = 0;
	for (var k = 0; k < tile.tiles.length; k++) {
		var nb = tile.tiles[k];
		if (!nb || !nb.averagePosition) continue;
		var nbMerc = cartesianToMercator(nb.averagePosition, mercatorCenterLat, mercatorCenterLon);
		var ddx = nbMerc.x - tileMerc.x;
		if (ddx > Math.PI) ddx -= 2 * Math.PI;
		else if (ddx < -Math.PI) ddx += 2 * Math.PI;
		var ddy = nbMerc.y - tileMerc.y;
		var de = (nb.elevation || 0) - tile.elevation;
		gx += de * ddx;
		gy += de * ddy;
		n++;
	}
	if (n === 0) return 1.0;
	gx /= n;
	gy /= n;

	// Slope face direction is -gradient. Brightness = dot(slope_face, light).
	var brightness = -(gx * MERCATOR_SHADE_LIGHT_X + gy * MERCATOR_SHADE_LIGHT_Y);
	var shade = 1.0 + Math.max(-0.35, Math.min(0.3, brightness * 8.0));
	return shade;
}

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
		if (i >= tiles.length) {
			action.provideResult("completed");
			return;
		}

		var tile = tiles[i];

		// Calculate terrain color using extracted function
		var terrainColor = calculateTerrainColor(tile);

		// Raised Mercator: bake hillshade into the vertex color so relief is
		// visible from straight top-down (lambert ambient otherwise clips).
		var shade = computeMercatorTileShade(tile);
		if (shade !== 1.0) {
			terrainColor = {
				r: Math.max(0, Math.min(1, terrainColor.r * shade)),
				g: Math.max(0, Math.min(1, terrainColor.g * shade)),
				b: Math.max(0, Math.min(1, terrainColor.b * shade))
			};
		}

		var tileIsLand = tile.elevation > 0;

		// Calculate tile center position (with elevation and projection)
		var centerPos = tile.averagePosition.clone();
		if (projectionMode === "mercator") {
			// Project to Mercator coordinates
			var mercatorCoords = cartesianToMercator(centerPos, mercatorCenterLat, mercatorCenterLon);
			// Scale coordinates for experimental zoom range (larger world)
			// Raised Mercator lifts land vertices; flat Mercator keeps tiny Z offset.
			var zOffset = mercatorVertexZ(tile.elevationDisplacement, tileIsLand);
			centerPos = new THREE.Vector3(mercatorCoords.x * 2.0, mercatorCoords.y * 2.0, zOffset);
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

				// Raised Mercator: lift corner by its median elevation displacement.
				// Corners adjacent to ocean stay at sea level to avoid wall artifacts.
				var cornerIsLand = corner.elevationMedian > 0;
				if (cornerIsLand) {
					for (var k = 0; k < corner.tiles.length; k++) {
						if (corner.tiles[k].elevation <= 0) { cornerIsLand = false; break; }
					}
				}
				var cornerZ = mercatorVertexZ(corner.elevationDisplacement, cornerIsLand);
				cornerPos = new THREE.Vector3(mercatorCoords.x * 2.0, mercatorCoords.y * 2.0, cornerZ);
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

				// Create two versions: left side (subtract 2π from positive coords) and right side (add 2π to negative coords)
				// Preserve per-corner Z from the already-built cornerPositions so wraparound triangles raise correctly.
				var leftCorners = [];
				var rightCorners = [];

				for (var k = 0; k < cornerMercatorCoords.length; k++) {
					var coord = cornerMercatorCoords[k];
					var cornerZForWrap = cornerPositions[k] ? cornerPositions[k].z : 0.001;

					// Left side: shift positive longitudes left by 2π
					var leftX = coord.x > 0 ? coord.x - 2 * Math.PI : coord.x;
					leftCorners.push(new THREE.Vector3(leftX * 2.0, coord.y * 2.0, cornerZForWrap));

					// Right side: shift negative longitudes right by 2π
					var rightX = coord.x < 0 ? coord.x + 2 * Math.PI : coord.x;
					rightCorners.push(new THREE.Vector3(rightX * 2.0, coord.y * 2.0, cornerZForWrap));
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
						// Fix coordinates in-place by moving outlying vertices to the correct side
						var mapWidth = Math.PI * 4.0; // Full map width in scaled coordinates
						var avgX = (vertex1.x + vertex2.x + vertex3.x) / 3;

						// Correct each vertex that is far from the average
						if (Math.abs(vertex1.x - avgX) > Math.PI * 2.0) {
							vertex1.x += vertex1.x > avgX ? -mapWidth : mapWidth;
						}
						if (Math.abs(vertex2.x - avgX) > Math.PI * 2.0) {
							vertex2.x += vertex2.x > avgX ? -mapWidth : mapWidth;
						}
						if (Math.abs(vertex3.x - avgX) > Math.PI * 2.0) {
							vertex3.x += vertex3.x > avgX ? -mapWidth : mapWidth;
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
		
		var planetRenderObject;

		if (projectionMode === "mercator") {
			// For Mercator mode, create a Group with 2 copies for seamless wrapping
			planetRenderObject = new THREE.Group();

			// One world width in scaled coordinates = longitude 2π * 2.0 scale = 4π ≈ 12.57
			var mapWidth = Math.PI * 4.0; // one world = longitude 2pi * 2.0 scale = 4pi

			// Create 3 copies: left (-1), center (0), right (+1) for seamless wrapping in both directions
			for (var offset = -1; offset <= 1; offset++) {
				var meshCopy = new THREE.Mesh(planetGeometry, planetMaterial);
				meshCopy.position.x = offset * mapWidth;
				planetRenderObject.add(meshCopy);
			}
		} else {
			// For Globe mode, use single mesh as before
			planetRenderObject = new THREE.Mesh(planetGeometry, planetMaterial);
		}

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

	var renderObject;

	if (projectionMode === "mercator") {
		// For Mercator mode, create a Group with 2 copies for seamless wrapping
		renderObject = new THREE.Group();

		// One world width in scaled coordinates = longitude 2π * 2.0 scale = 4π ≈ 12.57
		var mapWidth = Math.PI * 4.0; // one world = longitude 2pi * 2.0 scale = 4pi

		// Create 3 copies: left (-1), center (0), right (+1) for seamless wrapping in both directions
		for (var offset = -1; offset <= 1; offset++) {
			var meshCopy = new THREE.Mesh(geometry, material);
			meshCopy.position.x = offset * mapWidth;
			renderObject.add(meshCopy);
		}
	} else {
		// For Globe mode, use single mesh as before
		renderObject = new THREE.Mesh(geometry, material);
	}

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

	var renderObject;

	if (projectionMode === "mercator") {
		// For Mercator mode, create a Group with 2 copies for seamless wrapping
		renderObject = new THREE.Group();

		// One world width in scaled coordinates = longitude 2π * 2.0 scale = 4π ≈ 12.57
		var mapWidth = Math.PI * 4.0; // one world = longitude 2pi * 2.0 scale = 4pi

		// Create 3 copies: left (-1), center (0), right (+1) for seamless wrapping in both directions
		for (var offset = -1; offset <= 1; offset++) {
			var meshCopy = new THREE.Mesh(geometry, material);
			meshCopy.position.x = offset * mapWidth;
			renderObject.add(meshCopy);
		}
	} else {
		// For Globe mode, use single mesh as before
		renderObject = new THREE.Mesh(geometry, material);
	}

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
	
	// Process all corners with air currents
	for (var i = 0; i < corners.length; i++) {
		var corner = corners[i];

		if (corner.airCurrent) cornersWithAirCurrent++;
		if (corner.airCurrent && corner.airCurrent.length() >= 0.05) cornersAboveThreshold++;

		// Skip corners without significant air current
		if (!corner.airCurrent || corner.airCurrent.length() < 0.05) {
			continue;
		}
		
		// Position air currents based on projection mode
		var basePosition = corner.position.clone();
		if (projectionMode === "mercator") {
			// In Mercator mode, project to 2D coordinates with air current layer Z
			var mercatorCoords = cartesianToMercator(basePosition, mercatorCenterLat, mercatorCenterLon);
			basePosition = new THREE.Vector3(
				mercatorCoords.x * 2.0,
				mercatorCoords.y * 2.0,
				mercatorOverlayLayerZ(0.2, corner) // Air currents ride on top of raised terrain
			);
		} else {
			// 3D globe mode - position at atmospheric level
			var airCurrentAltitude = 1050; // Just above terrain
			basePosition.normalize().multiplyScalar(airCurrentAltitude);
		}
		
		// Calculate arrow properties based on SBL and projection mode
		var airDirection = corner.airCurrent.clone().normalize();
		var airCurrentStrength = corner.airCurrent.length();

		// Normalize wind strength (0 to 1) and calculate triangle length
		var normalizedWindStrength = maxWindStrength > 0 ? airCurrentStrength / maxWindStrength : 0;
		var triangleLength;
		if (projectionMode === "mercator") {
			// In Mercator mode, scale ABL to match equatorial projection scale (increased by 50%)
			triangleLength = normalizedWindStrength * ABL * (2.0 / 1000) * 1.5;
		} else {
			// 3D globe mode - use original calculation (increased by 50%)
			triangleLength = normalizedWindStrength * ABL * 1.5;
		}

		// Base width calculation based on projection mode
		var triangleWidth;
		if (projectionMode === "mercator") {
			// In Mercator mode, scale ABL to match equatorial projection scale
			// Air currents use 1/8 ABL vs rivers' 1/4 ABL
			triangleWidth = (ABL / 8) * (2.0 / 1000);
		} else {
			// 3D globe mode - use original calculation
			triangleWidth = ABL / 8; // Base width = 1/8 ABL
		}

		// Create single triangle pointing in flow direction
		var tipPosition = basePosition.clone().add(airDirection.clone().multiplyScalar(triangleLength));
		
		// Create perpendicular vectors for triangle base
		var upVector;
		if (projectionMode === "mercator") {
			// In Mercator mode, use Z-axis up for 2D plane
			upVector = new THREE.Vector3(0, 0, 1);
		} else {
			// 3D globe mode - use surface normal
			upVector = corner.position.clone().normalize();
		}
		var perpendicular = new THREE.Vector3();
		perpendicular.crossVectors(airDirection, upVector).normalize();
		
		// DEBUG: Use bright blue color for high visibility during debugging
		var triangleColor = {
			r: 0.0, // Bright blue for debugging
			g: 0.5,
			b: 1.0
		};
		
		// Create single triangle: tip at flow direction, base perpendicular
		var baseLeft = basePosition.clone().add(perpendicular.clone().multiplyScalar(-triangleWidth));
		var baseRight = basePosition.clone().add(perpendicular.clone().multiplyScalar(triangleWidth));

		// Fix antimeridian wrapping for air current triangles in Mercator mode
		if (projectionMode === "mercator") {
			var triangleVertices = [tipPosition, baseLeft, baseRight];
			var xCoords = triangleVertices.map(v => v.x);
			var minX = Math.min.apply(Math, xCoords);
			var maxX = Math.max.apply(Math, xCoords);

			// If triangle spans more than half the map width, it's wrapping
			if (maxX - minX > Math.PI * 2.0) { // 2π * 2.0 scaling = map width
				// Fix coordinates in-place by moving outlying vertices to the correct side
				var mapWidth = Math.PI * 4.0; // Full map width in scaled coordinates
				var avgX = (tipPosition.x + baseLeft.x + baseRight.x) / 3;

				// Correct each vertex that is far from the average
				if (Math.abs(tipPosition.x - avgX) > Math.PI * 2.0) {
					tipPosition.x += tipPosition.x > avgX ? -mapWidth : mapWidth;
				}
				if (Math.abs(baseLeft.x - avgX) > Math.PI * 2.0) {
					baseLeft.x += baseLeft.x > avgX ? -mapWidth : mapWidth;
				}
				if (Math.abs(baseRight.x - avgX) > Math.PI * 2.0) {
					baseRight.x += baseRight.x > avgX ? -mapWidth : mapWidth;
				}
			}
		}

		// Add triangle vertices
		var tipIndex = airCurrentVertexIndex;
		airCurrentPositions.push(tipPosition.x, tipPosition.y, tipPosition.z);
		airCurrentColors.push(0.9, 0.9, 0.9); // Light gray for air currents
		airCurrentVertexIndex++;

		var baseLeftIndex = airCurrentVertexIndex;
		airCurrentPositions.push(baseLeft.x, baseLeft.y, baseLeft.z);
		airCurrentColors.push(0.9, 0.9, 0.9); // Light gray for air currents
		airCurrentVertexIndex++;

		var baseRightIndex = airCurrentVertexIndex;
		airCurrentPositions.push(baseRight.x, baseRight.y, baseRight.z);
		airCurrentColors.push(0.9, 0.9, 0.9); // Light gray for air currents
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
		opacity: 0.4
	});

	var renderObject;

	if (projectionMode === "mercator") {
		// For Mercator mode, create a Group with 2 copies for seamless wrapping
		renderObject = new THREE.Group();

		// One world width in scaled coordinates = longitude 2π * 2.0 scale = 4π ≈ 12.57
		var mapWidth = Math.PI * 4.0; // one world = longitude 2pi * 2.0 scale = 4pi

		// Create 3 copies: left (-1), center (0), right (+1) for seamless wrapping in both directions
		for (var offset = -1; offset <= 1; offset++) {
			var meshCopy = new THREE.Mesh(geometry, material);
			meshCopy.position.x = offset * mapWidth;
			renderObject.add(meshCopy);
		}
	} else {
		// For Globe mode, use single mesh as before
		renderObject = new THREE.Mesh(geometry, material);
	}

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
	
	// Process all river tiles
	for (var i = 0; i < tiles.length; i++) {
		var tile = tiles[i];
		if (tile.river) totalRiverTiles++;

		if (tile.river && tile.riverSources && tile.drain) {
			// Calculate tile center position based on projection mode
			var tileCenterPos = tile.averagePosition.clone();
			if (projectionMode === "mercator") {
				// In Mercator mode, project to 2D coordinates with river layer Z
				var mercatorCoords = cartesianToMercator(tileCenterPos, mercatorCenterLat, mercatorCenterLon);
				tileCenterPos = new THREE.Vector3(
					mercatorCoords.x * 2.0,
					mercatorCoords.y * 2.0,
					mercatorOverlayLayerZ(0.1, tile) // Rivers ride on top of raised terrain
				);
			} else {
				// 3D globe mode - use elevation
				if (tile.elevation > 0) {
					var tileDistance = tileCenterPos.length();
					tileCenterPos.normalize().multiplyScalar(tileDistance + (useElevationDisplacement ? tile.elevationDisplacement : 0) + 3);
				} else {
					tileCenterPos.multiplyScalar(1.003);
				}
			}
			
			// River triangle dimensions (same for both inflow and outflow)
			var triangleWidth;
			if (projectionMode === "mercator") {
				// In Mercator mode, scale ABL to match equatorial projection scale
				// Sphere radius ~1000, equatorial scale factor 2.0, so ABL/4 * 2.0/1000
				triangleWidth = (ABL / 4) * (2.0 / 1000);
			} else {
				// 3D globe mode - use original calculation
				triangleWidth = ABL / 4; // River base width = 1/4 ABL
			}
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
				
				// Position drain border based on projection mode
				if (projectionMode === "mercator") {
					// In Mercator mode, project to 2D coordinates with river layer Z
					var mercatorCoords = cartesianToMercator(drainBorderPos, mercatorCenterLat, mercatorCenterLon);
					// Lift to the higher of the two adjacent tiles in raised mercator.
					var drainBorderTile = (tile.drain && (tile.drain.elevationDisplacement || 0) > (tile.elevationDisplacement || 0)) ? tile.drain : tile;
					drainBorderPos = new THREE.Vector3(
						mercatorCoords.x * 2.0,
						mercatorCoords.y * 2.0,
						mercatorOverlayLayerZ(0.1, drainBorderTile)
					);
				} else {
					// 3D globe mode - apply elevation
					var drainBorderElevation = calculateBorderElevation(tile, tile.drain);
					if (drainBorderElevation > 0) {
						var drainBorderDistance = drainBorderPos.length();
						var drainBorderDisplacement = drainBorder ? drainBorder.elevationDisplacement : drainBorderElevation * elevationMultiplier;
						drainBorderPos.normalize().multiplyScalar(drainBorderDistance + (useElevationDisplacement ? drainBorderDisplacement : 0) + 3);
					} else {
						drainBorderPos.multiplyScalar(1.003);
					}
				}
				
				// Calculate outflow triangle color (waterfall detection)
				var outflowDrop = (tile.elevation || 0) - (Math.max(0,tile.drain.elevation || 0));
				var outflowColor = outflowDrop >= waterfallThreshold ? 
					{ r: 1, g: 1, b: 1 } : { r: 0.2, g: 0.6, b: 1 };
				
				// Create outflow triangle: tip at drain border, base perpendicular at tile center
				var outflowDirection = drainBorderPos.clone().sub(tileCenterPos).normalize();
				var upVector;
				if (projectionMode === "mercator") {
					// In Mercator mode, use Z-axis up for 2D plane
					upVector = new THREE.Vector3(0, 0, 1);
				} else {
					// 3D globe mode - use surface normal
					upVector = tile.averagePosition.clone().normalize();
				}
				var perpendicular = new THREE.Vector3();
				perpendicular.crossVectors(outflowDirection, upVector).normalize();
				
				var baseLeft = tileCenterPos.clone().add(perpendicular.clone().multiplyScalar(-triangleWidth));
				var baseRight = tileCenterPos.clone().add(perpendicular.clone().multiplyScalar(triangleWidth));

				// Fix antimeridian wrapping for river triangles in Mercator mode
				if (projectionMode === "mercator") {
					var triangleVertices = [drainBorderPos, baseLeft, baseRight];
					var xCoords = triangleVertices.map(v => v.x);
					var minX = Math.min.apply(Math, xCoords);
					var maxX = Math.max.apply(Math, xCoords);

					// If triangle spans more than half the map width, it's wrapping
					if (maxX - minX > Math.PI * 2.0) { // 2π * 2.0 scaling = map width
						// Fix coordinates in-place by moving outlying vertices to the correct side
						var mapWidth = Math.PI * 4.0; // Full map width in scaled coordinates
						var avgX = (drainBorderPos.x + baseLeft.x + baseRight.x) / 3;

						// Correct each vertex that is far from the average
						if (Math.abs(drainBorderPos.x - avgX) > Math.PI * 2.0) {
							drainBorderPos.x += drainBorderPos.x > avgX ? -mapWidth : mapWidth;
						}
						if (Math.abs(baseLeft.x - avgX) > Math.PI * 2.0) {
							baseLeft.x += baseLeft.x > avgX ? -mapWidth : mapWidth;
						}
						if (Math.abs(baseRight.x - avgX) > Math.PI * 2.0) {
							baseRight.x += baseRight.x > avgX ? -mapWidth : mapWidth;
						}
					}
				}

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
				
				// Position source border based on projection mode
				if (projectionMode === "mercator") {
					// In Mercator mode, project to 2D coordinates with river layer Z
					var mercatorCoords = cartesianToMercator(sourceBorderPos, mercatorCenterLat, mercatorCenterLon);
					// Lift to the higher of the two adjacent tiles in raised mercator.
					var sourceBorderTile = ((source && (source.elevationDisplacement || 0) > (tile.elevationDisplacement || 0))) ? source : tile;
					sourceBorderPos = new THREE.Vector3(
						mercatorCoords.x * 2.0,
						mercatorCoords.y * 2.0,
						mercatorOverlayLayerZ(0.1, sourceBorderTile)
					);
				} else {
					// 3D globe mode - apply elevation
					var sourceBorderElevation = calculateBorderElevation(source, tile);
					if (sourceBorderElevation > 0) {
						var sourceBorderDistance = sourceBorderPos.length();
						var sourceBorderDisplacement = sourceBorder ? sourceBorder.elevationDisplacement : sourceBorderElevation * elevationMultiplier;
						sourceBorderPos.normalize().multiplyScalar(sourceBorderDistance + (useElevationDisplacement ? sourceBorderDisplacement : 0) + 3);
					} else {
						sourceBorderPos.multiplyScalar(1.003);
					}
				}
				
				// Calculate inflow triangle color (waterfall detection)
				var inflowDrop = (source.elevation || 0) - (tile.elevation || 0);
				var inflowColor = inflowDrop >= waterfallThreshold ? 
					{ r: 1, g: 1, b: 1 } : { r: 0.2, g: 0.6, b: 1 };
				
				// Create inflow triangle: tip at tile center, base perpendicular at source border
				var inflowDirection = tileCenterPos.clone().sub(sourceBorderPos).normalize();
				var upVector2;
				if (projectionMode === "mercator") {
					// In Mercator mode, use Z-axis up for 2D plane
					upVector2 = new THREE.Vector3(0, 0, 1);
				} else {
					// 3D globe mode - use surface normal from original 3D position
					upVector2 = source.averagePosition.clone().normalize();
				}
				var perpendicular2 = new THREE.Vector3();
				perpendicular2.crossVectors(inflowDirection, upVector2).normalize();
				
				var baseLeft2 = sourceBorderPos.clone().add(perpendicular2.clone().multiplyScalar(-triangleWidth));
				var baseRight2 = sourceBorderPos.clone().add(perpendicular2.clone().multiplyScalar(triangleWidth));

				// Fix antimeridian wrapping for inflow triangles in Mercator mode
				if (projectionMode === "mercator") {
					var triangleVertices2 = [tileCenterPos, baseLeft2, baseRight2];
					var xCoords2 = triangleVertices2.map(v => v.x);
					var minX2 = Math.min.apply(Math, xCoords2);
					var maxX2 = Math.max.apply(Math, xCoords2);

					// If triangle spans more than half the map width, it's wrapping
					if (maxX2 - minX2 > Math.PI * 2.0) { // 2π * 2.0 scaling = map width
						// Fix coordinates in-place by moving outlying vertices to the correct side
						var mapWidth = Math.PI * 4.0; // Full map width in scaled coordinates
						var avgX2 = (tileCenterPos.x + baseLeft2.x + baseRight2.x) / 3;

						// Correct each vertex that is far from the average
						if (Math.abs(tileCenterPos.x - avgX2) > Math.PI * 2.0) {
							tileCenterPos.x += tileCenterPos.x > avgX2 ? -mapWidth : mapWidth;
						}
						if (Math.abs(baseLeft2.x - avgX2) > Math.PI * 2.0) {
							baseLeft2.x += baseLeft2.x > avgX2 ? -mapWidth : mapWidth;
						}
						if (Math.abs(baseRight2.x - avgX2) > Math.PI * 2.0) {
							baseRight2.x += baseRight2.x > avgX2 ? -mapWidth : mapWidth;
						}
					}
				}

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

	var renderObject;

	if (projectionMode === "mercator") {
		// For Mercator mode, create a Group with 2 copies for seamless wrapping
		renderObject = new THREE.Group();

		// One world width in scaled coordinates = longitude 2π * 2.0 scale = 4π ≈ 12.57
		var mapWidth = Math.PI * 4.0; // one world = longitude 2pi * 2.0 scale = 4pi

		// Create 3 copies: left (-1), center (0), right (+1) for seamless wrapping in both directions
		for (var offset = -1; offset <= 1; offset++) {
			var meshCopy = new THREE.Mesh(geometry, material);
			meshCopy.position.x = offset * mapWidth;
			renderObject.add(meshCopy);
		}
	} else {
		// For Globe mode, use single mesh as before
		renderObject = new THREE.Mesh(geometry, material);
	}

	action.provideResult({
		geometry: geometry,
		material: material,
		renderObject: renderObject,
	});
}

/**
 * Alternate river visualization: curvy ribbon "lines" that follow the same
 * source -> tile center -> drain path as buildRiversRenderObject, but rendered
 * as smooth Catmull-Rom ribbons whose width is proportional to flow.
 * Stored as planet.renderData.RiverLines.
 */
function buildRiverLinesRenderObject(tiles, action) {
	var ABL = averageBorderLength;
	var isMercator = (projectionMode === "mercator");

	// Width scaling: base half-width and flow normalization.
	var maxOutflow = 0;
	for (var i = 0; i < tiles.length; i++) {
		if (tiles[i].river && tiles[i].outflow > maxOutflow) maxOutflow = tiles[i].outflow;
	}
	if (maxOutflow <= 0) maxOutflow = 1;

	var baseHalfWidth = isMercator ? (ABL / 3) * (2.0 / 1000) : (ABL / 3);
	var minHalfWidth = baseHalfWidth * 0.25;

	var waterfallThreshold = riverElevationDeltaThreshold || 0.1;
	var mapWidth = Math.PI * 4.0; // mercator world width in scaled coords

	// Project a cartesian border/center point into the current projection,
	// applying elevation like the triangle rivers do. tileForZ picks the tile
	// used for the raised-mercator Z layer.
	function projectRiverPoint(cartPos, tileForZ, borderTilePair) {
		var p = cartPos.clone();
		if (isMercator) {
			var mc = cartesianToMercator(p, mercatorCenterLat, mercatorCenterLon);
			return new THREE.Vector3(mc.x * 2.0, mc.y * 2.0, mercatorOverlayLayerZ(0.1, tileForZ));
		}
		if (borderTilePair) {
			// Border point: elevate using border elevation between the two tiles.
			var be = calculateBorderElevation(borderTilePair[0], borderTilePair[1]);
			if (be > 0) {
				var border = findBorderBetweenTiles(borderTilePair[0], borderTilePair[1]);
				var disp = border ? border.elevationDisplacement : be * elevationMultiplier;
				var d = p.length();
				p.normalize().multiplyScalar(d + (useElevationDisplacement ? disp : 0) + 3);
			} else {
				p.multiplyScalar(1.003);
			}
		} else {
			// Tile-center point.
			if (tileForZ.elevation > 0) {
				var d2 = p.length();
				p.normalize().multiplyScalar(d2 + (useElevationDisplacement ? tileForZ.elevationDisplacement : 0) + 3);
			} else {
				p.multiplyScalar(1.003);
			}
		}
		return p;
	}

	function borderMidpoint(a, b) {
		var border = findBorderBetweenTiles(a, b);
		if (border && border.midpoint) return border.midpoint.clone();
		return a.averagePosition.clone().add(b.averagePosition).multiplyScalar(0.5);
	}

	// Fix antimeridian wrapping by pulling each projected point near a reference x.
	function unwrapX(pts, refX) {
		for (var k = 0; k < pts.length; k++) {
			while (pts[k].x - refX > mapWidth / 2) pts[k].x -= mapWidth;
			while (pts[k].x - refX < -mapWidth / 2) pts[k].x += mapWidth;
		}
	}

	var positions = [];
	var colors = [];
	var indices = [];
	var vIndex = 0;

	for (var t = 0; t < tiles.length; t++) {
		var tile = tiles[t];
		if (!(tile.river && tile.riverSources && tile.drain)) continue;

		var halfWidth = minHalfWidth + (baseHalfWidth - minHalfWidth) * Math.sqrt(tile.outflow / maxOutflow);

		var centerProj = projectRiverPoint(tile.averagePosition, tile, null);
		var drainMid = borderMidpoint(tile, tile.drain);
		var drainBorderTile = (isMercator && (tile.drain.elevationDisplacement || 0) > (tile.elevationDisplacement || 0)) ? tile.drain : tile;
		var drainProj = projectRiverPoint(drainMid, drainBorderTile, isMercator ? null : [tile, tile.drain]);

		// One ribbon per source: sourceBorder -> tileCenter -> drainBorder (curvy).
		for (var s = 0; s < tile.riverSources.length; s++) {
			var source = tile.riverSources[s];
			var srcMid = borderMidpoint(source, tile);
			var srcBorderTile = (isMercator && (source.elevationDisplacement || 0) > (tile.elevationDisplacement || 0)) ? source : tile;
			var srcProj = projectRiverPoint(srcMid, srcBorderTile, isMercator ? null : [source, tile]);

			var ctrl = [srcProj.clone(), centerProj.clone(), drainProj.clone()];
			if (isMercator) unwrapX(ctrl, centerProj.x);

			var curve = new THREE.CatmullRomCurve3(ctrl, false, "catmullrom", 0.5);
			var samples = curve.getPoints(10); // 11 points

			// Waterfall coloring: whiten if there's a significant drop into this tile.
			var drop = (source.elevation || 0) - (tile.elevation || 0);
			var col = drop >= waterfallThreshold ? { r: 1, g: 1, b: 1 } : { r: 0.2, g: 0.6, b: 1 };

			// Up vector for ribbon offset.
			var firstStripIndex = vIndex;
			for (var i2 = 0; i2 < samples.length; i2++) {
				var pt = samples[i2];
				// Tangent from neighbours.
				var prev = samples[Math.max(0, i2 - 1)];
				var next = samples[Math.min(samples.length - 1, i2 + 1)];
				var tangent = next.clone().sub(prev);
				if (tangent.lengthSq() < 1e-9) tangent.set(1, 0, 0);
				tangent.normalize();

				var up = isMercator ? new THREE.Vector3(0, 0, 1) : pt.clone().normalize();
				var perp = new THREE.Vector3().crossVectors(tangent, up);
				if (perp.lengthSq() < 1e-9) perp.set(0, 1, 0); else perp.normalize();
				perp.multiplyScalar(halfWidth);

				var left = pt.clone().add(perp);
				var right = pt.clone().sub(perp);

				positions.push(left.x, left.y, left.z);
				colors.push(col.r, col.g, col.b);
				positions.push(right.x, right.y, right.z);
				colors.push(col.r, col.g, col.b);
				vIndex += 2;

				if (i2 > 0) {
					var a0 = firstStripIndex + (i2 - 1) * 2;
					var b0 = a0 + 1;
					var c0 = firstStripIndex + i2 * 2;
					var d0 = c0 + 1;
					indices.push(a0, b0, c0);
					indices.push(b0, d0, c0);
				}
			}
		}
	}

	var geometry = new THREE.BufferGeometry();
	if (positions.length > 0) {
		geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
		geometry.setIndex(indices);
		geometry.computeVertexNormals();
		geometry.computeBoundingSphere();
	}

	var material = new THREE.MeshBasicMaterial({
		vertexColors: true,
		side: THREE.DoubleSide,
		transparent: true,
		opacity: 0.9
	});

	var renderObject;
	if (isMercator) {
		renderObject = new THREE.Group();
		for (var offset = -1; offset <= 1; offset++) {
			var meshCopy = new THREE.Mesh(geometry, material);
			meshCopy.position.x = offset * mapWidth;
			renderObject.add(meshCopy);
		}
	} else {
		renderObject = new THREE.Mesh(geometry, material);
	}

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

	// Determine proper normal vector based on projection mode
	var normalVector;
	if (projectionMode === "mercator") {
		// In Mercator mode, use Z-axis up for 2D plane
		normalVector = new THREE.Vector3(0, 0, 1);
	} else {
		// 3D globe mode - use surface normal
		normalVector = fromTile.averagePosition.clone().normalize();
	}

	// Always create first segment (from source to border)
	buildArrow(geometry, fromPos, firstSegment, normalVector, baseWidth, color);

	// Only create second segment if downstream tile is not ocean
	if (toTile.elevation > 0) {
		var secondSegment = toPos.clone().sub(midPos);
		// Use same normal vector for consistency
		buildArrow(geometry, midPos, secondSegment, normalVector, baseWidth, color);
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

	// Determine proper normal vector based on projection mode
	var normalVector;
	if (projectionMode === "mercator") {
		// In Mercator mode, use Z-axis up for 2D plane
		normalVector = new THREE.Vector3(0, 0, 1);
	} else {
		// 3D globe mode - use surface normal
		normalVector = fromTile.averagePosition.clone().normalize();
	}

	// Always create first segment (from source to border)
	buildArrow(geometry, fromPos, firstSegment, normalVector, baseWidth, firstSegmentColor);

	// Only create second segment if downstream tile is not ocean
	if (toTile.elevation > 0) {
		var secondSegment = toPos.clone().sub(midPos);
		// Use same normal vector for consistency
		buildArrow(geometry, midPos, secondSegment, normalVector, baseWidth, secondSegmentColor);
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
		return new THREE.Color(getOverlayColor("elevation", "oceanShallow", "#224488"))
			.lerp(new THREE.Color(getOverlayColor("elevation", "oceanDeep", "#000044")), normalizedDepth);
	} else {
		// Land elevation - brown to white gradient
		var normalizedElevation = Math.min(tile.elevation, 1);
		return new THREE.Color(getOverlayColor("elevation", "landLow", "#4b2f20"))
			.lerp(new THREE.Color(getOverlayColor("elevation", "landHigh", "#ffffff")), normalizedElevation);
	}
}

function calculateTemperatureColor(tile) {
	var normalizedTemp = Math.max(-1, Math.min(tile.temperature || 0, 1));
	if (normalizedTemp < 0) {
		// Cold - blue to cyan
		return new THREE.Color(getOverlayColor("temperature", "coldLow", "#0000ff"))
			.lerp(new THREE.Color(getOverlayColor("temperature", "coldHigh", "#00ffff")), Math.abs(normalizedTemp));
	} else {
		// Warm - yellow to red
		return new THREE.Color(getOverlayColor("temperature", "warmLow", "#ffff00"))
			.lerp(new THREE.Color(getOverlayColor("temperature", "warmHigh", "#ff0000")), normalizedTemp);
	}
}

function calculateMoistureColor(tile) {
	var normalizedMoisture = Math.max(0, Math.min(tile.moisture || 0, 1));
	// Dry to wet
	return new THREE.Color(getOverlayColor("moisture", "dry", "#8b4513"))
		.lerp(new THREE.Color(getOverlayColor("moisture", "wet", "#00ff00")), normalizedMoisture);
}

function calculatePlatesColor(tile) {
	// Plates view = plain land/water fill; the plate outlines are drawn on top as
	// thin black boundary lines (auto-enabled when this overlay is selected).
	if (tile.elevation > 0) return new THREE.Color(getOverlayColor("plates", "land", "#74ad5a"));
	return new THREE.Color(getOverlayColor("plates", "water", "#4f86c6"));
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

		// Match buildSurfaceRenderObject: bake hillshade for raised mercator so
		// the relief shading survives overlay changes.
		var shade = computeMercatorTileShade(tile);
		if (shade !== 1.0) {
			tileColor = {
				r: Math.max(0, Math.min(1, tileColor.r * shade)),
				g: Math.max(0, Math.min(1, tileColor.g * shade)),
				b: Math.max(0, Math.min(1, tileColor.b * shade))
			};
		}

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

// Memoize expensive per-overlay aggregates (e.g. min/max over all tiles) so color
// functions stay O(1) per tile and a full recolor is O(N) instead of O(N²). Several
// overlays previously recomputed Math.min/max over every tile FOR every tile, which
// froze the page on large planets when switching to them. Cached on the planet
// object, so it auto-invalidates when a new planet is generated (fresh object).
function getOverlayAggregate(key, compute) {
	if (typeof planet === "undefined" || !planet) return compute();
	if (!planet._overlayAggregates) planet._overlayAggregates = {};
	if (planet._overlayAggregates[key] === undefined) {
		planet._overlayAggregates[key] = compute();
	}
	return planet._overlayAggregates[key];
}

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
function registerColorOverlay(id, name, description, colorFunction, materialType, computationType, category) {
	colorOverlayRegistry[id] = {
		id: id,
		name: name,
		description: description,
		colorFunction: colorFunction,
		materialType: materialType || 'basic', // Default to basic material if not specified
		computationType: computationType || 'lazy', // 'precompute', 'lazy', or 'immediate'
		category: category || 'geography' // 'resources', 'food', or 'geography'
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

	// Build the replacement render object. In Mercator mode the surface is a
	// Group of 3 copies for seamless horizontal wrapping - preserve that so a
	// material/overlay switch does not collapse the map to a single copy.
	var newObject;
	if (projectionMode === "mercator") {
		newObject = new THREE.Group();
		var mapWidth = Math.PI * 4.0; // one world width (see build functions)
		for (var offset = -1; offset <= 1; offset++) {
			var meshCopy = new THREE.Mesh(oldGeometry, newMaterial);
			meshCopy.position.x = offset * mapWidth;
			newObject.add(meshCopy);
		}
	} else {
		newObject = new THREE.Mesh(oldGeometry, newMaterial);
		newObject.position.copy(surfaceRenderObject.position);
		newObject.rotation.copy(surfaceRenderObject.rotation);
		newObject.scale.copy(surfaceRenderObject.scale);
	}

	// Replace in scene
	if (scene) {
		scene.remove(surfaceRenderObject);
		scene.add(newObject);
	}

	// Update planet render data reference
	planet.renderData.surface.renderObject = newObject;
}

// Register the existing color overlays
registerColorOverlay("terrain", "Realistic Terrain", "Realistic biome-based terrain coloring", calculateTerrainColor, "lambert", "lazy", "geography");
registerColorOverlay("elevation", "Elevation Map", "Height-based visualization from brown (low) to white (high)", calculateElevationColor, "lambert", "lazy", "geography");
registerColorOverlay("temperature", "Temperature Map", "Thermal visualization from blue (cold) to red (hot)", calculateTemperatureColor, "lambert", "lazy", "geography");
registerColorOverlay("moisture", "Moisture Map", "Precipitation visualization from brown (dry) to green (wet)", calculateMoistureColor, "lambert", "lazy", "geography");
registerColorOverlay("plates", "Tectonic Plates", "Tectonic plate boundaries and colors", calculatePlatesColor, "basic", "lazy", "geography");

registerColorOverlay("simple", "Simple Land/Water", "Basic land (green) vs water (blue) visualization", function(tile) {
	return tile.elevation <= 0 ? new THREE.Color(0x0066CC) : new THREE.Color(0x00AA44);
}, "basic", "lazy", "geography");

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
}, "basic", "lazy", "geography");

// Shore distance color overlay - shows distance from shoreline
registerColorOverlay("shore", "Shore Distance", "Distance from shore: light blue (ocean edge) to dark blue (deep ocean), bright yellow (land edge) to dark green (inland)", function(tile) {
	if (!tile.hasOwnProperty('shore')) {
		return new THREE.Color(0x888888); // Gray fallback if shore not calculated
	}

	if (tile.shore === 0) {
		return new THREE.Color(0x888888); // Gray for uncategorized tiles
	}

	var shoreExt = getOverlayAggregate("shore", function() {
		var min = Infinity, max = -Infinity, ts = planet.topology.tiles;
		for (var i = 0; i < ts.length; i++) { var s = ts[i].shore || 0; if (s < min) min = s; if (s > max) max = s; }
		return { min: min, max: max };
	});

	if (tile.shore < 0) {
		// Ocean tiles: negative values
		// Light blue (-1) to dark blue (very negative)
		var maxNegative = shoreExt.min;
		var normalizedValue = Math.abs(tile.shore) / Math.abs(maxNegative);

		// Lerp from light blue to dark blue
		var lightBlue = new THREE.Color(0x87CEEB); // Light blue
		var darkBlue = new THREE.Color(0x000080);  // Dark blue
		return lightBlue.clone().lerp(darkBlue, normalizedValue);
	} else {
		// Land tiles: positive values
		// Bright yellow (1) to dark green (very positive)
		var maxPositive = shoreExt.max;
		var normalizedValue = tile.shore / maxPositive;

		// Lerp from bright yellow to dark green
		var brightYellow = new THREE.Color(0xFFFF00); // Bright yellow
		var darkGreen = new THREE.Color(0x006400);    // Dark green
		return brightYellow.clone().lerp(darkGreen, normalizedValue);
	}
}, "basic", "lazy", "geography");

// Reverse shore distance color overlay - shows distance from the extreme inland/deep ocean points
registerColorOverlay("reverseShore", "Reverse Shore Distance", "Distance from extreme inland/deep ocean points: same color scheme as shore distance", function(tile) {
	if (!tile.hasOwnProperty('reverseShore')) {
		return new THREE.Color(0x888888); // Gray fallback if reverse shore not calculated
	}

	if (tile.reverseShore === 0) {
		return new THREE.Color(0x888888); // Gray for uncategorized tiles
	}

	var revExt = getOverlayAggregate("reverseShore", function() {
		var min = Infinity, max = -Infinity, ts = planet.topology.tiles;
		for (var i = 0; i < ts.length; i++) { var s = ts[i].reverseShore || 0; if (s < min) min = s; if (s > max) max = s; }
		return { min: min, max: max };
	});

	if (tile.reverseShore < 0) {
		// Ocean tiles: negative values
		// Light blue (-1) to dark blue (very negative)
		var maxNegative = revExt.min;
		var normalizedValue = Math.abs(tile.reverseShore) / Math.abs(maxNegative);

		// Lerp from light blue to dark blue
		var lightBlue = new THREE.Color(0x87CEEB); // Light blue
		var darkBlue = new THREE.Color(0x000080);  // Dark blue
		return lightBlue.clone().lerp(darkBlue, normalizedValue);
	} else {
		// Land tiles: positive values
		// Bright yellow (1) to dark green (very positive)
		var maxPositive = revExt.max;
		var normalizedValue = tile.reverseShore / maxPositive;

		// Lerp from bright yellow to dark green
		var brightYellow = new THREE.Color(0xFFFF00); // Bright yellow
		var darkGreen = new THREE.Color(0x006400);    // Dark green
		return brightYellow.clone().lerp(darkGreen, normalizedValue);
	}
}, "basic", "lazy", "geography");

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

	// Per-domain net-shore extremes, computed once per planet (was O(N) per tile).
	var netExt = getOverlayAggregate("shoreRatio", function() {
		var lMin = Infinity, lMax = -Infinity, lCount = 0;
		var oMin = Infinity, oMax = -Infinity, oCount = 0;
		var ts = planet.topology.tiles;
		for (var i = 0; i < ts.length; i++) {
			var t = ts[i];
			if (!t.hasOwnProperty('reverseShore')) continue;
			var net = t.reverseShore - t.shore;
			if (t.shore > 0) { if (net < lMin) lMin = net; if (net > lMax) lMax = net; lCount++; }
			else if (t.shore < 0) { if (net < oMin) oMin = net; if (net > oMax) oMax = net; oCount++; }
		}
		return { lMin: lMin, lMax: lMax, lCount: lCount, oMin: oMin, oMax: oMax, oCount: oCount };
	});

	if (tile.shore > 0) {
		// Land tiles: red (negative) -> yellow (0) -> dark green (positive)
		if (netExt.lCount === 0) {
			return new THREE.Color(0x888888);
		}

		var minLandNet = netExt.lMin;
		var maxLandNet = netExt.lMax;

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
		if (netExt.oCount === 0) {
			return new THREE.Color(0x888888);
		}

		var minOceanNet = netExt.oMin;
		var maxOceanNet = netExt.oMax;

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
}, "basic", "lazy", "geography");

// Neighbor Shore Comparison color overlay - shows % of neighbors' neighbors (NN) with higher/lower shore values
registerColorOverlay("neighborShore", "Neighbor Shore Comparison", "For each land/ocean tile, shows % of neighbors' neighbors (NN) with higher/lower shore values using shore distance colors", function(tile) {
	if (!tile.hasOwnProperty('neighborShoreComparison')) {
		return new THREE.Color(0x888888); // Gray fallback if neighbor comparison not calculated
	}

	// Add small offset to shift range so 0% gets a color too
	var adjustedValue = tile.neighborShoreComparison;
	if (tile.elevation > 0) {
		// Land tiles: add 1 so 0% becomes 1%, 1% becomes 2%, etc.
		adjustedValue = tile.neighborShoreComparison + 1;
	} else {
		// Ocean tiles: subtract 1 so 0% becomes -1%, -1% becomes -2%, etc.
		adjustedValue = tile.neighborShoreComparison - 1;
	}

	if (adjustedValue < 0) {
		// Ocean tiles: negative values (percentages)
		// Light blue (low %) to dark blue (high %)
		// Range is roughly -1% to -101% (shifted from 0% to 100%)
		var normalizedValue = Math.abs(adjustedValue) / 101.0; // Normalize to 0-1

		// Lerp from light blue to dark blue (same as shore distance)
		var lightBlue = new THREE.Color(0x87CEEB); // Light blue
		var darkBlue = new THREE.Color(0x000080);  // Dark blue
		return lightBlue.clone().lerp(darkBlue, normalizedValue);
	} else {
		// Land tiles: positive values (percentages)
		// Bright yellow (low %) to dark green (high %)
		// Range is roughly 1% to 101% (shifted from 0% to 100%)
		var normalizedValue = adjustedValue / 101.0; // Normalize to 0-1

		// Lerp from bright yellow to dark green (same as shore distance)
		var brightYellow = new THREE.Color(0xFFFF00); // Bright yellow
		var darkGreen = new THREE.Color(0x006400);    // Dark green
		return brightYellow.clone().lerp(darkGreen, normalizedValue);
	}
}, "basic", "lazy", "geography");

function generateDynamicShoreOverlays(tiles) { // legacy stub kept so existing call sites continue to work
	if (typeof populateColorOverlayDropdown === 'function') populateColorOverlayDropdown();
}


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
}, "basic", "lazy", "geography");

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


// Thickness Field visualization - shows the granulometric thickness used in Feature E detection
registerColorOverlay("thickness", "Granulometric Thickness", "Width-based thickness measure: pale (thin features) to vivid (thick/wide features).", function(tile) {
	if (!tile.hasOwnProperty('_thick')) {
		return new THREE.Color(0x888888); // Gray fallback if thickness not calculated
	}

	// Get the thickness value and normalize it
	var thickness = tile._thick || 0;
	var maxThickness = 8; // matches CONFIG.thicknessMax in feature-detection.js

	// Normalize to 0-1 range
	var normalized = Math.min(thickness / maxThickness, 1.0);

	// Separate color schemes for ocean and land
	if (tile.elevation <= 0) {
		// Ocean: pale cyan (thin) to vivid blue (thick)
		var paleCyan = new THREE.Color(0xB0E0E6);   // Pale cyan
		var vividBlue = new THREE.Color(0x0047AB);  // Vivid blue
		return paleCyan.clone().lerp(vividBlue, normalized);
	} else {
		// Land: pale yellow (thin) to vivid green (thick)
		var paleYellow = new THREE.Color(0xFFFFCC); // Pale yellow
		var vividGreen = new THREE.Color(0x228B22); // Vivid green
		return paleYellow.clone().lerp(vividGreen, normalized);
	}
}, "basic", "lazy", "geography");


// NOTE: Resource & Food overlays (crops, calories, minerals, strategic resources,
// stripeConfig) were extracted to resource-overlays.js (loaded after this file).

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

// (Resource & Food overlay color functions and registrations now live in
// resource-overlays.js, loaded immediately after this file.)