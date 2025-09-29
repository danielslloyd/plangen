function zoomHandler(event) {
	var zoomDelta;
	var minZoom, maxZoom;

	// Set different zoom bounds for different modes
	if (projectionMode === "mercator") {
		// For Mercator: allow more zoom in and set appropriate bounds
		minZoom = 1;  // Prevent zooming out too far from default
		maxZoom = 5;  // Allow much more zoom in
		zoomDelta = event.deltaY * 0.05;
	} else {
		// For globe mode: use original bounds
		minZoom = 0;
		maxZoom = 1;
		zoomDelta = -event.deltaY * 0.01;
	}


	if (zoomAnimationStartTime === null) {
		zoomAnimationStartTime = Date.now();
		zoomAnimationStartValue = zoom;
		zoomAnimationEndValue = Math.max(minZoom, Math.min(zoomAnimationStartValue + zoomDelta, maxZoom));
		zoomAnimationDuration = Math.abs(zoomAnimationStartValue - zoomAnimationEndValue) * 1000;
	} else {
		zoomAnimationStartTime = Date.now();
		zoomAnimationStartValue = zoom;
		zoomAnimationEndValue = Math.max(minZoom, Math.min(zoomAnimationEndValue + zoomDelta, maxZoom));
		zoomAnimationDuration = Math.abs(zoomAnimationStartValue - zoomAnimationEndValue) * 1000;
	}
}

function clickHandler(event) {
	//console.log(event);
	if (planet) {
		var mouse = new THREE.Vector2();
		mouse.x = (event.pageX / renderer.domElement.clientWidth) * 2 - 1;
		mouse.y = -(event.pageY / renderer.domElement.clientHeight) * 2 + 1;

		if (projectionMode === "mercator") {
			// For Mercator mode, convert mouse coordinates to world coordinates on the 2D plane
			// Get the camera's orthographic bounds
			var left = camera.left;
			var right = camera.right;
			var top = camera.top;
			var bottom = camera.bottom;

			// Convert normalized device coordinates to world coordinates
			var worldX = 2*mercatorCameraX + (mouse.x * (right - left)) / 2;
			var worldY = 2*mercatorCameraY + (mouse.y * (top - bottom)) / 2;

			// Convert world coordinates back to Mercator coordinates (reverse the 2.0 scaling)
			var mercatorX = worldX / 2.0;
			var mercatorY = worldY / 2.0;

			// Convert Mercator coordinates back to Cartesian coordinates
			var clickPosition = mercatorToCartesian(mercatorX, mercatorY, mercatorCenterLat, mercatorCenterLon);

			// Find the closest tile to this position
			var closestTile = null;
			var closestDistance = Infinity;

			for (var i = 0; i < planet.topology.tiles.length; i++) {
				var tile = planet.topology.tiles[i];
				var distance = tile.averagePosition.distanceTo(clickPosition);
				if (distance < closestDistance) {
					closestDistance = distance;
					closestTile = tile;
				}
			}

			if (closestTile) {
				selectTile(closestTile);
			} else {
				deselectTile();
			}
		} else {
			// For 3D globe mode, use the original raycasting approach
			var raycaster = new THREE.Raycaster();
			raycaster.setFromCamera(mouse, camera);

			var intersection = planet.partition.intersectRay(raycaster.ray);
			if (intersection !== false) {
				//console.log(intersection);
				selectTile(intersection);
			} else {
				deselectTile();
			}
		}
	}
}

function keyDownHandler(event) {
	if (disableKeys === true) return;

	switch (event.which) {
		//case KEY.W:
		//case KEY.A:
		//case KEY.S:
		//case KEY.D:
		//case KEY.Z:
		//case KEY.Q:
		case KEY_LEFTARROW:
		case KEY_RIGHTARROW:
		case KEY_UPARROW:
		case KEY_DOWNARROW:
		case KEY_PAGEUP:
		case KEY_PAGEDOWN:
		case KEY_NUMPAD_PLUS:
		case KEY_NUMPAD_MINUS:
			pressedKeys[event.which] = true;
			event.preventDefault();
			break;
	}
}

