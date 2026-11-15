'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const GHStore = require('../src/ghstore.js');
const RoutineSync = require('../src/sync.js');
const { createFakeGitHub } = require('./fake-github.js');

const L = GHStore.Layout;
const entry = (o) => {
  const e = Object.assign({ date: '2026-11-16', person: 'p1', item: 'wake', result: 'done', value: '06:20', updatedAt: '2026-11-16T00:00:00.000Z' }, o);
  e.id = `${e.date}_${e.person}_${e.item}`;
  return e;
};
const device = (gh) => RoutineSync.create(GHStore.create(gh.conn, { fetchImpl: gh.fetch }), {});
const kindOf = async (p, k) => { try { await p; return 'ok'; } catch (e) { assert.equal(e instanceof GHStore.StoreError, true); return e.kind === k ? k : `other:${e.kind}`; } };

test('connection code: round trip, spaces ignored, wrong codes refused', () => {
  const code = GHStore.encodeCode({ owner: ' someone ', repo: 'data', token: 'github_pat_x' });
  assert.equal(code.startsWith('KIROKU1:'), true);
  assert.deepEqual(GHStore.decodeCode(`  ${code.slice(0, 20)}\n${code.slice(20)} `), { owner: 'someone', repo: 'data', token: 'github_pat_x', branch: 'main', api: 'https://api.github.com' });
  assert.equal(GHStore.isCode('OUCHI1:abc'), false);
  assert.equal(GHStore.isCode('KIROKU1:!!!'), false);
  assert.throws(() => GHStore.encodeCode({ owner: 'a', repo: '', token: 't' }));
  // the token may only go to GitHub or to a local test server
  const evil = 'KIROKU1:' + Buffer.from(JSON.stringify({ o: 'a', r: 'b', t: 'c', a: 'https://evil.example' })).toString('base64url');
  assert.equal(GHStore.isCode(evil), false);
  assert.equal(GHStore.decodeCode(GHStore.encodeCode({ owner: 'a', repo: 'b', token: 'c', api: 'http://localhost:8765' })).api, 'http://localhost:8765');
});

test('layout: paths and file formats round trip (Japanese text, one line per day)', () => {
  assert.deepEqual(L.kindOf('routine/p1/2026.json'), { kind: 'routineYear', person: 'p1', year: 2026 });
  assert.deepEqual(L.kindOf('piano/records-2026.json'), { kind: 'pianoYear', year: 2026 });
  assert.equal(L.kindOf('routine/config.json').kind, 'routineConfig');
  assert.equal(L.kindOf('README.md'), null);
  const list = [entry(), entry({ item: 'memo', result: '', value: '出張、"引用"\n2行目' }), entry({ date: '2026-01-02', item: 'exercise', value: '筋トレ①' })];
  const text = L.formatRoutineYear('p1', 2026, list);
  assert.equal(text.split('\n').filter((l) => l.startsWith('"2026-')).length, 2);
  assert.equal(text.indexOf('2026-01-02') < text.indexOf('2026-11-16'), true);
  const back = L.parseRoutineYear(text);
  assert.deepEqual(back.sort((a, b) => (a.id < b.id ? -1 : 1)), list.sort((a, b) => (a.id < b.id ? -1 : 1)));
  assert.deepEqual(L.parseRoutineYear(L.formatRoutineYear('p1', 2026, [])), []);
  const recs = [{ id: 'b', date: '2026-11-16', start: '18:00', sec: 60, people: ['p1'] }, { id: 'a', date: '2026-11-15', start: '07:00', sec: 30, people: ['p1', 'p2'] }];
  assert.deepEqual(L.parsePianoYear(L.formatPianoYear(2026, recs)).map((r) => r.id), ['a', 'b']);
  assert.throws(() => L.parseRoutineYear('not json'), (e) => e.kind === 'format');
});

test('store: read, write, sha check, errors by kind', async () => {
  const gh = createFakeGitHub();
  const store = GHStore.create(gh.conn, { fetchImpl: gh.fetch });
  assert.equal(await store.read('a/b.json'), null);
  const sha = await store.write('a/b.json', '{"x":"あ"}\n', null, 'first');
  assert.deepEqual(await store.read('a/b.json'), { text: '{"x":"あ"}\n', sha });
  assert.equal(await store.blob(sha), '{"x":"あ"}\n');
  assert.deepEqual((await store.tree()).map((f) => f.path).sort(), ['README.md', 'a/b.json']);
  assert.equal(await kindOf(store.write('a/b.json', 'x', 'wrong-sha'), 'conflict'), 'conflict');
  assert.equal(await kindOf(store.write('a/b.json', 'x', null), 'conflict'), 'conflict');
  const bad = GHStore.create(Object.assign({}, gh.conn, { token: 'expired' }), { fetchImpl: gh.fetch });
  assert.equal(await kindOf(bad.tree(), 'auth'), 'auth');
  const lost = GHStore.create(Object.assign({}, gh.conn, { repo: 'gone' }), { fetchImpl: gh.fetch });
  assert.equal(await kindOf(lost.tree(), 'notfound'), 'notfound');
  gh.down = true;
  assert.equal(await kindOf(store.tree(), 'offline'), 'offline');
  // a repository without any commit lists as empty
  const empty = createFakeGitHub({ empty: true });
  assert.deepEqual(await GHStore.create(empty.conn, { fetchImpl: empty.fetch }).tree(), []);
});

