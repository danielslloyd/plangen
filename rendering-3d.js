function render() {
	var currentRenderFrameTime = Date.now();
	var frameDuration = lastRenderFrameTime !== null ? (currentRenderFrameTime - lastRenderFrameTime) * 0.001 : 0;

	var cameraNeedsUpdated = false;
	if (zoomAnimationStartTime !== null) {
		if (zoomAnimationStartTime + zoomAnimationDuration <= currentRenderFrameTime) {
			zoom = zoomAnimationEndValue;
			zoomAnimationStartTime = null;
			zoomAnimationDuration = null;
			zoomAnimationStartValue = null;
			zoomAnimationEndValue = null;
		} else {
			zoomAnimationProgress = (currentRenderFrameTime - zoomAnimationStartTime) / zoomAnimationDuration;
			zoom = (zoomAnimationEndValue - zoomAnimationStartValue) * zoomAnimationProgress + zoomAnimationStartValue;
		}
		cameraNeedsUpdated = true;
	}

	var cameraZoomDelta = getZoomDelta();
	if (frameDuration > 0 && cameraZoomDelta !== 0) {
		zoom = Math.max(-2, Math.min(zoom + frameDuration * cameraZoomDelta * 0.5, 2));
		cameraNeedsUpdated = true;
	}

	var cameraLatitudeDelta = getLatitudeDelta();
	if (frameDuration > 0 && cameraLatitudeDelta !== 0) {
		if (projectionMode === "mercator") {
			// In Mercator mode, move the camera position instead of regenerating geometry
			var panSpeed = 2.0; // Increased speed since we're not regenerating geometry
			mercatorCameraY += frameDuration * -cameraLatitudeDelta * panSpeed;
			// Limit vertical panning to reasonable bounds (about ±80° latitude equivalent)
			mercatorCameraY = Math.max(-2.5, Math.min(mercatorCameraY, 2.5));
		} else {
			// Original 3D globe camera movement
			cameraLatitude += frameDuration * -cameraLatitudeDelta * Math.PI * (zoom * 0.5 + (1 - zoom) * 1 / 20);
			cameraLatitude = Math.max(-Math.PI * 0.49, Math.min(cameraLatitude, Math.PI * 0.49));
		}
		cameraNeedsUpdated = true;
	}

	var cameraLongitudeDelta = getLongitudeDelta();
	if (frameDuration > 0 && cameraLongitudeDelta !== 0) {
		if (projectionMode === "mercator") {
			// In Mercator mode, move the camera position with infinite horizontal wrapping
			var panSpeed = 2.0; // Increased speed since we're not regenerating geometry
			mercatorCameraX += frameDuration * cameraLongitudeDelta * panSpeed;
			// Allow infinite horizontal panning - no bounds needed, wrapping handled in camera update
		} else {
			// Original 3D globe camera movement
			cameraLongitude += frameDuration * cameraLongitudeDelta * Math.PI * (zoom * Math.PI / 8 + (1 - zoom) / (20 * Math.max(Math.cos(cameraLatitude), 0.1)));
			cameraLongitude = cameraLongitude - Math.floor(cameraLongitude / (Math.PI * 2)) * Math.PI * 2;
		}
		cameraNeedsUpdated = true;
	}

	if (cameraNeedsUpdated) updateCamera();

	// Animate orbiting sun light if it exists
	if (window.orbitingSunLight) {
		var sunTime = Math.PI * 2 * currentRenderFrameTime / 60000 + sunTimeOffset;
		var sunDistance = 2000;
		window.orbitingSunLight.position.set(
			Math.cos(sunTime) * sunDistance,
			Math.sin(sunTime * 0.3) * 500,  // Slight vertical oscillation
			Math.sin(sunTime) * sunDistance
		);

		// Update hemisphere sky light to follow the sun orientation
		if (window.orbitingSkyLight) {
			// Orient the hemisphere so the blue "sky" side points toward the sun direction
			var sunDirection = new THREE.Vector3(
				Math.cos(sunTime),
				Math.sin(sunTime * 0.3) * 0.25, // Reduced vertical variation for hemisphere
				Math.sin(sunTime)
			);
			sunDirection.normalize();
			// Position the hemisphere light to orient its "up" direction toward the sun
			window.orbitingSkyLight.position.copy(sunDirection.multiplyScalar(100));
		}
	}

	// Update FPS counter
	updateFPS();

	requestAnimationFrame(render);
	renderer.render(scene, camera);

	lastRenderFrameTime = currentRenderFrameTime;
}

