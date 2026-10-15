'use strict';
// CI-only static serving for subpath regression. Never reads workbook files.
if (!process.env.CI) throw new Error('The test server is intended for GitHub CI.');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const page = fs.readFileSync(path.resolve(__dirname, '../index.html'));
http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  if (pathname === '/econ/' || pathname === '/econ/index.html') {
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'});
    res.end(page);
  } else {
    res.writeHead(404, {'Content-Type': 'text/plain'});
    res.end('Not found');
  }
}).listen(4173, '127.0.0.1', () => console.log('CI page ready at http://127.0.0.1:4173/econ/index.html'));
