// analyze.js — turn a sweep's JSONL into a balance verdict an LLM (or you) can
// act on. For every rule-set (swept param point) it asks the core question:
//
//   * BROKEN     — the economy breaks (collapse / runaway / never settles / food
//                  not conserved) for too many strategies. Avoid this region.
//   * DOMINANT   — one strategy wins BOTH population and wealth across the maps.
//                  There's a single optimal play -> abstract the choice away.
//   * DIVERGENT  — population and wealth are won by DIFFERENT strategies (the
//                  wide-vs-tall fork). Genuine, keep-able strategic choice. GOLD.
//   * FLAT       — strategies barely differ; the choice doesn't matter.
//   * MIXED      — a bit of everything across the maps.
//
//   node analyze.js [out/sweep.jsonl]
// Writes out/<name>.analysis.json (structured) and out/<name>.analysis.md (brief).
'use strict';
var fs = require('fs'), path = require('path');

// ---- tunables -------------------------------------------------------------
var CLOSE = 0.05;        // within 5% => a "tie" (multiple viable) on an objective
var DOMINANT_MARGIN = 0.08; // winner must beat runner-up by >8% to be "clear"
var BROKEN_FRAC = 0.34;  // >=34% of a rule-set's games broken => BROKEN
var DIVERGE_FRAC = 0.50; // >=50% of maps show a pop/wealth split => DIVERGENT

function main() {
  var inPath = process.argv[2] || path.join(__dirname, 'out', 'sweep.jsonl');
  if (!fs.existsSync(inPath)) { console.error('No such file: ' + inPath); process.exit(1); }
  var rows = fs.readFileSync(inPath, 'utf8').trim().split('\n').filter(Boolean).map(function (l) { return JSON.parse(l); });

  // group by rule-set (combo) then map
  var sets = {};
  rows.forEach(function (r) {
    var key = comboKey(r.combo);
    if (!sets[key]) sets[key] = { combo: r.combo, key: key, maps: {} };
    var byMap = sets[key].maps;
    if (!byMap[r.map]) byMap[r.map] = {};
    byMap[r.map][r.strategy] = { pop: r.objectives.population, wealth: r.objectives.wealth,
      fiscal: r.objectives.fiscal, broken: r.health.broken, health: r.health, final: r.final };
  });

  var analyses = Object.keys(sets).map(function (key) { return analyzeSet(sets[key]); });

  // rank: divergent first (by divergence strength), then interesting others
  var order = { DIVERGENT: 0, MIXED: 1, DOMINANT: 2, FLAT: 3, BROKEN: 4 };
  analyses.sort(function (a, b) {
    if (order[a.klass] !== order[b.klass]) return order[a.klass] - order[b.klass];
    return b.divergenceFrac - a.divergenceFrac;
  });

  var summary = {
    source: path.basename(inPath), games: rows.length, ruleSets: analyses.length,
    counts: tally(analyses.map(function (a) { return a.klass; })),
    paramBreaks: paramBreakReport(rows),   // strategy-count-agnostic: per-axis break-finding
    leverage: null,                        // filled below (derives from paramBreaks)
    axisTrends: axisTrends(analyses),
    ruleSetsRanked: analyses
  };
  summary.leverage = leverageReport(summary.paramBreaks);
  var base = inPath.replace(/\.jsonl$/, '');
  fs.writeFileSync(base + '.analysis.json', JSON.stringify(summary, null, 2));
  fs.writeFileSync(base + '.analysis.md', renderMarkdown(summary));

  console.log('Analyzed ' + rows.length + ' games across ' + analyses.length + ' rule-sets.');
  console.log('Classification: ' + JSON.stringify(summary.counts));
  console.log('Wrote ' + path.relative(process.cwd(), base + '.analysis.json') + ' and .analysis.md');

  // headline: parameter break-finding (the current focus)
  var breakers = [];
  for (var k in summary.paramBreaks) summary.paramBreaks[k].forEach(function (r) {
    if (r.brokenFrac >= 0.5) breakers.push({ k: k, r: r });
  });
  breakers.sort(function (a, b) { return b.r.brokenFrac - a.r.brokenFrac; });
  if (breakers.length) {
    console.log('\nParameter values that break the game (>=50% of games):');
    breakers.slice(0, 10).forEach(function (b) {
      console.log('  ' + b.k + '=' + b.r.value + '  -> ' + pct(b.r.brokenFrac) + ' broken (' + (dominantBreakMode(b.r) || 'mixed') + ')');
    });
  } else {
    console.log('\nNo single axis value breaks >=50% of its games; see the .md param-break tables for finer effects.');
  }

  // secondary headline: strategy forks (only meaningful when >=2 strategies swept)
  var div = analyses.filter(function (a) { return a.klass === 'DIVERGENT'; });
  if (div.length) {
    console.log('\nMost promising (population-vs-wealth forks):');
    div.slice(0, 6).forEach(function (a) {
      console.log('  ' + a.key + '  -> ' + a.forkSummary);
    });
  }
}

