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
		zoom = Math.max(0, Math.min(zoom + frameDuration * cameraZoomDelta * 0.5, 1));
		cameraNeedsUpdated = true;
	}

	var cameraLatitudeDelta = getLatitudeDelta();
	if (frameDuration > 0 && cameraLatitudeDelta !== 0) {
		cameraLatitude += frameDuration * -cameraLatitudeDelta * Math.PI * (zoom * 0.5 + (1 - zoom) * 1 / 20);
		cameraLatitude = Math.max(-Math.PI * 0.49, Math.min(cameraLatitude, Math.PI * 0.49));
		cameraNeedsUpdated = true;
	}

	var cameraLongitudeDelta = getLongitudeDelta();
	if (frameDuration > 0 && cameraLongitudeDelta !== 0) {
		cameraLongitude += frameDuration * cameraLongitudeDelta * Math.PI * (zoom * Math.PI / 8 + (1 - zoom) / (20 * Math.max(Math.cos(cameraLatitude), 0.1)));
		cameraLongitude = cameraLongitude - Math.floor(cameraLongitude / (Math.PI * 2)) * Math.PI * 2;
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
	camera.aspect = window.innerWidth / window.innerHeight;

	var transformation = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(cameraLatitude, cameraLongitude, 0, "YXZ"));
	camera.position.set(0, -50, 1050);
	camera.position.lerp(new THREE.Vector3(0, 0, 2000), Math.pow(zoom, 2.0));
	camera.position.applyMatrix4(transformation);
	camera.up.set(0, 1, 0);
	camera.up.applyMatrix4(transformation);
	camera.lookAt(new THREE.Vector3(0, 0, 1000).applyMatrix4(transformation));
	camera.updateProjectionMatrix();
}

function buildArrow(geometry, position, direction, normal, baseWidth, color) {
	if (direction.lengthSq() === 0) return;
	var sideOffset = direction.clone().cross(normal).setLength(baseWidth / 2);
	var baseIndex = geometry.vertices.length;
	geometry.vertices.push(position.clone().add(sideOffset), position.clone().add(direction), position.clone().sub(sideOffset));
	geometry.faces.push(new THREE.Face3(baseIndex, baseIndex + 2, baseIndex + 1, normal, [color, color, color]));
}

/* function buildTileWedge(f, b, s, t, n) {
	f.push(new THREE.Face3(b + s + 2, b + t + 2, b, n));
	f.push(new THREE.Face3(b + s + 1, b + t + 1, b + t + 2, n));
	f.push(new THREE.Face3(b + s + 1, b + t + 2, b + s + 2, n));
}

function buildTileWedgeColors(f, c, bc) {
	f.push([c, c, c]); //colors inner wedge with gradient from c to c
	f.push([bc, bc, c]); //colors half of the border wedge, gradient from c to bc
	f.push([bc, c, c]); //colors other half of the border wedge, gradient from c to bc
}

function buildTileWedgeColors1(f, c, d, bc) //used for snow cap effect
{
	f.push([c, c, d]); //colors inner wedge with gradient from c to c
	f.push([bc, bc, c]); //colors half of the border wedge, gradient from c to bc
	f.push([bc, c, c]); //colors other half of the border wedge, gradient from c to bc
} */

function createTileSelectRenderObject(tile, color) {
    var outerColor = new THREE.Color(0x000000);
    var innerColor = color || new THREE.Color(0xFFFFFF);
    var geometry = new THREE.BufferGeometry();
    geometry.vertices = [];
    geometry.faces = [];
    // Use global elevation multiplier parameter
    
    // Calculate tile center position with elevation
    var centerPos = tile.averagePosition.clone();
    if (tile.elevation > 0) {
        var centerDistance = centerPos.length();
        centerPos.normalize().multiplyScalar(centerDistance + tile.elevationDisplacement + 5); // +5 for selection highlight offset
    } else {
        centerPos.multiplyScalar(1.0005); // slight offset for water tiles
    }
    geometry.vertices.push(centerPos);
    
    for (var i = 0; i < tile.corners.length; ++i) {
        var corner = tile.corners[i];
        var cornerPosition = corner.position.clone();
        
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
            cornerPosition.normalize().multiplyScalar(cornerDistance + corner.elevationDisplacement + 5); // +5 for selection highlight offset
        } else {
            cornerPosition.multiplyScalar(1.0005); // slight offset for water/coastal corners
        }
        
        geometry.vertices.push(cornerPosition);
        geometry.faces.push(new THREE.Face3(i + 1, (i + 1) % tile.corners.length + 1, 0, tile.normal, [outerColor, outerColor, innerColor]));
    }
    
    // Debug selected tile geometry before conversion
    console.log("=== SELECTED TILE GEOMETRY (before conversion) ===");
    console.log("Vertices:", geometry.vertices.length);
    console.log("Faces:", geometry.faces.length);
    
    // Convert legacy geometry to BufferGeometry
    convertLegacyGeometry(geometry);
    
    // Debug selected tile geometry after conversion
    console.log("=== SELECTED TILE GEOMETRY (after conversion) ===");
    console.log("Position attribute:", geometry.getAttribute('position'));
    console.log("Color attribute:", geometry.getAttribute('color'));
    console.log("Index:", geometry.getIndex());
    
    geometry.boundingSphere = tile.boundingSphere.clone();
    var material = new THREE.MeshLambertMaterial({ vertexColors: true });
    material.transparent = true;
    material.opacity = 0.5;
    material.polygonOffset = true;
    material.polygonOffsetFactor = -2;
    material.polygonOffsetUnits = -2;
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

    console.log(tile);
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
        
        // Reset counters
        fpsCounter.frameCount = 0;
        fpsCounter.lastTime = currentTime;
    }
}
