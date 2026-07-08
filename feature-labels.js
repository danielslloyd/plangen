// ============================================================================
// feature-labels.js — "Labels" overlay
//
// Adds a selectable color overlay ("Labels (named features)") that keeps the
// normal terrain colours but floats a procedurally-named label over every major
// geographic feature. Labels are built as real 3D geometry (one textured quad
// per glyph laid flat in the surface's tangent plane), so on the globe they sit
// above the terrain as objects in the scene and are occluded by mountains in
// front of them. Long features (rivers, mountain ranges, peninsulas) get their
// text bent along the feature's spine; blobby features get a straight label.
//
// Features come from three sources, independent of which colour overlay is
// active (per request, the land/water features always come from Approach N):
//   * Approach N land/water features  (featureDetectionData().featuresByApproach.N)
//   * Mountain & hill ranges          (computeMountainRanges -> tile._rangeId)
//   * Rivers                          (tile.river / tile.drain / tile.sources)
//
// Glyph size scales with the size of the feature. Text is kept upright (never
// upside-down), its path is smoothed to a minimum radius of curvature, and a
// per-frame screen-space pass hides labels that would overlap or that stack up
// when the Mercator map is zoomed out (largest features win).
// ============================================================================

(function (global) {
	var OVERLAY_ID = "featLabels";
	var labelState = { group: null };
	var placedLabels = [];     // [{ group, anchor, halfLen, halfUp, normal, priority }]
	var glyphTexCache = {};     // char -> THREE.CanvasTexture
	var REF_UP = new THREE.Vector3(0, 1, 0);   // planet "north" / screen up axis
	var MERC_PERIOD = Math.PI * 4.0;
	var MAX_TURN = 0.55;        // ~31°: max allowed bend between spine segments

	function isMercator() { return typeof projectionMode !== "undefined" && projectionMode === "mercator"; }
	function isRaised() { return typeof useElevationDisplacement !== "undefined" && useElevationDisplacement; }

	// ------------------------------------------------------------------
	// Deterministic name generator (seeded so names are stable per planet)
	// ------------------------------------------------------------------
	var SYL_A = ["ka", "tor", "val", "mor", "el", "bel", "dra", "fen", "gor", "hal",
		"ith", "jor", "kel", "lan", "mer", "nor", "os", "pyr", "quel", "ras",
		"syl", "thal", "ul", "vor", "wyn", "xan", "yr", "zel", "ar", "bre"];
	var SYL_B = ["a", "e", "i", "o", "u", "ae", "ia", "or", "an", "en", "ir", "un", "yl", "ow", "ar"];
	var SYL_C = ["dor", "mar", "wyn", "los", "gard", "heim", "thas", "rim", "vale", "fell",
		"moor", "reach", "wick", "stad", "land", "holm", "ney", "dell", "crag", "mere"];

	function seededRng(seed) {
		// Avalanche-mix the seed first: feature ids are large and sequential, and a
		// plain LCG started on consecutive seeds yields near-identical first outputs.
		var s = (seed >>> 0) || 1;
		s ^= s >>> 16; s = (s * 0x45d9f3b) >>> 0;
		s ^= s >>> 16; s = (s * 0x45d9f3b) >>> 0;
		s ^= s >>> 16;
		return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
	}
	function cap(str) { return str.charAt(0).toUpperCase() + str.slice(1); }
	function properName(seed) {
		var r = seededRng(seed);
		var name = SYL_A[(r() * SYL_A.length) | 0];
		if (r() < 0.55) name += SYL_B[(r() * SYL_B.length) | 0];
		name += SYL_C[(r() * SYL_C.length) | 0];
		return cap(name);
	}

	function displayName(cls, name) {
		switch (cls) {
			case "Ocean": return name + " Ocean";
			case "Sea": return "Sea of " + name;
			case "Lake": return "Lake " + name;
			case "Gulf": return "Gulf of " + name;
			case "Bay": return name + " Bay";
			case "Inlet": return name + " Inlet";
			case "Strait": return name + " Strait";
			case "Peninsula": return name + " Peninsula";
			case "Headland": return name + " Head";
			case "Cape": return "Cape " + name;
			case "Isthmus": return name + " Isthmus";
			case "Mountains": return name + " Mountains";
			case "Hills": return name + " Hills";
			case "River": return name + " River";
			default: return name;   // Continent / Island / Islet
		}
	}

	// ------------------------------------------------------------------
	// Glyph textures (white fill + dark outline, transparent background)
	// ------------------------------------------------------------------
	function glyphTexture(ch) {
		if (glyphTexCache[ch]) return glyphTexCache[ch];
		var S = 96, canvas = document.createElement("canvas");
		canvas.width = canvas.height = S;
		var ctx = canvas.getContext("2d");
		ctx.font = "bold " + Math.round(S * 0.74) + "px Georgia, 'Times New Roman', serif";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.lineJoin = "round";
		ctx.lineWidth = Math.round(S * 0.12);
		ctx.strokeStyle = "rgba(20,20,30,0.92)";
		ctx.strokeText(ch, S / 2, S / 2);
		ctx.fillStyle = "rgba(255,255,255,0.98)";
		ctx.fillText(ch, S / 2, S / 2);
		var tex = new THREE.CanvasTexture(canvas);
		tex.needsUpdate = true;
		glyphTexCache[ch] = tex;
		return tex;
	}

	// ------------------------------------------------------------------
	// Geometry helpers
	// ------------------------------------------------------------------
	function worldPoint(cart, elev, floatOff) {
		if (isMercator()) {
			var m = cartesianToMercator(cart, mercatorCenterLat, mercatorCenterLon);
			var z = 0.6 + floatOff;
			if (isRaised() && elev > 0 && typeof MERCATOR_ELEVATION_Z_SCALE !== "undefined") {
				z += elev * elevationMultiplier * MERCATOR_ELEVATION_Z_SCALE;
			}
			return { pos: new THREE.Vector3(m.x * 2.0, m.y * 2.0, z), normal: new THREE.Vector3(0, 0, 1) };
		}
		var n = cart.clone().normalize();
		var len = cart.length();
		var off = 7 + floatOff;
		if (isRaised() && elev > 0) off += elevationMultiplier * elev;
		return { pos: n.clone().multiplyScalar(len + off), normal: n };
	}

	function farthestFrom(tiles, t) {
		var best = t, bd = -1, p = t.averagePosition;
		for (var i = 0; i < tiles.length; i++) {
			var d = p.distanceToSquared(tiles[i].averagePosition);
			if (d > bd) { bd = d; best = tiles[i]; }
		}
		return best;
	}

	// Smooth a list of {cart, elev} control points (keeping the endpoints fixed and
	// re-projecting onto the sphere) until no interior vertex bends more than
	// MAX_TURN — this enforces a minimum radius of curvature so text never kinks.
	function smoothSpine(pts) {
		if (pts.length < 3) return pts;
		function maxTurn(p) {
			var mx = 0;
			for (var i = 1; i < p.length - 1; i++) {
				var a = p[i].cart.clone().sub(p[i - 1].cart);
				var b = p[i + 1].cart.clone().sub(p[i].cart);
				if (a.lengthSq() < 1e-9 || b.lengthSq() < 1e-9) continue;
				var ang = a.angleTo(b);
				if (ang > mx) mx = ang;
			}
			return mx;
		}
		var passes = 0;
		while (maxTurn(pts) > MAX_TURN && passes < 40) {
			var np = [{ cart: pts[0].cart.clone(), elev: pts[0].elev }];
			for (var i = 1; i < pts.length - 1; i++) {
				var c = pts[i - 1].cart.clone().multiplyScalar(0.25)
					.add(pts[i].cart.clone().multiplyScalar(0.5))
					.add(pts[i + 1].cart.clone().multiplyScalar(0.25));
				c.normalize().multiplyScalar(pts[i].cart.length()); // keep on sphere
				np.push({ cart: c, elev: pts[i].elev });
			}
			np.push({ cart: pts[pts.length - 1].cart.clone(), elev: pts[pts.length - 1].elev });
			pts = np;
			passes++;
		}
		return pts;
	}

	// Ordered spine of control points {cart, elev} along the feature's long axis.
	function featureSpine(region) {
		if (!region || !region.length) return [];
		if (region.length === 1) return [{ cart: region[0].averagePosition.clone(), elev: region[0].elevation }];
		var a = farthestFrom(region, region[0]);
		var b = farthestFrom(region, a);
		var axis = b.averagePosition.clone().sub(a.averagePosition);
		var axisLen = axis.length();
		if (axisLen < 1e-6) return [{ cart: a.averagePosition.clone(), elev: a.elevation }];
		axis.multiplyScalar(1 / axisLen);
		var nb = Math.max(2, Math.min(14, Math.round(Math.sqrt(region.length))));
		var sum = [], elevMax = [], cnt = [];
		for (var k = 0; k < nb; k++) { sum.push(new THREE.Vector3()); elevMax.push(-Infinity); cnt.push(0); }
		var base = a.averagePosition;
		for (var i = 0; i < region.length; i++) {
			var t = region[i];
			var proj = t.averagePosition.clone().sub(base).dot(axis) / axisLen;
			var idx = Math.max(0, Math.min(nb - 1, Math.floor(proj * nb)));
			sum[idx].add(t.averagePosition); cnt[idx]++;
			if (t.elevation > elevMax[idx]) elevMax[idx] = t.elevation;
		}
		var pts = [];
		for (var j = 0; j < nb; j++) {
			if (cnt[j] === 0) continue;
			pts.push({ cart: sum[j].multiplyScalar(1 / cnt[j]), elev: elevMax[j] > -Infinity ? elevMax[j] : 0 });
		}
		return smoothSpine(pts);
	}

	function makePath(worldPts) {
		var cum = [0];
		for (var i = 1; i < worldPts.length; i++) {
			cum.push(cum[i - 1] + worldPts[i].pos.distanceTo(worldPts[i - 1].pos));
		}
		var total = cum[cum.length - 1];
		function at(s) {
			if (total <= 0) {
				return { pos: worldPts[0].pos.clone(), tan: new THREE.Vector3(1, 0, 0), normal: worldPts[0].normal.clone() };
			}
			if (s <= 0) s = 0; if (s >= total) s = total;
			var i = 1; while (i < cum.length && cum[i] < s) i++;
			if (i >= worldPts.length) i = worldPts.length - 1;
			var p0 = worldPts[i - 1], p1 = worldPts[i];
			var seg = cum[i] - cum[i - 1];
			var t = seg > 0 ? (s - cum[i - 1]) / seg : 0;
			var pos = p0.pos.clone().lerp(p1.pos, t);
			var tan = p1.pos.clone().sub(p0.pos);
			if (tan.lengthSq() < 1e-12) tan.set(1, 0, 0); else tan.normalize();
			var normal = p0.normal.clone().lerp(p1.normal, t);
			if (normal.lengthSq() < 1e-12) normal.copy(p0.normal); else normal.normalize();
			return { pos: pos, tan: tan, normal: normal };
		}
		return { total: total, at: at };
	}

	// Build a Group of glyph quads spelling `text` bent along the spine. Returns
	// { group, anchor, halfLen, halfUp, normal } or null.
	function buildCurvedLabel(text, ctrlPts, glyphSize, floatOff, color) {
		if (!text || !ctrlPts.length) return null;
		var worldPts = [];
		for (var i = 0; i < ctrlPts.length; i++) worldPts.push(worldPoint(ctrlPts[i].cart, ctrlPts[i].elev, floatOff));
		if (worldPts.length === 1) {
			var east = REF_UP.clone().cross(worldPts[0].normal);
			if (east.lengthSq() < 1e-6) east.set(1, 0, 0); else east.normalize();
			worldPts = [
				{ pos: worldPts[0].pos.clone().addScaledVector(east, -glyphSize), normal: worldPts[0].normal },
				{ pos: worldPts[0].pos.clone().addScaledVector(east, glyphSize), normal: worldPts[0].normal }
			];
		}
		var path = makePath(worldPts);

		// Keep text upright: pick the reading direction whose text-up (bitangent)
		// points toward planet-north, else the label reads upside-down.
		var mid = path.at(path.total / 2);
		var upT = REF_UP.clone().addScaledVector(mid.normal, -REF_UP.dot(mid.normal));
		if (upT.lengthSq() > 1e-6) {
			upT.normalize();
			var btMid = mid.normal.clone().cross(mid.tan).normalize();
			if (btMid.dot(upT) < 0) { worldPts.reverse(); path = makePath(worldPts); }
		}

		var advance = glyphSize * 0.62;
		var textWidth = text.length * advance;
		var start = (path.total - textWidth) / 2 + advance / 2;

		var group = new THREE.Group();
		var baseMat = new THREE.MeshBasicMaterial({
			color: color || 0xffffff, transparent: true, depthWrite: false,
			side: THREE.DoubleSide, opacity: 0.96
		});
		var T = new THREE.Vector3(), Bt = new THREE.Vector3(), N = new THREE.Vector3();
		var basis = new THREE.Matrix4();
		var minPos = null, maxPos = null, midBt = null;
		for (var c = 0; c < text.length; c++) {
			var ch = text.charAt(c);
			if (ch === " ") continue;
			var s = path.at(start + c * advance);
			N.copy(s.normal);
			T.copy(s.tan).addScaledVector(N, -s.tan.dot(N));
			if (T.lengthSq() < 1e-9) { T.set(1, 0, 0).addScaledVector(N, -N.x); }
			T.normalize();
			Bt.copy(N).cross(T).normalize();
			basis.makeBasis(T, Bt, N);
			var geo = new THREE.PlaneBufferGeometry(glyphSize, glyphSize);
			var gmat = baseMat.clone();
			gmat.map = glyphTexture(ch);
			var mesh = new THREE.Mesh(geo, gmat);
			mesh.quaternion.setFromRotationMatrix(basis);
			mesh.position.copy(s.pos);
			mesh.renderOrder = 1003;
			group.add(mesh);
			if (!minPos) { minPos = s.pos.clone(); maxPos = s.pos.clone(); midBt = Bt.clone(); }
			else { maxPos = s.pos.clone(); }
			if (c === (text.length >> 1)) midBt = Bt.clone();
		}
		if (!group.children.length) return null;
		var anchor = minPos.clone().add(maxPos).multiplyScalar(0.5);
		var halfLen = maxPos.clone().sub(minPos).multiplyScalar(0.5);
		var halfUp = (midBt || new THREE.Vector3(0, 1, 0)).clone().multiplyScalar(glyphSize * 0.6);
		var normal = path.at(path.total / 2).normal;
		return { group: group, anchor: anchor, halfLen: halfLen, halfUp: halfUp, normal: normal };
	}

	// ------------------------------------------------------------------
	// Feature gathering
	// ------------------------------------------------------------------
	function gatherLabels(tiles) {
		var out = [];
		var totalLand = 0, totalWater = 0;
		for (var i = 0; i < tiles.length; i++) {
			if (tiles[i].elevation > 0) totalLand++; else totalWater++;
		}

		var data = (typeof featureDetectionData === "function") ? featureDetectionData() : null;
		var featN = data && data.featuresByApproach ? data.featuresByApproach.N : null;
		if (featN) {
			for (var f = 0; f < featN.length; f++) {
				var feat = featN[f];
				if (feat._dead || !feat.regionTiles || !feat.regionTiles.length) continue;
				var size = feat.regionTiles.length;
				var ref = feat.isLand ? totalLand : totalWater;
				if (feat.parent && size < Math.max(8, 0.004 * ref)) continue;
				if (!feat.parent && size < Math.max(4, 0.0015 * ref)) continue;
				if (!feat._labelName) feat._labelName = properName(feat.id || (f + 1));
				out.push({
					text: displayName(feat.classification, feat._labelName),
					region: feat.regionTiles,
					color: feat.isLand ? 0xfff4d6 : 0xd6ecff,
					priority: size
				});
			}
		}

		if (typeof computeMountainRanges === "function") {
			try { computeMountainRanges(tiles); } catch (e) { /* non-fatal */ }
			var ranges = {};
			for (var m = 0; m < tiles.length; m++) {
				var rid = tiles[m]._rangeId;
				if (!rid) continue;
				var g = ranges[rid];
				if (!g) { g = ranges[rid] = { tiles: [], mountain: false }; }
				g.tiles.push(tiles[m]);
				if (tiles[m]._rangeKind === 2) g.mountain = true;
			}
			for (var key in ranges) {
				if (!ranges.hasOwnProperty(key)) continue;
				var grp = ranges[key];
				if (grp.tiles.length < 3) continue;
				out.push({
					text: displayName(grp.mountain ? "Mountains" : "Hills",
						properName(parseInt(key, 10) * 31 + 7)),
					region: grp.tiles,
					color: grp.mountain ? 0xffffff : 0xf2e2c0,
					priority: grp.tiles.length
				});
			}
		}

		try { out = out.concat(gatherRivers(tiles)); } catch (e) { /* non-fatal */ }
		return out;
	}

	function gatherRivers(tiles) {
		var rivers = [];
		var seen = new Set();
		for (var i = 0; i < tiles.length; i++) {
			var t = tiles[i];
			if (!t.river || seen.has(t)) continue;
			if (t.drain && t.drain.river) continue;   // not a mouth
			var stem = [t], guard = 0, cur = t;
			seen.add(t);
			while (guard++ < 2000) {
				var srcs = cur.sources, next = null, bestFlow = -1;
				if (srcs) {
					for (var s = 0; s < srcs.length; s++) {
						var sc = srcs[s];
						if (!sc.river || seen.has(sc)) continue;
						var fl = (typeof sc.outflow === "number") ? sc.outflow : 0;
						if (fl > bestFlow) { bestFlow = fl; next = sc; }
					}
				}
				if (!next) break;
				seen.add(next); stem.push(next); cur = next;
			}
			if (stem.length < 5) continue;
			stem.reverse();
			rivers.push({
				text: displayName("River", properName((t.id || i) * 17 + 3)),
				region: stem,
				color: 0xbfe8ff,
				ordered: true,
				priority: stem.length * 6   // rivers punch above their tile count
			});
		}
		return rivers;
	}

	function glyphSizeFor(text, pathTotal) {
		var n = Math.max(1, text.replace(/\s/g, "").length);
		var fromLen = pathTotal * 0.9 / (n * 0.62);
		var min, max;
		if (isMercator()) { min = 0.12; max = 0.75; }
		else { min = 11; max = 75; }
		return Math.max(min, Math.min(max, fromLen));
	}

	// ------------------------------------------------------------------
	// Build / clear
	// ------------------------------------------------------------------
	function disposeGroup(group) {
		group.traverse(function (o) {
			if (o.geometry) o.geometry.dispose();
			if (o.material) o.material.dispose();
		});
	}

	function clearLabels() {
		if (labelState.group) {
			if (labelState.group.parent) labelState.group.parent.remove(labelState.group);
			disposeGroup(labelState.group);
			labelState.group = null;
		}
		placedLabels = [];
	}

	function rebuildFeatureLabels() {
		clearLabels();
		if (typeof surfaceRenderMode === "undefined" || surfaceRenderMode !== OVERLAY_ID) return;
		if (typeof scene === "undefined" || !scene) return;
		if (typeof planet === "undefined" || !planet || !planet.topology) return;

		var tiles = planet.topology.tiles;
		var items = gatherLabels(tiles);
		var root = new THREE.Group();
		var mercator = isMercator();

		for (var i = 0; i < items.length; i++) {
			var item = items[i];
			var ctrl;
			if (item.ordered) {
				ctrl = [];
				for (var k = 0; k < item.region.length; k++) {
					ctrl.push({ cart: item.region[k].averagePosition.clone(), elev: item.region[k].elevation });
				}
				ctrl = smoothSpine(ctrl);
			} else {
				ctrl = featureSpine(item.region);
			}
			if (!ctrl.length) continue;

			var probe = [];
			for (var p = 0; p < ctrl.length; p++) probe.push(worldPoint(ctrl[p].cart, ctrl[p].elev, 0));
			var pathLen = makePath(probe).total;
			var gsize = glyphSizeFor(item.text, pathLen);
			var floatOff = mercator ? 0 : gsize * 0.55 + 4;

			var built = buildCurvedLabel(item.text, ctrl, gsize, floatOff, item.color);
			if (!built) continue;

			if (mercator) {
				for (var o = -1; o <= 1; o++) {
					var grp = (o === 0) ? built.group : built.group.clone();
					if (o !== 0) grp.position.x += o * MERC_PERIOD;
					root.add(grp);
					placedLabels.push({
						group: grp,
						anchor: built.anchor.clone().setX(built.anchor.x + o * MERC_PERIOD),
						halfLen: built.halfLen, halfUp: built.halfUp,
						normal: built.normal, priority: item.priority || item.region.length
					});
				}
			} else {
				root.add(built.group);
				placedLabels.push({
					group: built.group, anchor: built.anchor, halfLen: built.halfLen,
					halfUp: built.halfUp, normal: built.normal,
					priority: item.priority || item.region.length
				});
			}
		}

		if (root.children.length) {
			scene.add(root);
			labelState.group = root;
		}
		updateFeatureLabelVisibility();
		if (typeof markRenderActivity === "function") markRenderActivity();
	}

	// ------------------------------------------------------------------
	// Per-frame screen-space culling: drop labels that overlap or stack up
	// (e.g. zoomed-out Mercator). Largest-priority features win; back-of-globe
	// and off-screen labels are hidden outright.
	// ------------------------------------------------------------------
	var _v = new THREE.Vector3();
	function project(pt, cam, W, H) {
		_v.copy(pt).project(cam);
		return { x: (_v.x * 0.5 + 0.5) * W, y: (-_v.y * 0.5 + 0.5) * H, z: _v.z };
	}
	function boxesOverlap(a, b, pad) {
		return !(a.maxX + pad < b.minX || b.maxX + pad < a.minX ||
			a.maxY + pad < b.minY || b.maxY + pad < a.minY);
	}

	function updateFeatureLabelVisibility() {
		if (typeof surfaceRenderMode === "undefined" || surfaceRenderMode !== OVERLAY_ID) return;
		if (!placedLabels.length || typeof camera === "undefined" || !camera) return;
		var W = (typeof window !== "undefined") ? window.innerWidth : 1280;
		var H = (typeof window !== "undefined") ? window.innerHeight : 720;
		// Degenerate viewport (e.g. not yet laid out): leave labels as-is rather
		// than projecting against a NaN aspect and hiding everything.
		if (!(W > 1) || !(H > 1)) return;
		var mercator = isMercator();
		var camPos = camera.position;
		var cand = [];

		for (var i = 0; i < placedLabels.length; i++) {
			var L = placedLabels[i];
			// Globe: hide labels on the far hemisphere (normal facing away).
			if (!mercator) {
				if (L.normal.dot(camPos.clone().sub(L.anchor)) <= 0) { L.group.visible = false; continue; }
			}
			var ac = project(L.anchor, camera, W, H);
			if (ac.z > 1 || ac.z < -1) { L.group.visible = false; continue; }
			// Screen AABB from the four label corners.
			var pts = [
				project(L.anchor.clone().add(L.halfLen).add(L.halfUp), camera, W, H),
				project(L.anchor.clone().add(L.halfLen).sub(L.halfUp), camera, W, H),
				project(L.anchor.clone().sub(L.halfLen).add(L.halfUp), camera, W, H),
				project(L.anchor.clone().sub(L.halfLen).sub(L.halfUp), camera, W, H)
			];
			var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
			for (var c = 0; c < 4; c++) {
				if (pts[c].x < minX) minX = pts[c].x; if (pts[c].x > maxX) maxX = pts[c].x;
				if (pts[c].y < minY) minY = pts[c].y; if (pts[c].y > maxY) maxY = pts[c].y;
			}
			if (maxX < 0 || minX > W || maxY < 0 || minY > H) { L.group.visible = false; continue; }
			cand.push({ L: L, box: { minX: minX, maxX: maxX, minY: minY, maxY: maxY }, pri: L.priority });
		}

		cand.sort(function (a, b) { return b.pri - a.pri; });
		var accepted = [];
		for (var k = 0; k < cand.length; k++) {
			var cur = cand[k], overlap = false;
			for (var a = 0; a < accepted.length; a++) {
				if (boxesOverlap(cur.box, accepted[a].box, 2)) { overlap = true; break; }
			}
			if (overlap) { cur.L.group.visible = false; }
			else { cur.L.group.visible = true; accepted.push(cur); }
		}
	}

	// ------------------------------------------------------------------
	// Overlay registration (keeps terrain colours; labels are extra geometry)
	// ------------------------------------------------------------------
	function colorFn(tile) {
		if (typeof calculateTerrainColor === "function") return calculateTerrainColor(tile);
		return new THREE.Color(0x808080);
	}

	function register() {
		if (typeof registerColorOverlay !== "function") return;
		registerColorOverlay(OVERLAY_ID, "Labels (named features)",
			"Keeps the terrain colouring but floats a procedurally-named label over " +
			"every major feature: Approach N land/water features, mountain & hill " +
			"ranges, and rivers. On the globe the labels are 3D objects that bend " +
			"along rivers/ranges and scale with feature size. Overlapping / stacked " +
			"labels are culled per frame (largest features win).",
			colorFn, "basic", "lazy", "geography");
	}

	register();

	global.rebuildFeatureLabels = rebuildFeatureLabels;
	global.updateFeatureLabelVisibility = updateFeatureLabelVisibility;
	global.__featureLabelsDebug = {
		gather: function () { return gatherLabels(planet.topology.tiles); },
		state: labelState,
		placed: function () { return placedLabels; }
	};

})(typeof window !== "undefined" ? window : this);
