/**
 * ピアノれんしゅう記録（piano-log）と 習慣きろく（routine-log）— 共通の Apps Script。
 * 両方のアプリの記録を、1つの Google スプレッドシートに保存します。
 *
 * 使い方（くわしくは README）:
 *   1. 新しいスプレッドシートを作り、拡張機能 → Apps Script を開く
 *   2. このコードを全部貼り付けて保存
 *   3. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
 *      次のユーザーとして実行: 自分 / アクセスできるユーザー: 全員
 *   4. 表示された「ウェブアプリの URL」(…/exec) を、それぞれのアプリの設定に貼り付ける
 *
 * すでにピアノれんしゅう記録で使っているときは、コードを全部これに置きかえて保存し、
 *   デプロイ → デプロイを管理 → 鉛筆 → バージョン「新バージョン」→ デプロイ
 * とすると、URL はそのままで習慣きろくも使えるようになります。
 *
 * シート「記録」… ピアノの練習 1回が 1行。設定（名前・目標）はスクリプトのプロパティ `settings`。
 * シート「習慣」… 習慣の記録。日付 × 人 × 項目が 1行。設定（人・項目）はスクリプトのプロパティ `routine`。
 */
const RECORDS = '記録';
const HEAD = ['id', '日付', '開始', '終了', '分', '秒', 'だれ', 'だれ(ID)', '終わり方', '保存日時'];
const FORMATS = ['@', '@', '@', '@', '0', '0', '@', '@', '@', '@'];

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (p.action === 'list') return out_({ ok: true, records: listRecords_(), settings: readSettings_() });
    if (p.action === 'routine') {
      return out_({ ok: true, entries: listEntries_(), routine: readRoutine_(), records: listRecords_(), settings: readSettings_() });
    }
    return out_({ ok: true, app: 'piano-log', routine: true });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.action === 'add') addRecord_(body.record);
    else if (body.action === 'delete') deleteRecord_(body.id);
    else if (body.action === 'settings') writeSettings_(body.settings);
    else if (body.action === 'entries') upsertEntries_(body.entries);
    else if (body.action === 'routineConfig') writeRoutine_(body.config);
    else throw new Error('unknown action');
    return out_({ ok: true });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(RECORDS);
  if (!sh) {
    sh = ss.insertSheet(RECORDS, 0);
    sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function ids_(sh) {
  const n = sh.getLastRow() - 1;
  return n > 0 ? sh.getRange(2, 1, n, 1).getDisplayValues().map(function (r) { return r[0]; }) : [];
}

function listRecords_() {
  const sh = sheet_();
  const n = sh.getLastRow() - 1;
  if (n <= 0) return [];
  return sh.getRange(2, 1, n, HEAD.length).getDisplayValues()
    .filter(function (r) { return r[0]; })
    .map(function (r) {
      return {
        id: r[0], date: r[1], start: r[2], end: r[3],
        min: Number(r[4]) || 0, sec: Number(r[5]) || 0,
        names: r[6], people: r[7] ? r[7].split(',') : [], how: r[8], savedAt: r[9],
      };
    });
}

function addRecord_(r) {
  if (!r || !r.id || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) throw new Error('bad record');
  const sh = sheet_();
  if (ids_(sh).indexOf(r.id) >= 0) return; // already saved
  const range = sh.getRange(sh.getLastRow() + 1, 1, 1, HEAD.length);
  range.setNumberFormats([FORMATS]);
  range.setValues([[
    String(r.id), r.date, String(r.start || ''), String(r.end || ''),
    Number(r.min) || 0, Number(r.sec) || 0,
    String(r.names || ''), (r.people || []).join(','), String(r.how || ''), String(r.savedAt || new Date().toISOString()),
  ]]);
}

function deleteRecord_(id) {
  const sh = sheet_();
  const i = ids_(sh).indexOf(String(id));
  if (i >= 0) sh.deleteRow(i + 2);
}

function readSettings_() {
  const s = PropertiesService.getScriptProperties().getProperty('settings');
  return s ? JSON.parse(s) : null;
}

function writeSettings_(s) {
  if (!s || !Array.isArray(s.people)) throw new Error('bad settings');
  PropertiesService.getScriptProperties().setProperty('settings', JSON.stringify(s));
}

// ---------- 習慣きろく (routine-log) ----------
const ROUTINE = '習慣';
const R_HEAD = ['id', '日付', 'だれ(ID)', 'だれ', '項目(ID)', '項目', '結果', '内容', '更新日時'];
const R_MARK = { done: '○', fail: '×' };
const R_RESULT = { '○': 'done', '×': 'fail' };

function routineSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(ROUTINE);
  if (!sh) {
    sh = ss.insertSheet(ROUTINE, ss.getSheets().length);
    sh.getRange(1, 1, 1, R_HEAD.length).setValues([R_HEAD]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function routineRows_(sh) {
  const n = sh.getLastRow() - 1;
  if (n <= 0) return [];
  return sh.getRange(2, 1, n, R_HEAD.length).getDisplayValues().filter(function (r) { return r[0]; });
}

function listEntries_() {
  return routineRows_(routineSheet_()).map(function (r) {
    return { id: r[0], date: r[1], person: r[2], item: r[4], result: R_RESULT[r[6]] || '', value: r[7], updatedAt: r[8] };
  });
}

// a cell that starts with "=" would be read as a formula
function text_(v) {
  const s = String(v === undefined || v === null ? '' : v);
  return /^[=+]/.test(s) ? "'" + s : s;
}

// Adds or replaces entries by id (date_person_item). The newer 更新日時 wins, so a device that
// was offline cannot overwrite what another device wrote later.
function upsertEntries_(list) {
  if (!Array.isArray(list)) throw new Error('bad entries');
  const sh = routineSheet_();
  const had = Math.max(0, sh.getLastRow() - 1);
  const rows = routineRows_(sh);
  const at = {};
  rows.forEach(function (r, i) { at[r[0]] = i; });
  list.forEach(function (e) {
    if (!e || !/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !/^[\w-]+$/.test(e.person || '') || !/^[\w-]+$/.test(e.item || '')) throw new Error('bad entry');
    const id = e.date + '_' + e.person + '_' + e.item;
    const row = [
      id, e.date, String(e.person), text_(e.personName), String(e.item), text_(e.itemName),
      R_MARK[e.result] || '', text_(e.value), String(e.updatedAt || new Date().toISOString()),
    ];
    if (id in at) {
      if (rows[at[id]][8] <= row[8]) rows[at[id]] = row;
    } else {
      at[id] = rows.length;
      rows.push(row);
    }
  });
  if (!rows.length) return;
  rows.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
  const short = rows.length + 1 - sh.getMaxRows();
  if (short > 0) sh.insertRowsAfter(sh.getMaxRows(), short);
  const range = sh.getRange(2, 1, rows.length, R_HEAD.length);
  range.setNumberFormat('@');
  range.setValues(rows);
  // rows without an id were dropped above; clear what is left of them below the block
  if (had > rows.length) sh.getRange(rows.length + 2, 1, had - rows.length, R_HEAD.length).clearContent();
}

function readRoutine_() {
  const s = PropertiesService.getScriptProperties().getProperty('routine');
  return s ? JSON.parse(s) : null;
}

function writeRoutine_(c) {
  if (!c || !Array.isArray(c.people)) throw new Error('bad config');
  const cur = readRoutine_();
  if (cur && (cur.updatedAt || 0) > (c.updatedAt || 0)) return; // a newer config is already saved
  PropertiesService.getScriptProperties().setProperty('routine', JSON.stringify(c));
}
