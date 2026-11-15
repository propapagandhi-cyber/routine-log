---
title: Software Spec
status: draft           # draft | confirmed | baselined
updated: <YYYY-MM-DD>
owner: Ken
---

# ソフトウェア仕様（WHAT ＋ HOW）

> **これは1枚版。** 肥大化したら同名フォルダ `software/` に昇格する（参照パスとロジックは変えない）：
> `architecture.md`（地図）＋ `hal/<境界>.md`（横）＋ `behaviors/<機能>.md`（縦・Acceptance付き）。
> 昇格時の部品テンプレは標準フォルダ `C:\ai\.project-doc-structure\templates\` を参照。

## アーキテクチャ概要

<単一プロセスか、スレッド構成は、など1段落。>

### レイヤ構成

```
<UI 層>
   │
<ロジック層>
   │
<HAL（抽象基底 + 具象ドライバ）>
```

### モジュール責務

| モジュール | 責務 | 対応仕様 |
|---|---|---|
| `<module>` | <…> | <behavior / hal> |

### 起動シーケンス

1. <config ロード（spec の値を impl 側 config から）>
2. <HAL 生成・接続>
3. <UI 表示>

## 振る舞い（behaviors）

> 1機能 = 1 ブロック。**WHAT(Acceptance) と HOW(sequence) を同居**させる。
> 機能が増えたら `software/behaviors/<機能>.md` に切り出す（雛形: `C:\ai\.project-doc-structure\templates\behavior.md`）。

### <機能名>（例：homing）

- **satisfies**: R-<n>
- **モジュール**: `<対応モジュール>`
- **入力（依存SSOT）**: `<interface/... / hardware/...>`
- **シーケンス**: <手順・状態遷移>
- **エラー処理**: <異常時の振る舞い>
- **Acceptance**（pytest に翻訳できる形）:
  1. <…>
  2. <…>
