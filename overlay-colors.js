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

// Hypsometric tint: cool blues for the sea floor, a green→gold→umber→snow
// ramp for land (calculateElevationColor blends these as ordered stops).
defineOverlayColors("elevation", [
	{ key: "oceanDeep",    label: "Ocean deep",    def: "#0a1a3c" },
	{ key: "oceanShallow", label: "Ocean shallow", def: "#3d6ea8" },
	{ key: "landLowland",  label: "Land lowland",  def: "#3f7d4f" },
	{ key: "landPlain",    label: "Land plain",    def: "#9fb35a" },
	{ key: "landUpland",   label: "Land upland",   def: "#b9924e" },
	{ key: "landMontane",  label: "Land montane",  def: "#7a5236" },
	{ key: "landPeak",     label: "Land peak",     def: "#ffffff" }
]);

defineOverlayColors("temperature", [
	{ key: "coldLow",  label: "Coldest", def: "#0000ff" },
	{ key: "coldHigh", label: "Cool",    def: "#00ffff" },
	{ key: "warmLow",  label: "Warm",    def: "#ffff00" },
	{ key: "warmHigh", label: "Hottest", def: "#ff0000" }
]);

// Rainfall map (data source: tile.rain). Land ramps parched tan → grassy
// green → lush teal; ocean is a flat muted blue so the land reads clearly.
defineOverlayColors("moisture", [
	{ key: "ocean",    label: "Ocean",         def: "#33485e" },
	{ key: "dry",      label: "Arid",          def: "#d8c9a0" },
	{ key: "mid",      label: "Moderate",      def: "#7cb342" },
	{ key: "wet",      label: "Wet",           def: "#1f6f5c" }
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
			// "change" (not "input") so the expensive full recolor runs only on the
			// FINAL color when the picker closes, not on every hue the drag crosses.
			inputs[k].addEventListener("change", function () {
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
	var saveBtn = document.getElementById("saveLayerColorsButton");
	if (saveBtn) saveBtn.onclick = function () { saveLayerColorsAsDefaults(mode); };
}

// Build a paste-ready code snippet of the overlay's CURRENT colours (as new
// defaults) and copy it to the clipboard, mirroring the terrain panel's
// "Export Colors" button. Paste it over the overlay's existing
// defineOverlayColors / defineOverlayPalette calls.
function saveLayerColorsAsDefaults(mode) {
	var theme = overlayColorThemes[mode];
	if (!theme || !theme.slots.length) return;
	var colorSlots = [], lines = [];
	for (var i = 0; i < theme.slots.length; i++) {
		var s = theme.slots[i];
		if (s.type === "palette") {
			var cur = (s.colors || s.def).map(function (c) { return '"' + c + '"'; }).join(", ");
			lines.push('defineOverlayPalette("' + mode + '", "' + s.key + '", "' + s.label + '", [' + cur + ']);');
		} else {
			var val = theme.map[s.key] || s.def;
			colorSlots.push('\t{ key: "' + s.key + '", label: "' + s.label + '", def: "' + val + '" }');
		}
	}
	var out = "// Current colours for overlay \"" + mode + "\" saved as defaults.\n" +
		"// Paste over the existing defineOverlayColors/defineOverlayPalette calls for this overlay.\n";
	if (colorSlots.length) out += 'defineOverlayColors("' + mode + '", [\n' + colorSlots.join(",\n") + "\n]);\n";
	if (lines.length) out += lines.join("\n") + "\n";
	_copySnippetToClipboard(out, document.getElementById("saveLayerColorsButton"));
}

// Clipboard helper shared by all the "Save as defaults" buttons. Flashes the
// button label as feedback.
function _copySnippetToClipboard(text, btn) {
	function done(ok) {
		if (!btn) return;
		var orig = btn.textContent;
		btn.textContent = ok ? "Copied!" : "Copy failed";
		setTimeout(function () { btn.textContent = orig; }, 1200);
	}
	if (navigator.clipboard && navigator.clipboard.writeText) {
		navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
	} else {
		var ta = document.createElement("textarea");
		ta.value = text;
		document.body.appendChild(ta);
		ta.select();
		var ok = false;
		try { ok = document.execCommand("copy"); } catch (e) {}
		document.body.removeChild(ta);
		done(ok);
	}
}
