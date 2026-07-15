# Hex Economy v2 — Labor & Wealth Redesign

Design spec for review. Nothing here is built yet. The hex grid, terrain, transport
(Dijkstra with road discounts), basin assignment, editing tools, view-mode framework,
and visual style all carry over from v1 unchanged. What changes is the entire
labor / wealth / price / population core, plus taxation, road crews, and two new
readouts (per-city balance-of-trade, flow arrows).

---

## 1. Why we're rebuilding

The v1 megacity bug had two stacked causes:

1. **Non-convergent price solver.** Under cheap transport a city's basin is bistable
   (nearby-only below a threshold price, whole-map above it). The fixed-step price
   update overshoots that near-step supply curve and oscillates — traced ping-ponging
   price 2.0 ↔ 13.2 ↔ 1.2 ↔ 14.5, supply 10 ↔ 860, never settling.
2. **Population trusted price, not delivered food.** Growth keyed off `wage > price·c`;
   when the oscillation left price ≈ wage/c the city read "balanced" and froze while
   physically receiving a fraction of its food. Nothing enforced *food delivered = food eaten*.

The fix and the labor/wealth redesign are the same move: make workers a **real,
conserved, food-eating population** that sorts between farm and city. Then a city
cannot hold more people than food physically reaches it (conservation becomes
structural), and the marginal-worker logic is exactly what caps city size.

---

## 2. Decisions locked (from Q&A)

- **Workforce:** one mobile pool, total bounded by total food grown.
- **Food price:** real market — willingness-to-pay clears it; wealthy workers bid it up.
- **Sequencing:** spec first (this document), then Node-validate the equilibrium, then build.

---

## 3. Entities

- **Hex** — capacity `C_h` (land quality), `passable`. Holds farmers.
- **Worker** — one unit of the conserved pool `N`. At equilibrium each worker is in the
  role giving the best real income:
  - **Farmer** on a hex — produces food (diminishing returns to labor).
  - **Free-market city worker** — produces gold (accelerating aggregate returns, Pareto-split wealth).
  - **Road crew** — maintains a road segment; paid from the tax pool; produces nothing; still eats.
- **City** — industry center; hosts free-market workers + crews; has a food price `P_k`.
- **Road segment** — cheap transport edge; requires crew labor to stay maintained.
- **Tax pool** — gold skimmed from cities, recycled to crews.

Everyone eats `c` food/turn and pays for it at their local food price.

---

## 4. Sectors and incomes

Gold is the numéraire. Food has a local price. A worker's **real income** = gold earned
− `price · c` (their food bill). Workers migrate toward higher real income.

### 4.1 Farm sector — diminishing returns to labor

Hex `h` with `L_h` farmers and capacity `C_h`:

```
Food output      F_h(L)   = C_h · (1 − e^(−L/κ))
Marginal product MFP_h(L) = (C_h/κ) · e^(−L/κ)
```

- `κ` = labor-saturation scale (how many farmers saturate a hex). Higher `C_h` ⇒ higher
  marginal product ⇒ better land is farmed harder (von Thünen intensity).
- **Farm-gate food price** = netback `nb_h = max_k( P_k − transport(h,k) )`; the hex is
  assigned to the city `k` giving that max (its basin).
- **Marginal farmer's real income** = `nb_h · MFP_h(L_h) − nb_h · c` = `nb_h·(MFP_h − c)`.
  Farmers enter hex `h` until this equals the economy-wide reservation wage `w*` (§4.5).
  Because `MFP_h` falls with `L_h`, this pins `L_h`, hence food supply, per hex.

### 4.2 City sector — accelerating returns, Pareto wealth

City `k` with `N_k` free-market workers:

```
Aggregate gold output   Y_k = A · N_k^α          (α > 1, agglomeration)
Worker rank i (1=top) earns ∝ i^(−p)             (Pareto, p = concentration)
Share of rank i         s_i = i^(−p) / Σ_{j=1..N_k} j^(−p)
Marginal worker income  y_margin(N_k) = Y_k · s_{N_k}
Marginal worker real    = y_margin(N_k) − P_k · c
```

Workers join city `k` until the **marginal** worker's real income = `w*`.

