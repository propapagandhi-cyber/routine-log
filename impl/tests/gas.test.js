'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBackend } = require('./gas-harness.js');

const entry = (o) => Object.assign({ date: '2026-11-16', person: 'p1', personName: 'A', item: 'wake', itemName: '起床', result: 'done', value: '06:20', updatedAt: '2026-11-16T00:00:00.000Z' }, o);

test('piano-log calls keep working (R-13)', () => {
  const b = createBackend();
  assert.equal(b.get({}).ok, true);
  const rec = { id: 'r1', date: '2026-11-15', start: '18:00', end: '18:12', min: 12, sec: 720, names: 'A', people: ['p1'], how: '自動', savedAt: 'x' };
  assert.equal(b.post({ action: 'add', record: rec }).ok, true);
  assert.equal(b.post({ action: 'add', record: rec }).ok, true);          // same id is not added twice
  assert.equal(b.post({ action: 'settings', settings: { people: [{ id: 'p1', name: 'A' }], since: '2026-11-15', updatedAt: 5 } }).ok, true);
  const j = b.get({ action: 'list' });
  assert.equal(j.records.length, 1);
  assert.deepEqual(j.records[0].people, ['p1']);
  assert.equal(j.records[0].sec, 720);
  assert.equal(j.settings.since, '2026-11-15');
  assert.equal('entries' in j, false);
  assert.equal(b.post({ action: 'delete', id: 'r1' }).ok, true);
  assert.equal(b.get({ action: 'list' }).records.length, 0);
});

test('routine: empty backend returns empty lists and no config', () => {
  const j = createBackend().get({ action: 'routine' });
  assert.equal(j.ok, true);
  assert.deepEqual(j.entries, []);
  assert.equal(j.routine, null);
  assert.deepEqual(j.records, []);
});

test('routine: entries are added, read back and replaced by id', () => {
  const b = createBackend();
  assert.equal(b.post({ action: 'entries', entries: [entry(), entry({ item: 'memo', itemName: 'メモ', result: '', value: '出張' })] }).ok, true);
  let j = b.get({ action: 'routine' });
  assert.equal(j.entries.length, 2);
  const wake = j.entries.find((e) => e.item === 'wake');
  assert.deepEqual(wake, { id: '2026-11-16_p1_wake', date: '2026-11-16', person: 'p1', item: 'wake', result: 'done', value: '06:20', updatedAt: '2026-11-16T00:00:00.000Z' });
  assert.equal(j.entries.find((e) => e.item === 'memo').value, '出張');

  b.post({ action: 'entries', entries: [entry({ result: 'fail', value: '07:10', updatedAt: '2026-11-16T01:00:00.000Z' })] });
  j = b.get({ action: 'routine' });
  assert.equal(j.entries.length, 2);
  assert.equal(j.entries.find((e) => e.item === 'wake').result, 'fail');
  // the sheet shows ○ / ×
  assert.equal(b.sheet('習慣').getRange(1, 7, 3, 1).getDisplayValues().flat().join(''), '結果×');
});

test('routine: an older write does not replace a newer one (sync merge 1)', () => {
  const b = createBackend();
  b.post({ action: 'entries', entries: [entry({ value: '06:00', updatedAt: '2026-11-16T05:00:00.000Z' })] });
  b.post({ action: 'entries', entries: [entry({ value: '07:30', result: 'fail', updatedAt: '2026-11-16T04:00:00.000Z' })] });
  const e = b.get({ action: 'routine' }).entries[0];
  assert.equal(e.value, '06:00');
  assert.equal(e.result, 'done');
});

test('routine: clearing an entry keeps the row with an empty result', () => {
  const b = createBackend();
  b.post({ action: 'entries', entries: [entry()] });
  b.post({ action: 'entries', entries: [entry({ result: '', value: '', updatedAt: '2026-11-16T02:00:00.000Z' })] });
  const e = b.get({ action: 'routine' }).entries[0];
  assert.equal(e.result, '');
  assert.equal(e.value, '');
});

test('routine: rows are sorted by date and a big import fits past row 1000', () => {
  const b = createBackend();
  const many = [];
  for (let i = 0; i < 1500; i++) {
    const d = new Date(Date.UTC(2023, 0, 1 + i)).toISOString().slice(0, 10);
    many.push(entry({ date: d }));
  }
  many.reverse();
  assert.equal(b.post({ action: 'entries', entries: many }).ok, true);
  const list = b.get({ action: 'routine' }).entries;
  assert.equal(list.length, 1500);
  assert.equal(list[0].date, '2023-01-01');
  assert.equal(list[1499].date > list[0].date, true);
});

test('routine: bad entries are rejected, text starting with = is kept as text', () => {
  const b = createBackend();
  assert.equal(b.post({ action: 'entries', entries: [entry({ date: '11/16' })] }).ok, false);
  assert.equal(b.post({ action: 'entries', entries: [entry({ person: 'a b' })] }).ok, false);
  assert.equal(b.post({ action: 'entries', entries: 'x' }).ok, false);
  b.post({ action: 'entries', entries: [entry({ item: 'memo', result: '', value: '=1+1' })] });
  assert.equal(b.get({ action: 'routine' }).entries[0].value, '=1+1');
});

test('routine: config is saved, and an older config does not replace a newer one', () => {
  const b = createBackend();
  assert.equal(b.post({ action: 'routineConfig', config: { people: [{ id: 'p1', name: 'A', items: [] }], updatedAt: 10 } }).ok, true);
  b.post({ action: 'routineConfig', config: { people: [], updatedAt: 5 } });
  assert.equal(b.get({ action: 'routine' }).routine.people.length, 1);
  assert.equal(b.post({ action: 'routineConfig', config: { nope: 1 } }).ok, false);
  // the piano settings are a separate property
  assert.equal(b.get({ action: 'routine' }).settings, null);
});