function analyzeSet(set) {
  var mapNames = Object.keys(set.maps);
  var perMap = [], divergentMaps = 0, brokenGames = 0, totalGames = 0;
  var popWinners = {}, wealthWinners = {}, closePop = 0, closeWealth = 0, dominantMaps = 0;
  var forkPairs = {};   // "popWinner|wealthWinner" -> count, only on maps that split
  mapNames.forEach(function (mn) {
    var byStrat = set.maps[mn];
    var strats = Object.keys(byStrat);
    totalGames += strats.length;
    var live = strats.filter(function (s) { return !byStrat[s].broken; });
    strats.forEach(function (s) { if (byStrat[s].broken) brokenGames++; });
    if (live.length < 2) { perMap.push({ map: mn, allBroken: live.length === 0 }); return; }
    var popRank = live.slice().sort(function (a, b) { return byStrat[b].pop - byStrat[a].pop; });
    var wRank = live.slice().sort(function (a, b) { return byStrat[b].wealth - byStrat[a].wealth; });
    var popW = popRank[0], wealthW = wRank[0];
    var popMargin = rel(byStrat[popRank[0]].pop, byStrat[popRank[1]].pop);
    var wealthMargin = rel(byStrat[wRank[0]].wealth, byStrat[wRank[1]].wealth);
    var divergent = popW !== wealthW;
    if (divergent) { divergentMaps++; var fk = popW + '|' + wealthW; forkPairs[fk] = (forkPairs[fk] || 0) + 1; }
    if (popMargin < CLOSE) closePop++;
    if (wealthMargin < CLOSE) closeWealth++;
    if (!divergent && popMargin > DOMINANT_MARGIN && wealthMargin > DOMINANT_MARGIN) dominantMaps++;
    popWinners[popW] = (popWinners[popW] || 0) + 1;
    wealthWinners[wealthW] = (wealthWinners[wealthW] || 0) + 1;
    perMap.push({ map: mn, popWinner: popW, wealthWinner: wealthW,
      popMargin: round(popMargin), wealthMargin: round(wealthMargin), divergent: divergent });
  });

  var nMaps = mapNames.length;
  var divergenceFrac = nMaps ? divergentMaps / nMaps : 0;
  var brokenFrac = totalGames ? brokenGames / totalGames : 0;
  var dominanceFrac = nMaps ? dominantMaps / nMaps : 0;
  var closePopFrac = nMaps ? closePop / nMaps : 0, closeWealthFrac = nMaps ? closeWealth / nMaps : 0;

  var klass;
  if (brokenFrac >= BROKEN_FRAC) klass = 'BROKEN';
  else if (divergenceFrac >= DIVERGE_FRAC) klass = 'DIVERGENT';
  else if (dominanceFrac >= DIVERGE_FRAC) klass = 'DOMINANT';
  else if (closePopFrac >= DIVERGE_FRAC && closeWealthFrac >= DIVERGE_FRAC) klass = 'FLAT';
  else klass = 'MIXED';

  // name the fork
  var popStar = modeKey(popWinners), wealthStar = modeKey(wealthWinners);
  var forkSummary;
  if (klass === 'DIVERGENT') {
    var fk = modeKey(forkPairs);                 // the most common actual split
    var parts = (fk || (popStar + '|' + wealthStar)).split('|');
    forkSummary = parts[0] + ' wins population, ' + parts[1] + ' wins wealth';
  } else if (klass === 'DOMINANT') {
    forkSummary = popStar + ' dominates both objectives';
  } else {
    forkSummary = popStar + '/' + wealthStar;
  }

  return {
    key: set.key, combo: set.combo, klass: klass,
    divergenceFrac: round(divergenceFrac), brokenFrac: round(brokenFrac),
    dominanceFrac: round(dominanceFrac), closePopFrac: round(closePopFrac), closeWealthFrac: round(closeWealthFrac),
    popStar: popStar, wealthStar: wealthStar, forkSummary: forkSummary,
    popWinners: popWinners, wealthWinners: wealthWinners, perMap: perMap
  };
}

