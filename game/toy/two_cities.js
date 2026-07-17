// two_cities.js — a teaching trace. Follow TWO cities on the planet tick by tick, with a
// plain-English note on every field every tick:
//   SPROUT    — a city that emerges organically where the land is good, and thrives.
//   STRUGGLER — a city force-founded on a barren desert tile (cap ~4% of the median),
//               to show what "marginal" looks like from the inside.
// The point is pedagogy: every number is annotated with what it means and why it moved.
//   node two_cities.js  ->  out/two_cities_trace.md (+ console highlights)
'use strict';
const fs = require('fs');
const path = require('path');
const Econ = require('./econ_engine.js');
const { loadMap, UI_BASE } = require('./experiments.js');

// A true "barren location" is one with a poor BASIN, not just a poor centre tile — a city
// feeds from its neighbours, and its own tile is paved to zero anyway. And "poor" means
// below the VIABILITY CLIFF: the marginal cap Lsub = sqrt(C·kappa/c) - kappa is zero for
// any tile with C <= kappa·c = 200, so sub-200 tundra grows no viable farming however much
// of it there is. Tile 585 is tundra whose radius-2 basin has just ~218 farmers of viable
// capacity (a healthy basin sustains thousands): it survives, but stunted. (Tile 312, whose
// basin is entirely below the cliff, withers to N=1 instead — noted in the analysis.)
const STRUGGLER_TILE = 585;
const TICKS = 300;

const md = loadMap(), g = md.graph;
const world = Econ.createWorld({ name: md.name, seed: md.seed, graph: md.graph,
  cities: md.sites.slice(0, 5), config: Object.assign({}, UI_BASE) });
Econ.step(world);
// force-found the struggler on barren ground (bypasses newCoreGate, which would never let a
// city ignite where there is no local surplus — that is the whole point of "forced").
Econ.foundCity(world, STRUGGLER_TILE);

// ---- record every city, every tick ----------------------------------------
function snapshot(w) {
  const bTiles = {}, bOut = {}, bCap = {};
  for (const h of w.hexes) {
    if (h.isCity || !h.passable || h.basin < 0) continue;
    bTiles[h.basin] = (bTiles[h.basin] || 0) + 1;
    bOut[h.basin] = (bOut[h.basin] || 0) + (h.out || 0);
    bCap[h.basin] = (bCap[h.basin] || 0) + Econ.foodCapOf(h);
  }
  const imp = {};
  for (const r of (w.trade ? w.trade.routes : [])) imp[r.to] = (imp[r.to] || 0) + (r.shipped || 0);
  const yOf = {};
  for (const row of (w.metrics.cityRows || [])) yOf[row.city] = row.Y;
  const rec = { t: w.tick, w: w.metrics.w, cities: {} };
  for (const k of w.cities) {
    const cl = w.clusterOf[k];
    // a coastal city tile FISHES — food it produces for its own mouths, not counted in the
    // basin's farm delivery. Missing it makes a thriving fishing city look chronically SHORT.
    let selfFood = 0;
    if (cl) for (const ti of cl.tiles) selfFood += (w.hexes[ti].foodProd || 0);
    rec.cities[k] = {
      N: w.cityN[k] || 0, P: w.prices[k], ema: w.priceEma[k],
      stock: w.stock[k] || 0, target: Econ.storageTarget(w, k),
      tiles: bTiles[k] || 0, delivered: bOut[k] || 0, basinCap: bCap[k] || 0, selfFood: selfFood,
      imported: imp[k] || 0, urbanTiles: cl ? cl.tiles.length : 1, Y: yOf[k] || 0,
      seed: !!w.hexes[k].seed
    };
  }
  return rec;
}
const frames = [], birth = {};
for (let t = 0; t < TICKS; t++) {
  Econ.step(world);
  const s = snapshot(world);
  for (const k in s.cities) if (birth[k] == null) birth[k] = s.t;
  frames.push(s);
}

