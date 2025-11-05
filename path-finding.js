function setFromVertex(event) {
    if (planet) {
        var mouse = new THREE.Vector2();
        mouse.x = mouseX;
        mouse.y = mouseY;

        if (projectionMode === "mercator") {
            // Use same Mercator coordinate transformation as click handler
            var left = camera.left;
            var right = camera.right;
            var top = camera.top;
            var bottom = camera.bottom;

            var worldX = 2*mercatorCameraX + (mouse.x * (right - left)) / 2;
            var worldY = 2*mercatorCameraY + (mouse.y * (top - bottom)) / 2;

            var mercatorX = worldX / 2.0;
            var mercatorY = worldY / 2.0;

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

            // Ignore glacier and sea ice tiles
            if (closestTile && closestTile.biome !== "glacier" && closestTile.biome !== "seaIce") {
                fromVertex = closestTile;
            }
        } else {
            // Use original 3D raycasting for globe mode
            var raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(mouse, camera);

            var intersection = planet.partition.intersectRay(raycaster.ray);
            if (intersection !== false) {
                // Ignore glacier and sea ice tiles
                if (intersection.biome !== "glacier" && intersection.biome !== "seaIce") {
                    fromVertex = intersection;
                } else {
                    fromVertex = null;
                }
            } else {
                fromVertex = null;
            }
        }

        if (fromVertex && toVertex) {
            path = aStarPathfinding(fromVertex, toVertex, planet);
            if (path) {
                renderPath(path);
            } else {
                console.log('No path found');
                renderPath([]);
            }
        }
    }
}

function setToVertex(event) {
    if (planet) {
        var mouse = new THREE.Vector2();
        mouse.x = mouseX;
        mouse.y = mouseY;

        if (projectionMode === "mercator") {
            // Use same Mercator coordinate transformation as click handler
            var left = camera.left;
            var right = camera.right;
            var top = camera.top;
            var bottom = camera.bottom;

            var worldX = 2*mercatorCameraX + (mouse.x * (right - left)) / 2;
            var worldY = 2*mercatorCameraY + (mouse.y * (top - bottom)) / 2;

            var mercatorX = worldX / 2.0;
            var mercatorY = worldY / 2.0;

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

            // Ignore glacier and sea ice tiles
            if (closestTile && closestTile.biome !== "glacier" && closestTile.biome !== "seaIce") {
                toVertex = closestTile;
            }
        } else {
            // Use original 3D raycasting for globe mode
            var raycaster = new THREE.Raycaster();
            raycaster.setFromCamera(mouse, camera);

            var intersection = planet.partition.intersectRay(raycaster.ray);
            if (intersection !== false) {
                // Ignore glacier and sea ice tiles
                if (intersection.biome !== "glacier" && intersection.biome !== "seaIce") {
                    toVertex = intersection;
                } else {
                    toVertex = null;
                }
            } else {
                toVertex = null;
            }
        }

        if (fromVertex && toVertex) {
            path = aStarPathfinding(fromVertex, toVertex, planet);
            if (path) {
                renderPath(path);
            } else {
                console.log('No path found');
                renderPath([]);
            }
        }
    }
}