function resizeHandler() {
	updateCamera();
	renderer.setSize(window.innerWidth, window.innerHeight);
}

function resetCamera() {
	zoom = 1.0;
	zoomAnimationStartTime = null;
	zoomAnimationDuration = null;
	zoomAnimationStartValue = null;
	zoomAnimationEndValue = null;
	cameraLatitude = 0;
	cameraLongitude = 0;
}

function updateCamera() {
	if (projectionMode === "mercator") {
		// Mercator 2D mode - use orthographic camera
		if (!(camera instanceof THREE.OrthographicCamera)) {
			// Switch to orthographic camera
			var oldCamera = camera;
			var aspect = window.innerWidth / window.innerHeight;
			var viewSize = 7; // Base view size for Mercator projection
			var zoomFactor = Math.pow(2, zoom); // Exponential zoom mapping that works for negative values
			var actualViewSize = viewSize / zoomFactor;

			camera = new THREE.OrthographicCamera(
				-actualViewSize * aspect, actualViewSize * aspect,
				actualViewSize, -actualViewSize,
				0.1, 2000
			);
		}

		// Position camera based on mercatorCameraX/Y for smooth panning
		camera.position.set(mercatorCameraX, mercatorCameraY, 1000);
		camera.lookAt(mercatorCameraX, mercatorCameraY, 0); // Look at camera position but at z=0
		camera.up.set(0, 1, 0);

		// Update orthographic camera zoom and bounds relative to camera position
		var aspect = window.innerWidth / window.innerHeight;
		var viewSize = 7;
		var zoomFactor = Math.pow(2, zoom); // Exponential zoom mapping that works for negative values
		var actualViewSize = viewSize / zoomFactor;

		// Offset camera bounds by camera position for smooth panning
		camera.left = mercatorCameraX - actualViewSize * aspect;
		camera.right = mercatorCameraX + actualViewSize * aspect;
		camera.top = mercatorCameraY + actualViewSize;
		camera.bottom = mercatorCameraY - actualViewSize;

		// Update wrapped geometry positions for infinite horizontal scrolling
		updateMercatorWrapping();

	} else {
		// Globe 3D mode - use perspective camera
		if (!(camera instanceof THREE.PerspectiveCamera)) {
			// Switch to perspective camera
			camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.2, 2000);
		}

		camera.aspect = window.innerWidth / window.innerHeight;

		var transformation = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(cameraLatitude, cameraLongitude, 0, "YXZ"));
		camera.position.set(0, -50, 1050);
		camera.position.lerp(new THREE.Vector3(0, 0, 2000), Math.pow(zoom, 2.0));
		camera.position.applyMatrix4(transformation);
		camera.up.set(0, 1, 0);
		camera.up.applyMatrix4(transformation);
		camera.lookAt(new THREE.Vector3(0, 0, 1000).applyMatrix4(transformation));
	}

	camera.updateProjectionMatrix();
}

