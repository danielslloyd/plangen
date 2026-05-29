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
		for (var i = 0; i < theme.slots.length; i++) theme.map[theme.slots[i].key] = theme.slots[i].def;
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
		html += '<div style="display:grid; grid-template-columns:1fr 3.2em; gap:0.45em 0.6em; align-items:center;">';
		for (var i = 0; i < theme.slots.length; i++) {
			var s = theme.slots[i];
			var val = theme.map[s.key] || s.def;
			html += '<label style="font-size:85%;" for="lc_' + mode + "_" + s.key + '">' + s.label + "</label>";
			html += '<input type="color" id="lc_' + mode + "_" + s.key + '" data-mode="' + mode + '" data-key="' + s.key +
				'" value="' + val + '" style="height:2em; width:100%; cursor:pointer; border:none; border-radius:0.3em; background:none;">';
		}
		html += "</div>";
		content.innerHTML = html;

		var inputs = content.querySelectorAll("input[type=color]");
		for (var k = 0; k < inputs.length; k++) {
			inputs[k].addEventListener("input", function () {
				setOverlayColorValue(this.getAttribute("data-mode"), this.getAttribute("data-key"), this.value);
				recolorActiveOverlay();
			});
		}
		layerPanel.style.display = visible ? "block" : "none";
	}

	var resetBtn = document.getElementById("resetLayerColorsButton");
	if (resetBtn) resetBtn.onclick = function () { resetLayerColors(mode); };
}
