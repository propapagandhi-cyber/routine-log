'use strict';
/* Runs the real apps-script.gs on top of an in-memory fake of the Google services it uses
 * (SpreadsheetApp, PropertiesService, LockService, ContentService). Shared by the unit tests
 * and by mock-server.js, so nothing here needs a Google account.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const GS = path.join(__dirname, '..', 'src', 'apps-script.gs');

function fakeSheet(name) {
  const cells = [];        // cells[row][col], 0-based, display strings
  let maxRows = 1000;      // like a new Google sheet
  const sheet = {
    name,
    frozen: 0,
    getLastRow() {
      for (let r = cells.length - 1; r >= 0; r--) if ((cells[r] || []).some((v) => v !== '' && v !== undefined)) return r + 1;
      return 0;
    },
    getMaxRows: () => maxRows,
    insertRowsAfter(_after, n) { maxRows += n; },
    setFrozenRows(n) { sheet.frozen = n; },
    deleteRow(r) { cells.splice(r - 1, 1); maxRows--; },
    getRange(row, col, nr = 1, nc = 1) {
      if (row < 1 || col < 1 || row + nr - 1 > maxRows) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
      const range = {
        getDisplayValues() {
          const out = [];
          for (let r = 0; r < nr; r++) {
            const line = [];
            for (let c = 0; c < nc; c++) { const v = (cells[row - 1 + r] || [])[col - 1 + c]; line.push(v === undefined ? '' : String(v)); }
            out.push(line);
          }
          return out;
        },
        setValues(vals) {
          if (vals.length !== nr || vals.some((v) => v.length !== nc)) throw new Error('The number of rows or columns in the data does not match the range.');
          for (let r = 0; r < nr; r++) {
            const line = cells[row - 1 + r] || (cells[row - 1 + r] = []);
            for (let c = 0; c < nc; c++) {
              let v = vals[r][c];
              if (typeof v === 'string' && v.charAt(0) === "'") v = v.slice(1);   // text marker
              line[col - 1 + c] = String(v);
            }
          }
          return range;
        },
        clearContent() {
          for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++) if (cells[row - 1 + r]) cells[row - 1 + r][col - 1 + c] = '';
          return range;
        },
        setFontWeight: () => range,
        setNumberFormat: () => range,
        setNumberFormats: () => range,
      };
      return range;
    },
    _cells: cells,
  };
  return sheet;
}

/** Creates one isolated "spreadsheet + script". */
function createBackend() {
  const sheets = [];
  const props = {};
  const ss = {
    getSheetByName: (n) => sheets.find((s) => s.name === n) || null,
    getSheets: () => sheets.slice(),
    insertSheet(n, idx) { const s = fakeSheet(n); sheets.splice(idx === undefined ? sheets.length : idx, 0, s); return s; },
  };
  const ctx = vm.createContext({
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (text) => ({ text, setMimeType() { return this; } }) },
    console,
  });
  vm.runInContext(fs.readFileSync(GS, 'utf8'), ctx, { filename: 'apps-script.gs' });
  const call = (fn, e) => JSON.parse(vm.runInContext(fn, ctx)(e).text);
  return {
    get: (params) => call('doGet', { parameter: params || {} }),
    post: (body) => call('doPost', { postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }),
    sheet: (n) => ss.getSheetByName(n),
    sheets,
    props,
  };
}

module.exports = { createBackend };
