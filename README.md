# <プロジェクト名>

<一行で：何のための装置／ソフトか>。`spec/`（仕様＝SSOT）と `impl/`（実装）を統合した mono-repo。

## 読む順序

1. `CLAUDE.md` — ルール・技術スタック・Git運用（Claude Code は最初にこれを読む）
2. `spec/requirements.md` — なぜ作るか・目標値・NFR
3. `spec/glossary.md` — 用語
4. `spec/software.md` — 仕様本体（昇格後は `spec/software/`）
5. `STATUS.md` — 今どこ・次に何を

## 知りたいこと → 読むファイル

| 知りたいこと | ファイル |
|---|---|
| なぜ作るか・目標値・NFR・与件 | `spec/requirements.md`（`R-n`） |
| 用語の定義 | `spec/glossary.md` |
| 外から見た振る舞い＋作り方＋受入 | `spec/software.md` →（昇格）`spec/software/behaviors/<機能>.md` |
| レイヤ・モジュール責務・起動順 | `spec/software.md` §アーキテクチャ →（昇格）`spec/software/architecture.md` |
| HW/外部との境界・契約 | `spec/interface/`（任意） |
| 機種ごとに変わる具体値 | `spec/interface/profiles/<機種>.md` ↔ `impl/devices/<機種>/` |
| 何が可変・何が不変か | `spec/variation-matrix.md`（任意） |
| なぜそう決めたか | `spec/decisions/ADR-NNNN-slug.md` |
| 今どこ・次に何を・未確定 | `STATUS.md` |

## ディレクトリ構成

| パス | 役割 |
|---|---|
| `spec/` | 仕様（SSOT）。人間とAIの合意対象 |
| `impl/` | 実装。値は `spec/` から転記、食い違いは `spec/` を正 |
| `spec/decisions/` | ADR — 判断の履歴 |

## 状態

<ドラフト版（骨格）。未確定項目は `STATUS.md` に棚卸し。>
