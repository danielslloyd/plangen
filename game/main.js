// main.js — bootstrap: load the default map, start a game, kick off the loop.

function bootGame(mapJson) {
	loadMapData(mapJson);
	var seed = parseInt(document.getElementById("seedInput").value) || 12345;
	newGame(seed);
	initRenderer(document.getElementById("mapCanvas"));
	initUI();
	// aim the camera at the first capital
	if (G.cities.length) {
		var t = G.cities[0].tile;
		R.view.lonC = M.latLon[t * 2 + 1];
		R.view.latC = M.latLon[t * 2];
	}
	R.dirty = true;
	renderLoop();
}

window.addEventListener("DOMContentLoaded", function () {
	fetch("../maps/sample-map.json")
		.then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
		.then(bootGame)
		.catch(function (e) {
			document.getElementById("tabBody").innerHTML =
				"<div class='hint'>Couldn't fetch ../maps/sample-map.json (" + e +
				"). Use “Load map” in the top bar to open an exported game map.</div>";
			// Still init enough UI for the file input to work.
			document.getElementById("mapFile").onchange = function (ev) {
				var f = ev.target.files[0];
				if (!f) return;
				var reader = new FileReader();
				reader.onload = function (e2) { bootGame(JSON.parse(e2.target.result)); };
				reader.readAsText(f);
			};
		});
});