**Anti-runaway condition.** For large `N`, `y_margin ~ (A/ζ(p))·N^(α−p)`. It *declines*
with `N` iff **`p > α`** (and `p > 1` for the sum to converge). Under that condition a
city self-limits: growth stops where the thin Pareto tail (minus a rising food bill)
drops to farm-competitive. The UI enforces `p > α` (warns / clamps otherwise).

Two forces cap a city, both wanted: (a) the shrinking marginal Pareto share, and
(b) a rising food price as the city pulls food from farther/dearer sources (§4.4).
Even near `p ≈ α`, the food-price term keeps cities bounded — this is the classic
von Thünen city-size ceiling, now emergent.

*Note:* the Pareto split is a distribution over the city's workers; we don't simulate
individuals — we use the closed-form marginal share `s_{N_k}` and, for readouts, top-share
or Gini. Aggregate `Y_k` is what's taxed and what backs the city's willingness-to-pay.

### 4.3 Road crews and taxation — central planning

- **Tax rate `τ`** (lever, 0…τ_max): each city pays `τ · Y_k` into the pool per turn.
- **Crew demand:** each maintained road segment needs `m` crew-workers (per segment,
  scaled by length). Total crew demand = `m · Σ segments`.
- **Crew wage `w_road`:** the pool divides among crews. A crew worker is a real worker
  pulled from the pool; they eat `c` in the city they're stationed in (nearest city to
  the segment), adding to that city's food demand.
- **Funding / degradation:** if the pool funds crews at `w_road ≥ w*`, workers take crew
  jobs and roads stay maintained. If the pool is short (τ too low, or too many roads),
  `w_road` falls below `w*`, crews leave, and **unmaintained segments degrade** — their
  edge cost decays from `K1` back toward `K0` (rate = tunable), losing the discount.
- Result: a road costs **gold (tax) + labor (crew) + food (crew eats)**. Overreach =
  more road than the tax base sustains ⇒ crews unpaid ⇒ corridors decay. Each city ends
  up with a visible mix of **tax-funded (planned)** and **productivity-chasing (market)** workers.

### 4.4 Food market per city — willingness-to-pay (Option A)

`P_k` clears city `k`'s food market:

- **Supply** = food shipped from `k`'s basin, net of transport = `Σ_{h∈basin(k)} F_h(L_h)`
  (delivered; transport is a gold cost baked into netback, food quantity conserved).
- **Demand** = `c · N_k` where `N_k` = free-market workers + crews present — but
  *participation is affordability-gated*: a worker stays only if their real income ≥ `w*`,
  which already embeds `P_k·c`. So demand is endogenous: a wealthier city sustains a higher
  `P_k` before its marginal worker is priced out.
- **Clearing:** `P_k` set so supply = demand. Wealth enters through the labor side — richer
  workers keep real income ≥ `w*` at higher `P_k`, so the market clears higher. No direct
  wealth→price formula; price is a genuine outcome of who can afford what.

### 4.5 Labor market — the mobile pool

A single shadow wage `w*` (marginal value of labor) equalizes the **marginal** real income
across every active role:

```
farm hex h:  nb_h·(MFP_h(L_h) − c) = w*        → sets L_h
city k:      y_margin(N_k) − P_k·c   = w*        → sets N_k
crews:       w_road − P_k·c          ≥ w* to fill
```

`w*` is the price that makes total labor demand equal the fixed pool:
`Σ_h L_h + Σ_k N_k + crews = N`. Higher `w*` ⇒ less labor demanded everywhere ⇒ monotone,
so `w*` is unique and bisectable.

### 4.6 Population dynamics — Malthusian, food-capped

Total pool `N` grows slowly toward what the food sector can feed:

```
dN = r · N · tanh( (F_total − N·c) / scale )
```

where `F_total` = total food produced at the tick's equilibrium. Surplus food ⇒ grow;
deficit ⇒ shrink (starvation). Because farm output saturates (diminishing returns + finite
good land) and some labor is always drawn into cities, `F_total` caps out and so does `N`.
This is the structural conservation guarantee: population can't exceed `F_total/c`.

---

## 5. Equilibrium solver — killing the oscillation

Each tick, given `N`, terrain, cities, roads, `τ`, solve for `{w*, P_k, L_h, N_k, crews}`.
The v1 failure was fixed-step tâtonnement against near-step supply. v2 uses **robust
monotone updates (bracket + bisection), never fixed proportional steps**:

