'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const data = JSON.parse(html.match(/<script id="dataset" type="application\/json">([\s\S]*?)<\/script>/)[1]);
assert.deepEqual(data.dates, []);
assert.deepEqual(data.values, []);
assert.deepEqual(data.sourceRows, []);
assert.equal(data.meta.length, 260);
assert.equal(data.source.url, undefined);
assert.ok(!/drive\.google\.com|docs\.google\.com\/spreadsheets|C:\\\\Users/i.test(html));
assert.ok(!/<script[^>]+src=|<link[^>]+rel="stylesheet"/i.test(html), 'Must remain self-contained');
for (const file of ['app.js', 'excel-import.js', 'quant.js', 'spread-math.js', 'date-ranges.js', 'jszip.min.js']) {
  const source = fs.readFileSync(path.join(root, 'src', file), 'utf8');
  new vm.Script(source, {filename: file});
  if (file !== 'jszip.min.js') assert.ok(!/\bfetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|indexedDB/.test(source), file + ' must not transmit or persist uploads');
}
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
assert.equal(ids.length, new Set(ids).size, 'Duplicate element IDs');
assert.ok(fs.statSync(path.join(root, 'index.html')).size < 500000, 'Unexpected embedded data');
console.log('PASS: public artifact contains no observation data, private URL, external dependency or upload transmission code; JavaScript parses.');
