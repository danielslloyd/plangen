// harness.js — run a whole sweep of balance games (maps x rule-sets x strategies)
// in parallel and stream structured JSONL for later (LLM) analysis.
//
//   node harness.js [spec.json] [--jobs N] [--out path] [--quick]
//
// Default sweep (no spec file): 7 fixed maps x 81 rule-sets x 6 strategies = 3402
// games. Output: out/sweep.jsonl (one game per line) + out/sweep.manifest.json.
// Deterministic: same spec -> byte-identical results. The rule-set axes are the
// GAME-DESIGN knobs; strategies choose the PLAYER levers. See analyze.js next.
'use strict';
var path = require('path');
var fs = require('fs');
var wt = require('worker_threads');

var MAPS_DIR = path.join(__dirname, 'maps');
var OUT_DIR = path.join(__dirname, 'out');
// The game's DEFAULT MAP (a plangen-game-map) — referenced in a sweep spec as the
// map name "planet". It is adapted on the fly via game_map_adapter.js (not stored
// in maps/, which holds the small fixed hex maps).
var PLANET_ALIASES = { planet: path.join(__dirname, '..', '..', 'maps', 'sample-map.json') };
function resolveMapPath(mn) {
  if (PLANET_ALIASES[mn]) return PLANET_ALIASES[mn];
  return path.join(MAPS_DIR, mn + '.json');
}

// ---- default sweep spec ---------------------------------------------------
// The GAME'S DEFAULT MAP (the planet, maps/sample-map.json) is the toy's default
// everywhere — a bare `node harness.js` sweeps the planet, not the fixed hex maps.
// The fixed hex maps remain the bit-identical regression references used by
// `npm run validate`; pass an explicit spec file to sweep them.
function defaultSpec(quick) {
  return {
    maps: ['planet'],
    strategies: 'all',
    // GAME-DESIGN axes (cartesian product = the rule-sets under test)
    axes: quick
      ? { K0: [0.5, 2.0], urban: [0.3, 0.7] }
      : { K0: [0.5, 1.0, 2.0], urban: [0.2, 0.5, 0.8], garrisonPerDist: [1, 3, 6], wageShare: [1.5, 2.5, 4.0] },
    // applied to every game — the planet's clean, convergent balance mode (fixed
    // strategy-seeded cities; no organic emergence; no sea travel; deterministic).
    fixed: { roadMult: 0.30, edgeVar: 0.55, migrate: 0.5, r: 0.10, malthus: true, urbanize: false, seaTravel: false, yieldVar: 0 },
    runOpts: { maxTicks: 450, minTicks: 120, sampleEvery: 15 },
    out: quick ? 'out/sweep_quick.jsonl' : 'out/sweep.jsonl'
  };
}

// cartesian product of the axes -> array of partial-config objects
function combos(axes) {
  var keys = Object.keys(axes);
  var out = [{}];
  keys.forEach(function (k) {
    var next = [];
    out.forEach(function (base) {
      axes[k].forEach(function (v) {
        var c = {}; for (var kk in base) c[kk] = base[kk]; c[k] = v; next.push(c);
      });
    });
    out = next;
  });
  return out;
}

function resolveMaps(spec) {
  var all = fs.readdirSync(MAPS_DIR).filter(function (f) { return f.endsWith('.json'); })
    .map(function (f) { return f.replace('.json', ''); }).sort();
  return spec.maps === 'all' ? all : spec.maps;
}
function resolveStrats(spec) {
  var Strats = require('./strategies.js');
  var all = Strats.ROSTER.map(function (s) { return s.name; });
  return spec.strategies === 'all' ? all : spec.strategies;
}

// deterministic job list: maps x combos x strategies, then a DETERMINISTIC shuffle.
// The shuffle matters for crash-safety: combos() enumerates in axis order (first
// axis outermost), so an interrupted run would otherwise only cover the first axis
// values. Shuffling spreads coverage so ANY partial run is a representative sample
// across the whole grid. Seeded (fixed) => reproducible; every worker derives the
// identical order and strides by workerId, so the partition stays correct.
// spec.limit (optional, set from --limit): take only the first N of the shuffled
// jobs — a representative random sub-sample of the full grid, e.g. for a quick
// few-hundred-game validation run before committing to the full sweep overnight.
function enumerateJobs(spec) {
  var maps = resolveMaps(spec), strats = resolveStrats(spec), cs = combos(spec.axes);
  var jobs = [];
  maps.forEach(function (mn) {
    cs.forEach(function (combo) {
      var params = {}; for (var k in spec.fixed) params[k] = spec.fixed[k];
      for (var k2 in combo) params[k2] = combo[k2];
      strats.forEach(function (sn) { jobs.push({ map: mn, params: params, combo: combo, strat: sn }); });
    });
  });
  var shuffled = shuffleDet(jobs, 0x9e3779b9);
  return spec.limit ? shuffled.slice(0, spec.limit) : shuffled;
}

