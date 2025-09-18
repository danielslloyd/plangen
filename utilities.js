function Signal() {
	this.nextToken = 1;
	this.listeners = {};
}

Signal.prototype.addListener = function Signal_addListener(callback, token) {
	if (typeof (token) !== "string") {
		token = this.nextToken.toFixed(0);
		this.nextToken += 1;
	}
	this.listeners[token] = callback;
};

Signal.prototype.removeListener = function Signal_removeListener(token) {
	delete this.listeners[token];
};

Signal.prototype.fire = function Signal_fire() {
	for (var key in this.listeners) {
		if (this.listeners.hasOwnProperty(key)) {
			this.listeners[key].apply(null, arguments);
		}
	}
};

function XorShift128(x, y, z, w) {
	this.x = (x ? x >>> 0 : 123456789);
	this.y = (y ? y >>> 0 : 362436069);
	this.z = (z ? z >>> 0 : 521288629);
	this.w = (w ? w >>> 0 : 88675123);
}

XorShift128.prototype.next = function XorShift128_next() {
	var t = this.x ^ (this.x << 11) & 0x7FFFFFFF;
	this.x = this.y;
	this.y = this.z;
	this.z = this.w;
	this.w = (this.w ^ (this.w >> 19)) ^ (t ^ (t >> 8));
	return this.w;
};

XorShift128.prototype.unit = function XorShift128_unit() {
	return this.next() / 0x80000000;
};

XorShift128.prototype.unitInclusive = function XorShift128_unitInclusive() {
	return this.next() / 0x7FFFFFFF;
};

XorShift128.prototype.integer = function XorShift128_integer(min, max) {
	return this.integerExclusive(min, max + 1);
};

XorShift128.prototype.integerExclusive = function XorShift128_integerExclusive(min, max) {
	min = Math.floor(min);
	max = Math.floor(max);
	return Math.floor(this.unit() * (max - min)) + min;
};

XorShift128.prototype.real = function XorShift128_real(min, max) {
	return this.unit() * (max - min) + min;
};

XorShift128.prototype.realInclusive = function XorShift128_realInclusive(min, max) {
	return this.unitInclusive() * (max - min) + min;
};

XorShift128.prototype.reseed = function XorShift128_reseed(x, y, z, w) {
	this.x = (x ? x >>> 0 : 123456789);
	this.y = (y ? y >>> 0 : 362436069);
	this.z = (z ? z >>> 0 : 521288629);
	this.w = (w ? w >>> 0 : 88675123);
};

/* function saveToFileSystem(content) {
	var requestFileSystem = window.requestFileSystem || window.webkitRequestFileSystem;
	requestFileSystem(window.TEMPORARY, content.length,
		function (fs) {
			fs.root.getFile("planetMesh.js", {
				create: true
			},
				function (fileEntry) {
					fileEntry.createWriter(
						function (fileWriter) {
							fileWriter.addEventListener("writeend",
								function () {
									$("body").append("<a href=\"" + fileEntry.toURL() + "\" download=\"planetMesh.js\" target=\"_blank\">Mesh Data</a>");
									$("body>a").focus();
								}, false);

							fileWriter.write(new Blob([content]));
						},
						function (error) { });
				},
				function (error) { });
		},
		function (error) { });
} */

function slerp(p0, p1, t) {
	var omega = Math.acos(p0.dot(p1));
	return p0.clone().multiplyScalar(Math.sin((1 - t) * omega)).add(p1.clone().multiplyScalar(Math.sin(t * omega))).divideScalar(Math.sin(omega));
}

function randomUnitVector(random) {
	var theta = random.real(0, Math.PI * 2);
	var phi = Math.acos(random.realInclusive(-1, 1));
	var sinPhi = Math.sin(phi);
	return new Vector3(
		Math.cos(theta) * sinPhi,
		Math.sin(theta) * sinPhi,
		Math.cos(phi));
}

function randomQuaternion(random) {
	var theta = random.real(0, Math.PI * 2);
	var phi = Math.acos(random.realInclusive(-1, 1));
	var sinPhi = Math.sin(phi);
	var gamma = random.real(0, Math.PI * 2);
	var sinGamma = Math.sin(gamma);
	return new Quaternion(
		Math.cos(theta) * sinPhi * sinGamma,
		Math.sin(theta) * sinPhi * sinGamma,
		Math.cos(phi) * sinGamma,
		Math.cos(gamma));
}

function intersectRayWithSphere(ray, sphere) {
	var v1 = sphere.center.clone().sub(ray.origin);
	var v2 = v1.clone().projectOnVector(ray.direction);
	var d = v1.distanceTo(v2);
	return (d <= sphere.radius);
}

function calculateTriangleArea(pa, pb, pc) {
	var vab = new THREE.Vector3().subVectors(pb, pa);
	var vac = new THREE.Vector3().subVectors(pc, pa);
	var faceNormal = new THREE.Vector3().crossVectors(vab, vac);
	var vabNormal = new THREE.Vector3().crossVectors(faceNormal, vab).normalize();
	var plane = new THREE.Plane().setFromNormalAndCoplanarPoint(vabNormal, pa);
	var height = plane.distanceToPoint(pc);
	var width = vab.length();
	var area = width * height * 0.5;
	return area;
}

function accumulateArray(array, state, accumulator) {
	for (var i = 0; i < array.length; ++i) {
		state = accumulator(state, array[i]);
	}
	return state;
}

function adjustRange(value, oldMin, oldMax, newMin, newMax) {
	return (value - oldMin) / (oldMax - oldMin) * (newMax - newMin) + newMin;
}

