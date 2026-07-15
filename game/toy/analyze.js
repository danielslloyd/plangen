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
    axisTrends: axisTrends(analyses),
    ruleSetsRanked: analyses
  };
  var base = inPath.replace(/\.jsonl$/, '');
  fs.writeFileSync(base + '.analysis.json', JSON.stringify(summary, null, 2));
  fs.writeFileSync(base + '.analysis.md', renderMarkdown(summary));

  console.log('Analyzed ' + rows.length + ' games across ' + analyses.length + ' rule-sets.');
  console.log('Classification: ' + JSON.stringify(summary.counts));
  console.log('Wrote ' + path.relative(process.cwd(), base + '.analysis.json') + ' and .analysis.md');
  // headline
  var div = analyses.filter(function (a) { return a.klass === 'DIVERGENT'; });
  if (div.length) {
    console.log('\nMost promising (population-vs-wealth forks):');
    div.slice(0, 6).forEach(function (a) {
      console.log('  ' + a.key + '  -> ' + a.forkSummary);
    });
  } else {
    console.log('\nNo clearly DIVERGENT rule-sets found; widen the axes or check for dominance/flatness.');
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
function pct(x) { return (100 * x).toFixed(0) + '%'; }
function tally(arr) { var t = {}; arr.forEach(function (x) { t[x] = (t[x] || 0) + 1; }); return t; }
function modeKey(obj) {
  var best = null, bv = -1;
  for (var k in obj) if (obj[k] > bv) { bv = obj[k]; best = k; }
  return best;
}

main();
