function buildSurfaceRenderObject(tiles, watersheds, random, action) {
	var planetGeometry = new THREE.Geometry();
	var waterGeometry = new THREE.Geometry();
	var terrainColors = [];
	var plateColors = [];
	var elevationColors = [];
	var temperatureColors = [];
	var moistureColors = [];
	var wheatColors = [];
	var cornColors = [];
	var riceColors = [];
	var fishColors = [];
	var calorieColors = [];
	var portColors = [];
	var shoreColors = [];
	var shoreAColors = [];
	var shoreZColors = [];
	var minShore = Math.min.apply(0, tiles.map((data) => data.shore));
	var maxShore = Math.max.apply(0, tiles.map((data) => data.shore));
	var minBody = Math.min.apply(0, tiles.map((data) => data.body.id));
	var maxBody = Math.max.apply(0, tiles.map((data) => data.body.id));
	let maxSediment = Math.max(...tiles.map(t => t.sediment? t.sediment:0));

	// Calculate corner elevation medians now that tile elevations are available
	var processedCorners = new Set();
	for (var t = 0; t < tiles.length; ++t) {
		var tile = tiles[t];
		for (var c = 0; c < tile.corners.length; ++c) {
			var corner = tile.corners[c];
			if (!processedCorners.has(corner.id)) {
				processedCorners.add(corner.id);
				var tileElevations = [];
				for (var j = 0; j < corner.tiles.length; ++j) {
					if (typeof corner.tiles[j].elevation !== 'undefined') {
						tileElevations.push(corner.tiles[j].elevation);
					}
				}
				if (tileElevations.length > 0) {
					tileElevations.sort(function(a, b) { return a - b; });
					var medianIndex = Math.floor(tileElevations.length / 2);
					if (tileElevations.length % 2 === 0) {
						corner.elevationMedian = (tileElevations[medianIndex - 1] + tileElevations[medianIndex]) / 2;
					} else {
						corner.elevationMedian = tileElevations[medianIndex];
					}
				} else {
					corner.elevationMedian = 0;
				}
			}
		}
	}

	var i = 0;
	action.executeSubaction(function (action) {
		if (i >= tiles.length) return;

		var tile = tiles[i];
		var terrainColor;

		var elevationColor;
		if (tile.elevation <= 0) elevationColor = new THREE.Color(0x224488).lerp(new THREE.Color(0xAADDFF), Math.max(0, Math.min((tile.elevation + 3 / 4) / (3 / 4), 1)));
		else elevationColor = new THREE.Color(0x997755).lerp(new THREE.Color(0x222222), Math.max(0, Math.min(tile.elevation, 1)));

		if (tile.elevation <= 0 || tile.lake) {
			if (tile.elevation <= 0) {
				var normalizedDepth = Math.min(-tile.elevation, 1);
			} else {
				if (tile.lake.log === 'filled') {
					var normalizedDepth = 0.1
				} else if (tile.lake.log === 'kept no drain') {
					var normalizedDepth = 0.5
				} else var normalizedDepth = 1
			}//Math.min(0.2 + 4 * (tile.lake.level - tile.elevation), 1) }
			if ((tile.temperature < 0 || (normalizedElevation - normalizedTemperature / 1.5 > 0.75)) && tile.lake) {
				terrainColor = new THREE.Color(0xDDEEFF) // glacier
			} else if (tile.biome === "ocean" || tile.lake) {
				terrainColor = new THREE.Color(0x27efff).lerp(new THREE.Color(0x072995), Math.pow(normalizedDepth, 1 / 3)).lerp(new THREE.Color(0x072995).lerp(new THREE.Color(0x222D5E), Math.pow(normalizedDepth, 1 / 5)), 1 - 1.1 * tile.temperature);
			} else if (tile.biome === "seaIce") {
				terrainColor = new THREE.Color(0x9EE1FF); //.lerp(colorDeviance, 0.10);
			} else {
				terrainColor = new THREE.Color(0xFF0000);
			}
		} else {
			var normalizedElevation = Math.min(tile.elevation, 1);
			var normalizedMoisture = Math.min(tile.moisture, 1);
			var normalizedTemperature = Math.min(Math.max(tile.temperature, 0), 1);

			terrainColor = new THREE.Color(0xCCCC66).lerp(new THREE.Color(0x005000), Math.pow(normalizedMoisture, .25)).lerp(new THREE.Color(0x777788), Math.pow(normalizedElevation, 2)).lerp(new THREE.Color(0x555544), (1 - tile.temperature));
			terrainColor = terrainColor.lerp(elevationColor, Math.pow(Math.max(normalizedElevation - .4, 0), .7) - normalizedMoisture);
			terrainColor = terrainColor.lerp(new THREE.Color(0x808079), (normalizedTemperature) ^ .01)

			if (tile.biome === "glacier" || tile.temperature < 0) { // && normalizedMoisture > 0.1)
				terrainColor = new THREE.Color(0xDDEEFF);//(0xDDEEFF)
			}
			else if (tile.biome === "lake") {
				//terrainColor =            new THREE.Color(0x04e8fc).lerp(new THREE.Color(0x072965), Math.sqrt(normalizedElevation)).lerp(new THREE.Color(0x2D2D5E),1-tile.temperature);//.lerp(colorDeviance, 0.10);//colder seas are greyer//
				terrainColor = new THREE.Color(0x00FFFF)
				//console.log("lake")
			}
		}

		if (tile.error) { terrainColor = new THREE.Color(0xFF00FF) }
		tile.terrainColor = terrainColor

		var plateColor = tile.plate.color.clone();

		var temperatureColor;
		if (tile.temperature <= 0) temperatureColor = new THREE.Color(0x0000FF).lerp(new THREE.Color(0xBBDDFF), Math.max(0, Math.min((tile.temperature + 2 / 3) / (2 / 3), 1)));
		else temperatureColor = new THREE.Color(0xFFFF00).lerp(new THREE.Color(0xFF0000), Math.max(0, Math.min((tile.temperature) / (3 / 3), 1)));

		var moistureColor = new THREE.Color(0xFFCC00).lerp(new THREE.Color(0x0066FF), Math.max(0, Math.min(tile.rain, 1)));

		//wheat color
		var wheatColor = terrainColor.clone()
		wheatColor = wheatColor.lerp(new THREE.Color(0xFF00FF), tile.wheat / 100);

		//corn color		
		var cornColor = terrainColor.clone()
		cornColor = cornColor.lerp(new THREE.Color(0xFF00FF), tile.corn / 100);

		//rice color		
		var riceColor = terrainColor.clone()
		riceColor = riceColor.lerp(new THREE.Color(0xFF00FF), tile.rice / 100);

		//fish color		
		var fishColor = terrainColor.clone()
		if (tile.fish>0) {
			fishColor = fishColor.lerp(new THREE.Color(0xFF00FF), tile.fish);
		}
		var calorieColor = terrainColor.clone()
		if (tile.upstreamWeight) {
			calorieColor = calorieColor.lerp(new THREE.Color(0xFF00FF), tile.upstreamWeight);
		}

		var portColor = elevationColor.clone()
		if (tile.elevation > 0) {
			var shrDim = maxShore / 4
			if (tile.shore < 3) {
				if (Math.abs(tile.shoreA - tile.shore) >= 4) {
					portColor = portColor.lerp(new THREE.Color(0xFF00FF), Math.abs(tile.shoreA - tile.shore) / 8)
				}
				if (Math.abs(tile.shoreZ - tile.shore) >= 3) {
					portColor = portColor.lerp(new THREE.Color(0x00FF00), Math.abs(tile.shoreZ - tile.shore) / 6)
				}
			}
		}

		var shoreColor = terrainColor.clone()
/* 		if (tile.shore >= 0) {
			if (!tile.tiles.some(n => n.shore > tile.shore)) {
				shoreColor = new THREE.Color(0xFF00FF)
			} else {
				shoreColor = new THREE.Color(0x008800).lerp(new THREE.Color(0xFFFF00), Math.min(1, tile.shore / (maxShore / 2))).lerp(new THREE.Color(0xBB0000), tile.shore / maxShore)
			}
		}
		else {
			shoreColor = new THREE.Color(0x00FFFF).lerp(new THREE.Color(0x0000FF), tile.shore / minShore)
		}; */
		
		//visualize tile.id layouts (dodecahedron?)
		//let maxID = Math.max(...tiles.map(t => t.id));
		//shoreColor = new THREE.Color(0x005500).lerp(new THREE.Color(0xFFFF00), tile.id/maxID);
		
		//visualize sediment
		//console.log(maxSediment);
		//shoreColor = shoreColor.lerp(new THREE.Color(0xFF00FF), (tile.sediment? tile.sediment:0)/maxSediment);

		//if (tile.fish) {
		//	shoreColor = shoreColor.lerp(new THREE.Color(0xFF00FF), tile.fish);
		//}

		//features
		//if (tile.feature) {
		//	shoreColor = tile.feature.color;
		//}

		//gold
		//if (tile.gold) {
		//	shoreColor = shoreColor.lerp(new THREE.Color(0xFF00FF), tile.gold);
		//}

		//timber
		//if (tile.timber) {
		//	shoreColor = shoreColor.lerp(new THREE.Color(0xFF00FF), tile.timber);
		//}
		//
		////gold and oil
		if (tile.oil || tile.gold || tile.bauxite || tile.copper || tile.iron) {
			//shoreColor = new THREE.Color(0xFFFFFF);
			if (tile.gold>0) {
				shoreColor = new THREE.Color(0xFFFF00);
			} else if (tile.oil > 0) {
				shoreColor = new THREE.Color(0x000000);
			} else if (tile.bauxite > 0) {
				shoreColor = new THREE.Color(0xFFA500);
			} else if (tile.copper > 0) {
				shoreColor = new THREE.Color(0xFF00FF);
			} else if (tile.iron > 0) {
				shoreColor = new THREE.Color(0xFF0000);
			}
		}

		//slope
		//if (tile.slope && tile.elevation>0) {
			//shoreColor = shoreColor.lerp(new THREE.Color(0xFF00FF), tile.slope);
		//}
		//fibNoise
		//if (tile.fibNoise) {
		//	shoreColor = shoreColor.lerp(new THREE.Color(0xFF00FF), (1+Math.sin(tile.fibNoise*Math.PI*6))/2);
		//}


		var shoreAColor = terrainColor.clone()
		if (tile.body.id > 0) {
			shoreAColor = new THREE.Color(0x005500).lerp(new THREE.Color(0xFFFF00), tile.body.id / maxBody)
		}
		else if (tile.body.id < 0) {
			shoreAColor = new THREE.Color(0x00FFFF).lerp(new THREE.Color(0x0000FF), tile.body.id / minBody)
		};

		var shoreZColor = terrainColor.clone()
		
		if (tile.watershed && tile.watershed.id >= 0 && !tile.lake) {
			shoreZColor = tile.watershed.color;
			//shoreZColor = new THREE.Color(0xFF0000).lerp(new THREE.Color(0x00FF00), tile.watershed.hash).lerp(new THREE.Color(0xFFFF88), tile.watershed.id % 0.758033988749895)

		};

		var baseIndex = planetGeometry.vertices.length;
		// Use global elevation multiplier parameter
		
		// Calculate tile center position with elevation
		var centerPos = tile.averagePosition.clone();
		if (tile.elevation > 0) {
			var centerDistance = centerPos.length();
			centerPos.normalize().multiplyScalar(centerDistance + elevationMultiplier * tile.elevation);
		}
		planetGeometry.vertices.push(centerPos);
		
		for (var j = 0; j < tile.corners.length; ++j) {
			var corner = tile.corners[j];
			var cornerPosition = corner.position.clone();
			
			// Check if any adjacent tile is ocean (elevation <= 0)
			var hasOceanTile = false;
			for (var k = 0; k < corner.tiles.length; ++k) {
				if (corner.tiles[k].elevation <= 0) {
					hasOceanTile = true;
					break;
				}
			}
			
			// Apply elevation exaggeration only if no adjacent tiles are ocean and median elevation is positive
			if (!hasOceanTile && corner.elevationMedian > 0) {
				var cornerDistance = cornerPosition.length();
				cornerPosition.normalize().multiplyScalar(cornerDistance + elevationMultiplier * corner.elevationMedian);
			}
			
			planetGeometry.vertices.push(cornerPosition);
			
			// Calculate border position (between tile center and corner)
			var borderPosition = centerPos.clone().sub(cornerPosition).multiplyScalar(0.1).add(cornerPosition);
			planetGeometry.vertices.push(borderPosition);

			var i0 = j * 2;
			var i1 = ((j + 1) % tile.corners.length) * 2;
			buildTileWedge(planetGeometry.faces, baseIndex, i0, i1, tile.normal);

			//if (tile.elevation > 0.85) buildTileWedgeColors1(terrainColors, terrainColor, new THREE.Color(0xDDEEFF), terrainColor.clone().multiplyScalar(0.9)); //0.5 the smaller this number, the darker the border
			//else buildTileWedgeColors1(terrainColors, terrainColor, terrainColor, terrainColor.clone().multiplyScalar(0.9)); //0.5 the smaller this number, the darker the border

			buildTileWedgeColors(terrainColors, terrainColor, terrainColor.clone().multiplyScalar(0.95)); //0.5 the smaller this number, the darker the border
			buildTileWedgeColors(plateColors, plateColor, plateColor.clone().multiplyScalar(1));
			buildTileWedgeColors(elevationColors, elevationColor, elevationColor.clone().multiplyScalar(0.9));
			buildTileWedgeColors(temperatureColors, temperatureColor, temperatureColor.clone().multiplyScalar(1));
			buildTileWedgeColors(moistureColors, moistureColor, moistureColor.clone().multiplyScalar(1));
			buildTileWedgeColors(wheatColors, wheatColor, wheatColor.clone().multiplyScalar(0.95));
			buildTileWedgeColors(cornColors, cornColor, cornColor.clone().multiplyScalar(0.95));
			buildTileWedgeColors(riceColors, riceColor, riceColor.clone().multiplyScalar(0.95));
			buildTileWedgeColors(fishColors, fishColor, fishColor.clone().multiplyScalar(0.95));
			buildTileWedgeColors(calorieColors, calorieColor, calorieColor.clone().multiplyScalar(0.95));
			buildTileWedgeColors(portColors, portColor, portColor.clone().multiplyScalar(0.95));
			buildTileWedgeColors(shoreColors, shoreColor, shoreColor.clone().multiplyScalar(1));
			buildTileWedgeColors(shoreAColors, shoreAColor, shoreAColor.clone().multiplyScalar(1));
			buildTileWedgeColors(shoreZColors, shoreZColor, shoreZColor.clone().multiplyScalar(1));
			for (var k = planetGeometry.faces.length - 3; k < planetGeometry.faces.length; ++k) planetGeometry.faces[k].vertexColors = terrainColors[k];
		}
		//if (i<=1) console.log(tile)
		++i;

		action.loop(i / tiles.length);
	});

	planetGeometry.dynamic = true;
	// Bounding sphere radius = base sphere (1000) + maximum possible elevation (elevationMultiplier * 1.0) + buffer
	planetGeometry.boundingSphere = new THREE.Sphere(new Vector3(0, 0, 0), 1000 + elevationMultiplier + 50);
	var planetMaterial = new THREE.MeshLambertMaterial({
		color: new THREE.Color(0x000000),
		ambient: new THREE.Color(0xFFFFFF),
		vertexColors: THREE.VertexColors,
	});
	//var waterMaterial = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(0x000000),reflectivity: 0.7, ambient: new THREE.Color(0xFFFFFF), vertexColors: THREE.VertexColors, });
	var planetRenderObject = new THREE.Mesh(planetGeometry, planetMaterial);

	action.provideResult({
		geometry: planetGeometry,
		terrainColors: terrainColors,
		plateColors: plateColors,
		elevationColors: elevationColors,
		temperatureColors: temperatureColors,
		moistureColors: moistureColors,
		wheatColors: wheatColors,
		cornColors: cornColors,
		riceColors: riceColors,
		fishColors: fishColors,
		calorieColors: calorieColors,
		portColors: portColors,
		shoreColors: shoreColors,
		shoreAColors: shoreAColors,
		shoreZColors: shoreZColors,
		material: planetMaterial,
		renderObject: planetRenderObject,
	});
}

