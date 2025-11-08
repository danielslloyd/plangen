// Planet Editor
// Advanced editing tools for modifying planet data

// Global editor state
var editor = {
	scene: null,
	camera: null,
	renderer: null,
	planet: null,
	selectedTile: null,
	editMode: null, // 'elevation', 'wind', 'temperature', 'moisture'
	isPainting: false,
	brushSize: 3,
	blendStrength: 0.5,
	windDirection: new THREE.Vector3(0, 0, 0),
	showWireframe: false,
	showLabels: false,
	highlightMesh: null,
	cameraLatitude: 0,
	cameraLongitude: 0,
	zoom: 1.0
};

// Initialize editor on document ready
$(document).ready(function() {
	initializeEditor();
	setupUIHandlers();
});

function initializeEditor() {
	// Create Three.js scene
	editor.scene = new THREE.Scene();
	editor.camera = new THREE.PerspectiveCamera(70, 1, 0.2, 2000);
	editor.renderer = new THREE.WebGLRenderer({
		antialias: true,
		alpha: true
	});
	editor.renderer.setClearColor(0x000033, 1);

	// Add lights
	var ambientLight = new THREE.AmbientLight(0xFFFFFF, 0.8);
	editor.scene.add(ambientLight);

	var directionalLight = new THREE.DirectionalLight(0xFFFFFF, 0.6);
	directionalLight.position.set(-3, 3, 7).normalize();
	editor.scene.add(directionalLight);

	// Add renderer to viewport
	var viewport = document.getElementById('editorViewport');
	viewport.appendChild(editor.renderer.domElement);

	// Setup camera
	editor.camera.position.set(0, 0, 500);
	editor.camera.lookAt(0, 0, 0);

	// Handle window resize
	handleResize();
	window.addEventListener('resize', handleResize);

	// Setup mouse handlers
	editor.renderer.domElement.addEventListener('click', handleTileClick);
	editor.renderer.domElement.addEventListener('mousedown', handleMouseDown);
	editor.renderer.domElement.addEventListener('mousemove', handleMouseMove);
	editor.renderer.domElement.addEventListener('mouseup', handleMouseUp);
	editor.renderer.domElement.addEventListener('wheel', handleZoom);

	// Setup keyboard handlers
	document.addEventListener('keydown', handleKeyDown);

	// Create highlight mesh for selected tile
	var highlightGeometry = new THREE.SphereGeometry(1, 16, 16);
	var highlightMaterial = new THREE.MeshBasicMaterial({
		color: 0xffff00,
		wireframe: true,
		transparent: true,
		opacity: 0.5
	});
	editor.highlightMesh = new THREE.Mesh(highlightGeometry, highlightMaterial);
	editor.highlightMesh.visible = false;
	editor.scene.add(editor.highlightMesh);

	// Start render loop
	requestAnimationFrame(renderEditor);
}

function handleResize() {
	var width = window.innerWidth;
	var height = window.innerHeight;
	editor.camera.aspect = width / height;
	editor.camera.updateProjectionMatrix();
	editor.renderer.setSize(width, height);
}

function renderEditor() {
	requestAnimationFrame(renderEditor);
	updateCamera();
	editor.renderer.render(editor.scene, editor.camera);
}

function updateCamera() {
	var distance = 500 / editor.zoom;
	var x = distance * Math.cos(editor.cameraLatitude) * Math.sin(editor.cameraLongitude);
	var y = distance * Math.sin(editor.cameraLatitude);
	var z = distance * Math.cos(editor.cameraLatitude) * Math.cos(editor.cameraLongitude);

	editor.camera.position.set(x, y, z);
	editor.camera.lookAt(0, 0, 0);
}

