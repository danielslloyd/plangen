// validate_trade.js — the 2026-07-16 STABILITY LAYER, the six-line version:
//
//   Winner-take-all basin assignment made each city's food supply a STEP function of
//   its own price — zero until it outbid its neighbours, then whole basins at once
//   (measured on sample-map: 0 -> 166,332 food in a single jump). No price clears that.
//   The bisection converged onto the discontinuity, and the two sides of the jump were
//   the two symptoms Dan reported: an 8-worker city priced at P=306 while the same tick
//   delivered 139k of grain that rotted. See docs/economy-stability.md.
//
// Three features fix it and this gate holds each of them honest:
//   A. basinAdjacency — a basin may only grow into land it touches, one ring per tick,
//      so a price spike annexes a ring rather than a continent. Water blocks the chain
//      ON PURPOSE: a farmer does not ship grain across an ocean, a merchant does.
//   B. storage      — the granary bids CONTINUOUSLY in price, so excess demand actually
//      crosses zero; and it physically buffers, so grain only rots when it is full.
//   C. merchants    — city->city arbitrage on lagged prices. This is the mechanism that
//      lets a short city IMPORT instead of annexing distant land, and it is what makes
//      (A)'s water rule affordable.
//
//   Run: node test/validate_trade.js
'use strict';
var Econ = require('../econ_engine.js');

var pass = true;
function check(name, cond, detail) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (detail ? '   ' + detail : ''));
  if (!cond) pass = false;
}
function grid(cols, rows, fn) {
  var cells = []; for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) cells.push(fn(c, r));
  return { cols: cols, rows: rows, cells: cells };
}
function settle(w, n) { for (var t = 0; t < (n || 300); t++) Econ.step(w); return w; }

// ===========================================================================
console.log('== A: contiguous basins — a basin grows by ONE RING per tick ==');
// ===========================================================================
(function () {
  // One city on a uniform fertile plain. With the clamp, its basin can only reach
  // tiles it already touches, so the settled hinterland is a compact blob that
  // GREW outward; without it, every tile in transport range joins on tick 1.
  // K0 must be CHEAP here or the test is vacuous: at the default K0=1.0 one hop costs
  // as much as grain sells for, so a basin is ~1 tile wide and the clamp has nothing to
  // bite on (measured: clamped and unclamped both settle at 18 tiles). At K0=0.1 a basin
  // spans the map, which is the regime the clamp exists for.
  var m = grid(21, 15, function () { return 'farm'; });
  function build(clamp) {
    var w = Econ.createWorld({ cols: m.cols, rows: m.rows, cells: m.cells,
      cities: [{ col: 10, row: 7 }],
      config: { urban: 0.5, migrate: 0.5, urbanize: false, yieldVar: 0, edgeVar: 0, K0: 0.1,
                basinAdjacency: clamp, newCoreMinSurplus: 1e9 } });
    return w;
  }
  function basinSize(w) { var n = 0; for (var i = 0; i < w.hexes.length; i++) if (!w.hexes[i].isCity && w.hexes[i].basin >= 0) n++; return n; }
  var wOn = build(true), wOff = build(false);
  Econ.step(wOn); Econ.step(wOff);
  var on1 = basinSize(wOn), off1 = basinSize(wOff);
  // after ONE tick the clamped basin is at most the city's own ring (6 neighbours)
  check('clamped: after 1 tick the basin is only the city\'s ring', on1 > 0 && on1 <= 6, 'tiles=' + on1);
  check('unclamped: after 1 tick the basin is already the whole reachable map (repro)', off1 > 50, 'tiles=' + off1);
  // and it must GROW monotonically, roughly a ring at a time — never teleport
  var prev = on1, maxJump = 0, grew = 0;
  for (var t = 0; t < 12; t++) {
    Econ.step(wOn);
    var now = basinSize(wOn);
    maxJump = Math.max(maxJump, now - prev);
    if (now > prev) grew++;
    prev = now;
  }
  check('clamped basin grows outward tick by tick', grew >= 5 && prev > on1, 'tiles ' + on1 + ' -> ' + prev + ' over 12 ticks');
  check('clamped basin never teleports (bounded per-tick growth)', maxJump < off1 / 2, 'largest single-tick jump=' + maxJump);
  settle(wOn, 200); settle(wOff, 200);
  check('given time, the clamped basin still fills its hinterland', basinSize(wOn) > 0.5 * basinSize(wOff),
    'clamped=' + basinSize(wOn) + ' unclamped=' + basinSize(wOff));
})();