function buildPlateBoundariesRenderObject(borders, action) {
	var geometry = new THREE.Geometry();

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

			var baseIndex = geometry.vertices.length;
			geometry.vertices.push(borderPoint0.clone().add(offset));
			geometry.vertices.push(borderPoint1.clone().add(offset));
			geometry.vertices.push(tilePoint0.clone().sub(borderPoint0).multiplyScalar(0.2).add(borderPoint0).add(offset));
			geometry.vertices.push(tilePoint0.clone().sub(borderPoint1).multiplyScalar(0.2).add(borderPoint1).add(offset));
			geometry.vertices.push(tilePoint1.clone().sub(borderPoint0).multiplyScalar(0.2).add(borderPoint0).add(offset));
			geometry.vertices.push(tilePoint1.clone().sub(borderPoint1).multiplyScalar(0.2).add(borderPoint1).add(offset));

			var pressure = Math.max(-1, Math.min((border.corners[0].pressure + border.corners[1].pressure) / 2, 1));
			var shear = Math.max(0, Math.min((border.corners[0].shear + border.corners[1].shear) / 2, 1));
			var innerColor = (pressure <= 0) ? new THREE.Color(1 + pressure, 1, 0) : new THREE.Color(1, 1 - pressure, 0);
			var outerColor = new THREE.Color(0, shear / 2, shear);

			geometry.faces.push(new THREE.Face3(baseIndex + 0, baseIndex + 1, baseIndex + 2, normal, [innerColor, innerColor, outerColor]));
			geometry.faces.push(new THREE.Face3(baseIndex + 1, baseIndex + 3, baseIndex + 2, normal, [innerColor, outerColor, outerColor]));
			geometry.faces.push(new THREE.Face3(baseIndex + 1, baseIndex + 0, baseIndex + 5, normal, [innerColor, innerColor, outerColor]));
			geometry.faces.push(new THREE.Face3(baseIndex + 0, baseIndex + 4, baseIndex + 5, normal, [innerColor, outerColor, outerColor]));
		}

		++i;

		action.loop(i / borders.length);
	});

	geometry.boundingSphere = new THREE.Sphere(new Vector3(0, 0, 0), 1000 + elevationMultiplier + 60);
	var material = new THREE.MeshBasicMaterial({
		vertexColors: THREE.VertexColors,
	});
	var renderObject = new THREE.Mesh(geometry, material);

	action.provideResult({
		geometry: geometry,
		material: material,
		renderObject: renderObject,
	});
}

