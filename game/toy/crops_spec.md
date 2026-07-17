# Crops & Regional Trade — design spec

Status: **proposed, not built.** Handoff document.
Everything under "Current state" IS built and passing. Everything under
"The design" is not. The numbers in §2 and §3 are measured against
`maps/sample-map.json`, not estimated.

Goal: replace the toy economy's single generic `food` good with **named crops**,
each with its own per-city price and its own dessert, so scarcity in one place
becomes a price signal in another and cities import what they cannot grow. Today
every route is "ship grain to the nearest city" — a distance gradient with no
comparative advantage. Crops add Ricardo on top of von Thünen.

Read `hex_economy_v2_spec.md` first (§11 especially). This spec assumes it.

---

## 1. Current state (built, green)

`econ_engine.js` is the shared browser+Node engine. Recent rework, all landed:

- **Michaelis–Menten yield curve.** `Ffood(C,L,κ) = C·L/(L+κ)`, replacing
  `C·(1−e^{−L/κ})`. MM's fatter tail is what makes the marginal cap sublinear in
  C rather than pinned just under the `C/c` ceiling.
- **Marginal population cap.** A tile fills to where the *next* worker's own
  output falls to `c`, not where the collective breaks even:
  **`Lsub = √(C·κ/c) − κ`**. Closed form, sublinear in C, self-generates the
  viability cliff at `C ≤ κ·c`. This is a **tenure commitment**: a marginal cap
  leaves visible spare food on the tile, so it only holds where someone can
  *exclude* the next arrival. An open commons converges to the average rule.
  Result: subsistence share of population 57% → 33%.
- **Desserts.** `dessertX` food → 1 dessert, ships as ONE unit (transport per
  food-equivalent ÷X), sells for `dessertPremium · dessertX · P`. Premium **must**
  be < 1 or every tile converts at the city gate. Food wins near the city,
  desserts win past `d* = X·P·(1−m)/(K0·(X−1))`. Settled radius multiplies by
  `m·X` — keep that product ~1.5–2.5. Default **off**; `desserts:false`
  reproduces the pre-dessert equilibrium bit-identically. Drops city-less share
  44% → 23% without moving city count or extent.
- **Displacement `D`.** Grain demand displaced per dessert, richest-first. Net
  grain **burned** per dessert is `X − D`, so `D=0` is the *most* wasteful setting
  (pure export, feeds nobody) and `D = X` is exactly food-neutral. `D > X` is
  grain from nothing and is clamped. Default 0.
- **Conservation is a balance, not an equality:**
  `produced == (eaten − displaced) + X·desserts + wasted − shortfall`.
  Holds at **machine precision** (1e-15) in every settled state measured, across
  all D and all growth modes. A transient error ~3e-3 exists and **predates all
  of this** (desserts-off shows a *larger* one than desserts-on).
- **Growth controllers** (`cfg.growth`): `bangbang` (default, legacy),
  `deadband`, `proportional` (**experimental — collapses on some maps, don't
  ship**).
- **Harness**: shape metrics (`farmedTiles`, `farmedOutsideBasin`, `landTiles`),
  amplitude-based oscillation, `structuralChurn`, a **Leverage** report, and a
  **permalink** per row into `planet_economy.html` (hash params, non-defaults
  only, pins exact seeded tiles, `ticks=` fast-forwards; verified to reproduce a
  Node run bit-identically).

### Facts worth not rediscovering

- **`supportedTarget` is NOT carrying capacity.** When labor is scarce the wage
  bisection drives `formal == Npool`, so it is a lagged copy of last tick's N —
  measured `N/supportedTarget` pinned at `1.0762 == 1 + r·tanh(1)`. Valid only as
  an *overshoot* test. The real "distance below capacity" signal is **`eq.room`**.
  Two controller attempts keyed off `supportedTarget` and both instantly stalled
  the economy at N≈1015.