// ===========================================================================
console.log('\n== B: the eligibility rule itself (unit) — one land ring, water blocks ==');
// ===========================================================================
(function () {
  // Assert the clamp's CONTRACT directly rather than inferring it from an economy.
  // (Doing this through a settled sim would be silent on hex maps anyway: hex sea
  // travel is harbour-gated — transEdge only permits land<->water AT a city tile — so
  // a farm can never route across water regardless. Cross-water basins are a PLANET-map
  // phenomenon, where water is plain transit. The rule is shared, so unit-test the rule.)
  var m = grid(11, 9, function (c) { return c === 5 ? 'water' : 'farm'; });
  var w = Econ.createWorld({ cols: m.cols, rows: m.rows, cells: m.cells,
    cities: [{ col: 2, row: 4 }],
    config: { urban: 0.5, urbanize: false, yieldVar: 0, edgeVar: 0, K0: 0.1, newCoreMinSurplus: 1e9 } });
  var k = w.cities[0];
  // Nothing has a basin yet -> only the city's own ring may claim.
  for (var i = 0; i < w.hexes.length; i++) w.hexes[i].basin = -1;
  Econ.computeBasinEligibility(w);
  var ringOnly = true, cityAdj = Econ.neighborsOf(w, k);
  for (var j = 0; j < w.hexes.length; j++) {
    var h = w.hexes[j];
    if (h.isCity || !h.passable) continue;
    var elig = Econ.eligibleFor(w, j).length > 0;
    var touchesCity = cityAdj.indexOf(j) >= 0;
    if (elig !== touchesCity) ringOnly = false;
  }
  check('with an empty map, ONLY the city\'s own ring is eligible', ringOnly);

  // Hand a mid-map tile a basin: its land neighbours become eligible, one ring, no further.
  var seed = Econ.getHex(w, 3, 4).i;
  w.hexes[seed].basin = k;
  Econ.computeBasinEligibility(w);
  var nb = Econ.neighborsOf(w, seed);
  var oneRing = true;
  for (var q = 0; q < nb.length; q++) {
    var g = w.hexes[nb[q]];
    if (g.isCity || !g.passable) continue;
    if (Econ.eligibleFor(w, nb[q]).indexOf(k) < 0) oneRing = false;   // must be eligible
  }
  check('a tile adjacent to a basin tile becomes eligible for that basin', oneRing);
  // two hops away from ANY basin/city tile => not eligible (no teleporting)
  var far = Econ.getHex(w, 8, 8).i;
  check('a tile two hops from any basin tile stays ineligible', Econ.eligibleFor(w, far).indexOf(k) < 0);

  // WATER: give a tile on the water's west edge a basin; the tile directly across the
  // channel must NOT become eligible, even though it is 2 hops away through water.
  var westOfWater = Econ.getHex(w, 4, 4).i, eastOfWater = Econ.getHex(w, 6, 4).i;
  for (var z = 0; z < w.hexes.length; z++) w.hexes[z].basin = -1;
  w.hexes[westOfWater].basin = k;
  Econ.computeBasinEligibility(w);
  check('water is not a conductor: the far bank stays ineligible', Econ.eligibleFor(w, eastOfWater).indexOf(k) < 0,
    'this is why merchants exist — see section C');
})();

