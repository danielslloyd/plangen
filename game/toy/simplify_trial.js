// simplify_trial.js — test Dan's trade-simplification + seeding proposals (2026-07-17).
//   node simplify_trial.js
'use strict';
const Econ = require('./econ_engine.js');
const { loadMap, UI_BASE } = require('./experiments.js');
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const ripple = a => { const lo = Math.min(...a), hi = Math.max(...a), m = mean(a); return Math.abs(m) < 1e-9 ? 0 : (hi - lo) / Math.abs(m); };
const f = (x, d = 2) => (x == null || !isFinite(x)) ? '--' : x.toFixed(d);
function grid(cols, rows, fn) { const c = []; for (let r = 0; r < rows; r++) for (let x = 0; x < cols; x++) c.push(fn(x, r)); return { cols, rows, cells: c }; }

// ===========================================================================
// A. ISLAND — lag vs granary merchant model, head to head, where trade runs
// ===========================================================================
const ISL = grid(17, 9, c => (c >= 7 && c <= 9) ? 'water' : (c < 7 ? 'rich' : 'barren'));
function island(over) {
  const cfg = Object.assign({
    urban: 0.5, migrate: 0.5, urbanize: false, yieldVar: 0, edgeVar: 0,
    K0: 0.2, seaTravel: true, seaCostFrac: 0.3, harborCost: 0.2, harborWorkers: 0,
    fishPerSea: 0, newCoreMinSurplus: 1e9
  }, over);
  const w = Econ.createWorld({ cols: ISL.cols, rows: ISL.rows, cells: ISL.cells,
    cities: [{ col: 6, row: 4 }, { col: 10, row: 4 }], config: cfg });
  Econ.step(w);
  const A = w.cities[0], B = w.cities[1];
  const ps = [], ns = [], vols = [], profits = [];
  let dry = 0;
  const t0 = process.hrtime.bigint();
  for (let t = 0; t < 400; t++) {
    const m = Econ.step(w);
    if (t >= 340) {
      ps.push(w.prices[B]); ns.push(w.cityN[B] || 0); vols.push(m.merchantVolume || 0);
      profits.push(m.merchantProfit || 0);
      if ((m.merchantVolume || 0) <= 1e-9) dry++;
    }
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { pRipple: ripple(ps), pMean: mean(ps), nMean: mean(ns), volMean: mean(vols),
    dryFrac: dry / ps.length, profit: mean(profits), pA: w.prices[A], ms,
    cons: w.metrics.conservationErr / w.metrics.foodProduced };
}
console.log('=== A. ISLAND: lag vs granary merchant model (barren city fed only by sea) ===');
console.log('The granary model has NO demandAt/aggression lag — the anti-cobweb is the granary');
console.log('buffer (a fed city coasts on its reserve instead of re-buying every tick).\n');
console.log('model                       | P[B] ripple | P[B] mean | N[B] mean | vol/tick | dry ticks | profit/tk | ms/400t | cons');
console.log('----------------------------|-------------|-----------|-----------|----------|-----------|-----------|---------|------');
for (const [label, over] of [
  ['lag (shipped)', {}],
  ['lag + profitGold', { merchantProfitGold: true }],
  ['granary', { merchantModel: 'granary' }],
  ['granary + profitGold', { merchantModel: 'granary', merchantProfitGold: true }],
]) {
  const r = island(over);
  console.log(label.padEnd(28) + '|' + f(r.pRipple, 4).padStart(12) + ' |' + f(r.pMean, 3).padStart(10) + ' |' +
    f(r.nMean, 0).padStart(10) + ' |' + f(r.volMean, 1).padStart(9) + ' |' + (100 * r.dryFrac).toFixed(0).padStart(8) + '% |' +
    f(r.profit, 2).padStart(10) + ' |' + f(r.ms, 0).padStart(8) + ' |' + r.cons.toExponential(1).padStart(9));
}

// ===========================================================================
// B. PLANET — compute cost + does the granary model change the settled economy?
// ===========================================================================
const md = loadMap();
function planet(over, ticks) {
  const cfg = Object.assign({}, UI_BASE, over);
  const w = Econ.createWorld({ name: md.name, seed: md.seed, graph: md.graph, cities: md.sites.slice(0, 5), config: cfg });
  Econ.step(w);
  const t0 = process.hrtime.bigint();
  for (let t = 0; t < (ticks || 300); t++) Econ.step(w);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const m = w.metrics;
  const ps = w.cities.map(k => w.prices[k]).filter(isFinite).sort((a, b) => a - b);
  return { N: m.N, cities: m.cities, price: m.avgPrice, Y: m.Ytotal, merchVol: m.merchantVolume,
    ms, pSpread: ps[ps.length - 1] / ps[0], cons: m.conservationErr / m.foodProduced };
}
console.log('\n\n=== B. PLANET: compute cost + settled economy (merchants dead here, so parity expected) ===');
console.log('model             | N       | cities | avg price | pSpread | merchVol | ms/300t | cons');
console.log('------------------|---------|--------|-----------|---------|----------|---------|------');
for (const [label, over] of [['lag (shipped)', {}], ['granary', { merchantModel: 'granary' }]]) {
  const r = planet(over);
  console.log(label.padEnd(18) + '|' + f(r.N, 0).padStart(8) + ' |' + f(r.cities, 0).padStart(7) + ' |' +
    f(r.price, 3).padStart(10) + ' |' + f(r.pSpread, 1).padStart(8) + '×|' + f(r.merchVol, 1).padStart(9) + ' |' +
    f(r.ms, 0).padStart(8) + ' |' + r.cons.toExponential(1).padStart(9));
}

// ===========================================================================
// C. SEEDING — does newCoreFoundPop tame birth violence?
// ===========================================================================
function birthStats(over) {
  const cfg = Object.assign({}, UI_BASE, over);
  const w = Econ.createWorld({ name: md.name, seed: md.seed, graph: md.graph, cities: md.sites.slice(0, 5), config: cfg });
  Econ.step(w);
  const prevN = {}, births = [];
  for (let t = 0; t < 300; t++) {
    Econ.step(w);
    for (const k of w.cities) {
      if (prevN[k] === undefined) {
        // first tick this city exists: record its intake and whether it has a price
        births.push({ rep: k, firstN: w.cityN[k] || 0, hasPrice: w.prices[k] != null && isFinite(w.prices[k]),
          seed: !!w.hexes[k].seed });
      }
      prevN[k] = w.cityN[k] || 0;
    }
  }
  const em = births.filter(b => !b.seed);
  const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
  return { n: em.length, medFirst: q(em.map(b => b.firstN), 0.5), maxFirst: Math.max(...em.map(b => b.firstN)),
    pricedFrac: em.filter(b => b.hasPrice).length / Math.max(1, em.length),
    N: w.metrics.N, cons: w.metrics.conservationErr / w.metrics.foodProduced };
}
console.log('\n\n=== C. SEEDING: does newCoreFoundPop soften the cold-start? ===');
console.log('Cold start = a new city drawn in by uncapped migration (median 233 in tick one) with');
console.log('NO price on its birth tick. A warm start seeds workers + a local price.\n');
console.log('newCoreFoundPop | emergent cities | median 1st-tick N | max 1st-tick N | priced at birth | final N | cons');
console.log('----------------|-----------------|-------------------|----------------|-----------------|---------|------');
for (const fp of [0, 100, 200, 400]) {
  const r = birthStats({ newCoreFoundPop: fp });
  console.log(String(fp).padStart(15) + ' |' + String(r.n).padStart(16) + ' |' + f(r.medFirst, 0).padStart(18) + ' |' +
    f(r.maxFirst, 0).padStart(15) + ' |' + (100 * r.pricedFrac).toFixed(0).padStart(15) + '% |' + f(r.N, 0).padStart(8) + ' |' + r.cons.toExponential(1).padStart(9));
}