function setupUIHandlers() {
	// Load/Save buttons
	$('#loadPlanetBtn').click(loadPlanetInEditor);
	$('#savePlanetBtn').click(savePlanetFromEditor);

	// Edit mode buttons
	$('#elevationEditBtn').click(function() { setEditMode('elevation'); });
	$('#windEditBtn').click(function() { setEditMode('wind'); });
	$('#temperatureEditBtn').click(function() { setEditMode('temperature'); });
	$('#moistureEditBtn').click(function() { setEditMode('moisture'); });

	// View options
	$('#showWireframeBtn').click(toggleWireframe);
	$('#showLabelsBtn').click(toggleLabels);

	// Elevation editing
	$('#elevationSlider').on('input', function() {
		var value = parseFloat($(this).val());
		$('#elevationInput').val(value.toFixed(2));
	});
	$('#elevationInput').on('input', function() {
		var value = parseFloat($(this).val());
		$('#elevationSlider').val(value);
	});
	$('#applyElevationBtn').click(applyElevationEdit);
	$('#cancelElevationBtn').click(cancelEdit);

	// Wind editing
	$('#brushSizeSlider').on('input', function() {
		editor.brushSize = parseInt($(this).val());
		$('#brushSizeDisplay').text(editor.brushSize);
		updateBrushPreview();
	});
	$('#blendStrengthSlider').on('input', function() {
		editor.blendStrength = parseFloat($(this).val());
		$('#blendStrengthDisplay').text((editor.blendStrength * 100).toFixed(0) + '%');
	});
	$('#windX, #windY, #windZ').on('input', updateWindDirection);
	$('#paintWindBtn').click(function() { editor.isPainting = true; });
	$('#clearWindBtn').click(clearWindSelection);

	// Temperature editing
	$('#temperatureSlider').on('input', function() {
		var value = parseFloat($(this).val());
		$('#temperatureInput').val(value.toFixed(2));
	});
	$('#temperatureInput').on('input', function() {
		var value = parseFloat($(this).val());
		$('#temperatureSlider').val(value);
	});
	$('#applyTemperatureBtn').click(applyTemperatureEdit);
	$('#cancelTemperatureBtn').click(cancelEdit);

	// Moisture editing
	$('#moistureSlider').on('input', function() {
		var value = parseFloat($(this).val());
		$('#moistureInput').val(value.toFixed(2));
	});
	$('#moistureInput').on('input', function() {
		var value = parseFloat($(this).val());
		$('#moistureSlider').val(value);
	});
	$('#applyMoistureBtn').click(applyMoistureEdit);
	$('#cancelMoistureBtn').click(cancelEdit);
}

function loadPlanetInEditor() {
	var input = document.createElement('input');
	input.type = 'file';
	input.accept = '.json';

	input.onchange = function(e) {
		var file = e.target.files[0];
		var reader = new FileReader();

		reader.onload = function(event) {
			try {
				var data = JSON.parse(event.target.result);

				if (data.type === 'full') {
					loadPlanetFull(data, function() {
						editor.planet = planet;
						onPlanetLoaded();
						console.log('Planet loaded in editor');
					});
				} else if (data.type === 'minimal') {
					alert('Please load a FULL format planet file for editing. Minimal format requires regeneration.');
				} else {
					alert('Unknown planet file format');
				}
			} catch (error) {
				alert('Error loading planet file: ' + error.message);
				console.error('Error loading planet:', error);
			}
		};

		reader.readAsText(file);
	};

	input.click();
}

function onPlanetLoaded() {
	// Update UI
	$('#savePlanetBtn').prop('disabled', false);
	$('#loadedPlanetInfo').show();
	$('#planetSeedDisplay').text(editor.planet.seed);
	$('#planetTileCount').text(editor.planet.topology.tiles.length);

	console.log('Planet loaded:', editor.planet);
}

function savePlanetFromEditor() {
	if (!editor.planet) {
		alert('No planet to save!');
		return;
	}

	// Save as full format
	var data = savePlanetFull(editor.planet);
	var filename = 'planet-' + editor.planet.seed + '-edited-full.json';
	downloadPlanetFile(data, filename);

	console.log('Planet saved:', filename);
}

