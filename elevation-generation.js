function identifyBoundaryBorders(borders, action) {
	for (var i = 0; i < borders.length; ++i) {
		var border = borders[i];
		if (border.tiles[0].plate !== border.tiles[1].plate) {
			border.betweenPlates = true;
			border.corners[0].betweenPlates = true;
			border.corners[1].betweenPlates = true;
			border.tiles[0].plate.boundaryBorders.push(border);
			border.tiles[1].plate.boundaryBorders.push(border);
		}
	}
}

function collectBoundaryCorners(corners, action) {
	var boundaryCorners = [];
	for (var j = 0; j < corners.length; ++j) {
		var corner = corners[j];
		if (corner.betweenPlates) {
			boundaryCorners.push(corner);
			corner.tiles[0].plate.boundaryCorners.push(corner);
			if (corner.tiles[1].plate !== corner.tiles[0].plate) corner.tiles[1].plate.boundaryCorners.push(corner);
			if (corner.tiles[2].plate !== corner.tiles[0].plate && corner.tiles[2].plate !== corner.tiles[1].plate) corner.tiles[2].plate.boundaryCorners.push(corner);
		}
	}

	action.provideResult(boundaryCorners);
}

function calculatePlateBoundaryStress(boundaryCorners, action) {
	var boundaryCornerInnerBorderIndexes = new Array(boundaryCorners.length);
	for (var i = 0; i < boundaryCorners.length; ++i) {
		var corner = boundaryCorners[i];
		corner.distanceToPlateBoundary = 0;

		var innerBorder;
		var innerBorderIndex;
		for (var j = 0; j < corner.borders.length; ++j) {
			var border = corner.borders[j];
			if (!border.betweenPlates) {
				innerBorder = border;
				innerBorderIndex = j;
				break;
			}
		}

		if (innerBorder) {
			boundaryCornerInnerBorderIndexes[i] = innerBorderIndex;
			var outerBorder0 = corner.borders[(innerBorderIndex + 1) % corner.borders.length];
			var outerBorder1 = corner.borders[(innerBorderIndex + 2) % corner.borders.length]
			var farCorner0 = outerBorder0.oppositeCorner(corner);
			var farCorner1 = outerBorder1.oppositeCorner(corner);
			var plate0 = innerBorder.tiles[0].plate;
			var plate1 = outerBorder0.tiles[0].plate !== plate0 ? outerBorder0.tiles[0].plate : outerBorder0.tiles[1].plate;
			var boundaryVector = farCorner0.vectorTo(farCorner1);
			var boundaryNormal = boundaryVector.clone().cross(corner.position);
			var stress = calculateStress(plate0.calculateMovement(corner.position), plate1.calculateMovement(corner.position), boundaryVector, boundaryNormal);
			corner.pressure = stress.pressure;
			corner.shear = stress.shear;
		} else {
			boundaryCornerInnerBorderIndexes[i] = null;
			var plate0 = corner.tiles[0].plate;
			var plate1 = corner.tiles[1].plate;
			var plate2 = corner.tiles[2].plate;
			var boundaryVector0 = corner.corners[0].vectorTo(corner);
			var boundaryVector1 = corner.corners[1].vectorTo(corner);
			var boundaryVector2 = corner.corners[2].vectorTo(corner);
			var boundaryNormal0 = boundaryVector0.clone().cross(corner.position);
			var boundaryNormal1 = boundaryVector1.clone().cross(corner.position);
			var boundaryNormal2 = boundaryVector2.clone().cross(corner.position);
			var stress0 = calculateStress(plate0.calculateMovement(corner.position), plate1.calculateMovement(corner.position), boundaryVector0, boundaryNormal0);
			var stress1 = calculateStress(plate1.calculateMovement(corner.position), plate2.calculateMovement(corner.position), boundaryVector1, boundaryNormal1);
			var stress2 = calculateStress(plate2.calculateMovement(corner.position), plate0.calculateMovement(corner.position), boundaryVector2, boundaryNormal2);

			corner.pressure = (stress0.pressure + stress1.pressure + stress2.pressure) / 3;
			corner.shear = (stress0.shear + stress1.shear + stress2.shear) / 3;
		}
	}

	action.provideResult(boundaryCornerInnerBorderIndexes);
}

