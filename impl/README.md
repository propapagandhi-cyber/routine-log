# Routine（習慣きろく）— impl

実装。仕様は `../spec/`（SSOT）を参照。値は spec から転記し、食い違えば **spec を正**とする。

## 起動

```powershell
node impl/tests/mock-server.js --demo     # http://localhost:8765/  偽の GitHub つき（ネットワーク・アカウント不要）
```

起動すると、偽のデータ用リポジトリの接続コードと設定用リンクを表示する。設定用リンクを開くか、アプリの
設定 →「記録の保存先」に接続コードを貼ると、偽の GitHub につながる。`--demo` は作り物の人とピアノの記録を入れる。
サーバーを止めると中身は消える。`http://127.0.0.1:8765/` を開くと、別の端末（別の localStorage）として試せる。

- `--mount piano=<piano-log のフォルダ>` … ピアノれんしゅう記録を `/piano/` で開く（同じ偽のリポジトリを使う）
- `--file <取り込みファイル>` … `/dev/file` で配る（取り込みを試す用）
- `/dev/files` … 偽のリポジトリの中身とコミットの一覧

## ディレクトリ構成

```
src/                 GitHub Pages で公開する中身（ビルドなし）
  index.html         画面（HTML と CSS）
  app.js             描画・入力・設定・送受信のタイミング
  core.js            判定・集計・取り込みの検査（DOM を触らない）       ← spec/software.md の behaviors
  sync.js            変わったファイルだけ読む・記録単位のマージで書く     ← spec/software.md 同期のマージ
  ghstore.js         GitHub とのやりとり・接続コード・ファイルの形（piano-log と共通）  ← spec/software.md §データ
  config.js          既定値（項目の初期セット、色、上限など）
  calendar.js        日本の祝日（piano-log と同じもの）
tests/
  core.test.js       core.js の単体テスト（Acceptance を翻訳）
  store.test.js      ghstore.js と sync.js のテスト（偽の GitHub）
  fake-github.js     GitHub API の必要な部分をメモリ上でまねる（sha の検査・認証つき）
  mock-server.js     開発用サーバー
  live-github.js     本物の GitHub に対する往復確認（手動。`node --test` には入らない）
tools/
  convert_original.py  過去の記録 → 取り込みファイル（original/ の中だけを読み書き）
```

## テスト

- `node --test "impl/tests/*.test.js"`
- 画面は `mock-server.js` を起動してブラウザで確認する（入力 → 保存 → 読み直し、設定、取り込み、2台目）
- 本物の GitHub：`GH_TOKEN=<トークン> node impl/tests/live-github.js <owner> <repo>`
  （`routine/selftest/1999.json` を書くので、あとで消す）

## 注意

- `ghstore.js` を変えたら、`piano-log` リポジトリの同名ファイルも同じ内容にする。
- 記録・名前・トークン・接続コードをテストやコードに書かない（公開リポジトリ）。
