// Offline generator for the cached planet meshes (meshes/mesh-{20,40,60}.json).
// Runs geometry.js's mesh pipeline under minimal Vector3 / THREE.Plane shims and
// a synchronous SteppedAction driver, then writes the serialized mesh JSON.
// Usage: node scripts/generate-meshes.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

// --- Minimal Vector3 matching the THREE methods used in mesh generation ---
class Vec3 {
	constructor(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; }
	set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
	clone() { return new Vec3(this.x, this.y, this.z); }
	copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
	add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
	sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
	multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
	divideScalar(s) { return this.multiplyScalar(1 / s); }
	addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
	dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
	lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
	length() { return Math.sqrt(this.lengthSq()); }
	normalize() { const l = this.length() || 1; return this.divideScalar(l); }
	distanceTo(v) { const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z; return Math.sqrt(dx * dx + dy * dy + dz * dz); }
	lerp(v, a) { this.x += (v.x - this.x) * a; this.y += (v.y - this.y) * a; this.z += (v.z - this.z) * a; return this; }
	negate() { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; }
	cross(v) { const ax = this.x, ay = this.y, az = this.z; this.x = ay * v.z - az * v.y; this.y = az * v.x - ax * v.z; this.z = ax * v.y - ay * v.x; return this; }
}

class Plane {
	constructor() { this.normal = new Vec3(0, 0, 1); this.constant = 0; }
	setFromNormalAndCoplanarPoint(normal, point) { this.normal = normal.clone().normalize(); this.constant = -point.dot(this.normal); return this; }
	projectPoint(point, target) { target = target || new Vec3(); const d = this.normal.dot(point) + this.constant; return target.copy(point).addScaledVector(this.normal, -d); }
}

const THREE = { Vector3: Vec3, Plane: Plane, Sphere: class { constructor(c, r) { this.center = c; this.radius = r; } } };

// --- Synchronous SteppedAction driver (pump step() to completion) ---
function loadInto(ctx, file) { return fs.readFileSync(path.join(ROOT, file), 'utf8'); }

const sandbox = {
	THREE, Vector3: Vec3, Math, console, JSON, Array, Object, Number, isFinite, isNaN,
	window: {}, Date,
	ctime: function () {}, ctimeEnd: function () {}, // defined in planet-generator.js (not loaded here)
};
sandbox.global = sandbox;
vm.createContext(sandbox);

// Load the real source files into the shared context.
['SteppedAction.js', 'utilities.js', 'geometry.js', 'mesh-cache.js'].forEach(f => {
	vm.runInContext(loadInto(sandbox, f), sandbox, { filename: f });
});

// Disable async scheduling so we can pump step() synchronously.
vm.runInContext('SteppedAction.prototype._scheduleStep = function(){};', sandbox);

function buildMesh(degree, distortionRate) {
	sandbox.__degree = degree;
	sandbox.__dr = distortionRate;
	vm.runInContext(`
		__mesh = null;
		var __random = new XorShift128(12345);
		var __act = new SteppedAction(null, 6e8, 0);
		__act.executeSubaction(function (a) { generatePlanetMesh(__degree, __dr, __random, a); }, 1)
		     .getResult(function (r) { __mesh = r; })
		     .execute();
		var __guard = 0;
		while (!__act.completed && !__act.canceled && __guard++ < 1e7) __act.step();
		__json = JSON.stringify(serializeMesh(__mesh, __degree));
	`, sandbox);
	return { json: sandbox.__json, nodes: sandbox.__mesh.nodes.length, faces: sandbox.__mesh.faces.length, edges: sandbox.__mesh.edges.length };
}

const outDir = path.join(ROOT, 'meshes');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

const DISTORTION_RATE = 0.15; // matches default distortionLevel 1
[20, 40, 60].forEach(degree => {
	const t0 = Date.now();
	const r = buildMesh(degree, DISTORTION_RATE);
	const outFile = path.join(outDir, 'mesh-' + degree + '.json');
	fs.writeFileSync(outFile, r.json);
	console.log(`mesh-${degree}.json  nodes=${r.nodes} faces=${r.faces} edges=${r.edges}  ${(r.json.length / 1048576).toFixed(2)}MB  ${Date.now() - t0}ms`);
});
console.log('done');
