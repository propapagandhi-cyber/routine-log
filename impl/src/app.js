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
  const LS = { config: 'rl.config', entries: 'rl.entries', queue: 'rl.waiting', piano: 'rl.piano', conn: 'rl.conn', files: 'rl.files', sel: 'rl.sel' };
  function load(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked or full */ } }
  const slim = (e) => ({ id: e.id, date: e.date, person: e.person, item: e.item, result: e.result, value: e.value, updatedAt: e.updatedAt });

  const stored = load(LS.config, null);
  let config = stored ? K.normalizeConfig(stored) : K.seedConfig(null, C);
  let entries = K.mergeEntries(load(LS.entries, []), []);
  const NO_PIANO = { records: [], since: '', sinceSetting: '', people: [] };
  let piano = Object.assign({}, NO_PIANO, load(LS.piano, null));
  let pianoIdx = K.pianoIndex(piano.records);
  let selId = load(LS.sel, '');
  // the data repository on GitHub (see ghstore.js / sync.js)
  let conn = load(LS.conn, null);                 // { owner, repo, token, branch, api } from the 接続コード
  const fileShas = load(LS.files, {});            // what this device has already read: path → sha
  const q0 = load(LS.queue, null) || {};
  const waiting = new Map((q0.entries || []).map((e) => [e.id, e]));   // entries not yet in the repository
  let configDirty = !!q0.config;
  let sync = conn ? RoutineSync.create(GHStore.create(conn), fileShas) : null;
  let syncState = conn ? 'wait' : 'local', syncKind = '';

  let today = K.dkey(new Date());
  let view = 'day';
  let date = today;
  let ym = { y: +today.slice(0, 4), m: +today.slice(5, 7) };
  let year = ym.y;

  const ctx = () => ({ entries, piano: pianoIdx, since: piano.since, today });
  const person = () => config.people.find((p) => p.id === selId) || config.people[0];
  const colorOf = (p) => `var(--p${(p.color || 0) % C.colors})`;
  const MEMO = { id: C.memoItem, name: 'メモ' };

  // ---------- cloud (private data repository on GitHub, shared with piano-log) ----------
  const L = GHStore.Layout;
  const connected = () => !!sync;
  const pending = () => [...waiting.values()];
  const yearOf = (e) => +e.date.slice(0, 4);
  const saveQueue = () => save(LS.queue, { entries: pending(), config: configDirty });
  const saveEntries = () => save(LS.entries, [...entries.values()].map(slim));
  const SYNC_MSG = {
    auth: '接続できません（接続コードの期限切れかもしれません）。設定の「記録の保存先」を見てください',
    forbidden: '保存する権限がありません。接続コードの設定を確認してください',
    ratelimit: '少し時間をおいてから、もう一度ためします',
    notfound: '記録の保存先が見つかりません。設定の「記録の保存先」を見てください',
    format: '保存先のデータが読めませんでした。設定する人に連絡してください',
  };
  const syncMessage = (kind) => SYNC_MSG[kind] || '保存先とやりとりできませんでした。しばらくしてからもう一度ためします';
  function failed(e) {
    syncKind = (e && e.kind) || 'unknown';
    syncState = syncKind === 'offline' ? 'offline' : 'error';
  }

  /** One person's year as it is in the repository; what is still waiting to be sent stays on top. */
  function adoptFile(personId, year, list) {
    const y = String(year);
    for (const [id, e] of entries) if (e.person === personId && e.date.startsWith(y)) entries.delete(id);
    for (const e of list) entries.set(e.id, e);
    for (const e of waiting.values()) if (e.person === personId && e.date.startsWith(y)) entries.set(e.id, e);
  }
  function adoptConfig(c) {
    if (configDirty || !c || !Array.isArray(c.people) || !c.people.length || (c.updatedAt || 0) < (config.updatedAt || 0)) return;
    config = K.normalizeConfig(c);
    save(LS.config, config);
  }

  let flushing = null, flushTimer = 0;
  // a moment after the last tap, so that a run of taps becomes one write
  function flushSoon() { clearTimeout(flushTimer); flushTimer = setTimeout(flush, C.pushDelayMs); }
  function flush() {
    clearTimeout(flushTimer);
    if (!connected()) { syncState = 'local'; renderSync(); return Promise.resolve(); }
    if (flushing) return flushing;
    flushing = (async () => {
      try {
        while (waiting.size || configDirty) {
          if (waiting.size) {
            // one file (person × year) at a time
            const first = waiting.values().next().value;
            const batch = pending().filter((e) => e.person === first.person && yearOf(e) === yearOf(first));
            if (waiting.size > batch.length) { syncState = 'sending'; renderSync(); }
            const merged = await sync.pushEntries(first.person, yearOf(first), batch);
            for (const e of batch) if (waiting.get(e.id) === e) waiting.delete(e.id);   // unless it was edited again meanwhile
            adoptFile(first.person, yearOf(first), merged);
            saveEntries();
          } else {
            const sent = config.updatedAt;
            const kept = await sync.pushConfig(config);
            if (config.updatedAt === sent) { configDirty = false; adoptConfig(kept); }
          }
          saveQueue();
        }
        syncState = 'ok';
      } catch (e) {
        failed(e);
      }
    })().finally(() => { flushing = null; save(LS.files, fileShas); render(true); renderSync(); });
    return flushing;
  }
  function putEntries(list, now) {
    for (const e of list) { entries.set(e.id, e); if (connected()) waiting.set(e.id, e); }
    saveEntries();
    if (!connected()) return;
    saveQueue();
    renderSync();
    if (now) flush(); else flushSoon();
  }
  function pushConfig() {
    save(LS.config, config);
    if (!connected()) return;
    configDirty = true;
    saveQueue();
    flushSoon();
  }

  /** Takes over what changed in the repository since the last look. */
  function applyPull(got) {
    let pianoChanged = false;
    const dropYear = (y) => { piano.records = piano.records.filter((r) => !String(r.date).startsWith(String(y))); pianoChanged = true; };
    for (const f of got.files) {
      if (f.kind === 'routineYear') adoptFile(f.person, f.year, f.entries);
      else if (f.kind === 'routineConfig') adoptConfig(f.config);
      else if (f.kind === 'pianoYear') { dropYear(f.year); piano.records = piano.records.concat(f.records); }
      else { piano.people = (f.settings && f.settings.people) || []; piano.sinceSetting = (f.settings && f.settings.since) || ''; pianoChanged = true; }
    }
    for (const path of got.removed) {
      const k = L.kindOf(path);
      if (k && k.kind === 'routineYear') adoptFile(k.person, k.year, []);
      if (k && k.kind === 'pianoYear') dropYear(k.year);
    }
    if (pianoChanged) {
      piano.since = K.pianoSince({ since: piano.sinceSetting }, piano.records);
      pianoIdx = K.pianoIndex(piano.records);
      save(LS.piano, piano);
    }
    // nothing saved anywhere yet: start from the people of the piano app
    if (!config.updatedAt && !fileShas[L.routineConfig] && piano.people.length) {
      config = K.seedConfig({ people: piano.people }, C);
      save(LS.config, config);
    }
    saveEntries();
  }

  let lastRefresh = 0;
  async function refreshCloud(force) {
    if (!connected()) { syncState = 'local'; renderSync(); return; }
    if (!force && Date.now() - lastRefresh < C.refreshMs) return;
    lastRefresh = Date.now();
    await flush();
    if (syncState === 'ok' || syncState === 'wait') {
      try {
        applyPull(await sync.pull());
        syncState = 'ok';
      } catch (e) {
        failed(e);
      }
      save(LS.files, fileShas);
    }
    rebaseDraft();
    render(true);
    renderSync();
  }
  function connectCloud(next) {
    const wasLocal = !connected();
    const other = !wasLocal && (conn.owner !== next.owner || conn.repo !== next.repo);
    conn = next;
    save(LS.conn, conn);
    for (const k of Object.keys(fileShas)) delete fileShas[k];      // read everything again
    if (other) {
      // another repository: what came from the old one does not belong here
      entries = K.mergeEntries([], pending());
      piano = Object.assign({}, NO_PIANO);
      pianoIdx = K.pianoIndex([]);
      save(LS.piano, piano);
    }
    sync = RoutineSync.create(GHStore.create(conn), fileShas);
    if (wasLocal) {
      // what was recorded on this device before it was connected goes up too (the newer write wins there)
      for (const e of entries.values()) waiting.set(e.id, e);
      if (config.updatedAt) configDirty = true;
    }
    saveQueue();
    syncState = 'wait';
    renderSync();
    return refreshCloud(true);
  }
  function disconnectCloud() {
    conn = null; sync = null;
    save(LS.conn, null);
    waiting.clear(); configDirty = false; saveQueue();
    syncState = 'local';
    renderSync();
  }
  function renderSync() {
    const el = $('sync');
    const n = waiting.size;
    el.classList.toggle('bad', syncState === 'offline' || syncState === 'error' || (syncState === 'local' && entries.size > 0));
    if (syncState === 'local') el.textContent = '記録はこの端末の中だけに保存しています（設定で保存先につなげられます）';
    else if (syncState === 'wait') el.textContent = '読みこんでいます…';
    else if (syncState === 'sending') el.textContent = `保存先へ送っています（のこり ${n}件）`;
    else if (syncState === 'offline') el.textContent = n ? `まだ送れていない記録が ${n}件あります。つながったら送ります` : 'インターネットにつながっていません。つながったら読みこみます';
    else if (syncState === 'error') el.textContent = syncMessage(syncKind) + (n ? `（送れていない記録 ${n}件）` : '');
    else el.textContent = n ? '保存しています…' : '保存ずみ';
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
  const openNotes = new Set();   // "person/item" whose option notes are unfolded

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
      const notes = it.optionNotes || {};
      if (st.result === DONE && notes[st.value]) ctl.append(h('p', { class: 'onote', text: `${st.value}：${notes[st.value]}` }));
      const withNote = opts.filter((o) => notes[o]);
      if (withNote.length) {
        const key = `${p.id}/${it.id}`;
        ctl.append(h('details', { class: 'olist', open: openNotes.has(key), ontoggle: (e) => { if (e.target.open) openNotes.add(key); else openNotes.delete(key); } }, [
          h('summary', { text: 'えらぶ内容の説明' }),
          ...withNote.map((o) => h('p', {}, [h('b', { text: o }), `：${notes[o]}`])),
        ]));
      }
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
        : !connected() ? '保存先につなげると、ピアノの時間が自動で入ります'
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
            if (!window.confirm(`「${p.name}」を消しますか？（これまでの記録は保存先に残ります）`)) return;
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
      extra.push(optionsEdit(it));
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
  // the options of a choice item: a name and, if wanted, what it stands for
  function optionsEdit(it) {
    it.options = it.options || [];
    it.optionNotes = it.optionNotes || {};
    const rows = it.options.map((name, i) => h('div', { class: 'orow' }, [
      h('input', {
        class: 'inp', type: 'text', value: name, maxlength: '16', placeholder: '名前（例：筋トレ①）', 'aria-label': `えらぶ内容 ${i + 1} の名前`,
        oninput: (e) => {
          const old = it.options[i], next = e.target.value.trim();
          it.options[i] = next;
          if (old in it.optionNotes) { const n = it.optionNotes[old]; delete it.optionNotes[old]; it.optionNotes[next] = n; }   // the note follows the name
        },
      }),
      h('button', { class: 'btn mini danger', type: 'button', text: '×', 'aria-label': `えらぶ内容「${name}」を消す`, onclick: () => {
        delete it.optionNotes[it.options[i]];
        it.options.splice(i, 1);
        renderPeopleEdit();
      } }),
      h('textarea', {
        class: 'inp', rows: '2', value: it.optionNotes[name] || '', placeholder: 'くわしい内容（例：腕立て・スクワット 各30回）。空でもよい', 'aria-label': `えらぶ内容 ${i + 1} の説明`,
        oninput: (e) => { it.optionNotes[it.options[i]] = e.target.value; },   // a note typed before the name waits under ''
      }),
    ]));
    return h('div', { class: 'opts' }, [
      h('div', { class: 'optl', text: 'えらぶ内容と、その説明（ひとつもなければ「できた」だけ）' }),
      ...rows,
      h('div', { class: 'row' }, h('button', { class: 'btn mini', type: 'button', text: '＋ えらぶ内容を足す', onclick: () => { it.options.push(''); renderPeopleEdit(); } })),
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
    $('connCode').value = '';
    $('mkOut').value = '';
    $('mkInfo').textContent = '';
    renderConn('');
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

  const repoName = () => (conn ? `${conn.owner}/${conn.repo}` : '');
  function renderConn(msg) {
    $('connOff').hidden = !connected();
    $('copyCode').hidden = !connected();
    $('copyLink').hidden = !connected();
    $('cloudInfo').textContent = msg || (connected() ? `つながっています（${repoName()}）` : 'まだつなげていません');
  }
  async function connectWith(code, say) {
    let next;
    try { next = GHStore.decodeCode(code); } catch (e) { say('接続コードの形がちがいます（KIROKU1: で始まる文字をまるごと貼ってください）'); return false; }
    try {
      await GHStore.create(next).tree();
    } catch (e) {
      say(e.kind === 'offline' ? 'インターネットにつながっていません' : syncMessage(e.kind));
      return false;
    }
    await connectCloud(next);
    return true;
  }
  $('connGo').addEventListener('click', async () => {
    const code = $('connCode').value.trim();
    if (!code) { renderConn('接続コードを貼り付けてください'); return; }
    renderConn('たしかめています…');
    if (await connectWith(code, renderConn)) { $('connCode').value = ''; renderConn(`つながりました（${repoName()}）`); }
  });
  $('connOff').addEventListener('click', () => {
    const n = waiting.size;
    if (!window.confirm(n ? `まだ送れていない記録が ${n}件あります。接続を解除しますか？（記録はこの端末には残ります）` : '接続を解除しますか？（記録はこの端末と保存先の両方に残ります）')) return;
    disconnectCloud();
    renderConn('接続を解除しました。記録はこの端末の中だけに残ります');
  });
  async function copy(text, info, okMsg) {
    try { await navigator.clipboard.writeText(text); info.textContent = okMsg; } catch (e) { info.textContent = text; }
  }
  const KEEP = 'パスワードと同じです。家族以外には送らないでください';
  $('copyCode').addEventListener('click', () => copy(GHStore.encodeCode(conn), $('linkInfo'), `接続コードをコピーしました。ピアノれんしゅう記録にも同じコードを使えます。${KEEP}`));
  $('copyLink').addEventListener('click', () => copy(location.origin + location.pathname + '#c=' + GHStore.encodeCode(conn), $('linkInfo'), `設定用リンクをコピーしました。ほかの端末で開くと保存先が設定されます。${KEEP}`));
  // making a code out of the three parts (the person who sets things up does this once)
  $('mkGo').addEventListener('click', () => {
    const out = $('mkOut');
    try {
      out.value = GHStore.encodeCode({ owner: $('mkOwner').value, repo: $('mkRepo').value, token: $('mkToken').value });
      $('connCode').value = out.value;
      $('mkInfo').textContent = '接続コードを作りました。上の欄にも入れたので「つなげる」を押してください';
      $('mkToken').value = '';
    } catch (e) {
      out.value = '';
      $('mkInfo').textContent = 'ユーザー名・リポジトリの名前・トークンを全部入れてください';
    }
  });
  // opening a setup link (#c=KIROKU1:…) connects this device, then removes the code from the address bar
  function readSetupLink() {
    const hash = location.hash.replace(/^#/, '');
    if (!/(^|&)c=/.test(hash)) return false;
    const c = new URLSearchParams(hash).get('c');
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
    if (!c || !GHStore.isCode(c)) return false;
    connectWith(c, toast).then((ok) => { if (ok) toast('記録の保存先を設定しました'); });
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
    putEntries(r.entries, true);
    $('impGo').disabled = true;
    $('impInfo').textContent = `「${p.name}」に ${r.entries.length}件を取り込みました。`
      + (connected() ? '保存先へ送っています（画面の上の表示が「保存ずみ」になるまで開いたままにしてください）' : 'この端末の中に保存しました');
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

  $('mkRepo').value = C.dataRepoName;
  // leaving the app: send what is still waiting right away
  document.addEventListener('visibilitychange', () => { if (document.hidden && (waiting.size || configDirty)) flush(); });
  render();
  renderSync();
  if (!readSetupLink()) refreshCloud(true);
})();