```
repeat (market rounds, damped) until w* and all P_k stable:
    given current P_k, w*:
        assign hexes to best-netback city; set L_h from farm marginal condition
        set N_k from city marginal condition; compute Y_k, crews, food supply/demand
    update each P_k by BISECTION on its excess demand (monotone in P_k)
    update w*   by BISECTION on total labor demand vs N (monotone in w*)
then nudge N by the Malthusian rule
```

Bisection converges even against step-shaped curves, which is precisely what v1 lacked.
**Validation gate (Node, before any UI):** convergence in bounded iterations, zero
oscillation across the full knob ranges (esp. cheap transport), and the invariant
`Σ food produced ≈ Σ food eaten` every tick. Same Node-first discipline as v1.

---

## 6. Parameters (knobs)

| Knob | Meaning | Range | Default | Notes |
|---|---|---|---|---|
| `K0` | overland transport cost / hex | 0.2–3 | 1.0 | steep enough decay matters for basins |
| `K1` | road transport cost / hex | 0.05–1 | 0.25 | < K0 |
| `c` | food eaten per worker / turn | 0.5–3 | 1.0 | |
| `κ` | farm labor-saturation scale | 2–8 | 4 | how fast a hex fills with farmers |
| `A` | city productivity coefficient | 0.5–5 | 1.0 | scales gold output |
| `α` | city agglomeration exponent | 1.0–1.6 | 1.2 | >1 = accelerating |
| `p` | wealth concentration (Pareto) | 1.1–3 | 1.8 | **must exceed α**; higher = cities cap sooner |
| `r` | population growth rate | 0.02–0.2 | 0.08 | Malthusian speed |
| `τ` | tax rate on city output | 0–0.6 | 0.15 | funds crews |
| `m` | crew-workers per road segment | 0–3 | 0.5 | labor cost of roads |
| `degrade` | road decay rate when unfunded | 0–1 | 0.2 | K1→K0 speed |

Solver constants (fixed, not exposed): bisection tolerance, max rounds.

---

## 7. Visualization (new)

- **Per-city balance-of-trade readout** (live, on hover/select or as small labels):
  population (market vs crew split), food imported (units + gold value), gold output `Y_k`,
  tax paid, food bill, **net gold**, food price `P_k`, and a wealth summary (avg + top-share/Gini).
- **Flow arrows on the map:** for each city, a food-inflow vector (from basin centroid,
  thickness ∝ volume) and a gold vector (tax out to pool / net). Optional gentle animation.
- **New view modes** alongside Basins/Terrain/Farming/Prices:
  - **Wealth** — city hue intensity by avg worker wealth; hexes by farmer income.
  - **Labor** — where workers are (farm density vs city size vs crews).

---

## 8. Preserved from v1

Hex grid + axial math, terrain brushes & painting, city/road/erase tools, pan/zoom,
Dijkstra transport with road discounts + impassable water/mountains, basin assignment by
netback, the knob-panel framework, emergent-city option, dark-slate instrument aesthetic.

---

## 9. Open questions for your review

1. **Migration speed** — reallocate workers fully to equilibrium each tick (crisp, may look
   instantaneous), or move a fraction toward it per tick (visible flows, smoother)? *Lean: fractional.*
2. **Population** — Malthusian growth on (as specced), or fix the pool `N` and just let it
   reallocate (you watch distribution, not growth)? *Lean: Malthusian on, with a pause toggle.*
3. **Crew stationing** — assign each segment's crew to the nearest city (simple), or the city
   whose basin the segment most serves? *Lean: nearest city.*
4. **Road degradation** — gradual `K1→K0` decay (specced), or hard drop when unfunded? *Lean: gradual.*
5. **Pareto exposure** — expose both `α` and `p` with a `p>α` guard (specced), or collapse to
   one "inequality vs agglomeration" slider that stays in the safe regime automatically?
6. **Flow arrows** — food + gold only, or also a labor-migration arrow between regions?

---

## 10. Build & validation plan

1. **Node model** — implement the equilibrium solver headless; validate convergence, zero
   oscillation across all knobs (incl. cheap transport), conservation invariant, and the
   qualitative targets: cities self-limit, marginal workers farm when cities get rich, food
   price tracks city wealth, overreaching roads decay.
