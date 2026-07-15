// validate_core.js — proves econ_engine.js faithfully ports the Node-validated
// equilibrium (hex_economy_v2_core.js / spec §11.5), then confirms the
// large-scale defaults land cities in the thousands with conservation intact.
//   Run: node test/validate_core.js
'use strict';
var Econ = require('../econ_engine.js');

var pass = true;
function check(name, cond, detail) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (detail ? '   ' + detail : ''));
  if (!cond) pass = false;
}

// ---------------------------------------------------------------------------
// PART A — reproduce the reference core exactly (small scale, its bug regime)
// ---------------------------------------------------------------------------
console.log('== PART A: port fidelity vs hex_economy_v2_core.js (K0=0.5) ==');
(function () {
  var COLS = 14, ROWS = 10;
  var w = Econ.createWorld({
    cols: COLS, rows: ROWS,
    config: { kappa: 4, K0: 0.5, edgeVar: 0, c: 1, r: 0.10, urban: 0.5, migrate: 1,
              tau: 0, N0: 15, malthus: true, urbanize: false, wIters: 38, priceRounds: 45,
              // isolate the base equilibrium: no fishing / yield noise / founder pop, and
              // legacy independent-curve subsistence (this is the reference-core model).
              fishPerSea: 0, yieldVar: 0, cityFoundPop: 0, subsistenceShare: false }
  });
  // overwrite capacities to match the reference map exactly (raw C, not terrain)
  w.hexes.forEach(function (h) { h.C = 3; h.fishCap = 0; h.Cfood = 3; });
  [[4, 4, 9], [10, 6, 9], [7, 2, 6]].forEach(function (b) {
    w.hexes.forEach(function (h) {
      if (Math.hypot(h.col - b[0], h.r - b[1]) < 2.3 && b[2] > h.C) { h.C = b[2]; h.Cfood = b[2]; }
    });
  });
  w.hexes.forEach(function (h) { h.Lsub = Econ.Lsub(h.Cfood, 4, 1); });
  w.Ksub = w.hexes.reduce(function (a, h) { return a + h.Lsub; }, 0);
  // found rich & poor cities with explicit A
  Econ.foundCity(w, Econ.getHex(w, 3, 3).i, 9.0);
  Econ.foundCity(w, Econ.getHex(w, 11, 7).i, 4.5);
  Econ.computeTransport(w);

  var rich = w.cities[0], poor = w.cities[1], hist = [];
  console.log('  Ksub=' + w.Ksub.toFixed(0) + '  (reference: 382)');
  console.log('  t     N    mktFarm  cityPop  subs     w      Prich Ppoor');
  for (var t = 1; t <= 300; t++) {
    var m = Econ.step(w);
    hist.push(m.N);
    if (t <= 2 || t % 50 === 0) {
      console.log('  ' + String(t).padStart(3) + ' ' + m.N.toFixed(1).padStart(7) +
        ' ' + m.marketFarmers.toFixed(1).padStart(7) + ' ' + m.cityWorkers.toFixed(1).padStart(7) +
        ' ' + m.subsistence.toFixed(1).padStart(7) + '  ' + m.w.toFixed(3).padStart(5) +
        ' ' + w.prices[rich].toFixed(2).padStart(5) + ' ' + w.prices[poor].toFixed(2).padStart(5));
    }
  }
  var osc = Math.abs(hist[hist.length - 1] - hist[hist.length - 2]) > 0.2 ||
            Math.abs(hist[hist.length - 1] - hist[hist.length - 4]) > 0.2;
  var m = w.metrics;
  check('population bootstraps 15 -> ~390-400', w.N > 380 && w.N < 415, 'N=' + w.N.toFixed(1));
  check('settles near carrying capacity Ksub', Math.abs(w.N - w.Ksub) / w.Ksub < 0.10, 'N=' + w.N.toFixed(0) + ' Ksub=' + w.Ksub.toFixed(0));
  check('zero oscillation', !osc);
  check('rich city dearer than poor', w.prices[rich] > w.prices[poor], 'Prich=' + w.prices[rich].toFixed(2) + ' Ppoor=' + w.prices[poor].toFixed(2));
  check('food produced == food eaten (conservation)', m.conservationErr < 0.5, 'err=' + m.conservationErr.toFixed(4));
})();

// ---------------------------------------------------------------------------
// PART B — large-scale defaults: cities in the thousands, farms in the hundreds
// ---------------------------------------------------------------------------
console.log('\n== PART B: large-scale defaults (thousands-population) ==');
(function () {
  // a simple fertile map with two cities of differing productivity
  var COLS = 16, ROWS = 12, cells = [];
  for (var rr = 0; rr < ROWS; rr++) for (var cc = 0; cc < COLS; cc++) {
    var terr = 'plains';
    if (dist(cc, rr, 4, 4) < 2.5) terr = 'rich';
    else if (dist(cc, rr, 11, 8) < 2.5) terr = 'farm';
    else if (dist(cc, rr, 8, 3) < 2) terr = 'farm';
    if (Math.abs(cc - rr * 0.7 - 6) < 0.7) terr = 'water';
    cells.push(terr);
  }
  var w = Econ.createWorld({
    cols: COLS, rows: ROWS, cells: cells,
    cities: [{ col: 3, row: 3 }, { col: 12, row: 9 }],
    config: { urban: 0.6, tau: 0, migrate: 1, urbanize: false }   // fixed cities; base equilibrium
  });
  var hist = [];
  for (var t = 0; t < 400; t++) { var m = Econ.step(w); hist.push(m.N); }
  var m = w.metrics;
  console.log('  Ksub=' + w.Ksub.toFixed(0) + '  final N=' + w.N.toFixed(0));
  console.log('  city workers total=' + m.cityWorkers.toFixed(0) + '  market farmers=' + m.marketFarmers.toFixed(0) + '  subsistence=' + m.subsistence.toFixed(0));
  m.cityRows.forEach(function (cr) {
    console.log('    city@' + cr.city + '  N=' + cr.N.toFixed(0) + '  Y=' + cr.Y.toFixed(0) + '  price=' + cr.price.toFixed(2) + '  top1%=' + (cr.topShare * 100).toFixed(1) + '%');
  });
  // biggest farm hex
  var maxFarm = 0; w.hexes.forEach(function (h) { if (!h.isCity && h.L > maxFarm) maxFarm = h.L; });
  var osc = Math.abs(hist[hist.length - 1] - hist[hist.length - 3]) > Math.max(1, 0.005 * w.N);
  var biggestCity = Math.max.apply(null, m.cityRows.map(function (r) { return r.N; }));
  check('cities reach the thousands', biggestCity >= 1000, 'biggest city N=' + biggestCity.toFixed(0));
  check('farm hexes saturate in the hundreds', maxFarm >= 100, 'max farmers/hex=' + maxFarm.toFixed(0));
  check('total population in the thousands', w.N >= 2000, 'N=' + w.N.toFixed(0));
  check('no oscillation at scale', !osc);
  check('conservation holds at scale', m.conservationErr < Math.max(1, 0.001 * m.foodProduced), 'err=' + m.conservationErr.toFixed(2) + ' of ' + m.foodProduced.toFixed(0));
})();

function dist(a, b, c, d) { return Math.hypot(a - c, b - d); }

console.log('\n' + (pass ? 'ALL CORE CHECKS PASSED' : 'SOME CORE CHECKS FAILED'));
process.exit(pass ? 0 : 1);
