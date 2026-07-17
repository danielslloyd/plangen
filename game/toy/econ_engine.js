// ============================================================================
// econ_engine.js — Hex Economy v2 shared engine (browser + Node)
// ----------------------------------------------------------------------------
// Ports the Node-validated equilibrium (hex_economy_v2_core.js / spec §11) and
// layers taxation → road crews → garrisons → incremental road construction →
// gradual road decay → optional bandit tolls on top of it, WITHOUT disturbing
// the validated core (all layers no-op when tau=0 and there are no roads, so
// the bare equilibrium reproduces §11.5 exactly).
//
// Design invariants (do not break — see hex_economy_v2_spec.md §11 / game/STATUS.md):
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
    // ---- desserts: value-density arbitrage --------------------------------
    // dessertX food -> 1 dessert, which ships as ONE unit (so per-food-equivalent
    // transport is divided by dessertX) and sells for dessertPremium * dessertX * P.
    // The premium is a FRACTION (<1) of the embodied food value: at >=1 desserts would
    // beat food even at the city gate and every tile would convert. Under 1, food wins
    // near the city and desserts win beyond
    //     d* = X*P*(1 - premium) / (K0 * (X - 1))
    // which is the whole point: remote rich land ships whisky, not barley.
    // Settled radius multiplies by premium*dessertX -- keep that product ~1.5-2.5 or the
    // frontier outruns the map. desserts:false reproduces the pre-dessert equilibrium exactly.
    desserts: false,
    dessertX: 3.0,        // food per dessert (>1)
    dessertPremium: 0.5,  // m: dessert price = m * dessertX * P  (MUST be < 1)
    // D: units of city food demand displaced per dessert consumed, richest-first.
    // Net grain BURNED per dessert is (dessertX - D), so D runs from most to least wasteful:
    //   D = 0        -> pure export: X grain leaves the map and feeds nobody (default)
    //   D = 1        -> X-1 burned
    //   D = dessertX -> food-neutral: the dessert displaces exactly the grain it ate
    //   D > dessertX -> grain from nothing; clamped in displaceOf().
    // So D is a RELIEF valve, not an accelerator: raising it feeds more people, because
    // less of the harvest is burned to make a luxury nobody eats. Measured on sample-map
    // (X=3, m=0.5): D=0 -> N=182616, D=3 -> N=220928.
    dessertDisplace: 0,
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
    // What qualifies a site to ignite a market town (crops_spec §6.3, Dan's call).
    //   'surplus' (default) — local SPARE food: sum over the radius-2 ball of
    //                         (what the land grows) - (what its farmers eat). This is
    //                         what actually feeds a town, and under the marginal cap it
    //                         is exactly the quantity the rule leaves on the tile.
    //   'farmers'           — legacy: local farmer MASS. The marginal cap makes farmer
    //                         mass a bad proxy BY DESIGN (its whole purpose is fewer
    //                         farmers per tile), which is how a site with 2500 farmers
    //                         and no spare grain ignited the 8-worker city that priced
    //                         itself to P=306. Kept for reproducing old sweeps.
    newCoreGate: 'surplus',
    // Local farmer mass (radius 2) needed to seed a town — only read when
    // newCoreGate:'farmers'. RECALIBRATED 6000 -> 1500 for the marginal cap: the whole
    // point of that rule is fewer farmers per tile, so the old threshold silently
    // stopped igniting anything (5 cities, 81% subsistence).
    newCoreMinFarmers: 1500,
    // Local SPARE food (radius 2) needed to seed a town — read when newCoreGate:'surplus'.
    // Units are food/tick, so it is directly comparable to what a town of N workers eats
    // (N*c): the default sustains a few hundred citizens before a town is worth founding.
    newCoreMinSurplus: 400,
    newCoreMinDist: 5,       // physical hexes from the nearest city
    maxUrbanFrac: 0.5,  // hard backstop: urban tiles never exceed this of the land
    // population dynamics
    r: 0.10,          // Malthusian growth rate
    // Growth controller. 'bangbang' = legacy (fixed +/-r*tanh(sig) step; rings at ~r
    // peak-to-peak forever because it can only stop when sig is exactly 0).
    // 'deadband'     = stop growing within growBand below the target (captures the cycle
    //                  only if the band is wider than one step; settles BELOW capacity).
    // 'proportional' = scale the step by the relative gap (settles ON capacity, no ripple).
    //
    // DEFAULT FLIPPED 'bangbang' -> 'deadband' (Dan's call, crops_spec §6.2): measured
    // ripple 11.4% -> 0.0% with N/cities/extent unchanged, i.e. free. NOTE this silently
    // rewrites what pre-2026-07-16 sweeps mean — those ran bang-bang's limit cycle and
    // their oscAmp numbers are not comparable to anything measured after this change.
    // Set growth:'bangbang' to reproduce them.
    growth: 'deadband',
    growBand: 0.05,   // 'deadband': stop growing when unfilled room <= this x Ksub
    // WHAT the growth controller keys off (Dan, 2026-07-17):
    //   'global'       — the shipped signal: eq.w (labour scarce) / eq.room (subsistence
    //                    room left). A map-wide abstraction with no notion of any city's
    //                    actual food security.
    //   'foodSecurity' — a city only contributes growth once its granary has been FULL for
    //                    `growthFullTurns` consecutive ticks. The growth rate is scaled by
    //                    the share of city population that is food-secure by that test.
    //
    // This is a better-motivated signal (grow when you have visibly banked a surplus, which
    // is what a pre-modern population actually responds to) and it is hysteretic by
    // construction. NOTE it changes the SIGNAL, not the architecture: the labour pool stays
    // global and conserved — per-city pools would mean abandoning the wage bisection that
    // the whole model rests on. Subsistence farmers have no granary, so they keep the
    // room-based signal; only the urban share is gated.
    //
    // RISK, and the reason this is opt-in: grow -> demand rises -> granary drains -> growth
    // stops -> refill -> grow is a negative feedback loop WITH A LAG, i.e. the textbook
    // shape of a limit cycle, with period ~ (fill time + growthFullTurns). `deadband`
    // already measures 0.0000 ripple, so there is no headroom to win here — only realism.
    growthGate: 'global',
    growthFullTurns: 5,
    wRef: 0.25,       // 'proportional': wage at which growth runs at ~76% of full speed
    malthus: true,    // growth on/off (off => fixed pool, reallocation only)
    N0: 15,           // starting pool
    // migration (fractional flow toward equilibrium; 1 = instant)
    migrate: 0.5,
    // basin stickiness: a farm tile ships to the city with the best delivered
    // netback (price - transport). When two cities are near-tied the winner
    // flip-flops every tick. basinHyst = how much MORE a rival must beat the
    // current basin before the tile switches allegiance (0.08 => 8% better).
    basinHyst: 0.08,
    // ---- CONTIGUOUS BASINS: the fix for the winner-take-all staircase ---------
    // Without this a tile picks its buyer from EVERY city on the map, so a city's
    // supply is a step function of its OWN price: zero until it outbids its
    // neighbours, then whole basins at once (measured: 0 -> 166,332 food in one
    // jump). No price clears that, the bisection lands ON the discontinuity, and
    // the two sides of the jump are the two symptoms — an 8-worker city priced at
    // P=306 while the tick delivers 139k of grain that rots. See docs/economy-stability.md.
    //
    // The clamp: a tile may only join basin k if it ALREADY belongs to k, or is
    // adjacent to a LAND tile that does, or is adjacent to k's own city tiles. So
    // a basin grows one ring per tick and a price spike can annex one ring, not a
    // continent. Read it as information, not law: a farmer learns what a market
    // pays from the neighbours who sell there, and word travels at a walking pace.
    //
    // WATER BLOCKS the chain deliberately — a farmer does not ship grain across an
    // ocean, a MERCHANT does. That division (farmers sell to their local market
    // town; merchants arbitrage between market towns) is what `merchants` below
    // implements, and it is why the two features must ship together: the clamp
    // alone would strand every island and coast that trades by sea today.
    basinAdjacency: true,
    // ---- STICKY BASINS: assign the buyer ONCE per tick, before the solve -------
    // A tile commits to its buyer using LAST tick's prices, then holds that buyer
    // through the whole equilibrium solve (it still responds to that buyer's live
    // price — it just doesn't re-auction its harvest to 32 cities per bisection
    // round). Three things fall out:
    //   1. Each city's supply depends ONLY on its own price => the per-city price
    //      bisections become exactly independent, not approximately. This is the
    //      property the whole solver was already assuming.
    //   2. The supply staircase's risers shrink from "a whole basin" to "one tile".
    //   3. innerP's inner loop drops from O(tiles x cities) to O(tiles).
    // Also just truer: a classical-era farmer has a buyer, not an auction.
    stickyBasins: true,
    stickyPriceTol: 0.05,  // re-shop only if the buyer's price moved this much (relative)
    stickyRefresh: 20,     // ...or every this many ticks regardless (staggered by tile id,
                           // so the re-shopping cost is spread evenly across ticks and no
                           // tile is ever permanently stuck with a stale buyer)
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
    // FOOD MODEL. 'marginal' = the current rule (Michaelis-Menten yield, marginal
    // population cap Lsub = sqrt(C*kappa/c) - kappa). 'legacy' = the exponential
    // yield + average-rule cap of the reference core (hex_economy_v2_core.js):
    // Ffood = C*(1-e^-L/kappa), Lsub solves F(L) = L*c, mkt E = (c+w/nb)*kappa/C.
    // 'legacy' exists ONLY so validate_core Part A can keep testing port fidelity
    // against a reference that deliberately no longer matches the shipped model.
    foodModel: 'marginal',
    // ---- CITY FOOD STORAGE (granary) -----------------------------------------
    // Two distinct jobs, both needed:
    //  1. PRICE: the granary bids in the market — it buys when grain is below the
    //     price it remembers and sells when it is above. That bid is CONTINUOUS in
    //     P (unlike farm supply, which is a staircase), so it guarantees an actual
    //     crossing exists for the bisection to find. This is what makes the price
    //     solvable rather than merely bounded.
    //  2. PHYSICS: it absorbs surplus that would otherwise rot and releases grain
    //     to cover a deficit. Glut therefore only happens when the granary is FULL
    //     and shortfall only when it is EMPTY, instead of every tick the staircase
    //     lands wrong.
    // The granary's reference price is an EMA of the city's own past price —
    // adaptive expectations, so it needs no global tuning and each city learns what
    // grain "normally" costs at home.
    // HOW a city expresses its wish to hold reserves. Two models:
    //   'granary'   — the granary is a separate market participant with its own bid
    //                 (storageBid: restock + price-timing motives). Shipped 2026-07-16.
    //   'overshoot' — (Dan, 2026-07-17) the granary has NO bid at all. The CITY simply
    //                 buys `demand x (1 + overshoot)` while its reserves are short, and
    //                 exactly `demand` once they are full; whatever it buys above what it
    //                 eats lands in the granary by the ordinary balance, and it eats its
    //                 reserves when deliveries fall short. One demand curve instead of two.
    //
    // Why this is worth having: the granary's implicit bid is up to
    // `storageRate x storageDays x cityN ~= 0.6x daily demand` of extra demand, spread
    // across three knobs. `overshoot` is one explicit number. And the real prize is that a
    // hungry city stays a buyer for MANY ticks (until its reserves refill) instead of
    // spiking for one — which is exactly what the merchant route gate needs, since that
    // gate is binary and one sub-margin tick deletes the whole caravan fleet.
    //
    // Monotonicity is safe: granary fullness is fixed during the solve (it is last tick's
    // state), so this is a constant SCALING of an already-monotone demand curve, not a new
    // P-dependent term.
    foodPolicy: 'granary',
    overshoot: 0.10,      // buy this much above demand while reserves are short
    // Taper the overshoot to zero over the last `overshootBand` of the granary. Dan's
    // sketch is a hard switch at full; a hard switch invites chatter exactly AT the
    // boundary (full -> ov=0 -> buy less -> drain -> ov back on -> ...). The taper costs
    // nothing and removes that. Set to 0 for the literal hard switch.
    overshootBand: 0.25,
    storage: true,
    storageDays: 8,      // target stock = this x the city's own daily food demand
    // Max fraction of TARGET the granary moves in one tick, both directions. There is a
    // floor and a ceiling on what is sensible here, and both were found the hard way:
    //   * ABOVE ~0.25 the granary's own restocking dwarfs the city it serves (at
    //     storageDays=8 it would bid 2 days of food per tick against a city that eats 1)
    //     and it becomes the market instead of damping it.
    //   * BELOW 1/storageDays = 0.125 it physically cannot cover one day's demand in one
    //     tick, so it fails at the one job it has — measured at 0.10, a granary with 5.6
    //     days of grain still let the price spike 69% because it could only release 0.8
    //     days' worth. A reserve you cannot spend fast enough is not a reserve.
    // 0.15 clears the floor with margin and stays far from the ceiling.
    storageRate: 0.15,
    storageFill: 0.5,    // weight on the RESTOCK motive vs the price-timing motive (see storageBid)
    storageEma: 0.15,    // EMA weight on the new price when updating the remembered price
    // ---- MERCHANTS: city -> city arbitrage ------------------------------------
    // A merchant in A hears grain is dear in B, buys A's spare, sells it in B, and
    // pockets  margin = P_B - P_A - transit(A,B).  This is the mechanism that was
    // missing: today a city that runs short can only bid up its price and annex
    // distant LAND, which is exactly the pathology basinAdjacency clamps. With
    // merchants it instead imports from a neighbour that has a glut.
    //
    // Merchants act on LAGGED information (last tick's prices) — they commit before
    // they can know what the new price will be. That lag is not a simplification,
    // it is the point: it keeps each city's merchant inflow EXOGENOUS to this tick's
    // price, so the per-city bisections stay decoupled (see stickyBasins). Coupling
    // them is what made v1's tatonnement oscillate; do not "improve" this by solving
    // merchant flows inside the price loop.
    //
    // Volume is capped three ways, per Dan's spec: by A's spare grain, by B's unmet
    // demand PLUS room in B's granary (merchants past that point have no buyer and
    // do not ship), and by A's merchant capacity. Routes fill highest-margin-first.
    merchants: true,
    merchantCapPerWorker: 0.5,  // food/tick a city's merchants can move, per city worker.
                                // Scales with the city: a 9-worker town moves ~4 units and
                                // cannot distort the map; a metropolis runs real convoys.
    merchantMinMargin: 0.02,    // don't bother below this gold margin per unit
    merchantRoutes: 6,          // max import routes serving one city per tick (a market has
                                // only so many gates); highest-margin routes win the slots
    // Fraction of the arbitrage-closing quantity a caravan actually carries. MUST be < 1:
    // at 1 the plan tries to close the whole price gap in one tick, but it is computed on
    // LAST tick's prices against a demand curve that is wildly elastic (N ~ P^-2.857) and a
    // workforce that only migrates `migrate` of the way per tick — so the grain lands, the
    // city cannot eat it yet, and the price OVERSHOOTS straight past the target. Measured
    // at 1.0: the destination's price ping-ponged 94.4 <-> 0.54 and merchants spent alternate
    // ticks shipping grain BACK into the breadbasket. That is a textbook cobweb, and this
    // is the textbook fix — probe, converge geometrically, never overshoot.
    merchantAggression: 0.35,
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
    // Price bisection bracket. These were hard-coded 0.001/600 and were doing real,
    // invisible work: when a city's supply staircase had no crossing, the bisection
    // pinned P at the bracket and `priceMax` alone decided how absurd the spike got
    // (a measured P=306 is just 600 halved). With storage the crossing exists, so the
    // bracket is back to being a bracket. Exposed because the reference core uses
    // 0.01/300 and validate_core Part A must be able to pin it.
    priceMin: 0.001,
    priceMax: 600,
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
    h.Lsub = Lsub(h.Cfood, cfg.kappa, cfg.c, cfg.foodModel);
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
  // (its "downtown"); world.cities holds the reps, world.Aof[rep] its
  // agglomerated productivity, world.transport[rep] its multi-source distances.
  //
  // The rep is the cluster's OLDEST urban tile (world.urbanSince), NOT its
  // densest one: growing a city must never move its downtown, because the rep is
  // the city's identity everywhere else — its id in world.prices/Aof/transport,
  // the key the UI colours it by, and the anchor road projects point at. Density
  // only breaks ties among tiles urbanised on the same tick (e.g. the seeds at
  // t=0). Two clusters that grow into each other still merge, and the merged city
  // keeps the older of the two downtowns.
  function rebuildClusters(world) {
    var hexes = world.hexes, seen = {}, clusters = [];
    var us = world.urbanSince || (world.urbanSince = {});
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
      // rep = oldest urban tile; ties -> densest (most urban neighbours) -> lowest index
      var rep = -1, repAge = Infinity, repDeg = -1;
      for (var t = 0; t < tiles.length; t++) {
        var ti = tiles[t], age = (us[ti] != null) ? us[ti] : 0;
        var deg = 0, nb2 = neighborsOf(world, ti);
        for (var q = 0; q < nb2.length; q++) if (hexes[nb2[q]].isCity) deg++;
        if (age < repAge || (age === repAge && (deg > repDeg || (deg === repDeg && ti < rep)))) {
          repAge = age; repDeg = deg; rep = ti;
        }
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
  // Local draw around a candidate town site, over the radius-`radius` ball.
  // metric 'farmers' -> total farmer MASS (legacy).
  // metric 'surplus' -> total SPARE food: what the land grows minus what its own farmers
  //   eat. This is what can actually feed a town, and it is the gate cfg.newCoreGate
  //   defaults to (crops_spec §6.3). Under the marginal cap the two diverge hard by
  //   design: the rule's whole purpose is fewer farmers per tile, so farmer mass stops
  //   tracking "can this place support a town" — which is how a site with 2500 farmers
  //   but no spare grain ignited an 8-worker town that then priced itself to P=306.
  function localDraw(world, i, radius, metric) {
    var surplus = (metric === 'surplus');
    var val = function (ht) {
      if (ht.isCity || !ht.passable) return 0;
      if (!surplus) return ht.Lmkt + ht.Lsubw;
      var L = ht.Lmkt + ht.Lsubw;
      if (L <= 0) return 0;
      return Math.max(0, Ffood(ht.Cfood, L, world.cfg.kappa, world.cfg.foodModel) - L * world.cfg.c);
    };
    if (world.dirCost) {                 // planet: BFS the hop-ball (avoid O(n) scan/tile)
      var sum0 = 0, seen = {}, frontier = [i], depth = 0, rad = Math.max(1, Math.round(radius));
      seen[i] = true;
      while (frontier.length && depth <= rad) {
        var next = [];
        for (var f = 0; f < frontier.length; f++) {
          var t = frontier[f];
          sum0 += val(world.hexes[t]);
          if (depth < rad) { var nbf = world.adj[t];
            for (var m = 0; m < nbf.length; m++) if (!seen[nbf[m]]) { seen[nbf[m]] = true; next.push(nbf[m]); } }
        }
        frontier = next; depth++;
      }
      return sum0;
    }
    var sum = 0, h0 = world.hexes[i];
    for (var j = 0; j < world.hexes.length; j++) {
      if (axialDist(h0, world.hexes[j]) <= radius) sum += val(world.hexes[j]);
    }
    return sum;
  }
  function localFarmers(world, i, radius) { return localDraw(world, i, radius, 'farmers'); }

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
    if (!world.urbanSince) world.urbanSince = {}; // tick each tile turned urban -> sticky downtown
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
      var coreMetric = (cfg.newCoreGate === 'farmers') ? 'farmers' : 'surplus';
      var bestCore = -1, bestPot = (coreMetric === 'farmers') ? cfg.newCoreMinFarmers : cfg.newCoreMinSurplus;
      for (var i = 0; i < hexes.length; i++) {
        var h = hexes[i]; if (!h.passable || h.isCity || !canFlip(i, true)) continue;
        var dCity = Infinity;
        for (var r = 0; r < world.cities.length; r++) dCity = Math.min(dCity, physDist(world, i, world.cities[r]));
        if (dCity < cfg.newCoreMinDist) continue;
        var pot = localDraw(world, i, 2, coreMetric);
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
      // urbanSince drives the sticky downtown (see rebuildClusters). A tile that
      // reverts loses its age, so re-growing a shrunk fringe can't hijack downtown.
      if (fl.urban) { if (world.urbanSince[fl.i] == null) world.urbanSince[fl.i] = world.tick; }
      else delete world.urbanSince[fl.i];
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

  // ---- Max farmer population per hex: L where MARGINAL product = c ----------
  // MARGINAL, not average. The old rule (F(L) = L*c -- keep adding people until the
  // COLLECTIVE just feeds itself) let a tile pack in nearly C/c farmers, because the
  // only ceiling is total yield / appetite. That is what carpeted the map. Stopping
  // where the NEXT worker's own output falls to c is far tighter:
  //     C*kappa/(L+kappa)^2 = c   =>   L = sqrt(C*kappa/c) - kappa
  // Closed form (no bisection), sublinear in C, and it self-generates the viability
  // cliff at C <= kappa*c with no special-casing. Rich land still fits ~8x what poor
  // land does; it just no longer fits EVERYONE.
  //
  // TENURE: a marginal cap leaves visible spare food on the tile (F(L) > L*c), so it
  // only holds where someone can EXCLUDE the next hungry arrival. This is a deliberate
  // world-model commitment -- enclosed land, not open commons. See surplus handling in
  // step(): that spare food ships to a basin city or rots.
  // model 'legacy' = the reference core's AVERAGE rule: keep adding people until the
  // COLLECTIVE just feeds itself, F(L) = L*c, solved by bisection (no closed form for
  // the exponential yield). Only reachable via foodModel:'legacy'.
  function Lsub(C, kappa, c, model) {
    if (C <= kappa * c) return 0;
    if (model === 'legacy') {
      // bracket [0, max(50, C/c)]: C/c is the absolute ceiling (a tile cannot feed more
      // than it grows). 50 reproduces the reference core's own bracket at its scale.
      var lo = 0, hi = Math.max(50, C / c);
      for (var i = 0; i < 50; i++) {
        var L = 0.5 * (lo + hi);
        if (C * (1 - Math.exp(-L / kappa)) > L * c) lo = L; else hi = L;
      }
      return 0.5 * (lo + hi);
    }
    return Math.sqrt(C * kappa / c) - kappa;
  }
  // RESIDUAL room on a tile already worked by Lmkt market farmers. Market labour stops
  // where MPL = c + w/nb; subsisters have neither wage nor market, so they stop where
  // MPL = c -- strictly further along the SAME curve. Since marginal product depends
  // only on TOTAL labour, the stopping point is Lsub(C) regardless of Lmkt, and the
  // room left is simply the gap.
  //
  // Under the marginal rule the old shared-curve and legacy-independent formulations
  // COINCIDE (the exponential's memorylessness trick, C*exp(-Lmkt/kappa), was only ever
  // needed to avoid double-counting under the average rule). cfg.subsistenceShare is
  // therefore inert now; kept so existing configs/sweeps still load.
  function residualSub(C, Lmkt, kappa, c, model) {
    return Math.max(0, Lsub(C, kappa, c, model) - Lmkt);
  }
  function subRoomTile(world, h, Lmkt) {
    var cfg = world.cfg;
    return residualSub(h.Cfood, Lmkt, cfg.kappa, cfg.c, cfg.foodModel);
  }

  // ============================================================================
  //  BASINS: who is allowed to buy this tile's grain, and who actually does
  // ============================================================================
  // Map a possibly-stale city id to the cluster rep that currently represents it.
  // A growing city's rep can move between ticks (rebuildClusters), so any id held
  // across a tick boundary — h.basin, a merchant route — must be remapped before use.
  function liveRep(world, k) {
    if (k == null || k < 0) return -1;
    var h = world.hexes[k];
    if (!h) return -1;
    if (world.transport[k]) return k;                    // still a rep
    if (h.isCity && h.clusterRep != null && world.transport[h.clusterRep]) return h.clusterRep;
    return -1;
  }

  // ELIGIBILITY — the contiguity clamp (cfg.basinAdjacency). world.eligible[i] is the
  // list of cities tile i may sell to THIS tick:
  //   * the city it already sells to (allegiance persists),
  //   * any city whose own tiles touch it,
  //   * any city an adjacent LAND tile already sells to.
  // So a basin advances one ring per tick and a price spike buys one ring, not a map.
  // Water is not a conductor here on purpose — see cfg.basinAdjacency. With the clamp
  // off, every city is eligible everywhere (the legacy winner-take-all scan).
  function computeBasinEligibility(world) {
    var hexes = world.hexes, n = hexes.length;
    if (!world.cfg.basinAdjacency) { world.eligible = null; return; }
    var elig = new Array(n);
    for (var i = 0; i < n; i++) {
      var h = hexes[i];
      if (h.isCity || !h.passable) { elig[i] = null; continue; }
      var set = null;   // lazily allocated: most tiles see 1-3 cities, not 32
      var add = function (k) {
        if (k < 0) return;
        if (!set) set = [];
        for (var q = 0; q < set.length; q++) if (set[q] === k) return;
        set.push(k);
      };
      add(liveRep(world, h.basin));                       // keep your buyer
      var nb = neighborsOf(world, i);
      for (var m = 0; m < nb.length; m++) {
        var g = hexes[nb[m]];
        if (g.isCity) add(liveRep(world, g.clusterRep != null ? g.clusterRep : nb[m]));
        else if (g.passable) add(liveRep(world, g.basin));  // word from a neighbouring farm
      }
      elig[i] = set;
    }
    world.eligible = elig;
  }
  // Cities a tile may consider. null eligibility (clamp off) = all of them.
  function eligibleFor(world, i) {
    if (!world.eligible) return world.cities;
    return world.eligible[i] || EMPTY;
  }
  var EMPTY = [];

  // ASSIGN — each tile commits to ONE buyer for the whole tick, using last tick's
  // prices. Sets h.basin, h.tcost (transport to that buyer) and h.isDessert. After
  // this, a city's supply is a function of its OWN price alone, which is what makes
  // the per-city bisections independent and kills the winner-take-all riser.
  //
  // Stickiness: a tile only re-shops when its buyer's price has moved more than
  // stickyPriceTol, when its eligible set changed, when transport was recomputed, or
  // on its staggered periodic refresh. Otherwise it keeps last tick's buyer — cheaper
  // and, for a classical-era farmer, truer.
  function assignBasins(world, Pprev) {
    var cfg = world.cfg, hexes = world.hexes;
    if (!world.basinPriceSeen) world.basinPriceSeen = {};   // per-tile: buyer's price when last shopped
    var sticky = cfg.stickyBasins;
    for (var i = 0; i < hexes.length; i++) {
      var h = hexes[i];
      if (h.isCity || !h.passable) continue;
      var cur = liveRep(world, h.basin);
      // --- may we keep last tick's decision? ---
      if (sticky && cur >= 0 && !world.transportDirty) {
        var seen = world.basinPriceSeen[i], now = Pprev[cur];
        var moved = (seen == null || now == null) ? true
                  : Math.abs(now - seen) > cfg.stickyPriceTol * Math.max(1e-9, seen);
        var due = ((world.tick + i) % Math.max(1, cfg.stickyRefresh)) === 0;
        if (!moved && !due) {
          // Still must recheck that the buyer is worth selling to at all — a tile whose
          // netback went negative drops out of the market even if it didn't re-shop.
          var tk = world.transport[cur] ? world.transport[cur][i] : Infinity;
          if (isFinite(tk)) {
            var nk = netbackOf(cfg, Pprev[cur], tk);
            if (nk.v > 0) { h.basin = cur; h.tcost = tk; h.netback = nk.v; h.isDessert = nk.dessert; continue; }
          }
        }
      }
      // --- re-shop over the eligible cities ---
      var cand = eligibleFor(world, i);
      var best = -Infinity, bk = -1, bt = Infinity, bd = false;
      for (var ci = 0; ci < cand.length; ci++) {
        var kk = cand[ci];
        var t = world.transport[kk] ? world.transport[kk][i] : Infinity;
        if (!isFinite(t)) continue;
        var nb = netbackOf(cfg, Pprev[kk] != null ? Pprev[kk] : 1, t);
        if (nb.v > best) { best = nb.v; bk = kk; bt = t; bd = nb.dessert; }
      }
      // BASIN HYSTERESIS — stay put unless a rival beats the incumbent by basinHyst.
      // Stops the tick-to-tick flip-flop between two near-tied cities.
      if (cur >= 0 && cur !== bk && world.transport[cur]) {
        var tc = world.transport[cur][i];
        if (isFinite(tc)) {
          var nbc = netbackOf(cfg, Pprev[cur] != null ? Pprev[cur] : 1, tc);
          if (nbc.v > 0 && best <= nbc.v * (1 + cfg.basinHyst)) { best = nbc.v; bk = cur; bt = tc; bd = nbc.dessert; }
        }
      }
      if (best > 0 && bk >= 0) {
        h.basin = bk; h.tcost = bt; h.netback = best; h.isDessert = bd;
        world.basinPriceSeen[i] = Pprev[bk];
      } else {
        h.basin = -1; h.tcost = Infinity; h.netback = -Infinity; h.isDessert = false;
        delete world.basinPriceSeen[i];
      }
    }
    // City tiles fish for their OWN city (distance 0 — nobody outbids that).
    for (var c = 0; c < world.cities.length; c++) {
      var cl = world.clusterOf[world.cities[c]];
      for (var t2 = 0; t2 < cl.tiles.length; t2++) {
        var ht = hexes[cl.tiles[t2]];
        if ((ht.fishCap || 0) > 0) { ht.basin = cl.rep; ht.tcost = 0; ht.isDessert = false; }
      }
    }
  }

  // ============================================================================
  //  GRANARIES — the continuous term that makes a clearing price EXIST
  // ============================================================================
  // Target stock, in food. Uses last tick's workforce (this tick's is what we're
  // solving for), so it is deliberately lagged by one tick.
  function storageTarget(world, k) {
    var cfg = world.cfg;
    return cfg.storageDays * cfg.c * (world.cityN[k] || 0);
  }
  // The granary's NET DEMAND at price P. TWO motives, and both are needed:
  //
  //   RESTOCK  — it wants to hold `storageDays` of food. The emptier it is, the harder
  //              it buys. Without this the granary never fills at all: its price memory
  //              is an EMA of the price it actually sees, so at equilibrium remembered
  //              == actual, the price motive is exactly zero, and a pure price-timer
  //              sits empty forever (measured: stock 0 against a target of 120,708).
  //              An empty granary buffers nothing and gives merchants nothing to ship.
  //   TIMING   — it buys below the remembered price and sells above it. This is the part
  //              that damps shocks, and the part that is CONTINUOUS in P.
  //
  // Strictly DECREASING in P either way (restock is P-independent, timing falls with P,
  // and clamping preserves monotonicity), which is what the bisection needs. Unlike farm
  // supply it is continuous, so excess demand actually crosses zero somewhere.
  // How much ABOVE its own appetite city k tries to buy this tick (cfg.foodPolicy:'overshoot').
  // Full reserves => 0, i.e. aim to hit demand exactly. Short reserves => cfg.overshoot,
  // tapered over the last `overshootBand` of the granary so the switch at "full" cannot
  // chatter. Depends only on LAST tick's stock, never on P — so the demand curve it scales
  // stays monotone in P and the bisection is untouched.
  function overshootOf(world, k) {
    var cfg = world.cfg;
    if (cfg.foodPolicy !== 'overshoot' || !cfg.storage) return 0;
    var target = storageTarget(world, k);
    if (!(target > 0)) return 0;
    var stock = world.stock[k] || 0;
    var band = cfg.overshootBand;
    if (!(band > 0)) return stock >= target ? 0 : cfg.overshoot;   // literal hard switch
    var shortfallFrac = (target - stock) / (band * target);        // 0 at full, 1 once band-deep
    return cfg.overshoot * clamp(shortfallFrac, 0, 1);
  }
  function storageBid(world, k, P) {
    var cfg = world.cfg;
    if (!cfg.storage) return 0;
    var ref = world.priceEma[k];
    if (ref == null || !(ref > 0)) return 0;
    var target = storageTarget(world, k);
    if (!(target > 0)) return 0;                     // a city with no mouths keeps no granary
    var stock = world.stock[k] || 0;
    var lim = cfg.storageRate * target;              // most it will move either way this tick
    var timing = (ref - P) / ref;                    // >0 cheap => buy;  <0 dear => sell
    // RESTOCK, faded out as grain gets dear. A half-empty granary still wants filling,
    // but not during a famine — and adding the two motives flat let the restock term
    // cancel most of the release exactly when the release was the point (measured: a
    // granary holding 5.6 days of food released only 137 against a 441 shortfall, and the
    // price spiked 69% anyway). A reserve exists to be drawn down. The weight ramps
    // linearly to zero as P rises to 2x remembered, which keeps q both CONTINUOUS and
    // monotone decreasing in P — the two properties the bisection actually needs.
    var restockWeight = clamp(1 + timing, 0, 1);
    // Under foodPolicy:'overshoot' the CITY does the restocking (see overshootOf), so the
    // granary must not ALSO bid for it or the two double-count.
    var restock = (cfg.foodPolicy === 'overshoot') ? 0
                : cfg.storageFill * ((target - stock) / target) * restockWeight;
    var q = lim * clamp(restock + timing, -1, 1);
    var buyMax = Math.min(lim, Math.max(0, target - stock));
    var sellMax = Math.min(lim, stock);
    var bid = clamp(q, -sellMax, buyMax);
    // ...but the SELL side is not optional, under any policy. The granary drains physically
    // whether or not it bids, yet if it does not OFFER its grain the price solver cannot see
    // it, and a single missed delivery pins the price at priceMax with a full granary
    // sitting in the city. Measured with the sell side removed: an import-fed city hit the
    // 600 cap on ~1 tick in 6 (mean price 101.8 against a true equilibrium of 2.16), while
    // the same city with a selling granary peaked at 2.78 on its dry ticks.
    // So: 'overshoot' folds BUYING into the city's demand, and leaves SELLING here.
    return (cfg.foodPolicy === 'overshoot') ? Math.min(0, bid) : bid;
  }

  // A granary is keyed by its city's cluster rep, and a rep can STOP being a city two
  // ways: the city is removed, or two cities grow into each other and one rep loses the
  // merge. Both used to just `delete world.stock[rep]`, which silently destroyed the
  // grain — it never appeared in the conservation identity, so food vanished off the
  // books. Merges happen in ordinary play, so this was a live leak, not an edge case.
  //
  // Now: a merged-away granary is INHERITED by the cluster that absorbed it (the grain is
  // still in the same city, the city just has one downtown now), and a destroyed city's
  // granary is spilled — returned as waste so the identity still balances.
  function reconcileGranaries(world) {
    var orphaned = 0;
    for (var k in world.stock) {
      if (world.Aof[k] != null) continue;                 // still a live city: keep
      var lost = world.stock[k] || 0;
      var h = world.hexes[k];
      var heir = (h && h.isCity && h.clusterRep != null && world.Aof[h.clusterRep] != null)
        ? h.clusterRep : -1;
      if (heir >= 0) world.stock[heir] = (world.stock[heir] || 0) + lost;   // absorbed by the merge
      else orphaned += lost;                                                // city gone: it spoils
      delete world.stock[k];
    }
    for (var e in world.priceEma) if (world.Aof[e] == null) delete world.priceEma[e];
    for (var b in world.lastBalance) if (world.Aof[b] == null) delete world.lastBalance[b];
    return orphaned;
  }

  // ============================================================================
  //  MERCHANTS — city -> city arbitrage on LAGGED prices
  // ============================================================================
  // Plans this tick's caravans from LAST tick's prices and last tick's realised
  // surplus/deficit. Returns { imports:{k:qty}, exports:{k:qty}, routes:[...] }.
  // Because the plan is fixed before the solve, each city's merchant inflow is a
  // CONSTANT w.r.t. this tick's prices — the per-city bisections stay decoupled.
  function planMerchants(world) {
    var cfg = world.cfg;
    var imports = {}, exports_ = {}, routes = [];
    for (var a = 0; a < world.cities.length; a++) { imports[world.cities[a]] = 0; exports_[world.cities[a]] = 0; }
    if (!cfg.merchants || world.cities.length < 2) return { imports: imports, exports: exports_, routes: routes };

    var bal = world.lastBalance || {};
    var spare = {}, cap = {}, slots = {};
    for (var i = 0; i < world.cities.length; i++) {
      var k = world.cities[i], b = bal[k] || { surplus: 0, deficit: 0 };
      // SPARE — what A's merchants can lay hands on this tick: grain that had no eater
      // at home last tick, plus a draw on the granary at the same rate the granary
      // itself trades. NOT "stock above target": at a cleared equilibrium a city's
      // surplus is ~0 by construction, so that definition made spare==0 everywhere and
      // no caravan ever left. Drawing the granary down is the correct source — the
      // granary then bids to refill, which lifts A's price, which is exactly how the
      // cost of exporting reaches A's farmers.
      // Net out what was carted IN last tick: that grain is not A's "extra", it is a
      // caravan that has not been absorbed yet, and treating it as exportable let a city
      // re-export its own imports the very next tick (the return leg of the period-2
      // cycle above). Grain that has settled into the granary is fair game — that is
      // entrepot trade and it is real — but only at the rate the granary trades.
      var ownSurplus = Math.max(0, b.surplus - (b.imported || 0));
      spare[k] = ownSurplus + cfg.storageRate * (world.stock[k] || 0);
      cap[k] = cfg.merchantCapPerWorker * (world.cityN[k] || 0);
      slots[k] = cfg.merchantRoutes;
    }
    // A city that has not been priced yet is INVISIBLE to merchants, not free. An emergent
    // city is flipped by updateUrbanization at the END of a tick, after the solve, and
    // unlike foundCity it never seeds world.prices — so it has no price until the next
    // solve. Reading that as `prices[k] || 0` made a brand-new town look like it was giving
    // grain away, which is the opposite of the truth (it has none). Skip it for one tick;
    // innerP prices it immediately after.
    var priced = {};
    for (var pk = 0; pk < world.cities.length; pk++) {
      var pkk = world.cities[pk];
      priced[pkk] = (world.prices[pkk] != null && isFinite(world.prices[pkk]));
    }

    // ---- how much does each city want IMPORTED this tick? -------------------
    // Computed per DESTINATION from its own demand curve — not from its realised deficit.
    // That distinction is load-bearing: a starved city has cityN -> 0, so its deficit AND
    // its granary target are both 0, and a deficit-based rule sees "no need" and leaves it
    // to die — it cannot bootstrap because it has no workers, and has no workers because
    // nobody ships it food (measured: N=0, P pinned at the 600 cap, forever).
    //
    // The target is the flow that CLEARS B at the arbitrage-free price: ship
    // `demandAt(B, cheapest delivered cost) - B's own harvest`, and the market then prices
    // B at exactly that, closing the margin and stopping further growth by itself. This is
    // Dan's "fill demand plus storage, then stop" — expressed as the price where stopping
    // happens rather than as a quantity guess.
    //
    // Then approach the target through a FIRST-ORDER LAG (merchantAggression), and compute
    // it per-CITY rather than per-route, so it degrades smoothly when the margin closes.
    // Gating the flow directly on `margin > minMargin` put a cliff in the loop: the entire
    // fleet vanished the tick the margin dipped to 0.017, lastImports reset to 0, the lag
    // restarted from nothing, and the price rang 1.88 <-> 3.21 on a period-5 cycle. Real
    // trade winds down; it does not evaporate.
    var needLeft = {};
    for (var bi0 = 0; bi0 < world.cities.length; bi0++) {
      var Bk = world.cities[bi0];
      if (!priced[Bk]) { needLeft[Bk] = 0; continue; }      // unpriced newborn: skip a tick
      // cheapest delivered cost from any other city => the arbitrage-free price at Bk
      var bestDeliv = Infinity;
      for (var ai0 = 0; ai0 < world.cities.length; ai0++) {
        var Ak = world.cities[ai0];
        if (Ak === Bk || !priced[Ak] || spare[Ak] <= 0 || cap[Ak] <= 0) continue;
        var t0 = world.transport[Bk] ? world.transport[Bk][Ak] : Infinity;
        if (!isFinite(t0)) continue;
        bestDeliv = Math.min(bestDeliv, (world.prices[Ak] || 0) + t0);
      }
      var last = (world.lastImports && world.lastImports[Bk]) || 0;
      var want = 0;
      if (isFinite(bestDeliv) && (world.prices[Bk] || 0) > bestDeliv + cfg.merchantMinMargin) {
        var arbFree = bestDeliv + cfg.merchantMinMargin;
        var localSupply = (world.lastDelivered && world.lastDelivered[Bk]) || 0;
        // Ship what B can EAT NEXT TICK, not what it would eat once fully grown.
        // demandAt returns the equilibrium workforce's appetite, but cityN only migrates
        // `migrate` of the way toward that per tick — so aiming at the equilibrium lands
        // grain the city has not yet grown the mouths to eat, and the surplus pushes the
        // price straight past the target. Feed-forward through the same migration lag the
        // tick will actually apply.
        var Ntarget = demandAt(world, Bk, arbFree) / cfg.c;
        var Nnow = world.cityN[Bk] || 0;
        var Nnext = Nnow + clamp(cfg.migrate, 0.02, 1) * (Ntarget - Nnow);
        var targetFlow = Math.max(0, cfg.c * Nnext - localSupply);
        // Granary room is capped at the granary's OWN per-tick appetite (storageRate x
        // target), not the whole empty volume. A granary with 8 days of room does not want
        // 8 days of grain delivered this afternoon — storageBid only ever moves storageRate
        // of target per tick, so offering the full room let caravans deliver ~4x what the
        // city could absorb and the price overshot straight through the floor (measured:
        // 0.82 <-> 320.6, period 2). Merchants and the granary must agree on the same rate.
        var tgt = storageTarget(world, Bk);
        var room = Math.min(Math.max(0, tgt - (world.stock[Bk] || 0)), cfg.storageRate * tgt);
        want = targetFlow + room;
      }
      needLeft[Bk] = Math.max(0, last + cfg.merchantAggression * (want - last));
    }

    // ---- route it: highest margin first ------------------------------------
    // Routes need only be PROFITABLE (margin > 0) to carry the smoothed need; minMargin
    // gates whether the trade is worth GROWING (above), not whether an existing caravan
    // finishes its journey. Highest-margin sources win the slots — Dan's "filled by
    // whichever merchants can get there with the highest margins".
    var cands = [];
    for (var ai = 0; ai < world.cities.length; ai++) {
      var A = world.cities[ai];
      if (!priced[A] || spare[A] <= 0 || cap[A] <= 0) continue;
      for (var bi = 0; bi < world.cities.length; bi++) {
        var B = world.cities[bi];
        if (A === B || !priced[B] || needLeft[B] <= 1e-9) continue;
        // transport[B][A] = cost to ship one unit FROM tile A TO city B. Already
        // computed for the farm market — merchants ride the same roads and sea lanes.
        var t = world.transport[B] ? world.transport[B][A] : Infinity;
        if (!isFinite(t)) continue;
        var margin = (world.prices[B] || 0) - (world.prices[A] || 0) - t;
        if (margin <= 0) continue;
        cands.push({ a: A, b: B, margin: margin, t: t });
      }
    }
    cands.sort(function (x, y) { return y.margin - x.margin; });
    for (var ci = 0; ci < cands.length; ci++) {
      var r = cands[ci];
      if (slots[r.b] <= 0 || spare[r.a] <= 1e-9 || cap[r.a] <= 1e-9 || needLeft[r.b] <= 1e-9) continue;
      var qty = Math.min(spare[r.a], needLeft[r.b], cap[r.a]);
      if (qty <= 1e-9) continue;
      spare[r.a] -= qty; needLeft[r.b] -= qty; cap[r.a] -= qty; slots[r.b]--;
      exports_[r.a] += qty; imports[r.b] += qty;
      routes.push({ from: r.a, to: r.b, qty: qty, margin: r.margin, cost: r.t });
    }
    return { imports: imports, exports: exports_, routes: routes };
  }
  // Food city k would buy per tick at price P, at last tick's shadow wage. This is the
  // same NofCity the solver uses, so merchants and the price bisection agree about what
  // a city wants — they just consult it at different prices.
  function demandAt(world, k, P) {
    var cfg = world.cfg, S = world.solverConst;
    if (!(P > 0) || world.Aof[k] == null) return 0;
    var w = world.lastW || 0;
    // MUST apply the same overshoot innerP does, or merchants size their caravans against
    // a demand curve the market does not actually have. Measured when they disagreed: the
    // destination demanded (1+ov)x while merchants shipped 1x, so it was permanently
    // under-supplied and its price ran to 101.8 against a true equilibrium of ~2.2 — a 47x
    // error out of a 5% mismatch, because demand is P^-2.857 and tiny quantity errors
    // become enormous price errors. Any consumer of "what does city k want" must go
    // through here.
    return cfg.c * NofCity(world.Aof[k], w + P * cfg.c, S.Z, S.alpha, S.pconc) * (1 + overshootOf(world, k));
  }

  // ============================================================================
  //  EQUILIBRIUM SOLVER  (ported verbatim in spirit from hex_economy_v2_core.js)
  // ============================================================================
  // Food produced by L workers on a tile of total-possible-yield C.
  // Michaelis-Menten: F -> C as L -> infinity, F' = C*kappa/(L+kappa)^2.
  // (Was C*(1-exp(-L/kappa)). MM's fatter tail is what makes the marginal cap
  // below sublinear in C rather than pinned just under the C/c ceiling.)
  function Ffood(C, L, kappa, model) {
    if (C <= 0 || L <= 0) return 0;
    if (model === 'legacy') return C * (1 - Math.exp(-L / kappa));   // reference core
    return C * L / (L + kappa);
  }
  // Market farming on hex with capacity C, netback nb, wage w.
  // Hire until marginal product = marginal cost m = c + w/nb (unchanged rule --
  // the exponential form solved exactly this). With MM, MPL = C*kappa/(L+kappa)^2 = m
  // gives the closed form below; E = sqrt(kappa*m/C) plays the role the old
  // E = (c + w/nb)*kappa/C played, including the E>=1 "not worth farming" guard.
  function mkt(C, nb, w, kappa, c, model) {
    if (nb <= 0 || C <= 0) return { L: 0, F: 0 };
    if (model === 'legacy') {                       // reference core's exponential form
      var El = (c + w / nb) * kappa / C;
      if (El >= 1) return { L: 0, F: 0 };
      return { L: -kappa * Math.log(El), F: C * (1 - El) };
    }
    var E = Math.sqrt(kappa * (c + w / nb) / C);
    if (E >= 1) return { L: 0, F: 0 };
    return { L: kappa * (1 / E - 1), F: C * (1 - E) };
  }
  // ---- Netback: what one unit of this tile's food is worth at the FARM GATE ----
  // Food ships raw:      value/food = P - t
  // Dessert ships dense: X food -> 1 unit shipped at cost t, sold for m*X*P
  //                      value/food = (m*X*P - t)/X
  // The tile takes whichever is higher. Crucially BOTH still carry the -t term, so a
  // dessert tile is still priced by its distance to a city -- this is what separates
  // desserts from a flat food->gold conversion, which would put a FLOOR under netback
  // at every tile on the map and dissolve the basins entirely.
  //
  // Monotonicity (the bisection depends on it): with the premium pinned to P, the
  // food/dessert switch distance d* = X*P*(1-m)/(K0*(X-1)) is PROPORTIONAL to P, so a
  // higher food price pushes the boundary OUTWARD -- fewer dessert tiles, more food.
  // Self-correcting, and it keeps excess demand monotone in P (see displaceOf).
  function netbackOf(cfg, P, t) {
    var food = P - t;
    if (!cfg.desserts) return { v: food, dessert: false };
    var X = cfg.dessertX;
    if (!(X > 1)) return { v: food, dessert: false };
    var des = (cfg.dessertPremium * X * P - t) / X;
    return des > food ? { v: des, dessert: true } : { v: food, dessert: false };
  }
  // City food demand displaced by `qty` desserts, richest-consumer-first. Clamped to
  // D <= dessertX (above that a dessert would free more food than it consumed -- a pump)
  // and to the food the cohort actually eats (can't displace demand that isn't there).
  function displaceOf(cfg, qty, foodDemand) {
    if (!cfg.desserts || qty <= 0) return 0;
    var D = clamp(cfg.dessertDisplace, 0, cfg.dessertX);
    return Math.min(D * qty, Math.max(0, foodDemand));
  }

  // City workforce at "total reservation" T = w + P*c :  y_margin(N)=T.
  function NofCity(A, T, Z, alpha, pconc) {
    if (T <= 0) return 1e12;
    return Math.pow(T * Z / A, 1 / (alpha - pconc));
  }

  // ---- one tile's offer to its assigned buyer, at that buyer's price P ----------
  // With stickyBasins the buyer is fixed for the tick (h.basin) and the tile's whole
  // response to price runs through this one function. With the clamp/stickiness OFF
  // the caller falls back to the legacy scan-every-city path.
  function tileOffer(world, h, P, w) {
    var cfg = world.cfg;
    var cap = foodCapOf(h);
    if (cap <= 0 || h.basin < 0) return null;
    var nb = netbackOf(cfg, P, h.tcost);
    if (!(nb.v > 0)) return null;
    var f = mkt(cap, nb.v, w, cfg.kappa, cfg.c, cfg.foodModel);
    return { L: f.L, surplus: Math.max(0, f.F - f.L * cfg.c), dessert: nb.dessert, nb: nb.v };
  }
  // Legacy scan: the tile re-auctions to every ELIGIBLE city at the live price vector,
  // every bisection round. Kept so stickyBasins:false reproduces the old engine (with
  // basinAdjacency:false too, that is the exact pre-2026-07-16 behaviour the gates pin).
  // `hyst` applies basin hysteresis against h.basin — the old engine did this in step()
  // but NOT in innerP, and that asymmetry was itself a documented glut source, so the
  // flag preserves it rather than quietly fixing it.
  function tileOfferScan(world, h, P, w, hyst) {
    var cfg = world.cfg;
    var cap = foodCapOf(h); if (cap <= 0) return null;
    var cand = eligibleFor(world, h.i);
    if (h.isCity) cand = world.cities;           // a city tile's catch is not clamped
    var bestv = -Infinity, bk = -1, bestDes = false, bt = Infinity;
    for (var ci = 0; ci < cand.length; ci++) {
      var kk = cand[ci];
      var t = world.transport[kk] ? world.transport[kk][h.i] : Infinity;
      if (!isFinite(t)) continue;
      var nbk = netbackOf(cfg, P[kk], t);
      if (nbk.v > bestv) { bestv = nbk.v; bk = kk; bestDes = nbk.dessert; bt = t; }
    }
    if (hyst) {
      var cur = liveRep(world, h.basin);
      if (cur >= 0 && cur !== bk && world.transport[cur]) {
        var tc = world.transport[cur][h.i];
        if (isFinite(tc)) {
          var nbc = netbackOf(cfg, P[cur], tc);
          if (nbc.v > 0 && bestv <= nbc.v * (1 + cfg.basinHyst)) { bestv = nbc.v; bk = cur; bestDes = nbc.dessert; bt = tc; }
        }
      }
    }
    if (!(bestv > 0) || bk < 0) return null;
    var f = mkt(cap, bestv, w, cfg.kappa, cfg.c, cfg.foodModel);
    return { L: f.L, surplus: Math.max(0, f.F - f.L * cfg.c), dessert: bestDes, nb: bestv, k: bk, t: bt };
  }

  // Inner: per-city price bisection to clear each city food market.
  // crewFood[k] (>=0) adds crew/garrison mouths stationed at city k.
  // trade = { imports, exports } from planMerchants: caravans committed on LAST tick's
  // prices, so they are constants here and do not couple the cities' bisections.
  //
  // Each city's excess demand at its own price P:
  //     ED(P) = [ c*N(w + P*c) + crew - displaced(desserts) + exports + granaryBid(P) ]
  //           - [ farm surplus assigned to this city at P  + imports ]
  // Every P-dependent term is monotone the right way (demand falls, supply rises), and
  // granaryBid is CONTINUOUS — so ED actually crosses zero instead of jumping over it.
  function innerP(world, w, Pprev, crewFood, trade) {
    var cfg = world.cfg, S = world.solverConst;
    var cities = world.cities, hexes = world.hexes;
    var sticky = cfg.stickyBasins;
    var P = {}, lo = {}, hi = {};
    for (var a = 0; a < cities.length; a++) {
      var k = cities[a];
      P[k] = (Pprev && Pprev[k] != null) ? Pprev[k] : 1;
      lo[k] = cfg.priceMin; hi[k] = cfg.priceMax;
    }
    for (var rd = 0; rd < cfg.priceRounds; rd++) {
      var sup = {}, desQ = {};
      for (var b = 0; b < cities.length; b++) { sup[cities[b]] = 0; desQ[cities[b]] = 0; }
      for (var hi2 = 0; hi2 < hexes.length; hi2++) {
        var h = hexes[hi2];
        var o, bk;
        if (sticky) {
          if (h.basin < 0 || P[h.basin] == null) continue;
          o = tileOffer(world, h, P[h.basin], w); bk = h.basin;
        } else {
          o = tileOfferScan(world, h, P, w); if (o) bk = o.k;
        }
        if (!o) continue;
        // A dessert tile ships NO food -- its surplus leaves as desserts, which only
        // touch the food market via displacement below.
        if (o.dessert) desQ[bk] += o.surplus / cfg.dessertX;
        else sup[bk] += o.surplus;
      }
      for (var ci2 = 0; ci2 < cities.length; ci2++) {
        var key = cities[ci2];
        var extra = crewFood ? (crewFood[key] || 0) : 0;
        var dem = cfg.c * (NofCity(world.Aof[key], w + P[key] * cfg.c, S.Z, S.alpha, S.pconc) + extra);
        dem -= displaceOf(cfg, desQ[key], dem);   // richest-first: desserts eaten instead of food
        if (trade) { dem += trade.exports[key] || 0; sup[key] += trade.imports[key] || 0; }
        // 'overshoot': the city buys a margin above its own appetite while reserves are
        // short. 'granary': the granary bids for that margin itself. EITHER WAY the granary
        // still offers its stock for sale at a high price (storageBid's sell side, which is
        // all it returns under 'overshoot') — that is what keeps the price off the cap when
        // a delivery is missed, and it is also the continuous term the bisection wants.
        if (cfg.foodPolicy === 'overshoot') dem *= (1 + overshootOf(world, key));
        dem += storageBid(world, key, P[key]);
        if (dem - sup[key] > 0) lo[key] = P[key]; else hi[key] = P[key];
        P[key] = 0.5 * (lo[key] + hi[key]);
      }
    }
    return P;
  }

  // Formal labor demand (market farmers + city workers) at wage w.
  function formal(world, w, Pprev, crewFood, trade) {
    var cfg = world.cfg, S = world.solverConst;
    var P = innerP(world, w, Pprev, crewFood, trade);
    var Lm = 0, Nc = 0, hexes = world.hexes;
    var sticky = cfg.stickyBasins;
    var mktL = new Float64Array(hexes.length);
    for (var i = 0; i < hexes.length; i++) {
      var h = hexes[i];
      var o = sticky
        ? ((h.basin >= 0 && P[h.basin] != null) ? tileOffer(world, h, P[h.basin], w) : null)
        : tileOfferScan(world, h, P, w);
      if (o) { Lm += o.L; mktL[h.i] = o.L; }
    }
    for (var c2 = 0; c2 < world.cities.length; c2++) {
      var key = world.cities[c2];
      Nc += NofCity(world.Aof[key], w + P[key] * cfg.c, S.Z, S.alpha, S.pconc);
    }
    return { P: P, Lm: Lm, Nc: Nc, formal: Lm + Nc, mktL: mktL };
  }

  // Solve for equilibrium given pool Npool and mouths committed to roads.
  // Returns targets {w, P, Lm, Nc, mktL, subs, room, byCityN}.
  function solveEquilibrium(world, Npool, Pprev, crewFood, trade) {
    var cfg = world.cfg, S = world.solverConst;
    if (world.cities.length === 0) {
      // no cities: everyone subsists on viable land (no market labour yet -> full Lsub)
      var subRoom0 = 0;
      for (var i = 0; i < world.hexes.length; i++) if (!world.hexes[i].isCity) subRoom0 += world.hexes[i].Lsub;
      return { w: 0, P: {}, Lm: 0, Nc: 0, mktL: new Float64Array(world.hexes.length),
               subs: Math.min(Npool, subRoom0), room: Math.max(0, subRoom0 - Npool), byCityN: {} };
    }
    var f0 = formal(world, 1e-5, Pprev, crewFood, trade);
    var out;
    if (f0.formal >= Npool) {
      var wlo = 1e-5, whi = 200, P = Pprev;
      for (var it = 0; it < cfg.wIters; it++) {
        var wm = 0.5 * (wlo + whi);
        var f = formal(world, wm, P, crewFood, trade); P = f.P;
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
      // ---- granaries & trade (see the storage / merchants blocks in DEFAULTS) ----
      stock: {},          // rep -> food currently in the city's granary
      priceEma: {},       // rep -> the price this city REMEMBERS (adaptive expectations)
      cityN: {},          // rep -> city workforce (persistent, blended toward the solve)
      lastBalance: {},    // rep -> { surplus, deficit } realised last tick; what merchants read
      trade: null,        // this tick's caravan plan (imports/exports/routes)
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
    if (!world.urbanSince) world.urbanSince = {};
    if (world.urbanSince[i] == null) world.urbanSince[i] = world.tick || 0;
    if (!h.paved) { h.paved = true; computeCapacity(world, i); world.Ksub = world.hexes.reduce(function (a, hh) { return a + hh.Lsub; }, 0); }  // urbanised land: farmland gone for good
    if (Aexplicit != null) h.explicitA = Aexplicit;   // pin productivity (fidelity tests)
    if (world.prices[i] == null) world.prices[i] = 1.0;
    // A new town starts with an EMPTY granary and no price memory yet — it has to earn
    // both. (priceEma seeds from the first solved price in step(), not from 1.0, so a
    // town founded into an expensive region doesn't spend its first ticks convinced
    // grain is cheap and dumping stock it doesn't have.)
    if (world.stock[i] == null) world.stock[i] = 0;
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
    if (world.urbanSince) delete world.urbanSince[i];
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
    h.Lsub = Lsub(h.Cfood, world.cfg.kappa, world.cfg.c, world.cfg.foodModel);
    for (var k2 = 0; k2 < nb.length; k2++) world.hexes[nb[k2]].Lsub = Lsub(world.hexes[nb[k2]].Cfood, world.cfg.kappa, world.cfg.c, world.cfg.foodModel);
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

    // ---- commit the tick's structure BEFORE solving prices --------------------
    // Order matters and is the whole stability argument:
    //   1. every farm tile picks ONE buyer, using LAST tick's prices (assignBasins);
    //   2. merchants commit caravans, also on LAST tick's prices (planMerchants);
    //   3. only then do prices solve.
    // Both (1) and (2) are therefore CONSTANTS during (3), so each city's excess
    // demand depends on its own price alone and the per-city bisections are exactly
    // independent. Solving any of this jointly with the price is what oscillated.
    // Settle granaries whose city merged away or was destroyed BEFORE anything reads
    // stock — merchants price their routes off it, and the balance below closes on it.
    var orphanWaste = reconcileGranaries(world);
    computeBasinEligibility(world);              // the contiguity clamp (no-op if off)
    if (cfg.stickyBasins) assignBasins(world, world.prices);
    var trade = planMerchants(world);
    world.trade = trade;

    // ---- solve equilibrium for the free pool (pool minus employed roadworkers) ----
    var Nfree = Math.max(0.1, world.N - crewsEmployed - harborTotal);
    var eq = solveEquilibrium(world, Nfree, world.prices, crewFood, trade);
    world.prices = eq.P;
    world.lastW = eq.w;    // next tick's merchants price B's demand curve at this wage
    // Remembered price per city (adaptive expectations) — drives the granary's bid.
    // Seeded from the first solved price, so a new town isn't born with a wrong memory.
    for (var pe = 0; pe < world.cities.length; pe++) {
      var pk = world.cities[pe];
      var prevE = world.priceEma[pk];
      world.priceEma[pk] = (prevE == null) ? eq.P[pk] : prevE + cfg.storageEma * (eq.P[pk] - prevE);
    }

    // ---- migration + subsistence distribution -------------------------------
    // Targets come from the solved equilibrium; actual farmer/city counts flow a
    // fraction `migrate` toward them each tick (1 = instant). Subsistence is the
    // scalar eq.subs distributed across per-hex SLACK (Lsub - market L) so the
    // map fills without over-committing labor (conservation stays exact at rest).
    var mig = clamp(cfg.migrate, 0.02, 1);
    // pass 1: per-hex market target at the SOLVED prices; accumulate slack for subsistence.
    // The buyer (h.basin) was committed before the solve and is NOT revisited here — that
    // is what keeps the tick's realised shipments consistent with the supply the solver
    // priced. When they disagree the difference shows up as glut/shortfall, which is
    // precisely the discontinuity this rework exists to remove.
    var totalSlack = 0;
    var sticky1 = cfg.stickyBasins;
    for (var i2 = 0; i2 < hexes.length; i2++) {
      var h2 = hexes[i2];
      if (h2.isCity) {
        // COASTAL CITY TILE — market FISHING only (no farming, no subsistence). It
        // sells its catch to its own city (distance 0; nobody outbids that).
        var fcap = h2.fishCap || 0;
        if (fcap <= 0) { h2.LmktT = 0; h2.Fmkt = 0; continue; }
        var offF = sticky1 ? ((h2.basin >= 0 && eq.P[h2.basin] != null) ? tileOffer(world, h2, eq.P[h2.basin], eq.w) : null)
                           : tileOfferScan(world, h2, eq.P, eq.w, false);
        if (offF) {
          var capF = foodCapOf(h2);
          var fF = mkt(capF, offF.nb, eq.w, cfg.kappa, cfg.c, cfg.foodModel);
          h2.LmktT = fF.L; h2.Fmkt = fF.F; h2.netback = offF.nb;
          if (!sticky1) { h2.basin = offF.k; h2.tcost = offF.t; }
        } else { h2.LmktT = 0; h2.Fmkt = 0; h2.netback = -Infinity; }
        continue;
      }
      if (!h2.passable) { h2.LmktT = 0; h2.LsubT = 0; h2.Fmkt = 0; h2.basin = -1; continue; }
      var off = sticky1 ? ((h2.basin >= 0 && eq.P[h2.basin] != null) ? tileOffer(world, h2, eq.P[h2.basin], eq.w) : null)
                        : tileOfferScan(world, h2, eq.P, eq.w, true);   // legacy: hysteresis lives here
      if (off) {
        var f = mkt(h2.Cfood, off.nb, eq.w, cfg.kappa, cfg.c, cfg.foodModel);
        h2.LmktT = f.L; h2.Fmkt = f.F; h2.netback = off.nb; h2.isDessert = off.dessert;
        if (!sticky1) { h2.basin = off.k; h2.tcost = off.t; }
      } else {
        h2.LmktT = 0; h2.Fmkt = 0; h2.isDessert = false; h2.netback = -Infinity;
        if (!sticky1) h2.basin = -1;
      }
      totalSlack += subRoomTile(world, h2, h2.LmktT); // desperation room on top of market labour
    }
    // pass 2: distribute subsistence across slack; blend actual mkt & sub labor
    // separately; production/consumption computed from ACTUAL labor so migration
    // is economically real (transient imbalance resolves; conserved at steady state).
    var subs = eq.subs || 0;
    var foodProduced = 0, marketFarmers = 0, subsistence = 0, fishermen = 0;
    var foodWasted = 0, dessertQty = {}, dessertTotal = 0, delivered = 0;
    var landTiles = 0, farmedTiles = 0, farmedOutsideBasin = 0, tileDeficit = 0;
    // PER-CITY deliveries. The old code only tracked a global `delivered`, which made
    // glut a map-wide residual — one city's rotting surplus silently cancelled another's
    // famine. Granaries and merchants are inherently per-city, so the balance has to be too.
    var deliveredBy = {};
    for (var dq = 0; dq < world.cities.length; dq++) { dessertQty[world.cities[dq]] = 0; deliveredBy[world.cities[dq]] = 0; }
    for (var i3 = 0; i3 < hexes.length; i3++) {
      var h3 = hexes[i3];
      if (!h3.passable) continue;
      if (h3.isCity) {
        // coastal city tile: market fishing only (fishermen from the pool, no subsistence)
        if ((h3.fishCap || 0) <= 0) { h3.Lmkt = 0; h3.L = 0; h3.out = 0; continue; }
        h3.Lmkt += (h3.LmktT - h3.Lmkt) * mig; if (h3.Lmkt < 0) h3.Lmkt = 0;
        h3.Lsubw = 0; h3.L = h3.Lmkt;
        var Ff = Ffood(h3.fishCap, h3.Lmkt, cfg.kappa, cfg.foodModel);
        foodProduced += Ff;                              // fish food
        h3.out = Math.max(0, Ff - h3.Lmkt * cfg.c);      // fish surplus feeds the city
        delivered += h3.out;
        if (h3.basin >= 0 && deliveredBy[h3.basin] != null) deliveredBy[h3.basin] += h3.out;
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
      // Market farmers work the tile to MPL = c + w/nb; subsisters pile onto the SAME
      // curve past them, out to MPL = c. Under the marginal rule a subsister no longer
      // "eats exactly what it grows" -- the inframarginal ones grow MORE than c -- so the
      // old `Lsubw * c` shortcut would silently under-count production. Compute both
      // stretches of the curve honestly instead.
      var Ltot = h3.Lmkt + h3.Lsubw;
      var Fm = Ffood(h3.Cfood, h3.Lmkt, cfg.kappa, cfg.foodModel);   // the market operation's output
      var Fsub = Ffood(h3.Cfood, Ltot, cfg.kappa, cfg.foodModel) - Fm;   // extra grown by the subsisters
      foodProduced += Fm + Fsub;
      // A tile should never feed fewer people than it carries. Provably so for market
      // labour: Fm - Lmkt*c > 0 whenever Lmkt <= Lsub = sqrt(C*kappa/c) - kappa, because
      // sqrt(C*kappa/c) < C/c exactly when C > kappa*c -- the viability condition every
      // farmed tile already passes. Lmkt is blended toward LmktT <= Lsub from 0, so it
      // stays inside that bound. Kept as a guard rather than an assert because Lmkt and
      // Lsubw blend INDEPENDENTLY, so their sum has no such proof; a clamp alone would
      // hide the deficit and silently break the balance. Measured: fires 0 times.
      var mktRaw = Fm - h3.Lmkt * cfg.c;
      if (mktRaw < 0) tileDeficit -= mktRaw;
      var mktSurplus = Math.max(0, mktRaw);
      if (h3.isDessert && cfg.desserts) {
        // ships as desserts: X food -> 1 unit. No raw food reaches the city from here.
        var q = mktSurplus / cfg.dessertX;
        dessertQty[h3.basin] = (dessertQty[h3.basin] || 0) + q;
        dessertTotal += q;
        h3.out = 0; h3.dessertOut = q;
      } else {
        h3.out = mktSurplus; h3.dessertOut = 0; delivered += mktSurplus;
        if (h3.basin >= 0 && deliveredBy[h3.basin] != null) deliveredBy[h3.basin] += mktSurplus;
      }
      // Subsisters are OUTSIDE the market by definition (no netback reaches them), so
      // their surplus has no buyer and rots. This is the marginal rule's honest cost:
      // production no longer equals consumption tile-by-tile -- see conservation below.
      var subRaw = Fsub - h3.Lsubw * cfg.c;                  // same lag applies to subsisters
      if (subRaw < 0) tileDeficit -= subRaw;
      else foodWasted += subRaw;
      marketFarmers += h3.Lmkt;
      subsistence += h3.Lsubw;
      // Settlement EXTENT (vs the density the marginal cap controls). A tile with
      // basin < 0 has no city in reach at any price -- its people are the city-less
      // frontier squatters, the thing we are trying not to carpet the map with.
      landTiles++;
      if (h3.Lmkt + h3.Lsubw > 0.5) {
        farmedTiles++;
        if (h3.basin < 0) farmedOutsideBasin++;
      }
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

    // ---- disposal of food delivered beyond what the cities can eat -----------
    // At w=0 the market-supply curve is a STAIRCASE: mkt() reduces to E=sqrt(kappa*c/C),
    // independent of netback, so price only gates WHETHER a tile ships, not how much it
    // grows. Demand generically crosses inside a riser, so no clearing price exists and
    // the bisection lands on the jump. (The old exponential had the same w=0 degeneracy;
    // its staircase merely happened to cancel.) The tick also applies basin hysteresis
    // that innerP does not, so actual shipments differ from the solver's assumed supply.
    // Grain delivered past the last mouth has no buyer and no granary: it rots.
    //
    // Desserts shrink the raw-grain a city needs: `displaced` mouths ate dessert instead.
    // Mirror innerP's per-city clamp exactly -- displacing globally would let one city's
    // desserts soak up another's food demand, which no cart ever did.
    // ---- settle each city's food books, then the granary ---------------------
    // For each city:            in = basin deliveries + merchant imports
    //                          out = mouths - dessert displacement + merchant exports
    // The granary takes the difference: it absorbs a surplus (up to capacity) and covers
    // a deficit (down to empty). So grain only ROTS when the granary is full, and mouths
    // only go unfed when it is empty — instead of every tick the staircase landed wrong.
    //
    // Merchant exports are CLAMPED to grain that physically exists at A. The caravan was
    // planned a tick ago on stale prices, so it can over-commit; when it does, the matching
    // imports at B are scaled back by the same factor. A caravan that could not be loaded
    // did not arrive. Without this the plan would create food from nothing.
    var displacedFood = 0, glut = 0, foodShortfall = tileDeficit, storageDelta = 0;
    var importsGot = {}, exportsSent = {};
    var newBalance = {};
    // pass A: how much of each city's planned export can actually be loaded?
    var exportScale = {};
    for (var xa = 0; xa < world.cities.length; xa++) {
      var xk = world.cities[xa];
      var planned = trade.exports[xk] || 0;
      if (planned <= 0) { exportScale[xk] = 1; continue; }
      var onHand = (deliveredBy[xk] || 0) + (world.stock[xk] || 0)
                 - cfg.c * ((world.cityN[xk] || 0) + (crewFood[xk] || 0));
      exportScale[xk] = onHand <= 0 ? 0 : Math.min(1, onHand / planned);
    }
    // pass B: scale each route by its origin's loadable fraction; that is what arrives.
    for (var rr = 0; rr < trade.routes.length; rr++) {
      var rt = trade.routes[rr];
      rt.shipped = rt.qty * (exportScale[rt.from] != null ? exportScale[rt.from] : 0);
      exportsSent[rt.from] = (exportsSent[rt.from] || 0) + rt.shipped;
      importsGot[rt.to] = (importsGot[rt.to] || 0) + rt.shipped;
    }
    // pass C: per-city balance -> granary -> glut/shortfall
    for (var dc = 0; dc < world.cities.length; dc++) {
      var dk = world.cities[dc];
      var mouths = cfg.c * ((world.cityN[dk] || 0) + (crewFood[dk] || 0));
      // Desserts shrink the raw grain a city needs: `displaced` mouths ate dessert instead.
      // Clamped PER CITY (as innerP does) -- displacing globally would let one city's
      // desserts soak up another's food demand, which no cart ever did.
      var disp = displaceOf(cfg, dessertQty[dk] || 0, mouths);
      displacedFood += disp;
      var inflow = (deliveredBy[dk] || 0) + (importsGot[dk] || 0);
      var outflow = (mouths - disp) + (exportsSent[dk] || 0);
      var net = inflow - outflow;                       // + = spare grain, - = short
      var stock0 = world.stock[dk] || 0;
      var capK = storageTarget(world, dk);
      var stock1;
      if (cfg.storage) {
        stock1 = clamp(stock0 + net, 0, capK);
        glut += Math.max(0, stock0 + net - capK);       // granary full: the rest rots
        foodShortfall += Math.max(0, -(stock0 + net));  // granary empty: mouths go unfed
      } else {
        stock1 = 0;
        glut += Math.max(0, net);
        foodShortfall += Math.max(0, -net);
      }
      storageDelta += stock1 - stock0;
      world.stock[dk] = stock1;
      // What next tick's merchants will read: this city's realised spare / unmet need,
      // plus what arrived by caravan (so `spare` can exclude it — see planMerchants).
      newBalance[dk] = { surplus: Math.max(0, net), deficit: Math.max(0, -net),
                         imported: importsGot[dk] || 0 };
    }
    world.lastBalance = newBalance;
    // Next tick's merchant plan approaches its target from HERE, so it needs to know what
    // actually flowed and what each city grew for itself.
    world.lastImports = importsGot;
    world.lastDelivered = deliveredBy;

    // ---- per-city food security (cfg.growthGate:'foodSecurity') --------------
    // A city is "secure" once its granary has stayed FULL for growthFullTurns consecutive
    // ticks. securityFrac = the share of city population living in secure cities, and it
    // is what scales growth below. Tracked unconditionally (it is cheap and it is a useful
    // readout either way), consumed only when the gate is on.
    if (!world.fullTurns) world.fullTurns = {};
    var secureN = 0, totalCityN = 0;
    for (var fs = 0; fs < world.cities.length; fs++) {
      var fk = world.cities[fs];
      var ftgt = storageTarget(world, fk);
      var full = ftgt > 0 && (world.stock[fk] || 0) >= 0.99 * ftgt;
      world.fullTurns[fk] = full ? (world.fullTurns[fk] || 0) + 1 : 0;
      var nk = world.cityN[fk] || 0;
      totalCityN += nk;
      if (world.fullTurns[fk] >= cfg.growthFullTurns) secureN += nk;
    }
    for (var ft in world.fullTurns) if (world.Aof[ft] == null) delete world.fullTurns[ft];
    var securityFrac = totalCityN > 0 ? secureN / totalCityN : 0;
    world.securityFrac = securityFrac;
    // A destroyed city's granary spoils. It must move on BOTH sides of the identity: it
    // rotted (+wasted) AND it left storage (-storageDelta). The two cancel, which is
    // exactly right — that grain was produced and banked in some earlier tick, so this
    // tick neither grew nor ate it, it merely stopped existing. Counting only the waste
    // side made the books overstate by precisely the granary's contents (measured: 57,000
    // of grain, 5.0e-1 relative error, on a map producing 114,000).
    foodWasted += glut + orphanWaste;
    storageDelta -= orphanWaste;
    var merchantVolume = 0;
    for (var mv = 0; mv < trade.routes.length; mv++) merchantVolume += trade.routes[mv].shipped || 0;
    var stockTotal = 0;
    for (var st = 0; st < world.cities.length; st++) stockTotal += world.stock[world.cities[st]] || 0;

    if (cfg.malthus) {
      var eps = Math.max(1, 0.001 * world.Ksub);        // scale-relative slack epsilon
      // Use the solver's LAG-FREE targets (not the migration-lagged actuals) so
      // population approaches carrying capacity monotonically instead of limit-
      // cycling against the migration delay.
      var supportedTarget = eq.Lm + eq.Nc + (eq.subs || 0) + crewsEmployed + harborTotal;
      world.lastSupported = supportedTarget;
      var sig;
      if (eq.w > 1e-4) sig = 1;                         // labor scarce -> grow
      else if ((eq.room || 0) > eps) sig = 0.5;         // subsistence room -> grow slow
      else if (world.N > supportedTarget + eps) sig = -1; // genuinely over capacity -> shrink
      else sig = 0;
      // ---- growth controller: bang-bang (legacy) | deadband | proportional -----
      // NOTE supportedTarget is NOT carrying capacity. When labor is scarce the wage
      // bisection drives formal == Npool exactly, so Lm+Nc == N and supportedTarget is
      // just a lagged copy of N (measured: N/supportedTarget pinned at 1.0762 == 1+r*tanh(1)
      // for the whole growth phase). It is only meaningful as an OVERSHOOT test, which is
      // all the legacy sig=-1 branch uses it for. The real "how far below capacity" signal
      // is eq.room -- unfilled subsistence capacity -- which falls to 0 at capacity.
      //
      // LEGACY bang-bang: sig in {1, 0.5, 0, -1}, never scaled by the size of the error,
      // so the step is a fixed r*tanh(sig) (7.6% at r=0.10) and can only stop if sig hits
      // exactly 0. It rings at ~r peak-to-peak forever. `eps` above is nominally the
      // deadband but at 0.1% of Ksub the step vaults straight over it.
      // FOOD-SECURITY GATE: growth only from cities that have visibly banked a surplus.
      // Applied on top of whichever controller is selected — it can only ever SLOW growth,
      // never speed it, and it never blocks the shrink branch (a starving world must still
      // be allowed to shrink, and cities with empty granaries are exactly the starving case).
      // Subsistence farmers keep the room-based signal: they have no granary to be full.
      if (cfg.growthGate === 'foodSecurity' && sig > 0) {
        var urbanShare = (eq.Nc || 0) / Math.max(1e-9, (eq.Lm || 0) + (eq.Nc || 0) + (eq.subs || 0));
        // gate the URBAN share of the growth signal; leave the rural share alone
        sig *= (1 - urbanShare) + urbanShare * world.securityFrac;
      }
      if (cfg.growth === 'deadband') {
        // Stop growing once room falls within growBand of capacity. To CAPTURE the cycle
        // rather than relocate it the band must exceed one step's worth of population.
        // Cost: settles BELOW capacity by roughly the band, on purpose.
        var bandAbs = (cfg.growBand != null ? cfg.growBand : 0.05) * world.Ksub;
        if (sig > 0 && eq.w <= 1e-4 && (eq.room || 0) <= bandAbs) sig = 0;
        world.N = Math.max(0.1, world.N + cfg.r * world.N * Math.tanh(sig));
      } else if (cfg.growth === 'proportional') {
        // Never take a step bigger than the error it is correcting -- that is what makes
        // bang-bang straddle. Growth while the wage is up fades smoothly as w -> 0;
        // growth into subsistence room is capped BY that room; shrink is capped by the
        // actual overshoot. Lands on capacity with no ripple and no underfill.
        var step;
        if (eq.w > 1e-4) step = cfg.r * world.N * Math.tanh(eq.w / (cfg.wRef || 0.25));
        else if ((eq.room || 0) > 0) step = Math.min(cfg.r * world.N * 0.5, eq.room);
        else if (world.N > supportedTarget) step = -Math.min(cfg.r * world.N, world.N - supportedTarget);
        else step = 0;
        world.N = Math.max(0.1, world.N + step);
      } else {
        world.N = Math.max(0.1, world.N + cfg.r * world.N * Math.tanh(sig));
      }
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

    // CONSERVATION — was `produced == eaten`. The marginal cap breaks that equality on
    // purpose: a tile grows MORE than its farmers eat (that surplus is the whole reason
    // cities can exist), and where no city is in reach it rots. Desserts add a second
    // sink: X food leaves the fields per dessert, but only `displacedFood` of grain demand
    // goes away with it, so the difference is burned as luxury. The invariant is the BALANCE
    //     produced == (eaten - displaced) + X * desserts + wasted - shortfall
    // i.e. grain eaten as grain, plus grain turned into desserts, plus grain that rotted.
    // It must hold EXACTLY, or food is being created/destroyed by accident.
    // (desserts:false => both dessert terms vanish => produced == eaten + wasted.)
    var dessertGrain = cfg.desserts ? cfg.dessertX * dessertTotal : 0;
    var dessertSink = dessertGrain - displacedFood;   // net luxury burn, for readouts
    // GRANARIES add one more term, and only one: grain that went into store was produced
    // but not eaten, so it is a sink exactly like a dessert (and a negative sink on the
    // tick a city eats its reserves). Merchants add NO term — a caravan moves grain
    // between cities, it does not create or destroy it, so Simports == Sexports cancels
    // identically. (That cancellation is worth keeping honest: it is the reason exports
    // are clamped to what can physically be loaded rather than to the plan.)
    var conservationErr = Math.abs(foodProduced -
      ((foodEaten - displacedFood) + dessertGrain + foodWasted - foodShortfall + storageDelta));
    world.metrics = {
      tick: world.tick, N: world.N, w: eq.w,
      marketFarmers: marketFarmers, farmersAll: farmersAll, fishermen: fishermen,
      cityWorkers: cityWorkers, subsistence: subsistence,
      crewsEmployed: crewsEmployed, crewDemand: crewDemand, fundedFrac: fundedFrac,
      foodProduced: foodProduced, foodEaten: foodEaten, conservationErr: conservationErr,
      foodWasted: foodWasted, desserts: dessertTotal, dessertSink: dessertSink,
      // granaries & trade
      foodStock: stockTotal, storageDelta: storageDelta,
      merchantVolume: merchantVolume, merchantRoutes: trade.routes.length,
      securityFrac: securityFrac,   // share of city pop whose granary has been full growthFullTurns ticks
      foodDelivered: delivered, foodGlut: glut, foodShortfall: foodShortfall,
      tileDeficit: tileDeficit,
      landTiles: landTiles, farmedTiles: farmedTiles, farmedOutsideBasin: farmedOutsideBasin,
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
    Lsub: Lsub, zeta: zeta, sampleMetrics: sampleMetrics,
    // stability layer (basins / granaries / merchants) — exposed for the gates & UI
    computeBasinEligibility: computeBasinEligibility, eligibleFor: eligibleFor,
    assignBasins: assignBasins, planMerchants: planMerchants,
    storageTarget: storageTarget, storageBid: storageBid, liveRep: liveRep,
    overshootOf: overshootOf,
    Ffood: Ffood, mkt: mkt, netbackOf: netbackOf, localDraw: localDraw
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.Econ = API;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