function setEditMode(mode) {
	editor.editMode = mode;

	// Update UI
	$('.editor-button').removeClass('active');
	$('#' + mode + 'EditBtn').addClass('active');

	// Hide all edit panels
	$('#elevationEditPanel, #windEditPanel, #temperatureEditPanel, #moistureEditPanel').hide();

	// Show relevant panel
	$('#' + mode + 'EditPanel').show();
	$('#currentModeDisplay').text(mode.charAt(0).toUpperCase() + mode.slice(1));

	console.log('Edit mode:', mode);
}

function cancelEdit() {
	editor.selectedTile = null;
	editor.highlightMesh.visible = false;
	$('#tileInfoPanel').hide();
}

function handleTileClick(event) {
	if (!editor.planet) return;

	var tile = getTileAtMouse(event);
	if (tile) {
		selectTile(tile);

		// Apply wind immediately if in paint mode
		if (editor.editMode === 'wind' && editor.isPainting) {
			applyWindEdit(tile);
		}
	}
}

function handleMouseDown(event) {
	if (editor.editMode === 'wind') {
		editor.isPainting = true;
	}
}

function handleMouseMove(event) {
	if (!editor.planet || !editor.isPainting || editor.editMode !== 'wind') return;

	var tile = getTileAtMouse(event);
	if (tile) {
		applyWindEdit(tile);
	}
}

function handleMouseUp(event) {
	editor.isPainting = false;
}

function handleZoom(event) {
	event.preventDefault();
	var delta = event.deltaY > 0 ? 1.1 : 0.9;
	editor.zoom *= delta;
	editor.zoom = Math.max(0.5, Math.min(5, editor.zoom));
}

function handleKeyDown(event) {
	var key = event.key.toLowerCase();

	// Arrow keys for camera rotation
	if (key === 'arrowleft') {
		editor.cameraLongitude -= 0.1;
	} else if (key === 'arrowright') {
		editor.cameraLongitude += 0.1;
	} else if (key === 'arrowup') {
		editor.cameraLatitude += 0.1;
		editor.cameraLatitude = Math.min(Math.PI / 2 - 0.1, editor.cameraLatitude);
	} else if (key === 'arrowdown') {
		editor.cameraLatitude -= 0.1;
		editor.cameraLatitude = Math.max(-Math.PI / 2 + 0.1, editor.cameraLatitude);
	}

	// Escape to cancel selection
	if (key === 'escape') {
		cancelEdit();
	}
}

function getTileAtMouse(event) {
	if (!editor.planet || !editor.planet.topology) return null;

	var rect = editor.renderer.domElement.getBoundingClientRect();
	var x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
	var y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

	var raycaster = new THREE.Raycaster();
	raycaster.setFromCamera(new THREE.Vector2(x, y), editor.camera);

	// Check intersection with planet surface
	var intersects = raycaster.intersectObject(editor.planet.renderData.surface.renderObject, true);

	if (intersects.length > 0) {
		var point = intersects[0].point;

		// Find nearest tile
		var nearestTile = null;
		var minDistance = Infinity;

		for (var i = 0; i < editor.planet.topology.tiles.length; i++) {
			var tile = editor.planet.topology.tiles[i];
			var distance = point.distanceTo(tile.averagePosition || tile.position);

			if (distance < minDistance) {
				minDistance = distance;
				nearestTile = tile;
			}
		}

		return nearestTile;
	}

	return null;
}