- **The Malthus controller is bang-bang.** `sig ∈ {1, 0.5, 0, −1}`, never scaled
  by the error, so the step is a fixed `r·tanh(sig)` (7.6% at r=0.10) and it can
  only stop if `sig` lands exactly on 0. It rings at ~`r` peak-to-peak forever
  (measured median oscAmp = 0.100 = r, exactly). **Pre-existing** — the old engine
  rings identically (11.4%, 20 flips). It is a *stable limit cycle*, not
  breakage: cities and extent are dead steady through it.
- **`growth:'deadband'` fixes it for free.** Keyed on `eq.room`, `growBand=0.05`:
  ripple 11.4% → **0.0%**, N/cities/extent unchanged (224864 vs 223817). No
  underfill — bang-bang's *mean* sits below its own cycle peak, so settling high
  compensates.
- **Market supply is a staircase.** At `w=0`, `mkt()` reduces to `E = √(κc/C)` —
  independent of netback. Price only gates *whether* a tile ships, not how much it
  grows, so demand generically crosses inside a riser and **no clearing price
  exists**. The bisection lands on the jump; grain delivered past the last mouth
  is disposed of as `glut`. The old exponential had the same degeneracy; its
  staircase merely happened to cancel. **With G crops this becomes all-or-nothing
  per (tile, crop) — watch it.**
- **Extent is welded to density.** `Lsub = √(Cκ/c) − κ` puts the cliff at
  `C = κc`, so κ is *both* the viability cliff and the productivity scale. Raising
  κ to empty poor land also makes good land worse (N 237k → 133k as κ 120 → 400).
  Across 288 games **no knob moves `farmedTiles`** (fold 1.0 on five of six axes);
  ~87% of land is farmed regardless. Fix would be a `minViableCap` decoupled from
  κ. **Unsolved, orthogonal to crops.**

### Known-failing tests (all assert the *replaced* model — not regressions)

- `validate_core` Part A ×2 — its purpose is **port fidelity to
  `hex_economy_v2_core.js`**; the model deliberately changed, so its premise is
  void. Either retire it, or add `foodModel:'legacy'|'marginal'` so the reference
  stays reproducible. **Undecided.**
- `validate_transport` ×1 — asserts the legacy independent-curve model *would*
  exceed capacity, as a contrast. Under the marginal rule both formulations
  coincide (marginal product depends only on total labour), so the bug it
  contrasts against no longer exists. Obsolete by construction.
  `cfg.subsistenceShare` is now inert.

---

## 2. The crop data already exists — and the obvious use of it fails

PlanGen generates per-tile crop suitabilities and **already exports them**; the
toy economy **already throws them away**.

`post-generation.js:494`:

```js
tile.calories = Math.max(0, tile.wheat*7, tile.corn*15, tile.rice*11,
                            tile.pasture*200, tile.fish*1300);
```

`calories` is **exactly the best-crop envelope** — a max over crops, with per-crop
calorie densities already chosen. The layers `wheat, corn, rice, pasture, fish,
timber` ship in every `plangen-game-map` (0..1, stored ×100 — see
`docs/game-export-format.md`), and `game_map_adapter.js` reads **only** `calories`
into `capBase`, discarding *which* crop won.

### The trap: do NOT decompose capacity per crop

The obvious move is `C_g(tile) = suit_g(tile) · YIELD_g · capScale`, inheriting
the multipliers. **Measured on `sample-map.json`, this is dead on arrival:**

| best land crop by `suit × YIELD` | share of land |
|---|---|
| pasture | **90.7%** |
| wheat | 7.8% |
| corn | 1.5% |
| rice | **0.0% — never wins anywhere** |

Median winner/runner-up ratio: **11.57×**. Only 2% of tiles are within 1.5×. Crop
choice would be terrain-determined and **price-blind**: near-total autarky, no
trade, mechanic pointless.

The cause is the multipliers, not the map. `pasture×200` beats `corn×15` by 13×
regardless of suitability, and all four crops peak at 1.00 raw suitability, so the
constants are pure distortion *for this purpose*. They are correctly calibrated
for producing a scalar `calories` envelope — a different job.