// ---- parameter break-finding (strategy-count-agnostic) --------------------
// For each axis value, aggregate break-mode rates + descriptive medians over ALL
// games holding that value (a marginal effect, averaged across the other axes).
// Works with any strategy count (unlike analyzeSet, which needs >=2 live strategies
// to compare). Directly answers: which knob values are too cheap / too expensive /
// break the game when pushed too high?
function paramBreakReport(rows) {
  var axes = {};
  rows.forEach(function (r) {
    var combo = r.combo || {};
    for (var k in combo) {
      var v = combo[k], bkey = String(v);
      axes[k] = axes[k] || {};
      var a = axes[k][bkey] = axes[k][bkey] ||
        { value: v, n: 0, broken: 0, collapsed: 0, runaway: 0, oscillation: 0, conservationFail: 0,
          churn: 0, N: [], cities: [], roads: [], price: [], Y: [], funded: [],
          // SHAPE is collected over HEALTHY runs only -- a collapsed game has 0 cities and
          // 0 farmed tiles, which would drag a median toward "compact" for the worst reason.
          hCities: [], hFarmed: [], hOutside: [], hOutsideFrac: [] };
      a.n++;
      var h = r.health || {}, f = r.final || {};
      if (h.broken) a.broken++;
      if (h.collapsed) a.collapsed++;
      if (h.runaway) a.runaway++;
      if (h.oscillation) a.oscillation++;
      if (h.structuralChurn) a.churn++;
      if (h.conservationOK === false) a.conservationFail++;
      a.N.push(f.N); a.cities.push(f.cities); a.roads.push(f.roads);
      a.price.push(f.avgPrice); a.Y.push(f.Ytotal); a.funded.push(f.fundedFrac);
      if (!h.broken) {
        a.hCities.push(f.cities); a.hFarmed.push(f.farmedTiles);
        a.hOutside.push(f.farmedOutsideBasin); a.hOutsideFrac.push(f.outsideBasinFrac);
      }
    }
  });
  var out = {};
  for (var k in axes) {
    out[k] = Object.keys(axes[k]).sort(function (x, y) { return axes[k][x].value - axes[k][y].value; })
      .map(function (bkey) {
        var a = axes[k][bkey];
        var rec = {
          value: a.value, n: a.n,
          brokenFrac: round(a.broken / a.n), collapsedFrac: round(a.collapsed / a.n),
          runawayFrac: round(a.runaway / a.n), oscillationFrac: round(a.oscillation / a.n),
          conservationFailFrac: round(a.conservationFail / a.n),
          churnFrac: round(a.churn / a.n),
          medianN: round1(median(a.N)), medianCities: round1(median(a.cities)),
          medianRoads: round1(median(a.roads)), medianPrice: round(median(a.price)),
          medianY: round1(median(a.Y)), medianFunded: round(median(a.funded)),
          // healthy-only settlement shape
          nHealthy: a.hCities.length,
          medCitiesOK: round1(median(a.hCities)), medFarmedOK: round1(median(a.hFarmed)),
          medOutsideOK: round1(median(a.hOutside)), medOutsideFracOK: round(median(a.hOutsideFrac))
        };
        rec.flags = degeneracyFlags(rec);
        return rec;
      });
  }
  return out;
}