function calculateStress(movement0, movement1, boundaryVector, boundaryNormal) {
	var relativeMovement = movement0.clone().sub(movement1);
	var pressureVector = relativeMovement.clone().projectOnVector(boundaryNormal);
	var pressure = pressureVector.length();
	if (pressureVector.dot(boundaryNormal) > 0) pressure = -pressure;
	var shear = relativeMovement.clone().projectOnVector(boundaryVector).length();
	return {
		pressure: 2 / (1 + Math.exp(-pressure / 30)) - 1,
		shear: 2 / (1 + Math.exp(-shear / 30)) - 1
	};
}

function blurPlateBoundaryStress(boundaryCorners, stressBlurIterations, stressBlurCenterWeighting, action) {
	var newCornerPressure = new Array(boundaryCorners.length);
	var newCornerShear = new Array(boundaryCorners.length);
	for (var i = 0; i < stressBlurIterations; ++i) {
		for (var j = 0; j < boundaryCorners.length; ++j) {
			var corner = boundaryCorners[j];
			var averagePressure = 0;
			var averageShear = 0;
			var neighborCount = 0;
			for (var k = 0; k < corner.corners.length; ++k) {
				var neighbor = corner.corners[k];
				if (neighbor.betweenPlates) {
					averagePressure += neighbor.pressure;
					averageShear += neighbor.shear;
					++neighborCount;
				}
			}
			newCornerPressure[j] = corner.pressure * stressBlurCenterWeighting + (averagePressure / neighborCount) * (1 - stressBlurCenterWeighting);
			newCornerShear[j] = corner.shear * stressBlurCenterWeighting + (averageShear / neighborCount) * (1 - stressBlurCenterWeighting);
		}

		for (var j = 0; j < boundaryCorners.length; ++j) {
			var corner = boundaryCorners[j];
			if (corner.betweenPlates) {
				corner.pressure = newCornerPressure[j];
				corner.shear = newCornerShear[j];
			}
		}
	}
}

function populateElevationBorderQueue(boundaryCorners, boundaryCornerInnerBorderIndexes, action) {
	var elevationBorderQueue = [];
	for (var i = 0; i < boundaryCorners.length; ++i) {
		var corner = boundaryCorners[i];

		var innerBorderIndex = boundaryCornerInnerBorderIndexes[i];
		if (innerBorderIndex !== null) {
			var innerBorder = corner.borders[innerBorderIndex];
			var outerBorder0 = corner.borders[(innerBorderIndex + 1) % corner.borders.length];
			var plate0 = innerBorder.tiles[0].plate;
			var plate1 = outerBorder0.tiles[0].plate !== plate0 ? outerBorder0.tiles[0].plate : outerBorder0.tiles[1].plate;

			var calculateElevation;

			if (corner.pressure > 0.3) {
				corner.elevation = Math.max(plate0.elevation, plate1.elevation) + corner.pressure;
				if (plate0.oceanic === plate1.oceanic)
					calculateElevation = calculateCollidingElevation;
				else if (plate0.oceanic)
					calculateElevation = calculateSubductingElevation;
				else
					calculateElevation = calculateSuperductingElevation;
			} else if (corner.pressure < -0.3) {
				corner.elevation = Math.max(plate0.elevation, plate1.elevation) - corner.pressure / 4;
				calculateElevation = calculateDivergingElevation;
			} else if (corner.shear > 0.3) {
				corner.elevation = Math.max(plate0.elevation, plate1.elevation) + corner.shear / 8;
				calculateElevation = calculateShearingElevation;
			} else {
				corner.elevation = (plate0.elevation + plate1.elevation) / 2;
				calculateElevation = calculateDormantElevation;
			}

			var nextCorner = innerBorder.oppositeCorner(corner);
			if (!nextCorner.betweenPlates) {
				elevationBorderQueue.push({
					origin: {
						corner: corner,
						pressure: corner.pressure,
						shear: corner.shear,
						plate: plate0,
						calculateElevation: calculateElevation
					},
					border: innerBorder,
					corner: corner,
					nextCorner: nextCorner,
					distanceToPlateBoundary: innerBorder.length(),
				});
			}
		} else {
			var plate0 = corner.tiles[0].plate;
			var plate1 = corner.tiles[1].plate;
			var plate2 = corner.tiles[2].plate;

			elevation = 0;

			if (corner.pressure > 0.3) {
				corner.elevation = Math.max(plate0.elevation, plate1.elevation, plate2.elevation) + corner.pressure;
			} else if (corner.pressure < -0.3) {
				corner.elevation = Math.max(plate0.elevation, plate1.elevation, plate2.elevation) + corner.pressure / 4;
			} else if (corner.shear > 0.3) {
				corner.elevation = Math.max(plate0.elevation, plate1.elevation, plate2.elevation) + corner.shear / 8;
			} else {
				corner.elevation = (plate0.elevation + plate1.elevation + plate2.elevation) / 3;
			}
		}

		//corner.elevation += (corner.distanceToPlateBoundary);//Math.random();
	}

	action.provideResult(elevationBorderQueue);
}

