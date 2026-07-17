// drought.js — E2b: the question E2 CANNOT answer.
//
// E2 measures granaries on a settled map, where the price ripple is already 0.0000. On
// that evidence bigger granaries look purely harmful (they add ripple and nothing else),
// but that is measuring a buffer in a world with nothing to buffer. A granary's whole
// purpose is to absorb a SHOCK, so shock it: cut every tile's harvest for a few ticks and
// watch what the price does, with granaries of every size.
//
// This is the honest form of Dan's question "do larger granaries help stabilize prices,
// or just lead to wider swings?" — the answer is allowed to be "both, in different
// regimes", and separating them is the point.
//
//   node drought.js [--ticks=250] [--severity=0.7] [--length=5]
'use strict';
const path = require('path');
const Econ = require('./econ_engine.js');
const { loadMap, UI_BASE, citySets } = require('./experiments.js');

const arg = (n, d) => { const a = process.argv.find(x => x.startsWith('--' + n + '=')); return a ? +a.split('=')[1] : d; };
const SETTLE = arg('ticks', 250), SEV = arg('severity', 0.7), LEN = arg('length', 5), AFTER = 60;

const md = loadMap();
const sets = citySets(md);

// A drought scales every tile's intrinsic capacity. capBase is what computeCapacity reads,
// so scaling it and calling reconfigure() re-derives C / Cfood / Lsub / Ksub consistently
// — the same path the UI uses for a live knob change, so nothing goes out of sync.
function scaleCap(world, base, factor) {
  for (let i = 0; i < world.capBase.length; i++) world.capBase[i] = base[i] * factor;
  Econ.reconfigure(world);
}

function trial(storageDays, cities) {
  const cfg = Object.assign({}, UI_BASE, { storageDays });
  const world = Econ.createWorld({ name: md.name, seed: md.seed, graph: md.graph, cities, config: cfg });
  Econ.step(world);
  for (let t = 0; t < SETTLE; t++) Econ.step(world);

  const base = Float64Array.from(world.capBase);
  const medP = () => { const p = world.cities.map(k => world.prices[k]).filter(isFinite).sort((a, b) => a - b); return p[p.length >> 1]; };
  const p0 = medP(), N0 = world.N;

  // --- the drought ---
  scaleCap(world, base, SEV);
  let peakP = p0, troughN = N0, peakShort = 0;
  for (let t = 0; t < LEN; t++) {
    const m = Econ.step(world);
    peakP = Math.max(peakP, medP()); troughN = Math.min(troughN, m.N);
    peakShort = Math.max(peakShort, m.foodShortfall);
  }
  // --- the rains return ---
  scaleCap(world, base, 1.0);
  let recovered = -1;
  for (let t = 0; t < AFTER; t++) {
    const m = Econ.step(world);
    peakP = Math.max(peakP, medP()); troughN = Math.min(troughN, m.N);
    peakShort = Math.max(peakShort, m.foodShortfall);
    if (recovered < 0 && Math.abs(medP() - p0) / p0 < 0.02) recovered = t + 1;
  }
  return {
    storageDays,
    priceSpike: (peakP - p0) / p0,          // how far the price ran
    popDrop: (N0 - troughN) / N0,           // how many people it cost
    peakShort,                              // mouths that went unfed at the worst tick
    recoverTicks: recovered < 0 ? AFTER : recovered,
    p0, peakP
  };
}

const med = a => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
console.log(`DROUGHT: harvest x${SEV} for ${LEN} ticks, after ${SETTLE} ticks of settling; ${sets.length} city-sets each.`);
console.log(`A granary that "stabilises prices" must shrink priceSpike. One that only adds`);
console.log(`inventory will not. One that is TOO big may be a net drag (it competes for the`);
console.log(`same grain while restocking).\n`);
console.log('days | price spike | pop drop | peak unfed | recover (ticks) | P before -> peak');
console.log('-----|-------------|----------|------------|-----------------|------------------');
const out = [];
for (const days of [0, 2, 4, 8, 16, 24, 40]) {
  const rs = sets.map(s => trial(days, s.cities));
  const r = {
    days,
    spike: med(rs.map(x => x.priceSpike)), drop: med(rs.map(x => x.popDrop)),
    short: med(rs.map(x => x.peakShort)), rec: med(rs.map(x => x.recoverTicks)),
    p0: med(rs.map(x => x.p0)), pk: med(rs.map(x => x.peakP))
  };
  out.push(r);
  console.log(`${String(days).padStart(4)} | ${(100 * r.spike).toFixed(1).padStart(10)}% | ${(100 * r.drop).toFixed(1).padStart(7)}% |` +
    `${r.short.toFixed(0).padStart(11)} |${String(r.rec).padStart(16)} | ${r.p0.toFixed(3)} -> ${r.pk.toFixed(3)}`);
}
const best = out.reduce((a, b) => (b.spike < a.spike ? b : a));
console.log(`\nsmallest price spike at storageDays=${best.days} (${(100 * best.spike).toFixed(1)}%)`);
console.log(`vs no granary (days=0): ${(100 * out[0].spike).toFixed(1)}%  =>  granaries cut the drought spike by ` +
  `${(100 * (1 - best.spike / out[0].spike)).toFixed(0)}%`);
require('fs').writeFileSync(path.resolve(__dirname, 'out/drought.json'), JSON.stringify({ severity: SEV, length: LEN, settle: SETTLE, rows: out }, null, 2));
