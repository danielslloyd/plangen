// maps.js — deterministic fixed-map catalog for the balance harness (browser+Node).
// Each map is { name, cols, rows, cells:[terrain...], sites:[{col,row,q}...] }.
// `sites` are candidate city locations (good, well-spaced land) that strategy
// agents choose among. Maps are generated from fixed seeds so every sweep runs
// on exactly the same worlds. Dump them to maps/*.json with test/gen_maps.js.
(function (global) {
  'use strict';

  // deterministic RNG (mulberry32)
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function axial(col, r) { return { q: col - Math.floor(r / 2), r: r }; }
  function hexDist(a, b) {
    var dq = a.q - b.q, dr = a.r - b.r;
    return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
  }

  // blob helper: raise terrain within radius of a center (best-of)
  var RANK = { water: -1, mountain: -1, barren: 0, plains: 1, farm: 2, rich: 3 };
  function stamp(cells, cols, rows, cx, cy, rad, terr) {
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      if (Math.hypot(c - cx, r - cy) < rad) {
        var i = r * cols + c;
        if (RANK[terr] > RANK[cells[i]]) cells[i] = terr;
      }
    }
  }
  function ridge(cells, cols, rows, fn, terr) {
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      if (fn(c, r)) cells[r * cols + c] = terr;
    }
  }

  // pick well-spaced high-capacity candidate sites
  var CAP = { water: 0, mountain: 0, barren: 0, plains: 260, farm: 520, rich: 900 };
  function pickSites(cells, cols, rows, minSpacing, maxSites) {
    var scored = [];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var i = r * cols + c;
      if (CAP[cells[i]] <= 0) continue;              // must be passable+fertile-ish
      var cap = CAP[cells[i]], n = 1;
      // local capacity (self + neighbors)
      var A = axial(c, r);
      for (var rr = Math.max(0, r - 1); rr <= Math.min(rows - 1, r + 1); rr++)
        for (var cc = Math.max(0, c - 1); cc <= Math.min(cols - 1, c + 1); cc++) {
          if (cc === c && rr === r) continue;
          cap += CAP[cells[rr * cols + cc]]; n++;
        }
      scored.push({ col: c, row: r, q: A.q, score: cap / n });
    }
    scored.sort(function (a, b) { return b.score - a.score; });
    var chosen = [];
    for (var s = 0; s < scored.length && chosen.length < maxSites; s++) {
      var cand = scored[s], ok = true;
      for (var k = 0; k < chosen.length; k++) {
        if (hexDist(axial(cand.col, cand.row), axial(chosen[k].col, chosen[k].row)) < minSpacing) { ok = false; break; }
      }
      if (ok) chosen.push({ col: cand.col, row: cand.row, q: cand.q });
    }
    return chosen;
  }

  function blank(cols, rows, terr) {
    var cells = new Array(cols * rows);
    for (var i = 0; i < cells.length; i++) cells[i] = terr;
    return cells;
  }

  // ---- the fixed catalog -------------------------------------------------
  var GENERATORS = {
    // two symmetric fertile basins — balanced, tests wide-vs-tall directly
    twin_basins: function () {
      var cols = 18, rows = 12, cells = blank(cols, rows, 'plains');
      stamp(cells, cols, rows, 4, 4, 2.8, 'rich'); stamp(cells, cols, rows, 4, 4, 4, 'farm');
      stamp(cells, cols, rows, 13, 8, 2.8, 'rich'); stamp(cells, cols, rows, 13, 8, 4, 'farm');
      return { name: 'twin_basins', cols: cols, rows: rows, cells: cells, sites: pickSites(cells, cols, rows, 4, 8) };
    },
    // one lush breadbasket, one marginal frontier — asymmetric productivity
    rich_and_poor: function () {
      var cols = 20, rows = 12, cells = blank(cols, rows, 'plains');
      stamp(cells, cols, rows, 5, 6, 3.5, 'rich'); stamp(cells, cols, rows, 5, 6, 5, 'farm');
      stamp(cells, cols, rows, 15, 4, 2, 'farm');
      ridge(cells, cols, rows, function (c, r) { return c >= 16 && (r % 3 === 0); }, 'barren');
      return { name: 'rich_and_poor', cols: cols, rows: rows, cells: cells, sites: pickSites(cells, cols, rows, 4, 8) };
    },
    // fertile patches separated by water — connectivity/roads matter a lot
    archipelago: function () {
      var cols = 20, rows = 14, cells = blank(cols, rows, 'water');
      [[4, 3], [15, 4], [5, 11], [16, 11], [10, 7]].forEach(function (p) {
        stamp(cells, cols, rows, p[0], p[1], 3, 'plains');
        stamp(cells, cols, rows, p[0], p[1], 1.8, 'farm');
        stamp(cells, cols, rows, p[0], p[1], 0.9, 'rich');
      });
      return { name: 'archipelago', cols: cols, rows: rows, cells: cells, sites: pickSites(cells, cols, rows, 3, 8) };
    },
    // a central heartland ringed by remote fertile frontier — rewards expansion,
    // punishes over-extension (garrison cost)
    frontier: function () {
      var cols = 22, rows = 14, cells = blank(cols, rows, 'plains');
      stamp(cells, cols, rows, 11, 7, 3, 'rich'); stamp(cells, cols, rows, 11, 7, 4.5, 'farm');
      [[2, 2], [19, 2], [2, 11], [19, 11]].forEach(function (p) {
        stamp(cells, cols, rows, p[0], p[1], 2.2, 'farm');
        stamp(cells, cols, rows, p[0], p[1], 1, 'rich');
      });
      return { name: 'frontier', cols: cols, rows: rows, cells: cells, sites: pickSites(cells, cols, rows, 5, 8) };
    },
    // one enormous fertile plain, few standout city sites — few big cities natural
    breadbasket: function () {
      var cols = 18, rows = 12, cells = blank(cols, rows, 'farm');
      stamp(cells, cols, rows, 9, 6, 5, 'rich');
      ridge(cells, cols, rows, function (c, r) { return c === 0 || r === 0 || c === cols - 1 || r === rows - 1; }, 'plains');
      return { name: 'breadbasket', cols: cols, rows: rows, cells: cells, sites: pickSites(cells, cols, rows, 4, 6) };
    },
    // mountains carve the map into basins — transport-cost sensitive
    highlands: function () {
      var cols = 20, rows = 14, cells = blank(cols, rows, 'plains');
      stamp(cells, cols, rows, 4, 4, 2.6, 'farm'); stamp(cells, cols, rows, 16, 4, 2.6, 'farm');
      stamp(cells, cols, rows, 4, 10, 2.6, 'farm'); stamp(cells, cols, rows, 16, 10, 2.6, 'rich');
      ridge(cells, cols, rows, function (c, r) { return Math.abs(c - 10) < 1.2 && r > 1 && r < rows - 2; }, 'mountain');
      ridge(cells, cols, rows, function (c, r) { return Math.abs(r - 7) < 1.0 && c > 6 && c < 14; }, 'mountain');
      return { name: 'highlands', cols: cols, rows: rows, cells: cells, sites: pickSites(cells, cols, rows, 4, 8) };
    },
    // linear corridor — the frontier road / garrison stress map
    long_corridor: function () {
      var cols = 26, rows = 8, cells = blank(cols, rows, 'plains');
      stamp(cells, cols, rows, 3, 4, 2.4, 'rich');
      stamp(cells, cols, rows, 22, 4, 2.4, 'farm');
      stamp(cells, cols, rows, 13, 4, 1.6, 'farm');
      return { name: 'long_corridor', cols: cols, rows: rows, cells: cells, sites: pickSites(cells, cols, rows, 5, 6) };
    },
    // an arc of prime land sweeping across dry margins (the classic crescent)
    fertile_crescent: function () {
      var cols = 22, rows = 14, cells = blank(cols, rows, 'barren');
      for (var a = 0; a <= 40; a++) {
        var th = Math.PI * (0.15 + 0.7 * a / 40);
        var cx = 11 + 8 * Math.cos(th), cy = 7 + 6 * Math.sin(th);
        stamp(cells, cols, rows, cx, cy, 2.2, 'plains');
        stamp(cells, cols, rows, cx, cy, 1.4, 'farm');
        stamp(cells, cols, rows, cx, cy, 0.7, 'rich');
      }
      return { name: 'fertile_crescent', cols: cols, rows: rows, cells: cells, sites: pickSites(cells, cols, rows, 4, 8) };
    },
    // a river with a fanning fertile delta at its mouth; drylands away from water
    river_delta: function () {
      var cols = 22, rows = 14, cells = blank(cols, rows, 'plains');
      ridge(cells, cols, rows, function (c, r) { return c === 0 || r === 0 || c === cols - 1 || r === rows - 1; }, 'barren');
      // meandering river down the middle
      for (var r = 0; r < rows; r++) {
        var c = Math.round(11 + 3 * Math.sin(r * 0.6));
        cells[r * cols + c] = 'water';
        [c - 1, c + 1].forEach(function (cc) { if (cc > 0 && cc < cols - 1) stamp(cells, cols, rows, cc, r, 1.3, 'farm'); });
      }
      // delta fan at the bottom
      [[8, 12], [11, 13], [14, 12], [10, 11], [12, 11]].forEach(function (p) {
        stamp(cells, cols, rows, p[0], p[1], 2, 'rich'); stamp(cells, cols, rows, p[0], p[1], 3, 'farm');
      });
      return { name: 'river_delta', cols: cols, rows: rows, cells: cells, sites: pickSites(cells, cols, rows, 4, 8) };
    },
    // mountain wall: lush windward side, arid rain-shadow leeward
    rain_shadow: function () {
      var cols = 22, rows = 12, cells = blank(cols, rows, 'plains');
      ridge(cells, cols, rows, function (c, r) { return Math.abs(c - 11) < 1.3; }, 'mountain');
      // wet (left) graded rich->farm; dry (right) barren
      [[3, 3], [4, 8], [6, 5], [2, 10]].forEach(function (p) { stamp(cells, cols, rows, p[0], p[1], 2.4, 'rich'); stamp(cells, cols, rows, p[0], p[1], 3.4, 'farm'); });
      ridge(cells, cols, rows, function (c, r) { return c > 12; }, 'barren');
      [[16, 4], [18, 9]].forEach(function (p) { stamp(cells, cols, rows, p[0], p[1], 1.6, 'plains'); });
      return { name: 'rain_shadow', cols: cols, rows: rows, cells: cells, sites: pickSites(cells, cols, rows, 4, 7) };
    },
    // scattered fertile oases in a desert — sparse, connectivity-critical (rng)
    oasis_scatter: function () {
      var rnd = rng(90210), cols = 22, rows = 14, cells = blank(cols, rows, 'barren');
      for (var i = 0; i < 9; i++) {
        var cx = 2 + Math.floor(rnd() * (cols - 4)), cy = 2 + Math.floor(rnd() * (rows - 4));
        var big = rnd() > 0.5;
        stamp(cells, cols, rows, cx, cy, big ? 2.2 : 1.4, 'farm');
        stamp(cells, cols, rows, cx, cy, big ? 1.1 : 0.6, 'rich');
      }
      return { name: 'oasis_scatter', cols: cols, rows: rows, cells: cells, sites: pickSites(cells, cols, rows, 3, 8) };
    },
    // procedurally varied fertility — smooth random field, lots of gradients (rng)
    patchwork: function () {
      var rnd = rng(1337), cols = 22, rows = 14, cells = blank(cols, rows, 'plains');
      // a few random fertility peaks and a couple of dead zones + a lake
      for (var i = 0; i < 6; i++) stamp(cells, cols, rows, 1 + rnd() * (cols - 2), 1 + rnd() * (rows - 2), 1.5 + rnd() * 2.5, rnd() > 0.5 ? 'rich' : 'farm');
      for (var j = 0; j < 3; j++) stamp(cells, cols, rows, 1 + rnd() * (cols - 2), 1 + rnd() * (rows - 2), 1 + rnd() * 2, 'barren');
      stamp(cells, cols, rows, 4 + rnd() * (cols - 8), 4 + rnd() * (rows - 8), 1.5, 'water');
      return { name: 'patchwork', cols: cols, rows: rows, cells: cells, sites: pickSites(cells, cols, rows, 4, 8) };
    }
  };

  // small deterministic name hash -> per-map seed for edge-cost variation
  function nameSeed(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h | 0; }

  function catalog() {
    var out = [];
    for (var k in GENERATORS) { var mp = GENERATORS[k](); mp.seed = nameSeed(mp.name); out.push(mp); }
    return out;
  }

  var API = { catalog: catalog, GENERATORS: GENERATORS, pickSites: pickSites, rng: rng, CAP: CAP };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.EconMaps = API;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
