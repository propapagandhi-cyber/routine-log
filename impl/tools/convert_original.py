"""Convert the hand-kept records in original/ into an import file for the app.

    python impl/tools/convert_original.py            # original/ → original/routine.import.json

Sources (none of them is committed; see .gitignore):
  original/*YYYY.txt   notes, one day = a date line ("M/D") followed by a line of comma separated marks
  original/*.xlsx      one sheet per month ("4月" …): 日付, 曜日, 起床時刻, 運動, 柔軟, 英語, ピアノ, メモ
  original/*ルール.txt  the rules; each block starts with an item name and becomes that item's note

Where a day is in both, the spreadsheet wins and the notes fill what it leaves empty.
The report at the end lists everything that had to be guessed.
"""
import argparse
import collections
import datetime
import glob
import io
import json
import os
import re
import sys

# item id, name, words that name it in the notes
ITEMS = [
    ("wake", "起床", ["定時起き", "早起き", "起床"]),
    ("exercise", "運動", ["運動"]),
    ("stretch", "柔軟", ["柔軟"]),
    ("english", "英語", ["英語"]),
    ("piano", "ピアノ", ["ピアノ"]),
]
IDS = [i[0] for i in ITEMS]
NAME = {i[0]: i[1] for i in ITEMS}
# what a plain "done" mark in the notes stands for, in the words the spreadsheet uses
NOTE_VALUE = {"wake": "", "exercise": "筋トレ{m}", "stretch": "セット{m}", "english": "", "piano": "5分"}
SHEET_COLS = {"起床時刻": "wake", "運動": "exercise", "柔軟": "stretch", "英語": "english", "ピアノ": "piano", "メモ": "memo"}
FAIL_WORD = "失敗"
MEMO = "memo"


def item_of(text):
    """ids of the items named in text, in ITEMS order"""
    return [i for i, _, words in ITEMS if any(w in text for w in words)]


def split_marks(line):
    """split at '、' but keep （…） together"""
    out, depth, cur = [], 0, ""
    for ch in line:
        if ch in "（(":
            depth += 1
        elif ch in "）)":
            depth = max(0, depth - 1)
        if ch == "、" and depth == 0:
            out.append(cur)
            cur = ""
        else:
            cur += ch
    out.append(cur)
    return [t.strip() for t in out if t.strip()]


def parse_day(line, report, date):
    """one line of marks → ({item: (result, value)}, memo)"""
    got, memo, others_reason = {}, [], None
    for tok in split_marks(line):
        wrapped = re.fullmatch(r"[（(](.*)[）)]", tok)
        if wrapped:
            head, _, reason = wrapped.group(1).partition("、")
        else:
            m = re.match(r"(.*?)[（(](.*)[）)](.*)$", tok)
            head, reason = (m.group(1) + m.group(3), m.group(2)) if m else (tok, "")
        head, reason = head.strip(), reason.strip()
        named = item_of(head)
        if wrapped or FAIL_WORD in head or "無し" in head:
            if not wrapped and not named:          # e.g. "禁煙失敗": not one of the items → keep as a note
                memo.append(tok)
                continue
            if "その他" in head:
                others_reason = reason
                continue
            if not reason and FAIL_WORD not in head:  # "（運動は筋肉痛のため無し）"
                left = head
                for _, _, words in ITEMS:
                    for w in words:
                        left = left.replace(w, "")
                reason = left.lstrip("は").strip()
            for i in named or IDS:
                got[i] = ("fail", "")
            if reason:
                memo.append((("・".join(NAME[i] for i in named) + "：") if named else "") + reason)
        elif len(named) == 1:
            mark = "②" if "②" in head else "①"
            value = reason or NOTE_VALUE[named[0]].format(m=mark)
            got[named[0]] = ("done", value)
        else:
            memo.append(tok)                         # e.g. "飲み会後①"
            report["notes"].append(f"{date} 「{tok}」→ メモへ")
    if others_reason is not None:
        for i in IDS:
            got.setdefault(i, ("fail", ""))
        if others_reason:
            memo.append(others_reason)
    for i in IDS:
        if i not in got:
            got[i] = ("fail", "")
            report["unlisted"].append(f"{date} {NAME[i]}")
    return got, "、".join(memo)


def read_notes(path, year, report):
    days, date = {}, None
    for raw in io.open(path, encoding="utf-8-sig"):
        line = raw.strip()
        m = re.fullmatch(r"(\d{1,2})/(\d{1,2})", line)
        if m:
            date = f"{year}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
        elif line and date:
            days[date] = parse_day(line, report, date)
            date = None
    return days