### The map itself is genuinely competitive

Mean **raw** suitability by land terrain:

| terrain | n | wheat | corn | rice | pasture |
|---|---|---|---|---|---|
| plains | 32 | **0.402** | 0.059 | 0.000 | 0.000 |
| desert | 21 | **0.230** | 0.000 | 0.000 | 0.000 |
| grassland | 655 | 0.254 | 0.305 | 0.241 | **0.334** |
| hills | 142 | 0.276 | 0.297 | 0.124 | **0.408** |
| mountain | 107 | 0.188 | 0.000 | 0.000 | **0.467** |
| forest | 8 | 0.000 | 0.007 | 0.680 | **0.845** |
| tundra | 88 | 0.000 | 0.000 | 0.000 | **0.279** |

**Grassland is 59% of the land and a near four-way tie.** The competition is
there; the multipliers bury it.

---

## 3. The design

### 3.1 Capacity stays; only crop IDENTITY is new

```
C_g(tile) = calories(tile) · ( suit_g(tile) / max_h suit_h(tile) )
```

The best crop yields **full `calories`**, so:

- **Capacity is unchanged** ⇒ the entire existing calibration (κ, N, cities,
  extent) survives untouched. No recalibration.
- **Free bit-identical regression anchor**: one crop per tile + a single price
  reproduces today's engine exactly. Any divergence at stage 1 is a bug.
- Growing the 2nd-best crop costs a **yield penalty equal to the suitability
  ratio** — which is what makes a price signal able to flip a tile.
- Impossible crops stay impossible (rice on plains: `0/0.402 = 0`).

Measured on `sample-map.json`:

| | `suit × YIELD` (trap) | `calories × suit ratio` (**proposed**) |
|---|---|---|
| wheat / corn / rice / pasture | 7.8 / 1.5 / **0.0** / 90.7 % | **27.4 / 26.4 / 20.3 / 26.0 %** |
| median switching margin | 11.57× (price-blind) | **1.69×** |
| land a price signal can flip (2nd within 25%) | 2% | **22%** |

Switching-margin distribution (proposed): p10 **1.10**, p25 1.31, median 1.69,
p75 2.27, p90 4.18. A balanced four-crop map with a fifth of the land genuinely
contested. Rice goes from dead to 20%.

### 3.2 Preferences: Cobb–Douglas, and this is not a taste call

**Perfect substitutes kill the mechanic.** If calories are calories, every
consumer buys only the cheapest crop; all other demands collapse to zero, there is
no interior equilibrium, no trade. Consumers must value *variety*.

**Choose Cobb–Douglas specifically to protect the solver.** Under Cobb–Douglas,
demand for crop *g* depends only on `P_g` and income — **not on other crops'
prices**. That is the gross-substitutes property, and it is exactly what keeps
each price's excess demand monotone *in its own price*, which is the entire basis
of the existing bisection.

> With CES (σ≠1), demand for wheat starts depending on the price of rice.
> Coordinate-wise bisection over a coupled system is precisely the class of
> problem that made v1's tâtonnement oscillate (`hex_economy_v2_spec.md` §11).
> Do not reintroduce it through a side door.

Demand at city *k*: `q_{g,k} = share_g · income_k / P_{g,k}`, with
`Σ_g share_g = 1`. The calorie constraint becomes a quantity index
`c = Π_g q_g^{share_g}` — "fed" means a *basket*, not a scalar.

Falls out free:

- **Rarity → price is automatic.** A crop scarce near city *k* has a high local
  `P_{g,k}` ⇒ imports. No special-casing.
- **Market access becomes dietary variety.** Subsisters have no market, so they
  eat their one crop; cities eat the basket. Frontier eats gruel, cities eat well
  — emergent, not bolted on.

### 3.3 One crop per tile

Each tile grows the **single** crop with the best netback (over all `(crop, city)`
pairs). Fields specialise, it is realistic, `mkt()` stays untouched, and it keeps
the stage-1 anchor exact. Do **not** attempt a within-tile labour allocation
across crops — a nested optimisation inside the inner loop, for little gain.

