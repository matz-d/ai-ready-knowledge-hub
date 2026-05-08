# W1 PoC: Genkit + Vertex AI Curator

Week 1 の技術リスク検証用（`PLAN_w1.md`）。GCP の前提はルートの `docs/setup-gcp.md` を参照。

## 準備

```bash
cd poc/w1
npm install
cp .env.local.example .env.local
# .env.local に GOOGLE_CLOUD_PROJECT / GOOGLE_CLOUD_LOCATION を設定（ADC は setup-gcp.md）
```

## 実行

```bash
npm run curator
# またはファイル指定:
npm run curator -- path/to/doc.txt
```

引数なしのときは `sample/sample-doc.txt` を読みます。

## 10 件検証

`sample-data/accounting-office` 配下の `.txt` / `.md` / `.csv` を全件実行し、Zod 検証を通った件数を最後に表示します。

```bash
npm run curator:all
```

別ディレクトリを検証する場合:

```bash
npm run curator:all -- ../../sample-data/accounting-office
```

成功条件は `Curator validation: 10/10 passed` です。分類品質は Week 6 の eval 対象なので、この段階では parse 通過と手動 smoke check のみを確認します。

## A8 residualRisk 検証

マスキング後テキストを入力し、Masker が Curator の機密度判定を `Restricted` に格上げすべきかを判定します。

```bash
npm run masker:risk
# またはファイル指定:
npm run masker:risk -- sample/masked-memo-safe.txt
```

期待する smoke check:
- `sample/masked-contract-risk.txt`: 固有の契約期間・金額が残っているため `recommendedSensitivity: "Restricted"`
- `sample/masked-memo-safe.txt`: プレースホルダー化済みの一般的な対応メモとして `recommendedSensitivity: "Confidential"`

## 型チェック

```bash
npm run typecheck
```

## Genkit Developer UI（任意）

別ターミナルで UI を起動し、トレースを確認します。

```bash
npx genkit ui:start
```

続けてこのディレクトリで:

```bash
npm run curator
```

またはワンショットで dev モード（UI 同梱）:

```bash
npm run curator:ui
```

## 依存バージョン（引き継ぎ用）

- `genkit`: 1.33.0
- `@genkit-ai/google-genai`: 1.33.0
- `zod`: 3.25.76

## 検証結果

2026-05-08 時点で `npm run curator` と `npm run curator:all` は通過。`sample-data/accounting-office` の 10 件すべてで Zod parse が成功し、`Curator validation: 10/10 passed` を確認済み。

実行時に `GOOGLE_CLOUD_PROJECT` 未設定の警告が出たが、ADC のデフォルト設定で Vertex AI 呼び出し自体は成功した。再現性を上げるため、次回以降は `.env.local` に `GOOGLE_CLOUD_PROJECT` と `GOOGLE_CLOUD_LOCATION=asia-northeast1` を明示する。

手動 smoke check では parse 成功を優先しており、分類品質の厳密な一致率は Week 6 eval で扱う。目視上は `年末調整_案内文.txt` と `就業規則テンプレート.md` が想定より Public 寄り、テンプレ類が Internal 寄りに判定されるケースがあった。

2026-05-08 追加で `npm run masker:risk` を実装・検証。`masked-contract-risk.txt` は `Restricted` 格上げ、`masked-memo-safe.txt` は `Confidential` 維持となり、A8 の residualRisk 判定 PoC が通過した。