function aStarPathfinding(startTile, goalTile, planet) {
    ctime("aStarPathfinding");

    // Create a fast lookup map for tiles by ID
    const tileById = {};
    for (let i = 0; i < planet.topology.tiles.length; i++) {
        const tile = planet.topology.tiles[i];
        tileById[tile.id] = tile;
    }

    // Calculate average tile distance (used for heuristic estimation)
    let avgTileDistance = 0.08; // Default estimate for subdivision 60
    if (planet.topology.borders && planet.topology.borders.length > 0) {
        let totalDist = 0;
        let count = 0;
        for (let i = 0; i < Math.min(100, planet.topology.borders.length); i++) {
            const border = planet.topology.borders[i];
            if (border.tiles && border.tiles.length === 2) {
                totalDist += border.tiles[0].position.distanceTo(border.tiles[1].position);
                count++;
            }
        }
        if (count > 0) {
            avgTileDistance = totalDist / count;
        }
    }

    const pathFinder = ngraphPath.aStar(planet.graph, {
        oriented: true,
        distance(fromNode, toNode, link) {
            return link.data.weight;
        },
        heuristic(fromNode, toNode) {
            // Custom heuristic that accounts for potential river travel
            const fromTile = tileById[fromNode.id];
            const toTile = tileById[toNode.id];

            if (!fromTile || !toTile) {
                return 0;
            }

            // Calculate straight-line distance
            const straightLineDistance = fromTile.position.distanceTo(toTile.position);

            // Estimate number of tiles to traverse
            const estimatedTileCount = straightLineDistance / avgTileDistance;

            // Use optimistic cost assumption:
            // Assume best-case scenario of river downstream travel (cost = 1)
            // This is admissible (never overestimates) because:
            // 1. River downstream is the cheapest possible travel (cost 1)
            // 2. Any actual path will have cost >= this estimate
            // 3. This encourages exploring paths that might reach rivers
            const optimisticCost = estimatedTileCount * 1.0;

            return optimisticCost;
        }
    });

    const foundPath = pathFinder.find(goalTile.id, startTile.id);
    const path = foundPath.map(node => planet.topology.tiles.find(tile => tile.id === node.id));

    let totalCost = 0;
    let riverTiles = 0;
    let oceanTiles = 0;
    let landTiles = 0;

    for (let i = 0; i < foundPath.length - 1; i++) {
        const fromId = foundPath[i].id;
        const toId = foundPath[i + 1].id;
        const links = [...planet.graph.getLinks(fromId)];
        const link = links.find(l => l.toId === toId);
        if (link) {
            totalCost += link.data.weight;
        }
    }

    // Count terrain types in path
    for (let i = 0; i < path.length; i++) {
        const tile = path[i];
        if (tile.river) riverTiles++;
        else if (tile.elevation < 0) oceanTiles++;
        else landTiles++;
    }

    console.log("Path found: " + path.length + " tiles, cost: " + totalCost.toFixed(1) +
                " (River: " + riverTiles + ", Ocean: " + oceanTiles + ", Land: " + landTiles + ")");
    ctimeEnd("aStarPathfinding");

    return path;
}

