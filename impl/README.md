# Routine（習慣きろく）— impl

実装。仕様は `../spec/`（SSOT）を参照。値は spec から転記し、食い違えば **spec を正**とする。

## 起動

```powershell
node impl/tests/mock-server.js --demo     # http://localhost:8765/  偽の保存先つき（Google アカウント不要）
```

アプリの 設定 →「記録の保存先」に `http://localhost:8765/exec` を入れると、偽のスプレッドシートにつながる。
`--demo` は作り物の人とピアノの記録を入れる。サーバーを止めると偽の保存先の中身は消える。

## ディレクトリ構成

```
src/                 GitHub Pages で公開する中身（ビルドなし）
  index.html         画面（HTML と CSS）
  app.js             描画・入力・設定・保存先との送受信
  core.js            判定・集計・同期のマージ（DOM を触らない）   ← spec/software.md の behaviors
  config.js          既定値（項目の初期セット、色、上限など）
  calendar.js        日本の祝日（piano-log と同じもの）
  apps-script.gs     スプレッドシート側のプログラム（piano-log と共通）  ← spec/software.md §データ・API
tests/
  core.test.js       core.js の単体テスト（Acceptance を翻訳）
  gas.test.js        apps-script.gs のテスト
  gas-harness.js     偽の Google サービスの上で本物の apps-script.gs を動かす
  mock-server.js     開発用サーバー
tools/
  convert_original.py  過去の記録 → 取り込みファイル（original/ の中だけを読み書き）
```

## テスト

- `node --test "impl/tests/*.test.js"`
- 画面は `mock-server.js` を起動してブラウザで確認する（入力 → 保存 → 読み直し、設定、取り込み）

## 注意

- `apps-script.gs` を変えたら、`piano-log` リポジトリの同名ファイルも同じ内容にする。
- 記録・名前・保存先の URL をテストやコードに書かない（公開リポジトリ）。
