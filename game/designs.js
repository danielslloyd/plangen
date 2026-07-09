// designs.js — configurable design classes for Napoleonic+ ships and WW2
// ships/planes. Each design is two attributes (a, b) in [attrMin..attrMax],
// 1.0 = balanced baseline. What a/b mean depends on the class:
//   ship    — a = hull speed,   b = firepower
//   carrier — a = hull speed,   b = air wing (buffs embarked aircraft)
//   plane   — a = range,        b = firepower
// Higher attributes cost more (designCostFactor). Changing a design triggers a
// short retooling penalty (engine: player.retool[type]).

var DESIGN_CLASSES = {
	ship:    { a: { k: "speed", label: "Hull speed" }, b: { k: "power",   label: "Firepower" } },
	carrier: { a: { k: "speed", label: "Hull speed" }, b: { k: "airPower", label: "Air wing" } },
	plane:   { a: { k: "range", label: "Range" },      b: { k: "power",   label: "Firepower" } }
};

// Which unit types are designable (mirrors UNIT_TYPES[*].design).
function designableTypes() {
	return Object.keys(UNIT_TYPES).filter(function (t) { return UNIT_TYPES[t].design; });
}

function initDesigns(pl) {
	pl.designs = pl.designs || {};
	designableTypes().forEach(function (t) {
		if (!pl.designs[t]) pl.designs[t] = { a: 1, b: 1 };
	});
}

function designOf(pl, type) {
	if (!pl) return { a: 1, b: 1 };
	if (!pl.designs) initDesigns(pl);
	return pl.designs[type] || { a: 1, b: 1 };
}

// Cost multiplier for a design: 1.0 at balanced (a=b=1), rising toward the
// attribute ceiling. costBase sets the fixed share; the rest scales with a+b.
function designCostFactor(d) {
	var C = GameConfig.design;
	return C.costBase + (1 - C.costBase) * 0.5 * (d.a + d.b);
}

function clampAttr(v) {
	var C = GameConfig.design;
	return Math.max(C.attrMin, Math.min(C.attrMax, v));
}

// Change a design; if it actually changed, start the retooling penalty timer.
function setDesign(pl, type, a, b) {
	if (!UNIT_TYPES[type] || !UNIT_TYPES[type].design) return false;
	var d = designOf(pl, type);
	a = clampAttr(a); b = clampAttr(b);
	if (Math.abs(a - d.a) < 1e-6 && Math.abs(b - d.b) < 1e-6) return false;
	pl.designs[type] = { a: a, b: b };
	pl.retool = pl.retool || {};
	pl.retool[type] = GameConfig.design.retoolTurns;
	if (typeof gameLog === "function" && GameConfig.design.retoolTurns > 0) {
		gameLog(pl.name + " retools " + UNIT_TYPES[type].name + " (production slowed " +
			GameConfig.design.retoolTurns + " turns)");
	}
	return true;
}

// A short human-readable design summary, e.g. "spd 1.3 / pwr 0.8".
function designLabel(type, d) {
	var cls = DESIGN_CLASSES[UNIT_TYPES[type].design];
	if (!cls) return "";
	return cls.a.label + " " + d.a.toFixed(2) + " · " + cls.b.label + " " + d.b.toFixed(2);
}