//Adapted from http://stackoverflow.com/a/7616484/3874364
function hashString(s) {
	var hash = 0;
	var length = s.length;
	if (length === 0) return hash;
	for (var i = 0; i < length; ++i) {
		var character = s.charCodeAt(1);
		hash = ((hash << 5) - hash) + character;
		hash |= 0;
	}
	return hash;
}

function sphericalDistance(point1, point2) {
	// Calculate the magnitudes of the vectors
	const magnitude1 = point1.length();
	const magnitude2 = point2.length();

	// Calculate the average magnitude (radius of the sphere)
	const averageRadius = (magnitude1 + magnitude2) / 2;

	// Normalize the vectors to project them onto the sphere
	const normalizedPoint1 = point1.clone().normalize();
	const normalizedPoint2 = point2.clone().normalize();

	// Calculate the angle between the two normalized vectors
	const angle = Math.acos(normalizedPoint1.dot(normalizedPoint2));

	// Calculate the spherical distance
	const distance = averageRadius * angle;
	return distance;
}

function buildGraph(vertices, edges) {
    const graph = createGraph();
    for (let vertex of vertices) {
        graph.addNode(vertex.id);
    }
    for (let edge of edges) {
        graph.addLink(edge.from.id, edge.to.id, { weight: edge.cost });
        graph.addLink(edge.to.id, edge.from.id, { weight: edge.reverseCost });
    }
    return graph;

}

// Calculate Average Border Length from topology borders
// Moved from planet-generator.js for better organization
function calculateAverageBorderLength(borders) {
	if (!borders || borders.length === 0) {
		return averageBorderLength;
	}
	
	var totalLength = 0;
	var validBorders = 0;
	
	for (var i = 0; i < borders.length; i++) {
		var border = borders[i];
		if (border.corners && border.corners.length >= 2) {
			var corner0 = border.corners[0];
			var corner1 = border.corners[1];
			if (corner0.position && corner1.position) {
				var borderLength = corner0.position.distanceTo(corner1.position);
				if (borderLength > 0) {
					totalLength += borderLength;
					validBorders++;
				}
			}
		}
	}
	
	if (validBorders === 0) {
		return averageBorderLength;
	}
	
	var calculatedABL = totalLength / validBorders;
	return calculatedABL;
}

// Mercator projection coordinate conversion functions

// Convert 3D Cartesian coordinates to Mercator x,y coordinates
// centered on the specified mercatorCenterLat/mercatorCenterLon
function cartesianToMercator(position, centerLat, centerLon) {
	// First convert to spherical coordinates (lat/lon)
	var spherical = cartesianToSpherical(position);

	// Now cartesianToSpherical returns proper geographic coordinates
	var lat = spherical.phi; // phi is now latitude (-π/2 to π/2)
	var lon = spherical.theta; // theta is longitude (-π to π)

	// Adjust longitude relative to center
	var adjustedLon = lon - centerLon;
	// Wrap longitude to [-π, π] range
	while (adjustedLon > Math.PI) adjustedLon -= 2 * Math.PI;
	while (adjustedLon < -Math.PI) adjustedLon += 2 * Math.PI;

	// Adjust latitude relative to center
	var adjustedLat = lat - centerLat;

	// Clamp adjustedLat to safe range for Mercator projection to prevent NaN
	// Safe range prevents Math.tan() from going negative in Math.log()
	adjustedLat = Math.max(-1.4, Math.min(1.4, adjustedLat));

	// Apply Mercator projection formulas
	var x = adjustedLon;
	var tanArg = Math.PI/4 + adjustedLat/2;
	var tanValue = Math.tan(tanArg);

	// Ensure tanValue is positive to prevent NaN from Math.log()
	if (tanValue <= 0) {
		tanValue = 0.001; // Small positive value as fallback
	}

	var y = Math.log(tanValue);

	// Clamp y to reasonable bounds to avoid extreme distortion near poles
	y = Math.max(-3, Math.min(3, y));

	return { x: x, y: y };
}

// Convert Mercator x,y coordinates back to 3D Cartesian position
function mercatorToCartesian(x, y, centerLat, centerLon, radius) {
	radius = radius || 1000; // Default sphere radius

	// Reverse Mercator projection
	var adjustedLon = x;
	var adjustedLat = 2 * (Math.atan(Math.exp(y)) - Math.PI/4);

	// Add back the center offsets
	var lat = adjustedLat + centerLat;
	var lon = adjustedLon + centerLon;

	// Clamp latitude to valid range
	lat = Math.max(-Math.PI/2 + 0.01, Math.min(Math.PI/2 - 0.01, lat));

	// Convert back to spherical coordinates (phi/theta)
	// Now using standard geographic coordinates
	var phi = lat; // phi is latitude (-π/2 to π/2)
	var theta = lon; // theta is longitude (-π to π)

	// Convert from geographic coordinates to standard Cartesian
	var geo_x = radius * Math.cos(phi) * Math.cos(theta);
	var geo_y = radius * Math.cos(phi) * Math.sin(theta);
	var geo_z = radius * Math.sin(phi);

	// Transform back to original coordinate system (inverse of cartesianToSpherical rotation)
	// Original: geo_x = position.z, geo_y = position.x, geo_z = position.y
	// Inverse: position.x = geo_y, position.y = geo_z, position.z = geo_x
	var x3d = geo_y;
	var y3d = geo_z;
	var z3d = geo_x;

	return new THREE.Vector3(x3d, y3d, z3d);
}

// Convert a tile's 3D position to 2D Mercator coordinates for rendering
function projectTileToMercator(tile, centerLat, centerLon) {
	if (!tile.averagePosition) return null;

	var mercator = cartesianToMercator(tile.averagePosition, centerLat, centerLon);
	return mercator;
}