function calculateCollidingElevation(distanceToPlateBoundary, distanceToPlateRoot, boundaryElevation, plateElevation, pressure, shear) {
	var t = distanceToPlateBoundary / (distanceToPlateBoundary + distanceToPlateRoot);
	var e = 0
	if (t < 0.5) //0.5
	{
		t = t / 0.5;
		e = plateElevation + Math.pow(t - 1, 2) * (boundaryElevation - plateElevation);
	} else {
		e = plateElevation;
	}
	//e += distanceToPlateBoundary/distanceToPlateRoot*0.25;
	return e
}

function calculateSuperductingElevation(distanceToPlateBoundary, distanceToPlateRoot, boundaryElevation, plateElevation, pressure, shear) {
	var t = distanceToPlateBoundary / (distanceToPlateBoundary + distanceToPlateRoot);
	if (t < 0.2) {
		t = t / 0.2;
		return boundaryElevation + t * (plateElevation - boundaryElevation + pressure / 2);
	} else if (t < 0.5) {
		t = (t - 0.2) / 0.3;
		return plateElevation + Math.pow(t - 1, 2) * pressure / 2;
	} else {
		return plateElevation;
	}
}

function calculateSubductingElevation(distanceToPlateBoundary, distanceToPlateRoot, boundaryElevation, plateElevation, pressure, shear) {
	var t = distanceToPlateBoundary / (distanceToPlateBoundary + distanceToPlateRoot);
	return plateElevation + Math.pow(t - 1, 2) * (boundaryElevation - plateElevation);
}

function calculateDivergingElevation(distanceToPlateBoundary, distanceToPlateRoot, boundaryElevation, plateElevation, pressure, shear) {
	var t = distanceToPlateBoundary / (distanceToPlateBoundary + distanceToPlateRoot);
	if (t < 0.3) {
		t = t / 0.3;
		return plateElevation + Math.pow(t - 1, 2) * (boundaryElevation - plateElevation);
	} else {
		return plateElevation;
	}
}

