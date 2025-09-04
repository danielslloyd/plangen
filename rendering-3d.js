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

	var sunTime = Math.PI * 2 * currentRenderFrameTime / 60000 + sunTimeOffset;
	directionalLight.position.set(Math.cos(sunTime), 0, Math.sin(sunTime)).normalize();

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
	camera.position.lerp(new Vector3(0, 0, 2000), Math.pow(zoom, 2.0));
	camera.position.applyMatrix4(transformation);
	camera.up.set(0, 1, 0);
	camera.up.applyMatrix4(transformation);
	camera.lookAt(new Vector3(0, 0, 1000).applyMatrix4(transformation));
	camera.updateProjectionMatrix();
}

function buildArrow(geometry, position, direction, normal, baseWidth, color) {
	if (direction.lengthSq() === 0) return;
	var sideOffset = direction.clone().cross(normal).setLength(baseWidth / 2);
	var baseIndex = geometry.vertices.length;
	geometry.vertices.push(position.clone().add(sideOffset), position.clone().add(direction), position.clone().sub(sideOffset));
	geometry.faces.push(new THREE.Face3(baseIndex, baseIndex + 2, baseIndex + 1, normal, [color, color, color]));
}

function buildTileWedge(f, b, s, t, n) {
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
}

function createTileSelectRenderObject(tile, color) {
    var outerColor = new THREE.Color(0x000000);
    var innerColor = color || new THREE.Color(0xFFFFFF);
    var geometry = new THREE.Geometry();
    geometry.vertices.push(new THREE.Vector3().lerp(tile.averagePosition, (1+Math.abs(tile.elevation)/10)));//1.07
    for (var i = 0; i < tile.corners.length; ++i) {
        geometry.vertices.push(new THREE.Vector3().lerp(tile.corners[i].position, 1.0005));
        geometry.faces.push(new THREE.Face3(i + 1, (i + 1) % tile.corners.length + 1, 0, tile.normal, [outerColor, outerColor, innerColor]));
    }
    geometry.boundingSphere = tile.boundingSphere.clone();
    var material = new THREE.MeshLambertMaterial({ vertexColors: THREE.VertexColors });
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
    }
}


function buildEdgeCostsRenderObject(edges) {
    var geometry = new THREE.Geometry();
    var minCost = 0.2 //Math.min(...edges.map(edge => edge.cost));
    var maxCost = 50 //Math.max(...edges.map(edge => edge.cost));
	var portCost = 100
	var mincolor = new THREE.Color(0xFFFFBB);
	var maxcolor = new THREE.Color(0xFFFF00);

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

    var material = new THREE.LineBasicMaterial({ vertexColors: THREE.VertexColors, linewidth: 1 });
    var renderObject = new THREE.Line(geometry, material, THREE.LinePieces);
    return renderObject;
}
