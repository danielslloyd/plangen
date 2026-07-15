// llm_steer.js — close the balance-tuning loop. Reads an analysis summary and
// proposes the NEXT sweep spec, steering the parameter search toward rule-sets
// that preserve genuine strategic choice (DIVERGENT: population and wealth won
// by different strategies) while avoiding BROKEN regions.
//
//   node llm_steer.js [out/sweep.analysis.json] [--out out/next_sweep.json]
//                     [--ollama] [--model llama3.1] [--host http://localhost:11434]
//
// Backends:
//   * mock   (default) — deterministic heuristic; no model needed. Zooms the
//                        axes around the most-divergent rule-set (or broadens if
//                        none found). Fully offline; reproducible.
//   * ollama (--ollama)— POSTs the brief to a LOCAL Ollama model and asks for a
//                        sweep spec as JSON. Nothing leaves the machine.
//
// Why the LLM is at THIS layer, not inside the game loop: a single game is ~1s
// of pure arithmetic; putting a multi-second model call in the inner per-turn
// loop of thousands of games is fatal. Heuristic strategy archetypes drive the
// games; the model reasons over the AGGREGATE results to pick the next batch —
// the productive use Dan flagged.
'use strict';
var fs = require('fs'), path = require('path');

// knob catalog (name -> [min,max]) so proposals stay in range
var KNOBS = {
  K0: [0.2, 3], roadMult: [0.1, 0.9], edgeVar: [0, 1], urban: [0, 1], kappa: [120, 360],
  r: [0.02, 0.2], migrate: [0.1, 1], tau: [0, 0.6], wageShare: [0.5, 6],
  mCrew: [0, 3], safeRadius: [0, 8], garrisonPerDist: [0, 8], degrade: [0, 1]
};

function main() {
  var args = process.argv.slice(2);
  var inPath = args.find(function (a) { return a.endsWith('.json') && fs.existsSync(a) && !a.startsWith('--'); })
    || path.join(__dirname, 'out', 'sweep.analysis.json');
  if (!fs.existsSync(inPath)) { console.error('No analysis file: ' + inPath + '  (run analyze.js first)'); process.exit(1); }
  var summary = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  var outFlag = args.indexOf('--out');
  var outPath = outFlag >= 0 ? args[outFlag + 1] : path.join(path.dirname(inPath), 'next_sweep.json');
  var useOllama = args.indexOf('--ollama') >= 0;

  var proposePromise = useOllama
    ? proposeOllama(summary, {
        model: flag(args, '--model', 'llama3.1'),
        host: flag(args, '--host', 'http://localhost:11434')
      })
    : Promise.resolve(proposeMock(summary));

  proposePromise.then(function (spec) {
    spec.out = spec.out || ('out/sweep_round2.jsonl');
    fs.writeFileSync(outPath, JSON.stringify(spec, null, 2));
    console.log('Proposed next sweep (' + (useOllama ? 'ollama' : 'mock') + '):');
    console.log('  axes: ' + JSON.stringify(spec.axes));
    console.log('  rationale: ' + (spec._rationale || '(none)'));
    console.log('Wrote ' + path.relative(process.cwd(), outPath));
    console.log('Run it:  node harness.js ' + path.relative(process.cwd(), outPath));
  }).catch(function (e) {
    console.error('Steering failed: ' + e.message);
    console.error('Falling back to mock proposal.');
    var spec = proposeMock(summary);
    fs.writeFileSync(outPath, JSON.stringify(spec, null, 2));
    console.log('Wrote mock proposal to ' + path.relative(process.cwd(), outPath));
  });
}