// ---------------------------------------------------------------------------
// LEVERAGE — which knobs swing the settlement shape WITHOUT breaking the game?
// A knob that only breaks things is a landmine; a knob that changes nothing is dead
// weight. The interesting ones move cities / extent / the city-less carpet a long way
// across their USABLE range. Values that mostly break are excluded, so leverage always
// means "swing you can actually ship", never "swing into a crater".
// ---------------------------------------------------------------------------
var SHAPE = [
  { key: 'medCitiesOK', label: 'cities' },
  { key: 'medFarmedOK', label: 'farmed tiles' },
  { key: 'medOutsideFracOK', label: 'city-less frac' }
];
function leverageReport(pb) {
  var out = [];
  Object.keys(pb || {}).forEach(function (k) {
    var usable = pb[k].filter(function (r) { return r.brokenFrac < 0.5 && r.nHealthy > 0; });
    if (usable.length < 2) return;                       // nothing to compare across
    var rec = { axis: k, usableValues: usable.length, totalValues: pb[k].length, metrics: {} };
    var worst = 0;
    SHAPE.forEach(function (s) {
      var vals = usable.map(function (r) { return r[s.key]; }).filter(function (x) { return x != null && isFinite(x); });
      if (!vals.length) return;
      var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
      // fold = relative swing. Guard the 0 case (a knob that turns something OFF entirely
      // is infinite fold, which is real but useless to sort by) -- report span instead.
      var fold = lo > 1e-9 ? hi / lo : (hi > 1e-9 ? Infinity : 1);
      rec.metrics[s.label] = { lo: lo, hi: hi, fold: isFinite(fold) ? round1(fold) : 'inf',
        atLo: usable[argmin(vals)].value, atHi: usable[argmax(vals)].value };
      if (isFinite(fold) && fold > worst) worst = fold;
    });
    rec.maxFold = round1(worst);
    out.push(rec);
  });
  out.sort(function (a, b) { return b.maxFold - a.maxFold; });
  return out;
}
function argmin(a) { var b = 0; for (var i = 1; i < a.length; i++) if (a[i] < a[b]) b = i; return b; }
function argmax(a) { var b = 0; for (var i = 1; i < a.length; i++) if (a[i] > a[b]) b = i; return b; }

function renderLeverage(lev) {
  var L = [];
  L.push('## Leverage — knobs that swing the map without breaking it');
  L.push('');
  L.push('Swing of each shape metric across the axis values that are **usable** (broken <50%). ' +
    '`fold` = max/min. High fold + low breakage = a real design dial. Fold ~1 = the knob does nothing here. ' +
    '**city-less frac** is the share of worked land no city can reach at any price — the carpet.');
  L.push('');
  if (!lev.length) { L.push('_Not enough usable values per axis to compare._'); L.push(''); return L.join('\n'); }
  L.push('| axis | usable | metric | min | max | fold | min@ | max@ |');
  L.push('|---|---|---|---|---|---|---|---|');
  lev.forEach(function (r) {
    Object.keys(r.metrics).forEach(function (mk, i) {
      var m = r.metrics[mk];
      L.push('| ' + (i === 0 ? '**' + r.axis + '**' : '') + ' | ' +
        (i === 0 ? r.usableValues + '/' + r.totalValues : '') + ' | ' + mk + ' | ' +
        m.lo + ' | ' + m.hi + ' | ' + m.fold + ' | ' + m.atLo + ' | ' + m.atHi + ' |');
    });
  });
  L.push('');
  return L.join('\n');
}