function selectTile(tile) {
	editor.selectedTile = tile;

	// Update highlight
	editor.highlightMesh.position.copy(tile.averagePosition || tile.position);
	editor.highlightMesh.visible = true;

	// Update info panel
	updateTileInfoPanel(tile);
	$('#tileInfoPanel').show();

	// Update edit values
	if (editor.editMode === 'elevation') {
		$('#elevationSlider').val(tile.elevation || 0);
		$('#elevationInput').val((tile.elevation || 0).toFixed(2));
	} else if (editor.editMode === 'temperature') {
		$('#temperatureSlider').val(tile.temperature || 0.5);
		$('#temperatureInput').val((tile.temperature || 0.5).toFixed(2));
	} else if (editor.editMode === 'moisture') {
		$('#moistureSlider').val(tile.moisture || 0.5);
		$('#moistureInput').val((tile.moisture || 0.5).toFixed(2));
	}
}

function updateTileInfoPanel(tile) {
	$('#selectedTileId').text(tile.id);
	$('#tileElevation').text((tile.elevation || 0).toFixed(3));
	$('#tileTemperature').text((tile.temperature || 0).toFixed(3));
	$('#tileMoisture').text((tile.moisture || 0).toFixed(3));
	$('#tileBiome').text(tile.biome || 'unknown');

	// Calculate average air current from corners
	var avgAir = new THREE.Vector3(0, 0, 0);
	if (tile.corners && tile.corners.length > 0) {
		for (var i = 0; i < tile.corners.length; i++) {
			if (tile.corners[i].airCurrent) {
				avgAir.add(tile.corners[i].airCurrent);
			}
		}
		avgAir.divideScalar(tile.corners.length);
		$('#tileAirCurrent').text(
			'(' + avgAir.x.toFixed(2) + ', ' +
			avgAir.y.toFixed(2) + ', ' +
			avgAir.z.toFixed(2) + ')'
		);
	} else {
		$('#tileAirCurrent').text('N/A');
	}
}

function applyElevationEdit() {
	if (!editor.selectedTile) {
		alert('No tile selected!');
		return;
	}

	var newElevation = parseFloat($('#elevationInput').val());
	editor.selectedTile.elevation = newElevation;

	// Update corner elevations (average)
	if (editor.selectedTile.corners) {
		for (var i = 0; i < editor.selectedTile.corners.length; i++) {
			editor.selectedTile.corners[i].elevation = newElevation;
		}
	}

	// Regenerate render data for the planet
	regeneratePlanetVisuals();

	console.log('Applied elevation:', newElevation, 'to tile', editor.selectedTile.id);
}

function applyWindEdit(centerTile) {
	if (!centerTile) return;

	// Get wind direction from inputs
	var windX = parseFloat($('#windX').val()) || 0;
	var windY = parseFloat($('#windY').val()) || 0;
	var windZ = parseFloat($('#windZ').val()) || 0;
	var windVector = new THREE.Vector3(windX, windY, windZ);

	// Get affected tiles based on brush size
	var affectedTiles = getTilesInRadius(centerTile, editor.brushSize);

	// Apply wind with distance-based blending
	for (var i = 0; i < affectedTiles.length; i++) {
		var tileData = affectedTiles[i];
		var tile = tileData.tile;
		var distance = tileData.distance;

		// Calculate blend factor (1.0 at center, 0.0 at edge)
		var blendFactor = 1.0 - (distance / editor.brushSize);
		blendFactor = Math.max(0, Math.min(1, blendFactor));
		blendFactor *= editor.blendStrength;

		// Apply to corners (air currents are stored on corners)
		if (tile.corners) {
			for (var j = 0; j < tile.corners.length; j++) {
				var corner = tile.corners[j];
				if (!corner.airCurrent) {
					corner.airCurrent = new THREE.Vector3(0, 0, 0);
				}

				// Blend current air current with new wind direction
				corner.airCurrent.lerp(windVector, blendFactor);
			}
		}
	}

	console.log('Applied wind to', affectedTiles.length, 'tiles around tile', centerTile.id);

	// Update display
	if (editor.selectedTile === centerTile) {
		updateTileInfoPanel(centerTile);
	}
}