function buildPlateMovementsRenderObject(tiles, action) {
	var geometry = new THREE.Geometry();

	var i = 0;
	action.executeSubaction(function (action) {
		if (i >= tiles.length) return;

		var tile = tiles[i];
		var plate = tile.plate;
		var movement = plate.calculateMovement(tile.position);
		var plateMovementColor = new THREE.Color(1 - plate.r, 1 - plate.color.g, 1 - plate.color.b);

		// Calculate elevated position for arrow start
		var arrowPosition = tile.position.clone();
		if (tile.elevation > 0) {
			// Use global elevation multiplier parameter
			var distance = arrowPosition.length();
			arrowPosition.normalize().multiplyScalar(distance + elevationMultiplier * tile.elevation + 2);
		} else {
			arrowPosition.multiplyScalar(1.002);
		}
		
		buildArrow(geometry, arrowPosition, movement.clone().multiplyScalar(0.5), tile.position.clone().normalize(), Math.min(movement.length(), 4), plateMovementColor);

		tile.plateMovement = movement;

		++i;

		action.loop(i / tiles.length);
	});

	geometry.boundingSphere = new THREE.Sphere(new Vector3(0, 0, 0), 1000 + elevationMultiplier + 60);
	var material = new THREE.MeshBasicMaterial({
		vertexColors: THREE.VertexColors,
	});
	var renderObject = new THREE.Mesh(geometry, material);

	action.provideResult({
		geometry: geometry,
		material: material,
		renderObject: renderObject,
	});
}

