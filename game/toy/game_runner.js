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

  var traj = [], consRing = [], cityRing = [], extentRing = [], nRing = [];
  var anyNonFinite = false, peakN = 0;
  var lastN = null, lastY = null, settledCount = 0, converged = false, ranTicks = 0;
  for (var t = 0; t < maxTicks; t++) {
    strat.onTick(world, t, siteIdx);
    var m = Econ.step(world);
    ranTicks = t + 1;
    if (!isFinite(m.N) || !isFinite(m.Ytotal)) anyNonFinite = true;
    var rel = m.foodProduced > 1 ? m.conservationErr / m.foodProduced : m.conservationErr;
    consRing.push(rel); if (consRing.length > 12) consRing.shift();
    // Structural churn rides UNDER a flat N: a map can hold population dead steady while
    // cities ignite/revert and the frontier breathes. The settle test below only watches
    // N and Ytotal, so it would call that converged. Watch the shape directly.
    cityRing.push(m.cities); if (cityRing.length > 25) cityRing.shift();
    extentRing.push(m.farmedTiles); if (extentRing.length > 25) extentRing.shift();
    nRing.push(m.N); if (nRing.length > 30) nRing.shift();
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
  // OSCILLATION is graded by AMPLITUDE, not by whether N settled to settleTol.
  // The Malthus update is a bang-bang controller (sig = +1/0.5/0/-1, step r*tanh(sig)),
  // so unless sig lands exactly on 0 it rings at roughly +/-r forever. At the default
  // r=0.10 that is a ~11% peak-to-peak ripple with a completely stable structure
  // (cities and extent dead steady) -- a stable limit cycle, not a broken rule-set.
  // Measured identically on the pre-marginal-cap engine, so it is inherent, not new.
  // Calling that "non-convergence" flagged ~44% of games as broken and buried the real
  // signal. Judge it against the controller's own step size instead: ringing near r is
  // expected; several times r means the rule-set genuinely cannot find an equilibrium.
  var oscAmp = amplitude(nRing);
  var oscTol = Math.max(0.25, 3 * (params.r != null ? params.r : 0.10));
  var oscillation = oscAmp > oscTol && !collapsed;
  // Churn = the SHAPE never stopped moving. This is the flip/limit-cycle the engine's
  // damping (clSmooth/growInterval/reversalCooldown) exists to prevent, and it is a
  // genuinely different failure from population ripple -- N can be glass-flat while
  // cities ignite and revert underneath. Measured over the final window only.
  var cityChurn = spread(cityRing), extentChurn = relStdev(extentRing);
  var structuralChurn = cityChurn > 2 || extentChurn > 0.02;
  var broken = oscillation || collapsed || runaway || !conservationOK || !finite || structuralChurn;

  return {
    map: mapData.name, strategy: stratName, params: params,
    objectives: { population: r1(m.N), wealth: r1(m.Ytotal), fiscal: r3(m.fundedFrac) },
    final: {
      N: r1(m.N), cityWorkers: r1(m.cityWorkers), marketFarmers: r1(m.marketFarmers),
      subsistence: r1(m.subsistence), Ytotal: r1(m.Ytotal), treasury: r1(m.treasury),
      avgPrice: r3(m.avgPrice), cities: m.cities, roads: m.roadSegments,
      fundedFrac: r3(m.fundedFrac), Ksub: r1(world.Ksub),
      perCapWealth: m.cityWorkers > 1 ? r3(m.Ytotal / (m.cityWorkers + m.marketFarmers + m.subsistence)) : 0,
      // ---- settlement SHAPE: how the rule-set spends the map, not just how much ----
      // A rule-set can leave N untouched yet swing these wildly (one metropolis vs a
      // hundred hamlets; a tight cultivated core vs squatters in every corner).
      landTiles: m.landTiles, farmedTiles: m.farmedTiles,
      farmedOutsideBasin: m.farmedOutsideBasin,
      farmedFrac: m.landTiles > 0 ? r3(m.farmedTiles / m.landTiles) : 0,
      // THE carpet metric: share of worked land that no city can reach at any price.
      outsideBasinFrac: m.farmedTiles > 0 ? r3(m.farmedOutsideBasin / m.farmedTiles) : 0
    },
    health: { broken: broken, oscillation: oscillation, collapsed: collapsed,
      runaway: runaway, conservationOK: conservationOK, finite: finite,
      maxConsErrRel: r3(maxConsErrRel),
      oscAmp: r3(oscAmp), oscTol: r3(oscTol), settled: converged,
      structuralChurn: structuralChurn, cityChurn: cityChurn, extentChurn: r3(extentChurn) },
    traj: traj,
    permalink: permalinkFor(mapData, params, siteIdx, ranTicks),
    meta: { ticks: ranTicks, converged: converged, wallMs: Date.now() - t0, peakN: r1(peakN) }
  };
}

