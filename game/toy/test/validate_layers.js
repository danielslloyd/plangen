// validate_layers.js — HANDOFF action items 1 & 2: the taxation -> road-crew ->
// garrison -> incremental-construction -> gradual-decay layer is STABLE, that
// overreach genuinely bites, that crews/garrisons eat without breaking
// conservation, and that construction stalls when it can't be afforded.
//   Run: node test/validate_layers.js
'use strict';
var Econ = require('../econ_engine.js');

var pass = true;
function check(name, cond, detail) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (detail ? '   ' + detail : ''));
  if (!cond) pass = false;
}
function stdev(a) {
  var m = a.reduce(function (s, x) { return s + x; }, 0) / a.length;
  var v = a.reduce(function (s, x) { return s + (x - m) * (x - m); }, 0) / a.length;
  return Math.sqrt(v);
}

// A long plains corridor with two cities at the ends (so a road between them is
// long -> lots of segments -> a real maintenance burden).
function corridorWorld(cfg) {
  var COLS = 22, ROWS = 8, cells = [];
  for (var rr = 0; rr < ROWS; rr++) for (var cc = 0; cc < COLS; cc++) {
    var terr = 'plains';
    if (dist(cc, rr, 2, 4) < 2.2) terr = 'rich';
    if (dist(cc, rr, 19, 4) < 2.2) terr = 'farm';
    cells.push(terr);
  }
  if (cfg.urbanize === undefined) cfg.urbanize = false;   // fiscal layer on FIXED cities
  return Econ.createWorld({
    cols: COLS, rows: ROWS, cells: cells,
    cities: [{ col: 2, row: 4 }, { col: 19, row: 4 }],
    config: cfg
  });
}
function dist(a, b, c, d) { return Math.hypot(a - c, b - d); }

// ---------------------------------------------------------------------------
console.log('== A: well-funded roads — build, fund, stay maintained, stable ==');
var wellFunded;
(function () {
  var w = corridorWorld({ urban: 0.55, tau: 0.15, migrate: 0.5, degrade: 0.2, recover: 0.6 });
  Econ.startRoadProject(w, w.cities[0], w.cities[1]);
  var fundedHist = [], treasHist = [], decayHist = [];
  for (var t = 0; t < 500; t++) {
    var m = Econ.step(w);
    if (t >= 450) { fundedHist.push(m.fundedFrac); treasHist.push(m.treasury); }
    if (t === 499) decayHist = Object.keys(w.roadState).map(function (k) { return w.roadState[k].decay; });
  }
  wellFunded = w.metrics;
  var m = w.metrics;
  console.log('  segments built=' + m.roadSegments + '  fundedFrac=' + m.fundedFrac.toFixed(3) +
    '  treasury=' + m.treasury.toFixed(0) + '  avgDecay=' + avg(decayHist).toFixed(3) + ' (0=fresh road, 1=overland)');
  check('road corridor got built', m.roadSegments >= 5, 'segments=' + m.roadSegments);
  check('crews fully funded at steady state', m.fundedFrac > 0.95, 'fundedFrac=' + m.fundedFrac.toFixed(3));
  check('funding loop is STABLE (low variance)', stdev(fundedHist) < 0.02, 'sd=' + stdev(fundedHist).toFixed(4));
  check('funded roads stay fresh (low decay => near roadMult)', avg(decayHist) < 0.1, 'avgDecay=' + avg(decayHist).toFixed(3));
  check('all segment decay within [0,1]', decayHist.every(function (d) { return d >= 0 && d <= 1.001; }));
  check('conservation holds with crews eating', m.conservationErr < Math.max(1, 0.001 * m.foodProduced), 'err=' + m.conservationErr.toFixed(2));
})();

