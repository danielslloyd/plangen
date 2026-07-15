# Hex Economy — Handoff

**Read with:** `hex_economy_v2_spec.md` (design, §11 = validated model) · `hex_economy.html` (v1, live, buggy) · `hex_economy_v2_core.js` (validated Node equilibrium — the thing to port)

---

## STATUS (2026-07-15, wave 2): organic cities + transport + UI — see `README.md`

Cities are now EMERGENT: tiles flip FARM↔URBAN (urban = gold, zero food) on the
city's MEDIAN wage (O(1), falls with N → self-limiting); connected urban tiles =
one agglomerated city; new towns emerge in food-rich areas; seeds kept. Transport
is per-edge (lognormal `edgeVar`) and roads MULTIPLY edge cost (`roadMult<1`,
decays to overland). 12 seeded maps. Sandbox has per-tile readouts + per-producer
food arrows. Third Node gate `validate_organic.js` (all three pass: `npm test`).
Finding: organic cities make population food-capped (strategy-invariant) while
wealth stays strategy-sensitive — see README / the memory note.

## STATUS (2026-07-14): action items 1–8 built — see `README.md`

All eight action items below are implemented and validated. The validated core
is now the shared engine `econ_engine.js` (runs identically in Node and the
browser). New: `hex_economy_v2.html` (sandbox with city-pair road tool, tax +
garrisons/crews, per-city balance-of-trade, flow arrows, Wealth/Labor views);
`test/validate_core.js` + `validate_layers.js` (the Node-first gates — both pass);
and a **balance harness** (`maps.js`, `strategies.js`, `game_runner.js`,
`harness.js`, `analyze.js`, `llm_steer.js`) that runs thousands of games on fixed
maps and classifies each rule-set as DIVERGENT / DOMINANT / BROKEN / FLAT. First
3402-game sweep: genuine wide-vs-tall divergence appears at cheap transport +
high urbanization; the garrison/wage fiscal axes are currently inert (a finding).
Locked items 14–16 resolved per Dan: incremental build (yes), gradual decay
**capped at overland — roads never worse than K0** (yes), distance-scaled garrison
using **physical** hex distance (yes). Read `README.md` first.

---

## What this is

A browser-based simulator of a local economy on a large editable hex map. Cities are industry/gold
centers that import food; countryside hexes farm in response to the netback price their city offers
(von Thünen). Player paints terrain, founds cities, builds roads; economy re-solves live.

## Where we are

- **v1 (`hex_economy.html`)** — shipped, runs, but **fatally buggy**: megacities with population ~1.7×
  total food production, sometimes far from any farmland.
- **v2** — redesigned to fix it + add the labor/wealth mechanics. **Spec written. Core equilibrium
  Node-validated. Nothing built yet.**

## The bug and the fix (short version)

v1 failed two ways at once: (1) fixed-step tâtonnement **doesn't converge** under cheap transport —
basins go bistable, price ping-pongs 2↔13 forever; (2) population keyed off **price, not delivered
food**, so a city reading "balanced" at price≈wage/c froze while physically receiving a fraction of
its food. Nothing enforced conservation.

v2 fixes both structurally: a **conserved, food-eating mobile workforce** sorts between farming and
city work, so a city can't hold more people than food reaches it; and **bisection** replaces
fixed-step updates, which converges against the step-shaped supply curves that broke v1.

