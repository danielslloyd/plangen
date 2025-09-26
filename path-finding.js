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

    const pathFinder = ngraphPath.aStar(planet.graph, {
        oriented: true,
        distance(fromNode, toNode, link) {
            return link.data.weight;
        }
    });

    const foundPath = pathFinder.find(goalTile.id, startTile.id);
    const path = foundPath.map(node => planet.topology.tiles.find(tile => tile.id === node.id));

    let totalCost = 0;
    for (let i = 0; i < foundPath.length - 1; i++) {
        const fromId = foundPath[i].id;
        const toId = foundPath[i + 1].id;
        const links = [...planet.graph.getLinks(fromId)];
        const link = links.find(l => l.toId === toId);
        if (link) {
			//console.log(link.data.weight);
            totalCost += link.data.weight;
        }
    }

    //console.log("Actual Path Cost (graph weights):", totalCost);
    ctimeEnd("aStarPathfinding");

    return path;
}

function setDistances(planet, action) {
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
            const vector = toTile.position.clone().sub(fromTile.position);
            const normalizedWind = Math.pow(Math.min(1, Math.max(0, wind.length() / maxWind)), 1);
            const pos = sailSpeedFactor(pointofSailInDegrees(vector, wind.clone().negate()));
            cost = Math.min(5, Math.max(.5, 10 / (20 * normalizedWind * Math.max(.2,pos))));
            const vectorRev = fromTile.position.clone().sub(toTile.position);
            const posRev = sailSpeedFactor(pointofSailInDegrees(vector.clone().negate(), wind.clone().negate()));
            reverseCost = Math.min(5, Math.max(.5, 10 / (20 * normalizedWind * Math.max(.2,posRev))));
        } else {
            cost = reverseCost = 100;
        }
        planet.aStarEdges.push({ from: fromTile, to: toTile, cost: cost, reverseCost: reverseCost });
    }
    planet.graph = buildGraph(planet.aStarVertices, planet.aStarEdges);

}

function pointofSailInDegrees(v1, v2) {

    // Calculate the dot product of the vectors
    const dotProduct = v1.dot(v2);

    // Calculate the magnitudes of the vectors
    const magV1 = v1.length();
    const magV2 = v2.length();

    // Calculate the cosine of the angle
    const cosTheta = dotProduct / (magV1 * magV2);

    // Calculate the angle in radians
    const angleInRadians = Math.acos(cosTheta);

    // Convert the angle to degrees
    const angleInDegrees = angleInRadians * (180 / Math.PI);

    return angleInDegrees;
}

function sailSpeedFactor(t) {
	return Math.min(1,Math.max(0,-0.000000000226*Math.pow(t,5)+0.000000123805*Math.pow(t,4)-0.000024472499*Math.pow(t,3)+0.001992907194*Math.pow(t,2)-0.044968355344*t-0.151735480749));

}