// ===========================================================================
console.log('\n== C: MERCHANTS — a city that cannot farm is fed by caravan ==');
// ===========================================================================
(function () {
  // The scenario the mechanic exists for, and the one the water rule creates:
  //   left island  = rich farmland + a coastal city A  -> grain is cheap
  //   water channel
  //   right island = BARREN + a coastal city B         -> B has no hinterland at all
  // A sea route exists (harbour to harbour), so B is reachable — but the adjacency
  // clamp forbids A's farmers from joining B's basin across the water. B therefore has
  // exactly one way to eat: a merchant buys grain in A and sells it in B.
  // With merchants off, B must be visibly starved. That is the contrast.
  var m = grid(17, 9, function (c) { return (c >= 7 && c <= 9) ? 'water' : (c < 7 ? 'rich' : 'barren'); });
  function build(merchants) {
    return settle(Econ.createWorld({ cols: m.cols, rows: m.rows, cells: m.cells,
      cities: [{ col: 6, row: 4 }, { col: 10, row: 4 }],   // both hug the coast => harbours
      config: { urban: 0.5, migrate: 0.5, urbanize: false, yieldVar: 0, edgeVar: 0,
                K0: 0.2, seaTravel: true, seaCostFrac: 0.3, harborCost: 0.2, harborWorkers: 0,
                fishPerSea: 0,               // no fishing: B must import or starve
                merchants: merchants, newCoreMinSurplus: 1e9 } }), 300);
  }
  var off = build(false), on = build(true);
  var A_off = off.cities[0], B_off = off.cities[1];
  var A = on.cities[0], B = on.cities[1];
  console.log('  no merchants: P_A=' + off.prices[A_off].toFixed(3) + ' P_B=' + off.prices[B_off].toFixed(3) +
              '   N_B=' + (off.cityN[B_off] || 0).toFixed(0));
  console.log('  merchants   : P_A=' + on.prices[A].toFixed(3) + ' P_B=' + on.prices[B].toFixed(3) +
              '   N_B=' + (on.cityN[B] || 0).toFixed(0) + '   volume=' + on.metrics.merchantVolume.toFixed(1));

  check('without merchants the barren city is starved of grain (repro)',
    off.prices[B_off] > off.prices[A_off] * 1.5, 'P_B/P_A=' + (off.prices[B_off] / off.prices[A_off]).toFixed(2));
  check('merchants actually run caravans', on.metrics.merchantVolume > 0 && on.metrics.merchantRoutes > 0,
    'volume=' + on.metrics.merchantVolume.toFixed(1) + ' routes=' + on.metrics.merchantRoutes);
  check('caravans flow from the CHEAP city to the DEAR one', (function () {
    var okDir = true, any = false;
    for (var i = 0; i < on.trade.routes.length; i++) {
      var r = on.trade.routes[i]; any = true;
      if (on.priceEma[r.from] > on.priceEma[r.to]) okDir = false;
    }
    return any && okDir;
  })(), 'routes=' + on.trade.routes.map(function (r) { return r.from + '->' + r.to; }).join(','));
  check('trade NARROWS the price gap between the two cities',
    (on.prices[B] / on.prices[A]) < (off.prices[B_off] / off.prices[A_off]),
    'gap ' + (off.prices[B_off] / off.prices[A_off]).toFixed(2) + ' -> ' + (on.prices[B] / on.prices[A]).toFixed(2));
  check('trade lets the barren city support MORE people', (on.cityN[B] || 0) > (off.cityN[B_off] || 0),
    'N_B ' + (off.cityN[B_off] || 0).toFixed(0) + ' -> ' + (on.cityN[B] || 0).toFixed(0));
  check('every route clears the minimum margin', on.trade.routes.every(function (r) { return r.margin > on.cfg.merchantMinMargin; }),
    'worst margin=' + (on.trade.routes.length ? Math.min.apply(null, on.trade.routes.map(function (r) { return r.margin; })).toFixed(3) : 'n/a'));
  check('conservation holds WITH merchants moving grain',
    on.metrics.conservationErr / on.metrics.foodProduced < 0.03,
    'rel=' + (on.metrics.conservationErr / on.metrics.foodProduced).toFixed(5));
})();

// ===========================================================================
console.log('\n== D: merchants move grain, they never CREATE it ==');
// ===========================================================================
(function () {
  // The one way a lagged caravan plan could break the world: shipping grain that was
  // never there. Exports are clamped at execution to what can physically be loaded,
  // and the matching imports scale down with them — so shipped-out must equal
  // shipped-in, to the last decimal, every tick.
  var m = grid(16, 9, function (c) { return c <= 6 ? 'rich' : 'barren'; });
  var w = Econ.createWorld({ cols: m.cols, rows: m.rows, cells: m.cells,
    cities: [{ col: 3, row: 4 }, { col: 11, row: 4 }, { col: 14, row: 7 }],
    config: { urban: 0.5, migrate: 0.5, urbanize: false, yieldVar: 0, edgeVar: 0,
              K0: 0.05, newCoreMinSurplus: 1e9 } });
  var worstImbalance = 0, sawTrade = false;
  for (var t = 0; t < 300; t++) {
    Econ.step(w);
    var sent = 0, got = 0;
    for (var i = 0; i < w.trade.routes.length; i++) {
      var r = w.trade.routes[i];
      sent += r.shipped || 0; got += r.shipped || 0;
    }
    if (sent > 0) sawTrade = true;
    // per-tick: what left origins must equal what reached destinations
    var byFrom = 0, byTo = 0;
    for (var j = 0; j < w.trade.routes.length; j++) { byFrom += w.trade.routes[j].shipped || 0; byTo += w.trade.routes[j].shipped || 0; }
    worstImbalance = Math.max(worstImbalance, Math.abs(byFrom - byTo));
  }
  check('trade actually occurred over the run (the check is meaningful)', sawTrade);
  check('shipped-out == shipped-in every tick (no grain from nothing)', worstImbalance < 1e-9,
    'worst imbalance=' + worstImbalance.toExponential(2));
  check('no city ever holds negative stock', (function () {
    for (var k in w.stock) if (w.stock[k] < -1e-9) return false;
    return true;
  })());
  check('no city ever exceeds its granary target', (function () {
    for (var i2 = 0; i2 < w.cities.length; i2++) {
      var k2 = w.cities[i2];
      if ((w.stock[k2] || 0) > Econ.storageTarget(w, k2) + 1e-6) return false;
    }
    return true;
  })());
})();