**Validated (Node, at K0=0.5 — v1's exact failure regime):** population bootstraps 15→~390 against
carrying capacity 382 · food produced = food eaten every tick · zero oscillation · cities self-limit
(no runaway) · richer city bids food up (P_rich 1.36 > P_poor 0.95).

---

## Decisions locked

| # | Decision |
|---|---|
| 1 | Transport = physical distance; roads discount it (Dijkstra, water/mountain impassable) |
| 2 | Cities: player places initial + can found new + others emerge naturally |
| 3 | Workforce: **one mobile pool, capped by total food** (this is the conservation guarantee) |
| 4 | Food price: **real market, willingness-to-pay** — rich cities bid it up endogenously (not a formula) |
| 5 | Farm = diminishing returns to labor; city = accelerating aggregate returns, **Pareto-split** wealth |
| 6 | Migration: **fractional, start 50%, tunable** (not instant reallocation) |
| 7 | Malthusian population growth **ON** |
| 8 | Road crews stationed at **nearest city** |
| 9 | Pareto/agglomeration: **collapse to one urbanization slider** (auto-keeps p>α) |
| 10 | Flow arrows: **food + gold + labor** (all three) |
| 11 | **Roads = deliberate projects**: built only between city pairs, auto cheapest path, one segment/tick, large worker+gold batch. Replaces v1's drag-to-paint. |
| 12 | Road tiles beyond a safe radius need **garrison soldiers** — 4th labor role, eat food + draw gold, funded from tax pool |
| 13 | Taxation lever: skims gold from all cities equally → pool → pays crews/garrisons in connected cities. Gives each city a **planned vs market worker mix**. |
| 14 | Road build is **incremental** (each finished segment helps immediately) *(Claude default — unconfirmed)* |
| 15 | Unfunded garrison → road **degrades** toward overland cost (gradual, not lost) *(Claude default — unconfirmed)* |
| 16 | Garrison need **scales with distance** beyond safe radius *(Claude default — unconfirmed)* |

Items 14–16 were taken as defaults when Dan said "continue" — flag for confirmation, cheap to revisit.

## Outstanding decisions

1. **Sequencing** — finish Node-validating the tax/road/garrison layer first (Claude's lean, given
   Node just caught two model-killers), or start wiring the validated core into HTML now?
2. **Parameter defaults** — is mid-range urbanization (cities prominent but self-limiting) the right
   starting point?
3. Confirm/revisit locked items 14–16.

---

## Action items (in order)

1. **Node-validate the tax/road/garrison layer** — tax pool → soldier funding → road decay loop is
   stable; overreach genuinely bites; garrisons+crews eat without breaking conservation.
2. **Node-validate incremental road construction** — batch worker+gold cost, stalls when unaffordable.
3. **Port validated core into HTML** — replace v1's solver with `hex_economy_v2_core.js` equilibrium.
   Keep: hex grid + axial math, terrain brushes, Dijkstra transport, basin assignment, pan/zoom,
   knob framework, dark-slate aesthetic.
4. **Replace road tool** — city-pair selection + auto-route + incremental build (drops drag-to-paint).
5. **Add taxation lever + garrisons/crews.**
6. **Add readouts** — per-city balance of trade (pop split market/crew, food in, gold out, tax, net,
   price, wealth); flow arrows (food/gold/labor); new **Wealth** and **Labor** view modes.
7. **Tune urbanization slider** so defaults give prominent, self-limiting cities.
8. **End-to-end headless validation**, then visual check.

---

## Load-bearing constraints (don't lose these)

- **`p > α`** (Pareto concentration > agglomeration exponent) — *the* anti-runaway condition. Below it
  cities mathematically explode no matter what else. The collapsed slider must enforce it.
- **Bisection, never fixed-step** on both the shadow wage `w` and each city price `P_k`. This is the
  anti-oscillation fix; fixed-step is what broke v1.
- **Subsistence floor is mandatory.** Two earlier formulations collapsed without it: if farming is only
  demand-driven, low population → no city demand → no farming → wage 0 → population craters. Workers
  who can't earn the market wage must subsist-farm viable land (pack to `F(L)=L·c`, eat locally).
  Carrying capacity `K_sub = Σ L_sub(C_h)`.
- **Food is the numéraire**; `w` = reservation real wage in food, global (labor is mobile).
- **Invariant to assert every tick:** food produced ≈ food eaten. This is the regression test for the
  original bug.
- **Workflow:** validate economics in Node → build/rewrite HTML → `node --check` the embedded JS →
  `present_files`. Node caught two model-killers this session; don't skip it.
- `/tmp` prototypes do not survive; anything worth keeping goes to `/mnt/user-data/outputs`.
