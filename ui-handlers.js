function zoomHandler(event) {
	if (zoomAnimationStartTime === null) {
		zoomAnimationStartTime = Date.now();
		zoomAnimationStartValue = zoom;
		zoomAnimationEndValue = Math.max(0, Math.min(zoomAnimationStartValue - event.deltaY * 0.04, 1));
		zoomAnimationDuration = Math.abs(zoomAnimationStartValue - zoomAnimationEndValue) * 1000;
	} else {
		zoomAnimationStartTime = Date.now();
		zoomAnimationStartValue = zoom;
		zoomAnimationEndValue = Math.max(0, Math.min(zoomAnimationEndValue - event.deltaY * 0.04, 1));
		zoomAnimationDuration = Math.abs(zoomAnimationStartValue - zoomAnimationEndValue) * 1000;
	}
}

function clickHandler(event) {
	//console.log(event);
	if (planet) {
		var mouse = new THREE.Vector2();
		mouse.x = (event.pageX / renderer.domElement.clientWidth) * 2 - 1;
		mouse.y = -(event.pageY / renderer.domElement.clientHeight) * 2 + 1;
		
		var raycaster = new THREE.Raycaster();
		raycaster.setFromCamera(mouse, camera);
		
		var intersection = planet.partition.intersectRay(raycaster.ray);
		if (intersection !== false) {
			//console.log(intersection);
			selectTile(intersection); }
		else
			deselectTile();
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
            showHideEdgeCosts();
            event.preventDefault();
            break;
        case KEY.H:
            toggleElevationExaggeration();
            event.preventDefault();
            break;
	}
}

function cancelButtonHandler() {
	if (activeAction !== null) {
		activeAction.cancel();
	}
}