function getTilesInRadius(centerTile, radius) {
	var result = [];
	var visited = new Set();
	var queue = [{ tile: centerTile, distance: 0 }];

	visited.add(centerTile.id);
	result.push({ tile: centerTile, distance: 0 });

	while (queue.length > 0) {
		var current = queue.shift();

		if (current.distance < radius && current.tile.tiles) {
			for (var i = 0; i < current.tile.tiles.length; i++) {
				var neighbor = current.tile.tiles[i];

				if (!visited.has(neighbor.id)) {
					visited.add(neighbor.id);
					var newDistance = current.distance + 1;
					result.push({ tile: neighbor, distance: newDistance });
					queue.push({ tile: neighbor, distance: newDistance });
				}
			}
		}
	}

	return result;
}

function applyTemperatureEdit() {
	if (!editor.selectedTile) {
		alert('No tile selected!');
		return;
	}

	var newTemperature = parseFloat($('#temperatureInput').val());
	editor.selectedTile.temperature = newTemperature;

	// Update corner temperatures
	if (editor.selectedTile.corners) {
		for (var i = 0; i < editor.selectedTile.corners.length; i++) {
			editor.selectedTile.corners[i].temperature = newTemperature;
		}
	}

	// Regenerate render data
	regeneratePlanetVisuals();

	console.log('Applied temperature:', newTemperature, 'to tile', editor.selectedTile.id);
}

function applyMoistureEdit() {
	if (!editor.selectedTile) {
		alert('No tile selected!');
		return;
	}

	var newMoisture = parseFloat($('#moistureInput').val());
	editor.selectedTile.moisture = newMoisture;

	// Update corner moisture
	if (editor.selectedTile.corners) {
		for (var i = 0; i < editor.selectedTile.corners.length; i++) {
			editor.selectedTile.corners[i].moisture = newMoisture;
		}
	}

	// Regenerate render data
	regeneratePlanetVisuals();

	console.log('Applied moisture:', newMoisture, 'to tile', editor.selectedTile.id);
}

function regeneratePlanetVisuals() {
	if (!editor.planet) return;

	// Remove old surface
	if (editor.planet.renderData && editor.planet.renderData.surface) {
		editor.scene.remove(editor.planet.renderData.surface.renderObject);
	}

	// Regenerate render data
	var action = new SteppedAction(function() {});
	var random = new XorShift128(editor.planet.seed);

	action
		.executeSubaction(function(a) {
			generatePlanetRenderData(editor.planet.topology, random, a);
		}, 1)
		.getResult(function(result) {
			editor.planet.renderData = result;
			editor.scene.add(editor.planet.renderData.surface.renderObject);
		})
		.execute();
}

function toggleWireframe() {
	editor.showWireframe = !editor.showWireframe;
	$('#showWireframeBtn').toggleClass('active');

	if (editor.planet && editor.planet.renderData && editor.planet.renderData.surface) {
		editor.planet.renderData.surface.renderObject.traverse(function(child) {
			if (child.material) {
				child.material.wireframe = editor.showWireframe;
			}
		});
	}
}

function toggleLabels() {
	editor.showLabels = !editor.showLabels;
	$('#showLabelsBtn').toggleClass('active');
	// Label functionality would need to be implemented
	console.log('Labels:', editor.showLabels ? 'ON' : 'OFF');
}

function updateWindDirection() {
	var x = parseFloat($('#windX').val()) || 0;
	var y = parseFloat($('#windY').val()) || 0;
	var z = parseFloat($('#windZ').val()) || 0;
	editor.windDirection.set(x, y, z);
}

function clearWindSelection() {
	$('#windX').val(0);
	$('#windY').val(0);
	$('#windZ').val(0);
	updateWindDirection();
}

function updateBrushPreview() {
	var size = editor.brushSize * 4; // Scale for visual
	$('#brushPreview').css({
		width: size + 'px',
		height: size + 'px'
	});
}

// Initialize brush preview
updateBrushPreview();