// ---- choose the two subjects ----------------------------------------------
// SPROUT: the emergent (non-seed, non-forced) city with the highest final N.
const finalReps = world.cities.filter(k => !world.hexes[k].seed && k !== STRUGGLER_TILE);
let sprout = finalReps[0], best = -1;
for (const k of finalReps) if ((world.cityN[k] || 0) > best) { best = world.cityN[k] || 0; sprout = k; }
const struggler = STRUGGLER_TILE;

// ---- annotation: turn one city's (prev, cur) into explained lines ----------
const pct = (a, b) => b > 0 ? (100 * a / b).toFixed(0) + '%' : '--';
const arrow = d => d > 1e-6 ? '▲' : d < -1e-6 ? '▼' : '·';
function note(k, cur, prev, w) {
  const L = [];
  const d = (f) => cur[f] - (prev ? prev[f] : 0);
  const mouths = cur.N;                       // c=1, so food demand = N
  const inflow = cur.delivered + cur.imported + (cur.selfFood || 0);   // basin + merchants + own fishing
  const netFood = inflow - mouths;            // + surplus into granary, - dipped into it / went short

  // N
  let nNote;
  if (!prev) nNote = `BORN. ${cur.N.toFixed(0)} workers ${cur.seed ? 'placed here' : 'migrated in on the first tick'}.`;
  else if (d('N') > 0.5) nNote = `${arrow(d('N'))}+${d('N').toFixed(0)} workers migrated in — the labour pool flowing to a viable wage. (Malthus caps *births* at r=10%/tick, but migration is uncapped, so a young city fills fast.)`;
  else if (d('N') < -0.5) nNote = `${arrow(d('N'))}${d('N').toFixed(0)} workers left — the wage here fell below what they can get elsewhere.`;
  else nNote = `steady at ${cur.N.toFixed(0)} — arrivals and departures balance.`;
  L.push(`    N (population)   = ${cur.N.toFixed(0).padStart(6)}   ${nNote}`);

  // price
  let pNote;
  if (cur.P == null) pNote = `no price yet — it is priced by the next solve (a one-tick birth gap).`;
  else if (!prev || prev.P == null) pNote = `first price ${cur.P.toFixed(2)}.`;
  else if (d('P') > 0.02) pNote = `${arrow(d('P'))}+${d('P').toFixed(2)} — demand outran local supply, so the market bid the price up.`;
  else if (d('P') < -0.02) pNote = `${arrow(d('P'))}${d('P').toFixed(2)} — more grain reached market (a bigger basin, or the granary stopped buying).`;
  else pNote = `flat at ${cur.P.toFixed(2)} — supply and demand are balanced (the price has cleared).`;
  L.push(`    P (food price)   = ${(cur.P == null ? '--' : cur.P.toFixed(2)).padStart(6)}   ${pNote}`);
  // WHY the price sits where it does — the deep cause, not just the tick's move.
  if (cur.P != null && cur.P > 3 && cur.N > 0.5) L.push(`      ↳ this price is HIGH because the basin's best land is marginal: poor land has a high marginal cost of food, and a high P prices city workers out (city size ∝ P^-2.857), which is why this city stays small.`);
  else if (cur.P != null && cur.P < 2.4 && cur.N > 100) L.push(`      ↳ this price is LOW because the basin has productive land with plenty of surplus, so food is cheap and the city can grow large.`);

  // basin / land
  let tNote;
  if (!prev || d('tiles') > 0.5) tNote = `${arrow(d('tiles'))}${d('tiles') > 0 ? '+' + d('tiles').toFixed(0) : ''} farm tiles now ship here (the adjacency clamp lets a basin grow ONE ring of neighbours per tick — it cannot teleport across the map).`;
  else if (d('tiles') < -0.5) tNote = `${arrow(d('tiles'))}${d('tiles').toFixed(0)} tiles — lost ground to a neighbouring city's basin.`;
  else tNote = `${cur.tiles} tiles, steady — its hinterland has stopped growing.`;
  // raw capacity OVERSTATES deliverable food on poor land: the marginal cap Lsub =
  // sqrt(C·kappa/c)-kappa is ZERO for any tile with C <= kappa·c = 200, so sub-200 tundra
  // grows nothing viable however large the basin. Flag it when raw wildly exceeds delivery.
  let capNote = `raw capacity ${cur.basinCap.toFixed(0)}`;
  if (cur.delivered > 0 && cur.basinCap > 20 * cur.delivered) capNote += ` — but only ${cur.delivered.toFixed(0)} is deliverable: most of this basin is POOR land below the viability cliff (C≤200 grows no viable farming), so raw capacity is a mirage here`;
  L.push(`    basin (tiles)    = ${cur.tiles.toString().padStart(6)}   ${tNote}  (${capNote}.)`);

  // delivered vs need — the HONEST feeding verdict, from actual delivery not raw capacity
  let feedNote;
  if (mouths < 0.5) feedNote = `no mouths yet.`;
  else if (inflow >= mouths - 0.5) feedNote = `feeds itself: ${inflow.toFixed(0)} in (${cur.delivered.toFixed(0)} farm${cur.selfFood > 1 ? ' + ' + cur.selfFood.toFixed(0) + ' fish' : ''}${cur.imported > 1 ? ' + ' + cur.imported.toFixed(0) + ' imported' : ''}) vs ${mouths.toFixed(0)} eaten, surplus ${(inflow - mouths).toFixed(0)} banked.`;
  else feedNote = `SHORT: only ${inflow.toFixed(0)} in for ${mouths.toFixed(0)} mouths — the gap is covered from the granary, or goes unfed.`;
  L.push(`    delivered (food) = ${cur.delivered.toFixed(0).padStart(6)}   grain from its own farms${cur.selfFood > 1 ? ' (+' + cur.selfFood.toFixed(0) + ' fish from its own coast)' : ''}. ${feedNote}`);

  // granary
  let gNote;
  const fill = cur.target > 0 ? cur.stock / cur.target : 0;
  if (cur.target <= 0) gNote = `no granary (needs population first).`;
  else if (fill >= 0.99) gNote = `FULL (${pct(cur.stock, cur.target)}). It has stopped buying, so it no longer props the price up — the price you see now is the city's TRUE clearing price.`;
  else if (prev && cur.stock > prev.stock + 1e-6) gNote = `filling (${pct(cur.stock, cur.target)}). While it fills it is an EXTRA BUYER competing with the crowd, holding the price a few % above its eventual level.`;
  else if (prev && cur.stock < prev.stock - 1e-6) gNote = `DRAINING (${pct(cur.stock, cur.target)}) — deliveries fell short and the city is eating its reserve instead of going hungry. This is the granary earning its keep.`;
  else gNote = `holding at ${pct(cur.stock, cur.target)}.`;
  L.push(`    granary (stock)  = ${cur.stock.toFixed(0).padStart(6)}   ${gNote}`);

  // food balance / hunger
  if (netFood < -0.5 && cur.stock < 1) L.push(`    ⚠ HUNGER          = ${(-netFood).toFixed(0).padStart(6)}   mouths went unfed: inflow ${inflow.toFixed(0)} < need ${mouths.toFixed(0)}, and the granary is empty.`);

  // paving event (urbanTiles up)
  if (prev && cur.urbanTiles > prev.urbanTiles) L.push(`    ✦ PAVED a tile   — the city grew onto a farm tile. That tile's harvest is gone for good (paving is permanent); expect a small price jolt next tick as ~${(100 / Math.max(1, cur.tiles)).toFixed(0)}% of the basin drops out.`);

  // wealth
  if (cur.Y > 0) L.push(`    Y (gold output)  = ${cur.Y.toExponential(2).padStart(9)}  the city's wealth this tick (A·N^α — rises fast with size).`);
  return L;
}

