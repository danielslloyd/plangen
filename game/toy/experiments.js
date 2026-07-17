// experiments.js — targeted trial runs for the three open questions about the
// 2026-07-16 stability layer (docs/economy-stability.md), plus a deep single-city trace.
//
//   E1 ROADS     — do roads between cities activate merchants?
//                  Baseline finding to beat: on the planet map at K0=1.0 the BEST
//                  arbitrage margin anywhere is -1.757 (transit 2.01 swamps every price
//                  gap of ~0.25), so merchants never move. A road costs base x roadMult,
//                  so a fully-built road should cut transit ~3.3x. Does that clear it?
//   E2 GRANARY   — do bigger granaries damp prices, or widen the swings?
//                  Real risk, not rhetorical: the granary's own restocking is DEMAND, and
//                  storageRate x storageDays x cityN can rival what the city eats. Above
//                  some size the buffer plausibly becomes the biggest trader in the market.
//   E3 DESSERTS  — can desserts coax merchants into activity?
//                  Mechanism under test: desserts pull grain OFF the food market (a dessert
//                  tile ships no grain), which should RAISE P at its city and widen the
//                  price gaps merchants need. Desserts themselves are not carted by
//                  merchants — this is an indirect effect and may not exist at all.
//   E4 NARRATIVE — trace one emergent city at stock defaults, tick by tick.
//
// Run:  node experiments.js <e1|e2|e3|all> [--ticks N] [--workers N]
//       node experiments.js e4 [--ticks N]
// Output: out/exp_<name>.jsonl  (append-per-batch; survives a kill — see the power-outage
//         incident in memory: manifests need tmp-write+rename, plain writeFileSync is not atomic)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const MAP = path.resolve(__dirname, '../../maps/sample-map.json');
const OUT = path.resolve(__dirname, 'out');

// ---------------------------------------------------------------------------
// shared: build the world exactly as planet_economy.html does, and measure it
// ---------------------------------------------------------------------------
function loadMap() {
  const Adapter = require('./game_map_adapter.js');
  return Adapter.adaptGameMap(JSON.parse(fs.readFileSync(MAP, 'utf8')), { withPolys: false });
}

// The sandbox's own defaults (planet_economy.html cfgFromKnobs), so every number here
// is comparable to what Dan sees in the browser. yieldVar:0 — calories already vary.
const UI_BASE = {
  K0: 1.0, roadMult: 0.30, urban: 0.5, kappa: 200, basinHyst: 0.08,
  r: 0.10, migrate: 0.5, cityFoundPop: 1000, tau: 0.15, wageShare: 2.5,
  garrisonPerDist: 3.0, degrade: 0.2, urbanDensityTarget: 2000, newCoreMinDist: 5,
  newCoreMinFarmers: 1500, newCoreMinSurplus: 400, maxUrbanFrac: 0.5, growBand: 0.05,
  dessertX: 3.0, dessertPremium: 0.5, dessertDisplace: 0,
  malthus: true, seaTravel: false, urbanize: true, desserts: false, yieldVar: 0
};

// Five different starting city-sets so a result is a property of the MODEL, not of one
// lucky seeding. Derived deterministically from the map's own ranked candidate sites.
function citySets(md) {
  const s = md.sites.slice();
  return [
    { id: 'sites5', cities: s.slice(0, 5) },
    { id: 'sites8', cities: s.slice(0, 8) },
    { id: 'sites12', cities: s.slice(0, 12) },
    { id: 'alt6', cities: s.filter((_, i) => i % 2 === 0).slice(0, 6) },
    { id: 'far4', cities: s.slice(-4) }
  ];
}

// ---- metrics -------------------------------------------------------------
function pctl(a, p) { if (!a.length) return NaN; const b = a.slice().sort((x, y) => x - y); return b[Math.floor(p * (b.length - 1))]; }
function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
function ripple(a) {
  if (a.length < 3) return 0;
  const lo = Math.min(...a), hi = Math.max(...a), m = mean(a);
  return Math.abs(m) < 1e-9 ? 0 : (hi - lo) / Math.abs(m);
}