// dominant failure mode for one axis-value record ("" if no breakage)
function dominantBreakMode(rec) {
  var modes = [['non-convergence', rec.oscillationFrac], ['collapse', rec.collapsedFrac],
    ['runaway', rec.runawayFrac], ['conservation-fail', rec.conservationFailFrac]];
  modes.sort(function (a, b) { return b[1] - a[1]; });
  return modes[0][1] > 0 ? modes[0][0] : null;
}

// human-readable "too cheap / too expensive / breaks" tags from the medians
function degeneracyFlags(rec) {
  var fl = [];
  if (rec.brokenFrac >= 0.5) fl.push('BREAKS (' + pct(rec.brokenFrac) + (dominantBreakMode(rec) ? ', mostly ' + dominantBreakMode(rec) : '') + ')');
  else if (rec.brokenFrac > 0) fl.push('some breakage (' + pct(rec.brokenFrac) + (dominantBreakMode(rec) ? ', ' + dominantBreakMode(rec) : '') + ')');
  if (rec.medianCities <= 1) fl.push('single-city dominance (transport/urban too cheap?)');
  if (rec.medianRoads === 0) fl.push('no roads built (build cost/garrison too dear?)');
  if (rec.medianFunded < 0.5) fl.push('network underfunded (med fundedFrac ' + rec.medianFunded + ')');
  return fl;
}

function renderParamBreaks(pb) {
  var L = [];
  L.push('## Parameter break-finding (the current focus)');
  L.push('');
  L.push('Each axis value, averaged over all games holding it (marginal effect across the other axes). ' +
    'Modes: **non-conv** never settles, **churn** N settled but cities/extent never stopped moving, ' +
    '**collapse** population died, **runaway** exploded, **cons-fail** food not conserved. ' +
    'Shape columns (cities/farmed/city-less) are medians over HEALTHY runs only.');
  L.push('');
  var keys = Object.keys(pb || {});
  if (!keys.length) { L.push('_No swept axes._'); L.push(''); return L.join('\n'); }
  keys.forEach(function (k) {
    L.push('**' + k + '**');
    L.push('');
    L.push('| value | n | broken | non-conv | churn | collapse | runaway | cons-fail | med N | cities | farmed | city-less | notes |');
    L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    pb[k].forEach(function (r) {
      L.push('| ' + r.value + ' | ' + r.n + ' | ' + pct(r.brokenFrac) + ' | ' + pct(r.oscillationFrac) + ' | ' +
        pct(r.churnFrac) + ' | ' +
        pct(r.collapsedFrac) + ' | ' + pct(r.runawayFrac) + ' | ' + pct(r.conservationFailFrac) + ' | ' +
        r.medianN + ' | ' + r.medCitiesOK + ' | ' + r.medFarmedOK + ' | ' + pct(r.medOutsideFracOK) + ' | ' +
        (r.flags.join('; ') || '—') + ' |');
    });
    L.push('');
  });
  return L.join('\n');
}

// per-axis: for each axis value, average divergence & broken rates
function axisTrends(analyses) {
  var axes = {};
  analyses.forEach(function (a) {
    for (var k in a.combo) {
      var v = a.combo[k];
      axes[k] = axes[k] || {};
      axes[k][v] = axes[k][v] || { n: 0, div: 0, broken: 0, dom: 0 };
      var b = axes[k][v]; b.n++;
      b.div += a.divergenceFrac; b.broken += a.brokenFrac; b.dom += a.dominanceFrac;
    }
  });
  var out = {};
  for (var k in axes) {
    out[k] = {};
    for (var v in axes[k]) {
      var b = axes[k][v];
      out[k][v] = { divergence: round(b.div / b.n), broken: round(b.broken / b.n), dominance: round(b.dom / b.n) };
    }
  }
  return out;
}

