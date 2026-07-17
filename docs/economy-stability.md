# Economy stability: contiguous basins, granaries, merchants

Status: **built and green** (2026-07-16). Six Node gates pass, including a new
`test/validate_trade.js`. This documents the bug that forced the rework, the fix,
and the parts that are still honestly wrong.

Read `game/toy/hex_economy_v2_spec.md` §11 first for the base equilibrium, and
`game/toy/crops_spec.md` for what sits on top of this.

---

## 1. The bug: a city's supply was a step function of its own price

Reported symptom: *"essentially all unclaimed arable land is getting claimed by a
small city (9 workers) with a temporarily sky-high food price."*

Reproduced exactly on `maps/sample-map.json`
(`kappa=120&newCoreMinFarmers=2500&dessertDisplace=3&desserts=1&ticks=221`):

```
tick 213 | N=192210 | 23 cities | price: min 2.14  med 263.75  max 306.67
         | city #156: 8 workers, P=306.67, 495 tiles claimed | glut 139,167
```

A period-10 limit cycle: spike → decay over ~5 ticks → rebuild over ~10 → spike.
Population swung 118k–225k (~60% peak-to-peak). The *median* price hit 263, so it
was never one rogue town — every city blew up together.

### Root cause (measured, not inferred)

Basin assignment was **winner-take-all across every city on the map**: each tile
re-auctioned its harvest to all ~32 cities every bisection round. That makes each
city's supply a **step function of its own price** — zero until it outbids its
neighbours, then whole basins at once. Sweeping excess demand for one city:

```
desserts OFF, city 156:
  P=20 |  ED = +5.1      | dem = 5.1  | sup =     0.0   <- price must RISE
  P=40 |  ED = -15567.1  | dem = 0.7  | sup = 15567.8   <- price must FALL
```

Supply jumps 0 → 15,568 in one step (0 → 166,332 with `dessertDisplace=3`).
**No price clears that.** The bisection converges onto the discontinuity, and the
two sides of the jump are the two symptoms: the solver prices the "supply off"
side (8-worker city, P=306) while the tick realises the "supply on" side (495
tiles ship → 139k of grain rots → price collapses → repeat).

This is `crops_spec.md`'s own "market supply is a staircase" note, except the
riser is the size of a continent rather than one tile.

**Excess demand was verified monotone** in all four dessert configs (0 violations
across an 18-point price sweep). Dessert displacement is *not* the culprit, though
`D=3` makes the riser much worse (supply zero up to P=80 rather than P=20).

---

## 2. The fix: three features that only work together

### A. `basinAdjacency` — contiguous claims

A tile may join basin *k* only if it already belongs to *k*, is adjacent to a
**land** tile that does, or touches *k*'s own city tiles. A basin grows one ring
per tick, so a price spike annexes a ring rather than a continent — the staircase's
risers shrink from "a basin" to "a tile".

Read it as information, not law: a farmer learns what a market pays from the
neighbours who sell there, and word travels at walking pace.

**Water blocks the chain deliberately.** A farmer does not ship grain across an
ocean; a merchant does. That is the whole division of labour, and it is why (A)
and (C) must ship together — the clamp alone would strand every island and coast
that trades by sea today.

### B. `storage` — granaries

Two distinct jobs, both required:

1. **Price.** The granary's bid is *continuous* in P. Farm supply is a staircase;
   without a continuous term, excess demand can jump over zero and no clearing
   price exists. This is what makes the price *solvable* rather than merely bounded.
2. **Physics.** It buffers, so grain rots only when the granary is **full** and
   mouths go unfed only when it is **empty**.

The bid has a **restock** motive and a **timing** motive. Both are needed, and each
was found the hard way:

- Timing alone never fills. Its reference price is an EMA of the price it actually
  sees, so at equilibrium remembered == actual, the motive is exactly zero, and the
  granary sits empty forever (measured: stock 0 against a target of 120,708). An
  empty granary buffers nothing and gives merchants nothing to ship.
- Restock must **fade out as grain gets dear**, or it cancels the release exactly
  when the release is the point (measured: a granary holding 5.6 days of food
  released only 137 against a 441 shortfall, and the price spiked 69% anyway).
  A reserve exists to be drawn down.

`storageRate` has a floor and a ceiling, both real:
- above ~0.25 the granary's own restocking dwarfs the city it serves;
- below `1/storageDays` (=0.125) it physically cannot cover one day's demand in one
  tick, so it fails at its only job. 0.15 clears the floor with margin.

### C. `merchants` — city→city arbitrage

A merchant in A hears grain is dear in B, buys A's spare, sells it in B, and
pockets `margin = P_B - P_A - transit(A,B)`. This is the mechanism that was
missing: previously a short city could only bid up its price and annex distant
**land** — exactly the pathology (A) clamps.

Merchants act on **lagged** prices (they commit before they can know the new
price). That lag is the point, not a simplification: it keeps each city's merchant
inflow exogenous to this tick's price, so the per-city bisections stay decoupled.
Coupling them is what made v1's tâtonnement oscillate.

Three things had to be right, and each was wrong first:

1. **Need comes from the demand CURVE, not the realised deficit.** A starved city
   has `cityN → 0`, so its deficit *and* its granary target are both 0; a
   deficit-based rule sees "no need" and lets it die. It cannot bootstrap because
   it has no workers, and has no workers because nobody ships it food (measured:
   N=0, P pinned at the 600 cap, forever).
