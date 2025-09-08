function generatePlanetTectonicPlates(topology, plateCount, oceanicRate, random, action) {
	var plates = [];
	var platelessTiles = [];
	var platelessTilePlates = [];
	action.executeSubaction(function (action) {
		var failedCount = 0;
		while (plates.length < plateCount && failedCount < 10000) {
			var corner = topology.corners[random.integerExclusive(0, topology.corners.length)];
			var adjacentToExistingPlate = false;
			for (var i = 0; i < corner.tiles.length; ++i) {
				if (corner.tiles[i].plate) {
					adjacentToExistingPlate = true;
					failedCount += 1;
					break;
				}
			}
			if (adjacentToExistingPlate) continue;

			failedCount = 0;

			var oceanic = (random.unit() < oceanicRate);
			var plate = new Plate(
				new THREE.Color(random.integer(0, 0xFFFFFF)),
				randomUnitVector(random),
				random.realInclusive(-Math.PI / 30, Math.PI / 30),
				random.realInclusive(-Math.PI / 30, Math.PI / 30),
				oceanic ? random.realInclusive(-0.8, -0.3) : random.realInclusive(0.1, 0.5),
				oceanic,
				corner);

			plates.push(plate);

			for (var i = 0; i < corner.tiles.length; ++i) {
				corner.tiles[i].plate = plate;
				plate.tiles.push(corner.tiles[i]);
			}

			for (var i = 0; i < corner.tiles.length; ++i) {
				var tile = corner.tiles[i];
				for (var j = 0; j < tile.tiles.length; ++j) {
					var adjacentTile = tile.tiles[j];
					if (!adjacentTile.plate) {
						platelessTiles.push(adjacentTile);
						platelessTilePlates.push(plate);
					}
				}
			}
		}
	});

	action.executeSubaction(function (action) {
		while (platelessTiles.length > 0) {
			var tileIndex = Math.floor(Math.pow(random.unit(), 2) * platelessTiles.length);
			var tile = platelessTiles[tileIndex];
			var plate = platelessTilePlates[tileIndex];
			platelessTiles.splice(tileIndex, 1);
			platelessTilePlates.splice(tileIndex, 1);
			if (!tile.plate) {
				tile.plate = plate;
				plate.tiles.push(tile);
				for (var j = 0; j < tile.tiles.length; ++j) {
					if (!tile.tiles[j].plate) {
						platelessTiles.push(tile.tiles[j]);
						platelessTilePlates.push(plate);
					}
				}
			}
		}
	});

	action.executeSubaction(calculateCornerDistancesToPlateRoot.bind(null, plates));

	action.provideResult(plates);
}

function generatePlanetElevation(topology, plates, action) {
	var boundaryCorners;
	var boundaryCornerInnerBorderIndexes;
	var elevationBorderQueue;
	var elevationBorderQueueSorter = function (left, right) {
		return left.distanceToPlateBoundary - right.distanceToPlateBoundary;
	};

	action
		.executeSubaction(function (action) {
			identifyBoundaryBorders(topology.borders, action);
		}, 1)
		.executeSubaction(function (action) {
			collectBoundaryCorners(topology.corners, action);
		}, 1)
		.getResult(function (result) {
			boundaryCorners = result;
		})
		.executeSubaction(function (action) {
			calculatePlateBoundaryStress(boundaryCorners, action);
		}, 2)
		.getResult(function (result) {
			boundaryCornerInnerBorderIndexes = result;
		})
		.executeSubaction(function (action) {
			blurPlateBoundaryStress(boundaryCorners, 3, 0.4, action);
		}, 2)
		.executeSubaction(function (action) {
			populateElevationBorderQueue(boundaryCorners, boundaryCornerInnerBorderIndexes, action);
		}, 2)
		.getResult(function (result) {
			elevationBorderQueue = result;
		})
		.executeSubaction(function (action) {
			processElevationBorderQueue(elevationBorderQueue, elevationBorderQueueSorter, action);
		}, 10)
		.executeSubaction(function (action) {
			calculateTileAverageElevations(topology.tiles, action);
		}, 2);
}

function generatePlanetWeather(topology, partitions, heatLevel, moistureLevel, random, action) {
	var planetRadius = 1000;
	var whorls;
	var activeCorners;
	var totalHeat;
	var remainingHeat;
	var totalMoisture;
	var remainingMoisture;

	action
		.executeSubaction(function (action) {
			ctime('Weather: Air Currents');
			generateAirCurrentWhorls(planetRadius, random, action);
		}, 1, "Generating Air Currents")
		.getResult(function (result) {
			ctimeEnd('Weather: Air Currents');
			whorls = result;
		})
		.executeSubaction(function (action) {
			ctime('Weather: Calculate Currents');
			calculateAirCurrents(topology.corners, whorls, planetRadius, action);
		}, 1, "Generating Air Currents")
		.getResult(function (result) {
			ctimeEnd('Weather: Calculate Currents');
		})
		.executeSubaction(function (action) {
			ctime('Weather: Heat Initialization');
			initializeAirHeat(topology.corners, heatLevel, action);
		}, 2, "Calculating Temperature")
		.getResult(function (result) {
			ctimeEnd('Weather: Heat Initialization');
			ctime('Weather: Heat Processing');
			activeCorners = result.corners;
			totalHeat = result.airHeat;
			remainingHeat = result.airHeat;
		})
		.executeSubaction(function (action) {
			var consumedHeat = processAirHeat(activeCorners, action);
			remainingHeat -= consumedHeat;
			if (remainingHeat > 0 && consumedHeat >= 0.0001) action.loop(1 - remainingHeat / totalHeat);
		}, 8, "Calculating Temperature")
		.executeSubaction(function (action) {
			ctimeEnd('Weather: Heat Processing');
			ctime('Weather: Temperature Calculation');
			calculateTemperature(topology.corners, topology.tiles, planetRadius, action);
		}, 1, "Calculating Temperature")
		.executeSubaction(function (action) {
			ctimeEnd('Weather: Temperature Calculation');
			ctime('Weather: Moisture Initialization');
			initializeAirMoisture(topology.corners, moistureLevel, action);
		}, 2, "Calculating Moisture")
		.getResult(function (result) {
			ctimeEnd('Weather: Moisture Initialization');
			ctime('Weather: Moisture Processing');
			activeCorners = result.corners;
			totalMoisture = result.airMoisture;
			remainingMoisture = result.airMoisture;
		})
		.executeSubaction(function (action) {
			var consumedMoisture = processAirMoisture(activeCorners, action);
			remainingMoisture -= consumedMoisture;
			if (remainingMoisture > 0 && consumedMoisture >= 0.0001) action.loop(1 - remainingMoisture / totalMoisture);
		}, 32, "Calculating Moisture")
		.executeSubaction(function (action) {
			ctimeEnd('Weather: Moisture Processing');
			ctime('Weather: Final Moisture Calculation');
			calculateMoisture(topology.corners, topology.tiles, action);
		}, 1, "Calculating Moisture")
		.getResult(function (result) {
			ctimeEnd('Weather: Final Moisture Calculation');
		});
}

