// narrative.js — E4: follow ONE emergent city at stock defaults, birth to equilibrium.
//
// Not a sweep. The sweeps answer "which knob moves what"; this answers "what actually
// HAPPENS to a town", which is the only way to see mechanisms that are invisible in
// aggregate — a price that spikes for four ticks, a granary that fills at the wrong
// moment, a basin that stalls one ring short of the good land.
//
// "Emergent" = ignited by the engine's own new-core rule (updateUrbanization), NOT one of
// the seeded starting cities. Seeded cities carry h.seed = true; emergent ones do not.
// The subject is chosen by a hash of the map seed, so it is arbitrary but reproducible.
//
//   node experiments.js e4 [--ticks=N]
// Emits: out/narrative.json  (full per-tick trace + site context)
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, 'out');

function run(ticks) {
  ticks = ticks || 400;
  const Econ = require('./econ_engine.js');
  const { loadMap, UI_BASE } = require('./experiments.js');
  const md = loadMap();

  // THE SANDBOX'S ACTUAL DEFAULT START: mode=priority, seedN=5.
  const seeded = md.sites.slice(0, 5);
  const world = Econ.createWorld({ name: md.name, seed: md.seed, graph: md.graph, cities: seeded, config: Object.assign({}, UI_BASE) });
  Econ.step(world);

  // ---- per-tick trace of EVERY city, so we can pick the subject afterwards -----
  const frames = [];
  const birth = {};          // rep -> tick it first appeared
  for (let t = 0; t < ticks; t++) {
    const m = Econ.step(world);
    // basin size + what each city's own hinterland delivered
    const bTiles = {}, bOut = {};
    for (const h of world.hexes) {
      if (h.isCity || !h.passable || h.basin < 0) continue;
      bTiles[h.basin] = (bTiles[h.basin] || 0) + 1;
      bOut[h.basin] = (bOut[h.basin] || 0) + (h.out || 0);
    }
    const imp = {}, exp = {};
    for (const r of (world.trade ? world.trade.routes : [])) {
      imp[r.to] = (imp[r.to] || 0) + (r.shipped || 0);
      exp[r.from] = (exp[r.from] || 0) + (r.shipped || 0);
    }
    const cities = {};
    for (const k of world.cities) {
      if (birth[k] == null) birth[k] = world.tick;
      const cl = world.clusterOf[k];
      // NOTE an emergent city has NO price on its birth tick: updateUrbanization flips the
      // tile at the END of step(), after the solve, and unlike foundCity it never seeds
      // world.prices. The next solve prices it (innerP defaults an unknown city to 1), so
      // this is a one-tick hole in the trace, not a hole in the economy — but it is real
      // and it is why these two are coalesced rather than assumed present.
      cities[k] = {
        N: world.cityN[k] || 0,
        P: world.prices[k] != null ? world.prices[k] : null,
        ema: world.priceEma[k] != null ? world.priceEma[k] : null,
        stock: world.stock[k] || 0, target: Econ.storageTarget(world, k),
        tiles: bTiles[k] || 0, delivered: bOut[k] || 0,
        imported: imp[k] || 0, exported: exp[k] || 0,
        urbanTiles: cl ? cl.tiles.length : 1, A: world.Aof[k],
        seed: !!world.hexes[k].seed,
        bal: world.lastBalance[k] || null
      };
    }
    frames.push({
      t: world.tick, N: m.N, w: m.w, nCities: m.cities,
      glutTotal: m.foodGlut, shortTotal: m.foodShortfall,
      consRel: m.conservationErr / Math.max(1, m.foodProduced),
      cities
    });
  }

  // ---- pick the subject: an EMERGENT city that survived to the end -------------
  const finalReps = world.cities.filter(k => !world.hexes[k].seed);
  if (!finalReps.length) { console.error('no emergent city survived; nothing to narrate'); return; }
  // arbitrary but reproducible
  const pick = finalReps[Math.abs(md.seed | 0) % finalReps.length];

  // ---- site context: WHY here? -------------------------------------------------
  const g = md.graph;
  const nb = Econ.neighborsOf(world, pick);
  const site = {
    tile: pick,
    terrain: g.terrainName[pick],
    capBase: g.capBase[pick],
    fishBonus: g.fishBonus[pick],
    lonlat: [g.coordsDeg ? g.coordsDeg[pick * 2 + 1] : null, g.coordsDeg ? g.coordsDeg[pick * 2] : null],
    neighbours: nb.map(i => ({ i, terrain: g.terrainName[i], cap: g.capBase[i], water: !!g.water[i] })),
    bestCrop: (() => {
      if (!g.cropCap) return null;
      let best = null, mx = -1;
      for (const c of g.landCrops) if (g.cropCap[c][pick] > mx) { mx = g.cropCap[c][pick]; best = c; }
      return { crop: best, cap: mx, all: g.landCrops.map(c => ({ c, cap: +g.cropCap[c][pick].toFixed(1) })) };
    })(),
    birthTick: birth[pick],
    // who was already nearby when it ignited?
    neighboursAtBirth: (() => {
      const f = frames.find(fr => fr.t === birth[pick]);
      if (!f) return [];
      return Object.keys(f.cities).filter(k => +k !== pick).map(k => ({
        rep: +k, physDist: +Econ.physDist(world, pick, +k).toFixed(2),
        transitToThem: world.transport[+k] ? +world.transport[+k][pick].toFixed(3) : null,
        theirP: +f.cities[k].P.toFixed(3), theirN: Math.round(f.cities[k].N)
      })).sort((a, b) => a.physDist - b.physDist).slice(0, 5);
    })()
  };

  // ---- the subject's own timeline ---------------------------------------------
  const life = frames.filter(f => f.cities[pick]).map(f => ({
    t: f.t, ...f.cities[pick], poolN: f.N, wage: f.w
  }));

  const out = { map: md.name, seed: md.seed, ticks, seededCities: seeded,
    emergentSurvivors: finalReps, subject: pick, site, life,
    finalCityCount: world.cities.length,
    // every city's end-state, for context on where the subject sits in the pack
    finalCities: world.cities.map(k => ({
      rep: k, seed: !!world.hexes[k].seed, N: +(world.cityN[k] || 0).toFixed(1),
      P: +world.prices[k].toFixed(3), stock: +(world.stock[k] || 0).toFixed(0),
      tiles: (() => { let n = 0; for (const h of world.hexes) if (!h.isCity && h.basin === k) n++; return n; })()
    })).sort((a, b) => b.N - a.N)
  };
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'narrative.json.tmp'), JSON.stringify(out));
  fs.renameSync(path.join(OUT, 'narrative.json.tmp'), path.join(OUT, 'narrative.json'));

  // ---- console summary ---------------------------------------------------------
  console.log(`subject: emergent city #${pick} (${site.terrain}), born tick ${site.birthTick}`);
  console.log(`  site cap=${site.capBase.toFixed(0)} fish=${site.fishBonus.toFixed(0)} best crop=${site.bestCrop ? site.bestCrop.crop : 'n/a'}`);
  console.log(`  ${finalReps.length} emergent survivors of ${world.cities.length} cities total`);
  console.log(`\n tick |    N |   price |    ema |   stock/target | tiles | deliv | imp | glut`);
  const marks = [];
  for (let i = 0; i < life.length; i++) {
    const L = life[i];
    if (i < 6 || L.t % 25 === 0 || i === life.length - 1) marks.push(L);
  }
  const f2 = (x, d) => (x == null ? '--' : x.toFixed(d));
  for (const L of marks) {
    console.log(`${String(L.t).padStart(5)} |${f2(L.N, 0).padStart(5)} |${f2(L.P, 3).padStart(8)} |${f2(L.ema, 3).padStart(7)} |` +
      `${f2(L.stock, 0).padStart(7)}/${f2(L.target, 0).padEnd(7)}|${String(L.tiles).padStart(6)} |${f2(L.delivered, 0).padStart(6)} |${f2(L.imported, 0).padStart(4)} |${f2(L.glutShare, 0).padStart(6)}`);
  }
  console.log(`\nwrote out/narrative.json (${life.length} frames)`);
  return out;
}
module.exports = { run };