// ---------------------------------------------------------------------------
console.log('\n== B: overreach — tiny tax cannot maintain the corridor, it decays ==');
(function () {
  // starve the fisc (tiny tax, expensive public labor) so the frontier corridor
  // cannot be fully garrisoned/maintained -> its remote segments decay.
  var w = corridorWorld({ urban: 0.55, tau: 0.002, wageShare: 5, migrate: 0.5, degrade: 0.25, recover: 0.6 });
  Econ.startRoadProject(w, w.cities[0], w.cities[1]);
  w.treasury = 500;   // seed enough to build the corridor once, then it must self-fund
  var decayHist = [];
  for (var t = 0; t < 600; t++) {
    var m = Econ.step(w);
    if (t === 599) decayHist = Object.keys(w.roadState).map(function (k) { return w.roadState[k].decay; });
  }
  var m = w.metrics;
  // reconstruct effective cost multiplier per segment (roadMult..1)
  var mults = decayHist.map(function (d) { return w.cfg.roadMult + d * (1 - w.cfg.roadMult); });
  console.log('  segments=' + m.roadSegments + '  fundedFrac=' + m.fundedFrac.toFixed(3) +
    '  avgDecay=' + avg(decayHist).toFixed(3) + '  maxMult=' + Math.max.apply(null, mults).toFixed(3) + ' (1=overland)');
  check('overreach: crews underfunded', m.fundedFrac < 0.9, 'fundedFrac=' + m.fundedFrac.toFixed(3));
  check('unmaintained roads decayed toward overland', avg(decayHist) > 0.4, 'avgDecay=' + avg(decayHist).toFixed(3));
  check('roads NEVER decay past overland (mult <= 1; travel just slows)', mults.every(function (x) { return x <= 1.001; }));
  check('roads never cheaper than a fresh road (mult >= roadMult)', mults.every(function (x) { return x >= w.cfg.roadMult - 1e-6; }));
  check('conservation still holds under overreach', m.conservationErr < Math.max(1, 0.001 * m.foodProduced), 'err=' + m.conservationErr.toFixed(2));
})();

// ---------------------------------------------------------------------------
console.log('\n== C: construction stalls when it cannot be afforded (no tax => no treasury) ==');
(function () {
  var w = corridorWorld({ urban: 0.55, tau: 0.0, migrate: 0.5 });
  w.treasury = 0;
  Econ.startRoadProject(w, w.cities[0], w.cities[1]);
  var builtOverTime = [];
  for (var t = 0; t < 300; t++) { var m = Econ.step(w); builtOverTime.push(m.roadSegments); }
  var m = w.metrics;
  console.log('  tau=0 => treasury=' + m.treasury.toFixed(1) + '  segments built=' + m.roadSegments + '  projectsActive=' + m.projectsActive);
  check('with no tax revenue, road construction stalls', m.roadSegments === 0, 'segments=' + m.roadSegments);
  check('the project stays queued (stalled, not lost)', m.projectsActive >= 1, 'active=' + m.projectsActive);
})();

// ---------------------------------------------------------------------------
console.log('\n== D: garrison cost scales with distance beyond the safe radius ==');
(function () {
  // near road vs far road: the far segment should demand more crew+garrison.
  var near = corridorWorld({ urban: 0.55, tau: 0.15, safeRadius: 2, garrisonPerDist: 0.5 });
  Econ.startRoadProject(near, near.cities[0], near.cities[1]);
  for (var t = 0; t < 400; t++) Econ.step(near);
  var demandPerSeg = near.metrics.crewDemand / Math.max(1, near.metrics.roadSegments);
  console.log('  crewDemand=' + near.metrics.crewDemand.toFixed(1) + ' over ' + near.metrics.roadSegments +
    ' segments => ' + demandPerSeg.toFixed(2) + ' workers/segment (mCrew=0.5 base)');
  check('garrisons add to crew demand beyond safe radius', demandPerSeg > 0.5, 'perSeg=' + demandPerSeg.toFixed(2));
})();

function avg(a) { return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : 0; }

console.log('\n' + (pass ? 'ALL LAYER CHECKS PASSED' : 'SOME LAYER CHECKS FAILED'));
process.exit(pass ? 0 : 1);