function erodeElevation(planet, action) {
	let tiles = planet.topology.tiles
	let watersheds = planet.topology.watersheds

	ctime("groupBodies");
	groupBodies(planet);
	ctimeEnd("groupBodies");

	ctime("randomLocalMax");
	randomLocalMax();
	//randomLocalMax();
	ctimeEnd("randomLocalMax");
	
	// Validate drainage after initial randomLocalMax
	let landTiles = tiles.filter(t => t.elevation > 0);
	if (landTiles.some(t => t.drain)) {  // Only validate if drainage has been set
		validateDrainage(landTiles, 'After initial randomLocalMax');
	}
	
	tiles.sort((a, b) => parseFloat(a.elevation) - parseFloat(b.elevation));

	ctime("newerDrain");
	newerDrain();
	ctimeEnd("newerDrain");

	// Redirect parallel rivers after drainage is established
	ctime("redirectParallelRivers");
	redirectParallelRivers(tiles.filter(t => t.elevation >= 0));
	ctimeEnd("redirectParallelRivers");

	ctime("reMoisture");
	reMoisture()
	ctimeEnd("reMoisture");
	
	//console.log(planet)

	// Helper function to recalculate drainage for specific tiles
	function recalculateDrainageForTiles(tilesToUpdate, allLandTiles) {
		// Clear old relationships for tiles being updated
		tilesToUpdate.forEach(tile => {
			tile.drain = undefined;
			tile.upstream = [];
			tile.downstream = [];
			tile.sources = [];
		});
		
		// Recalculate drainage for updated tiles
		tilesToUpdate.forEach(tile => {
			tile.tiles.sort((a, b) => a.elevation - b.elevation);
			tile.drain = tile.tiles.filter(n => n.elevation < tile.elevation)[0];
		});
		
		// Recalculate upstream/downstream for all affected tiles
		calculateUpstreamDownstream(allLandTiles);
	}

	// Basin-scoped drainage recalculation - much more efficient for localized changes
	function recalculateBasinDrainage(basin, escapeRouteArea = []) {
		// Clear drainage relationships within the basin only
		basin.forEach(tile => {
			tile.drain = undefined;
			tile.upstream = [];
			tile.downstream = [];
			tile.sources = [];
		});
		
		// Recalculate drainage for basin tiles
		basin.forEach(tile => {
			tile.tiles.sort((a, b) => a.elevation - b.elevation);
			tile.drain = tile.tiles.filter(n => n.elevation < tile.elevation)[0];
		});
		
		// Also recalculate for tiles in escape route area that might be affected
		escapeRouteArea.forEach(tile => {
			if (tile.elevation > 0) {
				tile.tiles.sort((a, b) => a.elevation - b.elevation);
				tile.drain = tile.tiles.filter(n => n.elevation < tile.elevation)[0];
			}
		});
		
		// Recalculate upstream/downstream only for affected tiles (basin + escape area)
		let allAffectedTiles = [...basin, ...escapeRouteArea.filter(t => t.elevation > 0)];
		calculateUpstreamDownstreamForSpecificTiles(allAffectedTiles, basin);
	}
	
	// Helper to calculate upstream/downstream for specific tiles only
	function calculateUpstreamDownstreamForSpecificTiles(tilesToProcess, basinTiles) {
		// Initialize arrays for tiles being processed
		tilesToProcess.forEach(tile => {
			if (tile.elevation > 0) {
				tile.upstream = [];
				tile.downstream = [];
			}
		});
		
		// Calculate upstream and downstream relationships within this scope
		tilesToProcess.forEach(tile => {
			if (tile.elevation > 0 && tile.drain) {
				// Add current tile to downstream of what it drains into (if in scope)
				if (tilesToProcess.includes(tile.drain)) {
					if (!tile.drain.downstream) tile.drain.downstream = [];
					tile.drain.downstream.push(tile);
				}
				
				// Add upstream tiles within the basin
				let current = tile;
				while (current.drain && current.drain.elevation > 0 && basinTiles.includes(current.drain)) {
					if (!current.drain.upstream) current.drain.upstream = [];
					if (!current.drain.upstream.includes(tile)) {
						current.drain.upstream.push(tile);
					}
					current = current.drain;
					
					// Safety check to prevent infinite loops
					if (current === tile) break;
				}
			}
		});
	}

	// Helper function to validate drainage and report uphill flows
	function validateDrainage(tiles, context = '') {
		let uphillCount = 0;
		let issues = [];
		
		tiles.forEach(tile => {
			if (tile.elevation > 0 && tile.drain) {
				if (tile.drain.elevation >= tile.elevation) {
					uphillCount++;
					issues.push({
						tile: tile,
						tileElevation: tile.elevation,
						drainElevation: tile.drain.elevation,
						difference: tile.drain.elevation - tile.elevation
					});
				}
			}
		});
		
		if (uphillCount > 0) {
			console.log(`${context}: Found ${uphillCount} uphill drainage issues`);
			// Show worst cases for debugging
			issues.sort((a, b) => b.difference - a.difference);
			for (let i = 0; i < Math.min(5, issues.length); i++) {
				console.log(`  Tile ${issues[i].tile.id}: ${issues[i].tileElevation.toFixed(6)} -> ${issues[i].drainElevation.toFixed(6)} (uphill by ${issues[i].difference.toFixed(6)})`);
				issues[i].tile.error = 'uphill drainage';
			}
		} else {
			//console.log(`${context}: All drainage flows downhill ✓`);
		}
		
		return uphillCount;
	}

	function randomLocalMax() {
		let modifiedTiles = [];
		
		tiles.sort((a, b) => parseFloat(a.elevation) - parseFloat(b.elevation));
		for (let i = 0; i < tiles.length; i++) {
			tiles[i].tiles.sort((a, b) => parseFloat(a.elevation) - parseFloat(b.elevation));
		}
		for (let i = tiles.length - 1; i >= 0; i--) {
			if (tiles[i].elevation > 0) {
				if (tiles[i].elevation > tiles[i].tiles[0].elevation) { //if not local min
					if (tiles[i].elevation < tiles[i].tiles[tiles[i].tiles.length - 1].elevation) { //if not local max
						//console.log('try')
						if (tiles[i].id / Math.PI % 1 > 0.85) {
							//console.log('success')
							tiles[i].elevation = tiles[i].tiles[tiles[i].tiles.length - 1].elevation * 1.05 //make local max
							modifiedTiles.push(tiles[i]);
							//tiles[i].error = 'forcedmax'
						}
					}
				}
			}
		}
		
		// Use localized drainage recalculation for modified tiles
		if (modifiedTiles.length > 0) {
			let locallyAffectedTiles = new Set(modifiedTiles);
			
			// Add immediate neighbors that might be affected by elevation changes
			modifiedTiles.forEach(tile => {
				tile.tiles.forEach(neighbor => {
					if (neighbor.elevation > 0) {
						locallyAffectedTiles.add(neighbor);
					}
				});
			});
			
			// Also find tiles that were previously draining into the raised tiles
			let land = tiles.filter(t => t.elevation > 0);
			land.forEach(tile => {
				if (tile.drain && modifiedTiles.includes(tile.drain)) {
					locallyAffectedTiles.add(tile);
				}
			});
			
			// Use basin-scoped recalculation with the locally affected area
			recalculateBasinDrainage([...locallyAffectedTiles], []);
			//console.log(`randomLocalMax: Localized recalculation for ${modifiedTiles.length} raised tiles affecting ${locallyAffectedTiles.size} total tiles`);
		}
		
		tiles.sort((a, b) => parseFloat(a.elevation) - parseFloat(b.elevation));
		for (let i = 0; i < tiles.length; i++) {
			tiles[i].tiles.sort((a, b) => parseFloat(a.elevation) - parseFloat(b.elevation));
		}
	}
	function calculateUpstreamDownstream(tiles) {
		//console.log('calculateUpstreamDownstream')
		// Initialize upstream and downstream arrays for each tile
		tiles.forEach(tile => {
			if (tile.elevation > 0) {
				tile.upstream = [];
				tile.downstream = [];
			}
		});
	
		// Calculate upstream and downstream arrays
		tiles.forEach(tile => {
			if (tile.elevation > 0 && tile.drain) {
				// Add current tile to the downstream array of the tile it drains into
				if (tile.drain.elevation > 0) {
					//tile.drain.downstream.push(tile);
					tile.downstream.push(tile.drain);
				}
				if (tile === tile.drain.drain) {
					tile.error = 'self drain';
				}
				if (tile.drain.elevation >= tile.elevation) {
					tile.error = 'drain higher/equal elevation';
				}
	
				// Add all upstream tiles to the current tile's upstream array
				let current = tile;
				while (current.drain && current.drain.elevation > 0) {
					if (current.drain.upstream.length > current.body.tiles.length) {
						current.error='.drain.upstream.length > body';
						break;
					}
					if (current.drain.drain === current) {
						current.error='drain loop';
						break;
					}
					if (!current.drain.upstream.includes(tile)) {
						current.drain.upstream.push(tile);
					}
					current = current.drain;
				}
			}
		});
	
		// Recursively add downstream tiles to the downstream array
		function addDownstreamTiles(tile, downstreamTiles) {
			tile.downstream.forEach(downstreamTile => {
				if (!downstreamTiles.includes(downstreamTile)) {
					downstreamTiles.push(downstreamTile);
					addDownstreamTiles(downstreamTile, downstreamTiles);
				}
			});
		}
	
		// Populate downstream arrays with all downstream tiles
		tiles.forEach(tile => {
			if (tile.elevation > 0) {
				let downstreamTiles = [];
				addDownstreamTiles(tile, downstreamTiles);
				tile.downstream = downstreamTiles;
			}
		});
	}
	function newerDrain() {
		const runoffFraction = 0.1;
		const minRiver = 0.5*Math.max(...tiles.map(t => t.rain));
		const evapRatio = 0.25;
		let lakeCounter = 0;
		let lakes = [];
		let land = tiles.filter(t=>t.elevation>0);
		for (t of land) {
			t.tiles.sort((a, b) => parseFloat(a.elevation) - parseFloat(b.elevation));
			t.sources = [];
			t.drain = undefined;
			if (t.elevation > 0 && t.elevation > t.tiles[0].elevation) {
				t.drain = t.tiles[0]
			}
			t.log = '';
			t.lake = undefined;
			t.coast = undefined;
			t.dirty = true;
			t.inflow = 0;
			t.outflow = 0;
			t.upstream = [];
			t.downstream = [];
		}
		calculateUpstreamDownstream(land);

		// Validate initial drainage
		validateDrainage(land, 'Initial drainage');

		for (let i = 1; i <= 10; i++) {
			ctime("bowlLoop");

			let bowls = land.filter(t => t.downstream.length < 1 && !t.drain);
			bowls.sort((a, b) => parseFloat(b.elevation) - parseFloat(a.elevation));
			for (b of bowls) {
				let bowl = [];
				let bowlRim = [];
				let bowlRimOuter = [];
				let bowlRimEscapeOptions = [];
				let bowlEscapeRoute = undefined;
				if (b.upstream[0]) {
					bowl = [b,...b.upstream].sort((a, b) => parseFloat(a.elevation) - parseFloat(b.elevation));
					//console.log(bowl);
					bowlRim = bowl.filter(u => u.tiles.filter(n => !bowl.includes(n)).length > 0);
					//console.log(bowlRim);
					bowlRimOuter = [...new Set(bowlRim.map(br => br.tiles).flat().filter(bro=>!bowl.includes(bro)))];
					//console.log(bowlRimOuter);
					for (t of bowlRim) {
						for (o of bowlRimOuter.filter(o=>t.tiles.includes(o))) {
							bowlRimEscapeOptions.push({maxElevation: Math.max(t.elevation, o.elevation), routeA: t, routeB: o});
						}
					}
					bowlEscapeRoute = bowlRimEscapeOptions.sort((a, b) => a.maxElevation - b.maxElevation)[0];
					//console.log(bowlEscapeRoute);
					bowlRimLow = bowlRim.sort((a, b) => parseFloat(a.elevation) - parseFloat(b.elevation))[0];
					//bowlRimLow.error='rim';
					let bowlLake = bowl.filter(u => u.elevation <= bowlEscapeRoute.maxElevation);
					lakeCounter++;
					let newLake = lakes[lakes.push({id: lakeCounter, log: '', tiles: [...bowlLake], shore:[], sources:[], outflow:0, drain:undefined})-1];
					//console.log(newLake);
					lakeCleanup(newLake);
					bowlFill(newLake,bowlEscapeRoute);
				} else {
					let oldElevation = b.elevation;
					b.elevation = (b.tiles[0].elevation+b.tiles[1].elevation)/2+0.000001*b.id;
					
					// Use very localized drainage recalculation for single tile fix
					if (Math.abs(b.elevation - oldElevation) > 0.000001) {
						let locallyAffectedTiles = [b];
						
						// Add immediate neighbors
						b.tiles.forEach(neighbor => {
							if (neighbor.elevation > 0) {
								locallyAffectedTiles.push(neighbor);
							}
						});
						
						// Also add any tiles that were draining into this tile
						land.forEach(tile => {
							if (tile.drain === b) {
								locallyAffectedTiles.push(tile);
							}
						});
						
						// Use basin-scoped recalculation for this very small area
						recalculateBasinDrainage(locallyAffectedTiles, []);
					}
				}
			}		
			if (i===3) {
				ctime("randomLocalMax");
				randomLocalMax();
				ctimeEnd("randomLocalMax");
				validateDrainage(land, `After randomLocalMax (iteration ${i})`);
			}
			// Full recalculation only once per bowl loop iteration
			calculateUpstreamDownstream(land);
			land.sort((a, b) => a.upstream.length - b.upstream.length);
			for (t of land) {
				t.sources = t.tiles.filter(n => n.drain === t);
				t.inflow = t.sources.reduce((sum, n) => sum + (n.outflow || 0), 0);
				t.outflow = t.rain*runoffFraction + t.inflow;
			}

			validateDrainage(land, `End of bowlLoop iteration ${i}`);
			ctimeEnd("bowlLoop");
		}

		watershedBuilder();

		// Final drainage validation
		validateDrainage(land, 'Final drainage after newerDrain');

		function lakeCleanup(lake) {
			var tempNeighbors = [];
			for (t of lake.tiles) {
				t.lake = lake;
				tempNeighbors.push(...t.tiles);
			}
			lake.shore = tempNeighbors.filter(n => !lake.tiles.includes(n));
			lake.sources = lake.shore.filter(s => lake.tiles.includes(s.drain));
		}
		function bowlFill(lake,bowlEscapeRoute) {
			if (!lake.tiles.includes(bowlEscapeRoute.routeA)) {
				console.log('routeA not in lake', lake, bowlEscapeRoute);
				bowlEscapeRoute.routeA.error = 'routeA not in lake';
				return;
			}
			if (!lake.shore.includes(bowlEscapeRoute.routeB)) {
				throw('routeB not in shore', lake, bowlEscapeRoute.routeB);
			}

			const minE = bowlEscapeRoute.maxElevation;
			let backStop = lake.tiles.filter(t=>t.elevation>bowlEscapeRoute.maxElevation)[0];
			const maxE = minE+0.00001
			if (backStop) {
				const maxE = backStop.elevation;
			}

			let order = findMouthOrder(lake,bowlEscapeRoute.routeA);
			const step = (maxE-minE)/(lake.tiles.length+1);
			let j = 1;
			//console.log('step',step);
			for (o of order) {
				for (t of o) {
					t.sediment = 0;
					var eOld = t.elevation;
					t.elevation = minE+(step*(j+.0000000001*t.id));
					if (t.tiles.some(a => a.elevation === t.elevation)) {
						t.error = 'same elevation as neighbor, had to bump';
						t.elevation = t.elevation+.00000001*t.id;
					}
					t.sediment += t.elevation - eOld;
					j++;
					//console.log(t.elevation,t.tiles.map(n => n.elevation))
				}
			}
			// Use basin-scoped drainage recalculation - much more efficient!
			let basin = [...lake.tiles]; // The filled basin
			let escapeRouteArea = [...lake.shore]; // Shore tiles that form boundary
			
			// Add escape route neighbor to capture drainage boundary
			if (bowlEscapeRoute && bowlEscapeRoute.routeB && bowlEscapeRoute.routeB.elevation > 0) {
				escapeRouteArea.push(bowlEscapeRoute.routeB);
				// Also add neighbors of escape route to ensure proper boundary handling
				bowlEscapeRoute.routeB.tiles.forEach(neighbor => {
					if (neighbor.elevation > 0 && !escapeRouteArea.includes(neighbor)) {
						escapeRouteArea.push(neighbor);
					}
				});
			}
			
			// Use basin-scoped recalculation instead of full planet recalculation
			recalculateBasinDrainage(basin, escapeRouteArea);
			
			// Clear lake references
			lake.tiles.forEach(tile => {
				tile.lake = undefined;
			});
			lake.tiles=[];
			
			//console.log(`bowlFill: Basin-scoped recalculation for ${basin.length} basin tiles and ${escapeRouteArea.length} boundary tiles`);

			function findMouthOrder(lake,mouth) {
				var finished = [mouth];
				var order = [[mouth]];
				while (lake.tiles.filter(t => !finished.includes(t)).length>0) {
					const next = lake.tiles.filter(t => !finished.includes(t) && t.tiles.some(n => finished.includes(n)));
					order.push(next);
					finished.push(...next);
				}
				return order;
			}

		}
		function watershedBuilder() {
			watersheds = [];
			let watershedCount = 0;
			for (w of land.filter(t=> t.downstream.length < 1)) {
				watershedCount++;
				let ws = [w,...w.upstream];
				let i = watersheds.push({id: watershedCount, tiles: ws, color: undefined});
				for (t of ws) {
					t.watershed = watersheds[i-1];
				}
			}
			assignWatershedColors(watersheds, 6);
			
			if (watersheds.some(w=>!w.color)) {
				console.log(watersheds.filter(w=>!w.color));
			}

			for (w of watersheds.filter(w=>!w.color)) {
				w.color = new THREE.Color(0x000000);
			}
			function assignWatershedColors(watersheds, N) {
				var colors = [];
				//for (var i = 0; i < N; i++) {colors.push(new THREE.Color().setHSL((i) / (1.5*N), 1, 0.5));}
				//colors = [new THREE.Color(0xB2E59A), new THREE.Color(0xD7E98C), new THREE.Color(0xA3C282), new THREE.Color(0x8DB464), new THREE.Color(0x6F9B4B), new THREE.Color(0x51783D)];
				colors = [new THREE.Color(0xE2E8C6), new THREE.Color(0xB7C779), new THREE.Color(0x7D8A42), new THREE.Color(0xA67B5B), new THREE.Color(0x6F5A4D), new THREE.Color(0x4D3B2E)];

				var assignedColors = {};
				
				// Sort watersheds by the number of distinct neighboring watersheds in descending order
				watersheds.sort((a, b) => {
					var aNeighbors = [...new Set(a.tiles.map(t => t.tiles).flat().filter(n => !a.tiles.includes(n) && n.watershed && n.watershed !== a).map(n => n.watershed.id))].length;
					var bNeighbors = [...new Set(b.tiles.map(t => t.tiles).flat().filter(n => !b.tiles.includes(n) && n.watershed && n.watershed !== b).map(n => n.watershed.id))].length;
					return bNeighbors - aNeighbors;
				});
			
				for (var i = 0; i < watersheds.length; i++) {
					var watershed = watersheds[i];
					var watershedNeighbors = [...new Set(watershed.tiles.map(t => t.tiles).flat().filter(n => !watershed.tiles.includes(n) && n.watershed && n.watershed !== watershed))];
					var availableColors = colors.slice();
					for (var neighbor of watershedNeighbors) {
						if (neighbor.watershed && assignedColors[neighbor.watershed.id]) {
							var index = availableColors.indexOf(assignedColors[neighbor.watershed.id]);
							if (index !== -1) {
								availableColors.splice(index, 1);
							}
						}
					}
					watershed.color = availableColors[0];
					assignedColors[watershed.id] = watershed.color;
				}
			}
		}
	}
	function reMoisture() {
		var maxRain = Math.max(...tiles.map(element => element.rain));
		
		var shareFraction = 0.4;
		var shareIteration = 4;

		land = tiles.filter(t=>t.elevation>0);
		land.sort((a, b) => a.upstream.length - b.upstream.length);
		for (t of land) {
			t.moisture = Math.min(t.rain + 0.1 * t.inflow, maxRain * 1.2);
		};
		for (let i = 0; i < shareIteration; i++) {
			for (t of land) {
				t.moisture = Math.max(t.moisture,shareFraction*Math.max(...t.tiles.map(n => n.moisture)));
			}
		};
	}
	
	function redirectParallelRivers(landTiles) {
		// Simplified approach: find qualifying river tiles and raise their drain elevation to force redirection
		var flows = landTiles.filter(t => t.outflow > 0).sort((a, b) => parseFloat(a.outflow) - parseFloat(b.outflow));
		const riverThresholdValue = flows[Math.floor(flows.length * riverThreshold)].outflow;
		
		// Get all tiles that qualify as rivers
		let qualifyingRivers = landTiles.filter(t => t.outflow > riverThresholdValue && t.drain);
		
		console.log(`Processing ${qualifyingRivers.length} qualifying rivers for redirection`);
		
		let redirectionCount = 0;
		let modifiedElevations = []; // Track elevation changes
		
		let excludedTiles = new Set(); // Track tiles to skip
		
		// Process each qualifying river tile
		for (let i = 0; i < qualifyingRivers.length; i++) {
			let tile = qualifyingRivers[i];
			
			// Skip if this tile has been excluded due to a previous redirection
			if (excludedTiles.has(tile)) {
				continue;
			}
			
			// Check for neighboring river tiles that are neither upstream nor downstream
			let hasParallelNeighbor = false;
			for (let neighbor of tile.tiles) {
				if (qualifyingRivers.includes(neighbor) && !excludedTiles.has(neighbor)) {
					// Check if neighbor is upstream or downstream
					let isUpstream = tile.upstream && tile.upstream.includes(neighbor);
					let isDownstream = tile.downstream && tile.downstream.includes(neighbor);
					
					if (!isUpstream && !isDownstream) {
						hasParallelNeighbor = true;
						break;
					}
				}
			}
			
			if (hasParallelNeighbor) {
				// Mark for visual debugging
				//tile.error = 'parallel';
				
				// Store original elevation and raise drain elevation
				let originalElevation = tile.drain.elevation;
				modifiedElevations.push({ tile: tile.drain, original: originalElevation });
				
				// Raise drain elevation to force redirection
				tile.drain.elevation = tile.elevation + 0.01;
				redirectionCount++;
				
				// Remove all downstream tiles from consideration
				if (tile.downstream) {
					for (let downstreamTile of tile.downstream) {
						excludedTiles.add(downstreamTile);
					}
				}
			}
		}
		
		console.log(`Modified ${redirectionCount} drainage targets, recalculating drainage...`);
		
		// Recalculate drainage system to handle the elevation changes
		if (redirectionCount > 0) {
			// Recalculate drainage relationships
			newerDrain(landTiles);
			
			// Restore original elevations after drainage recalculation
			for (let modified of modifiedElevations) {
				modified.tile.elevation = modified.original;
			}
			
			console.log(`Drainage recalculation complete, restored original elevations`);
		}
	}
	
	// Removed - using tile.downstream.length directly
	
	// Helper functions removed - using simplified neighbor check
	
	
	// Removed - using tile.downstream directly
	
	// Helper function removed - no longer needed with simplified approach
}

