'use strict';
/* Local server for trying the app without touching GitHub:
 *   node impl/tests/mock-server.js --demo     → http://localhost:8765/
 * Serves impl/src and, under /repos/…, an in-memory stand-in for the GitHub API (see fake-github.js).
 * It prints a 接続コード and a setup link for that fake repository; stopping the server empties it.
 *   --demo          made-up piano records and people, as the piano app would have written them
 *   --file <path>   serves that file at /dev/file (to try the import with a real file)
 *   --mount n=dir   serves another app (e.g. piano-log) at /n/, on the same fake repository
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const GHStore = require('../src/ghstore.js');
const { createFakeGitHub } = require('./fake-github.js');

const PORT = Number(process.env.PORT) || 8765;
const ROOT = path.join(__dirname, '..', 'src');
const TYPES = { '.mp4': 'video/mp4', '.bin': 'application/octet-stream', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

const gh = createFakeGitHub({ owner: 'dev', repo: 'Routine-data', token: 'dev-token' });
const L = GHStore.Layout;
if (process.argv.includes('--demo')) {
  const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  gh.put(L.pianoSettings, L.formatJson({ people: [{ id: 'p1', name: 'パパ', color: 0 }, { id: 'p2', name: 'たろう', color: 1 }, { id: 'p3', name: 'じろう', color: 2 }], since: day(5), updatedAt: 1 }));
  const byYear = {};
  [[0, ['p1'], 754], [1, ['p1'], 240], [1, ['p2', 'p3'], 1260], [2, ['p1'], 900], [3, ['p2'], 600], [4, ['p1'], 660]].forEach(([n, people, sec], i) => {
    const r = { id: 'demo' + i, date: day(n), start: '18:00', end: '18:20', min: Math.round(sec / 60), sec, people, names: '', how: '自動', savedAt: '' };
    (byYear[r.date.slice(0, 4)] = byYear[r.date.slice(0, 4)] || []).push(r);
  });
  for (const [y, list] of Object.entries(byYear)) gh.put(L.pianoYear(y), L.formatPianoYear(+y, list));
}
const code = GHStore.encodeCode({ owner: 'dev', repo: 'Routine-data', token: 'dev-token', api: `http://localhost:${PORT}` });

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname.startsWith('/repos/')) {
    // like api.github.com, the API is called from another origin (http://127.0.0.1:PORT is a handy second "device")
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, X-GitHub-Api-Version', 'Access-Control-Allow-Methods': 'GET, PUT' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const r = gh.handle(req.method, req.url, req.headers, body);
      res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(r.body));
    });
    return undefined;
  }
  const extra = process.argv.indexOf('--file');
  if (url.pathname === '/dev/file' && extra > 0 && fs.existsSync(process.argv[extra + 1])) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(fs.readFileSync(process.argv[extra + 1]));
  }
  if (url.pathname === '/dev/code') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(code); }
  if (url.pathname === '/dev/files') {      // what the fake repository holds, for checking by hand
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ log: gh.log, files: Object.fromEntries([...gh.files].map(([p, f]) => [p, f.text])) }));
  }
  // `--mount name=dir` serves another app (e.g. piano-log) at /name/, next to the same fake repository
  let root = ROOT, rel = decodeURIComponent(url.pathname);
  for (let i = 0; i < process.argv.length; i++) {
    const m = process.argv[i] === '--mount' && /^([\w-]+)=(.+)$/.exec(process.argv[i + 1] || '');
    if (m && rel.startsWith(`/${m[1]}/`)) { root = path.resolve(m[2]); rel = rel.slice(m[1].length + 1); }
  }
  const file = path.normalize(path.join(root, rel.endsWith('/') ? rel + 'index.html' : rel));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  return res.end(fs.readFileSync(file));
}).listen(PORT, () => {
  console.log(`routine-log dev server: http://localhost:${PORT}/`);
  console.log(`connection code for the fake repository: ${code}`);
  console.log(`setup link: http://localhost:${PORT}/#c=${code}`);
});