function buildAirCurrentsRenderObject(corners, action) {
	var geometry = new THREE.Geometry();

	var i = 0;
	action.executeSubaction(function (action) {
		if (i >= corners.length) return;

		var corner = corners[i];
		
		// Calculate elevated position for arrow start
		var arrowPosition = corner.position.clone();
		if (corner.elevationMedian > 0) {
			// Use global elevation multiplier parameter
			var distance = arrowPosition.length();
			arrowPosition.normalize().multiplyScalar(distance + elevationMultiplier * corner.elevationMedian + 2);
		} else {
			arrowPosition.multiplyScalar(1.002);
		}
		
		//buildArrow(geometry, position, direction, normal, baseWidth, color)
		buildArrow(geometry, arrowPosition, corner.airCurrent.clone().multiplyScalar(0.5), corner.position.clone().normalize(), Math.min(corner.airCurrent.length(), 4));

		++i;

		action.loop(i / corners.length);
	});

	geometry.boundingSphere = new THREE.Sphere(new Vector3(0, 0, 0), 1000 + elevationMultiplier + 60);
	//var material = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xFFFFFF), });
	var material = new THREE.MeshPhongMaterial({
		color: new THREE.Color(0xFFFFFF),
		opacity: 0.5,
		transparent: true,
	});
	var renderObject = new THREE.Mesh(geometry, material);

	action.provideResult({
		geometry: geometry,
		material: material,
		renderObject: renderObject,
	});
}

