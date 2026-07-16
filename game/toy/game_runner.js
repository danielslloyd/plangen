// game_runner.js — run ONE balance game (map + rule-set + strategy) headless and
// return a structured result row. Deterministic. Shared by the sweep harness
// (incl. worker threads) and ad-hoc tests.
'use strict';
var Econ = require('./econ_engine.js');
var Strats = require('./strategies.js');

// mapData: hex   -> { name, cols, rows, cells, sites:[{col,row}] }
//          planet-> { name, seed, graph:{...}, sites:[tileIndex] }  (adapted game map)
// params:  partial GameConfig override (the swept rule-set)
// stratName: strategy id from strategies.js
// opts: { maxTicks=450, minTicks=120, sampleEvery=10, settleTol=0.004 }
// Runs until population AND wealth settle (early-stop, so simple games finish
// fast and settled objectives are meaningful); non-convergence within maxTicks
// is itself a "broken" signal (the rule-set never reaches equilibrium).
function runGame(mapData, params, stratName, opts) {
  opts = opts || {};
  var maxTicks = opts.maxTicks || 450;
  var minTicks = opts.minTicks || 120;
  var sampleEvery = opts.sampleEvery || 10;
  var settleTol = opts.settleTol || 0.004;
  var checkEvery = 10, needConsec = 2;
  var t0 = Date.now();

  var world, siteIdx = [];
  if (mapData.graph) {                          // planet (graph) map
    world = Econ.createWorld({ name: mapData.name, seed: mapData.seed, graph: mapData.graph, config: params });
    siteIdx = mapData.sites.slice();            // sites are already tile indices
  } else {                                       // fixed hex map
    world = Econ.createWorld({
      name: mapData.name, seed: mapData.seed,
      cols: mapData.cols, rows: mapData.rows, cells: mapData.cells, config: params
    });
    for (var i = 0; i < mapData.sites.length; i++) {
      var h = Econ.getHex(world, mapData.sites[i].col, mapData.sites[i].row);
      if (h) siteIdx.push(h.i);
    }
  }
  var strat = Strats.byName(stratName);

  var traj = [], consRing = [];
  var anyNonFinite = false, peakN = 0;
  var lastN = null, lastY = null, settledCount = 0, converged = false, ranTicks = 0;
  for (var t = 0; t < maxTicks; t++) {
    strat.onTick(world, t, siteIdx);
    var m = Econ.step(world);
    ranTicks = t + 1;
    if (!isFinite(m.N) || !isFinite(m.Ytotal)) anyNonFinite = true;
    var rel = m.foodProduced > 1 ? m.conservationErr / m.foodProduced : m.conservationErr;
    consRing.push(rel); if (consRing.length > 12) consRing.shift();
    if (m.N > peakN) peakN = m.N;
    if (t % sampleEvery === 0) traj.push(sample(m));
    // early-stop on settling
    if (t >= minTicks && t % checkEvery === 0) {
      if (lastN != null) {
        var dN = Math.abs(m.N - lastN) / Math.max(1, m.N);
        var dY = Math.abs(m.Ytotal - lastY) / Math.max(1, Math.abs(m.Ytotal));
        if (dN < settleTol && dY < settleTol) settledCount++; else settledCount = 0;
        if (settledCount >= needConsec) { converged = true; }
      }
      lastN = m.N; lastY = m.Ytotal;
      if (converged) break;
    }
  }
  var m = world.metrics;
  if (traj.length === 0 || traj[traj.length - 1].t !== m.tick) traj.push(sample(m));

  // ---- health flags -------------------------------------------------------
  var maxConsErrRel = consRing.reduce(function (a, x) { return Math.max(a, x); }, 0); // steady-state window
  var collapsed = m.N < Math.max(5, 0.02 * world.Ksub);                 // population died
  var runaway = anyNonFinite || m.N > 50 * world.Ksub;                  // exploded
  var conservationOK = maxConsErrRel < 0.03;   // steady-state; tolerates minor road-funding
                                               // flicker (strict gate lives in validate_core)
  var finite = !anyNonFinite;
  var oscillation = !converged && !collapsed;                           // never reached equilibrium
  var broken = oscillation || collapsed || runaway || !conservationOK || !finite;

  return {
    map: mapData.name, strategy: stratName, params: params,
    objectives: { population: r1(m.N), wealth: r1(m.Ytotal), fiscal: r3(m.fundedFrac) },
    final: {
      N: r1(m.N), cityWorkers: r1(m.cityWorkers), marketFarmers: r1(m.marketFarmers),
      subsistence: r1(m.subsistence), Ytotal: r1(m.Ytotal), treasury: r1(m.treasury),
      avgPrice: r3(m.avgPrice), cities: m.cities, roads: m.roadSegments,
      fundedFrac: r3(m.fundedFrac), Ksub: r1(world.Ksub),
      perCapWealth: m.cityWorkers > 1 ? r3(m.Ytotal / (m.cityWorkers + m.marketFarmers + m.subsistence)) : 0
    },
    health: { broken: broken, oscillation: oscillation, collapsed: collapsed,
      runaway: runaway, conservationOK: conservationOK, finite: finite,
      maxConsErrRel: r3(maxConsErrRel) },
    traj: traj,
    meta: { ticks: ranTicks, converged: converged, wallMs: Date.now() - t0, peakN: r1(peakN) }
  };
}

function sample(m) {
  return { t: m.tick, N: r1(m.N), Y: r1(m.Ytotal), farm: r1(m.marketFarmers),
    sub: r1(m.subsistence), city: r1(m.cityWorkers), price: r3(m.avgPrice),
    cities: m.cities, roads: m.roadSegments, funded: r3(m.fundedFrac), treas: r1(m.treasury) };
}

function relStdev(a) {
  if (a.length < 2) return 0;
  var m = a.reduce(function (s, x) { return s + x; }, 0) / a.length;
  if (Math.abs(m) < 1e-9) return 0;
  var v = a.reduce(function (s, x) { return s + (x - m) * (x - m); }, 0) / a.length;
  return Math.sqrt(v) / Math.abs(m);
}
var r1 = function (x) { return Math.round(x * 10) / 10; };
var r3 = function (x) { return Math.round(x * 1000) / 1000; };

module.exports = { runGame: runGame };
