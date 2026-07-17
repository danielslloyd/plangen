# Trial runs: roads, granaries, desserts — and the life of one city

Run 2026-07-17 against the stability layer (`docs/economy-stability.md`), on the planet
map (`maps/sample-map.json`), 300 ticks per game, 5 starting city-sets per cell.
Raw tables: `game/toy/out/exp_all.analysis.md`. Reproduce: `node experiments.js all`,
`node experiments.js e4`, `node drought.js`.

**The one number everything orbits.** At stock defaults the best arbitrage anywhere on the
map is **bestMargin = −2.011**: transit (~2.01 between neighbouring cities) swamps every
price gap (~0.25). Merchants are not idle because they are broken — they are idle because
*there is no trade worth doing*. All three questions below are the same question: can
anything drag that above zero, and what does it cost?

---

## Part 2 — The life of city #827

*(Part 1, the three sweeps, is below. This is the more useful half.)*

Chosen by a hash of the map seed from the 36 emergent cities that survive at stock
defaults — arbitrary, reproducible, not cherry-picked. Trace: `out/narrative.json`.

### The site

Tile 827, **grassland**, at (108.9°E, 3.9°N). Farm capacity **454** — *below* the map's
median land tile (520). What makes it viable is the sea: **fishBonus 416**, so **48% of
its food is fish**. It is a fishing town that also farms, and it could not exist inland.

Its land grows **rice (454) or pasture (236)** — and **wheat and corn score exactly
zero**. Under the crops rule (`crops_spec.md` §3.1) that is a 1.92× switching margin: a
price signal could flip it to pasture, but it will never grow a cereal. When crops land,
#827 is a rice town, and its identity is decided by dirt, not by markets.

Its nearest neighbour, #858, is 5.6 hops away — but costs **3.85** to reach. A second,
#439, is 6.1 hops away and costs **11.68**: mountains force a detour, so physical
distance and economic distance have almost nothing to do with each other here. This is
the whole reason #827 will never trade with anyone.

### Tick 76 — ignition

It ignites because local spare food clears `newCoreMinSurplus` (400/tick). Nothing else
about it is special: it is 5.6 hops from #858 (N=2709, P=2.52), which is far enough to
clear `newCoreMinDist`.

### Ticks 77–80 — the land rush

```
 t |     N | price | stock | tiles | delivered
77 |   625 | 2.467 |   443 |     6 |  1037
78 |   982 | 2.408 |  1037 |    13 |  1539
79 |  1423 | 2.145 |  1973 |    19 |  2320
80 |  1745 | 2.069 |  3163 |    24 |  2895
```

The basin grows **0 → 6 → 13 → 19 → 24 tiles in four ticks** — one ring per tick, exactly
what `basinAdjacency` allows and no faster. This is the clamp doing its job in miniature:
before the stability rework, a new city took the whole map in one tick.

The population is the alarming half. **625 workers arrive in a single tick**, then +57%,
+45%, +23%. The Malthus controller allows **10% per tick**. It is not being violated — it
is being *bypassed*: these people are not born, they **migrate** from the pool, and
migration is governed by `migrate: 0.5` with no rate limit of its own. Across all 36
emergent cities, **48% of early-life ticks exceed the Malthus rate**, median first-tick
intake **233 workers**, max **1,143**.

Meanwhile the price falls monotonically, 2.467 → 2.069, as the new basin's grain arrives.
No spike. No overshoot. Nothing like the old pathology.

### Tick 84 — the one bad moment in its life

```
t=83  urban=1  delivered=2974  P=2.077
t=84  urban=2  delivered=2725  P=2.060   <- paves its 2nd tile; that tile's harvest is gone
t=85  urban=2  delivered=2808  P=2.180   <- +5.8%
```

The city paves a second tile. Paved land is farmland gone for good, so **8.4% of its
basin's harvest vanishes in one tick**. The price shock lands the *next* tick, because
`updateUrbanization` flips tiles at the end of `step()`, after the solve.

