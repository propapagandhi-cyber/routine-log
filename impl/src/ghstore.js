/* GHStore — the data repository on GitHub, shared by 習慣きろく (routine-log) and ピアノれんしゅう記録 (piano-log).
 * Keep this file identical in both apps.
 *
 *   GHStore.encodeCode({ owner, repo, token })  → 'KIROKU1:…'   the 接続コード pasted once per device
 *   GHStore.decodeCode(code)                    → { owner, repo, token, branch, api }  (throws StoreError('format'))
 *   GHStore.create(conn, { fetchImpl })         → store with tree() / blob(sha) / read(path) / write(path, text, sha, msg)
 *                                                 / update(path, mutate, msg)
 *   GHStore.Layout                              → file names and formats inside the data repository
 *
 * Works in the browser (global GHStore) and in Node (module.exports). No DOM, no storage.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.GHStore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const API = 'https://api.github.com';
  const PREFIX = 'KIROKU1:';
  const BRANCH = 'main';
  const TIMEOUT_MS = 20000;
  const MAX_RETRIES = 4;

  /** kind: offline | auth | forbidden | ratelimit | notfound | conflict | server | format | unknown */
  class StoreError extends Error {
    constructor(kind, status) { super(kind); this.kind = kind; this.status = status || 0; }
  }

  // ---------- base64 (UTF-8 safe) ----------
  function utf8ToB64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64ToUtf8(b64) {
    const bin = atob(String(b64).replace(/\s/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }
  const toUrl = (b64) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const fromUrl = (s) => { const b = s.replace(/-/g, '+').replace(/_/g, '/'); return b + '='.repeat((4 - (b.length % 4)) % 4); };

  // ---------- connection code ----------
  // a local test server may stand in for GitHub; nothing else may receive the token
  const okApi = (a) => a === API || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(a);
  function encodeCode(c) {
    const o = { o: String(c.owner || '').trim(), r: String(c.repo || '').trim(), t: String(c.token || '').trim() };
    if (!o.o || !o.r || !o.t) throw new StoreError('format');
    if (c.branch && c.branch !== BRANCH) o.b = c.branch;
    if (c.api && c.api !== API) o.a = c.api;
    return PREFIX + toUrl(utf8ToB64(JSON.stringify(o)));
  }
  function decodeCode(code) {
    const s = String(code || '').replace(/\s+/g, '');
    if (!s.startsWith(PREFIX)) throw new StoreError('format');
    let o;
    try { o = JSON.parse(b64ToUtf8(fromUrl(s.slice(PREFIX.length)))); } catch (e) { throw new StoreError('format'); }
    if (!o || !o.o || !o.r || !o.t || (o.a && !okApi(o.a))) throw new StoreError('format');
    return { owner: o.o, repo: o.r, token: o.t, branch: o.b || BRANCH, api: o.a || API };
  }
  const isCode = (s) => { try { decodeCode(s); return true; } catch (e) { return false; } };

  // ---------- client ----------
  function classify(res) {
    const s = res.status;
    if (s === 401) return new StoreError('auth', s);
    if (s === 403 || s === 429) {
      const left = res.headers && res.headers.get && res.headers.get('x-ratelimit-remaining');
      return new StoreError(left === '0' || s === 429 ? 'ratelimit' : 'forbidden', s);
    }
    if (s === 404) return new StoreError('notfound', s);
    if (s === 409 || s === 422) return new StoreError('conflict', s);
    if (s >= 500) return new StoreError('server', s);
    return new StoreError('unknown', s);
  }
  const enc = (p) => String(p).split('/').map(encodeURIComponent).join('/');

  function create(conn, opts) {
    const o = opts || {};
    const doFetch = o.fetchImpl || ((...a) => globalThis.fetch(...a));
    const repo = `${conn.api || API}/repos/${encodeURIComponent(conn.owner)}/${encodeURIComponent(conn.repo)}`;
    const branch = conn.branch || BRANCH;

    async function request(method, url, body) {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), o.timeoutMs || TIMEOUT_MS) : null;
      try {
        return await doFetch(url, {
          method, cache: 'no-store', signal: ctrl ? ctrl.signal : undefined,
          headers: Object.assign({
            Accept: 'application/vnd.github+json', Authorization: `Bearer ${conn.token}`, 'X-GitHub-Api-Version': '2022-11-28',
          }, body ? { 'Content-Type': 'application/json' } : {}),
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (e) {
        throw new StoreError('offline');
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    return {
      conn,
      /** All files of the branch: [{ path, sha }]. An empty repository gives []. */
      async tree() {
        const res = await request('GET', `${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
        if (res.status === 404 || res.status === 409) {
          const r = await request('GET', repo);        // tell "no commits yet" from "no such repository"
          if (!r.ok) throw classify(r);
          return [];
        }
        if (!res.ok) throw classify(res);
        const j = await res.json();
        return (j.tree || []).filter((t) => t.type === 'blob').map((t) => ({ path: t.path, sha: t.sha }));
      },
      /** The text of a blob named by tree(). */
      async blob(sha) {
        const res = await request('GET', `${repo}/git/blobs/${sha}`);
        if (!res.ok) throw classify(res);
        const j = await res.json();
        return b64ToUtf8(j.content || '');
      },
      /** { text, sha } of the file as it is now, or null when it does not exist. */
      async read(path) {
        const res = await request('GET', `${repo}/contents/${enc(path)}?ref=${encodeURIComponent(branch)}`);
        if (res.status === 404) return null;
        if (!res.ok) throw classify(res);
        const j = await res.json();
        return { text: j.content ? b64ToUtf8(j.content) : await this.blob(j.sha), sha: j.sha };
      },
      /** Creates (sha null) or replaces the file; StoreError('conflict') when it changed since `sha`. Returns the new sha. */
      async write(path, text, sha, message) {
        const body = { message: message || `update ${path}`, content: utf8ToB64(text), branch };
        if (sha) body.sha = sha;
        const res = await request('PUT', `${repo}/contents/${enc(path)}`, body);
        if (!res.ok) throw classify(res);
        const j = await res.json();
        return (j.content && j.content.sha) || null;
      },
      /** Read → change → write, again from the start when someone else wrote in between.
       *  mutate(text | null) returns { text, value }; resolves { value, sha } (nothing is written when the text is unchanged). */
      async update(path, mutate, message) {
        for (let i = 0; i < (o.maxRetries || MAX_RETRIES); i++) {
          const cur = await this.read(path);
          const next = mutate(cur ? cur.text : null);
          if (cur && next.text === cur.text) return { value: next.value, sha: cur.sha };
          try {
            return { value: next.value, sha: await this.write(path, next.text, cur ? cur.sha : null, message) };
          } catch (e) {
            if (!(e instanceof StoreError) || e.kind !== 'conflict') throw e;
          }
        }
        throw new StoreError('conflict');
      },
    };
  }

  // ---------- layout of the data repository ----------
  //   routine/config.json          people and their items                      (routine-log)
  //   routine/<person>/<year>.json one person's entries of one year, a line per day
  //   piano/settings.json          people, goals and options of the piano app  (piano-log)
  //   piano/records-<year>.json    practice sessions of one year, a line per session
  const SCHEMA = 1;
  const Layout = {
    SCHEMA,
    routineConfig: 'routine/config.json',
    pianoSettings: 'piano/settings.json',
    routineYear: (person, year) => `routine/${person}/${year}.json`,
    pianoYear: (year) => `piano/records-${year}.json`,
    /** → { kind: 'routineConfig' | 'routineYear' | 'pianoSettings' | 'pianoYear', person, year } or null */
    kindOf(path) {
      if (path === Layout.routineConfig) return { kind: 'routineConfig' };
      if (path === Layout.pianoSettings) return { kind: 'pianoSettings' };
      let m = /^routine\/([\w-]+)\/(\d{4})\.json$/.exec(path);
      if (m) return { kind: 'routineYear', person: m[1], year: +m[2] };
      m = /^piano\/records-(\d{4})\.json$/.exec(path);
      return m ? { kind: 'pianoYear', year: +m[1] } : null;
    },
    json(text) { try { return JSON.parse(text); } catch (e) { throw new StoreError('format'); } },
    formatJson: (obj) => JSON.stringify(obj, null, 1) + '\n',

    /** entries [{ date, person, item, result, value, updatedAt }] of one person and year → text */
    formatRoutineYear(person, year, entries) {
      const days = new Map();
      for (const e of entries) {
        if (!days.has(e.date)) days.set(e.date, {});
        days.get(e.date)[e.item] = [e.result || '', e.value || '', e.updatedAt || ''];
      }
      const lines = [...days.keys()].sort().map((d) => {
        const o = {};
        for (const k of Object.keys(days.get(d)).sort()) o[k] = days.get(d)[k];
        return `${JSON.stringify(d)}: ${JSON.stringify(o)}`;
      });
      return `{\n"schema": ${SCHEMA},\n"person": ${JSON.stringify(person)},\n"year": ${year},\n"days": {\n${lines.join(',\n')}\n}\n}\n`;
    },
    parseRoutineYear(text, person) {
      const j = Layout.json(text);
      const who = person || j.person;
      const out = [];
      for (const [date, items] of Object.entries(j.days || {})) {
        for (const [item, v] of Object.entries(items || {})) {
          out.push({ id: `${date}_${who}_${item}`, date, person: who, item, result: v[0] || '', value: v[1] || '', updatedAt: v[2] || '' });
        }
      }
      return out;
    },
    /** piano sessions of one year → text, one line each, in time order */
    formatPianoYear(year, records) {
      const key = (r) => `${r.date} ${r.start || ''} ${r.id}`;
      const lines = records.slice().sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)).map((r) => JSON.stringify(r));
      return `{\n"schema": ${SCHEMA},\n"year": ${year},\n"records": [\n${lines.join(',\n')}\n]\n}\n`;
    },
    parsePianoYear(text) {
      const j = Layout.json(text);
      return Array.isArray(j.records) ? j.records.filter((r) => r && r.id && r.date) : [];
    },
  };

  return { API, PREFIX, StoreError, utf8ToB64, b64ToUtf8, encodeCode, decodeCode, isCode, create, Layout };
});
