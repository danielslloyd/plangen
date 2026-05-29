// overlay-colors.js
// Dynamic, user-editable colours for the color overlays.
//
// Each overlay can declare named colour "slots" (defineOverlayColors). The
// top-left "Layer Colors" panel renders one picker per slot for whichever
// overlay is currently active and recolours the surface live. Overlay colour
// functions read their colours through getOverlayColor(id, key, fallback), so a
// missing/undefined theme always falls back to the original hard-coded colour.

var overlayColorThemes = {}; // overlayId -> { slots:[{key,label,def}], map:{key:hex} }

function defineOverlayColors(overlayId, slots) {
	var entry = overlayColorThemes[overlayId] || { slots: [], map: {} };
	for (var i = 0; i < slots.length; i++) {
		var s = slots[i];
		entry.slots.push({ key: s.key, label: s.label, def: s.def });
		if (entry.map[s.key] == null) entry.map[s.key] = s.def;
	}
	overlayColorThemes[overlayId] = entry;
	return entry;
}

// Returns the current hex for a slot, or the supplied fallback. Safe to call
// before any theme is defined.
function getOverlayColor(overlayId, key, fallback) {
	var e = overlayColorThemes[overlayId];
	if (e && e.map[key] != null) return e.map[key];
	return fallback;
}

function setOverlayColorValue(overlayId, key, hex) {
	var e = overlayColorThemes[overlayId];
	if (!e) e = overlayColorThemes[overlayId] = { slots: [], map: {} };
	e.map[key] = hex;
}

// ----------------------------------------------------------------------------
// PALETTE SLOTS
// An overlay that colours an unbounded number of features/regions by index
// (graph colouring, id % N, BFS distance, …) declares a *palette* slot: an
// ordered, editable list of swatches. The Layer Colors panel renders one picker
// per swatch; overlays read the live colours through getOverlayPaletteColor().
// ----------------------------------------------------------------------------

function _normalizeHex(c) {
	if (typeof c === "number") return "#" + ("000000" + (c >>> 0).toString(16)).slice(-6);
	return c;
}

function defineOverlayPalette(overlayId, key, label, defaultColors) {
	var entry = overlayColorThemes[overlayId] || { slots: [], map: {} };
	// Don't re-add a palette that already exists (files load once, but be safe).
	for (var i = 0; i < entry.slots.length; i++) {
		if (entry.slots[i].key === key) { overlayColorThemes[overlayId] = entry; return entry; }
	}
	var defs = [];
	for (var j = 0; j < defaultColors.length; j++) defs.push(_normalizeHex(defaultColors[j]));
	entry.slots.push({ key: key, label: label, type: "palette", def: defs.slice(), colors: defs.slice() });
	overlayColorThemes[overlayId] = entry;
	return entry;
}

// Live colour array for a palette slot (or the supplied fallback). Safe before
// any theme is defined.
function getOverlayPaletteColors(overlayId, key, fallbackArray) {
	var e = overlayColorThemes[overlayId];
	if (e) {
		for (var i = 0; i < e.slots.length; i++) {
			if (e.slots[i].key === key && e.slots[i].colors) return e.slots[i].colors;
		}
	}
	return fallbackArray || [];
}

// THREE.Color for a palette entry, cycling by index. Always returns a colour.
function getOverlayPaletteColor(overlayId, key, index, fallbackArray) {
	var arr = getOverlayPaletteColors(overlayId, key, fallbackArray);
	if (!arr.length) return new THREE.Color(0x888888);
	var n = arr.length;
	var i = ((Math.floor(index) % n) + n) % n;
	return new THREE.Color(_normalizeHex(arr[i]));
}

function setOverlayPaletteValue(overlayId, key, index, hex) {
	var e = overlayColorThemes[overlayId];
	if (!e) return;
	for (var i = 0; i < e.slots.length; i++) {
		if (e.slots[i].key === key && e.slots[i].colors) { e.slots[i].colors[index] = hex; return; }
	}
}

// ============================================================================
// SLOT DEFINITIONS  (defaults mirror the original hard-coded overlay colours)
// ============================================================================

defineOverlayColors("elevation", [
	{ key: "oceanShallow", label: "Ocean shallow", def: "#224488" },
	{ key: "oceanDeep",    label: "Ocean deep",    def: "#000044" },
	{ key: "landLow",      label: "Land low",      def: "#4b2f20" },
	{ key: "landHigh",     label: "Land high",     def: "#ffffff" }
]);

defineOverlayColors("temperature", [
	{ key: "coldLow",  label: "Coldest", def: "#0000ff" },
	{ key: "coldHigh", label: "Cool",    def: "#00ffff" },
	{ key: "warmLow",  label: "Warm",    def: "#ffff00" },
	{ key: "warmHigh", label: "Hottest", def: "#ff0000" }
]);

defineOverlayColors("moisture", [
	{ key: "dry", label: "Dry", def: "#8b4513" },
	{ key: "wet", label: "Wet", def: "#00ff00" }
]);