This is the only non-monotone moment in 326 ticks of life. Across all cities: **11 of 13
paving events move the price more than 2%, median +4.41%, worst +9.14%.**

*(This is worth stating plainly because I got it wrong first: measuring the price delta on
the same tick as the flip shows ~0 and looks like the granary absorbing it beautifully.
It is measuring the wrong tick.)*

### Ticks 85–135 — the long, invisible tax

Nothing dramatic happens for fifty ticks, and that is the interesting part. The granary
fills from 4,298 to its 22,071 target, and **while it is filling it is a net buyer** — it
is bidding against the city's own eaters, every tick, for 59 ticks.

> Mean price while filling: **2.083**. Mean price once full: **2.024**.
> **The granary held its own city's price 2.90% high for 59 ticks.**

This is not specific to #827. **All 41 cities do it**, median **72 ticks**, median
**+3.24%**, p90 **+7.67%**. And because every city is founded in the same era, they all
restock *at the same time* — the demand is correlated across the whole map.

The granary is the largest standing price distortion in a settled game, and it is
self-inflicted.

### Tick 135 onward — equilibrium

```
N = 2759   P = 2.024   basin = 23 tiles   granary 22071/22071 (full)   imports = 0
```

Dead flat, to the digit, for the remaining 265 ticks. It ends **8th of 41 cities**. It
never trades with anyone, ever.

### Where it sits in the world

| | n | mean N | mean P |
|---|---|---|---|
| seeded cities | 5 | 2,980 | 2.52 |
| emergent cities | 36 | 1,467 | 2.90 |

Emergent cities are half the size and pay 15% more for food — they settle the land the
seeds didn't want. And there is a distinct underclass: **5 of 41 cities have fewer than
300 workers**, median price **5.80** (map median 2.37), median basin **3 tiles**. They
hold **0.84% of the city population but are 12% of the cities** — and they are what sets
the map's headline price spread. They are the same phenomenon as the old P=306 city, now
bounded at P≈6 instead of P=306, but not actually solved.

---

## Ten ways to make it more stable

Ranked by measured magnitude, not by appeal. Each is: the evidence, the mechanism, the cost.

**1. Let the granary buy only what would otherwise rot.**
*Evidence:* 41/41 cities, median 72 ticks, price held +3.24% (p90 +7.67%) above
equilibrium while restocking. The single largest standing distortion in the model.
*Mechanism:* cap `storageBid`'s buy side by the city's own realised glut, so the granary
can physically never bid against an eater. It fills from genuine surplus — which is
exactly when a granary *should* fill.
*Cost:* fills slower, and on a map with no surplus it never fills at all. Note
`storageFill:0` (pure price-timing) already measures **zero added ripple but a granary
that never fills** (stock 228k vs 860k) — this is the third option between those two.

**2. Ramp a paved tile's harvest to zero over `flipCooldown`.**
*Evidence:* 11/13 paving events move price >2%, median **+4.41%**, max **+9.14%**;
delivery drops 4.1–8.4% in a single tick.
*Mechanism:* the memory's long-standing "next fix to try", now with a number. Bleed the
tile's farm output out over ~10 ticks instead of removing it at once; a 4.4% step becomes
~0.4%/tick, below every hysteresis band in the system.
*Cost:* a tile is briefly both paved and farming — needs a clear story for what that is
(suburbs with gardens, which is what it physically is).

**3. Rate-limit migration into a city to the Malthus rate.**
*Evidence:* median **233 workers arrive in a city's first tick** (max 1,143); **48% of
early-life ticks exceed r=10%**; worst single tick 108,928,566%.
*Mechanism:* `migrate: 0.5` closes half the gap to target every tick with no cap. The
Malthus controller is carefully rate-limited and migration simply walks around it. Cap
per-city intake at `max(floor, r · cityN)`.
*Cost:* slower convergence; a new city takes ~40 ticks instead of 5 to reach size. That
is arguably more realistic, and it is the same trade `growInterval` already makes for
extent.