2. **Wire solver into the sim** — replace the v1 core; keep grid/transport/editing/views.
3. **Add taxation + crews** — lever, pool, crew labor/food, degradation.
4. **Add readouts** — per-city balance-of-trade, flow arrows, wealth/labor views.
5. **End-to-end validation** — headless multi-scenario runs, then visual check.

*Same discipline as v1: the economics are proven in Node before the HTML is touched.*

---

## 11. VALIDATED MODEL — Node-confirmed (refines §4–5)

Node validation revised the model. The §4.1 "farming is purely demand-driven" formulation
**collapses**: at low population no city demand exists, so no land is farmed, the shadow wage
pins to zero, and population craters instead of bootstrapping. The fix is a **subsistence
floor** in a **food-numéraire** frame. This section supersedes §4.1, §4.6, and §5 where they differ.

### 11.1 Two farming regimes

Numéraire = food; `w` = reservation real wage (food/worker), global (mobile labor).

- **Market farming** (hex reachable from a city, netback `nb_h = max_k(P_k − transport) > 0`):
  farmers enter until the marginal *sell* income equals `w`: `MFP_h = c + w/nb_h`. They eat `c`,
  ship surplus `F_h − L_h·c` to the best city. This is the von Thünen belt — intensity rises with `nb_h`.
- **Subsistence farming** (the floor, any viable hex `C_h > κ·c`): workers who can't earn the
  market wage farm to *eat*, packing a hex to `L_sub` where `F(L_sub) = L_sub·c` (average product = c,
  all food eaten locally, no surplus). This is what lets population bootstrap and fill the map.

At wage `w > 0`, only market farming + cities employ (labor scarce). As population grows, `w → 0`
and subsistence absorbs the residual on viable land. **Carrying capacity `K_sub = Σ_h L_sub(C_h)`.**

### 11.2 Cities & food price (unchanged in spirit from §4.2/§4.4)

`Y_k = A_k·N_k^α`, Pareto-split, marginal worker income `(A_k/ζ(p))·N_k^(α−p)`; workers join until
that minus `P_k·c` equals `w`. Anti-runaway needs `p > α` (§4.2). `P_k` clears city `k`'s food market
(surplus shipped in = `c·N_k`) — **a more productive city's workers bid its local price up** (Option A).

### 11.3 Population dynamics

Malthusian toward carrying capacity: grow while there's slack (wage above subsistence, or
unfilled subsistence room); shrink if over capacity. Food produced ≈ `N·c` at all times.

### 11.4 Solver (bisection — the anti-oscillation fix)

Outer bisection on `w` (total labor demand monotone ↓ in `w`); inner per-city bisection on `P_k`
(excess demand monotone ↓ in `P_k`) with basins reassigned each round. Bisection converges against
the step-shaped supply curves that broke v1's fixed-step tâtonnement.

### 11.5 Validation results (headless, cheap transport K0=0.5 — v1's bug regime)

- Population bootstraps 15 → ~390 and settles near `K_sub` (~382); **food produced = eaten every tick**.
- **Zero oscillation** across the run (the v1 failure regime).
- **Cities self-limit** (Pareto cap holds; no runaway).
- **Rich city dearer**: with `A_rich=9, A_poor=4.5`, `P_rich=1.36 > P_poor=0.95`, stable.
- Coherent structure: subsistence hinterland + market-farm belt + real cities.

### 11.6 Tuning axis (drives the collapsed urbanization slider)

The economy runs from **agrarian** (weak city productivity → tiny cities, everyone subsists) to
**urban** (strong city productivity → prominent cities pulling a market-farm belt). The collapsed
"urbanization" slider sets city productivity `A` (and `α,p` with `p>α`) along this axis. Too weak →
no cities; strong → prominent, still self-limiting cities. Good defaults live mid-range.

### 11.7 Still to layer on (validated core is the base)

Taxation → road crews/garrisons (soldiers as a 4th labor role, food+gold cost, distance-scaled),
incremental city-to-city road construction, per-city balance-of-trade + flow arrows. These are
resource sinks / UI on top of the validated equilibrium; each gets the same Node-first check.