def read_sheets(path, year, report):
    import openpyxl
    days = {}
    wb = openpyxl.load_workbook(path, data_only=True)
    for ws in wb:
        if not re.fullmatch(r"\d{1,2}月", ws.title):
            continue
        rows = list(ws.iter_rows(values_only=True))
        cols = {SHEET_COLS[h]: n for n, h in enumerate(rows[0]) if h in SHEET_COLS}
        for row in rows[1:]:
            d = row[0]
            if isinstance(d, (datetime.datetime, datetime.date)):
                date = f"{year}-{d.month:02d}-{d.day:02d}"
            else:
                m = re.fullmatch(r"(\d{1,2})/(\d{1,2})", str(d or "").strip())
                if not m:
                    continue
                date = f"{year}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
            got = {}
            for item in IDS:
                v = row[cols[item]] if item in cols else None
                if v is None or str(v).strip() == "":
                    continue
                if item == "wake":
                    if isinstance(v, (datetime.time, datetime.datetime)):
                        got[item] = ("auto", f"{v.hour:02d}:{v.minute:02d}")
                    elif re.fullmatch(r"\d{1,2}:\d{2}(:\d{2})?", str(v).strip()):
                        h, mi = str(v).strip().split(":")[:2]
                        got[item] = ("auto", f"{int(h):02d}:{mi}")
                    else:
                        got[item] = ("fail", "") if FAIL_WORD in str(v) else ("done", "")
                        report["notes"].append(f"{date} 起床「{v}」は時刻として読めません")
                else:
                    s = str(v).strip()
                    got[item] = ("fail", "") if s == FAIL_WORD else ("done", s)
            memo = str(row[cols[MEMO]] or "").strip() if MEMO in cols else ""
            if got or memo:
                days[date] = (got, memo)
    return days


def read_rules(path):
    """blocks separated by blank lines; the first line names the item"""
    notes = {}
    for block in re.split(r"\n\s*\n", io.open(path, encoding="utf-8-sig").read()):
        lines = [x.strip() for x in block.strip().splitlines() if x.strip()]
        if len(lines) < 2:
            continue
        named = item_of(lines[0])
        if len(named) == 1:
            notes[named[0]] = "\n".join(lines[1:])
    return notes


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--src", default="original")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    out = a.out or os.path.join(a.src, "routine.import.json")
    report = {"notes": [], "unlisted": []}

    notes_days, sheet_days = {}, {}
    for path in sorted(glob.glob(os.path.join(a.src, "*.txt"))):
        m = re.search(r"(20\d\d)\.txt$", path)
        if m:
            notes_days.update(read_notes(path, int(m.group(1)), report))
    for path in sorted(glob.glob(os.path.join(a.src, "*.xlsx"))):
        m = re.search(r"(20\d\d)\.xlsx$", path)
        if m:
            sheet_days.update(read_sheets(path, int(m.group(1)), report))

    entries, overlap = [], []
    for date in sorted(set(notes_days) | set(sheet_days)):
        n_got, n_memo = notes_days.get(date, ({}, ""))
        s_got, s_memo = sheet_days.get(date, ({}, ""))
        if date in notes_days and date in sheet_days:
            overlap.append(date)
        for item in IDS:
            r = s_got.get(item) or n_got.get(item)
            if r:
                entries.append({"date": date, "item": item, "result": r[0], "value": r[1]})
        memo = s_memo or n_memo
        if memo:
            entries.append({"date": date, "item": MEMO, "result": "", "value": memo})

    # item settings that follow from the data: the choices in use, the latest piano goal, the rules as notes
    rules = {}
    for path in glob.glob(os.path.join(a.src, "*ルール*.txt")):
        rules = read_rules(path)
    items = []
    for item, name, _ in ITEMS:
        it = {"id": item, "name": name, "note": rules.get(item, "")}
        vals = collections.Counter(e["value"] for e in entries if e["item"] == item and e["result"] == "done" and e["value"])
        if item == "wake":
            times = re.findall(r"(\d{1,2})時(\d{1,2})分", it["note"])
            it.update(type="time", limitW="%02d:%02d" % tuple(map(int, times[0])) if times else "06:30",
                      limitH="%02d:%02d" % tuple(map(int, times[1])) if len(times) > 1 else "07:00")
        elif item == "piano":
            last = [e["value"] for e in entries if e["item"] == item and re.fullmatch(r"\d+分", e["value"])]
            it.update(type="piano", goalMin=int(last[-1][:-1]) if last else 10)
        else:
            it.update(type="choice", options=[v for v, n in vals.most_common() if n >= 5])
        items.append(it)

    with io.open(out, "w", encoding="utf-8", newline="\n") as f:
        json.dump({"format": "routine-import", "version": 1, "items": items, "entries": entries}, f, ensure_ascii=False, indent=1)

    dates = sorted({e["date"] for e in entries})
    print(f"{out}: {len(entries)} entries, {len(dates)} days, {dates[0]} .. {dates[-1]}")
    print(f"  notes: {len(notes_days)} days, spreadsheet: {len(sheet_days)} days, in both: {len(overlap)} ({', '.join(overlap[:1] + overlap[-1:])})")
    for item, name, _ in ITEMS:
        c = collections.Counter(e["result"] for e in entries if e["item"] == item)
        print(f"  {name}: done {c['done']}, fail {c['fail']}, time (judged at import) {c['auto']}")
    for it in items:
        print(f"  setting {it['name']}: " + json.dumps({k: v for k, v in it.items() if k not in ('id', 'name', 'note')}, ensure_ascii=False))
    print(f"  not listed on that day, imported as fail ({len(report['unlisted'])}): " + ", ".join(report["unlisted"]))
    for n in report["notes"]:
        print("  note: " + n)
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
