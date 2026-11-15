---
adr: 0001
title: ADR を用いて判断を記録する
status: accepted        # proposed | accepted | superseded | deprecated
scope: process
supersedes:
superseded_by:
date: 2026-11-16
---

## Context（背景・前提）

プロジェクトでは HW/SW 双方で多くの設計判断が発生する。「なぜそう決めたか」を残さないと、
後から同じ議論を繰り返したり、合意の根拠を失ったりする。一方で重厚な設計書の維持は負担が大きい。

## Decision（決めたこと）

判断の履歴を **ADR（Architecture Decision Record）** に統一する。`spec/decisions/ADR-NNNN-slug.md` に
1 判断 1 ファイルで残し、追記イミュータブル（変更は新 ADR で supersede）とする。
成果物の差分は git、判断の理由は ADR、という役割分担とする。

## Consequences（結果・トレードオフ）

- 重要判断が短い単位で追える。人間のレビュー・承認はここに集約できる。
- 各 ADR を最新に保つ運用規律が必要（README の索引と status を更新する）。

## Alternatives（検討した他案）

- 設計書に履歴章を設ける案：肥大化し、どれが現行決定か分かりにくいため却下。
- git のコミットメッセージのみ：「なぜ」が分散し検索性が低いため却下。
