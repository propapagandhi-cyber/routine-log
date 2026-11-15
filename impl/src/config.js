/* Defaults for the routine tracker. Everything a person or item can vary by lives here or in the
 * cloud config (script property `routine`) — never in app.js / core.js.
 * Works in the browser (global RoutineConfig) and in Node (module.exports).
 */
(function (root) {
  'use strict';
  const RoutineConfig = {
    appName: '習慣きろく',
    // the piano practice tracker that shares the spreadsheet
    pianoAppUrl: 'https://propapagandhi-cyber.github.io/piano-log/',
    // people created when neither the cloud config nor the piano app has any (ids match piano-log's defaults)
    defaultPeople: [
      { id: 'p1', name: 'おとうさん', color: 0, pianoId: 'p1' },
      { id: 'p2', name: '長男', color: 1, pianoId: 'p2' },
      { id: 'p3', name: '次男', color: 2, pianoId: 'p3' },
    ],
    // items every new person starts with
    defaultItems: [
      { id: 'wake', name: '起床', type: 'time', limitW: '06:30', limitH: '07:00', note: '' },
      { id: 'exercise', name: '運動', type: 'choice', options: [], note: '' },
      { id: 'stretch', name: '柔軟', type: 'choice', options: [], note: '' },
      { id: 'english', name: '英語', type: 'choice', options: [], note: '' },
      { id: 'piano', name: 'ピアノ', type: 'piano', goalMin: 10, note: '' },
    ],
    itemTypes: [['time', '時刻'], ['choice', 'えらぶ'], ['piano', 'ピアノ（自動）']],
    colors: 5,            // --p0 … --p4 in index.html
    maxPeople: 8,
    maxItems: 10,
    memoItem: 'memo',     // item id of the daily note
    quickTimes: 4,        // how many frequently used times to offer for a `time` item
    quickTimeDays: 60,    // …looking back this many days
    postChunk: 400,       // entries per POST (imports are split)
    refreshMs: 20000,     // do not re-read the cloud more often than this
    memoSaveMs: 1200,     // save the note this long after typing stops
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = RoutineConfig;
  else root.RoutineConfig = RoutineConfig;
})(typeof globalThis !== 'undefined' ? globalThis : this);
