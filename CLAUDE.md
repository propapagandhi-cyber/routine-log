# Claude Code 向け指示書（Routine — 習慣きろく）

本リポジトリは `spec/`（仕様＝SSOT）と `impl/`（実装）を統合した mono-repo。**最初にこのファイルを読むこと。**
**プランモードは使わない。** 計画・仕様・作業台帳は本リポのドキュメントで管理する（→ 末尾「運用ループ」）。

## プロジェクトの前提

- ドメイン: 家族それぞれの毎日の習慣（起床・運動・柔軟・英語・ピアノなど）を記録し、振り返る Web アプリ。
- 対象: 家族（本人・子供）。スマホ・タブレット・PC のブラウザから使う。
- スコープ: Claude Code が書くのは、ブラウザで動く静的 Web アプリと、過去の記録の変換ツール。「ピアノれんしゅう記録」（`piano-log`、`C:\ai\Sheet Music\練習記録アプリ`）の計測機能は含めない。
- 主要技術: 素の HTML/CSS/JavaScript（ビルドなし）、GitHub Pages、GitHub REST API。詳細は下「技術スタック」。
- データ: アプリ本体は公開リポジトリ、記録は**別の非公開リポジトリ**（データ用。`piano-log` と共有、ADR-0003）。

## ハードルール（不変条件・必ず守る）

1. **仕様（`spec/`）の値はハードコードしない。** 既定値は `impl/src/config.js`、人ごとの項目は保存先の設定（`routine/config.json`）から読む。
2. **人・項目の違いは設定で吸収する（ソフト一本化）。** 特定の人や項目の名前でコードを分岐させない。
3. **記録・名前・メモ・トークン・接続コードをこのリポジトリに入れない。** このリポジトリは公開。`original/` と `*.import.json` は
   `.gitignore` 済み。テストデータは作り物だけを使う。
4. **`piano-log` を壊さない。** `ghstore.js` は両アプリ共通で、同じ内容に保つ（正は本リポジトリ）。
   `piano/` のファイルの形を変えるときは `schema` を上げ、古い形も読めるようにする。習慣きろくは `piano/` に書かない。
5. **画面に出る文字列は日本語**、コード・コメント・ログは英語。
6. **単位**: 日付は `YYYY-MM-DD`（端末の現地時間）、時刻は `HH:MM`（24時間）、ピアノは秒で持ち分で表示、
   更新日時は ISO 8601（UTC）。
7. **保存先との境界は `ghstore.js`（GitHub とのやりとり）と `sync.js`（何をどのファイルに）だけ。**
   `core.js`・`sync.js`・`ghstore.js` は DOM・localStorage を触らない。トークンは GitHub（`api.github.com`）以外に送らない。

## SSOT（単一の真実）

- 値の正は **`spec/` の Markdown**。`impl/` はそこから転記する。食い違えば **`spec/` を正**とする。
- 発見は実装から始まってもよいが、**`spec/` に書き戻すまで「完了」ではない**（逆流は STATUS.md 経由で正規化）。

## Git 運用

- git は必須。**worktree は使わない**（単一作業ツリーで直列）。
- 作業ブランチは **`vX.Y` 形式**（次の版番号）。`claude/...` の自動命名は使わない。
- 完了時：`git switch main` → `git merge --no-ff vX.Y -m "Merge vX.Y (要約)"` → `git tag vX.Y` → `git branch -d vX.Y`。
- 文書の成熟度は frontmatter `status:`、リリースは tag（役割を混ぜない）。
- GitHub Pages は `main` への push で `.github/workflows/pages.yml` が `impl/src/` を公開する。

## 仕様 ↔ 実装の対応（doc ↔ impl）

| spec（正） | impl | テスト |
|---|---|---|
| `software.md` §データ・接続コード・GitHub API | `src/ghstore.js` | `tests/store.test.js` |
| `software.md` 同期のマージ | `src/sync.js` | `tests/store.test.js`（偽の GitHub）、`tests/live-github.js`（本物・手動） |
| `software.md` 起床の判定／ピアノの自動集計／達成率 | `src/core.js` | `tests/core.test.js` |
| `software.md` 入力／月の一覧／取り込み | `src/app.js`, `src/index.html` | `tests/mock-server.js` でブラウザ確認 |
| `software.md` 過去の記録の取り込み（変換） | `tools/convert_original.py` | 変換結果の件数・異常の報告 |

**Mock-first**：保存先は `tests/fake-github.js`（GitHub API の必要な部分をメモリ上でまねる。sha の検査・認証つき）。
単体テストもブラウザ確認も、ネットワークなしで走る。本物の GitHub での確認は `tests/live-github.js`（手動）。

## 何を読めば何が分かるか

| 知りたいこと | 読むファイル |
|---|---|
| なぜ作るか・目標値・NFR | `spec/requirements.md` |
| 用語 | `spec/glossary.md` |
| 振る舞い＋作り方＋受入 | `spec/software.md` |
| なぜそう決めたか | `spec/decisions/ADR-*.md` |
| 今どこ・次に何を | `STATUS.md` |

## 技術スタック（確定）

- 言語: JavaScript（ES2020、ブラウザ）。ビルド・フレームワークなし
- 保存先: GitHub の非公開リポジトリ＋GitHub REST API＋fine-grained personal access token（`piano-log` と共有）
- 配信: GitHub Pages（GitHub Actions で `impl/src/` を公開）
- テスト: Node.js 20+ の `node --test`
- 変換ツール: Python 3（`openpyxl`）
- 対象: iPad／iPhone の Safari、PC の Chrome／Edge

選定根拠は `spec/decisions/` の ADR を参照。

## ビルド・実行・テスト

- `node --test "impl/tests/*.test.js"` でテスト
- `node impl/tests/mock-server.js --demo` で起動（<http://localhost:8765/>、偽の GitHub つき。起動時に接続コードと設定用リンクを表示する）
- `GH_TOKEN=… node impl/tests/live-github.js <owner> <repo>` で本物の GitHub に対する往復確認（手動）
- `python impl/tools/convert_original.py` で過去の記録を取り込みファイルに変換（`original/` → `original/*.import.json`）

## スタイル

- `core.js` は純粋関数。日付・設定・記録は引数で受け取る（グローバル状態を持たない）。
- 画面は `app.js` の `h()` で要素を組み立てる（`innerHTML` に記録の文字列を入れない）。

## 運用ループ（プランモードの代替）

1. 開始：本ファイル（自動）＋ `STATUS.md`（次タスク）＋ README 索引から該当 spec を読む。
2. behavior 仕様が無ければ、**先に `spec/software.md` に Acceptance 付きで書く**＝これが計画。
3. `impl/` で実装。Acceptance を単体テストに翻訳。
4. 終了：`STATUS.md` 更新（done／次／再開点）、必要なら ADR、確定した値を `spec/` に**書き戻す**。