2. **Target the arbitrage-free flow, then lag toward it.** Shipping a *fraction of
   the price gap* is a proportional controller with permanent steady-state error —
   merchant traffic is a flow and so is appetite, so it settles wherever flow ==
   consumption (measured: destination decayed to N=136 against an arbitrage-free
   size of ~484). Ship instead what clears B at `P_A + transit`, damped by a
   first-order lag (`merchantAggression`).
3. **Granary room must respect the granary's own rate.** Offering the full empty
   volume (8 days) let caravans deliver ~4× what the city could absorb in a tick;
   the price overshot through the floor and merchants spent alternate ticks shipping
   grain *back into the breadbasket* (measured: 0.82 ↔ 320.6, period 2).

### D. `stickyBasins` — commit the buyer once per tick

A tile commits to its buyer using last tick's prices and holds it through the whole
solve (it still responds to that buyer's live price — it just doesn't re-auction to
32 cities per bisection round). Consequences:

1. each city's supply depends **only on its own price**, so the per-city bisections
   become exactly independent — the property the solver already assumed;
2. `innerP`'s inner loop drops from O(tiles × cities) to O(tiles);
3. it is simply truer: a classical-era farmer has a buyer, not an auction.

Stickiness and `basinHyst` are **complementary, not redundant**: stickiness removes
~90% of settled basin flips (291 → 30), `basinHyst` closes the rest to 0.

---

## 3. Results

Dan's exact permalink, 260 ticks, legacy flags vs shipped defaults:

| metric | legacy | new |
|---|---|---|
| population N (mean) | 151,945 | **259,227** |
| N ripple (rel p2p) | 0.5714 | **0.0000** |
| max price | 306.67 | **19.05** |
| median price | 47.61 | **2.23** |
| glut (rotted/tick) | 59,104 | **444** |
| shortfall/tick | 2,401 | **0** |
| biggest basin | 733 tiles | **43** |
| worst tiles-per-city-worker | 88.78 | **0.00** |
| conservation (worst in tail) | 3.8e-1 | **2.0e-4** → 9e-16 settled |
| wall time (260 ticks) | 69.0 s | **10.1 s** |

The 6.5× speedup is the eligibility clamp plus sticky basins collapsing the
O(tiles × cities) inner loop.

`growth:'deadband'` (now the default, `crops_spec.md` §6.2) contributes the last of
the ripple: the same run under `bangbang` settles at 0.1228 rather than 0.0000. The
structural fix does the heavy lifting — bang-bang no longer *diverges*, it just
rings at its own step size, as designed.

---

## 4. Known-wrong, on purpose

- **Merchant flow rings in the extreme case.** A city with *zero* local food, fed
  100% by lagged sea imports, still ripples ~45% around the correct arbitrage-free
  price. Cause: the route gate is an on/off switch — when B's price dips below
  `P_A + transit` the margin goes negative, *every* route vanishes for that tick, B
  gets nothing, and the price spikes. Quantity damping cannot smooth a binary gate
  (measured: ripple is flat at 44–53% across `merchantAggression` 0.15→1.0).
  **Fix when it matters:** give transit a *duration* — caravans dispatched at tick
  *t* arrive at *t+delay*, so arrivals are smooth by construction and a single
  unprofitable tick cannot zero them. This does not manifest on the planet map,
  where no profitable arbitrage exists at `K0=1.0` (best margin on the whole map:
  **−1.757**).
- **Conservation transients.** After any structural event the identity carries an
  error that decays at exactly `cfg.migrate` per tick back to ~1e-15. That is the
  migration lag resolving (production is computed from *actual*, lagged labour), not
  a leak. Pre-existing and documented in `crops_spec.md`.
- **Extent is still welded to density.** `crops_spec.md`'s `minViableCap` item is
  untouched and orthogonal.

---

## 5. Knob-meaning changes (these break old configs silently)

- **`growth` default `bangbang` → `deadband`.** Pre-2026-07-16 sweeps ran bang-bang's
  limit cycle; their `oscAmp` numbers are not comparable to anything measured after.
  Set `growth:'bangbang'` to reproduce them.
- **`newCoreGate` default `'surplus'`.** `newCoreMinFarmers` is now only read when
  `newCoreGate:'farmers'`. **Any spec that used `newCoreMinFarmers: 1e9` to suppress
  emergent towns silently stopped working** — it must also set `newCoreMinSurplus: 1e9`.
  This bit `validate_organic` (14 towns ignited inside a test about one city).
- **`cfg.subsistenceShare` is inert** and asserted so in `validate_transport`.
- **`priceMin`/`priceMax` are now config.** They were hard-coded 0.001/600 and were
  doing invisible load-bearing work: when a city's supply staircase had no crossing,
  `priceMax` alone decided how absurd the spike got (the measured P=306 is just 600
  halved). With storage the crossing exists, so the bracket is back to being a bracket.
- **`foodModel:'legacy'`** restores the reference core's exponential yield + average-rule
  cap, so `validate_core` Part A can keep testing port fidelity (`crops_spec.md` §6.1).
  It now reproduces the reference to the digit: `Prich=1.36 / Ppoor=0.95`.
