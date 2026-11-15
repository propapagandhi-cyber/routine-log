/* Core — pure logic of the routine tracker: dates, judging, the automatic piano item, summaries,
 * sync merge and import checks. No DOM, no network, no storage; everything comes in as arguments.
 * Works in the browser (global Core, needs JPCal) and in Node (module.exports).
 *
 * Shapes (see spec/software.md):
 *   person  { id, name, color, pianoId, items: [item] }
 *   item    { id, name, type: 'time' | 'choice' | 'piano', note, limitW, limitH, options, goalMin }
 *   entry   { id, date, person, item, result: 'done' | 'fail' | '', value, updatedAt }
 *   ctx     { entries: Map(id → entry), piano: Map('date|pianoId' → sec), since, today }
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./calendar.js'));
  else root.Core = factory(root.JPCal);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (JPCal) {
  'use strict';
  const DONE = 'done', FAIL = 'fail';
  const pad2 = (n) => String(n).padStart(2, '0');

  // ---------- dates (local time, 'YYYY-MM-DD') ----------
  const dkey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return dkey(d); };
  const isOff = (k) => JPCal.isOff(fromKey(k));
  const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
  const monthKey = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  const weekday = (k) => WEEK[fromKey(k).getDay()];

  /** '6:5' → '06:05'; anything that is not a time → '' */
  function normTime(s) {
    const m = /^\s*(\d{1,2})[:：](\d{1,2})\s*$/.exec(String(s || ''));
    if (!m || +m[1] > 23 || +m[2] > 59) return '';
    return `${pad2(+m[1])}:${pad2(+m[2])}`;
  }
  const showTime = (hhmm) => (hhmm ? hhmm.replace(/^0/, '') : '');

  /** 754 → '12分34秒', 600 → '10分', 0 → '0分' */
  function fmtDur(sec) {
    const s = Math.max(0, Math.round(sec || 0));
    const m = Math.floor(s / 60), r = s % 60;
    return r ? `${m}分${r}秒` : `${m}分`;
  }

  const entryId = (date, person, item) => `${date}_${person}_${item}`;

  // ---------- judging ----------
  /** The latest time that still counts on that day ('' = no limit). */
  function limitFor(item, date) {
    return normTime(isOff(date) ? item.limitH : item.limitW);
  }
  /** done when the time is at or before the day's limit. */
  function judgeTime(item, date, hhmm) {
    const t = normTime(hhmm);
    if (!t) return '';
    const lim = limitFor(item, date);
    return !lim || t <= lim ? DONE : FAIL;
  }

  // ---------- piano (records of piano-log) ----------
  /** Seconds practiced per day and piano person; a duet counts for everyone in it. */
  function pianoIndex(records) {
    const m = new Map();
    for (const r of records || []) {
      const sec = Number(r.sec) || (Number(r.min) || 0) * 60;
      for (const id of r.people || []) {
        const k = `${r.date}|${id}`;
        m.set(k, (m.get(k) || 0) + sec);
      }
    }
    return m;
  }
  /** The first day the piano app was in use: its setting, else its earliest record, else ''. */
  function pianoSince(settings, records) {
    if (settings && /^\d{4}-\d{2}-\d{2}$/.test(settings.since || '')) return settings.since;
    let first = '';
    for (const r of records || []) if (r.date && (!first || r.date < first)) first = r.date;
    return first;
  }

  /** What to show for one item on one day. `auto` is true when the piano app decides it. */
  function itemState(ctx, person, item, date) {
    const e = ctx.entries.get(entryId(date, person.id, item.id));
    if (item.type === 'piano' && person.pianoId) {
      const sec = ctx.piano.get(`${date}|${person.pianoId}`) || 0;
      // a stored result (an imported day) stands as long as the piano app has nothing for that day
      if (sec > 0 || (ctx.since && date >= ctx.since && !(e && e.result))) {
        const goalSec = (Number(item.goalMin) || 0) * 60;
        let result = '';
        if (sec > 0 && sec >= goalSec) result = DONE;
        else if (date < ctx.today) result = FAIL;
        return { result, value: sec > 0 || date <= ctx.today ? fmtDur(sec) : '', auto: true, sec, goalSec };
      }
    }
    return { result: (e && e.result) || '', value: (e && e.value) || '', auto: false, sec: 0, goalSec: 0 };
  }
  const memoOf = (ctx, person, date, memoItem) => {
    const e = ctx.entries.get(entryId(date, person.id, memoItem));
    return (e && e.value) || '';
  };

  // ---------- summaries ----------
  const rate = (done, fail) => (done + fail ? Math.round((done / (done + fail)) * 100) : null);

  /** Per item: done / fail / blank counts and the rate for one month (days after today are left out). */
  function monthSummary(ctx, person, y, m) {
    const out = {};
    for (const it of person.items) out[it.id] = { done: 0, fail: 0, blank: 0, rate: null };
    const n = daysInMonth(y, m);
    for (let d = 1; d <= n; d++) {
      const date = monthKey(y, m, d);
      if (date > ctx.today) break;
      for (const it of person.items) {
        const r = itemState(ctx, person, it, date).result;
        out[it.id][r === DONE ? 'done' : r === FAIL ? 'fail' : 'blank']++;
      }
    }
    for (const it of person.items) out[it.id].rate = rate(out[it.id].done, out[it.id].fail);
    return out;
  }
  /** months[0..11] of monthSummary for one year. */
  function yearSummary(ctx, person, y) {
    const months = [];
    for (let m = 1; m <= 12; m++) months.push(monthSummary(ctx, person, y, m));
    return months;
  }
  /** Days in a row with `done`, counted back from today (or from yesterday while today is still open). */
  function streak(ctx, person, item, max) {
    let date = ctx.today, n = 0;
    if (itemState(ctx, person, item, date).result !== DONE) date = addDays(date, -1);
    while (n < (max || 3660) && itemState(ctx, person, item, date).result === DONE) { n++; date = addDays(date, -1); }
    return n;
  }
  /** done / items for one day, e.g. for the ring around a person. */
  function dayProgress(ctx, person, date) {
    let done = 0;
    for (const it of person.items) if (itemState(ctx, person, it, date).result === DONE) done++;
    return { done, total: person.items.length };
  }

  /** The times a person entered most often lately, for one-tap input. */
  function quickTimes(ctx, person, item, days, n) {
    const count = new Map();
    for (let i = 1; i <= days; i++) {
      const e = ctx.entries.get(entryId(addDays(ctx.today, -i), person.id, item.id));
      const t = e && normTime(e.value);
      if (t) count.set(t, (count.get(t) || 0) + 1);
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n).map((x) => x[0]).sort();
  }

  // ---------- entries ----------
  function makeEntry(person, item, date, result, value, now) {
    return {
      id: entryId(date, person.id, item.id), date, person: person.id, personName: person.name,
      item: item.id, itemName: item.name, result: result || '', value: value || '',
      updatedAt: (now || new Date()).toISOString(),
    };
  }
  /** Everything from the cloud, with what is still waiting to be sent laid on top (by id). */
  function mergeEntries(cloud, pending) {
    const m = new Map();
    for (const e of cloud || []) m.set(e.id, e);
    for (const e of pending || []) m.set(e.id, e);
    return m;
  }

  // ---------- config ----------
  const clone = (o) => JSON.parse(JSON.stringify(o));
  function cleanItem(it) {
    const o = { id: String(it.id), name: String(it.name || ''), type: ['time', 'choice', 'piano'].includes(it.type) ? it.type : 'choice', note: String(it.note || '') };
    if (o.type === 'time') { o.limitW = normTime(it.limitW); o.limitH = normTime(it.limitH); }
    if (o.type === 'choice') o.options = (it.options || []).map((s) => String(s).trim()).filter(Boolean);
    if (o.type === 'piano') o.goalMin = Math.max(0, Number(it.goalMin) || 0);
    return o;
  }
  /** The first config: people from the piano app when it has any, else the defaults. */
  function seedConfig(pianoSettings, defaults) {
    const from = pianoSettings && Array.isArray(pianoSettings.people) && pianoSettings.people.length
      ? pianoSettings.people.map((p) => ({ id: p.id, name: p.name, color: p.color || 0, pianoId: p.id }))
      : defaults.defaultPeople;
    return {
      updatedAt: 0,
      people: from.map((p) => ({ id: p.id, name: p.name, color: p.color || 0, pianoId: p.pianoId || '', items: defaults.defaultItems.map(cleanItem) })),
    };
  }
  function normalizeConfig(c) {
    return {
      updatedAt: Number(c.updatedAt) || 0,
      people: (c.people || []).filter((p) => p && p.id).map((p) => ({
        id: String(p.id), name: String(p.name || ''), color: Number(p.color) || 0, pianoId: String(p.pianoId || ''),
        items: (p.items || []).filter((it) => it && it.id).map(cleanItem),
      })),
    };
  }
  function newId(prefix, taken) {
    let n = 1;
    while (taken.includes(prefix + n)) n++;
    return prefix + n;
  }

  // ---------- import ----------
  /** Checks an import file and returns its entries bound to `person`. */
  function readImport(obj, person, now) {
    if (!obj || obj.format !== 'routine-import' || !Array.isArray(obj.entries)) return { ok: false, error: '習慣きろくの取り込みファイルではありません' };
    const names = new Map((obj.items || []).map((it) => [String(it.id), String(it.name || it.id)]));
    for (const it of person.items) names.set(it.id, it.name);
    const stamp = (now || new Date()).toISOString();
    const items = (obj.items || []).filter((it) => it && it.id).map(cleanItem);
    // result 'auto' on a time item: judged here, by the file's limits (else the person's)
    const defs = new Map(person.items.concat(items).map((it) => [it.id, it]));
    const entries = [];
    for (const e of obj.entries) {
      if (!e || !/^\d{4}-\d{2}-\d{2}$/.test(e.date || '') || !/^[\w-]+$/.test(e.item || '')) return { ok: false, error: `記録の形がちがいます（${JSON.stringify(e).slice(0, 60)}）` };
      let result = e.result === DONE || e.result === FAIL ? e.result : '';
      const def = defs.get(e.item);
      if (e.result === 'auto' && def && def.type === 'time') result = judgeTime(def, e.date, e.value);
      entries.push({
        id: entryId(e.date, person.id, e.item), date: e.date, person: person.id, personName: person.name,
        item: e.item, itemName: names.get(e.item) || e.item,
        result, value: String(e.value || ''), updatedAt: stamp,
      });
    }
    const dates = entries.map((e) => e.date).sort();
    return { ok: true, entries, items, from: dates[0] || '', to: dates[dates.length - 1] || '' };
  }

  return {
    DONE, FAIL, pad2, dkey, fromKey, addDays, isOff, daysInMonth, monthKey, weekday, normTime, showTime, fmtDur,
    entryId, limitFor, judgeTime, pianoIndex, pianoSince, itemState, memoOf, rate, monthSummary, yearSummary, streak,
    dayProgress, quickTimes, makeEntry, mergeEntries, clone, cleanItem, seedConfig, normalizeConfig, newId, readImport,
  };
});