// Deterministic in-place Fisher-Yates using a small LCG (fixed seed => same order
// every run and across workers). This is job ORDERING only — each game is still
// bit-identical; the sim itself has no RNG.
function shuffleDet(arr, seed) {
  var s = seed >>> 0;
  function next() { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(next() * (i + 1));
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

// =============================== WORKER =====================================
if (!wt.isMainThread) {
  var R = require('./game_runner.js');
  var Adapter = require('./game_map_adapter.js');
  var d = wt.workerData;
  var jobs = enumerateJobs(d.spec);
  var mapCache = {};
  function loadMap(mn) {
    if (!mapCache[mn]) {
      var raw = JSON.parse(fs.readFileSync(resolveMapPath(mn), 'utf8'));
      // a plangen-game-map (the planet) is adapted to the engine graph spec; the
      // fixed hex maps are used as-is. withPolys:false — the harness never renders.
      mapCache[mn] = (raw && raw.format === 'plangen-game-map')
        ? Adapter.adaptGameMap(raw, { withPolys: false, name: mn })
        : raw;
    }
    return mapCache[mn];
  }
  // Post small batches so completed games reach the main process (and disk) often —
  // crash-safety. Worst-case games lost to a hard kill = SAVE_BATCH x numWorkers of
  // in-flight, unreported games (~a few hundred at most; a Ctrl-C flushes the rest).
  var SAVE_BATCH = 2;
  var batch = [];
  for (var i = d.workerId; i < jobs.length; i += d.numWorkers) {
    var j = jobs[i];
    var row = R.runGame(loadMap(j.map), j.params, j.strat, d.spec.runOpts);
    row.combo = j.combo;                     // keep the swept axis point explicit
    batch.push({ i: i, row: row });
    if (batch.length >= SAVE_BATCH) { wt.parentPort.postMessage({ type: 'batch', batch: batch }); batch = []; }
  }
  if (batch.length) wt.parentPort.postMessage({ type: 'batch', batch: batch });
  wt.parentPort.postMessage({ type: 'done' });
  return;
}

// =============================== MAIN =======================================
(function main() {
  var args = process.argv.slice(2);
  var quick = args.indexOf('--quick') >= 0;
  var jobsFlag = args.indexOf('--jobs');
  var numWorkers = jobsFlag >= 0 ? parseInt(args[jobsFlag + 1], 10) : Math.max(1, require('os').cpus().length - 1);
  var outFlag = args.indexOf('--out');
  var limitFlag = args.indexOf('--limit');
  var specFile = args.find(function (a) { return a.endsWith('.json') && fs.existsSync(a); });

  var spec = specFile ? JSON.parse(fs.readFileSync(specFile, 'utf8')) : defaultSpec(quick);
  if (outFlag >= 0) spec.out = args[outFlag + 1];
  if (limitFlag >= 0) spec.limit = parseInt(args[limitFlag + 1], 10);

  var jobs = enumerateJobs(spec);
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);
  var outPath = path.isAbsolute(spec.out) ? spec.out : path.join(__dirname, spec.out);
  var manifestPath = outPath.replace(/\.jsonl$/, '.manifest.json');
  // CRASH-SAFE OUTPUT: rows are appended to this stream as each worker batch
  // arrives (not buffered to the end), so an interrupt keeps everything produced
  // so far. Completion-order, not job-order — analyze.js groups by combo, so order
  // does not matter.
  var ws = fs.createWriteStream(outPath, { flags: 'w' });

  console.log('Sweep: ' + jobs.length + ' games  (' + resolveMaps(spec).length + ' maps x ' +
    combos(spec.axes).length + ' rule-sets x ' + resolveStrats(spec).length + ' strategies)');
  console.log('Workers: ' + numWorkers + '   Output: ' + path.relative(process.cwd(), outPath));

  var t0 = Date.now(), done = 0, brokenN = 0, lastPct = -1;
  var finished = 0, lastCheckpoint = 0, stopping = false, exited = false;
  var workers = [];

  // Manifest written on checkpoint (partial=true), clean finish (partial=false)
  // and interrupt (partial=true) — so even a hard kill leaves a recent manifest
  // beside the already-on-disk JSONL.
  function writeManifest(partial) {
    var el = (Date.now() - t0) / 1000;
    var manifest = {
      spec: spec, games: jobs.length, gamesWritten: done, broken: brokenN,
      partial: !!partial,
      maps: resolveMaps(spec), strategies: resolveStrats(spec),
      ruleSets: combos(spec.axes).length, axes: spec.axes,
      wallSeconds: Math.round(el), workers: numWorkers, generated: new Date().toISOString()
    };
    // Atomic write: writeFileSync-then-crash (or a power loss) mid-write leaves a
    // truncated/corrupt manifest; write to a temp file and rename (atomic on the
    // same volume) so the manifest is always either the old or the new complete one.
    try {
      var tmp = manifestPath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2));
      fs.renameSync(tmp, manifestPath);
    } catch (e) {}
  }

  function spawn(id) {
    var w = new wt.Worker(__filename, { workerData: { spec: spec, workerId: id, numWorkers: numWorkers } });
    workers.push(w);
    w.on('message', function (msg) {
      if (stopping) return;
      if (msg.type === 'batch') {
        msg.batch.forEach(function (b) {
          ws.write(JSON.stringify(b.row) + '\n');    // append as it completes
          if (b.row.health.broken) brokenN++;
        });
        done += msg.batch.length;
        var pct = Math.floor(100 * done / jobs.length);
        if (pct !== lastPct && pct % 5 === 0) {
          lastPct = pct;
          var el = (Date.now() - t0) / 1000;
          var eta = el / Math.max(1, done) * (jobs.length - done);
          process.stdout.write('\r  ' + pct + '%  (' + done + '/' + jobs.length + ')  ' +
            el.toFixed(0) + 's elapsed  ~' + eta.toFixed(0) + 's left      ');
        }
        if (done - lastCheckpoint >= 100) { lastCheckpoint = done; writeManifest(true); }
      } else if (msg.type === 'done') {
        finished++;
        if (finished === numWorkers) finishClean();
      }
    });
    w.on('error', function (e) { console.error('\nWorker ' + id + ' error:', e); shutdown('worker-error'); });
  }

  function finishClean() {
    if (exited) return; exited = true;
    ws.end(function () {
      writeManifest(false);
      var el = (Date.now() - t0) / 1000;
      process.stdout.write('\r  100%  (' + jobs.length + '/' + jobs.length + ')  ' + el.toFixed(0) + 's            \n');
      console.log('Done. ' + done + ' games, ' + brokenN + ' broken (' +
        (100 * brokenN / Math.max(1, done)).toFixed(1) + '%), ' + el.toFixed(0) + 's on ' + numWorkers + ' workers.');
      console.log('Wrote ' + path.relative(process.cwd(), outPath) + '  (+ .manifest.json)');
      console.log('Next: node analyze.js ' + path.relative(process.cwd(), outPath));
      process.exit(0);
    });
  }

  // Graceful stop: terminate workers, flush what we have, write a partial manifest.
  function shutdown(sig) {
    if (stopping || exited) return;
    stopping = true; exited = true;
    process.stdout.write('\n');
    console.log('Interrupted (' + sig + ') — stopping workers, keeping ' + done + '/' + jobs.length + ' games.');
    workers.forEach(function (w) { try { w.terminate(); } catch (e) {} });
    ws.end(function () {
      writeManifest(true);
      console.log('Wrote partial ' + path.relative(process.cwd(), outPath) + ' (' + done + ' games) + .manifest.json');
      console.log('Analyze what completed: node analyze.js ' + path.relative(process.cwd(), outPath));
      process.exit(0);
    });
  }
  process.on('SIGINT', function () { shutdown('SIGINT'); });
  process.on('SIGTERM', function () { shutdown('SIGTERM'); });

  for (var id = 0; id < numWorkers; id++) spawn(id);
})();