function updateMercatorWrapping() {
	if (!planet || !planet.renderData || projectionMode !== "mercator") {
		return;
	}

	// Map width in scaled coordinates = 4π * 2.0 ≈ 25.13
	var mapWidth = Math.PI * 4.0 * 2.0;

	// Wrap camera position when it goes too far
	while (mercatorCameraX > mapWidth / 2) {
		mercatorCameraX -= mapWidth;
		console.log("Wrapped camera right to left, new cameraX:", mercatorCameraX);
	}
	while (mercatorCameraX < -mapWidth / 2) {
		mercatorCameraX += mapWidth;
		console.log("Wrapped camera left to right, new cameraX:", mercatorCameraX);
	}
}

function buildArrow(positions, colors, indices, vertexIndex, position, direction, normal, baseWidth, color) {
	if (direction.lengthSq() === 0) return vertexIndex;
	
	var sideOffset = direction.clone().cross(normal).setLength(baseWidth / 2);
	
	// Create triangle vertices: base left, tip, base right  
	var baseLeft = position.clone().add(sideOffset);
	var tip = position.clone().add(direction);
	var baseRight = position.clone().sub(sideOffset);
	
	// Add vertices to positions array
	positions.push(baseLeft.x, baseLeft.y, baseLeft.z);
	positions.push(tip.x, tip.y, tip.z); 
	positions.push(baseRight.x, baseRight.y, baseRight.z);
	
	// Add colors (same color for all vertices)
	colors.push(color.r, color.g, color.b);
	colors.push(color.r, color.g, color.b);
	colors.push(color.r, color.g, color.b);
	
	// Add triangle indices (counter-clockwise)
	indices.push(vertexIndex, vertexIndex + 2, vertexIndex + 1);
	
	return vertexIndex + 3;
}

// Legacy buildTileWedge functions removed - unused after r125 migration

function createTileSelectRenderObject(tile, color) {
    var outerColor = {r: 0, g: 0, b: 0};
    var innerColor = color ? {r: color.r, g: color.g, b: color.b} : {r: 1, g: 1, b: 1};

    // Arrays for r125 BufferGeometry triangle rendering
    var positions = [];
    var colors = [];
    var indices = [];
    var vertexIndex = 0;

    // Calculate tile center position based on projection mode
    var centerPos = tile.averagePosition.clone();

    if (projectionMode === "mercator") {
        // For Mercator mode, project to 2D coordinates with selection layer Z
        var mercatorCoords = cartesianToMercator(centerPos, mercatorCenterLat, mercatorCenterLon);
        centerPos = new THREE.Vector3(
            mercatorCoords.x * 2.0,
            mercatorCoords.y * 2.0,
            0.05 // Selection layer: slightly above surface (0) but below rivers (0.1)
        );
    } else {
        // For Globe mode, use 3D positioning with proper elevation handling
        if (tile.elevation > 0) {
            var centerDistance = centerPos.length();
            var displacement = useElevationDisplacement && tile.elevationDisplacement ? tile.elevationDisplacement : 0;
            centerPos.normalize().multiplyScalar(centerDistance + displacement + 5); // +5 for selection highlight offset
        } else {
            centerPos.multiplyScalar(1.0005); // slight offset for water tiles
        }
    }

    // Add center vertex (index 0)
    positions.push(centerPos.x, centerPos.y, centerPos.z);
    colors.push(innerColor.r, innerColor.g, innerColor.b);
    var centerIndex = vertexIndex;
    vertexIndex++;

    // Add corner vertices and build triangles
    for (var i = 0; i < tile.corners.length; ++i) {
        var corner = tile.corners[i];
        var cornerPosition = corner.position.clone();

        if (projectionMode === "mercator") {
            // For Mercator mode, project corner to 2D coordinates
            var cornerMercatorCoords = cartesianToMercator(cornerPosition, mercatorCenterLat, mercatorCenterLon);
            cornerPosition = new THREE.Vector3(
                cornerMercatorCoords.x * 2.0,
                cornerMercatorCoords.y * 2.0,
                0.05 // Same selection layer Z as center
            );
        } else {
            // For Globe mode, apply elevation displacement
            // Check if any adjacent tile is ocean (elevation <= 0)
            var hasOceanTile = false;
            for (var k = 0; k < corner.tiles.length; ++k) {
                if (corner.tiles[k].elevation <= 0) {
                    hasOceanTile = true;
                    break;
                }
            }

            // Apply elevation displacement only if no adjacent tiles are ocean and median elevation is positive
            if (!hasOceanTile && corner.elevationMedian > 0) {
                var cornerDistance = cornerPosition.length();
                var cornerDisplacement = useElevationDisplacement && corner.elevationDisplacement ? corner.elevationDisplacement : 0;
                cornerPosition.normalize().multiplyScalar(cornerDistance + cornerDisplacement + 5); // +5 for selection highlight offset
            } else {
                cornerPosition.multiplyScalar(1.0005); // slight offset for water/coastal corners
            }
        }

        // Add corner vertex
        positions.push(cornerPosition.x, cornerPosition.y, cornerPosition.z);
        colors.push(outerColor.r, outerColor.g, outerColor.b);
        var currentCornerIndex = vertexIndex;
        vertexIndex++;

        // Create triangle: center -> current corner -> next corner
        // We need to defer triangle creation until we have all vertices
    }

    // Now create triangles connecting center to adjacent corners
    for (var i = 0; i < tile.corners.length; ++i) {
        var currentCornerIndex = i + 1; // +1 because center is at index 0
        var nextCornerIndex = ((i + 1) % tile.corners.length) + 1; // +1 because center is at index 0

        indices.push(centerIndex, currentCornerIndex, nextCornerIndex);
    }

    // Create BufferGeometry using r125 pattern
    var geometry = new THREE.BufferGeometry();

    if (positions.length > 0) {
        // Create buffer attributes using Float32BufferAttribute
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setIndex(indices);

        // Compute normals and bounding sphere
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
    }

    // Create material using r125 pattern (similar to rivers)
    var material = new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.8
    });

    // For Mercator mode, ensure visibility over flat surface
    if (projectionMode === "mercator") {
        material.depthTest = false;
        material.renderOrder = 1; // Ensure it renders after the surface
    } else {
        // For Globe mode, use polygon offset to prevent z-fighting
        material.polygonOffset = true;
        material.polygonOffsetFactor = -2;
        material.polygonOffsetUnits = -2;
    }

    return new THREE.Mesh(geometry, material);
}