// ---- deterministic mock steering -----------------------------------------
function proposeMock(summary) {
  var ranked = summary.ruleSetsRanked || [];
  var divergent = ranked.filter(function (a) { return a.klass === 'DIVERGENT'; });
  var base = { maps: 'all', strategies: 'all',
    fixed: { roadMult: 0.30, edgeVar: 0.55, migrate: 0.5, r: 0.10, malthus: true },
    runOpts: { maxTicks: 450, minTicks: 120, sampleEvery: 15 } };

  if (divergent.length) {
    // zoom: build a fine grid around the best divergent rule-set's combo
    var center = divergent[0].combo, axes = {};
    for (var k in center) axes[k] = refine(k, center[k]);
    base.axes = axes;
    base._rationale = 'Zooming around the most-divergent rule-set (' + divergent[0].key +
      ': ' + divergent[0].forkSummary + ') to map the boundary of genuine wide-vs-tall choice.';
    base.out = 'out/sweep_zoom.jsonl';
  } else {
    // broaden: no divergence found — widen the most influential axes
    var trends = summary.axisTrends || {};
    var axes2 = {};
    Object.keys(trends).forEach(function (k) {
      // pick the axis values with best divergence, then spread wider
      var vals = Object.keys(trends[k]).map(parseFloat).sort(function (a, b) { return a - b; });
      var lo = KNOBS[k] ? KNOBS[k][0] : vals[0];
      var hi = KNOBS[k] ? KNOBS[k][1] : vals[vals.length - 1];
      axes2[k] = [round(lo + (hi - lo) * 0.15), round(lo + (hi - lo) * 0.5), round(lo + (hi - lo) * 0.85)];
    });
    base.axes = axes2;
    base._rationale = 'No DIVERGENT rule-sets found; broadening the axes across their full ranges to search for a regime with genuine strategic divergence.';
    base.out = 'out/sweep_broad.jsonl';
  }
  return base;
}
function refine(k, v) {
  var rng = KNOBS[k] || [v * 0.5, v * 1.5];
  var step = Math.max((rng[1] - rng[0]) * 0.12, Math.abs(v) * 0.25 || 0.05);
  return [clampR(k, v - step), v, clampR(k, v + step)].map(round);
}
function clampR(k, x) { var r = KNOBS[k]; return r ? Math.max(r[0], Math.min(r[1], x)) : x; }
function round(x) { return Math.round(x * 1000) / 1000; }

// ---- Ollama backend (local model; nothing leaves the machine) -------------
function proposeOllama(summary, opts) {
  var brief = buildBrief(summary);
  var sys = 'You are tuning a strategy-game economy. A sweep tested rule-sets (parameter points) ' +
    'against strategy archetypes. Goal: find rule-sets classified DIVERGENT (population and wealth ' +
    'are won by DIFFERENT strategies — a genuine wide-vs-tall player choice), avoiding BROKEN ones. ' +
    'Propose the NEXT sweep to explore. Reply ONLY with JSON of the form ' +
    '{"axes": {"<knob>": [values...]}, "_rationale": "..."} using knobs from this catalog with ' +
    'values inside the given [min,max]: ' + JSON.stringify(KNOBS) + '. Keep the product of axis ' +
    'lengths <= 120.';
  var body = { model: opts.model, stream: false, format: 'json',
    messages: [{ role: 'system', content: sys }, { role: 'user', content: brief }] };
  return fetch(opts.host + '/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }).then(function (res) {
    if (!res.ok) throw new Error('Ollama HTTP ' + res.status + ' (is `ollama serve` running with model ' + opts.model + '?)');
    return res.json();
  }).then(function (j) {
    var content = j.message ? j.message.content : j.response;
    var parsed = JSON.parse(content);
    var axes = sanitizeAxes(parsed.axes);
    if (!Object.keys(axes).length) throw new Error('model returned no usable axes');
    return { maps: 'all', strategies: 'all',
      fixed: { roadMult: 0.30, edgeVar: 0.55, migrate: 0.5, r: 0.10, malthus: true },
      runOpts: { maxTicks: 450, minTicks: 120, sampleEvery: 15 },
      axes: axes, _rationale: parsed._rationale || '(ollama)', out: 'out/sweep_ollama.jsonl' };
  });
}
function sanitizeAxes(axes) {
  var out = {};
  if (!axes || typeof axes !== 'object') return out;
  Object.keys(axes).forEach(function (k) {
    if (!KNOBS[k] || !Array.isArray(axes[k])) return;
    var vals = axes[k].map(Number).filter(function (v) { return isFinite(v); })
      .map(function (v) { return Math.max(KNOBS[k][0], Math.min(KNOBS[k][1], v)); });
    if (vals.length) out[k] = vals.slice(0, 5);
  });
  return out;
}
function buildBrief(summary) {
  var lines = ['Classification counts: ' + JSON.stringify(summary.counts),
    'Per-axis trends (divergence/dominance/broken by value): ' + JSON.stringify(summary.axisTrends),
    'Top DIVERGENT rule-sets:'];
  (summary.ruleSetsRanked || []).filter(function (a) { return a.klass === 'DIVERGENT'; })
    .slice(0, 8).forEach(function (a) { lines.push('  ' + a.key + ' -> ' + a.forkSummary); });
  return lines.join('\n');
}
function flag(args, name, def) { var i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; }

main();
