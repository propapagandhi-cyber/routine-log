---
title: Requirements
status: draft           # draft | confirmed | baselined
updated: <YYYY-MM-DD>
owner: Ken
---

# 要件（WHY）

「なぜその仕様にしたか」の根。各要件に **安定ID `R-n`** を振り、spec / behavior 側から `satisfies R-n` で参照する。
実装中に変わってよい（非ウォーターフォール）。変更時は `decisions/` に理由を残し、波及を `STATUS.md` に起票する。

## 背景・課題

<どんな課題か。現状の何が問題か。>

## ユーザー価値

<誰が・何ができて・何が嬉しいか。>

## 機能要件

| ID | 要件 | 優先度 | status |
|---|---|---|---|
| R-1 | <システムは … できること> | must | draft |
| R-2 | <…> | should | draft |

## 品質特性（NFR）

| ID | 観点 | 目標 |
|---|---|---|
| R-10 | 性能 | <例：1サイクル < 400 ms> |
| R-11 | 信頼性 | <例：…> |
| R-12 | 安全 | <例：E-stop は IO 層で遮断> |

## 外部制約（与件）

<変えられない前提：対象OS、既存ハード、法規・社内規格、納期など。>

## 成功指標

<何をもって成功とするか。測定可能な形で。>