defineOverlayColors("plates", [
	{ key: "land",  label: "Land",  def: "#74ad5a" },
	{ key: "water", label: "Water", def: "#4f86c6" }
]);

// Shore Delta: distinct land vs water gradients (task — split gradients).
defineOverlayColors("strategicC", [
	{ key: "waterLow",  label: "Water low",  def: "#15294a" },
	{ key: "waterHigh", label: "Water high", def: "#3fffd4" },
	{ key: "landLow",   label: "Land low",   def: "#3a0d0d" },
	{ key: "landHigh",  label: "Land high",  def: "#ffd23f" }
]);

defineOverlayColors("mergedWatersheds", [
	{ key: "ocean", label: "Ocean",    def: "#6699cc" },
	{ key: "c1",    label: "Region A",  def: "#e2e8c6" },
	{ key: "c2",    label: "Region B",  def: "#b7c779" },
	{ key: "c3",    label: "Region C",  def: "#7d8a42" },
	{ key: "c4",    label: "Region D",  def: "#a67b5b" },
	{ key: "c5",    label: "Region E",  def: "#6f5a4d" },
	{ key: "c6",    label: "Region F",  def: "#4d3b2e" }
]);

// --- Slots for overlays whose colour functions live in
// generatePlanetRenderData_functions.js (which loads BEFORE this file, so its
// definitions must be centralised here). ----------------------------------

defineOverlayColors("simple", [
	{ key: "land",  label: "Land",  def: "#00aa44" },
	{ key: "water", label: "Water", def: "#0066cc" }
]);

// Shore Distance, Reverse Shore Distance and Neighbor Shore Comparison share
// the same four gradient anchors (ocean edge→deep, land edge→inland).
var SHORE_SLOTS = [
	{ key: "oceanNear", label: "Ocean edge", def: "#87ceeb" },
	{ key: "oceanFar",  label: "Ocean deep", def: "#000080" },
	{ key: "landNear",  label: "Land edge",  def: "#ffff00" },
	{ key: "landFar",   label: "Inland",     def: "#006400" }
];
// Shore Distance additionally highlights "node" tiles (local extremes of the
// shore-distance field) in distinct colors.
var SHORE_NODE_SLOTS = SHORE_SLOTS.concat([
	{ key: "landNode",  label: "Land node",  def: "#ff2d2d" },
	{ key: "oceanNode", label: "Ocean node", def: "#ff00ff" }
]);
defineOverlayColors("shore", SHORE_NODE_SLOTS);
defineOverlayColors("reverseShore", SHORE_SLOTS);
defineOverlayColors("neighborShore", SHORE_SLOTS);

// Net Shore: diverging gradients per domain (negative→mid→positive).
defineOverlayColors("shoreRatio", [
	{ key: "landMid", label: "Land zero",  def: "#ffff00" },
	{ key: "landNeg", label: "Land neg",   def: "#ff0000" },
	{ key: "landPos", label: "Land pos",   def: "#006400" },
	{ key: "oceanMid", label: "Ocean zero", def: "#0000ff" },
	{ key: "oceanNeg", label: "Ocean neg",  def: "#000080" },
	{ key: "oceanPos", label: "Ocean pos",  def: "#ff00ff" }
]);

// Narrow Connectors: isthmus (land bridge) + strait (ocean channel) gradients,
// over a dim land/water context.
defineOverlayColors("narrowConnectors", [
	{ key: "land",          label: "Land (dim)",   def: "#3a4a32" },
	{ key: "water",         label: "Water (dim)",  def: "#1b2a3a" },
	{ key: "isthmusWeak",   label: "Isthmus wide", def: "#ffd9a0" },
	{ key: "isthmusStrong", label: "Isthmus thin", def: "#ff6a00" },
	{ key: "straitWeak",    label: "Strait wide",  def: "#bff7ff" },
	{ key: "straitStrong",  label: "Strait thin",  def: "#00b3ff" }
]);

defineOverlayColors("thickness", [
	{ key: "oceanThin",  label: "Ocean thin",  def: "#b0e0e6" },
	{ key: "oceanThick", label: "Ocean thick", def: "#0047ab" },
	{ key: "landThin",   label: "Land thin",   def: "#ffffcc" },
	{ key: "landThick",  label: "Land thick",  def: "#228b22" }
]);

// Watersheds & Watershed Regions: ocean fill + an editable region palette.
// Watersheds uses the 6-colour basin palette (assignWatershedColors); Watershed
// Regions uses the 5-colour region palette (WATERSHED_REGION_COLORS).
defineOverlayColors("watersheds", [{ key: "ocean", label: "Ocean", def: "#6699cc" }]);
defineOverlayPalette("watersheds", "regions", "Regions",
	["#e2e8c6", "#b7c779", "#7d8a42", "#a67b5b", "#6f5a4d", "#4d3b2e"]);