function calculateShearingElevation(distanceToPlateBoundary, distanceToPlateRoot, boundaryElevation, plateElevation, pressure, shear) {

	var t = distanceToPlateBoundary / (distanceToPlateBoundary + distanceToPlateRoot);

	if (plateElevation > 0) var q = distanceToPlateBoundary / (distanceToPlateRoot);
	else var q = Math.min(distanceToPlateBoundary / (distanceToPlateRoot), distanceToPlateBoundary / (distanceToPlateBoundary + distanceToPlateRoot));

	if (t < 0.2) //0.2
	{
		t = t / 0.2;
		return plateElevation + Math.pow(t - 1, 2) * (boundaryElevation - plateElevation);
	} else {

		return plateElevation;
	}
}

function calculateDormantElevation(distanceToPlateBoundary, distanceToPlateRoot, boundaryElevation, plateElevation, pressure, shear) {
	var t = distanceToPlateBoundary / (distanceToPlateBoundary + distanceToPlateRoot);
	var elevationDifference = boundaryElevation - plateElevation;
	var a = 2 * elevationDifference;
	var b = -3 * elevationDifference;
	return (t * t * elevationDifference * (2 * t - 3) + boundaryElevation); //original
	//return (t * t * elevationDifference * (2 * t - 3) + boundaryElevation)*(1+((Math.random()-0.5)*0.5));
}

function processElevationBorderQueue(elevationBorderQueue, elevationBorderQueueSorter, action) {
	if (elevationBorderQueue.length === 0) return;

	var iEnd = iEnd = elevationBorderQueue.length;
	for (var i = 0; i < iEnd; ++i) {
		var front = elevationBorderQueue[i];
		var corner = front.nextCorner;
		if (!corner.elevation) {
			corner.distanceToPlateBoundary = front.distanceToPlateBoundary;
			corner.elevation = front.origin.calculateElevation(
				corner.distanceToPlateBoundary,
				corner.distanceToPlateRoot,
				front.origin.corner.elevation,
				front.origin.plate.elevation,
				front.origin.pressure,
				front.origin.shear);

			//better drainage
			//if (corner.elevation >= 0) corner.elevation += corner.distanceToPlateRoot/700 + Math.max(corner.distanceToPlateRoot/700,corner.distanceToPlateBoundary/700);
			if (corner.elevation >= 0) corner.elevation += corner.distanceToPlateBoundary / 700;

			for (var j = 0; j < corner.borders.length; ++j) {
				var border = corner.borders[j];
				if (!border.betweenPlates) {
					var nextCorner = corner.corners[j];
					var distanceToPlateBoundary = corner.distanceToPlateBoundary + border.length();
					if (!nextCorner.distanceToPlateBoundary || nextCorner.distanceToPlateBoundary > distanceToPlateBoundary) {
						elevationBorderQueue.push({
							origin: front.origin,
							border: border,
							corner: corner,
							nextCorner: nextCorner,
							distanceToPlateBoundary: distanceToPlateBoundary,
						});
					}
				}
			}
		}
	}
	var minElev = 0;
	var maxElev = 0;
	for (var i = 0; i < iEnd; ++i) {
		var front = elevationBorderQueue[i];
		var corner = front.nextCorner;
		if (corner.elevation > maxElev) maxElev = corner.elevation;
		if (corner.elevation < minElev) minElev = corner.elevation;
	}
	for (var i = 0; i < iEnd; ++i) {
		var front = elevationBorderQueue[i];
		var corner = front.nextCorner;
		if (corner.elevation >= 0) corner.elevation = corner.elevation / maxElev;
		if (corner.elevation < 0) corner.elevation = -corner.elevation / minElev;
	}
	elevationBorderQueue.splice(0, iEnd);
	elevationBorderQueue.sort(elevationBorderQueueSorter);

	action.loop();
}

function calculateTileAverageElevations(tiles, action) {
	for (var i = 0; i < tiles.length; ++i) {
		var tile = tiles[i];
		var elevation = 0;
		for (var j = 0; j < tile.corners.length; ++j) {
			elevation += tile.corners[j].elevation;
		}
		tile.elevation = (elevation / tile.corners.length);
		tile.shore = 0;
		tile.shoreZ = 0;
		tile.shoreA = 0;
	}
}