function tileElevationProcs(tiles, action) {
	//random sign Math.random() < 0.5 ? -1 : 1
	for (var i = 0; i < tiles.length; ++i) {
		var tile = tiles[i];
		if (tile.shore == 0) {
			if (tile.elevation > 0) {
				if (Math.min.apply(0, tile.tiles.map((data) => data.elevation)) < 0) {
					tile.shore = 1
				}
			} else
				if (tile.elevation < 0) {
					if (Math.max.apply(0, tile.tiles.map((data) => data.elevation)) > 0) {
						tile.shore = -1
					}
				}
		}
	}
	var s = 1;
	while (!Math.min.apply(0, tiles.map((data) => Math.abs(data.shore))) > 0) {

		for (var i = 0; i < tiles.length; ++i) {
			var tile = tiles[i];
			//var ts = tile.tiles.map((data) => data.shore);

			if (Math.abs(tile.shore) == s) {
				for (var j = 0; j < tile.tiles.length; ++j) {
					if (tile.tiles[j].shore == 0) {
						if (tile.tiles[j].elevation > 0) {
							tile.tiles[j].shore = tile.shore + 1
						} else {
							tile.tiles[j].shore = tile.shore - 1
						}
					}
				}
			}
		}
		s += 1;
		//console.log('shore loop',s);
	}

	for (var i = 0; i < tiles.length; ++i) {
		var tile = tiles[i];
		//if (tile.shore == 1) {tile.shoreZ = -1}
		if (tile.shore == 2) {
			tile.shoreZ = 1
			for (var j = 0; j < tile.tiles.length; ++j) {
				if (tile.tiles[j].shore == 1 && tile.tiles[j].shoreZ == 0) {
					tile.tiles[j].shoreZ = -1
				}
			}
		}
	}
	//console.log('z')
	s = 1;
	while (!Math.min.apply(0, tiles.map((data) => Math.abs(data.shoreZ))) > 0 && s < tiles.length) {

		for (var i = 0; i < tiles.length; ++i) {
			var tile = tiles[i];
			//var ts = tile.tiles.map((data) => data.shoreZ);

			if (Math.abs(tile.shoreZ) == s) {
				for (var j = 0; j < tile.tiles.length; ++j) {
					if (tile.tiles[j].shoreZ == 0) {
						if (tile.tiles[j].shore > 2) {
							tile.tiles[j].shoreZ = tile.shoreZ + 1
						} else {
							tile.tiles[j].shoreZ = tile.shoreZ - 1
						}
					}
				}
			}
		}
		s += 1;
	}

	for (var i = 0; i < tiles.length; ++i) {
		var tile = tiles[i];
		if (tile.shore == -3) {
			tile.shoreA = -1
			for (var j = 0; j < tile.tiles.length; ++j) {
				if (tile.tiles[j].shoreA == 0) {
					if (tile.shoreA == -1 && tile.shore < tile.tiles[j].shore) {
						tile.tiles[j].shoreA = 1
					}
				}
			}
		}
	}
	s = 1;
	while (!Math.min.apply(0, tiles.map((data) => Math.abs(data.shoreA))) > 0 && s < tiles.length) {
		for (var i = 0; i < tiles.length; ++i) {
			var tile = tiles[i];
			if (tile.shore < -3 && tile.shoreA == 0) {
				tile.shoreA = tile.shore + 2
			}
			else if (tile.shoreA == s) {
				for (var j = 0; j < tile.tiles.length; ++j) {
					if (tile.tiles[j].shoreA == 0) {
						//if (tile.tiles[j].shore > tile.shore) {
						tile.tiles[j].shoreA = tile.shoreA + 1
						//} else {
						//	tile.tiles[j].shoreA = tile.shoreA - 1
						//}
					}
				}
			}
		}
		s += 1;
	}
}