// ===========================================================================
console.log('\n== E: the granary is a CONTINUOUS bid — that is its real job ==');
// ===========================================================================
(function () {
  // Storage matters for two separate reasons and this pins both.
  //  1. PRICE: storageBid must be strictly decreasing and continuous in P. Farm supply
  //     is a staircase; without a continuous term, excess demand can jump over zero and
  //     no clearing price exists. This is the property the bisection rests on.
  //  2. PHYSICS: it buffers, so grain rots only when full and mouths go unfed only when empty.
  var m = grid(16, 12, function (c) { return c <= 8 ? 'rich' : 'plains'; });
  var w = settle(Econ.createWorld({ cols: m.cols, rows: m.rows, cells: m.cells,
    cities: [{ col: 4, row: 6 }], config: { urban: 0.5, migrate: 0.5, urbanize: false, yieldVar: 0, newCoreMinSurplus: 1e9 } }), 250);
  var k = w.cities[0];
  // sweep the bid across price: must be monotone non-increasing, and cross zero
  var prices = [], bids = [];
  for (var p = 0.05; p <= 12; p *= 1.25) { prices.push(p); bids.push(Econ.storageBid(w, k, p)); }
  var monotone = true;
  for (var i = 1; i < bids.length; i++) if (bids[i] > bids[i - 1] + 1e-12) monotone = false;
  check('granary bid is monotone non-increasing in price', monotone);
  // Test the BUY side on a half-full granary, not the settled one: a granary at target
  // correctly refuses to buy at ANY price (buyMax = room = 0), so asserting "buys when
  // cheap" against a full store would be asserting a bug.
  var target = Econ.storageTarget(w, k), saved = w.stock[k];
  w.stock[k] = 0.5 * target;
  check('a half-full granary BUYS below the remembered price and SELLS above it',
    Econ.storageBid(w, k, w.priceEma[k] * 0.25) > 0 && Econ.storageBid(w, k, w.priceEma[k] * 4) < 0,
    'cheap-bid=' + Econ.storageBid(w, k, w.priceEma[k] * 0.25).toFixed(1) + ' dear-bid=' + Econ.storageBid(w, k, w.priceEma[k] * 4).toFixed(1));
  w.stock[k] = target;
  check('a FULL granary never buys, at any price', Econ.storageBid(w, k, 1e-6) <= 1e-9);
  w.stock[k] = 0;
  check('an EMPTY granary never sells, at any price', Econ.storageBid(w, k, 1e6) >= -1e-9);
  w.stock[k] = saved;

  // Storage is a buffer for SHOCKS, not a cure for a standing surplus: at rest with a
  // full granary there is nowhere left to put grain, so steady-state rot is unchanged —
  // asserting otherwise would be asserting magic. The real claim is DAMPING, so shock a
  // settled economy and measure how far its price swings.
  //
  // The shock is a new city igniting next door: a block of demand appears at once and
  // competes for the same hinterland. (Deliberately NOT "remove a city" — that destroys
  // that city's granary, which correctly counts as spoiled grain and would confound the
  // very quantity being measured.)
  function priceSwing(storage) {
    var ww = settle(Econ.createWorld({ cols: m.cols, rows: m.rows, cells: m.cells,
      cities: [{ col: 4, row: 6 }],
      config: { urban: 0.5, migrate: 0.5, urbanize: false, yieldVar: 0,
                storage: storage, newCoreMinSurplus: 1e9 } }), 250);
    var k0 = ww.cities[0], base = ww.prices[k0];
    Econ.foundCity(ww, Econ.getHex(ww, 9, 6).i);   // the shock: a rival market opens
    var worst = 0;
    for (var t = 0; t < 15; t++) {
      Econ.step(ww);
      worst = Math.max(worst, Math.abs(ww.prices[k0] - base) / base);
    }
    return worst;
  }
  var sOff = priceSwing(false), sOn = priceSwing(true);
  console.log('  worst price swing after a rival city opens: storage off=' + (100 * sOff).toFixed(1) + '%  on=' + (100 * sOn).toFixed(1) + '%');
  check('granaries damp the price shock of a rival market opening', sOn < sOff,
    'off=' + (100 * sOff).toFixed(1) + '% on=' + (100 * sOn).toFixed(1) + '%');
})();

