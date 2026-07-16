// strategies.js — the candidate "civilizational strategies" the sweep pits
// against each other on every (map, rule-set). Each controls the PLAYER levers
// (which sites to settle & when, road projects, tax rate); the sweep varies the
// GAME RULES (transport, urbanization, garrison cost, growth...). The balance
// question per rule-set: does one strategy dominate BOTH population and wealth
// (=> abstract it away), or do different strategies win different objectives
// (=> a genuine wide-vs-tall choice worth exposing to the player)?
//   Deterministic: no RNG, actions keyed off tick + world state only.
(function (global) {
  'use strict';
  var Econ = (typeof require !== 'undefined') ? require('./econ_engine.js') : global.Econ;

  // physical distance between two tiles — works on both the hex maps and the
  // planet graph (Econ.physDist dispatches on the world).
  function tileDist(world, a, b) { return Econ.physDist(world, a, b); }

  // Generic policy: found up to `cities` best sites (one per `interval` ticks),
  // hold tax at `tau`, wire roads per `roads` topology among founded cities.
  //   roads: 'none' | 'line' (chain in founding order) | 'tree' (each new to
  //          nearest existing) | 'full' (all pairs)
  function policy(spec) {
    var st;
    return {
      name: spec.name, label: spec.label, spec: spec,
      reset: function () { st = { founded: [], idx: 0, nextAt: 0, roadKeys: {} }; },
      onTick: function (world, t, siteIdx) {
        Econ.setTax(world, spec.tau);
        // ---- found next city on schedule ----
        if (st.idx < spec.cities && t >= st.nextAt) {
          // advance to next unsettled site
          while (st.idx < siteIdx.length && (world.hexes[siteIdx[st.idx]] || {}).isCity) st.idx++;
          if (st.idx < siteIdx.length && st.idx < spec.cities) {
            var hi = siteIdx[st.idx];
            if (Econ.foundCity(world, hi)) {
              st.founded.push(hi);
              wireRoads(world, spec.roads, st, hi);
            }
            st.idx++; st.nextAt = t + spec.interval;
          } else {
            st.idx = spec.cities; // no more sites available
          }
        }
        // 'full' keeps trying to complete the graph as cities appear
        if (spec.roads === 'full') completeGraph(world, st);
      }
    };
  }

  function link(world, st, a, b) {
    if (a === b) return;
    var key = a < b ? a + '-' + b : b + '-' + a;
    if (st.roadKeys[key]) return;
    if (Econ.startRoadProject(world, a, b)) st.roadKeys[key] = true;
  }
  function wireRoads(world, mode, st, hi) {
    var f = st.founded;
    if (mode === 'line') { if (f.length >= 2) link(world, st, f[f.length - 2], hi); }
    else if (mode === 'tree') {
      if (f.length >= 2) {
        var nearest = -1, nd = Infinity;
        for (var i = 0; i < f.length; i++) {
          if (f[i] === hi) continue;
          var d = tileDist(world, f[i], hi);
          if (d < nd) { nd = d; nearest = f[i]; }
        }
        if (nearest >= 0) link(world, st, nearest, hi);
      }
    }
  }
  function completeGraph(world, st) {
    var f = st.founded;
    for (var i = 0; i < f.length; i++) for (var j = i + 1; j < f.length; j++) link(world, st, f[i], f[j]);
  }

  // ---- the archetype roster ------------------------------------------------
  var ROSTER = [
    policy({ name: 'laissez_faire', label: 'Laissez-faire', cities: 2, interval: 10, tau: 0.00, roads: 'none' }),
    policy({ name: 'agrarian_wide', label: 'Agrarian (wide)', cities: 8, interval: 12, tau: 0.05, roads: 'none' }),
    policy({ name: 'urban_tall',    label: 'Urban (tall)',    cities: 2, interval: 10, tau: 0.30, roads: 'line' }),
    policy({ name: 'mercantile',    label: 'Mercantile',      cities: 5, interval: 12, tau: 0.35, roads: 'full' }),
    policy({ name: 'frontier',      label: 'Frontier',        cities: 6, interval: 18, tau: 0.20, roads: 'tree' }),
    policy({ name: 'balanced',      label: 'Balanced',        cities: 3, interval: 14, tau: 0.15, roads: 'tree' })
  ];

  function roster() { ROSTER.forEach(function (s) { s.reset(); }); return ROSTER; }
  function byName(n) { for (var i = 0; i < ROSTER.length; i++) if (ROSTER[i].name === n) { ROSTER[i].reset(); return ROSTER[i]; } return null; }

  var API = { roster: roster, byName: byName, policy: policy, ROSTER: ROSTER };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.EconStrategies = API;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