### 3.4 Desserts, per crop

`netbackOf(cfg, P, t)` already takes a price and a transport cost and returns the
better of grain and dessert. It generalises directly: evaluate per `(crop, city)`
and take the best. Each crop gets its own `dessertX_g` / `dessertPremium_g` —
this is where **regional specialities** come from (highland whisky, southern
wine) instead of one generic density trick.

### 3.5 Conservation

Becomes **G per-crop identities** rather than one — *cleaner*, not messier. Each
crop carries the same balance that holds today, with its own `X_g`,
`displaced_g`, `wasted_g`, `shortfall_g`.

---

## 4. Staging

**Stage 0 — sanity (½ day).** Wire `C_g` per §3.1 and assert that with `G=1`
(best crop only, one price) the engine reproduces current numbers **bit-identically**.
Do not skip this; it is the only thing between a subtle crop bug and a lost week.

**Stage 1 — crops, no desserts.** `G` prices per city; Cobb–Douglas demand; one
crop per tile. Prove: (a) the w→P bisection still converges with `G` prices per
city; (b) per-crop conservation at machine precision, settled; (c) **crops
actually move** — a design that produces autarky has failed even if it converges.

**Stage 2 — per-crop desserts.** Reuse `netbackOf` with crop-specific
`X_g`/`premium_g`. Re-verify the balance.

**Stage 3 — trade readouts.** Add per-crop price spread and import/export volume
to the Leverage report. The new question worth measuring is *"does any crop
actually cross a basin boundary?"*

---

## 5. Risks

| risk | why | mitigation |
|---|---|---|
| **Solver cost** | `G` (or `2G`) goods multiply the per-city price bisections. The 288-game sweep already takes 929s. | Measure at stage 1. Consider Newton over bisection, or fewer `priceRounds` once monotonicity is proven. |
| **Bisection convergence** | The design rests on per-price monotonicity. | Cobb–Douglas (§3.2). Do not substitute CES without a new convergence argument. |
| **The staircase** | `w=0` supply is already all-or-nothing per tile; with crops it is all-or-nothing per *(tile, crop)*. | `foodGlut` is already a metric; track it per crop. |
| **~~Autarky~~** | ~~one crop dominates~~ | **Resolved by §3.1** — measured 27/26/20/26 split, 22% of land contested. Re-run the check on any new map. |
| **Extent still unsolved** | Crops do not address the carpet. | Orthogonal; `minViableCap`. |

---

## 6. Open decisions (not the implementer's to make alone)

1. **`validate_core` Part A** — retire, or add `foodModel:'legacy'` to keep the
   reference-core anchor reproducible?
2. **`growth` default** — flip to `deadband`? Costs nothing, removes the ripple,
   but silently rewrites what every existing sweep means.
3. **`newCoreMinFarmers`** — recalibrated 6000 → 1500 for the marginal cap. The
   *principled* gate is local **surplus** (what actually feeds a city), not farmer
   mass; the marginal rule makes farmer mass a poor proxy by design.
4. **`fish`** — crop #5, or stays a separate mechanic? It is currently baked into
   `calories` on water tiles and handled via `fishCap` + an adjacent-water share.
   §3.1's ratio rule is land-only as written; fish needs an explicit decision.
5. **`timber`** — exported, unused, not a food. Crop, industry input, or ignore?
6. **`minViableCap`** — decouple extent from κ, or accept ~87% land occupancy?

---

## 7. Reproducing the measurements in this spec

All numbers in §2/§3 come from `maps/sample-map.json` via `j.tileLayers.<crop>`
(sparse `{indices, values, scale}`; divide by `scale`) and `j.legend.terrain`
(index → name; `ocean/coast/lake/seaIce` are water). Compute per-tile
`argmax_g suit_g` and the 1st/2nd ratio over land tiles. ~20 lines, runs in
seconds. **Re-run it before trusting this spec on any other map.**
