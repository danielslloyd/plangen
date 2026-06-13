// feature-detection.js
// ============================================================================
// HIERARCHICAL GEOGRAPHIC FEATURE DETECTION + VISUALIZATION
// ============================================================================
//
// Identifies distinct features that nest inside / continue from larger ones and
// exposes them as color overlays with hover inspection + root/node markers.
//
// Built on data the generator already computes:
//   tile.shore   - signed shore distance (+ inland land, - toward open water)
//   tile.body    - connected land/water mass
//   tile.drain   - downhill neighbour (drainage), used by Approach E's basin mode
//
// The "interior/openness" field is  w(tile) = |shore|.  High in continent cores
// & open ocean; low at peninsula tips & coves; a narrow neck (isthmus / bay
// mouth) is a SADDLE of the field.
//
// APPROACHES, each producing a per-tile NESTED hierarchy of features:
//
//   A - PLATE PROVINCES            [tectonic plates + smart boundaries]
//       Plates as large features with smoothed boundaries and domain cleanup.
//
//   B - EROSION SPLIT (recursive)  [threshold topology]
//       Recursively split each body into connected components of {w > e}; flood
//       the rest to the nearest core; recurse with e+1. Each split adds a level.
//
//   E - GRANULOMETRIC THICKNESS    [scale / width]   (the favourite)
//       Local thickness field (bounded-disk granulometry of w) nested by
//       threshold. Two extra knobs: a NECK CUT (tiles with |shore| <= neckWidth
//       act as walls, so narrow straits/isthmuses are split first) and an
//       optional LAND-FOLLOWS-DRAINAGE-BASINS mode (large land bodies are first
//       partitioned by river basins, then nested by thickness).
//
//   N - SPLIT COHESION             [plate provinces, per-domain cohesion + nesting]
//       Plate provinces with separate land/ocean cohesion merge, then land
//       provinces are cut at narrow necks into nested peninsula/isthmus features.
//
// VISUALIZATION:
//   * B overlay: base hue DARKENED once per nesting level (depth reads dark).
//   * A/E/N overlays: a distinct stable HUE per finest feature (patchwork).
//   * Hover (any feature overlay): outline every feature in the tile's hierarchy
//     + a subtle popup label at each feature's marker tile.
//   * "Show Feature Roots": dot at every feature's marker tile (the tile FURTHEST
//     from any other feature - a pole of inaccessibility) with a line to its
//     parent's marker, i.e. the feature node-tree drawn in place.
//
// Public:  generateFeatureOverlays(planet)            (called by the pipeline)
//          regenerateFeatureOverlays({...})           (live retuning / sliders)
//          featureDetectionConfig                     (live config object)
//          toggleFeatureRoots(bool) / rebuildFeatureRoots()
// ============================================================================

