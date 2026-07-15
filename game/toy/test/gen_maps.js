// gen_maps.js — write the fixed-map catalog to maps/*.json (run once; committed).
//   Run: node test/gen_maps.js
'use strict';
var fs = require('fs'), path = require('path');
var Maps = require('../maps.js');

var dir = path.join(__dirname, '..', 'maps');
if (!fs.existsSync(dir)) fs.mkdirSync(dir);

var cat = Maps.catalog();
cat.forEach(function (m) {
  var file = path.join(dir, m.name + '.json');
  fs.writeFileSync(file, JSON.stringify(m));
  var terrCount = {};
  m.cells.forEach(function (t) { terrCount[t] = (terrCount[t] || 0) + 1; });
  console.log(m.name.padEnd(16) + m.cols + 'x' + m.rows +
    '  sites=' + m.sites.length +
    '  terrain=' + JSON.stringify(terrCount));
});
console.log('\nwrote ' + cat.length + ' maps to ' + dir);
