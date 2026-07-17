// overshoot_trial.js — test Dan's proposal (2026-07-17) against the shipped granary model.
//
// THE PROPOSAL
//   (a) foodPolicy:'overshoot' — kill the granary's separate bid. A city just buys
//       demand x (1+overshoot) while its reserves are short, and exactly demand once full.
//   (b) growthGate:'foodSecurity' — a city only contributes population growth once its
//       granary has been FULL for growthFullTurns consecutive ticks.
//
// THE CLAIM WORTH TESTING: "hungry cities would be buyers for longer than one turn."
// That targets a real, measured failure — the merchant route gate is BINARY (margin > 0),
// so one tick where the destination's price dips below P_A + transit deletes the entire
// caravan fleet and resets the flow to zero. Ripple was FLAT at 44-53% across
// merchantAggression 0.15->1.0, proving no amount of quantity damping can fix it. A
// persistently hungry buyer is a different kind of fix: it holds the margin positive
// across those ticks instead of trying to damp the response to them.
//
// Three arenas, because the proposal touches three different things:
//   A. ISLAND    — a city with ZERO local food fed only by sea caravans. The ONLY place
//                  merchants actually ring, so the only place the claim can be tested.
//   B. PLANET    — does it reduce the granary-fill tax (+3.24% for 72 ticks, 41/41 cities)?
//   C. DROUGHT   — does it beat the granary model's shock response (U-curve, best 3.3%)?
//
//   node overshoot_trial.js
'use strict';
const Econ = require('./econ_engine.js');
const { loadMap, UI_BASE } = require('./experiments.js');

const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const med = a => { if (!a.length) return NaN; const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const ripple = a => { const lo = Math.min(...a), hi = Math.max(...a), m = mean(a); return Math.abs(m) < 1e-9 ? 0 : (hi - lo) / Math.abs(m); };
const f = (x, d = 2) => (x == null || !isFinite(x)) ? '--' : x.toFixed(d);

// ===========================================================================
// A. ISLAND — the merchant-ringing arena (validate_trade section C's scenario)
// ===========================================================================
function grid(cols, rows, fn) { const c = []; for (let r = 0; r < rows; r++) for (let x = 0; x < cols; x++) c.push(fn(x, r)); return { cols, rows, cells: c }; }
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
  const ps = [], ns = [], vols = [];
  let dryTicks = 0;                       // ticks where the caravan fleet went to ZERO
  for (let t = 0; t < 400; t++) {
    const m = Econ.step(w);
    if (t >= 340) {
      ps.push(w.prices[B]); ns.push(w.cityN[B] || 0); vols.push(m.merchantVolume || 0);
      if ((m.merchantVolume || 0) <= 1e-9) dryTicks++;
    }
  }
  return {
    pRipple: ripple(ps), pMean: mean(ps), nMean: mean(ns), nRipple: ripple(ns),
    volMean: mean(vols), dryFrac: dryTicks / ps.length,
    pA: w.prices[A], cons: w.metrics.conservationErr / w.metrics.foodProduced
  };
}

console.log('=== A. ISLAND: a city with ZERO local food, fed only by sea caravans ===');
console.log('The one arena where merchants actually run. "dry ticks" = ticks the fleet went');
console.log('to zero — the binary-gate failure. Dan\'s claim predicts a hungry city stays a');
console.log('buyer, so the margin never dips and dry ticks fall.\n');
console.log('policy                        | P[B] ripple | P[B] mean | N[B] mean | N[B] ripple | vol/tick | DRY ticks');
console.log('------------------------------|-------------|-----------|-----------|-------------|----------|----------');
const islRows = [];
for (const [label, over] of [
  ['granary (shipped)', {}],
  ['overshoot 0.05', { foodPolicy: 'overshoot', overshoot: 0.05 }],
  ['overshoot 0.10', { foodPolicy: 'overshoot', overshoot: 0.10 }],
  ['overshoot 0.20', { foodPolicy: 'overshoot', overshoot: 0.20 }],
  ['overshoot 0.35', { foodPolicy: 'overshoot', overshoot: 0.35 }],
  ['overshoot 0.20 hard-switch', { foodPolicy: 'overshoot', overshoot: 0.20, overshootBand: 0 }],
]) {
  const r = island(over); islRows.push({ label, ...r });
  console.log(label.padEnd(30) + '|' + f(r.pRipple, 4).padStart(12) + ' |' + f(r.pMean, 3).padStart(10) + ' |' +
    f(r.nMean, 0).padStart(10) + ' |' + f(r.nRipple, 4).padStart(12) + ' |' + f(r.volMean, 1).padStart(9) + ' |' +
    (100 * r.dryFrac).toFixed(0).padStart(8) + '%');
}
const base = islRows[0], best = islRows.slice(1).reduce((a, b) => b.pRipple < a.pRipple ? b : a);
console.log(`\n=> best: ${best.label}, price ripple ${f(base.pRipple, 4)} -> ${f(best.pRipple, 4)} ` +
  `(${(100 * (1 - best.pRipple / base.pRipple)).toFixed(0)}%), dry ticks ${(100 * base.dryFrac).toFixed(0)}% -> ${(100 * best.dryFrac).toFixed(0)}%`);

