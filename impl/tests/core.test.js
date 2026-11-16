'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/core.js');
const Config = require('../src/config.js');

const wake = { id: 'wake', name: '起床', type: 'time', limitW: '06:30', limitH: '07:00' };
const exercise = { id: 'exercise', name: '運動', type: 'choice', options: ['A', 'B'] };
const piano = { id: 'piano', name: 'ピアノ', type: 'piano', goalMin: 10 };
const person = { id: 'p1', name: 'A', color: 0, pianoId: 'p1', items: [wake, exercise, piano] };

function ctxOf({ entries = [], records = [], since = '', today = '2026-11-16' } = {}) {
  return { entries: Core.mergeEntries(entries, []), piano: Core.pianoIndex(records), since, today };
}
const e = (date, item, result, value) => Core.makeEntry(person, item, date, result, value, new Date(0));

test('dates', () => {
  assert.equal(Core.addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(Core.addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(Core.weekday('2026-11-16'), '月');
  assert.equal(Core.isOff('2026-11-21'), true);    // Saturday
  assert.equal(Core.isOff('2026-11-23'), true);    // 勤労感謝の日 (Monday)
  assert.equal(Core.isOff('2026-05-06'), true);    // 振替休日
  assert.equal(Core.isOff('2026-11-16'), false);
  assert.equal(Core.normTime('6:5'), '06:05');
  assert.equal(Core.normTime('25:00'), '');
  assert.equal(Core.fmtDur(754), '12分34秒');
  assert.equal(Core.fmtDur(600), '10分');
});

test('wake time: at or before the limit is done (Acceptance 1, 2)', () => {
  assert.equal(Core.judgeTime(wake, '2026-11-16', '06:30'), 'done');
  assert.equal(Core.judgeTime(wake, '2026-11-16', '06:31'), 'fail');
  assert.equal(Core.judgeTime(wake, '2026-11-21', '07:00'), 'done');   // Saturday
  assert.equal(Core.judgeTime(wake, '2026-11-23', '06:50'), 'done');   // holiday
  assert.equal(Core.judgeTime(wake, '2026-05-06', '07:01'), 'fail');   // substitute holiday
  assert.equal(Core.judgeTime({ type: 'time', limitW: '', limitH: '' }, '2026-11-16', '09:00'), 'done');
  assert.equal(Core.judgeTime(wake, '2026-11-16', ''), '');
});

test('piano: sessions of a day are added up and judged against the goal (Acceptance 1)', () => {
  const records = [
    { date: '2026-11-16', people: ['p1'], sec: 360 },
    { date: '2026-11-16', people: ['p1', 'p2'], sec: 300 },   // duet counts for both
    { date: '2026-11-16', people: ['p2'], min: 4 },           // old record without sec
  ];
  const c = ctxOf({ records, since: '2026-11-15' });
  const s = Core.itemState(c, person, piano, '2026-11-16');
  assert.deepEqual([s.result, s.value, s.auto, s.sec], ['done', '11分', true, 660]);
  const p2 = { ...person, id: 'x', pianoId: 'p2' };
  assert.equal(Core.itemState(c, p2, piano, '2026-11-16').sec, 540);
});

test('piano: short of the goal is fail once the day is over, open while it is today (Acceptance 2)', () => {
  const records = [{ date: '2026-11-15', people: ['p1'], sec: 180 }, { date: '2026-11-16', people: ['p1'], sec: 180 }];
  const c = ctxOf({ records, since: '2026-11-15' });
  assert.equal(Core.itemState(c, person, piano, '2026-11-15').result, 'fail');
  assert.equal(Core.itemState(c, person, piano, '2026-11-16').result, '');
  // a day without practice after the app came into use fails by itself; a future day stays empty
  const c2 = ctxOf({ since: '2026-11-10' });
  assert.deepEqual(Core.itemState(c2, person, piano, '2026-11-12'), { result: 'fail', value: '0分', auto: true, sec: 0, goalSec: 600 });
  assert.deepEqual([Core.itemState(c2, person, piano, '2026-11-20').result, Core.itemState(c2, person, piano, '2026-11-20').value], ['', '']);
});

test('piano: before the app was in use the stored entry is shown (Acceptance 3, 4)', () => {
  const c = ctxOf({ entries: [e('2026-04-07', piano, 'done', '5分')], since: '2026-11-15' });
  assert.deepEqual(Core.itemState(c, person, piano, '2026-04-07'), { result: 'done', value: '5分', auto: false, sec: 0, goalSec: 0 });
  assert.equal(Core.itemState(c, person, piano, '2026-04-08').result, '');
  // an imported day after the app came into use stays, until the app has a record for it
  const c3 = ctxOf({ entries: [e('2026-11-15', piano, 'done', '10分')], since: '2026-11-15' });
  assert.deepEqual([Core.itemState(c3, person, piano, '2026-11-15').result, Core.itemState(c3, person, piano, '2026-11-15').auto], ['done', false]);
  const c4 = ctxOf({ entries: [e('2026-11-15', piano, 'done', '10分')], records: [{ date: '2026-11-15', people: ['p1'], sec: 120 }], since: '2026-11-15' });
  assert.deepEqual([Core.itemState(c4, person, piano, '2026-11-15').result, Core.itemState(c4, person, piano, '2026-11-15').auto], ['fail', true]);
  // no piano link → never automatic
  const solo = { ...person, pianoId: '' };
  const c2 = ctxOf({ records: [{ date: '2026-11-16', people: ['p1'], sec: 900 }], since: '2026-11-01' });
  assert.equal(Core.itemState(c2, solo, piano, '2026-11-16').auto, false);
  assert.equal(Core.pianoSince(null, [{ date: '2026-11-15' }, { date: '2026-11-14' }]), '2026-11-14');
  assert.equal(Core.pianoSince({ since: '2026-11-01' }, []), '2026-11-01');
});

test('month summary: blank days are not in the rate (Acceptance 1)', () => {
  const entries = [];
  for (let d = 1; d <= 20; d++) entries.push(e(Core.monthKey(2026, 9, d), exercise, 'done', 'A'));
  for (let d = 21; d <= 25; d++) entries.push(e(Core.monthKey(2026, 9, d), exercise, 'fail', ''));
  const s = Core.monthSummary(ctxOf({ entries }), person, 2026, 9).exercise;
  assert.deepEqual(s, { done: 20, fail: 5, blank: 5, rate: 80 });
  // days after today are left out
  const nov = Core.monthSummary(ctxOf({ entries }), person, 2026, 11).exercise;
  assert.equal(nov.blank, 16);
  assert.equal(nov.rate, null);
  assert.equal(Core.yearSummary(ctxOf({ entries }), person, 2026)[8].exercise.rate, 80);
});

test('streak: counts back from today, or from yesterday while today is open (Acceptance 2)', () => {
  const entries = ['2026-11-13', '2026-11-14', '2026-11-15'].map((d) => e(d, exercise, 'done', 'A'));
  assert.equal(Core.streak(ctxOf({ entries }), person, exercise), 3);
  entries.push(e('2026-11-16', exercise, 'done', 'B'));
  assert.equal(Core.streak(ctxOf({ entries }), person, exercise), 4);
  entries.push(e('2026-11-12', exercise, 'fail', ''));
  assert.equal(Core.streak(ctxOf({ entries }), person, exercise), 4);
  assert.equal(Core.streak(ctxOf(), person, exercise), 0);
  assert.deepEqual(Core.dayProgress(ctxOf({ entries }), person, '2026-11-16'), { done: 1, total: 3 });
});

test('merge: what is waiting to be sent stays on top of the cloud (sync merge 2)', () => {
  const cloud = [e('2026-11-16', exercise, 'done', 'A'), e('2026-11-15', exercise, 'done', 'A')];
  const pending = [e('2026-11-16', exercise, 'fail', '')];
  const m = Core.mergeEntries(cloud, pending);
  assert.equal(m.size, 2);
  assert.equal(m.get('2026-11-16_p1_exercise').result, 'fail');
});

test('quick times: the most used lately, in time order', () => {
  const entries = [];
  const times = ['05:30', '05:30', '05:30', '06:00', '06:00', '06:20', '07:00', '06:30', '06:30'];
  times.forEach((t, i) => entries.push(e(Core.addDays('2026-11-16', -(i + 1)), wake, 'done', t)));
  assert.deepEqual(Core.quickTimes(ctxOf({ entries }), person, wake, 60, 3), ['05:30', '06:00', '06:30']);
});

test('config: seeded from the piano people, else from the defaults', () => {
  const c = Core.seedConfig({ people: [{ id: 'p1', name: 'X', color: 3 }, { id: 'p9', name: 'Y', color: 1 }] }, Config);
  assert.deepEqual(c.people.map((p) => [p.id, p.name, p.color, p.pianoId]), [['p1', 'X', 3, 'p1'], ['p9', 'Y', 1, 'p9']]);
  assert.deepEqual(c.people[0].items.map((i) => i.id), ['wake', 'exercise', 'stretch', 'english', 'piano']);
  const d = Core.seedConfig(null, Config);
  assert.equal(d.people.length, 3);
  assert.equal(Core.newId('p', ['p1', 'p2', 'p4']), 'p3');
  const n = Core.normalizeConfig({ people: [{ id: 'a', items: [{ id: 'x', type: 'weird', options: [' a ', ''] }, { id: 't', type: 'time', limitW: '6:30' }] }] });
  assert.deepEqual(n.people[0].items[0], { id: 'x', name: '', type: 'choice', note: '', options: ['a'], optionNotes: {} });
  // notes per option: kept for options that exist, dropped for the rest; duplicate options collapse
  const c2 = Core.cleanItem({ id: 'e', type: 'choice', options: ['A', 'B', 'A'], optionNotes: { A: ' 30回 ', B: '', gone: 'x' } });
  assert.deepEqual([c2.options, c2.optionNotes], [['A', 'B'], { A: '30回' }]);
  assert.equal(n.people[0].items[1].limitW, '06:30');
});

test('import: wrong files are refused, entries are bound to the chosen person (Acceptance 1, 2)', () => {
  assert.equal(Core.readImport({ format: 'other', entries: [] }, person).ok, false);
  assert.equal(Core.readImport({ format: 'routine-import', entries: [{ date: '4/1', item: 'wake' }] }, person).ok, false);
  const r = Core.readImport({
    format: 'routine-import', version: 1,
    items: [{ id: 'stretch', name: '柔軟', type: 'choice', options: ['S'] }],
    entries: [
      { date: '2026-04-02', item: 'wake', result: 'done', value: '06:20' },
      { date: '2026-04-01', item: 'stretch', result: 'fail', value: '' },
      { date: '2026-04-01', item: 'memo', result: '', value: 'note' },
    ],
  }, person, new Date(0));
  assert.equal(r.ok, true);
  assert.deepEqual([r.from, r.to, r.entries.length], ['2026-04-01', '2026-04-02', 3]);
  assert.equal(r.entries[0].id, '2026-04-02_p1_wake');
  assert.deepEqual(Object.keys(r.entries[0]), ['id', 'date', 'person', 'item', 'result', 'value', 'updatedAt']);
  assert.equal(r.items[0].options[0], 'S');
  // 'auto' on a time item is judged at import, by the limits in the file
  const auto = Core.readImport({
    format: 'routine-import',
    items: [{ id: 'wake', name: '起床', type: 'time', limitW: '06:00', limitH: '07:30' }],
    entries: [
      { date: '2026-11-16', item: 'wake', result: 'auto', value: '06:20' },   // Monday, after 06:00
      { date: '2026-11-21', item: 'wake', result: 'auto', value: '07:30' },   // Saturday
      { date: '2026-11-17', item: 'exercise', result: 'auto', value: 'A' },   // not a time item
    ],
  }, person, new Date(0));
  assert.deepEqual(auto.entries.map((x) => x.result), ['fail', 'done', '']);
});
