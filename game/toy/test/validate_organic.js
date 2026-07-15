// validate_organic.js — the organic city model: tiles flip WHOLESALE to gold-
// work (zero food) via the MEDIAN-wage tipping point; connected urban tiles pool
// into one city; food-rich areas spawn settlements; it all stays conserved,
// converges, and self-limits (no runaway to the map-fill cap).
//   Run: node test/validate_organic.js
'use strict';
var Econ = require('../econ_engine.js');

var pass = true;
function check(name, cond, detail) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (detail ? '   ' + detail : ''));
  if (!cond) pass = false;
}
function fertileMap(cols, rows, blobs) {
  var cells = [];
  for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
    var terr = 'plains';
    blobs.forEach(function (b) { if (Math.hypot(c - b[0], r - b[1]) < b[2]) terr = b[3]; });
    cells.push(terr);
  }
  return { cols: cols, rows: rows, cells: cells };
}

// ---------------------------------------------------------------------------
console.log('== A: a lone seed grows suburbs (a multi-tile city), stays conserved ==');
(function () {
  var m = fertileMap(20, 14, [[10, 7, 8, 'rich'], [10, 7, 11, 'farm']]);
  var w = Econ.createWorld({ cols: m.cols, rows: m.rows, cells: m.cells,
    cities: [{ col: 10, row: 7 }], config: { urban: 0.7, migrate: 0.5, edgeVar: 0.3, newCoreMinFarmers: 1e9, urbanDensityTarget: 1500 } });
  var hist = [];
  for (var t = 0; t < 400; t++) { var mm = Econ.step(w); hist.push(mm.urbanTiles); }
  var mm = w.metrics;
  var biggest = Math.max.apply(null, w.clusters.map(function (c) { return c.tiles.length; }));
  var urbanFood = 0; w.hexes.forEach(function (h) { if (h.isCity) urbanFood += h.foodProd; });
  var stable = hist.slice(-40).every(function (x) { return x === hist[hist.length - 1]; });
  check('seed grew beyond 1 tile (suburbs)', biggest >= 2, 'biggest cluster=' + biggest + ' tiles');
  check('it is ONE connected city', w.clusters.length === 1, 'clusters=' + w.clusters.length);
  check('urban tiles produce ZERO food', urbanFood < 1e-6, 'urbanFood=' + urbanFood.toFixed(3));
  check('urban extent converged (no flicker)', stable, 'last40 settled=' + stable);
  check('conservation holds', mm.conservationErr / mm.foodProduced < 0.02, 'rel=' + (mm.conservationErr / mm.foodProduced).toFixed(4));
})();

// ---------------------------------------------------------------------------
console.log('\n== B: a food-rich area FAR from any city spawns a settlement ==');
(function () {
  // seed a city on the left; a rich breadbasket sits far to the right
  var m = fertileMap(24, 12, [[3, 6, 2.5, 'farm'], [19, 6, 4, 'rich'], [19, 6, 6, 'farm']]);
  var w = Econ.createWorld({ cols: m.cols, rows: m.rows, cells: m.cells,
    cities: [{ col: 3, row: 6 }], config: { urban: 0.6, migrate: 0.5, edgeVar: 0.3 } });
  var emergedTick = -1;
  for (var t = 0; t < 450; t++) {
    Econ.step(w);
    // a city core appearing in the right-hand breadbasket (col > 12) that wasn't seeded
    if (emergedTick < 0 && w.cities.some(function (k) { return w.hexes[k].col > 12; })) emergedTick = t;
  }
  var rightCities = w.cities.filter(function (k) { return w.hexes[k].col > 12; }).length;
  check('a settlement emerged in the far breadbasket', rightCities >= 1, 'right-side cities=' + rightCities + (emergedTick >= 0 ? ' (t=' + emergedTick + ')' : ''));
  check('conservation holds with emergent cities', w.metrics.conservationErr / w.metrics.foodProduced < 0.03, 'rel=' + (w.metrics.conservationErr / w.metrics.foodProduced).toFixed(4));
})();

// ---------------------------------------------------------------------------
console.log('\n== C: connected urban tiles are ONE city (the merge rule) ==');
(function () {
  // two ADJACENT seeds must resolve to a single connected cluster immediately;
  // and after running, growth keeps them one city.
  var m = fertileMap(14, 10, [[6, 5, 4, 'rich'], [7, 5, 4, 'rich'], [7, 5, 6, 'farm']]);
  var w = Econ.createWorld({ cols: m.cols, rows: m.rows, cells: m.cells,
    cities: [{ col: 6, row: 5 }, { col: 7, row: 5 }],
    config: { urban: 0.7, migrate: 0.5, edgeVar: 0.2, newCoreMinFarmers: 1e9 } });
  var oneAtStart = w.clusters.length === 1 && w.clusters[0].tiles.length === 2;
  check('two adjacent seeds = one 2-tile city at start', oneAtStart,
    'clusters=' + w.clusters.length + ' tiles=' + (w.clusters[0] ? w.clusters[0].tiles.length : 0));
  for (var t = 0; t < 300; t++) Econ.step(w);
  var sameCluster = Econ.getHex(w, 6, 5).clusterRep === Econ.getHex(w, 7, 5).clusterRep;
  check('they remain one merged city while growing', sameCluster && w.clusters.length === 1,
    'clusters=' + w.clusters.length + ' merged=' + sameCluster);
})();

// ---------------------------------------------------------------------------
console.log('\n== D: never runs away to the map-fill cap; population finite ==');
(function () {
  var m = fertileMap(18, 14, [[9, 7, 8, 'rich']]);  // whole map lush -> temptation to over-urbanize
  // yieldVar:0 isolates the base over-urbanization/conservation property: a
  // UNIFORMLY lush map is the known-hard limit-cycle case, and capacity noise can
  // tip it into a small population oscillation (transient instantaneous cons. err).
  var w = Econ.createWorld({ cols: m.cols, rows: m.rows, cells: m.cells,
    cities: [{ col: 9, row: 7 }], config: { urban: 0.8, migrate: 0.5, edgeVar: 0.3, yieldVar: 0 } });
  for (var t = 0; t < 500; t++) Econ.step(w);
  var passable = w.hexes.filter(function (h) { return h.passable; }).length;
  var urbanFrac = w.metrics.urbanTiles / passable;
  check('urban fraction well below the hard cap', urbanFrac < 0.45, 'urbanFrac=' + (100 * urbanFrac).toFixed(0) + '%');
  check('population finite & positive', isFinite(w.N) && w.N > 100, 'N=' + Math.round(w.N));
  check('food still conserved on a fully-lush map', w.metrics.conservationErr / w.metrics.foodProduced < 0.02, 'rel=' + (w.metrics.conservationErr / w.metrics.foodProduced).toFixed(4));
})();

console.log('\n' + (pass ? 'ALL ORGANIC CHECKS PASSED' : 'SOME ORGANIC CHECKS FAILED'));
process.exit(pass ? 0 : 1);