function runOne(md, cfgOver, cities, opts) {
  const Econ = require('./econ_engine.js');
  const ticks = opts.ticks || 300, tailN = opts.tail || 60;
  const cfg = Object.assign({}, UI_BASE, cfgOver);
  const world = Econ.createWorld({ name: md.name, seed: md.seed, graph: md.graph, cities, config: cfg });
  Econ.step(world);

  // road projects between city pairs, per topology, once the seeds exist
  if (opts.roads && opts.roads !== 'none') wireRoads(Econ, world, opts.roads);

  const tail = [];
  const t0 = Date.now();
  let anyTrade = 0, tradeTicks = 0;
  for (let t = 0; t < ticks; t++) {
    const m = Econ.step(world);
    // 'full' topology keeps completing the graph as emergent cities appear
    if (opts.roads === 'full' && t % 20 === 0) wireRoads(Econ, world, 'full');
    if ((m.merchantVolume || 0) > 1e-6) { tradeTicks++; anyTrade += m.merchantVolume; }
    if (t >= ticks - tailN) {
      const ps = world.cities.map(k => world.prices[k]).filter(isFinite);
      // BEST ARBITRAGE on the board this tick: the single number that decides whether a
      // merchant can move at all. margin = P_B - P_A - transit(A->B), over ordered pairs.
      let bestMargin = -Infinity;
      for (const A of world.cities) for (const B of world.cities) {
        if (A === B) continue;
        const tr = world.transport[B] ? world.transport[B][A] : Infinity;
        if (!isFinite(tr)) continue;
        const mg = world.prices[B] - world.prices[A] - tr;
        if (mg > bestMargin) bestMargin = mg;
      }
      tail.push({
        N: m.N, cities: m.cities,
        pLo: Math.min(...ps), pMed: pctl(ps, 0.5), pHi: Math.max(...ps),
        pSpread: Math.max(...ps) / Math.max(1e-9, Math.min(...ps)),
        pIqr: pctl(ps, 0.75) - pctl(ps, 0.25),
        bestMargin: isFinite(bestMargin) ? bestMargin : -999,
        merchVol: m.merchantVolume || 0, merchRoutes: m.merchantRoutes || 0,
        stock: m.foodStock || 0, glut: m.foodGlut, short: m.foodShortfall,
        roads: m.roadSegments, treas: m.treasury,
        farmed: m.farmedTiles, cons: m.conservationErr / Math.max(1, m.foodProduced)
      });
    }
  }
  const col = k => tail.map(r => r[k]);
  return {
    ms: Date.now() - t0,
    N: mean(col('N')), NRipple: ripple(col('N')),
    cities: mean(col('cities')),
    // ---- price stability: THREE different things, deliberately kept apart ----
    //  pMedMean  : the level
    //  pMedRipple: how much the median MOVES over time  (temporal stability)
    //  pSpread   : max/min ACROSS cities at one instant (spatial dispersion; what a
    //              merchant actually arbitrages)
    pMedMean: mean(col('pMed')), pMedRipple: ripple(col('pMed')),
    pLoMean: mean(col('pLo')), pHiMean: mean(col('pHi')), pHiMax: Math.max(...col('pHi')),
    pSpread: mean(col('pSpread')), pIqr: mean(col('pIqr')),
    bestMargin: mean(col('bestMargin')), bestMarginMax: Math.max(...col('bestMargin')),
    merchVol: mean(col('merchVol')), merchRoutes: mean(col('merchRoutes')),
    tradeTickFrac: tradeTicks / ticks, tradeTotal: anyTrade,
    stock: mean(col('stock')), glut: mean(col('glut')), short: mean(col('short')),
    roads: mean(col('roads')), treas: mean(col('treas')),
    farmed: mean(col('farmed')), consMax: Math.max(...col('cons'))
  };
}

// Road topology between the CURRENT cities. 'tree' = each city to its nearest already-
// linked city (a spanning tree); 'full' = every pair. Roads are only projects — whether
// they finish depends on tau/treasury, which is itself an axis in E1.
function wireRoads(Econ, world, mode) {
  const cs = world.cities.slice();
  if (cs.length < 2) return;
  if (mode === 'full') {
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) Econ.startRoadProject(world, cs[i], cs[j]);
  } else if (mode === 'tree') {
    const linked = [cs[0]];
    for (let i = 1; i < cs.length; i++) {
      let best = -1, bd = Infinity;
      for (const L of linked) { const d = Econ.physDist(world, cs[i], L); if (d < bd) { bd = d; best = L; } }
      if (best >= 0) Econ.startRoadProject(world, best, cs[i]);
      linked.push(cs[i]);
    }
  }
}

