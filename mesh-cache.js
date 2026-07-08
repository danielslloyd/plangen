// mesh-cache.js
// ============================================================================
// MESH CACHING
// ============================================================================
// The subdivided/distorted/relaxed icosahedral mesh is the RNG-heavy, slowest
// part of generation (~1.9s at degree 60). The dual-graph topology rebuilds
// deterministically from it, so we cache the mesh for the three standard detail
// levels (degrees 20/40/60) as JSON and load it instead of generating it. The
// terrain (elevation, climate, ...) is still seed-driven, so cached-mesh planets
// still vary per seed — only the tile LAYOUT is shared.
//
// Set `useCustomMesh = true` (console / save-load) to always generate a fresh
// distorted mesh instead of loading the cached one. `regenerateMeshCacheFiles()`
// (console) regenerates the JSON payloads for saving.

var useCustomMesh = false;              // true => always generate, ignore the cache
var STANDARD_MESH_DEGREES = [20, 40, 60];
window.cachedMeshData = window.cachedMeshData || {}; // degree -> parsed JSON payload
var _meshFetchPromises = {};

function meshCacheUrl(degree) { return "meshes/mesh-" + degree + ".json"; }

// Kick off (and memoize) a fetch of the cached mesh JSON for a degree. Resolves
// to the parsed payload, or null if there is no cached file (custom sizes) or the
// fetch fails — callers then fall back to generating the mesh.
function preloadCachedMesh(degree) {
	if (useCustomMesh) return Promise.resolve(null);
	if (cachedMeshData[degree]) return Promise.resolve(cachedMeshData[degree]);
	if (_meshFetchPromises[degree]) return _meshFetchPromises[degree];
	var p = fetch(meshCacheUrl(degree), { cache: "force-cache" })
		.then(function (r) { return r.ok ? r.json() : null; })
		.then(function (j) { if (j) cachedMeshData[degree] = j; return j; })
		.catch(function () { return null; });
	_meshFetchPromises[degree] = p;
	return p;
}

// Return a ready-to-use mesh (objects with THREE Vector3 positions) for a degree
// if its payload has been preloaded, else null.
function getCachedMesh(degree) {
	if (useCustomMesh) return null;
	var payload = cachedMeshData[degree];
	return payload ? deserializeMesh(payload) : null;
}

// mesh -> compact JSON payload. Positions/centroids are flat [x,y,z,...] arrays;
// adjacency lists stay nested. Everything else (node->edge lists, centroids) is
// reconstructable, but we store it all so deserialize is a pure rebuild.
function serializeMesh(mesh, degree) {
	var np = new Array(mesh.nodes.length * 3);
	var ne = new Array(mesh.nodes.length);
	var nf = new Array(mesh.nodes.length);
	for (var i = 0; i < mesh.nodes.length; ++i) {
		var n = mesh.nodes[i];
		np[i * 3] = n.p.x; np[i * 3 + 1] = n.p.y; np[i * 3 + 2] = n.p.z;
		ne[i] = n.e; nf[i] = n.f;
	}
	var en = new Array(mesh.edges.length);
	var ef = new Array(mesh.edges.length);
	for (var i = 0; i < mesh.edges.length; ++i) { en[i] = mesh.edges[i].n; ef[i] = mesh.edges[i].f; }
	var fn = new Array(mesh.faces.length);
	var fe = new Array(mesh.faces.length);
	var fc = new Array(mesh.faces.length * 3);
	for (var i = 0; i < mesh.faces.length; ++i) {
		var f = mesh.faces[i];
		fn[i] = f.n; fe[i] = f.e;
		fc[i * 3] = f.centroid.x; fc[i * 3 + 1] = f.centroid.y; fc[i * 3 + 2] = f.centroid.z;
	}
	return { degree: degree, nodes: { p: np, e: ne, f: nf }, edges: { n: en, f: ef }, faces: { n: fn, e: fe, c: fc } };
}

// JSON payload -> mesh (the shape generatePlanetTopology expects).
function deserializeMesh(d) {
	var nodes = new Array(d.nodes.e.length);
	for (var i = 0; i < nodes.length; ++i) {
		nodes[i] = { p: new Vector3(d.nodes.p[i * 3], d.nodes.p[i * 3 + 1], d.nodes.p[i * 3 + 2]), e: d.nodes.e[i], f: d.nodes.f[i] };
	}
	var edges = new Array(d.edges.n.length);
	for (var i = 0; i < edges.length; ++i) edges[i] = { n: d.edges.n[i], f: d.edges.f[i] };
	var faces = new Array(d.faces.n.length);
	for (var i = 0; i < faces.length; ++i) {
		faces[i] = { n: d.faces.n[i], e: d.faces.e[i], centroid: new Vector3(d.faces.c[i * 3], d.faces.c[i * 3 + 1], d.faces.c[i * 3 + 2]) };
	}
	return { nodes: nodes, edges: edges, faces: faces };
}
