# <プロジェクト名> — impl

実装。仕様は `../spec/`（SSOT）を参照。値は spec から転記し、食い違えば **spec を正**とする。

## 起動

```powershell
pip install -e .[dev]
python -m <pkg> --device <機種> --mock   # 実機なしで動作確認
python -m <pkg> --device <機種>          # 実機
```

## ディレクトリ構成

```
src/<pkg>/
  hal/        抽象基底 + 具象ドライバ（+ mock）   ← spec/software/hal/ に対応
  <modules>/  ビジネスロジック                    ← spec/software/behaviors/ に対応
  config/     スキーマ + ローダ                    ← spec/interface/ に対応
devices/<機種>/   機種別 config（JSON データ）     ← spec/interface/profiles/ に対応
  _template/
tests/
  unit/        Mock を用いた単体テスト（CI で実行）
  integration/ 実機タグ（@pytest.mark.hardware、CI 除外）
```

> `src/<pkg>/` の中身は実装を進めながら作る（最初は空でよい）。

## テスト

- `pytest`（unit のみ。integration は `-m hardware` で明示実行）
- コミット前に `ruff check . && ruff format .`