function keyUpHandler(event) {
	if (disableKeys === true) return;

	switch (event.which) {
		case KEY.W:
			setSurfaceRenderMode("wheat");
			event.preventDefault();
			break;
		case KEY.C:
			setSurfaceRenderMode("corn");
			event.preventDefault();
			break;
		case KEY.F:
			setSurfaceRenderMode("fish");
			event.preventDefault();
			break;
		case KEY.A:
            setFromVertex(event);
            event.preventDefault();
            break;
		case KEY.X:
			setSurfaceRenderMode("shoreA");
			event.preventDefault();
			break;
		case KEY.B:
			setToVertex(event);
			event.preventDefault();
			break;
		case KEY.S:
			setSurfaceRenderMode("shore");
			event.preventDefault();
			break;
		case KEY.D:
			setSurfaceRenderMode("rice");
			event.preventDefault();
			break;
		case KEY.Z:
			setSurfaceRenderMode("shoreZ");
			event.preventDefault();
			break;
		case KEY.Q:
			setSurfaceRenderMode("port");
			event.preventDefault();
			break;
		case KEY_LEFTARROW:
		case KEY_RIGHTARROW:
		case KEY_UPARROW:
		case KEY_DOWNARROW:
		case KEY_PAGEUP:
		case KEY_PAGEDOWN:
		case KEY_NUMPAD_PLUS:
		case KEY_NUMPAD_MINUS:
			pressedKeys[event.which] = false;
			event.preventDefault();
			break;
		case KEY_ESCAPE:
			if (activeAction !== null) {
				ui.progressCancelButton.click();
				event.preventDefault();
			}
			break;
		case KEY_FORWARD_SLASH:
		case KEY["0"]:
			showHideInterface();
			event.preventDefault();
			break;
		case KEY_SPACE:
			generatePlanetAsynchronous();
			event.preventDefault();
			break;
		case KEY["1"]:
			setSubdivisions(20);
			generatePlanetAsynchronous();
			event.preventDefault();
			break;
		case KEY["2"]:
			setSubdivisions(40);
			generatePlanetAsynchronous();
			event.preventDefault();
			break;
		case KEY["3"]:
			setSubdivisions(60);
			setSeed(largeSeed);
			generatePlanetAsynchronous();
			event.preventDefault();
			break;
		case KEY["5"]:
			setSurfaceRenderMode("terrain");
			event.preventDefault();
			break;
		case KEY["6"]:
			setSurfaceRenderMode("plates");
			event.preventDefault();
			break;
		case KEY["7"]:
			setSurfaceRenderMode("elevation");
			event.preventDefault();
			break;
		case KEY["8"]:
			setSurfaceRenderMode("temperature");
			event.preventDefault();
			break;
		case KEY["9"]:
			setSurfaceRenderMode("moisture"); //moisture
			event.preventDefault();
			break;
		case KEY.K:
			setSurfaceRenderMode("calorie");
			event.preventDefault();
			break;
		case KEY.W:
			setSurfaceRenderMode("watersheds");
			event.preventDefault();
			break;
		case KEY.U:
			showHideSunlight();
			event.preventDefault();
			break;
		case KEY.I:
			showHidePlateBoundaries();
			event.preventDefault();
			break;
		case KEY.O:
			showHidePlateMovements();
			event.preventDefault();
			break;
		case KEY.P:
			showHideAirCurrents();
			event.preventDefault();
			break;
		case KEY.R:
			showHideRivers();
			event.preventDefault();
			break;
		case KEY.M:
			showHideMoon();
			event.preventDefault();
			break;
        case KEY.J:
            toggleMercatorProjection();
            event.preventDefault();
            break;
        case KEY.H:
            toggleElevationExaggeration();
            event.preventDefault();
            break;
        case KEY.L:
            setSurfaceRenderMode("oilStripes");
            event.preventDefault();
            break;
        case KEY.N:
            setSurfaceRenderMode("upstreamCalories");
            event.preventDefault();
            break;
	}
}

function cancelButtonHandler() {
	if (activeAction !== null) {
		activeAction.cancel();
	}
}