function buildRiversRenderObject(tiles, action) {
	var geometry = new THREE.Geometry();
	var i = 0;
	action.executeSubaction(function (action) {
		if (i >= tiles.length) return;
		var tile = tiles[i];
		if (tile.river) {
			var tile2 = tile.drain;
			
			// Calculate elevated positions for both tiles
			// Use global elevation multiplier parameter
			var fromPos = tile.averagePosition.clone();
			var toPos = tile2.averagePosition.clone();
			
			if (tile.elevation > 0) {
				var fromDistance = fromPos.length();
				fromPos.normalize().multiplyScalar(fromDistance + elevationMultiplier * tile.elevation + 2);
			} else {
				fromPos.multiplyScalar(1.002);
			}
			
			if (tile2.elevation > 0) {
				var toDistance = toPos.length();
				toPos.normalize().multiplyScalar(toDistance + elevationMultiplier * tile2.elevation + 2);
			} else {
				toPos.multiplyScalar(1.002);
			}
			
			var riverCurrent = toPos.clone().sub(fromPos);
			
			// Determine river color based on elevation delta
			var elevationDelta = tile.elevation - tile2.elevation;
			var isWaterfall = elevationDelta >= riverElevationDeltaThreshold;
			var riverColor = isWaterfall ? new THREE.Color(0xFFFFFF) : new THREE.Color(0x003F85);
			
			buildArrow(geometry, fromPos, riverCurrent, tile.averagePosition.clone().normalize(), 5, riverColor);
		}
		++i;

		action.loop(i / tiles.length);
	});

	geometry.boundingSphere = new THREE.Sphere(new Vector3(0, 0, 0), 1000 + elevationMultiplier + 60);
	var material = new THREE.MeshBasicMaterial({
		vertexColors: THREE.VertexColors
	});
	//var material = new THREE.MeshPhongMaterial({	color: new THREE.Color(0x00AAFF),
	//							opacity: 1,
	//						shininess: 100});
	var renderObject = new THREE.Mesh(geometry, material);

	action.provideResult({
		geometry: geometry,
		material: material,
		renderObject: renderObject,
	});
}