test('sync: entries land in one file per person and year, and come back on another device (R-4)', async () => {
  const gh = createFakeGitHub();
  const a = device(gh), b = device(gh);
  await a.pushEntries('p1', 2026, [entry(), entry({ item: 'memo', result: '', value: 'メモ' })]);
  await a.pushEntries('p2', 2025, [entry({ person: 'p2', date: '2025-12-31' })]);
  assert.deepEqual([...gh.files.keys()].sort(), ['README.md', 'routine/p1/2026.json', 'routine/p2/2025.json']);
  const got = await b.pull();
  assert.deepEqual(got.files.map((f) => [f.kind, f.person, f.year, f.entries.length]).sort(), [['routineYear', 'p1', 2026, 2], ['routineYear', 'p2', 2025, 1]]);
  // nothing changed → nothing is read again (one request for the tree)
  const before = gh.requests;
  assert.deepEqual(await b.pull(), { files: [], removed: [] });
  assert.equal(gh.requests - before, 1);
  // the writer already knows its own files
  assert.deepEqual((await a.pull()).files, []);
});

test('sync: the newer write wins entry by entry; an older one changes nothing (sync merge 1)', async () => {
  const gh = createFakeGitHub();
  const a = device(gh), b = device(gh);
  await a.pushEntries('p1', 2026, [entry({ value: '06:00', updatedAt: '2026-11-16T05:00:00.000Z' })]);
  const commits = gh.log.length;
  const merged = await b.pushEntries('p1', 2026, [entry({ value: '07:30', result: 'fail', updatedAt: '2026-11-16T04:00:00.000Z' }), entry({ item: 'english', value: 'N' })]);
  assert.deepEqual(merged.map((e) => `${e.item}:${e.value}`).sort(), ['english:N', 'wake:06:00']);
  // sending only what is already there writes nothing
  await b.pushEntries('p1', 2026, [entry({ item: 'english', value: 'N' })]);
  assert.equal(gh.log.length, commits + 1);
});

test('sync: two devices writing at the same moment both keep their entries (R-11)', async () => {
  const gh = createFakeGitHub();
  const a = device(gh), b = device(gh);
  await a.pushEntries('p1', 2026, [entry()]);
  // b has read the file; before its write arrives, a writes another entry
  gh.beforePut = () => { gh.put('routine/p1/2026.json', L.formatRoutineYear('p1', 2026, [entry(), entry({ item: 'stretch', value: 'S' })])); };
  const merged = await b.pushEntries('p1', 2026, [entry({ item: 'english', value: 'N' })]);
  assert.deepEqual(merged.map((e) => e.item).sort(), ['english', 'stretch', 'wake']);
  assert.deepEqual(L.parseRoutineYear(gh.files.get('routine/p1/2026.json').text).map((e) => e.item).sort(), ['english', 'stretch', 'wake']);
});

test('sync: config — the newer one stays; piano files are read for the automatic item (R-3)', async () => {
  const gh = createFakeGitHub();
  const a = device(gh), b = device(gh);
  await a.pushConfig({ updatedAt: 10, people: [{ id: 'p1', name: 'A', items: [] }] });
  const kept = await b.pushConfig({ updatedAt: 5, people: [] });
  assert.equal(kept.people.length, 1);
  gh.put('piano/records-2026.json', L.formatPianoYear(2026, [{ id: 'r1', date: '2026-11-16', start: '18:00', sec: 720, people: ['p1'] }]));
  gh.put('piano/settings.json', L.formatJson({ people: [{ id: 'p1', name: 'A' }], since: '2026-11-15', updatedAt: 3 }));
  const got = await b.pull();
  assert.equal(got.files.find((f) => f.kind === 'pianoYear').records[0].sec, 720);
  assert.equal(got.files.find((f) => f.kind === 'pianoSettings').settings.since, '2026-11-15');
  // a file removed from the repository is reported once
  gh.files.delete('piano/records-2026.json');
  assert.deepEqual((await b.pull()).removed, ['piano/records-2026.json']);
});

test('sync: a failed read leaves the remembered state untouched, so the next pull gets everything', async () => {
  const gh = createFakeGitHub();
  const a = device(gh), b = device(gh);
  await a.pushEntries('p1', 2026, [entry()]);
  const realFetch = gh.fetch;
  const flaky = GHStore.create(gh.conn, { fetchImpl: (url, init) => (/git\/blobs/.test(url) ? Promise.reject(new TypeError('net')) : realFetch(url, init)) });
  const c = RoutineSync.create(flaky, b.shas);
  assert.equal(await kindOf(c.pull(), 'offline'), 'offline');
  assert.equal((await b.pull()).files.length, 1);
});