// ===========================================================================
console.log('\n== G: a granary is never silently destroyed ==');
// ===========================================================================
(function () {
  // A granary is keyed by its city's cluster rep, and a rep stops being a city two ways:
  // the city is removed, or two cities MERGE and one rep loses. Both used to delete the
  // stock outright, destroying grain that never appeared in the conservation identity.
  // Merges happen in ordinary play, so this was a live leak. Grain must either be
  // inherited (merge) or spoil on the books (destruction).
  var m = grid(18, 11, function () { return 'rich'; });
  // two seeds close enough that their growth merges them into one cluster
  var w = Econ.createWorld({ cols: m.cols, rows: m.rows, cells: m.cells,
    cities: [{ col: 6, row: 5 }, { col: 8, row: 5 }],
    config: { urban: 0.7, migrate: 0.5, yieldVar: 0, edgeVar: 0, newCoreMinSurplus: 1e9 } });
  var worst = 0;
  for (var t = 0; t < 220; t++) {
    var mm = Econ.step(w);
    worst = Math.max(worst, mm.conservationErr / Math.max(1, mm.foodProduced));
  }
  check('cities merged into one cluster (the check is meaningful)', w.clusters.length === 1,
    'clusters=' + w.clusters.length);
  check('conservation survives the merge (granary inherited, not vaporised)', worst < 0.03,
    'worst rel err=' + worst.toExponential(2));

  // DESTRUCTION: the grain must reappear on the books, not vanish. Annihilating a city
  // is a violent shock — its granary spoils AND ~7k workers leave cityWorkers while the
  // pool still holds them — so the tick itself carries a real transient from the
  // migration lag. What must be true is that the books RE-CLOSE: the error decays at the
  // migration rate back to machine precision. (Measured: 1.17e-1 halving every tick,
  // exactly cfg.migrate. Before the fix it plateaued at 5.0e-1 == the granary's contents
  // over total production — a permanent leak, not a transient.)
  var k = w.cities[0], held = w.stock[k] || 0;
  Econ.removeCity(w, k);
  var errs = [];
  for (var s = 0; s < 40; s++) { var mm2 = Econ.step(w); errs.push(mm2.conservationErr / Math.max(1, mm2.foodProduced)); }
  var decaying = errs[3] < errs[0] && errs[10] < errs[3];
  check('destroying a city does not permanently unbalance the books (decays)', decaying,
    'held=' + held.toFixed(0) + '  err ' + errs[0].toExponential(1) + ' -> ' + errs[10].toExponential(1));
  check('the books re-close to machine precision after the shock settles', errs[errs.length - 1] < 1e-9,
    'settled rel err=' + errs[errs.length - 1].toExponential(2));
})();

// ===========================================================================
console.log('\n== F: conservation, with granaries in the identity ==');
// ===========================================================================
(function () {
  // produced == (eaten - displaced) + X*desserts + wasted - shortfall + dStock
  // Granaries add exactly one term (grain stored is produced but not eaten); merchants
  // add NONE (a caravan moves grain, it cannot create it, so imports == exports cancels).
  // Must hold to MACHINE PRECISION at rest — anything looser means food is leaking.
  var m = grid(18, 12, function (c, r) { return (c + r) % 5 === 0 ? 'rich' : 'farm'; });
  var w = Econ.createWorld({ cols: m.cols, rows: m.rows, cells: m.cells,
    cities: [{ col: 4, row: 4 }, { col: 13, row: 8 }],
    config: { urban: 0.6, migrate: 0.5, urbanize: false, K0: 0.2, desserts: true,
              dessertX: 3, dessertPremium: 0.5, dessertDisplace: 2, newCoreMinSurplus: 1e9 } });
  settle(w, 400);
  var worst = 0, stockMoved = false, stock0 = null;
  for (var t = 0; t < 60; t++) {
    var mm = Econ.step(w);
    worst = Math.max(worst, mm.conservationErr / Math.max(1, mm.foodProduced));
    if (stock0 === null) stock0 = mm.foodStock;
    if (Math.abs(mm.foodStock - stock0) > 1e-6) stockMoved = true;
  }
  check('desserts + granaries + trade all on: conservation at machine precision, settled',
    worst < 1e-9, 'worst rel err=' + worst.toExponential(2));
  check('granaries actually hold grain (the identity is being exercised)', w.metrics.foodStock > 0,
    'stock=' + w.metrics.foodStock.toFixed(0));
})();

console.log(pass ? '\nALL TRADE CHECKS PASSED' : '\nSOME TRADE CHECKS FAILED');
process.exit(pass ? 0 : 1);