// Permalink into planet_economy.html reproducing THIS game's starting position.
// Mirrors the HTML's applyParams() contract: hash params, non-defaults only, `cities`
// pins the exact seeded tiles, `ticks` fast-forwards. Sweep rows carry one so a run
// that looks interesting in the analysis is one click from being inspected by hand.
// Only meaningful for planet (graph) maps — the HTML loads sample-map.json.
var UI_DEFAULTS = { K0: 1.0, roadMult: 0.30, urban: 0.5, kappa: 200, basinHyst: 0.08,
  r: 0.10, migrate: 0.5, cityFoundPop: 1000, tau: 0.15, wageShare: 2.5,
  garrisonPerDist: 3.0, degrade: 0.2, urbanDensityTarget: 2000, newCoreMinDist: 5,
  newCoreMinFarmers: 1500, newCoreMinSurplus: 400, maxUrbanFrac: 0.5, growBand: 0.05,
  dessertX: 3.0, dessertPremium: 0.5, dessertDisplace: 0, malthus: true, seaTravel: false,
  urbanize: true, desserts: false, growth: 'deadband',
  // stability layer (2026-07-16) — see docs/economy-stability.md
  basinAdjacency: true, stickyBasins: true, storage: true, merchants: true,
  storageDays: 8, storageRate: 0.15, merchantCapPerWorker: 0.5, merchantAggression: 0.35 };
function permalinkFor(mapData, params, siteIdx, ticks) {
  if (!mapData.graph) return null;
  var parts = [];
  Object.keys(UI_DEFAULTS).forEach(function (k) {
    if (params[k] === undefined || params[k] === UI_DEFAULTS[k]) return;
    var v = params[k];
    parts.push(k + '=' + (typeof v === 'boolean' ? (v ? '1' : '0') : v));
  });
  if (siteIdx && siteIdx.length) parts.push('cities=' + siteIdx.join(','));
  if (ticks) parts.push('ticks=' + ticks);
  return 'game/toy/planet_economy.html#' + parts.join('&');
}

function sample(m) {
  return { t: m.tick, N: r1(m.N), Y: r1(m.Ytotal), farm: r1(m.marketFarmers),
    sub: r1(m.subsistence), city: r1(m.cityWorkers), price: r3(m.avgPrice),
    cities: m.cities, roads: m.roadSegments, funded: r3(m.fundedFrac), treas: r1(m.treasury),
    farmed: m.farmedTiles, outside: m.farmedOutsideBasin };
}

// relative peak-to-peak of a ring — the ripple a rule-set settles INTO.
function amplitude(a) {
  if (a.length < 3) return 0;
  var lo = Infinity, hi = -Infinity, s = 0;
  for (var i = 0; i < a.length; i++) { if (a[i] < lo) lo = a[i]; if (a[i] > hi) hi = a[i]; s += a[i]; }
  var mean = s / a.length;
  return Math.abs(mean) < 1e-9 ? 0 : (hi - lo) / Math.abs(mean);
}
// max-min of a small integer ring (city counts): a count that keeps moving is churn.
function spread(a) {
  if (a.length < 2) return 0;
  var lo = Infinity, hi = -Infinity;
  for (var i = 0; i < a.length; i++) { if (a[i] < lo) lo = a[i]; if (a[i] > hi) hi = a[i]; }
  return hi - lo;
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
