/* RoutineSync — what the routine tracker reads from and writes to the data repository (see ghstore.js).
 * No DOM, no storage: the app passes in the store and the file shas it remembers.
 *
 *   const sync = RoutineSync.create(store, shas)
 *   await sync.pull()                         → { files: [{ path, kind, … }], removed: [path] }  only what changed
 *   await sync.pushEntries(person, year, [e]) → all entries of that file after the merge
 *   await sync.pushConfig(config)             → the config that is in the repository afterwards
 *
 * Works in the browser (global RoutineSync, needs GHStore) and in Node (module.exports).
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./ghstore.js'));
  else root.RoutineSync = factory(root.GHStore);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (GHStore) {
  'use strict';
  const L = GHStore.Layout;

  function parse(kind, text) {
    if (kind.kind === 'routineYear') return { entries: L.parseRoutineYear(text, kind.person) };
    if (kind.kind === 'pianoYear') return { records: L.parsePianoYear(text) };
    if (kind.kind === 'routineConfig') return { config: L.json(text) };
    return { settings: L.json(text) };
  }

  /** The newer updatedAt wins, entry by entry; a tie goes to `incoming`. */
  function mergeEntries(existing, incoming) {
    const m = new Map(existing.map((e) => [e.id, e]));
    for (const e of incoming) {
      const cur = m.get(e.id);
      if (!cur || (cur.updatedAt || '') <= (e.updatedAt || '')) m.set(e.id, e);
    }
    return [...m.values()];
  }

  function create(store, shas) {
    const known = shas || {};
    return {
      shas: known,
      async pull() {
        const tree = await store.tree();
        const next = {}, files = [];
        for (const f of tree) {
          const kind = L.kindOf(f.path);
          if (!kind) continue;
          next[f.path] = f.sha;
          if (known[f.path] === f.sha) continue;
          files.push(Object.assign({ path: f.path }, kind, parse(kind, await store.blob(f.sha))));
        }
        // nothing is remembered unless every changed file could be read
        const removed = Object.keys(known).filter((p) => !(p in next));
        for (const p of removed) delete known[p];
        Object.assign(known, next);
        return { files, removed };
      },
      async pushEntries(person, year, list) {
        const path = L.routineYear(person, year);
        const r = await store.update(path, (text) => {
          const merged = mergeEntries(text ? L.parseRoutineYear(text, person) : [], list);
          return { text: L.formatRoutineYear(person, year, merged), value: merged };
        }, `routine: ${person} ${year}`);
        known[path] = r.sha;
        return r.value;
      },
      async pushConfig(config) {
        const r = await store.update(L.routineConfig, (text) => {
          const remote = text ? L.json(text) : null;
          if (remote && (remote.updatedAt || 0) > (config.updatedAt || 0)) return { text, value: remote };
          const mine = { schema: L.SCHEMA, updatedAt: config.updatedAt || 0, people: config.people };
          return { text: L.formatJson(mine), value: mine };
        }, 'routine: config');
        known[L.routineConfig] = r.sha;
        return r.value;
      },
    };
  }

  return { create, mergeEntries };
});
