// game_map_adapter.js — adapt the game's DEFAULT MAP (a `plangen-game-map`, see
// docs/game-export-format.md; loaded by game/mapdata.js) into the graph `spec`
// the shared economy engine (econ_engine.js) consumes. Runs in Node (harness) and
// the browser (planet sandbox) — same numbers either place.
//
//   adaptGameMap(rawJson, opts) -> {
//     name, seed,
//     graph: { n, adj, passable, water, terrainName, capBase, fishBonus,
//              costOut, costIn, coords, hopLen, minerals, polys },
//     sites,          // candidate city tiles (from cityPriority) for strategies
//     meta
//   }
//
// Modelling decisions baked in (Dan-confirmed 2026-07-15):
//  * FOOD CAPACITY  = the map's per-tile `calories` (PlanGen's best-crop yield),
//    scaled so a MEDIAN land tile ~ the engine's "farm" tier (520). Coastal
//    fishing = a share of adjacent WATER tiles' calories (fish is baked into
//    `calories` on water tiles). One smooth gradient, no terrain buckets.
//  * TRANSPORT      = the map's BAKED, BI-DIRECTIONAL edge costs (`moveCost`
//    A->B / `moveCostR` B->A), normalised so a median LAND hop ~ K0. Water and
//    coast edges keep their own baked costs, so sailing is priced by the map (no
//    synthetic sea model). Roads still multiply the cost via the engine.
//  * STRATEGIC RESOURCES (iron/gold/oil/...) are carried through as inert data
//    (`graph.minerals`) for display only — NOT simulated in the food/labor/wealth
//    economy. Deliberately left out for now.
(function (global) {
  'use strict';

  var WATER = { ocean: 1, coast: 1, lake: 1, seaIce: 1 };
  var BLOCK = { glacier: 1, mountain: 1 };   // impassable land: no farm, no city
  var MINERAL_LAYERS = ['iron', 'gold', 'oil', 'coal', 'copper', 'silver', 'uranium', 'bauxite'];
  var CAP_TARGET = 520;    // engine "farm" tier — median land tile is scaled to here

  function decodeLayer(def, count) {
    var out = new Float64Array(count);
    if (!def) return out;
    var scale = def.scale || 1;
    if (def.sparse) {
      for (var i = 0; i < def.indices.length; i++) out[def.indices[i]] = def.values[i] / scale;
    } else {
      for (var j = 0; j < count; j++) out[j] = (def.values[j] || 0) / scale;
    }
    return out;
  }
  function median(arr) {
    if (!arr.length) return 1;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    return a[a.length >> 1] || 1;
  }
  function strHash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h | 0;
  }
  function llFromXYZ(x, y, z) {   // PlanGen axes: y=north pole, z=prime meridian
    var r = Math.sqrt(x * x + y * y + z * z) || 1;
    return [Math.asin(y / r), Math.atan2(x / r, z / r)];   // [lat, lon] radians
  }
  function greatCircle(la, lo, lb, lob) {
    var c = Math.sin(la) * Math.sin(lb) + Math.cos(la) * Math.cos(lb) * Math.cos(lo - lob);
    if (c > 1) c = 1; else if (c < -1) c = -1;
    return Math.acos(c);
  }

  // Candidate city sites: PlanGen's own `cityPriority` spots (river junctions /
  // calorie flux), fertile capacity as a tiebreak, greedily spaced so they don't
  // clump. Used by the harness strategies and the sandbox "seed cityPriority" mode.
  function pickSites(n, passable, cityPriority, capBase, coords, hopLen, maxSites, minSpacing) {
    var scored = [];
    for (var i = 0; i < n; i++) {
      if (!passable[i]) continue;
      var cp = cityPriority ? cityPriority[i] : 0;
      scored.push({ i: i, score: cp * 1000 + capBase[i] });   // cityPriority dominates, capBase breaks ties
    }
    scored.sort(function (a, b) { return b.score - a.score; });
    var chosen = [];
    for (var s = 0; s < scored.length && chosen.length < maxSites; s++) {
      var ci = scored[s].i, ok = true;
      var la = coords[ci * 2], lo = coords[ci * 2 + 1];
      for (var k = 0; k < chosen.length; k++) {
        var cj = chosen[k];
        if (greatCircle(la, lo, coords[cj * 2], coords[cj * 2 + 1]) / hopLen < minSpacing) { ok = false; break; }
      }
      if (ok) chosen.push(ci);
    }
    return chosen;
  }

  // Per-tile [lon,lat] (degrees) polygon rings, corner longitudes unwrapped to the
  // tile centre (so tiles crossing the antimeridian stay contiguous). Rendering only.
  function buildPolys(g, nCorners, coordsDeg) {
    var cornerLL = new Float64Array(nCorners * 2);
    for (var c = 0; c < nCorners; c++) {
      var ll = llFromXYZ(g.corners[c * 3] / 10000, g.corners[c * 3 + 1] / 10000, g.corners[c * 3 + 2] / 10000);
      cornerLL[c * 2] = ll[0] * 180 / Math.PI; cornerLL[c * 2 + 1] = ll[1] * 180 / Math.PI;
    }
    var polys = new Array(g.tileCorners.length);
    for (var t = 0; t < g.tileCorners.length; t++) {
      var cLon = coordsDeg[t * 2 + 1], ring = g.tileCorners[t], poly = new Array(ring.length);
      for (var k = 0; k < ring.length; k++) {
        var lon = cornerLL[ring[k] * 2 + 1], lat = cornerLL[ring[k] * 2];
        while (lon - cLon > 180) lon -= 360;
        while (lon - cLon < -180) lon += 360;
        poly[k] = [lon, lat];
      }
      polys[t] = poly;
    }
    return polys;
  }

  function adaptGameMap(json, opts) {
    opts = opts || {};
    if (!json || json.format !== 'plangen-game-map') throw new Error('Not a plangen-game-map file');
    var g = json.geometry, n = json.meta.counts.tiles, nE = json.meta.counts.edges, nC = json.meta.counts.corners;
    var fishShare = (opts.fishShare != null) ? opts.fishShare : 0.5;
    var maxSites = opts.maxSites || 12, minSpacing = opts.minSpacing || 4;

    var TN = json.legend.terrain;
    var terrain = decodeLayer(json.tileLayers.terrain, n);
    var calories = decodeLayer(json.tileLayers.calories, n);

    // classify tiles ---------------------------------------------------------
    var water = new Uint8Array(n), passable = new Uint8Array(n), terrainName = new Array(n);
    for (var i = 0; i < n; i++) {
      var nm = TN[terrain[i]] || 'plains';
      terrainName[i] = nm;
      if (WATER[nm]) water[i] = 1;
      else if (!BLOCK[nm]) passable[i] = 1;      // farmable / city-able land
    }

    // food capacity from calories, scaled so median land ~ the "farm" tier ----
    var landCal = [];
    for (i = 0; i < n; i++) if (passable[i] && calories[i] > 0) landCal.push(calories[i]);
    var capScale = CAP_TARGET / median(landCal);
    var capBase = new Float64Array(n);
    for (i = 0; i < n; i++) capBase[i] = passable[i] ? calories[i] * capScale : 0;

    // tile coordinates (lat,lon radians) + degrees, median edge length --------
    var coords = new Float64Array(n * 2), coordsDeg = new Float64Array(n * 2);
    for (var t = 0; t < n; t++) {
      var ll = llFromXYZ(g.tileCenters[t * 3] / 10000, g.tileCenters[t * 3 + 1] / 10000, g.tileCenters[t * 3 + 2] / 10000);
      coords[t * 2] = ll[0]; coords[t * 2 + 1] = ll[1];
      coordsDeg[t * 2] = ll[0] * 180 / Math.PI; coordsDeg[t * 2 + 1] = ll[1] * 180 / Math.PI;
    }
    var lens = [];
    for (var e = 0; e < Math.min(nE, 3000); e++) {
      var a0 = g.edges[e * 2], b0 = g.edges[e * 2 + 1];
      lens.push(greatCircle(coords[a0 * 2], coords[a0 * 2 + 1], coords[b0 * 2], coords[b0 * 2 + 1]));
    }
    var hopLen = median(lens) || 1;

    // baked directional edge costs, normalised by the median LAND hop ---------
    var moveCost = decodeLayer(json.edgeLayers.moveCost, nE);
    var moveCostR = decodeLayer(json.edgeLayers.moveCostR, nE);
    var domain = decodeLayer(json.edgeLayers.domain, nE);
    var pairMap = new Map();
    for (e = 0; e < nE; e++) pairMap.set(g.edges[e * 2] + '|' + g.edges[e * 2 + 1], e);
    var landMC = [];
    for (e = 0; e < nE; e++) if (domain[e] === 1) landMC.push(moveCost[e]);
    var mcNorm = median(landMC) || 1;

    var adj = g.tileNeighbors;
    var costOut = new Array(n), costIn = new Array(n), fishBonus = new Float64Array(n);
    for (var u = 0; u < n; u++) {
      var nb = adj[u], co = new Array(nb.length), cin = new Array(nb.length), fb = 0;
      for (var k = 0; k < nb.length; k++) {
        var v = nb[k];
        var ei = pairMap.get(Math.min(u, v) + '|' + Math.max(u, v));
        var cuv, cvu;
        if (ei === undefined) { cuv = cvu = 300; }         // missing edge: treat as very hard
        else if (u < v) { cuv = moveCost[ei]; cvu = moveCostR[ei]; }
        else { cuv = moveCostR[ei]; cvu = moveCost[ei]; }
        co[k] = cuv / mcNorm;                              // K0 applied in the engine at use
        cin[k] = cvu / mcNorm;
        if (passable[u] && water[v]) fb += calories[v] * capScale * fishShare;   // coastal fishing
      }
      costOut[u] = co; costIn[u] = cin;
      if (passable[u]) fishBonus[u] = fb;
    }

    // inert minerals (display only) ------------------------------------------
    var minerals = {};
    for (var mi = 0; mi < MINERAL_LAYERS.length; mi++) {
      var mn = MINERAL_LAYERS[mi];
      if (json.tileLayers[mn]) minerals[mn] = Array.from(decodeLayer(json.tileLayers[mn], n));
    }

    var cityPriority = json.tileLayers.cityPriority ? decodeLayer(json.tileLayers.cityPriority, n) : null;
    var sites = pickSites(n, passable, cityPriority, capBase, coords, hopLen, maxSites, minSpacing);

    var polys = (opts.withPolys === false) ? null : buildPolys(g, nC, coordsDeg);

    return {
      name: opts.name || ('planet-' + (json.meta.seed || 'map')),
      seed: (json.meta.seed != null) ? strHash(String(json.meta.seed)) : strHash('planet'),
      graph: {
        n: n, adj: adj,
        passable: passable, water: water, terrainName: terrainName,
        capBase: capBase, fishBonus: fishBonus,
        costOut: costOut, costIn: costIn,
        coords: coords, coordsDeg: coordsDeg, hopLen: hopLen,
        capScale: capScale, mcNorm: mcNorm,
        minerals: minerals, polys: polys,
        cityPriority: cityPriority ? Array.from(cityPriority) : null
      },
      sites: sites, meta: json.meta
    };
  }

  var API = { adaptGameMap: adaptGameMap, decodeLayer: decodeLayer, pickSites: pickSites };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.GameMapAdapter = API;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
