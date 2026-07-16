// ============================================================================
// econ_engine.js — Hex Economy v2 shared engine (browser + Node)
// ----------------------------------------------------------------------------
// Ports the Node-validated equilibrium (hex_economy_v2_core.js / spec §11) and
// layers taxation → road crews → garrisons → incremental road construction →
// gradual road decay → optional bandit tolls on top of it, WITHOUT disturbing
// the validated core (all layers no-op when tau=0 and there are no roads, so
// the bare equilibrium reproduces §11.5 exactly).
//
// Design invariants (do not break — see hex_economy_v2_spec.md §11 / HANDOFF):
//   * Bisection on the shadow wage w and on each city price P_k. Never
//     fixed-step t'atonnement (that is what oscillated in v1).
//   * Subsistence floor is mandatory: workers who can't earn the market wage
//     subsist-farm viable land and eat locally. Lets population bootstrap.
//   * Conservation: food produced == c * (all eaters) every tick. This is the
//     regression test for the original megacity bug.
//   * Anti-runaway: p > alpha (enforced structurally by the urban slider).
//
// Usage:
//   Node:    const Econ = require('./econ_engine.js');
//   Browser: <script src="econ_engine.js"></script>  ->  window.Econ
// ============================================================================
(function (global) {
  'use strict';

  var clamp = function (x, a, b) { return Math.max(a, Math.min(b, x)); };

  // ---- Terrain -------------------------------------------------------------
  // Capacities are scaled large so a hex saturates at HUNDREDS of farmers and
  // cities reach THOUSANDS (per Dan's scaling note). barren is passable but
  // grows nothing; water/mountain are impassable (block transport & farming).
  var TERR = {
    water:    { C: 0,   passable: false, col: '#20415e' },
    mountain: { C: 0,   passable: false, col: '#3b3f49' },
    barren:   { C: 0,   passable: true,  col: '#4a4636' },
    plains:   { C: 260, passable: true,  col: '#3c5a44' },
    farm:     { C: 520, passable: true,  col: '#4d7a4f' },
    rich:     { C: 900, passable: true,  col: '#5fa564' }
  };

  // ---- Config defaults (every knob) ---------------------------------------
  // Ranges mirror spec §6 where they exist; scaling knobs are new. The harness
  // sweeps these; the HTML exposes the tunable subset.
  var DEFAULTS = {
    // transport
    K0: 1.0,          // overland base cost / hex (scaled per-edge by a fixed factor)
    roadMult: 0.30,   // road cost = base * roadMult  (ALWAYS < 1 of the overland cost)
    edgeVar: 0.55,    // lognormal spread of per-edge overland cost (0 = uniform). Makes
                      // the cheapest path to a city differ from the fewest-hops path.
    // farming / consumption
    c: 1.0,           // food eaten per worker / turn
    kappa: 200,       // farm labor-saturation scale (big => hundreds/hex)
    // city / urbanization  (collapsed slider — see deriveUrban)
    urban: 0.5,       // 0 = agrarian, 1 = urban. Sets alpha, p, Abase.
    Abase: null,      // if null, derived from urban. City productivity coefficient.
    alpha: null,      // if null, derived from urban (>1, accelerating).
    pconc: null,      // if null, derived from urban (Pareto; ALWAYS > alpha).
    // ORGANIC CITIES — tiles flip WHOLESALE to gold-work (zero food) when it out-
    // earns farming; connected urban tiles pool into ONE agglomerated city; new
    // cores ignite in food-rich areas. (urbanize:false => fixed placed cities.)
    urbanize: true,
    aggloWithin: 0.12,  // mild productivity boost from a city's own extent (the
                        // alpha>1 term already gives intra-city increasing returns;
                        // keep this small or big cities inflate A and never stop).
    aggloAcross: 0.10,  // boost from nearby OTHER urban mass (Q1: agglomeration)
    aggloScale: 3.5,    // distance decay (hexes) for cross-city agglomeration
    // Extent tracks the (food-limited) workforce via a density target; the flip
    // GATE uses the city's MEDIAN wage (per-worker, O(1)) vs the tile's farm
    // value — so cities pave poor hinterland first and spare prime farmland,
    // and stop where median stops beating farmland.
    urbanDensityTarget: 2000, // gold workers per urban tile the city grows toward
    shrinkRatio: 0.3,   // revert a fringe tile below target*this workers/tile. Lower =
                        // stickier extent (a city holds paved tiles through population
                        // dips instead of shedding then re-paving them — anti-oscillation).
    flipPercentile: 0.5, // which wage percentile represents the urban opportunity
    flipHyst: 0.15,      // flip needs median urban real income > farm*(1+this)
    flipsPerTick: 1,     // max structural changes/tick — timescale separation so
                         // the equilibrium settles between flips (kills the churn
                         // limit cycle where one city grows while another shrinks)
    flipCooldown: 10,    // a tile can't flip again for this many ticks (anti-flicker)
    growInterval: 8,     // min ticks between a single city adding tiles. Growing one
                         // tile per tick outraces the Malthus/food equilibrium and the
                         // city OVERSHOOTS its sustainable size, then thrashes back —
                         // the main oscillation source. Growing gradually lets each new
                         // tile settle, so extent tracks (not overshoots) what food supports.
    reversalCooldown: 80, // a tile can't flip the OPPOSITE direction for this many
                          // ticks after its last flip. Makes flips effectively
                          // one-directional over the settling horizon => a tile
                          // grows OR shrinks, it does not oscillate between the two.
    clSmooth: 0.2,        // EMA weight on the NEW cluster-median-wage each tick (1 =
                          // instant / no smoothing). Damps the discrete-flip <->
                          // Malthus food-shock feedback that drives the limit cycle,
                          // so a one-tick food shock can't trip the reverse flip.
    // COMPACT-BUT-IRREGULAR growth: a growing city paves the adjacent farm tile that
    // best combines "already hemmed in by city" (compact) with "cheap farmland"
    // (irregular — the extent follows the terrain, sparing prime land). The ring
    // gate is a hard backstop that stops thin fingers before they form.
    compactBias: 0.7,    // weight on a candidate's urban-neighbour count (0..6) in the
                         // grow score; higher = rounder, lower = more terrain-driven.
    growJitter: 0.8,     // amplitude of deterministic per-tile noise = irregularity.
    ringGate: true,      // enforce the ring rule below (false = economics/compactness only)
    ringFillFrac: 0.5,   // a ring-N tile can't flip until ring N-1 is this fraction filled
    // New cores ignite in food-RICH, populous areas FAR from any city; spacing
    // self-limits how many (once cities cover the map, nowhere is "far" enough).
    newCoresPerTick: 1,
    newCoreMinFarmers: 6000, // local farmer mass (radius 2) needed to seed a town
    newCoreMinDist: 5,       // physical hexes from the nearest city
    maxUrbanFrac: 0.5,  // hard backstop: urban tiles never exceed this of the land
    // population dynamics
    r: 0.10,          // Malthusian growth rate
    malthus: true,    // growth on/off (off => fixed pool, reallocation only)
    N0: 15,           // starting pool
    // migration (fractional flow toward equilibrium; 1 = instant)
    migrate: 0.5,
    // basin stickiness: a farm tile ships to the city with the best delivered
    // netback (price - transport). When two cities are near-tied the winner
    // flip-flops every tick. basinHyst = how much MORE a rival must beat the
    // current basin before the tile switches allegiance (0.08 => 8% better).
    basinHyst: 0.08,
    // ---- harbours & sea travel ----------------------------------------------
    // A coastal URBAN tile (adjacent to water) is a harbour: it commits
    // harborWorkers labourers (automatic, not tax-funded) and opens sea routes.
    // Transport may then cross open water between harbours on the SAME body of
    // water: each water-hex hop costs seaCostFrac x the lowest (fully-built) road
    // cost, and embarking/disembarking at a harbour costs a fixed harborCost.
    seaTravel: true,
    seaCostFrac: 0.5,  // Z: sea cost / water-hex = this x (K0 x roadMult)
    harborCost: 1.0,   // fixed load/unload cost at a harbour (land<->water transition)
    harborWorkers: 40, // Y: labourers committed per coastal urban tile (eat food there)
    // FISHING: a coastal tile gains extra food capacity for each adjacent water
    // tile, worked (with the same diminishing returns, same labour pool, same
    // marginal choice as farming) by fishermen. Modelled as ADDITIVE capacity:
    // Cfood = farm C + fishCap, so the existing market/subsistence machinery just
    // sees a bigger hex and staffs the extra fishing capacity automatically.
    fishPerSea: 180,   // food capacity added per adjacent water tile (before yield noise)
    coastalCoreBonus: 0.6, // emergent-town site score multiplier for a coastal (harbour) tile
    // YIELD RANDOMNESS: per-tile multiplier on farm capacity and on each sea
    // tile's fishing yield, so identical terrain still varies. 0 = uniform.
    yieldVar: 0.30,    // +/- fraction (uniform); e.g. 0.3 => each tile 0.7x..1.3x
    // A city PLACED by the player seeds this many people (added to the pool, then
    // the equilibrium splits them between the new city centre and its hinterland).
    // Only the FIRST city bootstraps the world; later cities draw from the pool.
    cityFoundPop: 1000,
    // Subsistence = desperation farming: idle people work land they can reach until
    // the marginal worker's NET food is zero, sharing the SAME production curve as
    // market farmers (so a tile's total food can't exceed its capacity). true = this
    // model; false = the legacy independent-curve subsistence (kept for the reference
    // port-fidelity check only — it lets a tile's food exceed capacity).
    subsistenceShare: true,
    // taxation / crews / garrisons
    tau: 0.15,        // tax rate on city output Y_k -> pool
    wageShare: 2.5,   // public-worker wage as a multiple of avg productivity; with
                      // tau it sets affordable public labor = (tau/wageShare)*N
    mCrew: 0.5,       // crew-workers per road segment
    safeRadius: 3.0,  // segments within this PHYSICAL hex distance of a city need no garrison
    garrisonPerDist: 3.0, // garrison workers per hex of remoteness beyond safeRadius, per segment
    // road construction (incremental, city-pair, auto-routed)
    roadBatchGold: 8.0,   // treasury cost to finish one segment
    roadBatchLabor: 6.0,  // spare-labor cost to finish one segment
    // road decay (gradual K1 -> K0 when unfunded; never worse than K0)
    degrade: 0.2,     // fraction of the (K0-K1) gap closed per unfunded tick
    recover: 0.5,     // fraction of gap recovered per funded tick
    // bandits (optional; off by default) — remote, high-traffic, poorly kept
    // routes get colonized and levy a toll that adds to edge cost.
    bandits: false,
    banditTrafficThresh: 40,  // min food-flow over an edge to attract bandits
    banditDecayThresh: 0.5,   // min decay fraction (unmaintained-ness) to attract
    banditToll: 0.6,          // extra cost/hex a bandit-held edge adds
    banditGrow: 0.08,         // how fast a camp entrenches
    // solver constants (fixed; not user-exposed)
    wIters: 36,
    priceRounds: 40,
    zetaTerms: 200000
  };

  // Collapsed "urbanization" slider -> (alpha, p, Abase), auto-keeping p>alpha.
  // p - alpha = 0.35 for all u (structural anti-runaway margin). More urban =>
  // higher A (bigger cities) and higher p (concentration caps them sooner).
  function deriveUrban(cfg) {
    var u = clamp(cfg.urban, 0, 1);
    var alpha = (cfg.alpha != null) ? cfg.alpha : (1.05 + 0.45 * u);
    var pconc = (cfg.pconc != null) ? cfg.pconc : (1.40 + 0.45 * u);
    var Abase = (cfg.Abase != null) ? cfg.Abase : (34 + 70 * u); // tuned for thousands
    return { alpha: alpha, pconc: pconc, Abase: Abase };
  }

  function zeta(p, terms) {
    var Z = 0;
    for (var j = 1; j <= terms; j++) Z += Math.pow(j, -p);
    return Z;
  }

  // ---- Hex grid & axial math (carried from v1) -----------------------------
  var DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  var SQRT3 = Math.sqrt(3);

  function buildGrid(cols, rows, cells) {
    var hexes = [], axialMap = {};
    for (var rr = 0; rr < rows; rr++) {
      for (var col = 0; col < cols; col++) {
        var q = col - Math.floor(rr / 2);
        var terrain = cells ? cells[rr * cols + col] : 'plains';
        var i = hexes.length;
        var C = TERR[terrain].C;
        hexes.push({
          i: i, q: q, r: rr, col: col,
          cx: SQRT3 * (q + rr / 2), cy: 1.5 * rr,   // unit pixel coords (scaled at draw)
          terrain: terrain, C: C, fishCap: 0, Cfood: C, passable: TERR[terrain].passable,
          isCity: false, A: 0,
          // per-tick state (market & subsistence tracked SEPARATELY — market
          // ships surplus to a city, subsistence self-feeds; stacking them on a
          // single L zeroes the surplus and breaks conservation)
          L: 0,          // display total = Lmkt + Lsubw
          Lmkt: 0,       // actual market farmers (blended toward LmktT)
          Lsubw: 0,      // actual subsistence farmers (blended toward LsubT)
          LmktT: 0,      // market target
          LsubT: 0,      // subsistence target
          Fmkt: 0,       // target market food output
          Lsub: 0,       // subsistence capacity of the hex
          out: 0,        // food surplus shipped this tick (from actual Lmkt)
          basin: -1,     // assigned city index (best netback)
          netback: -Infinity
        });
        axialMap[q + ',' + rr] = i;
      }
    }
    return { hexes: hexes, axialMap: axialMap };
  }

  function neighborsOf(world, i) {
    if (world.adj) return world.adj[i];               // precomputed (hex OR graph maps)
    var h = world.hexes[i], out = [];
    for (var d = 0; d < DIRS.length; d++) {
      var j = world.axialMap[(h.q + DIRS[d][0]) + ',' + (h.r + DIRS[d][1])];
      if (j !== undefined) out.push(j);
    }
    return out;
  }
  // Build the neighbour list once (hex maps): same order neighborsOf produces, so
  // results are bit-identical — this is purely a speed/generality hook.
  function buildAdjacencyHex(world) {
    var adj = new Array(world.hexes.length);
    for (var i = 0; i < world.hexes.length; i++) {
      var h = world.hexes[i], out = [];
      for (var d = 0; d < DIRS.length; d++) {
        var j = world.axialMap[(h.q + DIRS[d][0]) + ',' + (h.r + DIRS[d][1])];
        if (j !== undefined) out.push(j);
      }
      adj[i] = out;
    }
    world.adj = adj;
  }
  function getHex(world, col, row) {
    for (var i = 0; i < world.hexes.length; i++) {
      if (world.hexes[i].col === col && world.hexes[i].r === row) return world.hexes[i];
    }
    return null;
  }
  var edgeKey = function (a, b) { return a < b ? a + '-' + b : b + '-' + a; };
  // physical hex distance (cube metric) between two hexes by axial (q,r)
  function axialDist(h1, h2) {
    var dq = h1.q - h2.q, dr = h1.r - h2.r;
    return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
  }
  // Physical distance between two tiles, in "hops". Hex maps: the axial cube
  // metric (unchanged). Graph maps (planet): great-circle angular distance /
  // median edge length, supplied as world.physDistFn — so garrison remoteness,
  // agglomeration decay and city spacing all keep their hex-tuned units.
  function physDist(world, a, b) {
    if (world.physDistFn) return world.physDistFn(a, b);
    return axialDist(world.hexes[a], world.hexes[b]);
  }
  function strHash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h | 0;
  }
  // deterministic hash -> [0,1) from a seed and two tile ids (order-independent)
  function hash01(seed, a, b) {
    var lo = Math.min(a, b), hi = Math.max(a, b);
    var x = (seed | 0) ^ Math.imul(lo + 1, 0x9E3779B1) ^ Math.imul(hi + 1, 0x85EBCA77);
    x = Math.imul(x ^ (x >>> 15), 0x2C1B3C6D);
    x = Math.imul(x ^ (x >>> 13), 0x297A2D39);
    x ^= x >>> 16;
    return (x >>> 0) / 4294967296;
  }
  // per-edge overland cost factor: lognormal spread so cheapest != closest-by-hops
  function edgeFactorFor(seed, a, b, edgeVar) {
    if (!edgeVar) return 1;
    var u = hash01(seed, a, b);
    // map uniform -> approx standard normal (Box-Muller-ish via two hashes)
    var u2 = hash01(seed ^ 0x5bd1e995, a, b);
    var z = Math.sqrt(-2 * Math.log(u + 1e-9)) * Math.cos(2 * Math.PI * u2);
    return Math.exp(edgeVar * z);
  }

  // ---- Transport (Dijkstra per city; roads discount; decay raises cost) ----
  // Cached; recomputed only when the topology (cities/roads/decay) changes.
  // overland base = K0 * fixed per-edge factor; a road multiplies that base by
  // (roadMult..1) as it decays (never worse than overland); bandits add a toll.
  // Overland base cost of moving a->b (before roads/bandits). Hex maps: symmetric
  // K0 * fixed per-edge lognormal factor. Graph maps (planet): K0 * the map's
  // BAKED, DIRECTIONAL travel cost a->b (moveCost / moveCostR), normalised so a
  // median land hop ~ K0 — i.e. the bi-directional costs baked into the map.
  function baseEdge(world, a, b) {
    if (world.dirCost) return world.cfg.K0 * dirNorm(world, a, b);   // planet: directional
    var key = edgeKey(a, b);
    var f = world.edgeFactor ? (world.edgeFactor[key] || 1) : 1;
    return world.cfg.K0 * f;
  }
  // Directed normalised overland factor a->b for graph maps (0 if not adjacent).
  function dirNorm(world, a, b) {
    var nb = world.adj[a], oc = world.costOut[a];
    for (var k = 0; k < nb.length; k++) if (nb[k] === b) return oc[k];
    return Infinity;
  }
  function edgeCost(world, a, b) {
    var base = baseEdge(world, a, b);
    var rs = world.roadState[edgeKey(a, b)];
    if (!rs) return base;                         // open country
    var mult = world.cfg.roadMult + rs.decay * (1 - world.cfg.roadMult); // roadMult..1
    var cost = base * mult;
    if (rs.banditHold > 0) cost += rs.banditHold * world.cfg.banditToll * base; // toll on top
    return cost;
  }
  // apply the (undirected) road multiplier + bandit toll on a directed base cost.
  function roadAdjust(world, base, key) {
    var rs = world.roadState[key];
    if (!rs) return base;
    var mult = world.cfg.roadMult + rs.decay * (1 - world.cfg.roadMult);
    var cost = base * mult;
    if (rs.banditHold > 0) cost += rs.banditHold * world.cfg.banditToll * base;
    return cost;
  }
  // ---- binary-heap Dijkstra over the tile graph (used for the large planet
  // graph; the hex maps keep their tiny naive scan for bit-identical results).
  // adj[u] = neighbour indices; weight(u, v, k) = directed cost of adj[u][k]
  // (Infinity blocks). Returns the min-cost-to-reach distance from `sources`. --
  function heapDijkstra(n, adj, sources, weight) {
    var dist = new Float64Array(n); dist.fill(Infinity);
    var cap = n + 16, hc = new Float64Array(cap), ht = new Int32Array(cap), hn = 0;
    function grow() { cap *= 2; var nc = new Float64Array(cap), nt = new Int32Array(cap); nc.set(hc); nt.set(ht); hc = nc; ht = nt; }
    function push(c, t) {
      if (hn >= cap) grow();
      hc[hn] = c; ht[hn] = t; var i = hn++;
      while (i > 0) { var p = (i - 1) >> 1; if (hc[p] <= hc[i]) break;
        var tc = hc[p], tt = ht[p]; hc[p] = hc[i]; ht[p] = ht[i]; hc[i] = tc; ht[i] = tt; i = p; }
    }
    function pop() {
      var t = ht[0]; hn--; hc[0] = hc[hn]; ht[0] = ht[hn];
      var i = 0; for (;;) { var l = 2 * i + 1, r = l + 1, s = i;
        if (l < hn && hc[l] < hc[s]) s = l; if (r < hn && hc[r] < hc[s]) s = r; if (s === i) break;
        var tc = hc[s], tt = ht[s]; hc[s] = hc[i]; ht[s] = ht[i]; hc[i] = tc; ht[i] = tt; i = s; }
      return t;
    }
    for (var si = 0; si < sources.length; si++) { var s0 = sources[si]; if (dist[s0] !== 0) { dist[s0] = 0; push(0, s0); } }
    while (hn > 0) {
      var u = pop(), du = dist[u], nb = adj[u];
      for (var k = 0; k < nb.length; k++) {
        var v = nb[k], w = weight(u, v, k);
        if (!(w < Infinity)) continue;
        var nd = du + w;
        if (nd < dist[v]) { dist[v] = nd; push(nd, v); }
      }
    }
    return dist;
  }
  // Sea travel: cost of one open-water hop = Z% of the lowest (fully-built) road
  // cost per hex. Cheaper than roads when seaCostFrac < 1 (coasts trade freely).
  function seaStepCost(world) {
    var cfg = world.cfg;
    return cfg.seaCostFrac * cfg.K0 * cfg.roadMult;
  }
  // Transport edge cost u->v, sea-aware. Land<->land = normal road/overland cost.
  // Water is traversable only when seaTravel is on: water<->water = a sea hop;
  // land<->water only through a HARBOUR (a city tile touching water) at harborCost.
  function transEdge(world, u, v) {
    var cfg = world.cfg, hu = world.hexes[u], hv = world.hexes[v];
    var uSea = hu.terrain === 'water', vSea = hv.terrain === 'water';
    if (!uSea && !vSea) {                                   // land <-> land
      if (!hu.passable || !hv.passable) return Infinity;    // mountains block
      return edgeCost(world, u, v);
    }
    if (!cfg.seaTravel) return Infinity;                    // sea disabled => water blocks
    if (uSea && vSea) return seaStepCost(world);            // open-water hop
    var landIdx = uSea ? v : u;                             // land <-> water: harbour only
    return world.hexes[landIdx].isCity ? cfg.harborCost : Infinity;
  }
  function computeTransport(world) {
    if (world.dirCost) { computeTransportGraph(world); return; }
    var n = world.hexes.length, cfg = world.cfg;
    world.transport = {};
    for (var ci = 0; ci < world.cities.length; ci++) {
      var rep = world.cities[ci];
      var dist = new Float64Array(n); dist.fill(Infinity);
      // MULTI-SOURCE: every tile of the cluster is an origin (dist 0)
      var cl = world.clusterOf ? world.clusterOf[rep] : null;
      var srcs = cl ? cl.tiles : [rep];
      for (var s = 0; s < srcs.length; s++) dist[srcs[s]] = 0;
      var done = new Uint8Array(n);
      for (var it = 0; it < n; it++) {
        var u = -1, best = Infinity;
        for (var k = 0; k < n; k++) if (!done[k] && dist[k] < best) { best = dist[k]; u = k; }
        if (u < 0) break; done[u] = 1;
        // expand land tiles, and (with seaTravel) water tiles too; block mountains
        var hu = world.hexes[u], uSea = hu.terrain === 'water';
        if (!hu.passable && !(cfg.seaTravel && uSea) && dist[u] !== 0) continue;
        var nb = neighborsOf(world, u);
        for (var m = 0; m < nb.length; m++) {
          var v = nb[m];
          var w = transEdge(world, u, v);
          if (!isFinite(w)) continue;
          if (dist[u] + w < dist[v]) dist[v] = dist[u] + w;
        }
      }
      world.transport[rep] = dist;
    }
    world.transportDirty = false;
  }
  // Planet (graph) transport: heap Dijkstra rooted at each city cluster, over the
  // tile graph. Food may cross LAND and WATER (the map's baked edge costs already
  // price sailing) but NOT impassable-land tiles (mountain/glacier) — a mountain
  // range walls off a basin, matching the hex model (transEdge blocks !passable)
  // and the road router (routeBetweenGraph skips impassable). world.transit[i] = 1
  // for passable land OR water, 0 for impassable land. world.transport[rep][tile]
  // is the cost to ship one unit of food FROM tile TO the city, so we charge the
  // TOWARD-CITY direction: relaxing v out from u (u nearer the city), the food
  // travels v->u, cost = baked(v->u) [costIn].
  function computeTransportGraph(world) {
    var n = world.hexes.length, cfg = world.cfg, K0 = cfg.K0;
    var adj = world.adj, costIn = world.costIn, key = world.adjKey, transit = world.transit;
    var weight = function (u, v, k) {
      if (transit && !transit[v]) return Infinity;   // impassable land blocks food transport
      var base = K0 * costIn[u][k];             // baked cost of v->u (toward the city)
      return roadAdjust(world, base, key[u][k]);
    };
    world.transport = {};
    for (var ci = 0; ci < world.cities.length; ci++) {
      var rep = world.cities[ci];
      var cl = world.clusterOf ? world.clusterOf[rep] : null;
      var srcs = cl ? cl.tiles : [rep];
      world.transport[rep] = heapDijkstra(n, adj, srcs, weight);
    }
    world.transportDirty = false;
  }
  // A harbour = a city tile with at least one water neighbour.
  function isHarbor(world, i) {
    if (!world.hexes[i].isCity) return false;
    var nb = neighborsOf(world, i);
    for (var k = 0; k < nb.length; k++) if (world.hexes[nb[k]].terrain === 'water') return true;
    return false;
  }
  // Deterministic per-tile yield multiplier (uniform, ~1 +/- yieldVar). `salt`
  // decorrelates farm yield from fishing yield on the same tile.
  function yieldMul(seed, i, salt, yieldVar) {
    if (!yieldVar) return 1;
    return 1 + yieldVar * (2 * hash01(seed ^ salt, i, i) - 1);
  }
  // (Re)compute a hex's food capacities: farm C (terrain x yield noise) and
  // fishCap (sum over adjacent water tiles of fishPerSea x that sea tile's yield).
  // Cfood = C + fishCap is what all the food machinery (mkt/Lsub/production) uses.
  function computeCapacity(world, i) {
    var cfg = world.cfg, h = world.hexes[i];
    // Base farm capacity: hex maps use the terrain-class table; planet (graph)
    // maps use the map's per-tile `calories` (scaled so a median land tile ~ the
    // hex "farm" tier) supplied as world.capBase.
    var baseC = (world.capBase != null) ? (world.capBase[i] || 0) : TERR[h.terrain].C;
    // siteC = the site's intrinsic land quality (drives city PRODUCTIVITY via
    // siteFactor); unaffected by paving so a city on rich land stays productive.
    h.siteC = baseC > 0 ? baseC * yieldMul(world.seed, i, 0x0f, cfg.yieldVar) : 0;
    // PAVED: once a tile has ever been urban its FARMLAND is gone for good — even if
    // the city later sheds it, it reverts to barren (only fishing may remain). This
    // removes the food-shock incentive to re-pave, killing the farm<->city churn.
    h.C = h.paved ? 0 : h.siteC;
    var fish = 0;    // fishing is available to any passable coastal tile (incl. cities)
    if (world.fishBonus != null) {                 // planet: coastal fish from the map
      fish = h.passable ? (world.fishBonus[i] || 0) : 0;
    } else if (cfg.fishPerSea > 0 && h.passable) {  // hex: synthetic per-sea-neighbour
      var nb = neighborsOf(world, i);
      for (var k = 0; k < nb.length; k++)
        if (world.hexes[nb[k]].terrain === 'water')
          fish += cfg.fishPerSea * yieldMul(world.seed, nb[k], 0xf1, cfg.yieldVar);
    }
    h.fishCap = fish;
    h.Cfood = h.C + fish;
    h.Lsub = Lsub(h.Cfood, cfg.kappa, cfg.c);
  }
  // Food capacity a tile offers to the market/subsistence machinery: a FARM tile
  // = farm C + fishing; a CITY tile = fishing ONLY (urban tiles don't farm, but a
  // coastal one still fishes); impassable = none.
  function foodCapOf(h) {
    if (!h.passable) return 0;
    return h.isCity ? (h.fishCap || 0) : h.Cfood;
  }
  function recomputeCapacities(world) {
    for (var i = 0; i < world.hexes.length; i++) computeCapacity(world, i); // sets C/fishCap/Cfood/Lsub
    world.Ksub = world.hexes.reduce(function (a, h) { return a + h.Lsub; }, 0);
  }

  // ---- Clusters: connected components of urban (isCity) tiles = ONE city ----
  // Each cluster is fed to the equilibrium solver via a representative tile
  // (its densest core); world.cities holds the reps, world.Aof[rep] its
  // agglomerated productivity, world.transport[rep] its multi-source distances.
  function rebuildClusters(world) {
    var hexes = world.hexes, seen = {}, clusters = [];
    for (var i = 0; i < hexes.length; i++) {
      if (!hexes[i].isCity || seen[i]) continue;
      var stack = [i], tiles = []; seen[i] = true;
      while (stack.length) {
        var u = stack.pop(); tiles.push(u);
        var nb = neighborsOf(world, u);
        for (var m = 0; m < nb.length; m++) {
          var v = nb[m];
          if (hexes[v].isCity && !seen[v]) { seen[v] = true; stack.push(v); }
        }
      }
      // rep = densest tile (most urban neighbours), tie-break lowest index
      var rep = tiles[0], repDeg = -1;
      for (var t = 0; t < tiles.length; t++) {
        var deg = 0, nb2 = neighborsOf(world, tiles[t]);
        for (var q = 0; q < nb2.length; q++) if (hexes[nb2[q]].isCity) deg++;
        if (deg > repDeg || (deg === repDeg && tiles[t] < rep)) { repDeg = deg; rep = tiles[t]; }
      }
      clusters.push({ rep: rep, tiles: tiles });
    }
    world.clusters = clusters; world.cities = []; world.Aof = {}; world.clusterOf = {};
    for (var c = 0; c < clusters.length; c++) {
      var cl = clusters[c];
      world.cities.push(cl.rep);
      for (var tt = 0; tt < cl.tiles.length; tt++) hexes[cl.tiles[tt]].clusterRep = cl.rep;
      world.Aof[cl.rep] = clusterA(world, cl);
      world.hexes[cl.rep].A = world.Aof[cl.rep];
      world.clusterOf[cl.rep] = cl;
    }
    world.transportDirty = true;
  }

  // Agglomerated productivity: own extent (within) + nearby other urban mass
  // (across, physical-distance weighted — Q1: connected/near cities boost each other).
  function clusterA(world, cl) {
    var cfg = world.cfg, sc = world.solverConst;
    // pinned productivity (foundCity(...,Aexplicit)) -> no agglomeration (fidelity)
    for (var e = 0; e < cl.tiles.length; e++) {
      if (world.hexes[cl.tiles[e]].explicitA != null) return world.hexes[cl.tiles[e]].explicitA;
    }
    var base = sc.Abase * siteFactor(world, cl.rep);
    var within = cfg.aggloWithin * Math.log(1 + cl.tiles.length - 1);
    var across = 0;
    if (cfg.aggloAcross > 0) {
      for (var c2 = 0; c2 < world.clusters.length; c2++) {
        var other = world.clusters[c2];
        if (other === cl) continue;
        for (var j = 0; j < other.tiles.length; j++) {
          across += Math.exp(-physDist(world, cl.rep, other.tiles[j]) / cfg.aggloScale);
        }
      }
    }
    return base * (1 + within + cfg.aggloAcross * across);
  }

  // Median (percentile phi) nominal wage in a city of productivity A, N workers.
  // = (A/Z)*phi^-p*N^(a-p).  FALLS with N (a-p<0) -> the endogenous size limiter.
  function medianWage(world, A, N) {
    var sc = world.solverConst, cfg = world.cfg;
    return (A / sc.Z) * Math.pow(cfg.flipPercentile, -sc.pconc) * Math.pow(Math.max(1, N), sc.alpha - sc.pconc);
  }
  // A farm tile's REAL gold value per worker (net of the food they eat).
  function farmReal(world, h) {
    var cfg = world.cfg, ret;
    if (h.netback > 0 && h.LmktT > 0.01) ret = h.netback * (h.Fmkt / h.LmktT); // avg product * price
    else if (h.netback > 0) ret = h.netback * (h.Cfood / cfg.kappa);            // MFP at L->0 (farm+fish)
    else ret = cfg.c;                                                           // subsistence-ish
    return ret - cfg.c;
  }
  function localFarmers(world, i, radius) {
    if (world.dirCost) {                 // planet: BFS the hop-ball (avoid O(n) scan/tile)
      var sum0 = 0, seen = {}, frontier = [i], depth = 0, rad = Math.max(1, Math.round(radius));
      seen[i] = true;
      while (frontier.length && depth <= rad) {
        var next = [];
        for (var f = 0; f < frontier.length; f++) {
          var t = frontier[f], ht = world.hexes[t];
          if (!ht.isCity && ht.passable) sum0 += (ht.Lmkt + ht.Lsubw);
          if (depth < rad) { var nbf = world.adj[t];
            for (var m = 0; m < nbf.length; m++) if (!seen[nbf[m]]) { seen[nbf[m]] = true; next.push(nbf[m]); } }
        }
        frontier = next; depth++;
      }
      return sum0;
    }
    var sum = 0, h0 = world.hexes[i];
    for (var j = 0; j < world.hexes.length; j++) {
      var h = world.hexes[j];
      if (h.isCity || !h.passable) continue;
      if (axialDist(h0, h) <= radius) sum += (h.Lmkt + h.Lsubw);
    }
    return sum;
  }

  // ORGANIC URBANIZATION — after the equilibrium solves, tiles flip WHOLESALE
  // between farm and gold-work (flips take effect next tick => one-tick lag,
  // stable). The decision uses the city's MEDIAN wage, not the marginal wage
  // (pinned at w) nor aggregate output (O(millions)): median is O(1), comparable
  // to a farmer's per-head value, and FALLS as the city grows, so city extent
  // self-limits where median stops beating the surrounding farmland's value.
  function updateUrbanization(world, eq) {
    var cfg = world.cfg, hexes = world.hexes;
    if (!world.flipTick) world.flipTick = {};
    if (!world.flipDir) world.flipDir = {};   // last flip direction per tile (+1 urban, -1 farm)
    if (!world.clMma) world.clMma = {};       // per-cluster EMA of the median-wage signal
    if (!world.growTick) world.growTick = {}; // last tick each cluster (by rep) added a tile
    // COOLED: no flip of any kind within flipCooldown ticks (anti-flicker).
    var cooled = function (i) { return (world.tick - (world.flipTick[i] || -1e9)) >= cfg.flipCooldown; };
    // CANFLIP: also forbids reversing the last flip within reversalCooldown ticks,
    // so a tile is effectively one-directional over the settling horizon (the core
    // anti-oscillation guarantee — a tile grows OR shrinks, never ping-pongs).
    var canFlip = function (i, toUrban) {
      if (!cooled(i)) return false;
      var last = world.flipDir[i];
      if (last === undefined) return true;
      var want = toUrban ? 1 : -1;
      if (want === -last && (world.tick - (world.flipTick[i] || -1e9)) < cfg.reversalCooldown) return false;
      return true;
    };
    var passable = 0, urban = 0;
    for (var a = 0; a < hexes.length; a++) if (hexes[a].passable) { passable++; if (hexes[a].isCity) urban++; }
    var cap = cfg.maxUrbanFrac * passable;

    // median real wage (attractiveness) per cluster, EMA-SMOOTHED over ticks so a
    // single discrete flip's food shock can't drive the reverse flip next tick.
    var clM = {};
    for (var c = 0; c < world.clusters.length; c++) {
      var rep = world.clusters[c].rep;
      var cur = medianWage(world, world.Aof[rep], world.cityN[rep] || 0) - (world.prices[rep] || 1) * cfg.c;
      var prev = world.clMma[rep];
      var sm = (prev === undefined) ? cur : (prev + cfg.clSmooth * (cur - prev));
      world.clMma[rep] = sm; clM[rep] = sm;
    }

    // Gather ALL candidate flips with a priority, then apply at most flipsPerTick
    // of them (most urgent first). Growing/new cores rank above shrinks. Applying
    // one structural change at a time lets the fast equilibrium settle between
    // changes — this is what stops the churn limit cycle.
    var cands = [];  // {i, urban:bool, pri}

    // GROW: a crowded city paves ONE adjacent farm tile, chosen to be COMPACT-BUT-
    // IRREGULAR: score = compactBias·(urban neighbours) − (farm value / median) +
    // growJitter·hash. Compactness fills the blob in; the value term spares prime
    // farmland (irregular, terrain-following); the hash breaks ties organically.
    if (urban < cap) {
      for (var c2 = 0; c2 < world.clusters.length; c2++) {
        var cl2 = world.clusters[c2], M = clM[cl2.rep], repH = hexes[cl2.rep];
        var density = (world.cityN[cl2.rep] || 0) / cl2.tiles.length;
        if (density < cfg.urbanDensityTarget) continue;
        if ((world.tick - (world.growTick[cl2.rep] || -1e9)) < cfg.growInterval) continue; // let each new tile settle

        // Ring-fill backstop: per-radius (from the core) counts of urban tiles and
        // "claimable" tiles (this city's urban + farm on its frontier). A ring-N
        // tile is blocked until ring N-1 is >ringFillFrac filled — kills fingers.
        var ringU = {}, ringC = {};
        if (cfg.ringGate) {
          for (var z = 0; z < hexes.length; z++) {
            var hz = hexes[z]; if (!hz.passable) continue;
            var isThis = hz.isCity && hz.clusterRep === cl2.rep, claim = isThis;
            if (!claim && !hz.isCity) {
              var nbz = neighborsOf(world, z);
              for (var zz = 0; zz < nbz.length; zz++)
                if (hexes[nbz[zz]].isCity && hexes[nbz[zz]].clusterRep === cl2.rep) { claim = true; break; }
            }
            if (!claim) continue;
            var dd = Math.round(physDist(world, z, cl2.rep));   // integer ring (== axial for hex)
            ringC[dd] = (ringC[dd] || 0) + 1;
            if (isThis) ringU[dd] = (ringU[dd] || 0) + 1;
          }
        }

        var best = -1, bestScore = -Infinity, seen = {};
        for (var t = 0; t < cl2.tiles.length; t++) {
          var nb = neighborsOf(world, cl2.tiles[t]);
          for (var m = 0; m < nb.length; m++) {
            var v = nb[m];
            if (hexes[v].isCity || !hexes[v].passable || seen[v] || !canFlip(v, true)) continue; seen[v] = true;
            var fr = farmReal(world, hexes[v]);
            if (M <= fr * (1 + cfg.flipHyst)) continue;            // economic gate
            if (cfg.ringGate) {                                     // ring gate
              var N = Math.round(physDist(world, v, cl2.rep));
              if (N >= 2) { var den = ringC[N - 1] || 0; if (den > 0 && (ringU[N - 1] || 0) / den < cfg.ringFillFrac) continue; }
            }
            var nUrban = 0, nbv = neighborsOf(world, v);
            for (var kk = 0; kk < nbv.length; kk++) if (hexes[nbv[kk]].isCity) nUrban++;
            var score = cfg.compactBias * nUrban - fr / Math.max(M, 1e-9)
                      + cfg.growJitter * hash01(world.seed, cl2.rep, v);
            if (score > bestScore) { bestScore = score; best = v; }
          }
        }
        if (best >= 0) cands.push({ i: best, urban: true, pri: 1000 + (density / cfg.urbanDensityTarget - 1), rep: cl2.rep });
      }
    }

    // NEW CORES: market town in a food-rich area far from any city. Coastal sites
    // (a harbour tile beside the sea) are favoured — a port trades cheaply by water,
    // so towns historically cluster on coasts. The site's local farmer mass is the
    // base draw; a tile touching water gets a coastalCoreBonus multiplier on top.
    if (urban < cap) {
      var bestCore = -1, bestPot = cfg.newCoreMinFarmers;
      for (var i = 0; i < hexes.length; i++) {
        var h = hexes[i]; if (!h.passable || h.isCity || !canFlip(i, true)) continue;
        var dCity = Infinity;
        for (var r = 0; r < world.cities.length; r++) dCity = Math.min(dCity, physDist(world, i, world.cities[r]));
        if (dCity < cfg.newCoreMinDist) continue;
        var pot = localFarmers(world, i, 2);
        if (cfg.seaTravel && cfg.coastalCoreBonus > 0) {
          var coastal = false, nbh = neighborsOf(world, i);
          for (var w2 = 0; w2 < nbh.length; w2++) if (hexes[nbh[w2]].terrain === 'water') { coastal = true; break; }
          if (coastal) pot *= (1 + cfg.coastalCoreBonus);
        }
        if (pot > bestPot) { bestPot = pot; bestCore = i; }
      }
      if (bestCore >= 0) cands.push({ i: bestCore, urban: true, pri: 500 });
    }

    // SHRINK: too-sparse or unprofitable fringe tile reverts (lowest priority)
    for (var c3 = 0; c3 < world.clusters.length; c3++) {
      var cl3 = world.clusters[c3]; if (cl3.tiles.length <= 1) continue;
      var M3 = clM[cl3.rep];
      var dens3 = (world.cityN[cl3.rep] || 0) / cl3.tiles.length;
      var worst = -1, worstDeg = 99;
      for (var t3 = 0; t3 < cl3.tiles.length; t3++) {
        var ti = cl3.tiles[t3]; if (hexes[ti].seed || !canFlip(ti, false)) continue;
        var nb3 = neighborsOf(world, ti), deg = 0;
        for (var q = 0; q < nb3.length; q++) if (hexes[nb3[q]].isCity) deg++;
        if (deg < worstDeg) { worstDeg = deg; worst = ti; }
      }
      if (worst >= 0 && (dens3 < cfg.urbanDensityTarget * cfg.shrinkRatio ||
                         M3 < farmReal(world, hexes[worst]) * (1 - cfg.flipHyst))) {
        cands.push({ i: worst, urban: false, pri: dens3 < cfg.urbanDensityTarget * cfg.shrinkRatio ? 100 : 10 });
      }
    }

    cands.sort(function (x, y) { return y.pri - x.pri; });
    var applied = 0, changed = false, pavedKsub = false;
    for (var k = 0; k < cands.length && applied < cfg.flipsPerTick; k++) {
      var fl = cands[k];
      if (!canFlip(fl.i, fl.urban)) continue;
      hexes[fl.i].isCity = fl.urban;
      if (fl.urban && !hexes[fl.i].paved) { hexes[fl.i].paved = true; computeCapacity(world, fl.i); pavedKsub = true; } // farmland gone for good
      if (!fl.urban) { delete world.prices[fl.i]; hexes[fl.i].Lmkt = 0; hexes[fl.i].Lsubw = 0; }
      world.flipTick[fl.i] = world.tick;
      world.flipDir[fl.i] = fl.urban ? 1 : -1;
      if (fl.urban && fl.rep != null) world.growTick[fl.rep] = world.tick;
      applied++; changed = true;
    }
    if (pavedKsub) world.Ksub = world.hexes.reduce(function (a, h) { return a + h.Lsub; }, 0);
    if (changed) rebuildClusters(world);
    return changed;
  }

  // ---- Subsistence capacity per hex: L where F(L)=L*c -----------------------
  function Lsub(C, kappa, c) {
    if (C <= kappa * c) return 0;
    var lo = 0, hi = 50 * kappa / 4; // scale bracket with kappa
    for (var i = 0; i < 60; i++) {
      var L = 0.5 * (lo + hi);
      if (C * (1 - Math.exp(-L / kappa)) > L * c) lo = L; else hi = L;
    }
    return 0.5 * (lo + hi);
  }
  // RESIDUAL subsistence capacity on a tile already worked by Lmkt market farmers.
  // Subsistence is DESPERATION farming: idle people pile onto land they can reach and
  // work it (on the SAME production curve, no separate self-feeding bucket) until the
  // marginal worker's net food is zero. Since F starting at Lmkt is a fresh diminishing
  // curve of effective capacity A = C*exp(-Lmkt/kappa), that break-even extent is just
  // Lsub(A). This shares the land with market labour (so total food never exceeds
  // capacity — no double count) and self-limits where the land can't feed another mouth.
  function residualSub(C, Lmkt, kappa, c) {
    if (C <= 0) return 0;
    return Lsub(C * Math.exp(-Lmkt / kappa), kappa, c);
  }
  // Subsistence room a tile still offers given its market labour, under the active
  // model (shared-curve break-even, or the legacy independent Lsub − Lmkt).
  function subRoomTile(world, h, Lmkt) {
    var cfg = world.cfg;
    return cfg.subsistenceShare ? residualSub(h.Cfood, Lmkt, cfg.kappa, cfg.c)
                                : Math.max(0, h.Lsub - Lmkt);
  }

  // ============================================================================
  //  EQUILIBRIUM SOLVER  (ported verbatim in spirit from hex_economy_v2_core.js)
  // ============================================================================
  // Market farming on hex with capacity C, netback nb, wage w.
  function mkt(C, nb, w, kappa, c) {
    if (nb <= 0) return { L: 0, F: 0 };
    var E = (c + w / nb) * kappa / C;
    if (E >= 1) return { L: 0, F: 0 };
    return { L: -kappa * Math.log(E), F: C * (1 - E) };
  }
  // City workforce at "total reservation" T = w + P*c :  y_margin(N)=T.
  function NofCity(A, T, Z, alpha, pconc) {
    if (T <= 0) return 1e12;
    return Math.pow(T * Z / A, 1 / (alpha - pconc));
  }

  // Inner: per-city price bisection to clear each city food market.
  // crewFood[k] (>=0) adds crew/garrison mouths stationed at city k.
  function innerP(world, w, Pprev, crewFood) {
    var cfg = world.cfg, S = world.solverConst;
    var cities = world.cities, hexes = world.hexes;
    var P = {}, lo = {}, hi = {};
    for (var a = 0; a < cities.length; a++) {
      var k = cities[a];
      P[k] = (Pprev && Pprev[k] != null) ? Pprev[k] : 1;
      lo[k] = 0.001; hi[k] = 600;
    }
    for (var rd = 0; rd < cfg.priceRounds; rd++) {
      var sup = {};
      for (var b = 0; b < cities.length; b++) sup[cities[b]] = 0;
      for (var hi2 = 0; hi2 < hexes.length; hi2++) {
        var h = hexes[hi2];
        var cap = foodCapOf(h); if (cap <= 0) continue;  // farm=farm+fish, coastal city=fish
        var bestv = -Infinity, bk = -1;
        for (var ci = 0; ci < cities.length; ci++) {
          var kk = cities[ci];
          var t = world.transport[kk] ? world.transport[kk][h.i] : Infinity;
          if (!isFinite(t)) continue;
          var v = P[kk] - t;
          if (v > bestv) { bestv = v; bk = kk; }
        }
        if (bestv > 0 && bk >= 0) {
          var f = mkt(cap, bestv, w, cfg.kappa, cfg.c);
          sup[bk] += Math.max(0, f.F - f.L * cfg.c);
        }
      }
      for (var ci2 = 0; ci2 < cities.length; ci2++) {
        var key = cities[ci2];
        var extra = crewFood ? (crewFood[key] || 0) : 0;
        var dem = cfg.c * (NofCity(world.Aof[key], w + P[key] * cfg.c, S.Z, S.alpha, S.pconc) + extra);
        if (dem - sup[key] > 0) lo[key] = P[key]; else hi[key] = P[key];
        P[key] = 0.5 * (lo[key] + hi[key]);
      }
    }
    return P;
  }

  // Formal labor demand (market farmers + city workers) at wage w.
  function formal(world, w, Pprev, crewFood) {
    var cfg = world.cfg, S = world.solverConst;
    var P = innerP(world, w, Pprev, crewFood);
    var Lm = 0, Nc = 0, hexes = world.hexes;
    var mktL = new Float64Array(hexes.length);
    for (var i = 0; i < hexes.length; i++) {
      var h = hexes[i];
      var cap = foodCapOf(h); if (cap <= 0) continue;   // farm+fish, or coastal-city fishing
      var best = -Infinity;
      for (var ci = 0; ci < world.cities.length; ci++) {
        var kk = world.cities[ci];
        var t = world.transport[kk] ? world.transport[kk][h.i] : Infinity;
        if (isFinite(t)) best = Math.max(best, P[kk] - t);
      }
      if (best > 0) { var f = mkt(cap, best, w, cfg.kappa, cfg.c); Lm += f.L; mktL[h.i] = f.L; }
    }
    for (var c2 = 0; c2 < world.cities.length; c2++) {
      var key = world.cities[c2];
      Nc += NofCity(world.Aof[key], w + P[key] * cfg.c, S.Z, S.alpha, S.pconc);
    }
    return { P: P, Lm: Lm, Nc: Nc, formal: Lm + Nc, mktL: mktL };
  }

  // Solve for equilibrium given pool Npool and mouths committed to roads.
  // Returns targets {w, P, Lm, Nc, mktL, subs, room, byCityN}.
  function solveEquilibrium(world, Npool, Pprev, crewFood) {
    var cfg = world.cfg, S = world.solverConst;
    if (world.cities.length === 0) {
      // no cities: everyone subsists on viable land (no market labour yet -> full Lsub)
      var subRoom0 = 0;
      for (var i = 0; i < world.hexes.length; i++) if (!world.hexes[i].isCity) subRoom0 += world.hexes[i].Lsub;
      return { w: 0, P: {}, Lm: 0, Nc: 0, mktL: new Float64Array(world.hexes.length),
               subs: Math.min(Npool, subRoom0), room: Math.max(0, subRoom0 - Npool), byCityN: {} };
    }
    var f0 = formal(world, 1e-5, Pprev, crewFood);
    var out;
    if (f0.formal >= Npool) {
      var wlo = 1e-5, whi = 200, P = Pprev;
      for (var it = 0; it < cfg.wIters; it++) {
        var wm = 0.5 * (wlo + whi);
        var f = formal(world, wm, P, crewFood); P = f.P;
        if (f.formal > Npool) wlo = wm; else whi = wm;
        out = { w: wm, P: f.P, Lm: f.Lm, Nc: f.Nc, mktL: f.mktL };
      }
      out.subs = 0; out.room = 0;
    } else {
      var residual = Npool - f0.formal, subRoom = 0;
      for (var j = 0; j < world.hexes.length; j++) {
        var h = world.hexes[j];
        if (!h.isCity) subRoom += subRoomTile(world, h, f0.mktL[h.i]);
      }
      out = { w: 0, P: f0.P, Lm: f0.Lm, Nc: f0.Nc, mktL: f0.mktL,
              subs: Math.min(residual, subRoom), room: Math.max(0, subRoom - residual) };
    }
    // per-city workforce at the solved prices
    out.byCityN = {};
    for (var c3 = 0; c3 < world.cities.length; c3++) {
      var key = world.cities[c3];
      out.byCityN[key] = NofCity(world.Aof[key], out.w + out.P[key] * cfg.c, S.Z, S.alpha, S.pconc);
    }
    return out;
  }

  // ============================================================================
  //  WORLD CONSTRUCTION
  // ============================================================================
  // Build the geometry + per-tile state of a PLANET (graph) world from an adapted
  // plangen-game-map (see game_map_adapter.js). Sets everything buildGrid sets for
  // the hex path, plus the graph-transport hooks (adj/costIn/costOut/adjKey), the
  // calories capacity override (capBase/fishBonus) and the great-circle physDist.
  function buildGraphWorld(world, spec) {
    var G = spec.graph, n = G.n, hexes = new Array(n);
    for (var i = 0; i < n; i++) {
      var isW = !!(G.water && G.water[i]), pass = !!G.passable[i];
      // pseudo-terrain so the water/impassable checks scattered through the engine
      // keep working; real per-tile capacity comes from capBase, name from terrainName.
      var terr = isW ? 'water' : (pass ? 'plains' : 'mountain');
      hexes[i] = {
        i: i, q: 0, r: 0, col: 0, cx: 0, cy: 0,
        terrain: terr, terrainName: G.terrainName ? G.terrainName[i] : terr,
        C: 0, fishCap: 0, Cfood: 0, passable: pass,
        isCity: false, A: 0,
        L: 0, Lmkt: 0, Lsubw: 0, LmktT: 0, LsubT: 0, Fmkt: 0, Lsub: 0,
        out: 0, basin: -1, netback: -Infinity
      };
    }
    world.hexes = hexes;
    world.adj = G.adj;
    world.costOut = G.costOut;   // normalised baked cost u -> adj[u][k]  (K0 applied at use)
    world.costIn = G.costIn;     // normalised baked cost adj[u][k] -> u
    // transit[i] = 1 if food transport may pass through tile i (passable land OR
    // water/sea lane), 0 for impassable land (mountain/glacier — a barrier).
    var transit = new Uint8Array(n);
    for (var ti = 0; ti < n; ti++) transit[ti] = (hexes[ti].passable || (G.water && G.water[ti])) ? 1 : 0;
    world.transit = transit;
    world.capBase = G.capBase;   // calories-derived farm capacity per tile
    world.fishBonus = G.fishBonus; // coastal fishing capacity per tile
    world.dirCost = true;        // marks a directional/graph world
    world.minerals = G.minerals || null; // inert (displayed, not simulated)
    world.polys = G.polys || null;        // lon/lat rings for rendering
    world.coords = G.coords || null;
    // precompute edgeKey per adjacency slot (road lookups in the hot Dijkstra loop)
    var adjKey = new Array(n);
    for (var u = 0; u < n; u++) {
      var nb = G.adj[u], row = new Array(nb.length);
      for (var k = 0; k < nb.length; k++) row[k] = edgeKey(u, nb[k]);
      adjKey[u] = row;
    }
    world.adjKey = adjKey;
    // great-circle distance / median edge length -> "hops" (same units as axial)
    var coords = G.coords, hopLen = G.hopLen || 1;
    world.physDistFn = function (a, b) {
      var la = coords[a * 2], lo = coords[a * 2 + 1], lb = coords[b * 2], lob = coords[b * 2 + 1];
      var cc = Math.sin(la) * Math.sin(lb) + Math.cos(la) * Math.cos(lb) * Math.cos(lo - lob);
      if (cc > 1) cc = 1; else if (cc < -1) cc = -1;
      return Math.acos(cc) / hopLen;
    };
  }

  // spec: hex  -> { cols, rows, cells:[terrain...], cities:[{col,row,A?}], config }
  //       graph-> { graph:{...}, cities:[tileIndex | {i,A}], config } (planet map)
  function createWorld(spec) {
    var cfg = {};
    for (var k in DEFAULTS) cfg[k] = DEFAULTS[k];
    if (spec.config) for (var k2 in spec.config) cfg[k2] = spec.config[k2];

    var world = {
      cfg: cfg,
      cities: [], Aof: {},
      roads: {},         // edgeKey -> true (a built segment exists)
      roadState: {},     // edgeKey -> { cost, decay(0..1), banditHold(0..1) }
      projects: [],      // incremental road projects
      transport: {}, transportDirty: true,
      N: cfg.N0,
      prices: {},
      treasury: 0, taxPool: 0,
      tick: 0,
      history: [],
      metrics: null
    };

    if (spec.graph) {
      buildGraphWorld(world, spec);
    } else {
      var g = buildGrid(spec.cols, spec.rows, spec.cells);
      world.cols = spec.cols; world.rows = spec.rows;
      world.hexes = g.hexes; world.axialMap = g.axialMap;
      buildAdjacencyHex(world);   // precompute adj (bit-identical to neighborsOf)
    }

    // urbanization-derived constants + zeta (compute once)
    var du = deriveUrban(cfg);
    world.solverConst = {
      alpha: du.alpha, pconc: du.pconc, Abase: du.Abase,
      Z: zeta(du.pconc, cfg.zetaTerms)
    };

    // seed first (capacity noise + fishing yields are keyed off it)
    world.seed = (spec.seed != null) ? (spec.seed | 0) : strHash(spec.name || 'map');

    // per-tile food capacities (farm C x yield noise + fishing) + subsistence
    recomputeCapacities(world);

    // fixed per-edge overland cost factors (hex maps only; planet uses baked costs)
    if (!world.dirCost) {
      world.edgeFactor = {};
      for (var hi = 0; hi < world.hexes.length; hi++) {
        if (!world.hexes[hi].passable) continue;
        var nb = neighborsOf(world, hi);
        for (var m = 0; m < nb.length; m++) {
          var j = nb[m];
          if (!world.hexes[j].passable || j < hi) continue;
          world.edgeFactor[edgeKey(hi, j)] = edgeFactorFor(world.seed, hi, j, cfg.edgeVar);
        }
      }
    }

    // seed cities
    world.clusters = []; world.clusterOf = {};
    if (spec.cities) {
      for (var ci = 0; ci < spec.cities.length; ci++) {
        var cs = spec.cities[ci];
        if (spec.graph) {
          var idx = (typeof cs === 'number') ? cs : cs.i;
          if (world.hexes[idx] && world.hexes[idx].passable) foundCity(world, idx, cs.A);
        } else {
          var h = getHex(world, cs.col, cs.row);
          if (h && h.passable) foundCity(world, h.i, cs.A);
        }
      }
    }
    rebuildClusters(world);
    computeTransport(world);
    return world;
  }

  // ---- Actions (used by the player UI and by strategy agents) --------------
  function siteFactor(world, i) {
    // local land quality around a site -> per-city productivity multiplier. Uses the
    // INTRINSIC site quality (siteC), not the paved-over farm capacity, so a city on
    // rich land stays as productive after it paves the ground as before.
    var h = world.hexes[i], cap = (h.siteC != null ? h.siteC : h.C), n = 1;
    var nb = neighborsOf(world, i);
    for (var m = 0; m < nb.length; m++) { var g = world.hexes[nb[m]]; cap += (g.siteC != null ? g.siteC : g.C); n++; }
    return 0.5 + 0.9 * (cap / (n * TERR.rich.C)); // ~0.5..1.4
  }
  function foundCity(world, i, Aexplicit) {
    var h = world.hexes[i];
    if (!h || !h.passable || h.isCity) return false;
    var firstCity = !world.cities || world.cities.length === 0;
    h.isCity = true; h.seed = true;
    if (!h.paved) { h.paved = true; computeCapacity(world, i); world.Ksub = world.hexes.reduce(function (a, hh) { return a + hh.Lsub; }, 0); }  // urbanised land: farmland gone for good
    if (Aexplicit != null) h.explicitA = Aexplicit;   // pin productivity (fidelity tests)
    if (world.prices[i] == null) world.prices[i] = 1.0;
    // Population is never created ex nihilo: only the FIRST city bootstraps the
    // world with cityFoundPop settlers. Every later city (player-placed OR an
    // emergent organic core) draws its people from the existing pool via migration.
    if (firstCity && Aexplicit == null && world.cfg.cityFoundPop > 0) world.N += world.cfg.cityFoundPop;
    rebuildClusters(world);
    return true;
  }
  function removeCity(world, i) {
    var h = world.hexes[i];
    if (!h || !h.isCity) return false;
    h.isCity = false; h.seed = false; h.explicitA = null; h.A = 0; delete world.prices[i];
    world.projects = world.projects.filter(function (pr) { return pr.a !== i && pr.b !== i; });
    rebuildClusters(world);
    return true;
  }
  function paintTerrain(world, i, terrain) {
    var h = world.hexes[i];
    if (!h) return;
    h.terrain = terrain; h.passable = TERR[terrain].passable;
    if (!h.passable && h.isCity) removeCity(world, i);
    // recompute food capacities for this tile AND its neighbours (a tile's fishing
    // bonus depends on adjacent water, so painting water/land shifts the neighbours)
    computeCapacity(world, i);
    var nb = neighborsOf(world, i);
    for (var k = 0; k < nb.length; k++) computeCapacity(world, nb[k]);
    h.Lsub = Lsub(h.Cfood, world.cfg.kappa, world.cfg.c);
    for (var k2 = 0; k2 < nb.length; k2++) world.hexes[nb[k2]].Lsub = Lsub(world.hexes[nb[k2]].Cfood, world.cfg.kappa, world.cfg.c);
    world.Ksub = world.hexes.reduce(function (a, hh) { return a + hh.Lsub; }, 0);
    world.transportDirty = true;
  }
  function setTax(world, tau) { world.cfg.tau = clamp(tau, 0, 0.6); }

  // Recompute all config-derived state after a live knob change (urban->A/alpha/
  // p/zeta, kappa/c->Lsub/Ksub, city productivity, transport). Used by the UI.
  function reconfigure(world) {
    var cfg = world.cfg;
    var du = deriveUrban(cfg);
    world.solverConst = { alpha: du.alpha, pconc: du.pconc, Abase: du.Abase, Z: zeta(du.pconc, cfg.zetaTerms) };
    recomputeCapacities(world);  // farm noise + fishing (fishPerSea/yieldVar may have changed) -> Lsub/Ksub
    rebuildClusters(world);   // recompute agglomerated productivity per cluster
    // per-edge overland factors (edgeVar may have changed) — hex maps only; the
    // planet keeps its baked directional costs (K0 is applied live at use).
    if (!world.dirCost) {
      world.edgeFactor = {};
      for (var hi = 0; hi < world.hexes.length; hi++) {
        if (!world.hexes[hi].passable) continue;
        var nb = neighborsOf(world, hi);
        for (var m = 0; m < nb.length; m++) {
          var j = nb[m];
          if (!world.hexes[j].passable || j < hi) continue;
          world.edgeFactor[edgeKey(hi, j)] = edgeFactorFor(world.seed, hi, j, cfg.edgeVar);
        }
      }
    }
    world.transportDirty = true;
  }

  // Auto-route the cheapest OVERLAND path between two cities (ignores existing
  // roads so the project has something to improve), returns list of hex edges.
  function routeBetween(world, a, b) {
    if (world.dirCost) return routeBetweenGraph(world, a, b);
    var n = world.hexes.length;
    var dist = new Float64Array(n); dist.fill(Infinity); dist[a] = 0;
    var prev = new Int32Array(n); prev.fill(-1);
    var done = new Uint8Array(n);
    for (var it = 0; it < n; it++) {
      var u = -1, best = Infinity;
      for (var k = 0; k < n; k++) if (!done[k] && dist[k] < best) { best = dist[k]; u = k; }
      if (u < 0) break; done[u] = 1;
      if (u === b) break;
      if (!world.hexes[u].passable && u !== a) continue;
      var nb = neighborsOf(world, u);
      for (var m = 0; m < nb.length; m++) {
        var v = nb[m];
        if (!world.hexes[v].passable) continue;
        var w = baseEdge(world, u, v); // route over open-country (per-edge) cost
        if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = u; }
      }
    }
    if (prev[b] < 0 && a !== b) return null;
    var edges = [], cur = b;
    while (cur !== a && cur >= 0) { var p = prev[cur]; if (p < 0) break; edges.push([p, cur]); cur = p; }
    edges.reverse();
    return edges;
  }
  // Planet roads are LAND infrastructure: a heap-Dijkstra cheapest land path a->b
  // over the baked outbound costs, ignoring existing roads (so the project has
  // something to improve). Returns null if no land route exists (e.g. across an
  // ocean — sea trade is handled by transport, not roads).
  function routeBetweenGraph(world, a, b) {
    var n = world.hexes.length, K0 = world.cfg.K0, adj = world.adj, costOut = world.costOut;
    var dist = new Float64Array(n); dist.fill(Infinity); dist[a] = 0;
    var prev = new Int32Array(n); prev.fill(-1);
    var cap = 64, hc = new Float64Array(cap), ht = new Int32Array(cap), hn = 0;
    function grow() { cap *= 2; var nc = new Float64Array(cap), nt = new Int32Array(cap); nc.set(hc); nt.set(ht); hc = nc; ht = nt; }
    function push(c, t) { if (hn >= cap) grow(); hc[hn] = c; ht[hn] = t; var i = hn++;
      while (i > 0) { var p = (i - 1) >> 1; if (hc[p] <= hc[i]) break; var tc = hc[p], tt = ht[p]; hc[p] = hc[i]; ht[p] = ht[i]; hc[i] = tc; ht[i] = tt; i = p; } }
    function pop() { var t = ht[0]; hn--; hc[0] = hc[hn]; ht[0] = ht[hn]; var i = 0;
      for (;;) { var l = 2 * i + 1, r = l + 1, s = i; if (l < hn && hc[l] < hc[s]) s = l; if (r < hn && hc[r] < hc[s]) s = r; if (s === i) break;
        var tc = hc[s], tt = ht[s]; hc[s] = hc[i]; ht[s] = ht[i]; hc[i] = tc; ht[i] = tt; i = s; } return t; }
    push(0, a);
    while (hn > 0) {
      var u = pop(); if (u === b) break;
      if (!world.hexes[u].passable && u !== a) continue;    // roads only cross land
      var nb = adj[u], du = dist[u];
      for (var k = 0; k < nb.length; k++) {
        var v = nb[k]; if (!world.hexes[v].passable) continue;
        var nd = du + K0 * costOut[u][k];
        if (nd < dist[v]) { dist[v] = nd; prev[v] = u; push(nd, v); }
      }
    }
    if (prev[b] < 0 && a !== b) return null;
    var edges = [], cur = b;
    while (cur !== a && cur >= 0) { var p = prev[cur]; if (p < 0) break; edges.push([p, cur]); cur = p; }
    edges.reverse();
    return edges;
  }
  function startRoadProject(world, a, b) {
    if (!world.hexes[a] || !world.hexes[b] || !world.hexes[a].isCity || !world.hexes[b].isCity) return false;
    // dedupe
    for (var i = 0; i < world.projects.length; i++) {
      var pr = world.projects[i];
      if ((pr.a === a && pr.b === b) || (pr.a === b && pr.b === a)) return false;
    }
    var edges = routeBetween(world, a, b);
    if (!edges || edges.length === 0) return false;
    world.projects.push({ a: a, b: b, edges: edges, built: 0, stalled: false });
    return true;
  }

  // ============================================================================
  //  STEP  (one tick)
  // ============================================================================
  function step(world) {
    var cfg = world.cfg, hexes = world.hexes;
    if (world.transportDirty) computeTransport(world);

    // ---- crews & garrisons demanded by the current road network ----
    // Each built segment needs mCrew crews stationed at the nearest city (by
    // transport). Segments PHYSICALLY remote from any city (axial hex distance >
    // safeRadius) also need garrison soldiers scaling with that remoteness.
    // Remoteness uses PHYSICAL distance, not transport — building the road must
    // not erase the frontier exposure that demands the garrison.
    var crewDemand = 0, crewFood = {}, segNearestCity = {}, segDemand = {};
    for (var ci = 0; ci < world.cities.length; ci++) crewFood[world.cities[ci]] = 0;
    var segList = Object.keys(world.roads);
    for (var s = 0; s < segList.length; s++) {
      var key = segList[s];
      var parts = key.split('-'); var ea = +parts[0], eb = +parts[1];
      var nearest = -1, ndT = Infinity, physD = Infinity;
      for (var c2 = 0; c2 < world.cities.length; c2++) {
        var kk = world.cities[c2];
        var dT = Math.min(world.transport[kk] ? world.transport[kk][ea] : Infinity,
                          world.transport[kk] ? world.transport[kk][eb] : Infinity);
        if (dT < ndT) { ndT = dT; nearest = kk; }
        var dP = Math.min(physDist(world, ea, kk),
                          physDist(world, eb, kk));
        if (dP < physD) physD = dP;
      }
      segNearestCity[key] = nearest;
      var need = cfg.mCrew;
      if (isFinite(physD) && physD > cfg.safeRadius) need += cfg.garrisonPerDist * (physD - cfg.safeRadius);
      segDemand[key] = need;
      crewDemand += need;
      if (nearest >= 0) crewFood[nearest] += need; // mouths that eat at that city IF funded
    }

    // ---- fund crews/garrisons: the tax rate DIRECTS labor to public works ----
    // Affordable public workers = (tau / wageShare) * N. Scale-free: aggregate
    // output cancels, so the binding constraint is labor the tax can staff, not
    // raw gold (which is superabundant once cities are large). Overreach = the
    // road network demands more crew+garrison than the tax rate can fund.
    var affordablePublic = (cfg.wageShare > 0) ? (cfg.tau / cfg.wageShare) * world.N : world.N;
    var crewsEmployed = Math.min(crewDemand, Math.max(0, affordablePublic));
    var fundedFrac = crewDemand > 0 ? crewsEmployed / crewDemand : 1;
    // only funded crews actually eat; scale each city's crew-mouths by fundedFrac
    for (var cf in crewFood) crewFood[cf] *= fundedFrac;

    // ---- harbour labour: each coastal urban tile auto-commits harborWorkers -----
    // Automatic (not tax-gated): they are added to their city's food mouths at
    // full strength and drawn from the pool. This is the cost of running a port.
    var harborTotal = 0, harborTiles = 0;
    if (cfg.seaTravel && cfg.harborWorkers > 0) {
      for (var hb = 0; hb < hexes.length; hb++) {
        if (!hexes[hb].isCity || !isHarbor(world, hb)) continue;
        var hrep = hexes[hb].clusterRep != null ? hexes[hb].clusterRep : hb;
        crewFood[hrep] = (crewFood[hrep] || 0) + cfg.harborWorkers; // eats at that city
        harborTotal += cfg.harborWorkers; harborTiles++;
      }
    }

    // ---- solve equilibrium for the free pool (pool minus employed roadworkers) ----
    var Nfree = Math.max(0.1, world.N - crewsEmployed - harborTotal);
    var eq = solveEquilibrium(world, Nfree, world.prices, crewFood);
    world.prices = eq.P;

    // ---- migration + subsistence distribution -------------------------------
    // Targets come from the solved equilibrium; actual farmer/city counts flow a
    // fraction `migrate` toward them each tick (1 = instant). Subsistence is the
    // scalar eq.subs distributed across per-hex SLACK (Lsub - market L) so the
    // map fills without over-committing labor (conservation stays exact at rest).
    var mig = clamp(cfg.migrate, 0.02, 1);
    // pass 1: per-hex market target + basin; accumulate slack for subsistence
    var totalSlack = 0;
    for (var i2 = 0; i2 < hexes.length; i2++) {
      var h2 = hexes[i2];
      if (h2.isCity) {
        // COASTAL CITY TILE — market FISHING only (no farming, no subsistence). It
        // sells its catch to the best city, which (at distance 0) is its own; a
        // non-coastal city has fishCap 0 and is skipped.
        var fcap = h2.fishCap || 0;
        if (fcap <= 0) { h2.LmktT = 0; h2.Fmkt = 0; continue; }
        var bestF = -Infinity, bkF = -1;
        for (var cf = 0; cf < world.cities.length; cf++) {
          var kf = world.cities[cf], tf = world.transport[kf] ? world.transport[kf][h2.i] : Infinity;
          if (isFinite(tf)) { var vf = eq.P[kf] - tf; if (vf > bestF) { bestF = vf; bkF = kf; } }
        }
        if (bestF > 0) { var ff = mkt(fcap, bestF, eq.w, cfg.kappa, cfg.c); h2.LmktT = ff.L; h2.Fmkt = ff.F; h2.netback = bestF; h2.basin = bkF; }
        else { h2.LmktT = 0; h2.Fmkt = 0; h2.netback = -Infinity; }
        continue;
      }
      var prevBasin = h2.basin;                 // last tick's allegiance (for hysteresis)
      h2.basin = -1; h2.netback = -Infinity;
      if (!h2.passable) { h2.LmktT = 0; h2.LsubT = 0; h2.Fmkt = 0; continue; }
      var best = -Infinity, bk = -1;
      for (var c3 = 0; c3 < world.cities.length; c3++) {
        var kk3 = world.cities[c3];
        var t = world.transport[kk3] ? world.transport[kk3][h2.i] : Infinity;
        if (isFinite(t)) { var v = eq.P[kk3] - t; if (v > best) { best = v; bk = kk3; } }
      }
      // BASIN HYSTERESIS: stay with the current city unless a rival delivers a
      // clearly better netback (> basinHyst better). Stops the tick-to-tick
      // flip-flop when two cities are near-tied. The prev basin was stored as a
      // cluster rep; a growing city's rep can shift between ticks, so remap a
      // stale rep to its tile's CURRENT cluster rep before comparing (otherwise
      // the whole hinterland loses stickiness on every rep change).
      if (prevBasin >= 0 && world.hexes[prevBasin]) {
        var effRep = prevBasin;
        if (!world.transport[effRep] && world.hexes[prevBasin].isCity && world.hexes[prevBasin].clusterRep != null)
          effRep = world.hexes[prevBasin].clusterRep;
        if (effRep !== bk && world.transport[effRep]) {
          var tc = world.transport[effRep][h2.i];
          if (isFinite(tc)) {
            var curV = eq.P[effRep] - tc;
            if (curV > 0 && best <= curV * (1 + cfg.basinHyst)) { best = curV; bk = effRep; }
          }
        }
      }
      h2.netback = best;
      if (best > 0) { var f = mkt(h2.Cfood, best, eq.w, cfg.kappa, cfg.c); h2.LmktT = f.L; h2.Fmkt = f.F; h2.basin = bk; }
      else { h2.LmktT = 0; h2.Fmkt = 0; }
      totalSlack += subRoomTile(world, h2, h2.LmktT); // desperation room on top of market labour
    }
    // pass 2: distribute subsistence across slack; blend actual mkt & sub labor
    // separately; production/consumption computed from ACTUAL labor so migration
    // is economically real (transient imbalance resolves; conserved at steady state).
    var subs = eq.subs || 0;
    var foodProduced = 0, marketFarmers = 0, subsistence = 0, fishermen = 0;
    for (var i3 = 0; i3 < hexes.length; i3++) {
      var h3 = hexes[i3];
      if (!h3.passable) continue;
      if (h3.isCity) {
        // coastal city tile: market fishing only (fishermen from the pool, no subsistence)
        if ((h3.fishCap || 0) <= 0) { h3.Lmkt = 0; h3.L = 0; h3.out = 0; continue; }
        h3.Lmkt += (h3.LmktT - h3.Lmkt) * mig; if (h3.Lmkt < 0) h3.Lmkt = 0;
        h3.Lsubw = 0; h3.L = h3.Lmkt;
        var Ff = h3.fishCap * (1 - Math.exp(-h3.Lmkt / cfg.kappa));
        foodProduced += Ff;                              // fish food
        h3.out = Math.max(0, Ff - h3.Lmkt * cfg.c);      // fish surplus feeds the city
        fishermen += h3.Lmkt;
        continue;
      }
      var slack = subRoomTile(world, h3, h3.LmktT); // break-even desperation room
      h3.LsubT = (totalSlack > 0) ? Math.min(slack, subs * (slack / totalSlack)) : 0; // never past break-even
      h3.Lmkt += (h3.LmktT - h3.Lmkt) * mig;
      h3.Lsubw += (h3.LsubT - h3.Lsubw) * mig;
      if (h3.Lmkt < 0) h3.Lmkt = 0;
      if (h3.Lsubw < 0) h3.Lsubw = 0;
      h3.L = h3.Lmkt + h3.Lsubw;
      // Market farmers work the tile for gold (surplus ships); subsistence farmers pile
      // onto the SAME curve out of desperation and self-feed. Capping subsistence at the
      // break-even residual keeps market-food + self-food <= the tile's capacity (no
      // phantom double count), while conserving (each subsister eats exactly what it grows).
      var Fm = h3.Cfood > 0 ? h3.Cfood * (1 - Math.exp(-h3.Lmkt / cfg.kappa)) : 0;
      foodProduced += Fm + h3.Lsubw * cfg.c;            // market food + subsistence self-food
      h3.out = Math.max(0, Fm - h3.Lmkt * cfg.c);       // market surplus shipped to basin
      marketFarmers += h3.Lmkt;
      subsistence += h3.Lsubw;
    }
    // city workforce: persistent, blended toward the solved target
    var byCityN = eq.byCityN || {};
    if (!world.cityN) world.cityN = {};
    var cityWorkers = 0;
    for (var c4 = 0; c4 < world.cities.length; c4++) {
      var kk4 = world.cities[c4];
      var Ntg = byCityN[kk4] || 0;
      var cur = world.cityN[kk4] || 0;
      world.cityN[kk4] = cur + (Ntg - cur) * mig;
      cityWorkers += world.cityN[kk4];
    }
    // clean up cityN for removed cities
    for (var ck in world.cityN) { if (world.Aof[ck] == null) delete world.cityN[ck]; }

    // ---- city output, taxation, treasury ----
    var S = world.solverConst;
    var Ytotal = 0, taxCollected = 0, cityRows = [];
    for (var c5 = 0; c5 < world.cities.length; c5++) {
      var kk5 = world.cities[c5];
      var Nk = world.cityN[kk5];
      var Yk = world.Aof[kk5] * Math.pow(Math.max(Nk, 0), S.alpha);
      var taxk = cfg.tau * Yk;
      Ytotal += Yk; taxCollected += taxk;
      // Pareto wealth summary: top 1% share (closed form ~ ((0.01N)^(1-p))/Z ... )
      var topShare = paretoTopShare(Nk, S.pconc, S.Z);
      cityRows.push({
        city: kk5, N: Nk, Y: Yk, tax: taxk, price: world.prices[kk5],
        foodBill: cfg.c * Nk * world.prices[kk5], crewFood: crewFood[kk5] || 0,
        netGold: Yk - taxk - cfg.c * Nk * world.prices[kk5], topShare: topShare
      });
    }
    // pay crews from the tax pool; leftover accrues to treasury (funds construction).
    // Govt (crew/garrison/road) wages track the CITY wage — the gold a city worker
    // earns (Y per city worker), NOT the farmer-diluted per-capita average — so
    // public works cost the going urban rate. Rich cities pay their workers more.
    var cityWage = Ytotal / Math.max(1, cityWorkers);
    var publicWage = cfg.wageShare * cityWage;
    var crewWageBill = crewsEmployed * publicWage;
    world.publicWage = publicWage; world.cityWage = cityWage;
    world.taxPool = taxCollected;                 // this tick's pool (recycled)
    var leftover = Math.max(0, taxCollected - crewWageBill);
    world.treasury += leftover;

    // ---- incremental road construction ----
    // A segment needs materials (roadBatchGold) + a crew (roadBatchLabor workers).
    // Idle spare labour (only when the wage has collapsed) works for free; any
    // shortfall is HIRED from the treasury at the public wage. So you can always
    // buy roads if the treasury can afford them — they just cost more where labour
    // is dear. Unaffordable => the project stalls (stallReason) but stays queued.
    var spareLabor = (eq.w <= 1e-4) ? Math.max(0, eq.room || 0) : 0;
    buildRoads(world, spareLabor, publicWage);

    // ---- road decay / recovery (funded stay near K1, unfunded drift to K0) ----
    decayRoads(world, segDemand, crewsEmployed);

    // ---- bandits (optional) ----
    if (cfg.bandits) updateBandits(world);

    // ---- Malthusian population update ----
    // eaters = all farmers (market + subsistence) + city workers + funded crews
    var farmersAll = marketFarmers + subsistence;
    var eaters = farmersAll + cityWorkers + crewsEmployed + harborTotal + fishermen; // fishermen & harbour crews eat too
    var foodEaten = cfg.c * eaters;

    if (cfg.malthus) {
      var eps = Math.max(1, 0.001 * world.Ksub);        // scale-relative slack epsilon
      // Use the solver's LAG-FREE targets (not the migration-lagged actuals) so
      // population approaches carrying capacity monotonically instead of limit-
      // cycling against the migration delay.
      var supportedTarget = eq.Lm + eq.Nc + (eq.subs || 0) + crewsEmployed + harborTotal;
      var sig;
      if (eq.w > 1e-4) sig = 1;                         // labor scarce -> grow
      else if ((eq.room || 0) > eps) sig = 0.5;         // subsistence room -> grow slow
      else if (world.N > supportedTarget + eps) sig = -1; // genuinely over capacity -> shrink
      else sig = 0;
      world.N = Math.max(0.1, world.N + cfg.r * world.N * Math.tanh(sig));
    }

    // ---- per-tile readouts (for the UI: farmers/gold/gov, food, gold) --------
    // distribute each cluster's gold workers & output across its urban tiles
    var Yof = {}; for (var cr = 0; cr < cityRows.length; cr++) Yof[cityRows[cr].city] = cityRows[cr].Y;
    for (var i4 = 0; i4 < hexes.length; i4++) {
      var hh = hexes[i4];
      if (hh.isCity) {
        var rep = hh.clusterRep, cl = world.clusterOf[rep];
        var nT = cl ? cl.tiles.length : 1;
        hh.goldWorkers = (world.cityN[rep] || 0) / nT;
        hh.goldProd = (Yof[rep] || 0) / nT;
        hh.govWorkers = (i4 === rep) ? (crewFood[rep] || 0) : 0;  // crews sit at the core
        hh.farmers = 0; hh.subsFood = 0;
        if (hh.fishCap > 0) {                                     // coastal city tile fishes
          hh.fishermen = hh.Lmkt;
          hh.foodCap = hh.fishCap;
          hh.marketFood = hh.out + hh.Lmkt * cfg.c;               // fish food produced here
          hh.foodProd = hh.marketFood;
          hh.foodNet = hh.out - cfg.c * hh.goldWorkers;           // fish surplus less local gold mouths
        } else {                                                 // inland city: pure importer
          hh.fishermen = 0; hh.foodCap = 0; hh.marketFood = 0; hh.foodProd = 0;
          hh.foodNet = -cfg.c * hh.goldWorkers;
        }
      } else if (hh.passable) {
        hh.farmers = hh.L; hh.goldWorkers = 0; hh.goldProd = 0; hh.govWorkers = 0; hh.fishermen = 0;
        hh.foodCap = hh.Cfood;                                    // farm + fishing capacity
        hh.marketFood = hh.out + hh.Lmkt * cfg.c;                 // Fm (market food, ships surplus)
        hh.subsFood = hh.Lsubw * cfg.c;                           // subsistence self-food (shares the curve)
        hh.foodProd = hh.marketFood + hh.subsFood;               // total food (now <= capacity)
        hh.foodNet = hh.out;                                      // surplus shipped
      }
    }

    // ---- metrics / conservation ----
    var avgPrice = 0;
    for (var c6 = 0; c6 < world.cities.length; c6++) avgPrice += world.prices[world.cities[c6]];
    avgPrice = world.cities.length ? avgPrice / world.cities.length : 0;

    var conservationErr = Math.abs(foodProduced - foodEaten);
    world.metrics = {
      tick: world.tick, N: world.N, w: eq.w,
      marketFarmers: marketFarmers, farmersAll: farmersAll, fishermen: fishermen,
      cityWorkers: cityWorkers, subsistence: subsistence,
      crewsEmployed: crewsEmployed, crewDemand: crewDemand, fundedFrac: fundedFrac,
      foodProduced: foodProduced, foodEaten: foodEaten, conservationErr: conservationErr,
      Ytotal: Ytotal, taxCollected: taxCollected, treasury: world.treasury,
      avgPrice: avgPrice, cities: world.cities.length,
      urbanTiles: urbanTileCount(world),
      roadSegments: segList.length, projectsActive: world.projects.length,
      roadsStalled: world.projects.filter(function (p) { return p.stalled; }).length,
      segCost: cfg.roadBatchGold + Math.max(0, cfg.roadBatchLabor - (eq.w <= 1e-4 ? Math.max(0, eq.room || 0) : 0)) * publicWage,
      harborTiles: harborTiles, harborWorkers: harborTotal,
      publicWage: publicWage, cityWage: cityWage,
      cityRows: cityRows
    };

    // ---- organic urbanization: flip tiles for NEXT tick (one-tick lag) -------
    if (cfg.urbanize) updateUrbanization(world, eq);

    world.tick++;
    return world.metrics;
  }
  function urbanTileCount(world) {
    var n = 0; for (var i = 0; i < world.hexes.length; i++) if (world.hexes[i].isCity) n++; return n;
  }

  // Pareto top-1% wealth share (closed form on the rank distribution).
  function paretoTopShare(N, p, Z) {
    if (N < 2) return 1;
    var top = Math.max(1, Math.round(0.01 * N));
    var num = 0;
    for (var i = 1; i <= top; i++) num += Math.pow(i, -p);
    // denominator ~ partial zeta to N; approximate tail by Z for large N
    var den = 0, lim = Math.min(N, 5000);
    for (var j = 1; j <= lim; j++) den += Math.pow(j, -p);
    return num / den;
  }

  // Build one segment per active project per tick if affordable.
  function buildRoads(world, spareLabor, publicWage) {
    var cfg = world.cfg, changed = false;
    for (var i = 0; i < world.projects.length; i++) {
      var pr = world.projects[i];
      if (pr.built >= pr.edges.length) continue;
      // find next unbuilt segment
      var e = pr.edges[pr.built];
      var key = edgeKey(e[0], e[1]);
      if (world.roads[key]) { pr.built++; i--; continue; } // already a road (shared corridor)
      // labour: use free idle spare first, hire the rest at the public wage
      var fromSpare = Math.min(spareLabor, cfg.roadBatchLabor);
      var hired = cfg.roadBatchLabor - fromSpare;
      var laborGold = hired * (publicWage || 0);
      var totalGold = cfg.roadBatchGold + laborGold;
      if (world.treasury >= totalGold) {
        world.treasury -= totalGold;
        spareLabor -= fromSpare;
        world.roads[key] = true;
        world.roadState[key] = { decay: 0, banditHold: 0 };  // cost derived in edgeCost
        pr.built++; pr.stalled = false; pr.stallReason = null; pr.segCost = totalGold; changed = true;
      } else {
        pr.stalled = true; pr.stallReason = 'treasury'; pr.segCost = totalGold; // needs more gold in the treasury
      }
    }
    // prune completed projects
    world.projects = world.projects.filter(function (p) { return p.built < p.edges.length; });
    if (changed) world.transportDirty = true;
  }

  // Gradual decay: the public budget (crewsEmployed workers) maintains segments
  // CHEAP-FIRST (core roads before far frontier ones) — deterministic, so sweeps
  // are reproducible. Maintained segments recover toward K1; the rest drift K1 ->
  // K0 (capped at K0 — roads never fall below their overland baseline; travel
  // just slows). Bandit-held segments add a toll on top.
  function decayRoads(world, segDemand, budget) {
    var cfg = world.cfg, changed = false;
    // order segments by maintenance demand ascending; fund until budget spent
    var keys = Object.keys(world.roadState).sort(function (a, b) {
      return (segDemand[a] || 0) - (segDemand[b] || 0);
    });
    var spent = 0;
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var rs = world.roadState[key];
      var need = segDemand[key] || 0;
      var funded = (spent + need <= budget + 1e-9);
      if (funded) spent += need;
      var d0 = rs.decay;
      if (funded) rs.decay = Math.max(0, rs.decay - cfg.recover);
      else rs.decay = Math.min(1, rs.decay + cfg.degrade);   // drifts road cost K0*f*roadMult -> K0*f
      if (rs.decay !== d0) changed = true;
    }
    if (changed) world.transportDirty = true;
  }

  // Optional: remote (beyond safeRadius), high-traffic, poorly-maintained
  // segments get colonized by bandits who levy a toll (ties to game toll system).
  function updateBandits(world) {
    var cfg = world.cfg, m = world.metrics;
    for (var key in world.roadState) {
      var rs = world.roadState[key];
      var traffic = estimateEdgeTraffic(world, key);
      var remote = true; // (segNearestCity distance already folded into decay pressure)
      if (traffic >= cfg.banditTrafficThresh && rs.decay >= cfg.banditDecayThresh) {
        rs.banditHold = Math.min(1, rs.banditHold + cfg.banditGrow);
      } else {
        rs.banditHold = Math.max(0, rs.banditHold - cfg.banditGrow * 0.5);
      }
    }
  }
  function estimateEdgeTraffic(world, key) {
    // crude: sum of surplus of hexes adjacent to the edge that ship to a city
    var parts = key.split('-'); var a = +parts[0], b = +parts[1];
    return (world.hexes[a].out || 0) + (world.hexes[b].out || 0);
  }

  // ---- convenience: run N ticks headless, return trajectory ----------------
  function run(world, ticks, opts) {
    opts = opts || {};
    var traj = [];
    for (var t = 0; t < ticks; t++) {
      if (opts.onTick) opts.onTick(world, t);   // strategy hook: acts BEFORE the tick
      var m = step(world);
      if (opts.record !== false) traj.push(sampleMetrics(m, world, opts.sampleEvery, t));
    }
    return traj.filter(function (x) { return x; });
  }
  function sampleMetrics(m, world, every, t) {
    if (every && (t % every !== 0)) return null;
    return {
      tick: m.tick, N: round1(m.N), w: round4(m.w),
      cityWorkers: round1(m.cityWorkers), marketFarmers: round1(m.marketFarmers),
      subsistence: round1(m.subsistence), crews: round1(m.crewsEmployed),
      fundedFrac: round3(m.fundedFrac), Ytotal: round1(m.Ytotal),
      treasury: round1(m.treasury), avgPrice: round3(m.avgPrice),
      cities: m.cities, roads: m.roadSegments, conservationErr: round3(m.conservationErr)
    };
  }
  var round1 = function (x) { return Math.round(x * 10) / 10; };
  var round3 = function (x) { return Math.round(x * 1000) / 1000; };
  var round4 = function (x) { return Math.round(x * 10000) / 10000; };

  // ---- public API ----------------------------------------------------------
  var API = {
    DEFAULTS: DEFAULTS, TERR: TERR, DIRS: DIRS,
    createWorld: createWorld, step: step, run: run,
    foundCity: foundCity, removeCity: removeCity, paintTerrain: paintTerrain,
    setTax: setTax, startRoadProject: startRoadProject, routeBetween: routeBetween,
    reconfigure: reconfigure, siteFactor: siteFactor,
    neighborsOf: neighborsOf, getHex: getHex, edgeKey: edgeKey, isHarbor: isHarbor,
    computeTransport: computeTransport, deriveUrban: deriveUrban,
    physDist: physDist, foodCapOf: foodCapOf,
    Lsub: Lsub, zeta: zeta, sampleMetrics: sampleMetrics
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.Econ = API;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