**4. Shrink `storageDays` from 8 to 4–6 — a bigger granary is a WORSE granary.**
*Evidence:* the drought test. Price spike vs granary size is **U-shaped**: 6.5% (no
granary) → **3.3% (4 days, optimum)** → 4.0% (8, current) → 6.0% (16) → **8.2% (40 —
worse than having no granary at all)**. On a settled map, ripple 0.0000 (≤8d) → 0.0041
(40d). Spatial spread: 4.0× at every size — granaries never touch it.
*Mechanism:* a large granary is still *restocking during the drought*, bidding against the
very eaters it exists to protect. `restockWeight` fades that with price but does not kill
it — idea 1 does.
*Cost:* none. Famine protection is **size-independent** (peak unfed 13,016 → ~95 at *any*
size ≥2 days), so the inventory above ~6 days is buying nothing but distortion.

**5. Stagger restocking across cities.**
*Evidence:* all 41 cities fill simultaneously (median 72 ticks, same era), so their
restock demand is perfectly correlated — a map-wide demand pulse rather than noise that
cancels.
*Mechanism:* phase-offset each city's restock by a hash of its rep, the way
`stickyRefresh` already staggers tile re-shopping by tile id.
*Cost:* trivial to implement; slightly less principled than #1, which removes the problem
rather than smearing it.

**6. Build a FULL road mesh with a low `roadMult` — the only clean win in the sweep.**
*Evidence:* at the default K0=1.0, full topology takes merchants **0% → 19% active** and
bestMargin **−2.179 → −0.382**. `roadMult` 0.1 → **61% active, bestMargin +0.040**. The
best road configs are **the highest-population games in all 4,065** (244,944 vs the
200,193 default, **+22%**) *and* hold the price spread at **3.7×** while trading 7,615
units — versus the granary/dessert routes, which reach the same volume at **25–137×**
spreads. This is the only lever that buys trade without buying dysfunction.
*Mechanism:* merchants arbitrage price gaps, which is by definition a stabilising force on
spatial dispersion — the thing nothing else in the model attacks.
*Cost:* `tau` must merely be nonzero (0.15/0.3/0.5 are indistinguishable; tau=0 builds
nothing). **A spanning tree does not work** (21.9% vs 20.0% baseline): it connects nearest
neighbours, which are the pairs with the smallest gaps. Trade needs the long roads.

**7. Give transit a duration — a caravan pipeline.**
*Evidence:* merchant ripple is flat at **44–53% across `merchantAggression` 0.15→1.0** —
quantity damping provably cannot fix it, because the route gate is *binary*: when a
destination's price dips below `P_A + transit`, every route vanishes in one tick.
*Mechanism:* dispatch at tick *t*, arrive at *t + delay*. Arrivals become smooth by
construction and one unprofitable tick cannot zero them.
*Cost:* real state (caravans in flight) and a conservation term for grain in transit.

**8. Cut the plant gain: raise `p − alpha` above 0.35.**
*Evidence:* `N ~ P^−2.857` — **a 1% price error becomes a 2.80% workforce error**.
*Mechanism:* every controller in the system (Malthus, migration, granary, merchants) is
fighting a plant with ~3× amplification. This is the root reason everything here is
delicate. `p − alpha = 0.35` is currently a structural constant chosen for anti-runaway.
*Cost:* it rewrites the entire calibration, and `p > alpha` is load-bearing. This is the
highest-leverage and highest-risk item on the list — worth an experiment, not a patch.

