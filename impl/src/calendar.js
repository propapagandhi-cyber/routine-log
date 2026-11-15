/* JPCal — Japanese public holidays, computed from the rules of the 祝日法 (2020 onwards).
 *
 *   JPCal.holidayName(date)  → '勤労感謝の日' / '振替休日' / '' …
 *   JPCal.isOff(date)        → true on Saturdays, Sundays and holidays (the "休日" goal applies)
 *
 * Fixed days, Happy Mondays, the equinoxes (formula valid 1980–2099), 国民の休日 (a weekday
 * between two holidays) and 振替休日 (a holiday on Sunday moves to the next non-holiday day).
 * One-off changes (e.g. the 2020/2021 Olympic shifts) are not included.
 * Works in the browser (global JPCal) and in Node (module.exports).
 */
(function (root) {
  'use strict';
  const cache = {};
  const key = (d) => (d.getMonth() + 1) + '-' + d.getDate();

  // date (1-31) of the n-th Monday of month m (1-12)
  function nthMonday(y, m, n) {
    const dow = new Date(y, m - 1, 1).getDay();
    return 1 + ((8 - dow) % 7) + 7 * (n - 1);
  }
  const equinox = (y, base) => Math.floor(base + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));

  function holidays(y) {
    if (cache[y]) return cache[y];
    const H = new Map();
    const add = (m, d, name) => H.set(m + '-' + d, name);
    add(1, 1, '元日');
    add(1, nthMonday(y, 1, 2), '成人の日');
    add(2, 11, '建国記念の日');
    add(2, 23, '天皇誕生日');
    add(3, equinox(y, 20.8431), '春分の日');
    add(4, 29, '昭和の日');
    add(5, 3, '憲法記念日');
    add(5, 4, 'みどりの日');
    add(5, 5, 'こどもの日');
    add(7, nthMonday(y, 7, 3), '海の日');
    add(8, 11, '山の日');
    add(9, nthMonday(y, 9, 3), '敬老の日');
    add(9, equinox(y, 23.2488), '秋分の日');
    add(10, nthMonday(y, 10, 2), 'スポーツの日');
    add(11, 3, '文化の日');
    add(11, 23, '勤労感謝の日');
    // 国民の休日: a day (not Sunday) between two holidays
    const between = [];
    for (const d = new Date(y, 0, 2); d.getMonth() < 11 || d.getDate() < 31; d.setDate(d.getDate() + 1)) {
      const prev = new Date(y, d.getMonth(), d.getDate() - 1), next = new Date(y, d.getMonth(), d.getDate() + 1);
      if (!H.has(key(d)) && d.getDay() !== 0 && H.has(key(prev)) && H.has(key(next))) between.push(key(d));
    }
    between.forEach((k) => H.set(k, '国民の休日'));
    // 振替休日: a holiday on Sunday → the next day that is not a holiday
    const subs = [];
    for (const k of [...H.keys()]) {
      const [m, dd] = k.split('-').map(Number);
      const d = new Date(y, m - 1, dd);
      if (d.getDay() !== 0) continue;
      do d.setDate(d.getDate() + 1); while (H.has(key(d)) || subs.includes(key(d)));
      if (d.getFullYear() === y) subs.push(key(d));
    }
    subs.forEach((k) => H.set(k, '振替休日'));
    cache[y] = H;
    return H;
  }

  const JPCal = {
    holidayName: (d) => holidays(d.getFullYear()).get(key(d)) || '',
    isOff: (d) => d.getDay() === 0 || d.getDay() === 6 || holidays(d.getFullYear()).has(key(d)),
    holidays,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = JPCal;
  else root.JPCal = JPCal;
})(typeof globalThis !== 'undefined' ? globalThis : this);
