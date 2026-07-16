// main.js — bootstrap: load the default map, open the setup screen, start the
// render loop. The game itself begins from the setup screen's Start button.

function bootGame(mapJson) {
	loadMapData(mapJson);
	initRenderer(document.getElementById("mapCanvas"));
	initUI();
	// frame the whole world behind the setup screen
	R.view.lonC = 0; R.view.latC = 10;
	R.view.scale = Math.max(1.5, R.canvas.width / 400);
	R.dirty = true;
	renderLoop();
	document.getElementById("tabBody").innerHTML =
		"<div class='hint'>Set up a new game to begin.</div>";
	showSetupScreen();
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