function selectTile(tile) {
    if (tileSelection !== null) {
        if (tileSelection.tile === tile) return;
        deselectTile();
    }

    // Initialize tileSelection with an empty array for upstream render objects
    tileSelection = { tile: tile, renderObject: createTileSelectRenderObject(tile), xstreamRenderObjects: [] };

    // Highlight the selected tile
    planet.renderData.surface.renderObject.add(tileSelection.renderObject);
    
    // Update tile info overlay
    if (typeof debugOverlay !== 'undefined') {
        debugOverlay.updateSelectedTile(tile);
    }

	//console.log(tile.id,'elevation:',tile.elevation,'neighbors elevation:',tile.tiles.map(n => n.elevation));
    // Highlight all tiles in the upstream array
    if (tile.upstream || tile.downstream) {
		for (t of tile.upstream) {
        	var xstreamRenderObject = createTileSelectRenderObject(t, new THREE.Color(0x00FF00)); // Green color for upstream tiles
			planet.renderData.surface.renderObject.add(xstreamRenderObject);
        	tileSelection.xstreamRenderObjects.push(xstreamRenderObject);
    	};
    	for (t of tile.downstream) {
        var xstreamRenderObject = createTileSelectRenderObject(t, new THREE.Color(0xFF0000)); // Red color for downstream tiles
		planet.renderData.surface.renderObject.add(xstreamRenderObject);
        tileSelection.xstreamRenderObjects.push(xstreamRenderObject);
    	};
	};
}

