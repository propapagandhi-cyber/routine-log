---
adr: 0002
title: 記録は piano-log と同じ Google スプレッドシートに保存し、アプリは別にする
status: superseded      # proposed | accepted | superseded | deprecated
scope: architecture     # product | architecture | data | process | tooling | hardware
supersedes:
superseded_by: 0003
date: 2026-11-16
---

## Context（背景・前提）

- 習慣の記録を、家族それぞれが複数の端末から読み書きしたい。ピアノは `piano-log` の練習時間を自動で使いたい。
- `piano-log` はアプリ本体を GitHub Pages（公開リポジトリ）で配信し、記録は Google スプレッドシートに
  Apps Script ウェブアプリ経由で保存している（GitHub には記録を置いていない）。
- 当初の希望は「データは GitHub のクラウドに置く」だったが、目的は「クラウドに 1か所で持ち、どの端末からも使える」こと。
  `piano-log` 側を変更してもよい、という前提をもらっている。

## Decision（決めたこと）

1. **保存先は `piano-log` と同じスプレッドシート・同じ Apps Script ウェブアプリ（URL も同じ）にする。**
   シート「習慣」と、スクリプトのプロパティ `routine` を追加する。`apps-script.gs` は両アプリ共通の 1本とし、
   既存の呼び出し（`list`／`add`／`delete`／`settings`）は変えない。
2. **アプリは別リポジトリの別アプリにする。** ピアノの練習時間は `GET ?action=routine` で記録ごと受け取り、アプリ側で集計する。
3. **人の一覧は習慣アプリが自分で持ち、`pianoId` でピアノアプリの人とひも付ける。** 最初はピアノアプリの人から作る。

## Consequences（結果・トレードオフ）

- 設定する URL は 1つ。ピアノの自動入力は同じ保存先から読むだけで済む。表計算でも中身を見られる。
- 子供の端末に GitHub のアカウントやトークンがいらない。
- Apps Script を 1回貼り替えて再デプロイする必要がある（URL は変わらない）。
- `apps-script.gs` が 2つのリポジトリに同じ内容で置かれる。変更するときは両方を同じにする（正は本リポジトリの `impl/src/apps-script.gs`）。
- 保存先の URL を知っている人は読み書きできる（`piano-log` と同じ前提）。
- 習慣アプリで人を足しても、ピアノアプリの人は増えない（ピアノをしない人を足せる）。

## Alternatives（検討した他案）

- **GitHub の非公開リポジトリに JSON で保存**：各端末にアクセストークンが必要で、子供の端末の設定と管理が重い。
  ピアノの時間は結局スプレッドシートから読むので、保存先が 2つになる。
- **`piano-log` に「習慣」タブを足して 1つのアプリにする**：毎日使っている計測アプリを大きく改造することになり、
  不具合を持ち込む危険がある。ピアノの前の iPad と、手元のスマホでは使い方も違う。
- **人の一覧をピアノアプリと完全に共有**：ピアノアプリは設定をまるごと上書き保存するため、習慣用の値を混ぜると消える。