// ===========================================================================
// B. PLANET — the granary-fill tax
// ===========================================================================
const md = loadMap();
function planetFillTax(over) {
  const cfg = Object.assign({}, UI_BASE, over);
  const w = Econ.createWorld({ name: md.name, seed: md.seed, graph: md.graph, cities: md.sites.slice(0, 5), config: cfg });
  Econ.step(w);
  const hist = {};
  for (let t = 0; t < 400; t++) {
    Econ.step(w);
    for (const k of w.cities) (hist[k] || (hist[k] = [])).push({
      t: w.tick, P: w.prices[k], stock: w.stock[k] || 0, target: Econ.storageTarget(w, k)
    });
  }
  const taxes = [], fills = [];
  for (const k of Object.keys(hist)) {
    const H = hist[k], fin = H[H.length - 1];
    if (!fin || !(fin.P > 0) || fin.target <= 0) continue;
    const full = H.find(x => x.target > 0 && x.stock >= 0.99 * x.target);
    if (!full) continue;
    const filling = H.filter(x => x.t < full.t && x.P > 0 && x.target > 0 && x.stock < 0.99 * x.target);
    if (filling.length < 5) continue;
    taxes.push(mean(filling.map(x => x.P)) / fin.P - 1);
    fills.push(filling.length);
  }
  const m = w.metrics;
  return { tax: med(taxes), fillTicks: med(fills), n: taxes.length, N: m.N, cities: m.cities,
    stock: m.foodStock, glut: m.foodGlut, sec: m.securityFrac,
    cons: m.conservationErr / Math.max(1, m.foodProduced) };
}
console.log('\n\n=== B. PLANET: the granary-fill tax (shipped = +3.24% for 72 ticks, 41/41 cities) ===');
console.log('While restocking, a granary is a net BUYER — it bids against its own eaters.');
console.log('Does folding that into the city\'s demand make it smaller, or just rename it?\n');
console.log('policy                | fill tax | fill ticks | cities taxed | N       | cities | stock   | glut');
console.log('----------------------|----------|------------|--------------|---------|--------|---------|------');
for (const [label, over] of [
  ['granary (shipped)', {}],
  ['overshoot 0.05', { foodPolicy: 'overshoot', overshoot: 0.05 }],
  ['overshoot 0.10', { foodPolicy: 'overshoot', overshoot: 0.10 }],
  ['overshoot 0.20', { foodPolicy: 'overshoot', overshoot: 0.20 }],
]) {
  const r = planetFillTax(over);
  console.log(label.padEnd(22) + '|' + (100 * r.tax).toFixed(2).padStart(7) + '% |' + f(r.fillTicks, 0).padStart(11) + ' |' +
    String(r.n).padStart(13) + ' |' + f(r.N, 0).padStart(8) + ' |' + f(r.cities, 0).padStart(7) + ' |' +
    f(r.stock, 0).padStart(8) + ' |' + f(r.glut, 0).padStart(6));
}

// ===========================================================================
// C. GROWTH GATE — does it settle, or reintroduce a cycle?
// ===========================================================================
function planetGrowth(over) {
  const cfg = Object.assign({}, UI_BASE, over);
  const w = Econ.createWorld({ name: md.name, seed: md.seed, graph: md.graph, cities: md.sites.slice(0, 5), config: cfg });
  Econ.step(w);
  const Ns = [], secs = [], ps = [];
  for (let t = 0; t < 500; t++) {
    const m = Econ.step(w);
    if (t >= 400) {
      Ns.push(m.N); secs.push(m.securityFrac);
      const pv = w.cities.map(k => w.prices[k]).filter(isFinite).sort((a, b) => a - b);
      ps.push(pv[pv.length >> 1]);
    }
  }
  return { N: mean(Ns), NRipple: ripple(Ns), pMed: mean(ps), pRipple: ripple(ps),
    sec: mean(secs), cities: w.metrics.cities };
}
console.log('\n\n=== C. GROWTH GATE: grow only where the granary has been full N ticks ===');
console.log('RISK under test: grow -> demand up -> granary drains -> growth stops -> refill ->');
console.log('grow is negative feedback WITH A LAG, i.e. the shape of a limit cycle. `deadband`');
console.log('already measures 0.0000 ripple, so there is no headroom — only realism.\n');
console.log('config                                  | N       | N ripple | med price | P ripple | secure share | cities');
console.log('----------------------------------------|---------|----------|-----------|----------|--------------|-------');
for (const [label, over] of [
  ['global gate (shipped)', {}],
  ['foodSecurity, full for 3', { growthGate: 'foodSecurity', growthFullTurns: 3 }],
  ['foodSecurity, full for 5', { growthGate: 'foodSecurity', growthFullTurns: 5 }],
  ['foodSecurity, full for 10', { growthGate: 'foodSecurity', growthFullTurns: 10 }],
  ['foodSecurity 5 + overshoot 0.10', { growthGate: 'foodSecurity', growthFullTurns: 5, foodPolicy: 'overshoot', overshoot: 0.10 }],
  ['foodSecurity 5 + oversh 0.10 + bangbang', { growthGate: 'foodSecurity', growthFullTurns: 5, foodPolicy: 'overshoot', overshoot: 0.10, growth: 'bangbang' }],
]) {
  const r = planetGrowth(over);
  console.log(label.padEnd(40) + '|' + f(r.N, 0).padStart(8) + ' |' + f(r.NRipple, 4).padStart(9) + ' |' +
    f(r.pMed, 3).padStart(10) + ' |' + f(r.pRipple, 4).padStart(9) + ' |' + f(r.sec, 3).padStart(13) + ' |' + String(r.cities).padStart(6));
}