// ---------------------------------------------------------------------------
// job lists
// ---------------------------------------------------------------------------
function combos(axes) {
  const keys = Object.keys(axes);
  let out = [{}];
  for (const k of keys) {
    const next = [];
    for (const base of out) for (const v of axes[k]) next.push(Object.assign({}, base, { [k]: v }));
    out = next;
  }
  return out;
}
// seeded Fisher-Yates: any PREFIX of a shuffled run is a representative sample of the
// whole grid, so an interrupted run is still analysable (harness.js does the same).
function shuffle(a, seed) {
  let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function buildJobs(which, md) {
  const sets = citySets(md);
  const jobs = [];
  if (which === 'e1' || which === 'all') {
    // ROADS. K0 spans the regime where merchants are dead (1.0+) into where they might
    // live (0.3). roadMult is how much a finished road actually buys. tau funds the crews
    // — at tau=0 roads never get built at all (already a validated gate), so it is the
    // natural negative control.
    for (const c of combos({
      roads: ['none', 'tree', 'full'],
      roadMult: [0.1, 0.2, 0.3, 0.5],
      tau: [0.0, 0.15, 0.3, 0.5],
      K0: [0.3, 0.5, 1.0, 2.0]
    })) for (const s of sets) {
      jobs.push({ exp: 'e1', cfg: { roadMult: c.roadMult, tau: c.tau, K0: c.K0 }, roads: c.roads, set: s.id, cities: s.cities, axes: c });
    }
  }
  if (which === 'e2' || which === 'all') {
    // GRANARIES. storageDays 0 = storage effectively off (target 0 => bid 0 => no buffer).
    // storageRate below 1/storageDays cannot cover a day's demand (the floor found in the
    // stability work); above ~0.25 the granary's restocking rivals the city. storageFill
    // 0 = pure price-timer (which provably never fills), 1 = restock-dominant.
    for (const c of combos({
      storageDays: [0, 2, 4, 8, 16, 24, 40],
      storageRate: [0.02, 0.05, 0.10, 0.15, 0.25, 0.40],
      storageFill: [0, 0.5, 1.0],
      K0: [0.3, 1.0, 2.0]
    })) for (const s of sets) {
      jobs.push({ exp: 'e2', cfg: { storageDays: c.storageDays, storageRate: c.storageRate, storageFill: c.storageFill, K0: c.K0 }, roads: 'none', set: s.id, cities: s.cities, axes: c });
    }
  }
  if (which === 'e3' || which === 'all') {
    // DESSERTS. premium MUST be < 1 or every tile converts at the city gate. D=X is
    // food-neutral; D=0 is pure export (most grain burned). Reach multiplies by
    // premium x X — the spec says keep that product ~1.5-2.5, so this deliberately
    // brackets it (0.6 .. 7.6) to see what trade does outside the sane band.
    for (const c of combos({
      dessertX: [2, 3, 4, 6, 8],
      dessertPremium: [0.3, 0.5, 0.7, 0.95],
      dessertDisplace: [0, 1, 3, 6],
      K0: [0.3, 1.0, 2.0]
    })) for (const s of sets) {
      jobs.push({ exp: 'e3', cfg: { desserts: true, dessertX: c.dessertX, dessertPremium: c.dessertPremium, dessertDisplace: c.dessertDisplace, K0: c.K0 }, roads: 'none', set: s.id, cities: s.cities, axes: c });
    }
    // controls: desserts OFF at each K0/set, so every dessert row has a same-map baseline
    for (const K0 of [0.3, 1.0, 2.0]) for (const s of sets) {
      jobs.push({ exp: 'e3', cfg: { desserts: false, K0 }, roads: 'none', set: s.id, cities: s.cities, axes: { dessertX: 0, dessertPremium: 0, dessertDisplace: 0, K0, control: true } });
    }
  }
  return shuffle(jobs, 0xC0FFEE);
}

// ---------------------------------------------------------------------------
// worker
// ---------------------------------------------------------------------------
if (!isMainThread) {
  const md = loadMap();
  parentPort.on('message', (batch) => {
    const rows = [];
    for (const j of batch) {
      try {
        const r = runOne(md, j.cfg, j.cities, { roads: j.roads, ticks: workerData.ticks });
        rows.push({ exp: j.exp, set: j.set, topo: j.roads, axes: j.axes, ...r });   // `topo`, not `roads`: runOne returns a `roads` METRIC (segment count) and the spread would clobber it
      } catch (e) {
        rows.push({ exp: j.exp, set: j.set, topo: j.roads, axes: j.axes, error: String(e && e.message || e) });
      }
    }
    parentPort.postMessage(rows);
  });
  return;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
function writeAtomic(p, s) { fs.writeFileSync(p + '.tmp', s); fs.renameSync(p + '.tmp', p); }

async function main() {
  const args = process.argv.slice(2);
  const which = (args[0] || 'all').toLowerCase();
  const ticks = +(args.find(a => a.startsWith('--ticks='))?.split('=')[1]) || 300;
  const nWorkers = +(args.find(a => a.startsWith('--workers='))?.split('=')[1]) || Math.max(1, Math.min(22, os.cpus().length - 2));
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  if (which === 'e4') { require('./narrative.js').run(ticks); return; }

  const md = loadMap();
  const jobs = buildJobs(which, md);
  const outFile = path.join(OUT, `exp_${which}.jsonl`);
  fs.writeFileSync(outFile, '');
  console.log(`experiments: ${which}  jobs=${jobs.length}  ticks=${ticks}  workers=${nWorkers}`);
  console.log(`out: ${outFile}`);

  const t0 = Date.now();
  let done = 0, next = 0;
  const BATCH = 2;   // small batches so completed work reaches disk fast and survives a kill
  const workers = [];
  await new Promise((resolve) => {
    const feed = (w) => {
      if (next >= jobs.length) { w.terminate(); if (++finished === workers.length) resolve(); return; }
      const batch = jobs.slice(next, next + BATCH); next += batch.length;
      w.postMessage(batch);
    };
    let finished = 0;
    for (let i = 0; i < nWorkers; i++) {
      const w = new Worker(__filename, { workerData: { ticks } });
      workers.push(w);
      w.on('message', (rows) => {
        fs.appendFileSync(outFile, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
        done += rows.length;
        const el = (Date.now() - t0) / 1000;
        const rate = done / el, eta = (jobs.length - done) / Math.max(rate, 1e-9);
        if (done % 50 < BATCH) {
          process.stdout.write(`\r  ${done}/${jobs.length}  ${(100 * done / jobs.length).toFixed(1)}%  ${rate.toFixed(1)}/s  eta ${(eta / 60).toFixed(1)}min   `);
          writeAtomic(path.join(OUT, `exp_${which}.manifest.json`), JSON.stringify({ which, ticks, jobs: jobs.length, done, elapsedS: el, partial: true }, null, 2));
        }
        feed(w);
      });
      w.on('error', (e) => { console.error('\nworker error', e); feed(w); });
      feed(w);
    }
  });
  const el = (Date.now() - t0) / 1000;
  writeAtomic(path.join(OUT, `exp_${which}.manifest.json`), JSON.stringify({ which, ticks, jobs: jobs.length, done, elapsedS: el, partial: false }, null, 2));
  console.log(`\ndone: ${done} games in ${(el / 60).toFixed(1)} min`);
}

// Exports MUST come before main(): `experiments.js e4` calls into narrative.js, which
// requires this file straight back. On a circular require Node hands back whatever
// module.exports holds AT THAT MOMENT — so assigning it after main() would give narrative
// an empty object and crash on loadMap.
module.exports = { runOne, loadMap, UI_BASE, citySets, wireRoads, buildJobs, combos };

// `require.main === module` guard: without it, merely REQUIRING this file (as narrative.js
// does, and as any future analysis script would) launches a full 4000-game sweep as a side
// effect of the import. Learned the hard way.
if (isMainThread && require.main === module) main().catch(e => { console.error(e); process.exit(1); });
