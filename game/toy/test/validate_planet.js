// validate_planet.js — proves the shared economy engine runs on the game's
// DEFAULT MAP (a plangen-game-map) via game_map_adapter.js, using the map's baked
// bi-directional travel costs and calorie-derived food capacity. Node-first gate:
// the economy must bootstrap, grow cities, conserve food at rest, and be
// deterministic — on the real planet graph, not just the fixed hex maps.
//   Run: node test/validate_planet.js
'use strict';
var fs = require('fs');
var path = require('path');
var Econ = require('../econ_engine.js');
var A = require('../game_map_adapter.js');

var MAP = path.join(__dirname, '..', '..', '..', 'maps', 'sample-map.json');

var pass = true;
function check(name, cond, detail) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (detail ? '   ' + detail : ''));
  if (!cond) pass = false;
}

if (!fs.existsSync(MAP)) {
  console.log('  SKIP  default map not found at ' + MAP);
  process.exit(0);
}
var json = JSON.parse(fs.readFileSync(MAP, 'utf8'));

// ---------------------------------------------------------------------------
console.log('== A: adapter produces a sane graph from the default map ==');
var m = A.adaptGameMap(json, { withPolys: false });
var G = m.graph;
var land = 0, water = 0;
for (var i = 0; i < G.n; i++) { if (G.passable[i]) land++; else if (G.water[i]) water++; }
check('tile count matches the map', G.n === json.meta.counts.tiles, 'n=' + G.n);
check('adjacency present for every tile', G.adj.length === G.n && G.adj[0].length > 0);
check('some land and some water', land > 100 && water > 100, 'land=' + land + ' water=' + water);
// calories -> capacity, median land ~ farm tier (520)
var cb = [];
for (i = 0; i < G.n; i++) if (G.passable[i] && G.capBase[i] > 0) cb.push(G.capBase[i]);
cb.sort(function (a, b) { return a - b; });
var medCap = cb[cb.length >> 1];
check('median land capacity scaled to ~farm tier (520)', Math.abs(medCap - 520) < 1, 'med=' + medCap.toFixed(1));
// directional costs really are asymmetric on this map (bi-directional baked costs)
var asym = 0, total = 0;
for (var u = 0; u < G.n; u++) for (var k = 0; k < G.costOut[u].length; k++) {
  total++; if (Math.abs(G.costOut[u][k] - G.costIn[u][k]) > 1e-6) asym++;
}
check('bi-directional edge costs are genuinely asymmetric', asym > total * 0.1, asym + '/' + total + ' directed edges differ by direction');
check('candidate city sites derived from cityPriority', m.sites.length >= 5, 'sites=' + m.sites.length);
check('minerals carried as inert display data', Object.keys(G.minerals).length > 0, 'layers=' + Object.keys(G.minerals).join(','));

// ---------------------------------------------------------------------------
console.log('\n== B: economy runs, grows cities, conserves food at rest (seed=cityPriority) ==');
function runPlanet(cities, ticks, extraCfg) {
  var cfg = { yieldVar: 0, urban: 0.5, migrate: 0.5, r: 0.10, malthus: true, urbanize: true, seaTravel: false };
  for (var kk in (extraCfg || {})) cfg[kk] = extraCfg[kk];
  var w = Econ.createWorld({ name: m.name, seed: m.seed, graph: G, cities: cities, config: cfg });
  var relRing = [], lastN = 0;
  for (var t = 0; t < ticks; t++) {
    var mm = Econ.step(w);
    var rel = mm.foodProduced > 1 ? mm.conservationErr / mm.foodProduced : mm.conservationErr;
    relRing.push(rel); if (relRing.length > 10) relRing.shift();
    lastN = mm.N;
  }
  var maxRel = relRing.reduce(function (a, x) { return Math.max(a, x); }, 0);
  return { world: w, metrics: w.metrics, maxRelSteady: maxRel, finalN: lastN };
}
var seeds = m.sites.slice(0, 5);
var r1 = runPlanet(seeds, 220);
var mm1 = r1.metrics;
check('population bootstraps and stays finite', isFinite(mm1.N) && mm1.N > 1000, 'N=' + Math.round(mm1.N));
check('population is bounded by food carrying capacity', mm1.N < 2 * r1.world.Ksub, 'N=' + Math.round(mm1.N) + ' Ksub=' + Math.round(r1.world.Ksub));
check('cities emerge beyond the seeds', mm1.cities > seeds.length, 'cities=' + mm1.cities + ' (seeded ' + seeds.length + ')');
check('food is conserved at steady state', r1.maxRelSteady < 0.02, 'maxRelSteady=' + r1.maxRelSteady.toFixed(4));
check('urban + farm + subsistence workers all present', mm1.cityWorkers > 0 && mm1.marketFarmers > 0 && mm1.subsistence > 0,
  'city=' + Math.round(mm1.cityWorkers) + ' farm=' + Math.round(mm1.marketFarmers) + ' sub=' + Math.round(mm1.subsistence));

