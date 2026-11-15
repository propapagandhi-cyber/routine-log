'use strict';
/* Local server for trying the app without a Google account:
 *   node impl/tests/mock-server.js            → http://localhost:8765/
 * Serves impl/src and, at /exec, the real apps-script.gs on an in-memory fake spreadsheet
 * (see gas-harness.js). In the app's settings use  http://localhost:8765/exec  as the sheet URL.
 * `--demo` fills the fake sheet with made-up piano records and people.
 * `--file <path>` serves that file at /dev/file.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createBackend } = require('./gas-harness.js');

const PORT = Number(process.env.PORT) || 8765;
const ROOT = path.join(__dirname, '..', 'src');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.gs': 'text/plain; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

const backend = createBackend();
if (process.argv.includes('--demo')) {
  const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  backend.post({ action: 'settings', settings: { people: [{ id: 'p1', name: 'パパ', color: 0 }, { id: 'p2', name: 'たろう', color: 1 }, { id: 'p3', name: 'じろう', color: 2 }], since: day(5), updatedAt: 1 } });
  [[0, ['p1'], 754], [1, ['p1'], 240], [1, ['p2', 'p3'], 1260], [2, ['p1'], 900], [3, ['p2'], 600], [4, ['p1'], 660]].forEach(([n, people, sec], i) => {
    backend.post({ action: 'add', record: { id: 'demo' + i, date: day(n), start: '18:00', end: '18:20', min: Math.round(sec / 60), sec, names: '', people, how: '自動', savedAt: '' } });
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const json = (obj) => { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  if (url.pathname === '/exec') {
    if (req.method === 'GET') return json(backend.get(Object.fromEntries(url.searchParams)));
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => json(backend.post(body)));
    return undefined;
  }
  // `--file <path>` serves one local file at /dev/file (to try the import with a real file)
  const extra = process.argv.indexOf('--file');
  if (url.pathname === '/dev/file' && extra > 0 && fs.existsSync(process.argv[extra + 1])) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(fs.readFileSync(process.argv[extra + 1]));
  }
  const file = path.normalize(path.join(ROOT, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  return res.end(fs.readFileSync(file));
}).listen(PORT, () => console.log(`routine-log dev server: http://localhost:${PORT}/  (sheet URL: http://localhost:${PORT}/exec)`));