// ---- render ----------------------------------------------------------------
const out = [];
function header(title, rep, kind) {
  out.push(`\n\n# ${title}\n`);
  out.push(`Tile ${rep}, terrain **${g.terrainName[rep]}**, farm capacity **${g.capBase[rep].toFixed(0)}** (median land is 520), fish bonus ${g.fishBonus[rep].toFixed(0)}.`);
  out.push(`Born tick **${birth[rep]}**. ${kind}\n`);
}
function renderCity(rep, title, kind) {
  header(title, rep, kind);
  const life = frames.filter(f => f.cities[rep]).map(f => ({ t: f.t, w: f.w, ...f.cities[rep] }));
  let prev = null, lastShown = -99;
  for (let i = 0; i < life.length; i++) {
    const cur = life[i];
    const age = cur.t - birth[rep];
    // show every tick for the first 22 (the formative period), then milestones
    const milestone = age <= 22 || cur.t % 25 === 0 || i === life.length - 1;
    if (!milestone) { prev = cur; continue; }
    out.push(`\n**tick ${cur.t}** (age ${age}, global wage w=${(cur.w || 0).toFixed(3)})`);
    for (const line of note(rep, cur, prev, world)) out.push(line);
    prev = cur; lastShown = cur.t;
  }
  // one-line life summary
  const last = life[life.length - 1];
  out.push(`\n**Life summary:** born tick ${birth[rep]}, ended N=${last.N.toFixed(0)}, P=${last.P == null ? '--' : last.P.toFixed(2)}, ` +
    `basin ${last.tiles} tiles (could grow ${last.basinCap.toFixed(0)} food, needed ${last.N.toFixed(0)}), ` +
    `granary ${pct(last.stock, last.target)} full.`);
  return { rep, life };
}

