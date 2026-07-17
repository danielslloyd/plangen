// analyze_experiments.js — turn out/exp_*.jsonl into an answer, not a data dump.
//   node analyze_experiments.js [out/exp_all.jsonl]
// Safe to run on a PARTIAL file: the job list is deterministically shuffled, so any
// prefix is a representative sample of the whole grid.
'use strict';
const fs = require('fs');
const path = require('path');

const file = process.argv[2] || path.resolve(__dirname, 'out/exp_all.jsonl');
const rows = fs.readFileSync(file, 'utf8').trim().split('\n')
  .filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } })
  .filter(r => r && !r.error);

// NOTE `r.roads` is the road SEGMENT COUNT (a metric), not the topology — the worker
// spreads runOne()'s result over the job and the two keys collide. The topology survives
// as `r.axes.roads`. Read it through TOPO() so the collision is stated once, here.
const TOPO = r => r.axes.roads;
const med = a => { if (!a.length) return NaN; const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const f = (x, d = 2) => (x == null || !isFinite(x)) ? '--' : x.toFixed(d);

// group rows by a key function -> { key: [rows] }
function by(rs, fn) { const g = {}; for (const r of rs) { const k = fn(r); (g[k] || (g[k] = [])).push(r); } return g; }
// merchants "active" = actually moved grain in the settled tail
const ACTIVE = r => r.merchVol > 1e-6;
function summarize(rs) {
  return {
    n: rs.length,
    active: rs.filter(ACTIVE).length,
    activeFrac: rs.filter(ACTIVE).length / rs.length,
    merchVol: med(rs.map(r => r.merchVol)),
    merchVolMax: Math.max(...rs.map(r => r.merchVol)),
    bestMargin: med(rs.map(r => r.bestMargin)),
    bestMarginMax: Math.max(...rs.map(r => r.bestMarginMax)),
    tradeTickFrac: med(rs.map(r => r.tradeTickFrac)),
    roads: med(rs.map(r => r.roads)),
    N: med(rs.map(r => r.N)), NRipple: med(rs.map(r => r.NRipple)),
    pMed: med(rs.map(r => r.pMedMean)), pMedRipple: med(rs.map(r => r.pMedRipple)),
    pSpread: med(rs.map(r => r.pSpread)), pIqr: med(rs.map(r => r.pIqr)),
    pHiMax: Math.max(...rs.map(r => r.pHiMax)),
    stock: med(rs.map(r => r.stock)), glut: med(rs.map(r => r.glut)), short: med(rs.map(r => r.short)),
    cities: med(rs.map(r => r.cities)), consMax: Math.max(...rs.map(r => r.consMax))
  };
}
function table(title, groups, cols, order) {
  const out = [`\n### ${title}\n`];
  out.push('| ' + cols.map(c => c[0]).join(' | ') + ' |');
  out.push('|' + cols.map(() => '---').join('|') + '|');
  const keys = order || Object.keys(groups).sort((a, b) => (+a) - (+b) || a.localeCompare(b));
  for (const k of keys) {
    if (!groups[k]) continue;
    const s = summarize(groups[k]);
    out.push('| ' + cols.map(c => c[1](k, s)).join(' | ') + ' |');
  }
  return out.join('\n');
}

const L = [];
L.push('# Experiment results — roads, granaries, desserts\n');
L.push(`Source: \`${path.basename(file)}\`, **${rows.length} games**, 300 ticks each, planet map`);
L.push(`(\`maps/sample-map.json\`), 5 starting city-sets per cell. Medians across sets unless noted.`);
L.push(`\nBaseline to beat, at stock defaults: **bestMargin = −2.011** — the best arbitrage`);
L.push(`anywhere on the map is 2.0 gold/unit *underwater*, so merchants never move. Every`);
L.push(`question below is really the same question: **can anything drag that above zero?**`);

// =====================================================================  E1
const e1 = rows.filter(r => r.exp === 'e1');
if (e1.length) {
  L.push('\n---\n\n## Q1. Do roads between cities activate merchants?\n');
  L.push(`${e1.length} games. Axes: topology (none/tree/full) × roadMult × tau × K0.`);
  L.push(`\nA finished road costs \`base × roadMult\`, so it cuts transit by \`(1−roadMult)\`.`);
  L.push(`Arithmetic says a road flips a pair only where \`margin_new = margin_old + T·(1−roadMult) > 0\`;`);
  L.push(`at defaults (margin −2.011, roadMult 0.3) that needs a pair with transit **T > 2.87**.`);

  L.push(table('By road topology (all K0/roadMult/tau pooled)', by(e1, TOPO),
    [['topology', k => k], ['n', (k, s) => s.n], ['merchants active', (k, s) => `${(100 * s.activeFrac).toFixed(1)}%`],
     ['median merchVol', (k, s) => f(s.merchVol, 2)], ['best margin (med)', (k, s) => f(s.bestMargin, 3)],
     ['best margin (max)', (k, s) => f(s.bestMarginMax, 3)], ['road segs', (k, s) => f(s.roads, 0)],
     ['N', (k, s) => f(s.N, 0)], ['price spread', (k, s) => f(s.pSpread, 1) + '×']],
    ['none', 'tree', 'full']));

  L.push(table('By K0 × topology (transport cost is the real gate)', by(e1, r => `${r.axes.K0}|${TOPO(r)}`),
    [['K0 | topo', k => k.replace('|', ' | ')], ['n', (k, s) => s.n], ['active', (k, s) => `${(100 * s.activeFrac).toFixed(0)}%`],
     ['merchVol', (k, s) => f(s.merchVol, 2)], ['bestMargin', (k, s) => f(s.bestMargin, 3)],
     ['roads', (k, s) => f(s.roads, 0)], ['pSpread', (k, s) => f(s.pSpread, 1) + '×']]));

  L.push(table('By roadMult (does a CHEAPER road help?) — topology=full only', by(e1.filter(r => TOPO(r) === 'full'), r => r.axes.roadMult),
    [['roadMult', k => k], ['n', (k, s) => s.n], ['active', (k, s) => `${(100 * s.activeFrac).toFixed(0)}%`],
     ['merchVol', (k, s) => f(s.merchVol, 2)], ['bestMargin', (k, s) => f(s.bestMargin, 3)], ['roads', (k, s) => f(s.roads, 0)]]));

  L.push(table('By tau (roads need crews; tau=0 must build nothing) — topology=full only', by(e1.filter(r => TOPO(r) === 'full'), r => r.axes.tau),
    [['tau', k => k], ['n', (k, s) => s.n], ['road segs', (k, s) => f(s.roads, 0)],
     ['active', (k, s) => `${(100 * s.activeFrac).toFixed(0)}%`], ['merchVol', (k, s) => f(s.merchVol, 2)],
     ['bestMargin', (k, s) => f(s.bestMargin, 3)], ['N', (k, s) => f(s.N, 0)]]));
}

// =====================================================================  E2
const e2 = rows.filter(r => r.exp === 'e2');
if (e2.length) {
  L.push('\n---\n\n## Q2. Do larger granaries stabilise prices, or widen the swings?\n');
  L.push(`${e2.length} games. Axes: storageDays × storageRate × storageFill × K0.`);
  L.push(`\nTwo *different* stabilities, deliberately measured apart:`);
  L.push(`**pMedRipple** = how much the median price moves over TIME (temporal — the thing`);
  L.push(`"stabilise" usually means); **pSpread** = max/min across cities at one INSTANT`);
  L.push(`(spatial dispersion — the thing a merchant arbitrages). A granary could easily`);
  L.push(`improve one and wreck the other.`);

  L.push(table('By granary size (storageDays) — all rates/fills/K0 pooled', by(e2, r => r.axes.storageDays),
    [['storageDays', k => k === '0' ? '0 (off)' : k], ['n', (k, s) => s.n],
     ['price ripple (time)', (k, s) => f(s.pMedRipple, 4)], ['price spread (space)', (k, s) => f(s.pSpread, 1) + '×'],
     ['N ripple', (k, s) => f(s.NRipple, 4)], ['median price', (k, s) => f(s.pMed, 3)],
     ['glut', (k, s) => f(s.glut, 0)], ['shortfall', (k, s) => f(s.short, 0)],
     ['stock', (k, s) => f(s.stock, 0)], ['N', (k, s) => f(s.N, 0)]]));

  L.push(table('By storageRate — how fast the granary may trade', by(e2.filter(r => r.axes.storageDays > 0), r => r.axes.storageRate),
    [['storageRate', k => k], ['n', (k, s) => s.n], ['price ripple', (k, s) => f(s.pMedRipple, 4)],
     ['N ripple', (k, s) => f(s.NRipple, 4)], ['glut', (k, s) => f(s.glut, 0)], ['shortfall', (k, s) => f(s.short, 0)],
     ['median price', (k, s) => f(s.pMed, 3)], ['N', (k, s) => f(s.N, 0)]]));

  L.push(table('By storageFill — restock motive weight (0 = pure price-timer)', by(e2.filter(r => r.axes.storageDays > 0), r => r.axes.storageFill),
    [['storageFill', k => k], ['n', (k, s) => s.n], ['stock', (k, s) => f(s.stock, 0)],
     ['price ripple', (k, s) => f(s.pMedRipple, 4)], ['glut', (k, s) => f(s.glut, 0)],
     ['shortfall', (k, s) => f(s.short, 0)], ['median price', (k, s) => f(s.pMed, 3)]]));

  L.push(table('Size × rate interaction (the floor: rate < 1/days cannot cover a day)', by(e2.filter(r => r.axes.storageDays > 0), r => `${r.axes.storageDays}d|${r.axes.storageRate}`),
    [['days | rate', k => k.replace('|', ' | ')], ['n', (k, s) => s.n], ['price ripple', (k, s) => f(s.pMedRipple, 4)],
     ['glut', (k, s) => f(s.glut, 0)], ['short', (k, s) => f(s.short, 0)], ['stock', (k, s) => f(s.stock, 0)]]));
}

// =====================================================================  E3
const e3 = rows.filter(r => r.exp === 'e3');
if (e3.length) {
  L.push('\n---\n\n## Q3. Can dessert prices coax merchants into activity?\n');
  L.push(`${e3.length} games (incl. desserts-off controls). Axes: dessertX × premium × D × K0.`);
  L.push(`\nThe mechanism under test is INDIRECT — merchants cart grain, never desserts. A dessert`);
  L.push(`tile ships no grain, so desserts should pull supply off a city's food market, raise its`);
  L.push(`P, and widen the gaps merchants live on. Whether that beats transit is the question.`);

  const ctl = e3.filter(r => r.axes.control), des = e3.filter(r => !r.axes.control);
  if (ctl.length) {
    const cs = summarize(ctl);
    L.push(`\n**Control (desserts OFF, ${ctl.length} games):** bestMargin ${f(cs.bestMargin, 3)}, ` +
      `merchants active ${(100 * cs.activeFrac).toFixed(0)}%, price spread ${f(cs.pSpread, 1)}×, N ${f(cs.N, 0)}.`);
  }
  L.push(table('By dessertX (food per dessert)', by(des, r => r.axes.dessertX),
    [['dessertX', k => k], ['n', (k, s) => s.n], ['active', (k, s) => `${(100 * s.activeFrac).toFixed(0)}%`],
     ['merchVol', (k, s) => f(s.merchVol, 2)], ['bestMargin', (k, s) => f(s.bestMargin, 3)],
     ['bestMargin max', (k, s) => f(s.bestMarginMax, 3)], ['pSpread', (k, s) => f(s.pSpread, 1) + '×'],
     ['median price', (k, s) => f(s.pMed, 3)], ['N', (k, s) => f(s.N, 0)]]));
  L.push(table('By dessertPremium (m) — price = m·X·P; MUST be <1', by(des, r => r.axes.dessertPremium),
    [['premium', k => k], ['n', (k, s) => s.n], ['active', (k, s) => `${(100 * s.activeFrac).toFixed(0)}%`],
     ['merchVol', (k, s) => f(s.merchVol, 2)], ['bestMargin', (k, s) => f(s.bestMargin, 3)],
     ['pSpread', (k, s) => f(s.pSpread, 1) + '×'], ['median price', (k, s) => f(s.pMed, 3)],
     ['N', (k, s) => f(s.N, 0)], ['farmed', (k, s) => f(med(by(des, r => r.axes.dessertPremium)[k].map(r => r.farmed)), 0)]]));
  L.push(table('By displacement D (grain freed per dessert; D=X is food-neutral)', by(des, r => r.axes.dessertDisplace),
    [['D', k => k], ['n', (k, s) => s.n], ['active', (k, s) => `${(100 * s.activeFrac).toFixed(0)}%`],
     ['bestMargin', (k, s) => f(s.bestMargin, 3)], ['median price', (k, s) => f(s.pMed, 3)],
     ['pSpread', (k, s) => f(s.pSpread, 1) + '×'], ['N', (k, s) => f(s.N, 0)], ['glut', (k, s) => f(s.glut, 0)]]));
  L.push(table('The reach product m·X (spec says keep ~1.5–2.5)', by(des, r => (r.axes.dessertPremium * r.axes.dessertX).toFixed(1)),
    [['m·X', k => k], ['n', (k, s) => s.n], ['active', (k, s) => `${(100 * s.activeFrac).toFixed(0)}%`],
     ['bestMargin', (k, s) => f(s.bestMargin, 3)], ['median price', (k, s) => f(s.pMed, 3)],
     ['N', (k, s) => f(s.N, 0)], ['farmed', (k, s) => f(s.N > 0 ? med(by(des, r => (r.axes.dessertPremium * r.axes.dessertX).toFixed(1))[k].map(r => r.farmed)) : NaN, 0)]]));
}

// ===================================================================== global
L.push('\n---\n\n## Cross-cutting: what ever activated a merchant?\n');
const act = rows.filter(ACTIVE);
L.push(`**${act.length} of ${rows.length} games (${(100 * act.length / rows.length).toFixed(1)}%)** had merchants moving grain at rest.`);
if (act.length) {
  const g = by(act, r => `${r.exp} K0=${r.axes.K0}`);
  L.push(table('Where trade lives', g,
    [['bucket', k => k], ['n', (k, s) => s.n], ['merchVol', (k, s) => f(s.merchVol, 2)],
     ['bestMargin', (k, s) => f(s.bestMargin, 3)], ['pSpread', (k, s) => f(s.pSpread, 1) + '×'], ['N', (k, s) => f(s.N, 0)]]));
  const top = rows.slice().sort((a, b) => b.merchVol - a.merchVol).slice(0, 12);
  L.push('\n### The 12 highest-trade configs found\n');
  L.push('| exp | K0 | axes | merchVol | routes | bestMargin | pSpread | N |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const r of top) {
    const ax = Object.entries(r.axes).filter(([k]) => k !== 'K0').map(([k, v]) => `${k}=${v}`).join(' ');
    L.push(`| ${r.exp} | ${r.axes.K0} | ${ax}${r.exp === 'e1' ? ' roads=' + TOPO(r) : ''} | ${f(r.merchVol, 1)} | ${f(r.merchRoutes, 1)} | ${f(r.bestMargin, 3)} | ${f(r.pSpread, 1)}× | ${f(r.N, 0)} |`);
  }
}
const maxCons = Math.max(...rows.map(r => r.consMax));
L.push(`\n**Conservation across all ${rows.length} games: worst relative error ${maxCons.toExponential(2)}.**`);

const outFile = file.replace(/\.jsonl$/, '.analysis.md');
fs.writeFileSync(outFile, L.join('\n') + '\n');
console.log(L.join('\n'));
console.error(`\n\nwrote ${outFile}`);
