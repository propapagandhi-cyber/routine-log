# Claude Code 向け指示書（<プロジェクト名>）

本リポジトリは `spec/`（仕様＝SSOT）と `impl/`（実装）を統合した mono-repo。**最初にこのファイルを読むこと。**
**プランモードは使わない。** 計画・仕様・作業台帳は本リポのドキュメントで管理する（→ 末尾「運用ループ」）。

## プロジェクトの前提

- ドメイン: <何を解決する装置／ソフトか>
- 対象: <対象ワーク・ユーザー>
- スコープ: Claude Code が書くのは <PCアプリ／解析ツール 等>。<対象外（ファーム等）> は含めない。
- 主要技術: <言語・GUI・主要ライブラリ>。詳細は下「技術スタック」。

## ハードルール（不変条件・必ず守る）

> ここはプロジェクト固有の“絶対に動かさない”制約を箇条書きにする。AIP-Flex の例が参考になる。

1. **仕様（`spec/`）の値はハードコードしない。** 起動時に `impl/` 側 config からロード。欠落は fail-fast。
2. **機種差・特注は profile/config で吸収する（ソフト一本化）。** コードは分岐させない。
3. **<HW境界>は抽象基底経由でしか触らない。** 上位は具象クラス名を知らない。設定で切替。
4. **オペレータに見える文字列は日本語**、コード・コメント・ログは英語。
5. **単位**: <直線 mm／角度 deg／時間 ms 等を明記>。
6. <その他、座標系・安全入力の扱いなど>

## SSOT（単一の真実）

- 値の正は **`spec/` の Markdown**。`impl/` はそこから転記する。食い違えば **`spec/` を正**とする。
- 発見は実装・実機から始まってもよいが、**`spec/` に書き戻すまで「完了」ではない**（逆流は STATUS.md 経由で正規化）。

## Git 運用

- git は必須（旧版復元・特注分岐のため）。**worktree は使わない**（単一作業ツリーで直列）。
- 作業ブランチは **`vX.Y` 形式**（次の版番号）。`claude/...` の自動命名は使わない。
- 完了時：`git switch main` → `git merge --no-ff vX.Y -m "Merge vX.Y (要約)"` → `git tag vX.Y` → `git branch -d vX.Y`。
- 特注は **`impl/devices/<機種>/` ＋ `spec/interface/profiles/<機種>.md` を足す**（profile方式）。コード分岐は本当にロジックが違う時のみ `custom/<客>`。
- 文書の成熟度は frontmatter `status:`、リリースは tag（役割を混ぜない）。

## 仕様 ↔ 実装の対応（doc ↔ impl）

| spec（正） | impl | テスト |
|---|---|---|
| `interface/<x>-schema.md`, `profiles/<機種>.md` | `src/config/` ＋ `devices/<機種>/*.json` | `test_config_load` |
| `software/hal/<境界>.md` | `src/hal/<境界>/`（base＋具象＋mock） | mockで単体 |
| `software/behaviors/<機能>.md` の Acceptance | `src/<module>/` | `test_<機能>.py` |
| `software/architecture.md` | `src/` レイアウト | — |

**Mock-first**：全HW境界に Mock を常備し、`tests/unit/` を実機なしで CI 実行。実機テストは `tests/integration/`（`@pytest.mark.hardware`、CI除外）。

## 何を読めば何が分かるか

| 知りたいこと | 読むファイル |
|---|---|
| なぜ作るか・目標値・NFR | `spec/requirements.md` |
| 用語 | `spec/glossary.md` |
| 振る舞い＋作り方＋受入 | `spec/software.md`（昇格後は `software/behaviors/<機能>.md`） |
| なぜそう決めたか | `spec/decisions/ADR-*.md` |
| 今どこ・次に何を | `STATUS.md` |

## 技術スタック（確定）

- 言語: <Python 3.11+ 等>
- GUI: <PySide6 等>
- 設定/バリデーション: <pydantic v2 等、ユーザー設定は JSON>
- 対象OS: <Windows 10/11 x64 等>

選定根拠は `spec/decisions/` の ADR を参照。

## ビルド・実行・テスト

- `<pip install -e .[dev] 等>`
- `<python -m <pkg> 等>` で起動（Mockは `--mock` 等）
- `<pytest>` でテスト
- コミット前に `<ruff check . && ruff format .>`

## スタイル

- 公開関数は型ヒント必須。グローバル状態を持たず依存は注入する。
- Mock 実装を常備し、実機なしで単体テストが走るようにする。

## 運用ループ（プランモードの代替）

1. 開始：本ファイル（自動）＋ `STATUS.md`（次タスク）＋ README 索引から該当 spec を読む。
2. behavior 仕様が無ければ、**先に `software/behaviors/<タスク>.md`（Acceptance付き）を書く**＝これが計画。
3. `impl/` で実装。Acceptance を Mock 単体テストに翻訳。
4. 終了：`STATUS.md` 更新（done／次／再開点）、必要なら ADR、実機確定値を `spec/` に**書き戻す**。