function renderMarkdown(s) {
  var L = [];
  L.push('# Balance sweep analysis — `' + s.source + '`');
  L.push('');
  L.push(s.games + ' games across ' + s.ruleSets + ' rule-sets.');
  L.push('');
  L.push('| class | count | meaning |');
  L.push('|---|---|---|');
  var meaning = { DIVERGENT: 'population & wealth won by different strategies — a real wide-vs-tall choice (keep)',
    DOMINANT: 'one strategy wins both — abstract the choice away', BROKEN: 'economy breaks — avoid',
    FLAT: 'strategies barely differ — choice doesn\'t matter', MIXED: 'inconsistent across maps' };
  ['DIVERGENT', 'MIXED', 'DOMINANT', 'FLAT', 'BROKEN'].forEach(function (k) {
    if (s.counts[k]) L.push('| ' + k + ' | ' + s.counts[k] + ' | ' + meaning[k] + ' |');
  });
  L.push('');
  L.push(renderLeverage(s.leverage || []));
  L.push(renderParamBreaks(s.paramBreaks));
  L.push('## Population-vs-wealth forks (the interesting settings)');
  var div = s.ruleSetsRanked.filter(function (a) { return a.klass === 'DIVERGENT'; });
  if (!div.length) L.push('_None found in this sweep._');
  else {
    L.push('| rule-set | fork | divergence | maps split |');
    L.push('|---|---|---|---|');
    div.slice(0, 20).forEach(function (a) {
      var split = a.perMap.filter(function (m) { return m.divergent; }).map(function (m) { return m.map; }).join(', ');
      L.push('| `' + a.key + '` | ' + a.forkSummary + ' | ' + pct(a.divergenceFrac) + ' | ' + split + ' |');
    });
  }
  L.push('');
  L.push('## Dominant-strategy settings (single optimum → abstract away)');
  var dom = s.ruleSetsRanked.filter(function (a) { return a.klass === 'DOMINANT'; });
  if (!dom.length) L.push('_None._');
  else dom.slice(0, 12).forEach(function (a) { L.push('- `' + a.key + '` — ' + a.forkSummary); });
  L.push('');
  L.push('## Broken settings (avoid)');
  var brk = s.ruleSetsRanked.filter(function (a) { return a.klass === 'BROKEN'; });
  if (!brk.length) L.push('_None._');
  else brk.slice(0, 12).forEach(function (a) { L.push('- `' + a.key + '` — ' + pct(a.brokenFrac) + ' of games broke'); });
  L.push('');
  L.push('## Per-axis trends');
  L.push('How each design knob shifts divergence / dominance / breakage (averaged over all rule-sets holding that value):');
  L.push('');
  for (var k in s.axisTrends) {
    L.push('**' + k + '**');
    L.push('');
    L.push('| value | divergence | dominance | broken |');
    L.push('|---|---|---|---|');
    var vals = Object.keys(s.axisTrends[k]).sort(function (a, b) { return parseFloat(a) - parseFloat(b); });
    vals.forEach(function (v) {
      var b = s.axisTrends[k][v];
      L.push('| ' + v + ' | ' + pct(b.divergence) + ' | ' + pct(b.dominance) + ' | ' + pct(b.broken) + ' |');
    });
    L.push('');
  }
  L.push('---');
  L.push('_Generated by analyze.js. Feed this file to an LLM to reason about which knob settings preserve genuine strategic choice; see llm_steer.js to close the loop and propose the next sweep._');
  return L.join('\n');
}

// ---- helpers --------------------------------------------------------------
function comboKey(combo) {
  return Object.keys(combo).sort().map(function (k) { return k + '=' + combo[k]; }).join(' ');
}
function rel(a, b) { return a > 0 ? (a - b) / a : 0; }
function round(x) { return Math.round(x * 1000) / 1000; }
function round1(x) { return Math.round(x * 10) / 10; }
function median(arr) {
  var a = (arr || []).filter(function (x) { return typeof x === 'number' && isFinite(x); })
    .sort(function (x, y) { return x - y; });
  if (!a.length) return 0;
  var m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function pct(x) { return (100 * x).toFixed(0) + '%'; }
function tally(arr) { var t = {}; arr.forEach(function (x) { t[x] = (t[x] || 0) + 1; }); return t; }
function modeKey(obj) {
  var best = null, bv = -1;
  for (var k in obj) if (obj[k] > bv) { bv = obj[k]; best = k; }
  return best;
}

main();