function setDistances(planet, action, sailingCostConstant) {
    planet.aStarVertices = [];
    for (let i = 0; i < planet.topology.tiles.length; i++) {
        const tile = planet.topology.tiles[i];
        // Exclude glacier and sea ice tiles from pathfinding graph
        if (tile.biome !== "glacier" && tile.biome !== "seaIce") {
            planet.aStarVertices.push(tile);
        }
    }
    var maxWind = Math.max(...planet.topology.corners.map(c => c.airCurrent.length()));
    planet.aStarEdges = [];
    for (let i = 0; i < planet.topology.borders.length; i++) {
        const edge = planet.topology.borders[i];
        const fromTile = edge.tiles[0];
        const toTile = edge.tiles[1];

        // Skip edges that connect to/from glacier or sea ice tiles
        if (fromTile.biome === "glacier" || fromTile.biome === "seaIce" ||
            toTile.biome === "glacier" || toTile.biome === "seaIce") {
            continue;
        }
        const deltaElevation = toTile.elevation - fromTile.elevation;

        // Calculate wind from the shared border corners (for ocean sailing)
        let borderWind = new THREE.Vector3(0, 0, 0);
        if (edge.corners && edge.corners.length === 2) {
            // Average the air currents at the two corners of the shared border
            borderWind = edge.corners[0].airCurrent.clone().add(edge.corners[1].airCurrent).divideScalar(2);
        }

        // Keep old wind calculation for backward compatibility with other movement types
        const wind = edge.tiles.reduce((acc, tile) => {
            let tileAirCurrent = tile.corners.reduce((cornerAcc, corner) => {
                return cornerAcc.add(corner.airCurrent);
            }, new THREE.Vector3()).divideScalar(tile.corners.length);
            return acc.add(tileAirCurrent);
        }, new THREE.Vector3()).divideScalar(edge.tiles.length);
        
		let cost = 100;
		let reverseCost = 100;

		const isRiver = tile => tile.river === true;
		const isOcean = tile => tile.elevation < 0;
		const isLand = tile => tile.elevation >= 0 && !tile.river;

		const fromIsRiver = isRiver(fromTile);
		const toIsRiver = isRiver(toTile);
		const fromIsOcean = isOcean(fromTile);
		const toIsOcean = isOcean(toTile);
		const fromIsLand = isLand(fromTile);
		const toIsLand = isLand(toTile);
		
		if (fromIsRiver && toIsRiver) {
			// River to Ocean or Downriver: cost = 1
			if (fromTile.drain === toTile) {//if ((fromIsRiver && toIsOcean) || (fromIsRiver && toIsRiver && fromTile.downstream?.includes(toTile))) {
				cost = 1;
				reverseCost = 3;
			}
			// Ocean to River or Upriver: cost = 5
			else if (toTile.drain === fromTile) {//((fromIsOcean && toIsRiver) || (fromIsRiver && toIsRiver && toTile.downstream?.includes(fromTile))) {
				cost = 3;
				reverseCost = 1;
			}
			// River crossing: cost = 25
			const crossPoints = edge.corners.flatMap(corner => corner.tiles).filter(tile => !edge.tiles.includes(tile));
			if (crossPoints[0].elevation > 0 && !crossPoints[0].river && crossPoints[1].elevation > 0 && !crossPoints[1].river) {
				planet.aStarEdges.push({ from: crossPoints[0], to: crossPoints[1], cost: 25, reverseCost: 25 });
			}
		}
		else if (fromIsRiver && toIsOcean) {
			// River to Ocean or Downriver: cost = 1
			if (fromTile.drain === toTile) {//if ((fromIsRiver && toIsOcean) || (fromIsRiver && toIsRiver && fromTile.downstream?.includes(toTile))) {
				cost = 1;
				reverseCost = 3;
			}
		}
		else if (fromIsOcean && toIsRiver) {
			// Ocean to River or Upriver: cost = 5
			if (toTile.drain === fromTile) {//((fromIsOcean && toIsRiver) || (fromIsRiver && toIsRiver && toTile.downstream?.includes(fromTile))) {
				cost = 3;
				reverseCost = 1;
			}
		}
		// River-Land or Land-River: high penalty
		else if ((fromIsRiver && toIsLand) || (fromIsLand && toIsRiver)) {
			cost = reverseCost = 30;
		}
		else if (fromTile.elevation > 0 && toTile.elevation > 0) {
            if (deltaElevation <= 0) {
                cost = 5 + 1000 * Math.pow(deltaElevation, 2);
                reverseCost = 5 + 4000 * Math.pow(deltaElevation, 2);
            } else {
                cost = 5 + 4000 * Math.pow(deltaElevation, 2);
                reverseCost = 5 + 1000 * Math.pow(deltaElevation, 2);
            }
        } else if (fromIsOcean && toIsOcean) {
            // New sailing cost calculation using border wind and piecewise speed function
            const sailingDirection = toTile.position.clone().sub(fromTile.position);
            const windMagnitude = borderWind.length();

            // Calculate angle between sailing direction and wind (0° = into wind)
            let angleRad = sailingDirection.angleTo(borderWind);
            let angleDeg = angleRad * (180 / Math.PI);

            // Ensure we measure the acute angle (0-180°) since direction doesn't matter
            if (angleDeg > 180) angleDeg = 360 - angleDeg;

            // Calculate speed using new piecewise function
            const speed = newSailSpeedFactor(angleDeg, windMagnitude);
            cost = speed > 0 ? Math.min(5, Math.max(0.5, sailingCostConstant / speed)) : 100;

            // Reverse direction (same wind, opposite sailing direction)
            const reverseSailingDirection = fromTile.position.clone().sub(toTile.position);
            let reverseAngleRad = reverseSailingDirection.angleTo(borderWind);
            let reverseAngleDeg = reverseAngleRad * (180 / Math.PI);

            if (reverseAngleDeg > 180) reverseAngleDeg = 360 - reverseAngleDeg;

            const reverseSpeed = newSailSpeedFactor(reverseAngleDeg, windMagnitude);
            reverseCost = reverseSpeed > 0 ? Math.min(5, Math.max(0.5, sailingCostConstant / reverseSpeed)) : 100;
        } else {
            cost = reverseCost = 100;
        }
        planet.aStarEdges.push({ from: fromTile, to: toTile, cost: cost, reverseCost: reverseCost });
    }
    planet.graph = buildGraph(planet.aStarVertices, planet.aStarEdges);

}

function newSailSpeedFactor(beta, windMagnitude) {
    if (beta < 35) {
        return (-0.0000888354 * beta * beta + 0.0101160932 * beta + 0.2459200009) * windMagnitude;
    } else if (beta < 135) {
        return (-0.0001128856 * beta * beta + 0.0230066678 * beta - 0.1757887169) * windMagnitude;
    } else { // 135 <= beta <= 180
        return (-0.0000329694 * beta * beta + 0.0110822216 * beta - 0.0224612460) * windMagnitude;
    }
}