out.push(`# Two cities, tick by tick\n\nOne organic sprout, one forced onto barren desert. Planet map, ${TICKS} ticks, stock defaults.`);
const S = renderCity(sprout, `SPROUT — city #${sprout} (emerged where the land is good)`,
  `This city was not placed by anyone — the engine ignited it because the local land had a genuine food surplus (newCoreGate:'surplus'). Watch it thrive.`);
const T = renderCity(struggler, `STRUGGLER — city #${struggler} (force-founded on marginal ${g.terrainName[struggler]})`,
  `This city was FORCED onto marginal ground that would never sprout on its own — its basin sits mostly below the viability cliff. Watch what "stunted" looks like from the inside: it survives, but it never grows.`);

// ---- side-by-side epilogue --------------------------------------------------
function endState(rep) { const l = frames.filter(f => f.cities[rep]); return l[l.length - 1].cities ? l[l.length - 1] : null; }
const sF = frames[frames.length - 1].cities[sprout], tF = frames[frames.length - 1].cities[struggler];
out.push(`\n\n# Side by side, at tick ${TICKS}\n`);
out.push('| | SPROUT #' + sprout + ' | STRUGGLER #' + struggler + ' |');
out.push('|---|---|---|');
out.push(`| farm capacity (tile) | ${g.capBase[sprout].toFixed(0)} | ${g.capBase[struggler].toFixed(0)} |`);
out.push(`| population N | ${sF.N.toFixed(0)} | ${tF.N.toFixed(0)} |`);
out.push(`| food price P | ${sF.P == null ? '--' : sF.P.toFixed(2)} | ${tF.P == null ? '--' : tF.P.toFixed(2)} |`);
out.push(`| basin tiles | ${sF.tiles} | ${tF.tiles} |`);
out.push(`| basin food capacity | ${sF.basinCap.toFixed(0)} | ${tF.basinCap.toFixed(0)} |`);
out.push(`| granary fill | ${pct(sF.stock, sF.target)} | ${pct(tF.stock, tF.target)} |`);
out.push(`| gold output Y | ${sF.Y.toExponential(2)} | ${tF.Y.toExponential(2)} |`);

const outFile = path.join(__dirname, 'out', 'two_cities_trace.md');
fs.writeFileSync(outFile, out.join('\n') + '\n');
console.log(`SPROUT=#${sprout} (${g.terrainName[sprout]}, cap ${g.capBase[sprout].toFixed(0)}), born t${birth[sprout]}, final N=${sF.N.toFixed(0)} P=${sF.P.toFixed(2)}`);
console.log(`STRUGGLER=#${struggler} (${g.terrainName[struggler]}, cap ${g.capBase[struggler].toFixed(0)}), born t${birth[struggler]}, final N=${tF.N.toFixed(0)} P=${tF.P == null ? '--' : tF.P.toFixed(2)}`);
console.log(`\nwrote ${outFile} (${out.length} lines)`);