// ---------------------------------------------------------------------------
console.log('\n== C: fully-emergent mode — one bootstrap city, the rest self-ignite ==');
var r2 = runPlanet([m.sites[0]], 220);
check('cities self-ignite from a single bootstrap', r2.metrics.cities > 3, 'cities=' + r2.metrics.cities);
check('emergent population is finite & bounded', isFinite(r2.metrics.N) && r2.metrics.N > 1000 && r2.metrics.N < 2 * r2.world.Ksub, 'N=' + Math.round(r2.metrics.N));
check('emergent food conserved at steady state', r2.maxRelSteady < 0.02, 'maxRelSteady=' + r2.maxRelSteady.toFixed(4));

// ---------------------------------------------------------------------------
console.log('\n== D: determinism — same map+seeds+config => identical ==');
var a1 = runPlanet(seeds, 120).finalN;
var a2 = runPlanet(seeds, 120).finalN;
check('two identical runs produce the identical population', a1 === a2, 'N1=' + a1 + ' N2=' + a2);

// ---------------------------------------------------------------------------
// Synthetic micro-graphs isolate two transport properties the full-map gates
// can't (an inverted direction or a missing barrier still conserves food, so B/C
// wouldn't notice). A 3-tile line 0—1—2, city at tile 0, K0=1, no roads.
console.log('\n== E: graph transport charges toward-city + blocks impassable land ==');
function lineGraph(opts) {
  // costs: [c01,c10,c12,c21] directed baked costs; flags: passable/water per tile
  var c = opts.costs, pass = opts.passable, water = opts.water;
  return {
    n: 3, adj: [[1], [0, 2], [1]],
    passable: pass, water: water,
    terrainName: pass.map(function (p, k) { return water[k] ? 'ocean' : (p ? 'plains' : 'mountain'); }),
    capBase: [520, pass[1] ? 520 : 0, 520], fishBonus: [0, 0, 0],
    costOut: [[c[0]], [c[1], c[2]], [c[3]]],   // u -> neighbour
    costIn: [[c[1]], [c[0], c[3]], [c[2]]],     // neighbour -> u
    coords: new Float64Array([0, 0, 0, 0.02, 0, 0.04]), hopLen: 0.02
  };
}
function transportFrom0(graph) {
  var w = Econ.createWorld({ name: 'micro', seed: 1, graph: graph,
    config: { K0: 1, urbanize: false, seaTravel: false, malthus: false, cityFoundPop: 0 }, cities: [0] });
  return w.transport[0];
}
// E1 — DIRECTION: asymmetric costs. toward-city (costIn) path 2->1->0 = 5+3 = 8;
// the away-from-city (costOut) sum would be 20+10 = 30. Asserting 8 (not 30) pins
// invariant #2 — transport must price shipping food TO the city.
var td = transportFrom0(lineGraph({ costs: [10, 3, 20, 5], passable: [1, 1, 1], water: [0, 0, 0] }));
check('transport charges the TOWARD-CITY direction (costIn, not costOut)',
  Math.abs(td[1] - 3) < 1e-9 && Math.abs(td[2] - 8) < 1e-9, 'to tile1=' + td[1] + ' tile2=' + td[2] + ' (costOut would give 10, 30)');
// E2 — BARRIER: tile 1 impassable land walls off tile 2 (no other route).
var tb = transportFrom0(lineGraph({ costs: [5, 5, 5, 5], passable: [1, 0, 1], water: [0, 0, 0] }));
check('impassable land blocks food transport (basin walled off)', !isFinite(tb[2]), 'to tile2=' + tb[2]);
// E3 — SEA LANE: same geometry but tile 1 is water -> transport crosses it.
var ts = transportFrom0(lineGraph({ costs: [5, 5, 5, 5], passable: [1, 0, 1], water: [0, 1, 0] }));
check('water tiles remain traversable (sea lane, cost priced by the map)', isFinite(ts[2]) && ts[2] > 0, 'to tile2=' + ts[2]);

console.log('');
console.log(pass ? 'ALL PLANET CHECKS PASSED' : 'SOME PLANET CHECKS FAILED');
process.exit(pass ? 0 : 1);