defineOverlayColors("watershedRegions", [{ key: "ocean", label: "Ocean", def: "#6699cc" }]);
defineOverlayPalette("watershedRegions", "regions", "Regions",
	["#606c38", "#283618", "#fefae0", "#dda15e", "#bc6c25"]);

// ============================================================================
// TOP-LEFT "LAYER COLORS" PANEL
// ============================================================================

// Recolour the visible surface using the active overlay (cheap path — no full
// render-data regeneration).
function recolorActiveOverlay() {
	if (typeof planet === "undefined" || !planet || !planet.topology) return;
	if (planet.renderData && planet.renderData.surface && planet.renderData.surface.geometry &&
		typeof recalculateBufferGeometryColors === "function") {
		recalculateBufferGeometryColors(planet.topology.tiles, planet.renderData.surface.geometry, surfaceRenderMode);
	}
}

function resetLayerColors(mode) {
	var theme = overlayColorThemes[mode];
	if (theme) {
		for (var i = 0; i < theme.slots.length; i++) {
			var slot = theme.slots[i];
			if (slot.type === "palette") {
				slot.colors = slot.def.slice();
			} else {
				theme.map[slot.key] = slot.def;
			}
		}
	}
	refreshLayerColorPanel(mode);
	recolorActiveOverlay();
}

// Show the correct top-left colour panel for the active overlay, respecting
// whether the interface is currently visible. Terrain keeps its dedicated
// panel; every other overlay uses the dynamic Layer Colors panel.
function refreshLayerColorPanel(mode) {
	mode = mode || (typeof surfaceRenderMode !== "undefined" ? surfaceRenderMode : "terrain");
	var terrainPanel = document.getElementById("terrainColorPanel");
	var layerPanel = document.getElementById("layerColorPanel");
	if (!layerPanel) return;

	var visible = false;
	try { visible = !!(ui && ui.controlPanel && ui.controlPanel.is(":visible")); } catch (e) {}

	if (mode === "terrain") {
		if (terrainPanel) terrainPanel.style.display = visible ? "block" : "none";
		layerPanel.style.display = "none";
		return;
	}
	if (terrainPanel) terrainPanel.style.display = "none";

	var ov = (typeof getColorOverlay === "function") ? getColorOverlay(mode) : null;
	var title = ov && ov.name ? ov.name : mode;
	var theme = overlayColorThemes[mode];
	var content = document.getElementById("layerColorContent");

	if (!theme || !theme.slots.length) {
		content.innerHTML = '<div style="opacity:0.6; font-size:85%;">No adjustable colours for &ldquo;' + title + '&rdquo;.</div>';
		layerPanel.style.display = visible ? "block" : "none";
	} else {
		var html = '<div style="font-size:90%; opacity:0.8; margin-bottom:0.6em;">' + title + '</div>';
		// Single-colour slots in a 2-column grid; palette slots span both columns
		// as a wrapping row of small swatches.
		html += '<div style="display:grid; grid-template-columns:1fr 3.2em; gap:0.45em 0.6em; align-items:center;">';
		for (var i = 0; i < theme.slots.length; i++) {
			var s = theme.slots[i];
			if (s.type === "palette") {
				html += '<div style="grid-column:1 / -1;">';
				html += '<div style="font-size:85%; margin-bottom:0.25em;">' + s.label + "</div>";
				html += '<div style="display:flex; flex-wrap:wrap; gap:0.3em;">';
				for (var p = 0; p < s.colors.length; p++) {
					html += '<input type="color" data-mode="' + mode + '" data-key="' + s.key + '" data-index="' + p +
						'" value="' + s.colors[p] + '" title="' + s.label + " " + (p + 1) +
						'" style="height:1.8em; width:1.8em; cursor:pointer; border:none; border-radius:0.3em; background:none; padding:0;">';
				}
				html += "</div></div>";
			} else {
				var val = theme.map[s.key] || s.def;
				html += '<label style="font-size:85%;" for="lc_' + mode + "_" + s.key + '">' + s.label + "</label>";
				html += '<input type="color" id="lc_' + mode + "_" + s.key + '" data-mode="' + mode + '" data-key="' + s.key +
					'" value="' + val + '" style="height:2em; width:100%; cursor:pointer; border:none; border-radius:0.3em; background:none;">';
			}
		}
		html += "</div>";
		content.innerHTML = html;

		var inputs = content.querySelectorAll("input[type=color]");
		for (var k = 0; k < inputs.length; k++) {
			inputs[k].addEventListener("input", function () {
				var idx = this.getAttribute("data-index");
				if (idx != null) {
					setOverlayPaletteValue(this.getAttribute("data-mode"), this.getAttribute("data-key"), +idx, this.value);
				} else {
					setOverlayColorValue(this.getAttribute("data-mode"), this.getAttribute("data-key"), this.value);
				}
				recolorActiveOverlay();
			});
		}
		layerPanel.style.display = visible ? "block" : "none";
	}

	var resetBtn = document.getElementById("resetLayerColorsButton");
	if (resetBtn) resetBtn.onclick = function () { resetLayerColors(mode); };
}