**9. Let stranded hamlets dissolve.**
*Evidence:* 5/41 cities (12%) hold **0.84%** of city population at price **5.80** (map
median 2.37) with 3-tile basins. They also **inflate the map's headline price spread from
2.64x to 3.86x (1.5x)** — every `pSpread` number in these sweeps is partly an artifact of
5 irrelevant hamlets.
*Mechanism:* they are economically irrelevant but they set the map's headline price
spread, and they are the same class as the old P=306 pathology — now bounded, not cured.
Either raise `newCoreMinSurplus` so they never ignite, or let a city with sustained
negative real income disband.
*Cost:* "cities can die" is a real design decision, not a tuning one.

**10. Warm-start a newborn city's price.**
*Evidence:* found during this run — an emergent city has **no price at all on its birth
tick** (`updateUrbanization` flips it after the solve, and unlike `foundCity` it never
seeds `world.prices`). The solver then starts it at 1.0, which is wrong nearly everywhere
(the map's median is 2.37).
*Mechanism:* seed from the best local netback, or from the nearest city's price.
*Cost:* none. (The related merchant bug — `prices[k] || 0` making a newborn look like it
was giving grain away — is already fixed.)

---

## Part 1 — the three sweeps

**4,065 games**, 70.7 min on 22 workers. Full tables: `out/exp_all.analysis.md`.
Conservation across all 4,065: worst relative error **2.2e-15**.

**900 of 4,065 games (22.1%) had merchants trading at rest** — and the single most useful
thing in the whole run is that they split into two completely different populations:

| how trade was achieved | merchVol | bestMargin | price spread | **N** |
|---|---|---|---|---|
| granary 40d, rate 0.4, K0=0.3 | 9,300 | 122.6 | **89.5×** | 223,737 |
| granary 40d, rate 0.25, K0=0.3 | 7,204 | 117.4 | **94.1×** | 212,010 |
| **roads=full, roadMult=0.1, K0=0.3** | **7,615** | 1.29 | **3.7×** | **243,378** |
| **roads=full, roadMult=0.1, K0=0.3** | 6,204 | 1.12 | **3.9×** | **244,944** |

Roads produce *the same trade volume* with a **tight** spread and **the highest population
in the entire sweep** (244,944 vs the 200,193 default — **+22%**). The granary and dessert
routes produce trade with 25–137× spreads: they are trading because the market is
**broken**. Volume of trade is not a health metric. Trade *at a narrow spread* is.

### Q1 — Do roads activate merchants? **Yes, but only a full mesh, and cheap.**

| topology | segments | active | bestMargin |
|---|---|---|---|
| none | 0 | 20.0% | −0.889 |
| tree | 39 | 21.9% | −0.477 |
| full | 330 | **34.7%** | −0.243 |

At the shipped default **K0=1.0: none 0% → full 19% active**, bestMargin −2.179 → −0.382.

Two findings worth keeping:

- **A minimum spanning tree is the wrong topology for trade** (21.9% vs 20.0% baseline —
  i.e. nothing). A tree links each city to its *nearest* neighbour, which are exactly the
  pairs with the *smallest* price gaps. The profitable arbitrage is between distant
  cities, and only the full mesh builds those roads. If a road auto-router is ever built
  (game/STATUS.md item B), "connect the nearest unconnected city" is precisely the rule
  that will not pay.
- **`roadMult` is the lever, not `tau`.** roadMult 0.1 → **61% active, median bestMargin
  +0.040** (positive); 0.5 → 16%. Whereas tau only has to be *nonzero*: tau=0 builds 0
  segments (control confirmed), and 0.15 / 0.3 / 0.5 are indistinguishable (38–41%).

### Q2 — Do larger granaries stabilise prices, or widen the swings? **Both. U-shaped.**

On a **settled** map, they do neither and cannot: the price ripple is already **0.0000**
without them. Past 16 days they add a small ripple of their own, and they never touch
spatial dispersion at all:

| storageDays | price ripple (time) | price spread (space) | glut |
|---|---|---|---|
| 0 (off) | 0.0000 | 4.0× | 1942 |
| 8 (default) | 0.0000 | 4.0× | 1761 |
| 16 | 0.0005 | 4.0× | 1734 |
| 40 | **0.0041** | 4.0× | **1585** |

The real test is a **shock** — `drought.js`, harvest ×0.7 for 5 ticks on a settled map:

| storageDays | price spike | peak unfed mouths |
|---|---|---|
| **0 (none)** | 6.5% | **13,016** |
| 2 | 4.6% | 95 |
| **4** | **3.3%** ← optimum | 95 |
| 8 (default) | 4.0% | 94 |
| 16 | 6.0% | 96 |
| 24 | 6.8% | 96 |
| **40** | **8.2%** ← *worse than no granary at all* | 94 |

**A granary bigger than ~16 days is worse than not having one**, because it is still
*restocking* during the drought — bidding against the very eaters it exists to protect.
(`storageBid`'s `restockWeight` fades that with price but does not kill it; see idea 1.)

Two things fall out that matter more than the ripple:

- **Any granary essentially abolishes famine**: peak unfed mouths **13,016 → ~95**, a 137×
  cut, and it is completely **size-independent**. That — not price smoothing — is what
  granaries are for. Population still drops 32.7% either way; Malthus is unavoidable.
- **`storageRate = 0.15`, the shipped default, is measured to be exactly the ripple
  minimum** (0.02→0.0013, 0.05→0.0003, **0.15→0.0000**, 0.4→0.0003) — a U-curve that
  independently confirms the floor/ceiling argument the knob was built on.

**Recommendation: `storageDays` 8 → 4–6.** Full famine protection, better shock damping
(3.3% vs 4.0%), less standing distortion (idea 1), and less inventory to fill.

### Q3 — Can dessert prices coax merchants out? **Yes, by causing a famine.**

Not a gradient — a **cliff at premium 0.95**:

| premium | active | bestMargin | median price | price spread | **N** |
|---|---|---|---|---|---|
| 0.3 | 8% | −2.181 | 2.423 | 4.0× | 197,995 |
| 0.5 | 17% | −2.106 | 2.410 | 4.1× | 201,307 |
| 0.7 | 22% | −1.739 | 2.551 | 4.2× | 196,457 |
| **0.95** | **88%** | **+6.283** | **3.964** | **12.3×** | **156,833** |

Displacement says the same thing from the other side — **the more grain desserts burn, the
more merchants trade**:

| D | active | median price | **N** |
|---|---|---|---|
| **0** (pure export, most wasteful) | **48%** | 3.039 | **167,152** |
| 1 | 25% | 2.714 | 177,815 |
| 3 | 30% | 2.467 | 197,995 |
| **6** (food-neutral) | 32% | 2.399 | **208,070** |

The mechanism works exactly as designed — a dessert tile ships no grain, so desserts pull
supply off the food market, raise P, and widen the gaps merchants need. But that *is*
manufacturing scarcity: 88% merchant activity costs **21% of the map's population** and a
64% higher food price. **Desserts are not a trade lever. They are a famine lever that
happens to produce trade.**

**Caveat worth flagging:** `bestMargin max ≈ 597` in every `dessertX` bucket. That is
cities pinning at `priceMax = 600` — the old supply-staircase pathology resurfacing in
extreme dessert configs. Desserts remain the one mechanic that can still reach it.

---

## Corrections I made to my own numbers

Recorded because both were wrong in a way that looked convincing:

- **The paving shock is +4.41%, not ~0.** I first measured the price delta on the same
  tick as the flip and concluded granaries absorbed it. `updateUrbanization` runs at the
  *end* of `step()`, so the shock reaches the solver at *t+1*. I was measuring the wrong
  tick. The single-city trace is what caught it.
- **Large granaries do not destabilise population.** On partial data (~460 games) 40-day
  granaries showed an N ripple of 0.0789; on the full 1,890 it is **0.0000**. A
  small-sample artifact. The *price* ripple finding (0.0041) survived the full run.