function deselectTile() {
    if (tileSelection !== null) {
        planet.renderData.surface.renderObject.remove(tileSelection.renderObject);
        if (tileSelection.xstreamRenderObjects) {
            tileSelection.xstreamRenderObjects.forEach(renderObject => {
                planet.renderData.surface.renderObject.remove(renderObject);
            });
        }
        tileSelection = { tile: null, renderObject: null, xstreamRenderObjects: [] };
        
        // Hide tile info overlay
        if (typeof debugOverlay !== 'undefined') {
            debugOverlay.hideTileInfo();
        }
    }
}


function buildEdgeCostsRenderObject(edges) {
    var geometry = new THREE.BufferGeometry();
    geometry.vertices = [];
    geometry.faces = [];
    geometry.colors = [];
    var minCost = 0.2 //Math.min(...edges.map(edge => edge.cost));
    var maxCost = 50 //Math.max(...edges.map(edge => edge.cost));

    for (let edge of edges) {
        var fromVertex = edge.from.position;
        var toVertex = edge.to.position;
        var midpoint = fromVertex.clone().add(toVertex).multiplyScalar(0.5);

        // Color for the edge cost
        var normalizedCostFromTo = (edge.cost - minCost) / (maxCost - minCost);
        var colorFromTo = new THREE.Color(0x00FF00).lerp(new THREE.Color(0xFF0000), normalizedCostFromTo)
		if (edge.cost<=0) {colorFromTo = new THREE.Color(0xFF00FF)}
        var normalizedCostToFrom = (edge.reverseCost - minCost) / (maxCost - minCost);
        var colorToFrom = new THREE.Color(0x00FF00).lerp(new THREE.Color(0xFF0000), normalizedCostToFrom)
		if (edge.reverseCost<=0) {colorFromTo = new THREE.Color(0xFF00FF)}
        //colorFromTo.setHSL((1 - normalizedCostFromTo) * 0.6, 1.0, 0.5); // Gradient from blue (0.6) to yellow (0.0)

        // Arrow from fromVertex to midpoint
        geometry.vertices.push(fromVertex, midpoint);
        geometry.colors.push(colorFromTo, colorFromTo);
        geometry.vertices.push(toVertex, midpoint);
        geometry.colors.push(colorToFrom, colorToFrom);

        // Arrow from toVertex to midpoint
        //geometry.vertices.push(toVertex, midpoint);
        //geometry.colors.push(colorFromTo, colorFromTo);
    }

    // Convert legacy geometry for line rendering
    if (geometry.vertices && geometry.vertices.length > 0) {
        var positions = [];
        var colors = [];
        for (var i = 0; i < geometry.vertices.length; i++) {
            var vertex = geometry.vertices[i];
            positions.push(vertex.x, vertex.y, vertex.z);
            if (geometry.colors && geometry.colors[i]) {
                var color = geometry.colors[i];
                colors.push(color.r, color.g, color.b);
            } else {
                colors.push(1, 1, 1);
            }
        }
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    }
    
    var material = new THREE.LineBasicMaterial({ vertexColors: true });
    var renderObject = new THREE.LineSegments(geometry, material);
    return renderObject;
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

function renderPath(path) {
    // Remove any existing path render object
    if (planet.pathRenderObject) {
        for (let i = planet.pathRenderObject.length - 1; i >= 0; i--) {
            scene.remove(planet.pathRenderObject[i]);
        }
    }
    planet.pathRenderObject = [];
    if (!fromVertex || !toVertex || !path) {
        return;
    }
    for (let i = 0; i < path.length - 1; i++) {
        const fromTile = path[i];
        const toTile = path[i + 1];
        
        // Calculate border elevation for better terrain following
        var borderElevation = calculateBorderElevation(fromTile, toTile);
        
        // Calculate positions with elevation
        var fromPos = fromTile.position.clone();
        var toPos = toTile.position.clone();
        var midPos = fromPos.clone().add(toPos).multiplyScalar(0.5);
        
        // Apply elevation exaggeration
        if (fromTile.elevation > 0) {
            var fromDistance = fromPos.length();
            fromPos.normalize().multiplyScalar(fromDistance + elevationMultiplier * fromTile.elevation + 10);
        } else {
            fromPos.multiplyScalar(1.0006);
        }
        
        if (toTile.elevation > 0) {
            var toDistance = toPos.length();
            toPos.normalize().multiplyScalar(toDistance + elevationMultiplier * toTile.elevation + 10);
        } else {
            toPos.multiplyScalar(1.0006);
        }
        
        // Apply border elevation to midpoint
        if (borderElevation > 0) {
            var midDistance = midPos.length();
            midPos.normalize().multiplyScalar(midDistance + elevationMultiplier * borderElevation + 10);
        } else {
            midPos.multiplyScalar(1.0006);
        }
        
        // Create two arrow segments: fromPos -> midPos and midPos -> toPos
        const firstDirection = midPos.clone().sub(fromPos);
        const firstArrow = new THREE.ArrowHelper(
            firstDirection.clone().normalize(),
            fromPos,
            firstDirection.length(),
            0xff0000
        );
        
        const secondDirection = toPos.clone().sub(midPos);
        const secondArrow = new THREE.ArrowHelper(
            secondDirection.clone().normalize(),
            midPos,
            secondDirection.length(),
            0xff0000
        );
        
        scene.add(firstArrow);
        scene.add(secondArrow);
        planet.pathRenderObject.push(firstArrow);
        planet.pathRenderObject.push(secondArrow);
    }
}

// Label rendering system
var labelSprites = []; // Array to track all label sprites

function createLabelSprite(text, color, fontSize) {
	color = color || 'white';
	fontSize = fontSize || 32;
	
	// Create canvas for text
	var canvas = document.createElement('canvas');
	var context = canvas.getContext('2d');
	
	// Set font and measure text
	context.font = fontSize + 'px Arial, sans-serif';
	var textMetrics = context.measureText(text);
	var textWidth = textMetrics.width;
	var textHeight = fontSize;
	
	// Size canvas with padding
	var padding = 10;
	canvas.width = textWidth + padding * 2;
	canvas.height = textHeight + padding * 2;
	
	// Re-set font after canvas resize
	context.font = fontSize + 'px Arial, sans-serif';
	context.textAlign = 'center';
	context.textBaseline = 'middle';
	
	// Draw background
	context.fillStyle = 'rgba(0, 0, 0, 0.7)';
	context.fillRect(0, 0, canvas.width, canvas.height);
	
	// Draw text
	context.fillStyle = color;
	context.fillText(text, canvas.width / 2, canvas.height / 2);
	
	// Create texture and sprite
	var texture = new THREE.CanvasTexture(canvas);
	texture.needsUpdate = true;
	
	var spriteMaterial = new THREE.SpriteMaterial({
		map: texture,
		transparent: true,
		alphaTest: 0.1
	});
	
	var sprite = new THREE.Sprite(spriteMaterial);
	
	// Scale sprite appropriately
	var scale = 50;
	sprite.scale.set(scale, scale * (canvas.height / canvas.width), 1);
	
	return sprite;
}

function buildLabelsRenderObject() {
	
	// Clear existing label sprites
	clearLabelSprites();
	
	if (!labeledTiles || labeledTiles.length === 0) {
		return null;
	}
	
/* 	console.log('DEBUG: labeledTiles contents:', labeledTiles.map(t => ({
		label: t.label, 
		elevation: t.elevation,
		hasAveragePosition: !!t.averagePosition,
		hasElevationDisplacement: !!t.elevationDisplacement
	}))); */
	
	// Create a group to hold all labels
	var labelsGroup = new THREE.Group();
	var validTiles = 0;
	
	for (var i = 0; i < labeledTiles.length; i++) {
		var tile = labeledTiles[i];
		//console.log('DEBUG: Processing tile', i, 'with label:', tile.label);
		
		if (!tile.label || !tile.averagePosition) {
			continue;
		}
		
		validTiles++;

		// Choose color and size based on tile type
		var labelColor = 'yellow';
		var fontSize = 24;
		if (tile.isCity === true) {
			labelColor = 'orange';
			fontSize = 28;
		}

		var sprite = createLabelSprite(tile.label, labelColor, fontSize);
		
		// Position sprite above the tile
		var labelPosition = tile.averagePosition.clone();
		var distance = labelPosition.length();
		
		//console.log('DEBUG: Tile position distance:', distance, 'elevation:', tile.elevation, 'elevationDisplacement:', tile.elevationDisplacement);
		//console.log('DEBUG: useElevationDisplacement setting:', useElevationDisplacement);
		
		// Position label just above the surface, respecting 3D/sphere mode
		var labelOffset = 10; // Small offset to appear just above surface
		
		if (useElevationDisplacement && tile.elevation > 0 && tile.elevationDisplacement) {
			// 3D mode: position above the elevated terrain
			labelPosition.normalize().multiplyScalar(distance + tile.elevationDisplacement + labelOffset);
			//console.log('DEBUG: Applied 3D elevation positioning - offset from displaced surface');
		} else {
			// Sphere mode: position just above base sphere surface
			labelPosition.normalize().multiplyScalar(distance + labelOffset);
			//console.log('DEBUG: Applied sphere positioning - offset from base sphere');
		}
		
		sprite.position.copy(labelPosition);
		sprite.userData.tile = tile; // Store reference to tile
		
		labelsGroup.add(sprite);
		labelSprites.push(sprite);
		
		//console.log('DEBUG: Added sprite to group, position:', sprite.position);
	}
	
	return labelsGroup;
}

function clearLabelSprites() {
	for (var i = 0; i < labelSprites.length; i++) {
		var sprite = labelSprites[i];
		if (sprite.parent) {
			sprite.parent.remove(sprite);
		}
		// Clean up texture and material
		if (sprite.material && sprite.material.map) {
			sprite.material.map.dispose();
		}
		if (sprite.material) {
			sprite.material.dispose();
		}
	}
	labelSprites = [];
}

// FPS tracking function
function updateFPS() {
    fpsCounter.frameCount++;
    var currentTime = performance.now();
    var deltaTime = currentTime - fpsCounter.lastTime;
    
    if (deltaTime >= fpsCounter.updateInterval) {
        fpsCounter.currentFPS = Math.round((fpsCounter.frameCount * 1000) / deltaTime);
        
        // Update FPS display if element exists
        var fpsElement = document.getElementById('fpsCounter');
        if (fpsElement) {
            fpsElement.textContent = 'FPS: ' + fpsCounter.currentFPS;
        }

        // Update zoom display
        var zoomElement = document.getElementById('zoomCounter');
        if (zoomElement) {
            zoomElement.textContent = 'Zoom: ' + zoom.toFixed(2) + ' | Mode: ' + projectionMode;
        }
        
        // Reset counters
        fpsCounter.frameCount = 0;
        fpsCounter.lastTime = currentTime;
    }
}

// Mercator projection toggle function
function toggleMercatorProjection() {
	if (projectionMode === "globe") {
		projectionMode = "mercator";
		// Reset zoom for good initial Mercator view
		zoom = 1.0; // Good overview level based on user testing
		console.log("Switched to Mercator projection mode");
	} else {
		projectionMode = "globe";
		// Reset zoom for 3D globe view
		zoom = 1.0; // Standard globe zoom level
		console.log("Switched to Globe projection mode");
	}

	// Update camera for the new projection mode
	updateCamera();

	// Update UI button states
	updateProjectionButtonStates();

	// Regenerate render data to reflect the new projection
	// (Labels will be rebuilt automatically in the completion callback)
	if (planet && planet.topology) {
		regenerateRenderDataForProjection();
	}
}

// Update the visual state of projection buttons
function updateProjectionButtonStates() {
	if (typeof ui !== 'undefined') {
		// Clear all projection button states
		if (ui.projectGlobe) ui.projectGlobe.removeClass("toggled");
		if (ui.projectRaisedGlobe) ui.projectRaisedGlobe.removeClass("toggled");
		if (ui.projectMercatorMap) ui.projectMercatorMap.removeClass("toggled");

		// Set active button based on current mode
		if (projectionMode === "mercator") {
			if (ui.projectMercatorMap) ui.projectMercatorMap.addClass("toggled");
		} else if (useElevationDisplacement) {
			if (ui.projectRaisedGlobe) ui.projectRaisedGlobe.addClass("toggled");
		} else {
			if (ui.projectGlobe) ui.projectGlobe.addClass("toggled");
		}
	}
}

// Regeneration control variables
var isRegenerating = false; // Flag to prevent double regeneration

// Regenerate render data when switching projection modes
function regenerateRenderDataForProjection() {
	console.log("Regenerating render data for projection mode:", projectionMode);

	if (planet && planet.topology) {
		// Use the same regeneration pattern as the working elevation toggle
		var regenerateAction = new SteppedAction("Updating Projection Mode");
		regenerateAction
			.executeSubaction(function(action) {
				return generatePlanetRenderData(planet.topology, planet.random, action);
			})
			.getResult(function(renderData) {
				console.log("Starting cleanup - Scene children before:", scene.children.length);

				// More thorough cleanup - remove ALL existing planet render objects
				if (planet.renderData) {
					console.log("Existing render data keys:", Object.keys(planet.renderData));
					Object.keys(planet.renderData).forEach(function(key) {
						if (planet.renderData[key] && planet.renderData[key].renderObject) {
							console.log("Removing render object for key:", key);
							scene.remove(planet.renderData[key].renderObject);
							// Also dispose of geometry and materials to prevent memory leaks
							if (planet.renderData[key].renderObject.geometry) {
								planet.renderData[key].renderObject.geometry.dispose();
							}
							if (planet.renderData[key].renderObject.material) {
								if (Array.isArray(planet.renderData[key].renderObject.material)) {
									planet.renderData[key].renderObject.material.forEach(mat => mat.dispose());
								} else {
									planet.renderData[key].renderObject.material.dispose();
								}
							}
						} else {
							console.log("No render object found for key:", key);
						}
					});
				}

				console.log("Scene children after cleanup:", scene.children.length);

				// Update the planet's render data using same pattern as elevation toggle
				Object.keys(renderData).forEach(function(key) {
					planet.renderData[key] = renderData[key];

					// Only automatically add the surface render object to the scene
					// Overlays will be handled by their visibility functions
					if (key === 'surface' && renderData[key] && renderData[key].renderObject) {
						scene.add(renderData[key].renderObject);
					}
				});

				// Reapply current visibility settings (this will add/remove overlays as needed)
				showHideSunlight(renderSunlight);
				showHidePlateBoundaries(renderPlateBoundaries);
				showHidePlateMovements(renderPlateMovements);
				showHideAirCurrents(renderAirCurrents);
				showHideRivers(renderRivers);
				showHideMoon(renderMoon);

				// Rebuild labels AFTER render data is updated with correct mercator coordinates
				if (planet && planet.topology && planet.topology.tiles && typeof rebuildAllLabelsForProjection !== 'undefined') {
					rebuildAllLabelsForProjection(planet.topology.tiles);
				}

				console.log("Render data regenerated for", projectionMode, "projection");
				console.log("Surface geometry vertices:", renderData.surface ? renderData.surface.geometry.attributes.position.count : "none");
				console.log("Scene children count:", scene.children.length);

			})
			.execute();
	}
}
