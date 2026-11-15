'use strict';
/* A round trip against the real GitHub API (not part of `node --test`; needs network and a token).
 *
 *   GH_TOKEN=<token> node impl/tests/live-github.js <owner> <repo>
 *
 * Writes routine/selftest/1999.json in that repository through the same code the app uses,
 * reads it back as a second device, checks the merge of a concurrent write, and reports.
 * The file stays behind; delete it afterwards (the script prints its path).
 */
const GHStore = require('../src/ghstore.js');
const RoutineSync = require('../src/sync.js');

async function main() {
  const [owner, repo] = process.argv.slice(2);
  const token = process.env.GH_TOKEN;
  if (!owner || !repo || !token) { console.error('usage: GH_TOKEN=… node impl/tests/live-github.js <owner> <repo>'); process.exit(2); }
  const conn = GHStore.decodeCode(GHStore.encodeCode({ owner, repo, token }));   // through the 接続コード, like a device
  const device = () => RoutineSync.create(GHStore.create(conn), {});
  const stamp = new Date().toISOString();
  const e = (item, value, at) => ({ id: `1999-01-02_selftest_${item}`, date: '1999-01-02', person: 'selftest', item, result: 'done', value, updatedAt: at || stamp });
  const check = (name, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) process.exitCode = 1; };

  const a = device(), b = device();
  const tree0 = await GHStore.create(conn).tree();
  check(`tree() lists the repository (${tree0.length} files)`, Array.isArray(tree0));

  const first = await a.pushEntries('selftest', 1999, [e('wake', '06:20'), e('memo', `日本語のメモ ${stamp}`)]);
  check('write through the Contents API', first.length >= 2);

  const got = await b.pull();
  const file = got.files.find((f) => f.kind === 'routineYear' && f.person === 'selftest');
  check('second device reads it back (git trees + blobs)', !!file && file.entries.some((x) => x.item === 'memo' && x.value === `日本語のメモ ${stamp}`));

  // b writes with what it knows while a writes something else: both must survive
  await a.pushEntries('selftest', 1999, [e('english', 'A')]);
  const merged = await b.pushEntries('selftest', 1999, [e('stretch', 'B')]);
  check('writes from two devices are merged', ['english', 'stretch', 'wake', 'memo'].every((i) => merged.some((x) => x.item === i)));

  const older = await b.pushEntries('selftest', 1999, [e('wake', '09:99', '1999-01-01T00:00:00.000Z')]);
  check('an older write does not replace a newer one', older.find((x) => x.item === 'wake').value === '06:20');

  check('nothing changed → the next pull reads no file', (await b.pull()).files.length === 0);

  const bad = GHStore.create(Object.assign({}, conn, { token: 'github_pat_invalid' }));
  let kind = '';
  try { await bad.tree(); } catch (err) { kind = err.kind; }
  check(`a wrong token is reported as "auth" (got "${kind}")`, kind === 'auth');
  console.log(`left behind: ${GHStore.Layout.routineYear('selftest', 1999)}`);
}

main().catch((err) => { console.error('error:', err.kind || err.message); process.exit(1); });
