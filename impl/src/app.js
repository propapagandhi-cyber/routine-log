'use strict';
/* UI of the routine tracker: drawing, input, settings and the cloud round trips.
 * All judging and counting is in core.js; all default values are in config.js.
 */
(() => {
  const VERSION = '1.0（2026-11-16）';
  const C = RoutineConfig, K = Core;
  const { DONE, FAIL } = K;
  const $ = (id) => document.getElementById(id);

  /** h('div', { class: 'x', text: 'y', onclick }, [children]) */
  function h(tag, attrs, kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'text') el.textContent = v;
      else if (k === 'style') for (const [sk, sv] of Object.entries(v)) el.style.setProperty(sk, sv);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(kids || [])) if (c !== null && c !== undefined && c !== false) el.append(c);
    return el;
  }
  let toastTimer = 0;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  // ---------- storage ----------
  const LS = { config: 'rl.config', entries: 'rl.entries', queue: 'rl.queue', piano: 'rl.piano', url: 'rl.url', sel: 'rl.sel' };
  function load(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked or full */ } }
  const slim = (e) => ({ id: e.id, date: e.date, person: e.person, item: e.item, result: e.result, value: e.value, updatedAt: e.updatedAt });

  const stored = load(LS.config, null);
  let config = stored ? K.normalizeConfig(stored) : K.seedConfig(null, C);
  let entries = K.mergeEntries(load(LS.entries, []), []);
  let queue = load(LS.queue, []);
  let piano = load(LS.piano, { records: [], since: '', people: [] });
  let pianoIdx = K.pianoIndex(piano.records);
  let cloudUrl = load(LS.url, '');
  let selId = load(LS.sel, '');
  let syncState = cloudUrl ? 'wait' : 'local';

  let today = K.dkey(new Date());
  let view = 'day';
  let date = today;
  let ym = { y: +today.slice(0, 4), m: +today.slice(5, 7) };
  let year = ym.y;

  const ctx = () => ({ entries, piano: pianoIdx, since: piano.since, today });
  const person = () => config.people.find((p) => p.id === selId) || config.people[0];
  const colorOf = (p) => `var(--p${(p.color || 0) % C.colors})`;
  const MEMO = { id: C.memoItem, name: 'メモ' };

  // ---------- cloud (Google Apps Script web app, shared with piano-log) ----------
  const validUrl = (u) => /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$|^http:\/\/(localhost|127\.0\.0\.1):\d+\/exec$/.test(u || '');
  async function cloudGet(url) {
    const r = await fetch((url || cloudUrl) + '?action=routine&t=' + Date.now(), { cache: 'no-store' });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'error');
    return j;
  }
  async function cloudPost(body) {
    const r = await fetch(cloudUrl, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'error');
    return j;
  }
  const pending = () => queue.filter((q) => q.action === 'entries').flatMap((q) => q.entries);

  let flushing = null;
  function flush() {
    if (!validUrl(cloudUrl)) { syncState = 'local'; renderSync(); return Promise.resolve(); }
    if (flushing) return flushing;
    flushing = (async () => {
      try {
        while (queue.length) {
          if (queue.length > 1) { syncState = 'sending'; renderSync(); }
          await cloudPost(queue[0]);
          queue.shift();
          save(LS.queue, queue);
        }
        if (syncState !== 'old') syncState = 'ok';
      } catch (e) {
        // a script that only knows the piano app answers "unknown action"
        syncState = /unknown action/.test(String(e.message)) ? 'old' : 'offline';
      }
    })().finally(() => { flushing = null; renderSync(); });
    return flushing;
  }
  function enqueueEntries(list) {
    for (let i = 0; i < list.length; i += C.postChunk) {
      const part = list.slice(i, i + C.postChunk);
      const last = queue[queue.length - 1];
      const free = last && last.action === 'entries' && !(flushing && queue.length === 1);   // queue[0] may be on its way
      if (free && last.entries.length + part.length <= C.postChunk) {
        const ids = new Set(part.map((e) => e.id));
        last.entries = last.entries.filter((e) => !ids.has(e.id)).concat(part);
      } else {
        queue.push({ action: 'entries', entries: part });
      }
    }
    save(LS.queue, queue);
    flush();
  }
  function putEntries(list) {
    for (const e of list) entries.set(e.id, e);
    save(LS.entries, [...entries.values()].map(slim));
    if (validUrl(cloudUrl)) enqueueEntries(list);
  }
  function pushConfig() {
    save(LS.config, config);
    if (!validUrl(cloudUrl)) return;
    queue = queue.filter((q, i) => q.action !== 'routineConfig' || (flushing && i === 0));
    queue.push({ action: 'routineConfig', config });
    save(LS.queue, queue);
    flush();
  }

  let lastRefresh = 0;
  async function refreshCloud(force) {
    if (!validUrl(cloudUrl)) { syncState = 'local'; renderSync(); return; }
    if (!force && Date.now() - lastRefresh < C.refreshMs) return;
    lastRefresh = Date.now();
    await flush();
    try {
      const j = await cloudGet();
      if (!Array.isArray(j.entries)) {
        syncState = 'old';
      } else {
        entries = K.mergeEntries(j.entries, pending());
        save(LS.entries, [...entries.values()].map(slim));
        piano = { records: j.records || [], since: K.pianoSince(j.settings, j.records), people: (j.settings && j.settings.people) || [] };
        pianoIdx = K.pianoIndex(piano.records);
        save(LS.piano, piano);
        const waiting = queue.some((q) => q.action === 'routineConfig');
        if (j.routine && Array.isArray(j.routine.people) && j.routine.people.length && !waiting && (j.routine.updatedAt || 0) >= (config.updatedAt || 0)) {
          config = K.normalizeConfig(j.routine);
          save(LS.config, config);
        } else if (!j.routine && !config.updatedAt) {
          // nothing saved yet anywhere: start from the people of the piano app
          config = K.seedConfig(j.settings, C);
          save(LS.config, config);
        }
        syncState = queue.length ? 'offline' : 'ok';
      }
    } catch (e) {
      syncState = 'offline';
    }
    rebaseDraft();
    render(true);
    renderSync();
  }
  function connectCloud(url) {
    const wasLocal = !validUrl(cloudUrl);
    cloudUrl = url;
    save(LS.url, cloudUrl);
    syncState = 'wait';
    if (wasLocal) {
      // what was recorded on this device before it had a sheet goes up too (the newer write wins there)
      const local = [...entries.values()].map((e) => {
        const p = config.people.find((x) => x.id === e.person);
        const it = p && (e.item === MEMO.id ? MEMO : p.items.find((x) => x.id === e.item));
        return Object.assign({ personName: p ? p.name : '', itemName: it ? it.name : '' }, e);
      });
      if (local.length) enqueueEntries(local);
      if (config.updatedAt) pushConfig();
    }
    return refreshCloud(true);
  }
  function renderSync() {
    const el = $('sync');
    const n = pending().length;
    el.classList.toggle('bad', syncState === 'offline' || syncState === 'old' || (syncState === 'local' && entries.size > 0));
    if (syncState === 'local') el.textContent = '記録はこの端末の中だけに保存しています（設定で保存先につなげられます）';
    else if (syncState === 'wait') el.textContent = '読みこんでいます…';
    else if (syncState === 'sending') el.textContent = `保存先へ送っています（のこり ${n}件）`;
    else if (syncState === 'old') el.textContent = 'スプレッドシートのプログラムが古いため、習慣の記録を保存できません（設定 →「記録の保存先」を見てください）';
    else if (syncState === 'offline') el.textContent = n ? `まだ送れていない記録が ${n}件あります。つながったら送ります` : 'スプレッドシートにつながりません。あとでもう一度ためします';
    else el.textContent = 'スプレッドシートに保存ずみ';
  }

  // ---------- writing ----------
  function setEntry(p, it, result, value, quiet) {
    if (!quiet) commitEdits();
    putEntries([K.makeEntry(p, it, date, result, value)]);
    if (!quiet) render();
  }

  // ---------- drawing ----------
  const editing = () => { const a = document.activeElement; return !!a && (a.id === 'memo' || (a.classList && a.classList.contains('time'))); };
  let dirty = false;
  // after leaving a field: wait for the tap that took the focus away to land, then redraw
  const redrawSoon = () => setTimeout(() => { if (dirty && !editing()) render(); }, 200);
  // `soft` (background updates): do not redraw the day under a field that is being edited.
  // Everything the user taps redraws at once — Safari keeps the focus on the field when a button is tapped.
  function render(soft) {
    renderPeople();
    document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === view)));
    $('vDay').hidden = view !== 'day';
    $('vMonth').hidden = view !== 'month';
    $('vYear').hidden = view !== 'year';
    if (view === 'day') { if (soft && editing()) dirty = true; else renderDay(); }
    else if (view === 'month') renderMonth();
    else renderYear();
  }
  function renderPeople() {
    const c = ctx(), cur = person();
    $('people').replaceChildren(...config.people.map((p) => {
      const pr = K.dayProgress(c, p, date);
      return h('button', {
        class: 'person', type: 'button', 'aria-pressed': String(p === cur), style: { '--c': colorOf(p) },
        onclick: () => { commitEdits(); selId = p.id; save(LS.sel, selId); render(); },
      }, [
        h('div', { class: 'ring', style: { '--pct': pr.total ? Math.round((pr.done / pr.total) * 100) : 0 } }, h('div', { class: 'face', text: (p.name || '?').slice(0, 1) })),
        h('div', { class: 'name', text: p.name }),
        h('div', { class: 'prog num', text: `${pr.done} / ${pr.total}` }),
      ]);
    }));
  }
  const dateLabel = (k) => `${+k.slice(5, 7)}月${+k.slice(8, 10)}日（${K.weekday(k)}）`;
  const BADGE = { [DONE]: '○ できた', [FAIL]: '× 失敗' };

  function renderDay() {
    dirty = false;
    const p = person(), c = ctx();
    const holiday = JPCal.holidayName(K.fromKey(date));
    $('dLabel').textContent = dateLabel(date);
    $('dSub').textContent = [date === today ? '今日' : date.slice(0, 4) + '年', holiday].filter(Boolean).join('・');
    $('dCur').classList.toggle('off', K.isOff(date));
    $('dPick').value = date; $('dPick').max = today;
    $('dNext').disabled = date >= today;
    $('dToday').hidden = date === today;
    $('items').replaceChildren(...p.items.map((it) => itemCard(p, it, c)));
    const memo = $('memo');
    memo.value = K.memoOf(c, p, date, MEMO.id);
    $('memoState').textContent = '';
  }

  function itemCard(p, it, c) {
    const st = K.itemState(c, p, it, date);
    const badge = h('span', { class: 'badge' });
    const card = h('div', { class: 'panel item' });
    const paint = (s) => {
      card.className = `panel item ${s.result}`;
      badge.className = `badge ${s.result}`;
      badge.textContent = BADGE[s.result] || (s.auto && date === today ? 'まだ' : '未入力');
    };
    paint(st);
    const chip = (text, pressed, onclick, cls) => h('button', { class: `chip ${cls || ''}`, type: 'button', 'aria-pressed': String(!!pressed), text, onclick });
    // handlers read the state again: a time typed a moment ago may not be drawn yet
    const now = () => K.itemState(ctx(), p, it, date);
    const mark = (res) => chip(BADGE[res], st.result === res, () => { const s = now(); setEntry(p, it, s.result === res ? '' : res, s.value); }, res === FAIL ? 'no' : '');
    const ctl = h('div', { class: 'ictl' });

    if (it.type === 'time') {
      const input = h('input', {
        class: 'time num', type: 'time', value: K.normTime(st.value), 'aria-label': `${it.name}の時刻`,
        onchange: () => {
          const v = K.normTime(input.value);
          const res = v ? K.judgeTime(it, date, v) : '';
          setEntry(p, it, res, v, true);          // redraw when the picker closes (blur), not while it is open
          paint({ result: res });
          renderPeople();
          dirty = true;
          if (!editing()) render();
        },
        onblur: redrawSoon,
      });
      ctl.append(input);
      const setTime = (v) => setEntry(p, it, K.judgeTime(it, date, v), v);
      if (date === today) ctl.append(chip('いま', false, () => { const n = new Date(); setTime(`${K.pad2(n.getHours())}:${K.pad2(n.getMinutes())}`); }, 'ghost'));
      for (const t of K.quickTimes(c, p, it, C.quickTimeDays, C.quickTimes)) ctl.append(chip(K.showTime(t), K.normTime(st.value) === t, () => setTime(t)));
      ctl.append(h('div', { class: 'sep' }), mark(DONE), mark(FAIL));
      const lim = K.limitFor(it, date);
      if (lim) ctl.append(h('span', { class: 'lim', text: `${K.isOff(date) ? '休日' : '平日'}は ${K.showTime(lim)} まで` }));
    } else if (it.type === 'choice') {
      const opts = it.options || [];
      const pick = (v) => { const s = now(); const same = s.result === DONE && s.value === v; setEntry(p, it, same ? '' : DONE, same ? '' : v); };
      for (const o of opts) ctl.append(chip(o, st.result === DONE && st.value === o, () => pick(o)));
      if (st.result === DONE && st.value && !opts.includes(st.value)) ctl.append(chip(st.value, true, () => pick(st.value)));
      if (!opts.length || (st.result === DONE && !st.value)) ctl.append(chip(BADGE[DONE], st.result === DONE && !st.value, () => pick('')));
      ctl.append(chip('ほか…', false, () => {
        const v = (window.prompt(`${it.name}：なにをしましたか？`, '') || '').trim();
        if (v) setEntry(p, it, DONE, v);
      }, 'ghost'));
      ctl.append(mark(FAIL));
    } else if (st.auto) {
      const pct = st.goalSec ? Math.min(100, Math.round((st.sec / st.goalSec) * 100)) : (st.sec ? 100 : 0);
      ctl.append(
        h('div', { class: 'pianoval num', text: st.value || '0分' }, h('small', { text: `目標 ${it.goalMin || 0}分` })),
        h('div', { class: 'meter', role: 'img', 'aria-label': `目標の ${pct}%` }, h('i', { style: { width: pct + '%' } })),
        h('span', { class: 'lim', text: 'ピアノれんしゅう記録の時間が自動で入ります' }),
        h('a', { href: C.pianoAppUrl, target: '_blank', rel: 'noopener', text: 'ピアノれんしゅう記録をひらく' }),
      );
    } else {
      // before the piano app was in use, or not linked to it: the stored entry, editable by hand
      if (st.value) ctl.append(h('div', { class: 'pianoval num', text: st.value }), h('div', { class: 'sep' }));
      ctl.append(mark(DONE), mark(FAIL));
      const why = !p.pianoId ? 'ピアノれんしゅう記録の人とつながっていません（設定）'
        : !validUrl(cloudUrl) ? '保存先につなげると、ピアノの時間が自動で入ります'
          : piano.since && date >= piano.since ? 'ピアノれんしゅう記録にこの日の練習がないため、取り込んだ記録を出しています'
            : 'ピアノれんしゅう記録を使いはじめる前の日です';
      ctl.append(h('span', { class: 'lim', text: why }));
    }
    card.append(h('div', { class: 'ihead' }, [h('span', { class: 'iname', text: it.name }), badge]));
    if (it.note) card.append(h('p', { class: 'inote', text: it.note }));
    card.append(ctl);
    return card;
  }

  function cellText(st, it) {
    const mk = st.result === FAIL ? '×' : '';
    let v = st.value;
    if (it.type === 'time') v = K.showTime(K.normTime(v));
    if (st.auto) v = st.sec ? `${Math.floor(st.sec / 60)}分` : '';
    if (st.result === DONE) return v || '○';
    if (st.result === FAIL) return v ? `${mk} ${v}` : mk;
    return v || '';
  }

  function renderMonth() {
    const p = person(), c = ctx(), { y, m } = ym;
    $('mLabel').textContent = `${y}年${m}月`;
    $('mNext').disabled = K.monthKey(y, m, 1) >= K.monthKey(+today.slice(0, 4), +today.slice(5, 7), 1);
    const sum = K.monthSummary(c, p, y, m);
    $('mRates').replaceChildren(...p.items.flatMap((it) => {
      const s = sum[it.id];
      return [h('div', { class: 'rrow' }, [
        h('span', { class: 'rname', text: it.name }),
        h('div', { class: 'meter', role: 'img', 'aria-label': s.rate === null ? '記録なし' : `${s.rate}%` }, h('i', { style: { width: (s.rate || 0) + '%' } })),
        h('span', { class: 'rpct num', text: s.rate === null ? '–' : `${s.rate}%` }),
        h('span', { class: 'rdet num', text: `できた ${s.done}日・失敗 ${s.fail}日${s.blank ? `・未入力 ${s.blank}日` : ''}` }),
      ])];
    }));
    const rows = [];
    for (let d = K.daysInMonth(y, m); d >= 1; d--) {
      const k = K.monthKey(y, m, d);
      if (k > today) continue;
      const memo = K.memoOf(c, p, k, MEMO.id);
      rows.push(h('tr', {
        class: [K.isOff(k) ? 'off' : '', k === today ? 'today' : ''].join(' ').trim() || null, tabindex: '0',
        onclick: () => { date = k; view = 'day'; render(); window.scrollTo(0, 0); },
        onkeydown: (ev) => { if (ev.key === 'Enter') ev.currentTarget.click(); },
      }, [
        h('td', { class: 'd num', text: `${d} ${K.weekday(k)}` }),
        ...p.items.map((it) => { const st = K.itemState(c, p, it, k); return h('td', { class: `num ${st.result}`, text: cellText(st, it) }); }),
        h('td', { class: 'memo', text: memo, title: memo || null }),
      ]));
    }
    $('mTable').replaceChildren(
      h('thead', {}, h('tr', {}, [h('th', { class: 'd', text: '日' }), ...p.items.map((it) => h('th', { text: it.name })), h('th', { text: 'メモ' })])),
      h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: String(p.items.length + 2), text: 'まだ記録がありません' }))),
    );
  }

  function renderYear() {
    const p = person(), c = ctx();
    $('yLabel').textContent = `${year}年`;
    $('yNext').disabled = year >= +today.slice(0, 4);
    $('streaks').replaceChildren(...p.items.map((it) => h('div', { class: 'tile' }, [
      h('div', { class: 'tl', text: it.name }),
      h('div', { class: 'tv num', text: String(K.streak(c, p, it)) }, h('small', { text: '日' })),
    ])));
    const months = K.yearSummary(c, p, year);
    const detail = $('yDetail');
    const say = (it, i, s) => { detail.textContent = `${it.name}・${i + 1}月：できた ${s.done}日、失敗 ${s.fail}日、未入力 ${s.blank}日`; };
    $('yTable').replaceChildren(
      h('thead', {}, h('tr', {}, [h('th', { class: 'i', text: '項目' }), ...months.map((_, i) => h('th', {}, h('button', {
        type: 'button', text: `${i + 1}月`, 'aria-label': `${i + 1}月の表を見る`,
        onclick: () => { ym = { y: year, m: i + 1 }; view = 'month'; render(); },
      })))])),
      h('tbody', {}, p.items.map((it) => h('tr', {}, [
        h('td', { class: 'i', text: it.name }),
        ...months.map((mm, i) => {
          const s = mm[it.id];
          const tip = `できた ${s.done}日・失敗 ${s.fail}日・未入力 ${s.blank}日`;
          return s.rate === null
            ? h('td', { class: 'none', text: '–', title: tip, onclick: () => say(it, i, s) })
            : h('td', { class: 'cell num', style: { '--v': s.rate }, text: String(s.rate), title: tip, tabindex: '0', onclick: () => say(it, i, s), onfocus: () => say(it, i, s) });
        }),
      ]))),
    );
  }

  // ---------- navigation ----------
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
    commitEdits();
    view = b.dataset.view;
    if (view === 'month') ym = { y: +date.slice(0, 4), m: +date.slice(5, 7) };
    if (view === 'year') year = +date.slice(0, 4);
    render();
  }));
  const goDay = (k) => { if (k <= today) { commitEdits(); date = k; render(); } };
  $('dPrev').addEventListener('click', () => goDay(K.addDays(date, -1)));
  $('dNext').addEventListener('click', () => goDay(K.addDays(date, 1)));
  $('dToday').addEventListener('click', () => goDay(today));
  $('dPick').addEventListener('change', (e) => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) goDay(e.target.value); });
  const goMonth = (n) => { const d = new Date(ym.y, ym.m - 1 + n, 1); ym = { y: d.getFullYear(), m: d.getMonth() + 1 }; render(); };
  $('mPrev').addEventListener('click', () => goMonth(-1));
  $('mNext').addEventListener('click', () => goMonth(1));
  $('yPrev').addEventListener('click', () => { year--; render(); });
  $('yNext').addEventListener('click', () => { year++; render(); });

  // the note is saved a moment after typing stops
  let memoTimer = 0;
  /** Saves a note that is still waiting; call before the person or the day changes. */
  function commitEdits() { if (memoTimer) saveMemo(); }
  function saveMemo() {
    clearTimeout(memoTimer); memoTimer = 0;
    const p = person(), v = $('memo').value.trim();
    if (v === K.memoOf(ctx(), p, date, MEMO.id)) return;
    setEntry(p, MEMO, '', v, true);
    $('memoState').textContent = '保存しました';
  }
  $('memo').addEventListener('input', () => { $('memoState').textContent = ''; clearTimeout(memoTimer); memoTimer = setTimeout(saveMemo, C.memoSaveMs); });
  $('memo').addEventListener('blur', () => { saveMemo(); redrawSoon(); });

  // ---------- settings ----------
  const dlg = $('settings');
  let draft = null, draftBase = '';
  const openIds = new Set();
  // the config can arrive from the cloud while the settings are open; unless something was edited
  // there, show the new one (otherwise closing would save the old one over it)
  function rebaseDraft() {
    if (!draft || JSON.stringify(draft.people) !== draftBase) return;
    draft = K.clone(config);
    draftBase = JSON.stringify(draft.people);
    renderPeopleEdit();
    renderImportWho();
  }
  const field = (label, control, style) => h('label', { class: 'field', style: style || null }, [label, control]);

  function renderPeopleEdit() {
    $('pEdit').replaceChildren(...draft.people.map((p, pi) => {
      const sum = h('summary', { text: p.name || '（名前なし）' });
      const pianoOpts = [['', 'つなげない']].concat(piano.people.map((x) => [x.id, x.name]));
      if (p.pianoId && !pianoOpts.some((o) => o[0] === p.pianoId)) pianoOpts.push([p.pianoId, p.pianoId]);
      const body = h('div', { class: 'pebody' }, [
        h('div', { class: 'row' }, [
          field('名前', h('input', { type: 'text', value: p.name, maxlength: '12', oninput: (e) => { p.name = e.target.value; sum.textContent = p.name || '（名前なし）'; } })),
          field('ピアノれんしゅう記録の人', h('select', { onchange: (e) => { p.pianoId = e.target.value; } },
            pianoOpts.map(([v, t]) => h('option', { value: v, text: t, selected: v === p.pianoId })))),
        ]),
        h('div', { class: 'swatches', role: 'group', 'aria-label': '色' }, Array.from({ length: C.colors }, (_, i) => h('button', {
          type: 'button', style: { '--c': `var(--p${i})` }, 'aria-pressed': String(p.color === i), 'aria-label': `色 ${i + 1}`,
          onclick: () => { p.color = i; renderPeopleEdit(); },
        }))),
        ...p.items.map((it, ii) => itemEdit(p, it, ii)),
        h('div', { class: 'row' }, [
          h('button', { class: 'btn', type: 'button', text: '＋ 項目を足す', disabled: p.items.length >= C.maxItems, onclick: () => {
            p.items.push(K.cleanItem({ id: K.newId('i', p.items.map((x) => x.id)), name: '', type: 'choice', options: [] }));
            renderPeopleEdit();
          } }),
          h('button', { class: 'btn danger', type: 'button', text: 'この人を消す', disabled: draft.people.length <= 1, onclick: () => {
            if (!window.confirm(`「${p.name}」を消しますか？（これまでの記録はスプレッドシートに残ります）`)) return;
            draft.people.splice(pi, 1); renderPeopleEdit(); renderImportWho();
          } }),
        ]),
      ]);
      return h('details', { class: 'pe', style: { '--c': colorOf(p) }, open: openIds.has(p.id), ontoggle: (e) => { if (e.target.open) openIds.add(p.id); else openIds.delete(p.id); } }, [sum, body]);
    }));
    $('pAdd').disabled = draft.people.length >= C.maxPeople;
  }
  function itemEdit(p, it, ii) {
    const extra = [];
    if (it.type === 'time') {
      extra.push(
        field('平日はこの時刻まで', h('input', { type: 'time', value: it.limitW || '', onchange: (e) => { it.limitW = e.target.value; } })),
        field('休日はこの時刻まで', h('input', { type: 'time', value: it.limitH || '', onchange: (e) => { it.limitH = e.target.value; } })),
      );
    } else if (it.type === 'choice') {
      extra.push(field('えらぶ内容（「、」で区切る。空なら「できた」だけ）', h('input', {
        type: 'text', value: (it.options || []).join('、'), placeholder: '例：筋トレ、外作業',
        oninput: (e) => { it.options = e.target.value.split(/[、,，]/).map((s) => s.trim()).filter(Boolean); },
      }), { flex: '1 1 100%' }));
    } else {
      extra.push(field('目標（分）', h('input', { type: 'number', min: '0', max: '600', inputmode: 'numeric', value: String(it.goalMin || 0), oninput: (e) => { it.goalMin = Math.max(0, Number(e.target.value) || 0); } })));
    }
    const move = (d) => { const j = ii + d; if (j < 0 || j >= p.items.length) return; p.items.splice(j, 0, p.items.splice(ii, 1)[0]); renderPeopleEdit(); };
    return h('div', { class: 'ie' }, [
      h('div', { class: 'row' }, [
        field('項目の名前', h('input', { type: 'text', value: it.name, maxlength: '10', oninput: (e) => { it.name = e.target.value; } })),
        field('入力のしかた', h('select', { onchange: (e) => { Object.assign(it, K.cleanItem(Object.assign({}, it, { type: e.target.value }))); renderPeopleEdit(); } },
          C.itemTypes.map(([v, t]) => h('option', { value: v, text: t, selected: v === it.type })))),
      ]),
      h('div', { class: 'row' }, extra),
      field('説明（ルールなど。入力画面に出ます）', h('textarea', { rows: '2', value: it.note || '', oninput: (e) => { it.note = e.target.value; } })),
      h('div', { class: 'row' }, [
        h('button', { class: 'btn mini', type: 'button', text: '↑', 'aria-label': '上へ', disabled: ii === 0, onclick: () => move(-1) }),
        h('button', { class: 'btn mini', type: 'button', text: '↓', 'aria-label': '下へ', disabled: ii === p.items.length - 1, onclick: () => move(1) }),
        h('button', { class: 'btn mini danger', type: 'button', text: '項目を消す', onclick: () => { p.items.splice(ii, 1); renderPeopleEdit(); } }),
      ]),
    ]);
  }
  function renderImportWho() {
    $('impWho').replaceChildren(...draft.people.map((p) => h('option', { value: p.id, text: p.name, selected: p.id === person().id })));
  }
  function openSettings() {
    commitEdits();
    draft = K.clone(config);
    draftBase = JSON.stringify(draft.people);
    openIds.clear();
    renderPeopleEdit();
    renderImportWho();
    $('cloudUrl').value = cloudUrl;
    $('cloudInfo').textContent = '';
    $('impInfo').textContent = '';
    $('impFile').value = '';
    $('impGo').disabled = true;
    importObj = null;
    $('ver').textContent = `習慣きろく ${VERSION}`;
    dlg.showModal();
  }
  function closeSettings() {
    draft.people.forEach((p, i) => {
      p.name = p.name.trim() || `${i + 1}人目`;
      p.items.forEach((it, j) => { it.name = it.name.trim() || `項目${j + 1}`; });
    });
    const next = K.normalizeConfig(draft);
    if (JSON.stringify(next.people) !== JSON.stringify(config.people)) {
      config = next;
      config.updatedAt = Date.now();
      pushConfig();
    }
    draft = null;
    dlg.close();
    render();
  }
  $('openSettings').addEventListener('click', openSettings);
  $('closeSettings').addEventListener('click', closeSettings);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeSettings(); });
  $('pAdd').addEventListener('click', () => {
    const id = K.newId('u', draft.people.map((p) => p.id));
    const used = new Set(draft.people.map((p) => p.color));
    let color = 0;
    while (used.has(color) && color < C.colors - 1) color++;
    draft.people.push({ id, name: '', color, pianoId: '', items: C.defaultItems.map(K.cleanItem) });
    openIds.add(id);
    renderPeopleEdit();
    renderImportWho();
  });

  const OLD_SCRIPT = 'つながりましたが、スプレッドシートのプログラムが古いままです。\n「スプレッドシート用プログラムをコピー」でコピーし、スプレッドシートの 拡張機能 → Apps Script に全部貼りかえて保存してから、'
    + 'デプロイ → デプロイを管理 → 鉛筆 → バージョン「新バージョン」→ デプロイ をしてください（URL は変わりません）。';
  $('cloudTest').addEventListener('click', async () => {
    const url = $('cloudUrl').value.trim();
    const info = $('cloudInfo');
    if (!url) {
      cloudUrl = ''; save(LS.url, ''); syncState = 'local'; renderSync();
      info.textContent = '保存先を外しました。記録はこの端末の中だけに残ります';
      return;
    }
    if (!validUrl(url)) { info.textContent = 'URL の形がちがいます（…/exec で終わる URL）'; return; }
    info.textContent = 'たしかめています…';
    try {
      const j = await cloudGet(url);
      await connectCloud(url);
      info.textContent = Array.isArray(j.entries) ? `つながりました（習慣の記録 ${j.entries.length}件、ピアノの記録 ${(j.records || []).length}件）` : OLD_SCRIPT;
    } catch (e) {
      info.textContent = 'つながりません。URL と、デプロイの「アクセスできるユーザー：全員」を確認してください';
    }
  });
  async function copy(text, info, okMsg) {
    try { await navigator.clipboard.writeText(text); info.textContent = okMsg; } catch (e) { info.textContent = text.length < 400 ? text : 'コピーできませんでした'; }
  }
  $('copyCode').addEventListener('click', async () => {
    const info = $('cloudInfo');
    try {
      const code = await (await fetch('apps-script.gs', { cache: 'no-store' })).text();
      await copy(code, info, 'プログラムをコピーしました。Apps Script に貼りつけてください');
    } catch (e) { info.textContent = 'コピーできませんでした。apps-script.gs を開いてコピーしてください'; }
  });
  $('copyLink').addEventListener('click', () => {
    const info = $('linkInfo');
    if (!validUrl(cloudUrl)) { info.textContent = '先に保存先につなげてください'; return; }
    copy(location.origin + location.pathname + '#c=' + encodeURIComponent(cloudUrl), info, 'コピーしました。LINE やメモに貼って残してください（家族以外には教えないでください）');
  });
  // opening a setup link (#c=…) stores the sheet, then removes it from the address bar
  function readSetupLink() {
    const hash = location.hash.replace(/^#/, '');
    if (!/(^|&)c=/.test(hash)) return false;
    const c = new URLSearchParams(hash).get('c');
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
    if (!c || !validUrl(c)) return false;
    connectCloud(c);
    setTimeout(() => toast('記録の保存先を設定しました'), 400);
    return true;
  }

  // import of converted past records
  let importObj = null;
  $('impFile').addEventListener('change', async (e) => {
    const info = $('impInfo');
    importObj = null; $('impGo').disabled = true;
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      const r = K.readImport(obj, draft.people[0]);
      if (!r.ok) { info.textContent = r.error; return; }
      importObj = obj;
      info.textContent = `${r.from} 〜 ${r.to} の記録 ${r.entries.length}件が入っています`;
      $('impGo').disabled = false;
    } catch (err) { info.textContent = 'ファイルを読めませんでした（.json のファイルを選んでください）'; }
  });
  $('impGo').addEventListener('click', () => {
    const p = draft.people.find((x) => x.id === $('impWho').value);
    if (!importObj || !p) return;
    const r = K.readImport(importObj, p);
    if (!r.ok) { $('impInfo').textContent = r.error; return; }
    if ($('impItems').checked) {
      for (const it of r.items) {
        const i = p.items.findIndex((x) => x.id === it.id);
        if (i >= 0) p.items[i] = it; else if (p.items.length < C.maxItems) p.items.push(it);
      }
      openIds.add(p.id);
      renderPeopleEdit();
    }
    putEntries(r.entries);
    $('impGo').disabled = true;
    $('impInfo').textContent = `「${p.name}」に ${r.entries.length}件を取り込みました。`
      + (validUrl(cloudUrl) ? '保存先へ送っています（画面の上の表示が「保存ずみ」になるまで開いたままにしてください）' : 'この端末の中に保存しました');
  });

  // ---------- start ----------
  function tick() {
    const now = K.dkey(new Date());
    if (now !== today) { commitEdits(); if (date === today) date = now; today = now; render(true); }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { tick(); refreshCloud(false); } });
  window.addEventListener('online', () => refreshCloud(true));
  window.addEventListener('pageshow', tick);
  window.addEventListener('hashchange', readSetupLink);   // a setup link opened in a tab that already shows the app

  render();
  renderSync();
  if (!readSetupLink()) refreshCloud(true);
})();