(function (global) {
	"use strict";

	// ------------------------------------------------------------------
	// Config (override via regenerateFeatureOverlays or the UI sliders).
	// ------------------------------------------------------------------
	var CONFIG = {
		// Approach A (plate provinces)
		plateSmooth: 2,       // smoothing passes that clean jagged plate boundaries.
		plateMinSize: 8,      // merge plate provinces smaller than this into a neighbour.
		plateMerge: 50,       // cohesion merge strength (0 = off). After the tiny-region
		                      // merge, adjacent same-domain provinces are joined when they
		                      // share a wide border AND the union is more compact
		                      // (area/perimeter²). Higher = more aggressive joining.
		// Approach B (erosion split)
		maxErosion: 6,        // deepest erosion level to attempt.
		// Approach E (granulometric thickness)
		thicknessMax: 8,      // cap on the thickness field / erosion depth.
		neckWidth: 1,         // tiles with |shore| <= this act as walls, forcing a
		                      // split across narrow straits/isthmuses. 0 = off.
		eFollowBasins: false, // LAND ONLY: a last-minute rule that keeps each drainage
		                      // basin inside a single feature (snaps split boundaries
		                      // to basin lines). Does NOT add features or touch water.
		// Approach N (split-cohesion provinces: plate provinces with separate
		// land/ocean cohesion-merge strengths + peninsula/isthmus nesting on land)
		splitMergeOcean: 90,  // cohesion merge strength for OCEAN provinces (80..100 in UI)
		splitMergeLand: 15,   // cohesion merge strength for LAND provinces (0..50 in UI)
		splitNeckWidth: 2,    // land nesting: tiles with |shore| <= this act as walls;
		                      // the cut-off parts become nested peninsula features and
		                      // the necks themselves become isthmus features. 0 = off.
		splitMinPart: 6,      // nested land parts smaller than this merge into a sibling.
		// Shared
		darkenPerLevel: 0.72  // B: brightness multiplier per nesting level.
	};

	// Base hues (level 1). Darkened for deeper levels (B).
	var LAND_BASE  = new THREE.Color(0x74ad5a);   // green
	var WATER_BASE = new THREE.Color(0x4f86c6);   // blue
	function GRAY() { return new THREE.Color(0x888888); }

	// overlay id -> approach letter, and approach letter -> per-tile hierarchy prop
	var OVERLAYS = {
		featPlatesA: "A", featNestedB: "B", featThicknessE: "E", featSplitN: "N"
	};
	var APPROACH_PROP = {
		A: "hierarchyA", B: "hierarchyB", E: "hierarchyE", N: "hierarchyN"
	};
	var REGISTERED_IDS = ["featPlatesA", "featNestedB", "featThicknessE", "featSplitN"];

	// ------------------------------------------------------------------
	// Helpers
	// ------------------------------------------------------------------
	function isLand(tile) { return tile.elevation > 0; }
	function fieldValue(tile) { return Math.abs(tile.shore || 0); }
	function thickValue(tile) { return tile._thick || 0; }

	function makeFeature(approach, isLandV, level, parent, root, maxW, idState) {
		return {
			id: idState.next++, approach: approach, isLand: isLandV, level: level,
			parent: parent, children: [], root: root, maxW: maxW, regionTiles: []
		};
	}

	// ==================================================================
	// SHARED SPLIT MACHINERY (Approach B + Approach E)
	// ==================================================================
	// `passable` (optional) lets a caller treat some tiles as walls during
	// component finding (used by E's neck cut) without removing them from the body.
	function connectedComponentsAbove(tileArr, tileSet, e, fieldFn, passable) {
		var visited = new Set(), comps = [];
		for (var i = 0; i < tileArr.length; i++) {
			var t = tileArr[i];
			if (fieldFn(t) <= e || visited.has(t)) continue;
			if (passable && !passable(t)) continue;
			var comp = [], stack = [t]; visited.add(t);
			while (stack.length) {
				var c = stack.pop(); comp.push(c);
				var nb = c.tiles;
				for (var k = 0; k < nb.length; k++) {
					var n = nb[k];
					if (tileSet.has(n) && fieldFn(n) > e && !visited.has(n) && (!passable || passable(n))) {
						visited.add(n); stack.push(n);
					}
				}
			}
			comps.push(comp);
		}
		return comps;
	}

	function fillToCores(tileArr, tileSet, cores) {
		var owner = new Map(), queue = [];
		for (var i = 0; i < cores.length; i++) {
			for (var j = 0; j < cores[i].length; j++) { owner.set(cores[i][j], i); queue.push(cores[i][j]); }
		}
		var head = 0;
		while (head < queue.length) {
			var c = queue[head++], oi = owner.get(c), nb = c.tiles;
			for (var k = 0; k < nb.length; k++) {
				var n = nb[k];
				if (tileSet.has(n) && !owner.has(n)) { owner.set(n, oi); queue.push(n); }
			}
		}
		var groups = []; for (var g = 0; g < cores.length; g++) groups.push([]);
		for (var t = 0; t < tileArr.length; t++) {
			var oi2 = owner.get(tileArr[t]); if (oi2 === undefined) oi2 = 0;
			groups[oi2].push(tileArr[t]);
		}
		return groups;
	}

	function newSplitFeature(tileArr, parent, level, idState, approach, fieldFn) {
		var root = tileArr[0], maxW = fieldFn(root);
		for (var i = 1; i < tileArr.length; i++) {
			var w = fieldFn(tileArr[i]);
			if (w > maxW) { maxW = w; root = tileArr[i]; }
		}
		return {
			id: idState.next++, approach: approach, isLand: isLand(root), level: level,
			parent: parent, children: [], root: root, maxW: maxW, regionTiles: []
		};
	}

	function buildSplitHierarchy(tileArr, tileSet, feature, eStart, eMax, allOut, idState, approach, fieldFn, finestProp, passable) {
		allOut.push(feature);
		for (var e = eStart; e <= eMax; e++) {
			var comps = connectedComponentsAbove(tileArr, tileSet, e, fieldFn, passable);
			if (comps.length >= 2) {
				var groups = fillToCores(tileArr, tileSet, comps);
				for (var g = 0; g < groups.length; g++) {
					if (!groups[g].length) continue;
					var child = newSplitFeature(groups[g], feature, feature.level + 1, idState, approach, fieldFn);
					feature.children.push(child);
					var childSet = new Set(groups[g]);
					buildSplitHierarchy(groups[g], childSet, child, e + 1, eMax, allOut, idState, approach, fieldFn, finestProp, passable);
				}
				return;
			}
		}
		for (var t = 0; t < tileArr.length; t++) tileArr[t][finestProp] = feature;
	}

	// Last-minute LAND-ONLY rule for E: after the normal thickness split, relabel
	// each land drainage basin to the single finest feature that most of it landed
	// in, so a basin is never cut between two features. Touches only land tiles'
	// `_eFinest` (water is never read or written), and only reassigns to features
	// that already exist (creates none). Run before chains/regions are built.
	function relabelLandByBasin(tiles, bodies) {
		bodies.forEach(function (bt) {
			var landTiles = [];
			for (var i = 0; i < bt.length; i++) if (isLand(bt[i])) landTiles.push(bt[i]);
			if (!landTiles.length) return;
			var set = new Set(bt);
			var basins = groupByBasin(landTiles, set);
			for (var b = 0; b < basins.length; b++) {
				var basinTiles = basins[b];
				var counts = new Map(), best = null, bestC = -1;
				for (var t = 0; t < basinTiles.length; t++) {
					var f = basinTiles[t]._eFinest;
					if (!f) continue;
					var c = (counts.get(f) || 0) + 1; counts.set(f, c);
					if (c > bestC) { bestC = c; best = f; }
				}
				if (!best) continue;
				for (var u = 0; u < basinTiles.length; u++) basinTiles[u]._eFinest = best;
			}
		});
	}

	function assignSplitChains(tiles, finestProp, hierProp) {
		for (var b = 0; b < tiles.length; b++) {
			var leaf = tiles[b][finestProp];
			if (!leaf) { tiles[b][hierProp] = null; continue; }
			var chain = [];
			var cur = leaf;
			while (cur) { chain.unshift(cur); cur = cur.parent; }
			tiles[b][hierProp] = chain;
		}
	}

	// Reassign tiles of regions smaller than minSize to the adjacent region they
	// share the most boundary with. Mutates a (tile -> region) Map; marks ._dead.
	function mergeSmallRegions(regions, claimed, minSize, sameDomainOnly) {
		var bySize = regions.slice().sort(function (a, b) { return a._tiles.length - b._tiles.length; });
		for (var i = 0; i < bySize.length; i++) {
			var R = bySize[i];
			if (R._dead || R._tiles.length >= minSize) continue;
			var counts = new Map(), best = null, bestC = 0;
			for (var t = 0; t < R._tiles.length; t++) {
				var nb = R._tiles[t].tiles;
				for (var k = 0; k < nb.length; k++) {
					var o = claimed.get(nb[k]);
					if (!o || o === R || o._dead) continue;
					if (sameDomainOnly && o.isLand !== R.isLand) continue;   // never merge land into water or vice versa
					var c = (counts.get(o) || 0) + 1; counts.set(o, c);
					if (c > bestC) { bestC = c; best = o; }
				}
			}
			if (!best) continue;
			for (var m = 0; m < R._tiles.length; m++) {
				claimed.set(R._tiles[m], best);
				best._tiles.push(R._tiles[m]);
			}
			R._dead = true;
		}
	}

	// Cohesion merge: greedily join adjacent same-domain regions when doing so makes
	// a rounder feature. Compactness = area / perimeter² (peaks for disks). Two
	// regions merge only when (a) they share a wide border (so they are snugly
	// adjacent, not touching at a thin neck/bay mouth) and (b) the union is at least
	// as compact as the area-weighted compactness of the parts. This joins blobby
	// pairs/triples but refuses to absorb a concave bay (which would lower
	// compactness). `strength` (0..100) tunes the bar: 50 ≈ require no loss, lower is
	// stricter, higher tolerates a small loss. `claimed` maps tile -> owning region.
	// `strength` may be a single 0..100 number, or `{ land, water }` for separate
	// per-domain strengths (Approach N's split cohesion).
	function mergeByCohesion(regions, claimed, strength) {
		var landStrength, waterStrength;
		if (strength && typeof strength === "object") {
			landStrength = strength.land || 0;
			waterStrength = strength.water || 0;
		} else {
			landStrength = waterStrength = strength || 0;
		}
		if (landStrength <= 0 && waterStrength <= 0) return;
		function requiredRatioFor(isLandV) {
			var s = isLandV ? landStrength : waterStrength;
			return 1.0 + (50 - s) / 100 * 0.6; // 0→1.30, 50→1.00, 100→0.70
		}
		var minBorderFrac = 0.15;   // shared border / smaller region perimeter
		var maxPasses = 8;

		function perimeterOf(R) {
			var p = 0;
			for (var i = 0; i < R._tiles.length; i++) {
				var nb = R._tiles[i].tiles;
				for (var k = 0; k < nb.length; k++) {
					if (claimed.get(nb[k]) !== R) p++;
				}
			}
			return p;
		}
		function compactness(area, perim) { return perim > 0 ? area / (perim * perim) : 0; }

		for (var pass = 0; pass < maxPasses; pass++) {
			var live = regions.filter(function (r) { return !r._dead; });
			var area = new Map(), perim = new Map();
			for (var i = 0; i < live.length; i++) {
				area.set(live[i], live[i]._tiles.length);
				perim.set(live[i], perimeterOf(live[i]));
			}

			// Shared-border counts: region -> Map(neighbourRegion -> shared edge count).
			var cands = [];
			for (var i = 0; i < live.length; i++) {
				var R = live[i], shared = new Map();
				for (var t = 0; t < R._tiles.length; t++) {
					var nb = R._tiles[t].tiles;
					for (var k = 0; k < nb.length; k++) {
						var o = claimed.get(nb[k]);
						if (!o || o === R || o._dead) continue;
						if (o.isLand !== R.isLand) continue;            // same-domain only
						shared.set(o, (shared.get(o) || 0) + 1);
					}
				}
				shared.forEach(function (S, O) {
					if (R.id > O.id) return;                            // count each pair once
					var domainStrength = R.isLand ? landStrength : waterStrength;
					if (domainStrength <= 0) return;                    // merging disabled for this domain
					var aR = area.get(R), aO = area.get(O);
					var pR = perim.get(R), pO = perim.get(O);
					var mergedPerim = pR + pO - 2 * S;
					if (mergedPerim <= 0) return;
					var borderFrac = S / Math.min(pR, pO);
					if (borderFrac < minBorderFrac) return;
					var compMerged = compactness(aR + aO, mergedPerim);
					var weighted = (aR * compactness(aR, pR) + aO * compactness(aO, pO)) / (aR + aO);
					if (compMerged < requiredRatioFor(R.isLand) * weighted) return;
					cands.push({ a: R, b: O, gain: compMerged - weighted });
				});
			}
			if (cands.length === 0) break;

			cands.sort(function (x, y) { return y.gain - x.gain; });
			var used = new Set(), merged = 0;
			for (var c = 0; c < cands.length; c++) {
				var A = cands[c].a, B = cands[c].b;
				if (A._dead || B._dead || used.has(A) || used.has(B)) continue;
				var big = A._tiles.length >= B._tiles.length ? A : B;   // merge smaller into larger
				var small = big === A ? B : A;
				for (var z = 0; z < small._tiles.length; z++) {
					claimed.set(small._tiles[z], big);
					big._tiles.push(small._tiles[z]);
				}
				small._dead = true;
				used.add(big); used.add(small);
				merged++;
			}
			if (merged === 0) break;
		}
	}

	// ==================================================================
	// DRAINAGE BASINS  (used by Approach E's land-follows-basins mode)
	// ==================================================================
	function drainOutlet(tile, set, memo) {
		if (memo.has(tile)) return memo.get(tile);
		var path = [], cur = tile, guard = 0, out = tile;
		while (cur && guard++ < 100000) {
			if (memo.has(cur)) { out = memo.get(cur); break; }
			path.push(cur);
			var d = cur.drain;
			if (!d || d.elevation <= 0 || !set.has(d)) { out = cur; break; }
			cur = d;
		}
		for (var i = 0; i < path.length; i++) memo.set(path[i], out);
		return out;
	}

	function groupByBasin(landTiles, set) {
		var memo = new Map(), groups = new Map();
		for (var i = 0; i < landTiles.length; i++) {
			var o = drainOutlet(landTiles[i], set, memo);
			var arr = groups.get(o.id);
			if (!arr) { arr = []; groups.set(o.id, arr); }
			arr.push(landTiles[i]);
		}
		return Array.from(groups.values());
	}

	// ==================================================================
	// APPROACH E: GRANULOMETRIC THICKNESS  (+ neck cut, + basin mode)
	// ==================================================================
	function computeThickness(tiles, bodies) {
		for (var i = 0; i < tiles.length; i++) tiles[i]._thick = 0;
		var cap = CONFIG.thicknessMax;
		bodies.forEach(function (bt) {
			var set = new Set(bt);
			var src = bt.slice().sort(function (a, b) { return fieldValue(b) - fieldValue(a); });
			for (var s = 0; s < src.length; s++) {
				var u = src[s], val = fieldValue(u);
				if (val <= 0) break;
				if (u._thick >= val) continue;
				var r = Math.min(cap, Math.round(val)); if (r < 1) r = 1;
				var q = [u], qd = [0], head = 0, seen = new Set([u]);
				while (head < q.length) {
					var c = q[head], d = qd[head]; head++;
					if (c._thick < val) c._thick = val;
					if (d >= r) continue;
					var nb = c.tiles;
					for (var k = 0; k < nb.length; k++) {
						var n = nb[k];
						if (set.has(n) && !seen.has(n)) { seen.add(n); q.push(n); qd.push(d + 1); }
					}
				}
			}
		});
	}

	// Narrow necks act as walls so straits/isthmuses are cut first.
	function neckPassable(tile) { return fieldValue(tile) > CONFIG.neckWidth; }

	function computeEForBody(bodyTiles, idState, allOut) {
		var set = new Set(bodyTiles);
		var root = newSplitFeature(bodyTiles, null, 1, idState, "E", thickValue);
		buildSplitHierarchy(bodyTiles, set, root, 1, CONFIG.thicknessMax, allOut, idState, "E", thickValue, "_eFinest", neckPassable);
	}

	// ==================================================================
	// APPROACH A: PLATE PROVINCES  (plates as large features + smart boundaries)
	// ==================================================================
	// Large features come straight from the tectonic plates. The raw plate
	// boundaries are tectonic noise (jagged, ignore coastlines), so we apply
	// "smart boundary" logic: a few majority-vote smoothing passes relax single-
	// tile intrusions and pull the boundary toward the locally dominant plate,
	// then tiny leftover provinces are merged into their main neighbour. Operates
	// over ALL tiles (land + water), since plates span both.
	// opts: { prop, approach, merge }. Approach A passes the defaults; Approach N
	// passes a per-domain { land, water } cohesion strength via opts.merge.
	function computePlateProvinces(tiles, idState, allOut, opts) {
		opts = opts || {};
		var PROP = opts.prop || "hierarchyA";
		var APPROACH = opts.approach || "A";
		var NONE = { none: true };
		function pkey(t) { return t.plate || NONE; }

		var assign = new Map();
		for (var i = 0; i < tiles.length; i++) assign.set(tiles[i], pkey(tiles[i]));

		var iters = CONFIG.plateSmooth | 0;
		for (var s = 0; s < iters; s++) {
			var next = new Map();
			for (var j = 0; j < tiles.length; j++) {
				var t = tiles[j];
				var counts = new Map();
				counts.set(assign.get(t), 1.5);                 // bias toward keeping own plate
				var nb = t.tiles;
				for (var k = 0; k < nb.length; k++) {
					var key = assign.get(nb[k]);
					counts.set(key, (counts.get(key) || 0) + 1);
				}
				var best = assign.get(t), bc = -1;
				counts.forEach(function (v, key) { if (v > bc) { bc = v; best = key; } });
				next.set(t, best);
			}
			assign = next;
		}

		// "Smart boundary" step 2 - donate domain misfits. A plate is mostly land
		// or mostly ocean; a land tile stranded on an ocean-majority plate (or an
		// ocean tile on a land-majority plate) is donated to the plate of its
		// NEAREST same-domain tile, so provinces never contain the wrong domain.
		var plLand = new Map(), plWater = new Map();
		for (var pi = 0; pi < tiles.length; pi++) {
			var pp = assign.get(tiles[pi]);
			if (isLand(tiles[pi])) plLand.set(pp, (plLand.get(pp) || 0) + 1);
			else plWater.set(pp, (plWater.get(pp) || 0) + 1);
		}
		function plateMajLand(p) { return (plLand.get(p) || 0) >= (plWater.get(p) || 0); }
		// Multi-source BFS over the whole graph: each tile learns the assignment of
		// the nearest "good" (domain matches its plate's majority) same-domain tile.
		function floodOwner(isSource) {
			var own = new Map(), q = [], h = 0;
			for (var a = 0; a < tiles.length; a++) if (isSource(tiles[a])) { own.set(tiles[a], assign.get(tiles[a])); q.push(tiles[a]); }
			while (h < q.length) {
				var c = q[h++], nb = c.tiles;
				for (var k = 0; k < nb.length; k++) { var n = nb[k]; if (!own.has(n)) { own.set(n, own.get(c)); q.push(n); } }
			}
			return own;
		}
		var landOwner = floodOwner(function (t) { return isLand(t) && plateMajLand(assign.get(t)); });
		var waterOwner = floodOwner(function (t) { return !isLand(t) && !plateMajLand(assign.get(t)); });
		for (var mi = 0; mi < tiles.length; mi++) {
			var mt = tiles[mi], mp = assign.get(mt);
			if (isLand(mt) && !plateMajLand(mp)) { var np = landOwner.get(mt); if (np !== undefined) assign.set(mt, np); }
			else if (!isLand(mt) && plateMajLand(mp)) { var nq = waterOwner.get(mt); if (nq !== undefined) assign.set(mt, nq); }
		}

		// Contiguous same-plate regions = provinces.
		var visited = new Set(), regions = [], owner = new Map();
		for (var a = 0; a < tiles.length; a++) {
			var t0 = tiles[a];
			if (visited.has(t0)) continue;
			var pl = assign.get(t0);
			var region = makeFeature(APPROACH, isLand(t0), 1, null, t0, fieldValue(t0), idState);
			region._tiles = [];
			var stack = [t0]; visited.add(t0);
			while (stack.length) {
				var c = stack.pop();
				region._tiles.push(c); owner.set(c, region);
				var nb2 = c.tiles;
				for (var m = 0; m < nb2.length; m++) {
					var n = nb2[m];
					if (!visited.has(n) && assign.get(n) === pl) { visited.add(n); stack.push(n); }
				}
			}
			regions.push(region);
		}

		mergeSmallRegions(regions, owner, CONFIG.plateMinSize, true);   // same-domain merges only
		// `opts.merge` (number or {land, water}) overrides the default strength.
		mergeByCohesion(regions, owner, opts.merge !== undefined ? opts.merge : CONFIG.plateMerge);
		var survivors = regions.filter(function (r) { return !r._dead; });
		for (var sv = 0; sv < survivors.length; sv++) allOut.push(survivors[sv]);
		for (var ti = 0; ti < tiles.length; ti++) {
			var o = owner.get(tiles[ti]);
			tiles[ti][PROP] = (o && !o._dead) ? [o] : null;
		}
	}

	// ==================================================================
	// APPROACH N LAND NESTING: PENINSULAS & ISTHMUSES INSIDE PROVINCES
	// ==================================================================
	// For each LAND province from the split-cohesion pass, cut the province at
	// narrow necks (|shore| <= splitNeckWidth acts as a wall) into parts. The
	// LARGEST part is the province trunk and keeps the plain [province]
	// hierarchy; every other part becomes a nested level-2 feature (a peninsula
	// or appendage), and each wall component that connects two or more parts
	// becomes an explicit ISTHMUS feature. Water provinces are untouched.
	function nestLandProvincesN(tiles, features, idState) {
		var neckW = CONFIG.splitNeckWidth | 0;
		if (neckW <= 0) return;
		var minPart = Math.max(1, CONFIG.splitMinPart | 0);
		var provinces = features.slice().filter(function (f) { return !f._dead && f.isLand; });

		for (var pi = 0; pi < provinces.length; pi++) {
			var P = provinces[pi];
			var prov = P._tiles;
			if (!prov || prov.length < minPart * 2) continue;
			var provSet = new Set(prov);

			// Cores = connected components of the wide interior (|shore| > neckW).
			var cores = connectedComponentsAbove(prov, provSet, neckW, fieldValue);
			if (cores.length < 2) continue;

			// Grow every non-core tile out to its nearest core (walls included),
			// giving a full partition of the province into "parts".
			var groups = fillToCores(prov, provSet, cores);

			// Wall components (the necks themselves): connected runs of
			// |shore| <= neckW tiles that touch 2+ different parts -> isthmus.
			var partOf = new Map();
			for (var g = 0; g < groups.length; g++) {
				for (var gt = 0; gt < groups[g].length; gt++) partOf.set(groups[g][gt], g);
			}
			// A neck is a SHORT wall run joining 2+ parts. Long wall components
			// (e.g. an entire low-shore coastal ring that happens to touch two
			// cores) are not isthmuses - cap size by the cut width.
			var maxNeckSize = (2 * neckW + 1) * 4;
			var wallSeen = new Set(), isthmusComps = [];
			for (var wi = 0; wi < prov.length; wi++) {
				var w0 = prov[wi];
				if (fieldValue(w0) > neckW || wallSeen.has(w0)) continue;
				var comp = [], stack = [w0]; wallSeen.add(w0);
				var touched = new Set();
				while (stack.length) {
					var c = stack.pop(); comp.push(c);
					var nb = c.tiles;
					for (var k = 0; k < nb.length; k++) {
						var n = nb[k];
						if (!provSet.has(n)) continue;
						if (fieldValue(n) <= neckW) {
							if (!wallSeen.has(n)) { wallSeen.add(n); stack.push(n); }
						} else {
							touched.add(partOf.get(n));
						}
					}
				}
				if (touched.size >= 2 && comp.length >= 2 && comp.length <= maxNeckSize) isthmusComps.push(comp);
			}
			var isthmusTiles = new Set();
			for (var ic = 0; ic < isthmusComps.length; ic++) {
				for (var it = 0; it < isthmusComps[ic].length; it++) isthmusTiles.add(isthmusComps[ic][it]);
			}

			// Build child features. The largest part is the trunk: no child.
			var order = groups.map(function (grp, gi) { return gi; }).sort(function (a, b) {
				return groups[b].length - groups[a].length;
			});
			var trunkIdx = order[0];
			var children = [], claimed = new Map();
			for (var oi = 0; oi < order.length; oi++) {
				var gi2 = order[oi];
				if (gi2 === trunkIdx) continue;
				var part = groups[gi2].filter(function (t) { return !isthmusTiles.has(t); });
				if (part.length === 0) continue;
				var maxW = 0, rootT = part[0];
				for (var pt = 0; pt < part.length; pt++) {
					if (fieldValue(part[pt]) > maxW) { maxW = fieldValue(part[pt]); rootT = part[pt]; }
				}
				var child = makeFeature("N", true, 2, P, rootT, maxW, idState);
				child._tiles = part;
				for (var ct = 0; ct < part.length; ct++) claimed.set(part[ct], child);
				children.push(child);
			}
			for (var nc = 0; nc < isthmusComps.length; nc++) {
				var necks = isthmusComps[nc];
				var neck = makeFeature("N", true, 2, P, necks[0], neckW, idState);
				neck._tiles = necks.slice();
				neck._isNeck = true;
				for (var nt = 0; nt < necks.length; nt++) claimed.set(necks[nt], neck);
				children.push(neck);
			}
			if (children.length === 0) continue;

			// Absorb tiny non-neck parts into the sibling they touch most
			// (never into a neck; necks stay, they are the point).
			for (var ai = 0; ai < children.length; ai++) {
				var R = children[ai];
				if (R._dead || R._isNeck || R._tiles.length >= minPart) continue;
				var counts = new Map(), best = null, bestC = 0;
				for (var rt = 0; rt < R._tiles.length; rt++) {
					var rnb = R._tiles[rt].tiles;
					for (var rk = 0; rk < rnb.length; rk++) {
						var o = claimed.get(rnb[rk]);
						if (!o || o === R || o._dead || o._isNeck) continue;
						var cc = (counts.get(o) || 0) + 1; counts.set(o, cc);
						if (cc > bestC) { bestC = cc; best = o; }
					}
				}
				if (!best) {
					// isolated tiny part: return its tiles to the trunk
					for (var rz = 0; rz < R._tiles.length; rz++) claimed.delete(R._tiles[rz]);
					R._dead = true;
					continue;
				}
				for (var rm = 0; rm < R._tiles.length; rm++) {
					claimed.set(R._tiles[rm], best);
					best._tiles.push(R._tiles[rm]);
				}
				R._dead = true;
			}

			var survivors = children.filter(function (c) { return !c._dead; });
			for (var si = 0; si < survivors.length; si++) {
				P.children.push(survivors[si]);
				features.push(survivors[si]);
				for (var st = 0; st < survivors[si]._tiles.length; st++) {
					survivors[si]._tiles[st].hierarchyN = [P, survivors[si]];
				}
			}
		}
	}

	// ==================================================================
	// CLASSIFICATION
	// ==================================================================
	function classifyFeature(feature, totals) {
		var size = feature.regionTiles.length;
		var maxW = feature.maxW || 1;
		var aspect = size / Math.max(1, maxW * maxW);
		var isConnector = (maxW <= 4 && aspect > 4 && size > 3);
		var isRoot = !feature.parent;
		if (feature.isLand) {
			var T = Math.max(1, totals.land);
			if (isRoot) return size > 0.15 * T ? "Continent" : (size > 0.01 * T ? "Island" : "Islet");
			if (isConnector) return "Isthmus";
			if (size > 0.05 * T) return "Peninsula";
			if (size > 0.012 * T) return "Headland";
			return "Cape";
		} else {
			var W = Math.max(1, totals.water);
			if (isRoot) return size > 0.25 * W ? "Ocean" : (size > 0.03 * W ? "Sea" : "Lake");
			if (isConnector) return "Strait";
			if (size > 0.05 * W) return "Gulf";
			if (size > 0.012 * W) return "Bay";
			return "Inlet";
		}
	}

	function classifyAll(features, totals) {
		var counters = {};
		features.sort(function (a, b) { return a.id - b.id; });
		for (var i = 0; i < features.length; i++) {
			var f = features[i];
			f.classification = classifyFeature(f, totals);
			counters[f.classification] = (counters[f.classification] || 0) + 1;
			f.name = f.classification + " " + counters[f.classification];
		}
	}

	function classifySimple(features, prefix) {
		features.sort(function (a, b) { return b.regionTiles.length - a.regionTiles.length; });
		for (var i = 0; i < features.length; i++) {
			features[i].classification = prefix;
			features[i].name = prefix + " " + (i + 1);
		}
	}

	// ==================================================================
	// PER-TILE HIERARCHY ASSIGNMENT + MARKER PLACEMENT
	// ==================================================================
	function groupByBody(tiles) {
		var bodies = new Map();
		for (var i = 0; i < tiles.length; i++) {
			var t = tiles[i];
			if (fieldValue(t) === 0) continue;
			var key = t.body ? t.body.id : ("solo" + i);
			var arr = bodies.get(key);
			if (!arr) { arr = []; bodies.set(key, arr); }
			arr.push(t);
		}
		return bodies;
	}

	function populateRegions(tiles, hierProp) {
		for (var i = 0; i < tiles.length; i++) {
			var h = tiles[i][hierProp];
			if (!h) continue;
			for (var j = 0; j < h.length; j++) h[j].regionTiles.push(tiles[i]);
		}
	}

	// Set each feature.root to the tile FURTHEST from any other feature: a pole of
	// inaccessibility found by BFS inward from the feature region's outer boundary.
	function assignFeatureMarkers(features) {
		for (var i = 0; i < features.length; i++) {
			var f = features[i];
			var region = f.regionTiles;
			if (!region || !region.length) continue;
			var inSet = new Set(region);
			var dist = new Map(), queue = [], qh = 0;
			for (var r = 0; r < region.length; r++) {
				var t = region[r], nb = t.tiles, isB = false;
				for (var k = 0; k < nb.length; k++) { if (!inSet.has(nb[k])) { isB = true; break; } }
				if (isB) { dist.set(t, 0); queue.push(t); }
			}
			if (!queue.length) { f.root = region[0]; continue; }   // whole-planet body
			var best = queue[0], bestD = 0;
			while (qh < queue.length) {
				var c = queue[qh++], d = dist.get(c);
				if (d > bestD) { bestD = d; best = c; }
				var nb2 = c.tiles;
				for (var k2 = 0; k2 < nb2.length; k2++) {
					var n = nb2[k2];
					if (inSet.has(n) && !dist.has(n)) { dist.set(n, d + 1); queue.push(n); }
				}
			}
			f.root = best;
		}
	}

	var DATA = null;

	function computeAll(tiles) {
		for (var i = 0; i < tiles.length; i++) {
			tiles[i]._bFinest = null; tiles[i]._eFinest = null; tiles[i]._thick = 0;
			tiles[i].hierarchyA = null; tiles[i].hierarchyB = null;
			tiles[i].hierarchyE = null; tiles[i].hierarchyN = null;
		}
		var bodies = groupByBody(tiles);
		var totals = { land: 0, water: 0 };
		for (var t = 0; t < tiles.length; t++) {
			if (fieldValue(tiles[t]) === 0) continue;
			if (isLand(tiles[t])) totals.land++; else totals.water++;
		}

		// ---- Approach A (plate provinces) ----
		var idA = { next: 1 };
		var featuresA = [];
		computePlateProvinces(tiles, idA, featuresA);
		populateRegions(tiles, "hierarchyA");
		assignFeatureMarkers(featuresA);
		classifySimple(featuresA, "Plate");

		// ---- Approach N (split-cohesion provinces + land nesting) ----
		// Plate provinces with separate cohesion strengths per domain (ocean
		// provinces fuse aggressively into large seas; land provinces stay
		// fragmented), then land provinces are cut at narrow necks into nested
		// peninsula parts with explicit isthmus features.
		var idN = { next: 16000000 };
		var featuresN = [];
		computePlateProvinces(tiles, idN, featuresN, {
			prop: "hierarchyN", approach: "N",
			merge: { land: CONFIG.splitMergeLand, water: CONFIG.splitMergeOcean }
		});
		nestLandProvincesN(tiles, featuresN, idN);
		populateRegions(tiles, "hierarchyN");
		assignFeatureMarkers(featuresN);
		classifyAll(featuresN, totals);
		// In N the isthmus label is structural: necks are isthmuses by
		// construction, and a nested non-neck part is always a peninsula-type
		// feature even when long and thin (the generic connector heuristic
		// would otherwise mislabel narrow peninsulas as isthmuses).
		var isthmusCount = 0, renamedCounts = {};
		for (var ni = 0; ni < featuresN.length; ni++) {
			var fN = featuresN[ni];
			if (fN._dead) continue;
			if (fN._isNeck) {
				fN.classification = "Isthmus";
				fN.name = "Isthmus N" + (++isthmusCount);
			} else if (fN.level === 2 && (fN.classification === "Isthmus" || fN.classification === "Strait")) {
				var szN = fN.regionTiles.length, TN = Math.max(1, totals.land);
				fN.classification = szN > 0.05 * TN ? "Peninsula" : (szN > 0.012 * TN ? "Headland" : "Cape");
				renamedCounts[fN.classification] = (renamedCounts[fN.classification] || 0) + 1;
				fN.name = fN.classification + " N" + renamedCounts[fN.classification];
			}
		}

		// ---- Approach B (erosion split) ----
		var idB = { next: 1000000 };
		var featuresB = [];
		bodies.forEach(function (bt) {
			var set = new Set(bt);
			var root = newSplitFeature(bt, null, 1, idB, "B", fieldValue);
			buildSplitHierarchy(bt, set, root, 1, CONFIG.maxErosion, featuresB, idB, "B", fieldValue, "_bFinest");
		});
		assignSplitChains(tiles, "_bFinest", "hierarchyB");
		populateRegions(tiles, "hierarchyB");
		assignFeatureMarkers(featuresB);
		classifyAll(featuresB, totals);

		// ---- Approach E (granulometric thickness, + neck cut, + basin snap) ----
		// Separate land/water id ranges so the land-only basin snap can never shift
		// water feature ids (and therefore water colors).
		computeThickness(tiles, bodies);
		var idELand = { next: 5000000 }, idEWater = { next: 8000000 };
		var featuresE = [];
		bodies.forEach(function (bt) { computeEForBody(bt, isLand(bt[0]) ? idELand : idEWater, featuresE); });
		// Optional land-only basin rule (does not touch water or add features).
		if (CONFIG.eFollowBasins) relabelLandByBasin(tiles, bodies);
		assignSplitChains(tiles, "_eFinest", "hierarchyE");
		populateRegions(tiles, "hierarchyE");
		featuresE = featuresE.filter(function (f) { return f.regionTiles.length > 0; }); // drop leaves emptied by the relabel
		assignFeatureMarkers(featuresE);
		classifyAll(featuresE, totals);

		// 5-colour-map graph colouring for every approach (land + ocean independently).
		assignFeatureGraphColors(tiles, "hierarchyA");
		assignFeatureGraphColors(tiles, "hierarchyB");
		assignFeatureGraphColors(tiles, "hierarchyE");
		assignFeatureGraphColors(tiles, "hierarchyN");

		DATA = {
			totals: totals,
			featuresByApproach: { A: featuresA, B: featuresB, E: featuresE, N: featuresN },
			counts: { A: featuresA.length, B: featuresB.length, E: featuresE.length, N: featuresN.length }
		};
		return DATA;
	}

	// ==================================================================
	// COLOR OVERLAYS
	// ==================================================================
	// Every feature overlay is drawn as a 5-COLOUR MAP: a greedy graph colouring
	// (assignFeatureGraphColors) gives each finest feature a palette index 0..4 so
	// adjacent same-domain features never share a colour. Land and ocean use
	// separate 5-colour schemes. All swatches are editable in the Layer Colors panel.
	var FEATURE_LAND_PALETTE_DEFAULT  = ["#8bc34a", "#cddc39", "#4caf50", "#c5a35a", "#9e9d24"];
	var FEATURE_WATER_PALETTE_DEFAULT = ["#42a5f5", "#26c6da", "#5c6bc0", "#4dd0e1", "#1e88e5"];

	function _featBase(tile, overlayId) {
		return isLand(tile)
			? new THREE.Color(getOverlayColor(overlayId, "landBase", "#74ad5a"))
			: new THREE.Color(getOverlayColor(overlayId, "waterBase", "#4f86c6"));
	}
	function _featPalette(feature, land, overlayId) {
		var idx = (feature.colorIndex != null) ? feature.colorIndex : (feature.id || 0);
		return getOverlayPaletteColor(overlayId, land ? "land" : "water", idx,
			land ? FEATURE_LAND_PALETTE_DEFAULT : FEATURE_WATER_PALETTE_DEFAULT);
	}

	// Flat 5-colour-map colour for a tile's finest feature (shared by every overlay).
	function makeFeatureColorFn(prop, overlayId) {
		return function (tile) {
			var arr = tile[prop];
			if (!arr || arr.length === 0) {
				if (fieldValue(tile) === 0) return new THREE.Color(getOverlayColor(overlayId, "unassigned", "#888888"));
				return _featBase(tile, overlayId);
			}
			return _featPalette(arr[arr.length - 1], isLand(tile), overlayId);
		};
	}

	// Root-marker colour: the feature's 5-colour-map colour (overlayId omitted so it
	// falls back to the default palette).
	function featureHueColor(feature, land, overlayId) {
		return _featPalette(feature, land, overlayId);
	}

	// Greedy graph colouring: give each finest feature a palette index 0..4 such
	// that adjacent same-domain features differ. Planar region adjacency is
	// 4-colourable, so 5 colours leave comfortable slack. Land and ocean are
	// coloured independently (their adjacency graphs never connect across a coast).
	function assignFeatureGraphColors(tiles, prop) {
		var K = 5;
		var adj = new Map(), feats = [];
		function ensure(f) { if (!adj.has(f)) { adj.set(f, new Set()); feats.push(f); f.colorIndex = null; } }
		for (var i = 0; i < tiles.length; i++) {
			var t = tiles[i], arr = t[prop];
			if (!arr || !arr.length) continue;
			var f = arr[arr.length - 1];
			if (!f) continue;
			ensure(f);
			var nb = t.tiles;
			for (var k = 0; k < nb.length; k++) {
				var n = nb[k];
				if (isLand(n) !== isLand(t)) continue;          // separate land/ocean schemes
				var arr2 = n[prop];
				if (!arr2 || !arr2.length) continue;
				var g = arr2[arr2.length - 1];
				if (!g || g === f) continue;
				ensure(g); adj.get(f).add(g); adj.get(g).add(f);
			}
		}
		// Colour high-degree (then large) features first to minimise conflicts.
		feats.sort(function (a, b) {
			var da = adj.get(a).size, db = adj.get(b).size;
			if (db !== da) return db - da;
			return (b.regionTiles ? b.regionTiles.length : 0) - (a.regionTiles ? a.regionTiles.length : 0);
		});
		for (var fi = 0; fi < feats.length; fi++) {
			var ff = feats[fi], neigh = adj.get(ff);
			var used = [], chosen = -1;
			neigh.forEach(function (g2) { if (g2.colorIndex != null) used[g2.colorIndex] = true; });
			for (var c = 0; c < K; c++) if (!used[c]) { chosen = c; break; }
			if (chosen < 0) {                                   // >K neighbours coloured: least-used colour
				var cnt = [0, 0, 0, 0, 0];
				neigh.forEach(function (g3) { if (g3.colorIndex != null) cnt[g3.colorIndex]++; });
				chosen = 0; for (var c2 = 1; c2 < K; c2++) if (cnt[c2] < cnt[chosen]) chosen = c2;
			}
			ff.colorIndex = chosen;
		}
	}

	// Register the editable palette + base slots for a feature overlay id.
	function defineFeatureColorSlots(overlayId) {
		if (typeof defineOverlayPalette !== "function") return;
		defineOverlayPalette(overlayId, "land",  "Land features",  FEATURE_LAND_PALETTE_DEFAULT);
		defineOverlayPalette(overlayId, "water", "Water features", FEATURE_WATER_PALETTE_DEFAULT);
		defineOverlayColors(overlayId, [
			{ key: "landBase",   label: "Land base",  def: "#74ad5a" },
			{ key: "waterBase",  label: "Water base", def: "#4f86c6" },
			{ key: "unassigned", label: "Unassigned", def: "#888888" }
		]);
	}

	function unregisterFeatureOverlays() {
		if (typeof colorOverlayRegistry === "undefined") return;
		for (var i = 0; i < REGISTERED_IDS.length; i++) delete colorOverlayRegistry[REGISTERED_IDS[i]];
	}

	function registerFeatureOverlays() {
		if (typeof registerColorOverlay !== "function") return;
		registerColorOverlay("featPlatesA", "Features A: Plate provinces",
			"Approach A. Tectonic plates as large features with smoothed (smart) boundaries. 5-colour map.",
			makeFeatureColorFn("hierarchyA", "featPlatesA"), "basic", "lazy", "features");
		registerColorOverlay("featNestedB", "Features B: Nested (erosion)",
			"Approach B. Recursive erosion split. 5-colour map; hover for outlines + names.",
			makeFeatureColorFn("hierarchyB", "featNestedB"), "basic", "lazy", "features");
		registerColorOverlay("featThicknessE", "Features E: Thickness (granulometry)",
			"Approach E. Width-based nesting; cuts narrow necks; optional basin mode. 5-colour map.",
			makeFeatureColorFn("hierarchyE", "featThicknessE"), "basic", "lazy", "features");
		registerColorOverlay("featSplitN", "Features N: Split cohesion (land/ocean)",
			"Plate provinces with separate cohesion merge per domain (ocean fuses into big seas, land stays fine-grained), plus nested peninsula/isthmus features inside land provinces. 5-colour map.",
			makeFeatureColorFn("hierarchyN", "featSplitN"), "basic", "lazy", "features");
		for (var i = 0; i < REGISTERED_IDS.length; i++) defineFeatureColorSlots(REGISTERED_IDS[i]);
	}

	// ==================================================================
	// PROJECTION HELPERS (shared by hover + roots)
	// ==================================================================
	function isMercator() { return typeof projectionMode !== "undefined" && projectionMode === "mercator"; }
	function isRaised() { return typeof useElevationDisplacement !== "undefined" && useElevationDisplacement; }

	function projectCorner(corner) {
		if (isMercator()) {
			var m = cartesianToMercator(corner.position, mercatorCenterLat, mercatorCenterLon);
			var z = 0.26;
			if (isRaised() && corner.elevationMedian > 0 && corner.elevationDisplacement) z += corner.elevationDisplacement * 0.04;
			return new THREE.Vector3(m.x * 2.0, m.y * 2.0, z);
		}
		var p = corner.position.clone();
		var len = p.length();
		var off = 4;
		if (isRaised() && corner.elevationDisplacement) off += corner.elevationDisplacement;
		return p.normalize().multiplyScalar(len + off);
	}

	function projectTileCenter(tile) {
		var ap = tile.averagePosition;
		if (isMercator()) {
			var m = cartesianToMercator(ap, mercatorCenterLat, mercatorCenterLon);
			return new THREE.Vector3(m.x * 2.0, m.y * 2.0, 0.34);
		}
		var p = ap.clone();
		var len = p.length();
		return p.normalize().multiplyScalar(len + 7);
	}

	// ==================================================================
	// HOVER: outlines + popup labels
	// ==================================================================
	var hoverState = { tile: null, lineObjects: [], labelSprites: [], lastPickTime: 0, attached: false };

	function currentApproach() {
		if (typeof surfaceRenderMode === "undefined") return null;
		return OVERLAYS[surfaceRenderMode] || null;
	}

	function clearHoverArtifacts() {
		for (var i = 0; i < hoverState.lineObjects.length; i++) {
			var o = hoverState.lineObjects[i];
			if (o.parent) o.parent.remove(o);
			if (o.geometry) o.geometry.dispose();
			if (o.material) o.material.dispose();
		}
		hoverState.lineObjects = [];
		for (var j = 0; j < hoverState.labelSprites.length; j++) {
			var s = hoverState.labelSprites[j];
			if (s.parent) s.parent.remove(s);
			if (s.material && s.material.map) s.material.map.dispose();
			if (s.material) s.material.dispose();
		}
		hoverState.labelSprites = [];
		hoverState.tile = null;
	}

	function sharedCorners(a, b) {
		var res = [];
		for (var i = 0; i < a.corners.length; i++) {
			if (b.corners.indexOf(a.corners[i]) >= 0) res.push(a.corners[i]);
		}
		return res;
	}

	function featureBoundaryPairs(feature) {
		if (feature._boundaryPairs) return feature._boundaryPairs;
		var pairs = [];
		var level = feature.level;
		var prop = APPROACH_PROP[feature.approach];
		function inFeature(tile) {
			var h = tile[prop];
			return h && h.length >= level && h[level - 1] === feature;
		}
		var region = feature.regionTiles;
		for (var i = 0; i < region.length; i++) {
			var tile = region[i];
			var nb = tile.tiles;
			for (var k = 0; k < nb.length; k++) {
				if (inFeature(nb[k])) continue;
				var sc = sharedCorners(tile, nb[k]);
				if (sc.length === 2) pairs.push([sc[0], sc[1]]);
			}
		}
		feature._boundaryPairs = pairs;
		return pairs;
	}

	function buildBoundaryLineObject(features) {
		var mercator = isMercator();
		var period = Math.PI * 4.0;
		var half = period / 2;
		var positions = [];

		function emit(a, b) {
			if (mercator) {
				if (Math.abs(a.x - b.x) > half) {
					if (a.x > b.x) a = a.clone().setX(a.x - period);
					else b = b.clone().setX(b.x - period);
				}
				for (var o = -1; o <= 1; o++) {
					positions.push(a.x + o * period, a.y, a.z, b.x + o * period, b.y, b.z);
				}
			} else {
				positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
			}
		}

		for (var f = 0; f < features.length; f++) {
			var pairs = featureBoundaryPairs(features[f]);
			for (var i = 0; i < pairs.length; i++) {
				emit(projectCorner(pairs[i][0]), projectCorner(pairs[i][1]));
			}
		}
		if (!positions.length) return null;
		var geo = new THREE.BufferGeometry();
		geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
		var mat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.85, depthTest: false });
		var obj = new THREE.LineSegments(geo, mat);
		obj.renderOrder = 999;
		return obj;
	}

	function makeHoverLabelSprite(text) {
		var fontSize = 40;
		var canvas = document.createElement("canvas");
		var ctx = canvas.getContext("2d");
		ctx.font = fontSize + "px Arial, sans-serif";
		var w = ctx.measureText(text).width;
		var pad = 14;
		canvas.width = w + pad * 2;
		canvas.height = fontSize + pad * 2;
		ctx.font = fontSize + "px Arial, sans-serif";
		ctx.textAlign = "center"; ctx.textBaseline = "middle";
		ctx.fillStyle = "rgba(0,0,0,0.55)";
		var r = 12, x = 0, y = 0, ww = canvas.width, hh = canvas.height;
		ctx.beginPath();
		ctx.moveTo(x + r, y);
		ctx.arcTo(x + ww, y, x + ww, y + hh, r);
		ctx.arcTo(x + ww, y + hh, x, y + hh, r);
		ctx.arcTo(x, y + hh, x, y, r);
		ctx.arcTo(x, y, x + ww, y, r);
		ctx.closePath(); ctx.fill();
		ctx.fillStyle = "rgba(255,255,255,0.95)";
		ctx.fillText(text, canvas.width / 2, canvas.height / 2);

		var tex = new THREE.CanvasTexture(canvas); tex.needsUpdate = true;
		var mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
		var sprite = new THREE.Sprite(mat);
		sprite.renderOrder = 1000;
		var scale = (typeof calculateLabelScale === "function") ? calculateLabelScale() : 1;
		var s = isMercator() ? scale * 0.8 : scale * 0.6;
		sprite.scale.set(s, s * (canvas.height / canvas.width), 1);
		return sprite;
	}

	function showHoverLabels(features) {
		for (var i = 0; i < features.length; i++) {
			var feat = features[i];
			if (!feat.root || !feat.root.averagePosition) continue;
			var sprite = makeHoverLabelSprite(feat.name || feat.classification || "?");
			var pos = (typeof calculateLabelPosition === "function")
				? calculateLabelPosition(feat.root.averagePosition, 60)
				: feat.root.averagePosition.clone();
			sprite.position.copy(pos);
			if (scene) { scene.add(sprite); hoverState.labelSprites.push(sprite); }
		}
	}

	function pickHoveredTile() {
		if (typeof planet === "undefined" || !planet || !planet.topology) return null;
		var mx = (typeof mouseX !== "undefined") ? mouseX : 0;
		var my = (typeof mouseY !== "undefined") ? mouseY : 0;
		if (isMercator()) {
			if (!camera) return null;
			var worldX = 2 * mercatorCameraX + (mx * (camera.right - camera.left)) / 2;
			var worldY = 2 * mercatorCameraY + (my * (camera.top - camera.bottom)) / 2;
			var pos = mercatorToCartesian(worldX / 2.0, worldY / 2.0, mercatorCenterLat, mercatorCenterLon);
			var best = null, bd = Infinity, tiles = planet.topology.tiles;
			for (var i = 0; i < tiles.length; i++) {
				var d = tiles[i].averagePosition.distanceTo(pos);
				if (d < bd) { bd = d; best = tiles[i]; }
			}
			return best;
		}
		if (!camera || !planet.partition) return null;
		var ray = new THREE.Raycaster();
		ray.setFromCamera({ x: mx, y: my }, camera);
		var hit = planet.partition.intersectRay(ray.ray);
		return hit || null;
	}

	function updateHover() {
		var approach = currentApproach();
		if (!approach) { if (hoverState.tile) clearHoverArtifacts(); return; }

		var now = Date.now();
		if (now - hoverState.lastPickTime < 50) return;
		hoverState.lastPickTime = now;

		var tile = pickHoveredTile();
		if (!tile) { if (hoverState.tile) clearHoverArtifacts(); return; }
		if (tile === hoverState.tile) return;

		applyHoverForTile(tile, approach);
	}

	function applyHoverForTile(tile, approach) {
		approach = approach || currentApproach() || "B";
		clearHoverArtifacts();
		hoverState.tile = tile;
		var hierarchy = tile[APPROACH_PROP[approach]];
		if (!hierarchy || !hierarchy.length) return;
		var lineObj = buildBoundaryLineObject(hierarchy);
		if (lineObj && scene) { scene.add(lineObj); hoverState.lineObjects.push(lineObj); }
		showHoverLabels(hierarchy);
	}

	function attachHover() {
		if (hoverState.attached) return;
		hoverState.attached = true;
		document.addEventListener("mousemove", function () {
			try { updateHover(); } catch (e) { console.warn("hover error:", e); }
		});
	}

	// ==================================================================
	// FEATURE ROOTS / NODE-TREE VISUALIZATION
	// ==================================================================
	var rootsState = { object: null, enabled: false };
	var DISC_TEXTURE = null;

	function discTexture() {
		if (DISC_TEXTURE) return DISC_TEXTURE;
		var size = 64, canvas = document.createElement("canvas");
		canvas.width = canvas.height = size;
		var ctx = canvas.getContext("2d");
		var g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
		g.addColorStop(0.0, "rgba(255,255,255,1)");
		g.addColorStop(0.6, "rgba(255,255,255,1)");
		g.addColorStop(0.75, "rgba(255,255,255,0.9)");
		g.addColorStop(1.0, "rgba(255,255,255,0)");
		ctx.fillStyle = g;
		ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); ctx.fill();
		ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 4;
		ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2 - 6, 0, Math.PI * 2); ctx.stroke();
		DISC_TEXTURE = new THREE.CanvasTexture(canvas);
		DISC_TEXTURE.needsUpdate = true;
		return DISC_TEXTURE;
	}

	function disposeGroup(group) {
		group.traverse(function (o) {
			if (o.geometry) o.geometry.dispose();
			if (o.material) o.material.dispose();
		});
	}

	function clearFeatureRoots() {
		if (rootsState.object) {
			if (rootsState.object.parent) rootsState.object.parent.remove(rootsState.object);
			disposeGroup(rootsState.object);
			rootsState.object = null;
		}
	}

	function buildRootsObject() {
		var letter = currentApproach();
		if (!letter || !DATA || !DATA.featuresByApproach) return null;
		var feats = DATA.featuresByApproach[letter];
		if (!feats || !feats.length) return null;

		var mercator = isMercator();
		var period = Math.PI * 4.0, half = period / 2;
		var ptPos = [], ptCol = [], linePos = [], lineCol = [];

		for (var i = 0; i < feats.length; i++) {
			var f = feats[i];
			if (!f.root || !f.root.averagePosition) continue;
			var base = projectTileCenter(f.root);
			var col = featureHueColor(f, f.isLand);
			var rc = col.clone().lerp(new THREE.Color(0xffffff), 0.25);

			if (mercator) {
				for (var o = -1; o <= 1; o++) { ptPos.push(base.x + o * period, base.y, base.z); ptCol.push(rc.r, rc.g, rc.b); }
			} else {
				ptPos.push(base.x, base.y, base.z); ptCol.push(rc.r, rc.g, rc.b);
			}

			if (f.parent && f.parent.root && f.parent.root.averagePosition) {
				var pb = projectTileCenter(f.parent.root);
				var ax = base.x, bx = pb.x;
				if (mercator && Math.abs(ax - bx) > half) { if (ax > bx) ax -= period; else bx -= period; }
				if (mercator) {
					for (var o2 = -1; o2 <= 1; o2++) {
						linePos.push(ax + o2 * period, base.y, base.z, bx + o2 * period, pb.y, pb.z);
						lineCol.push(rc.r, rc.g, rc.b, rc.r, rc.g, rc.b);
					}
				} else {
					linePos.push(base.x, base.y, base.z, pb.x, pb.y, pb.z);
					lineCol.push(rc.r, rc.g, rc.b, rc.r, rc.g, rc.b);
				}
			}
		}

		var group = new THREE.Group();
		if (linePos.length) {
			var lg = new THREE.BufferGeometry();
			lg.setAttribute("position", new THREE.Float32BufferAttribute(linePos, 3));
			lg.setAttribute("color", new THREE.Float32BufferAttribute(lineCol, 3));
			var lm = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthTest: false });
			var lo = new THREE.LineSegments(lg, lm);
			lo.renderOrder = 1001;
			group.add(lo);
		}
		if (ptPos.length) {
			var pg = new THREE.BufferGeometry();
			pg.setAttribute("position", new THREE.Float32BufferAttribute(ptPos, 3));
			pg.setAttribute("color", new THREE.Float32BufferAttribute(ptCol, 3));
			var pm = new THREE.PointsMaterial({
				size: mercator ? 13 : 16, sizeAttenuation: false, map: discTexture(),
				transparent: true, alphaTest: 0.35, vertexColors: true, depthTest: false
			});
			var po = new THREE.Points(pg, pm);
			po.renderOrder = 1002;
			group.add(po);
		}
		return group.children.length ? group : null;
	}

	function rebuildFeatureRoots() {
		clearFeatureRoots();
		if (!rootsState.enabled) return;
		if (!currentApproach()) return;
		if (typeof scene === "undefined" || !scene) return;
		var obj = buildRootsObject();
		if (obj) { scene.add(obj); rootsState.object = obj; }
	}

	function toggleFeatureRoots(show) {
		rootsState.enabled = (typeof show === "boolean") ? show : !rootsState.enabled;
		rebuildFeatureRoots();
		return rootsState.enabled;
	}

	// debug accessors
	global.__fhDebug = {
		hoverState: hoverState,
		rootsState: rootsState,
		data: function () { return DATA; },
		updateHover: function () { return updateHover(); },
		applyHoverForTile: function (t, a) { return applyHoverForTile(t, a); },
		pick: function () { return pickHoveredTile(); },
		currentApproach: function () { return currentApproach(); }
	};

	// ==================================================================
	// PUBLIC ENTRY POINTS
	// ==================================================================
	function generateFeatureOverlays(planetObj) {
		if (!planetObj || !planetObj.topology || !planetObj.topology.tiles) {
			console.warn("generateFeatureOverlays: no topology");
			return;
		}
		console.time("featureDetection");
		clearHoverArtifacts();
		var data = computeAll(planetObj.topology.tiles);

		unregisterFeatureOverlays();
		registerFeatureOverlays();
		if (typeof populateColorOverlayDropdown === "function") populateColorOverlayDropdown();
		attachHover();
		rebuildFeatureRoots();

		console.timeEnd("featureDetection");
		console.log("Feature detection counts -> A:" + data.counts.A + " B:" + data.counts.B +
			" C:" + data.counts.C + " E:" + data.counts.E + " H:" + data.counts.H +
			" N:" + data.counts.N +
			" (land/water tiles " + data.totals.land + "/" + data.totals.water + ")");
	}

	function regenerateFeatureOverlays(overrides) {
		if (overrides) for (var k in overrides) CONFIG[k] = overrides[k];
		if (typeof planet !== "undefined" && planet) {
			generateFeatureOverlays(planet);
			if (typeof populateColorOverlayDropdown === "function") populateColorOverlayDropdown();
			if (typeof setSurfaceRenderMode === "function" && typeof surfaceRenderMode !== "undefined") {
				setSurfaceRenderMode(surfaceRenderMode, true);
			}
			rebuildFeatureRoots();
		}
		return CONFIG;
	}

	global.generateFeatureOverlays = generateFeatureOverlays;
	global.regenerateFeatureOverlays = regenerateFeatureOverlays;
	global.featureDetectionConfig = CONFIG;
	global.featureDetectionData = function () { return DATA; };
	global.toggleFeatureRoots = toggleFeatureRoots;
	global.rebuildFeatureRoots = rebuildFeatureRoots;
	global.featureApproachForMode = function (mode) { return OVERLAYS[mode] || null; };

})(typeof window !== "undefined" ? window : this);