function generatePlanetBiomesResources(tiles, planetRadius, action) {
	tiles.sort((a, b) => parseFloat(b.elevation) - parseFloat(a.elevation));
	var flows = tiles.filter(t => t.outflow > 0).sort((a, b) => parseFloat(a.outflow) - parseFloat(b.outflow));
	var flowThreshold = flows[Math.floor(flows.length * riverThreshold)].outflow;
	var seaTemps = tiles.filter(t => t.elevation < 0).sort((a, b) => parseFloat(a.temperature) - parseFloat(b.temperature));
	var optimalTemp = seaTemps[Math.floor(seaTemps.length * .4)].temperature;
	const fibVectors = generateEvenVectors(Math.floor(Math.pow(tiles.length,0.5)), 1000)
	//console.log(fibVectors);
	function calculateAngleBetweenVectors(v1, v2) {
		// Calculate the dot product of the vectors
		const dotProduct = v1.dot(v2);
	
		// Calculate the magnitudes of the vectors
		const magnitudeV1 = v1.length();
		const magnitudeV2 = v2.length();
	
		// Calculate the cosine of the angle
		const cosTheta = dotProduct / (magnitudeV1 * magnitudeV2);
	
		// Calculate the angle in radians
		let angle = Math.acos(cosTheta);
	
		// Ensure the angle is between -pi and pi
		if (v1.cross(v2).z < 0) {
			angle = -angle;
		}
	
		return angle;
	}

	function generateEvenVectors(N, M) {
		const vectors = [];
		const goldenRatio = (1 + Math.sqrt(5)) / 2;
		const angleIncrement = Math.PI * 2 * goldenRatio;
	
		for (let i = 0; i < N; i++) {
			const t = i / N;
			const inclination = Math.acos(1 - 2 * t);
			const azimuth = angleIncrement * i;
	
			const x = Math.sin(inclination) * Math.cos(azimuth);
			const y = Math.sin(inclination) * Math.sin(azimuth);
			const z = Math.cos(inclination);
	
			const vector = new THREE.Vector3(x, y, z);
			vector.multiplyScalar(M);
	
			vectors.push(vector);
		}
	
		return vectors;
	}
	function findClosestVector(inputVector, vectorArray) {
		if (vectorArray.length === 0) {
			throw new Error('Vector array is empty');
		}
	
		let closestVector = vectorArray[0];
		let minDistance = inputVector.distanceTo(closestVector);
	
		for (let i = 1; i < vectorArray.length; i++) {
			const currentDistance = inputVector.distanceTo(vectorArray[i]);
			
			if (currentDistance < minDistance) {
				minDistance = currentDistance;
				closestVector = vectorArray[i];
			}
		}
	
		return minDistance;
	}
	let maxDist = 1;

	for (t of tiles) {
		t.fibNoise = findClosestVector(t.position, fibVectors);
		if (t.fibNoise > maxDist) {
			maxDist = t.fibNoise;
		}		t.wheat = 0;
		t.corn = 0;
		t.rice = 0;
		t.fish = 0;
		t.pasture = 0;
		t.timber =0;
		t.calories = 0;
		t.iron = 0;
		t.bauxite = 0;
		t.oil = 0;
		t.gold = 0;
		t.copper = 0;
	}
	
	for (t of tiles) {
		t.fibNoise = 1 - t.fibNoise / maxDist;
	}

	for (var i = 0; i < tiles.length; ++i) {
		var tile = tiles[i];
		var elevation = Math.max(0, tile.elevation);
		tile.slope = Math.max(...tile.tiles.map(n => Math.abs(tile.elevation - n.elevation)));
		tile.latitudeAbs = Math.asin(Math.abs(tile.position.y) / planetRadius)/(Math.PI/2);
		var temperature = tile.temperature;
		var distanceToPlateBoundary = Math.min(...tile.corners.map(c => c.distanceToPlateBoundary));
		
		if (elevation <= 0) {
			if (temperature > 0) {
				tile.biome = "ocean";
				let hemisphere = Math.sign(tile.averagePosition.y);
				let higherShoreNeighbors = tile.tiles.filter(n => n.shore > tile.shore);
				let shoreVector = higherShoreNeighbors.reduce((acc, n) => {
					let vector = n.position.clone().sub(tile.position);
					return acc.add(vector);
				}, new THREE.Vector3()).divideScalar(higherShoreNeighbors.length);
				let airCurrent = tile.corners.reduce((acc, corner) => {
					return acc.add(corner.airCurrent);
				}, new THREE.Vector3()).divideScalar(tile.corners.length);
				let angle = calculateAngleBetweenVectors(shoreVector, airCurrent);
				let nearShore = [...tile.tiles.map(n => Math.min(-1,n.shore))].reduce((sum, num) => sum - num, 0);
				//if (tile.shore > -3) {
					//not sure why z matters, I think because the sign of the angle difference switches
					tile.fish = 0.1*tile.slope+7*Math.max(0,Math.sin(angle)*(-Math.sign(tile.averagePosition.y)*Math.sign(tile.averagePosition.z)))/nearShore+0.1*(1-Math.pow(temperature-optimalTemp,2));
				//}
			} else {
				tile.biome = "seaIce";
			}
		} else if (tile.elevation > 0.9 || tile.temperature < 0 || (tile.temperature < 0 && (Math.min(tile.moisture, 1) > 0.45 || (tile.drain && tile.outflow > flowThreshold)))) { //
			tile.biome = "glacier";
		} else if (tile.lake) {
			tile.biome = "lake";
			tile.fish = tile.upstream.length/20;
		} else if (tile.drain) {
			// Check if any individual inflow (not total) exceeds threshold
			var hasSignificantInflow = false;
			var significantSources = [];
			
			if (tile.sources && tile.sources.length > 0) {
				for (var source of tile.sources) {
					if (source.outflow > flowThreshold) {
						hasSignificantInflow = true;
						significantSources.push(source);
					}
				}
			}
			
			if (hasSignificantInflow) {
				tile.river = true;
				tile.riverSources = significantSources; // Store which sources qualify for rendering
				tile.fish = Math.max(.125,Math.min(.25,tile.upstream.length/20))+Math.min(.75,(tile.upstream.length/(tile.downstream.length+1))/45);
			}
		} else {
			if (tile.elevation <= 0.8 && tile.elevation >= 0 && tile.lake === undefined && tile.temperature > 0.2) {
				tile.wheat = Math.round(100 * Math.max(0, 1 - 2 * (Math.abs(tile.temperature - .3) + Math.abs(tile.moisture - .3))));
			}
			if (tile.elevation <= 0.6 && tile.elevation >= 0 && tile.lake === undefined && tile.temperature > 0.4 && tile.moisture >= 0.1) {
				tile.corn = Math.round(100 * Math.max(0, 1 - 2 * (Math.abs(tile.temperature - .6) + Math.abs(tile.moisture - .4))));
			}
			if (tile.elevation <= 0.6 && tile.elevation >= 0 && tile.lake === undefined && tile.temperature >= .5 && tile.moisture >= 0.2) {
				tile.rice = Math.round(100 * (Math.pow(nrm(tile.temperature, 'logistic', .9, 7), 3) * Math.pow(nrm(tile.moisture, 'logistic', .6, 7), 3)));
			}
			if (tile.elevation <= 0.9) {
				tile.pasture = tile.moisture*2;
			}
			if (tile.temperature > 0.2 && tile.elevation < 0.8) {
				tile.timber = tile.moisture;
			}

			if (tile.elevation > 0.6) {
				tile.gold = tile.fibNoise * (1-5*Math.abs(tile.elevation-0.8)) / Math.max(1,Math.pow(distanceToPlateBoundary,3));
			} else if (tile.elevation > 0.4) {
				tile.iron = Math.abs(0.5-tile.fibNoise) / Math.max(1,Math.pow(distanceToPlateBoundary,5));
			}
			tile.oil = (1-tile.fibNoise) * Math.max(0,1-Math.pow(tile.slope,0.125)-tile.moisture);
			tile.bauxite = (tile.fibNoise) * Math.max(0,tile.slope*tile.moisture*tile.temperature);
			tile.copper = (10 / (1 + Math.exp(-0.003 * (tile.elevation - 1200)))) *
				(1 / (1 + Math.exp(-0.1 * (tile.temperature - 20)))) *
				Math.exp(-0.2 * distanceToPlateBoundary) *
				Math.exp(-0.002 * tile.rain);
		}
		tile.calories = Math.max(0, tile.wheat * 7, tile.corn * 15, tile.rice * 11, tile.pasture*1000,tile.fish*1300);
	}
		
	//}
	for (t of tiles.filter(t => t.upstream)) {
		t.upstreamCalories = t.upstream.reduce((s, v) => s + v.calories, 0)
	}
	
	
	const percentiles = {
		iron: 90,
		oil: 95,
		bauxite: 98,
		copper: 97,
		gold: 99
	};

	function normalizeTiles(tiles, percentiles) {
		if (!tiles || tiles.length === 0) return [];

		for (const attr in percentiles) {
			const perc = percentiles[attr];
			const values = tiles.map(tile => tile[attr]);
			const sorted = [...values].sort((a, b) => a - b);
			const index = Math.floor((perc / 100) * (sorted.length - 1));
			const pVal = sorted[index];
			const maxVal = Math.max(...values);

			for (const tile of tiles) {
			if (maxVal === pVal) {
				tile[attr] = tile[attr] >= maxVal ? 1.0 : 0.0;
			} else {
				tile[attr] = Math.max(0, Math.min(1, (tile[attr] - pVal) / (maxVal - pVal)));
			}
			}
		}

		//return tiles;
	}
	normalizeTiles(tiles.filter(t => t.elevation > 0), percentiles);
	
	const weights = {
		calories: 1,
		iron: 10,
		oil: 20,
		bauxite: 10,
		copper: 25,
		gold: 100
	};

	function sumUpstreamWeights(tiles, weights) {
		for (const tile of tiles) {
			let sum = 0;

			for (const upstreamTile of tile.upstream || []) {
				for (const attr in weights) {
					if (typeof upstreamTile[attr] === 'number') {
					sum += upstreamTile[attr] * weights[attr];
					}
				}
			}

			tile.upstreamWeight = sum;
		}
	}

	sumUpstreamWeights(tiles.filter(t => t.elevation > 0), weights);
	normalizeTiles(tiles.filter(t => t.elevation > 0), {upstreamWeight: 0});
	/* 

		//fish color		
		var fishColor = terrainColor.clone()
		if (tile.elevation < 0 && tile.biome != "seaIce"&&tile.shore>-5) {// && tile.elevation >= -0.2) {
			tile.fish = 100-100*Math.pow(Math.abs(tile.elevation+0.2),0.15);
			fishColor = fishColor.lerp(new THREE.Color(0xFF00FF), tile.fish / 100);
		}
		var calorieColor = terrainColor.clone()
		calorieColor = calorieColor.lerp(new THREE.Color(0xFF00FF), tile.calories / 1500);

		
		function assignResourceDeposits(tiles) {
			tiles.forEach(tile => {
				if (tile.elevation > 0) { // Only assign resources to land tiles
					// Gold deposits are often found in mountainous regions and near plate boundaries
					tile.goldDeposits = (tile.elevation > 0.5 && tile.plate.boundaryBorders.length > 0) ? Math.random() * 100 : 0;
		
					// Iron ore deposits are often found in ancient geological formations, typically away from plate boundaries
					tile.ironOreDeposits = (tile.elevation > 0.3 && tile.plate.boundaryBorders.length === 0) ? Math.random() * 200 : 0;
		
					// Oil deposits are often found in sedimentary basins, typically in low elevation areas
					tile.oilDeposits = (tile.elevation < 0.2 && tile.moisture > 0.5) ? Math.random() * 50 : 0;
		
					// Aluminum ore deposits (bauxite) are often found in tropical regions with high moisture
					tile.aluminumOreDeposits = (tile.moisture * tile.temperature) ? Math.random() * 150 : 0;
				} else {
					tile.goldDeposits = 0;
					tile.ironOreDeposits = 0;
					tile.oilDeposits = 0;
					tile.aluminumOreDeposits = 0;
				}
			});
		}
			*/
}
