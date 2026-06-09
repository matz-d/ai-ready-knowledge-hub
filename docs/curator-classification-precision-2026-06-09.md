# Curator 分類精度: 公開文書の over-restriction 検証（2026-06-09）

**軸**: つくる（分類/マスキング精度）。「使える情報」を不当に締め出さないこと。
**正本ポリシー**: 本書は本検証の結果ログ。製品定義は [CLAUDE.md](../CLAUDE.md)、curator の分類ルールは `src/agents/curator/prompt.ts` を正とする。

## 背景・問い

マスキング/除外の経路は `aiUsePolicy` 駆動（`requires_masking` のみ Masker を通り、`direct` は素通り）。
したがって「公開情報を過剰に締め出す（over-restriction）」リスクは **curator の分類精度**に乗る。
under-masking（漏れ）は fail-closed 安全ゲートで守られるが、**over-restriction は無防備で未計測**だった。

問い: **公開文書（公的機関の様式・モデル等）が curator によって Public/direct に保たれるか？**

## 発見した実例（本番 corpus）

公開文書 `mhlw-labor-conditions-notice-general.pdf`（厚労省 労働条件通知書モデル様式・空欄）が
**同一文書で2回アップロードされ、正反対に分類**されていた:

| record | sensitivity | aiUsePolicy / status | createdAt(UTC) |
|---|---|---|---|
| 30b31987… | Public | direct / curated | 2026-05-20 07:34 |
| d2e75082… | **Restricted** | **blocked / blocked** | 2026-05-20 03:18 |

誤レコードの curator rationale は「個別の労働者の賃金や勤務時間など個人を特定できる機微な情報を含むため」
＝**空欄様式の“記入欄”を“記入済みの実 PII”と幻覚**したもの。

## 測定: curator 分類精度 eval（新規）

`src/eval/curator/publicDocClassificationGolden.ts`（golden + 純関数）と
`scripts/runCuratorClassificationEval.ts`（live ランナー）を新設。
公開 fixture（IR 付き4件: mhlw×3 / nta×1）を curator に各5回かけ、over-restriction 率を測定。

実行: `GOOGLE_CLOUD_LOCATION=global EVAL_RUNS=5 pnpm tsx scripts/runCuratorClassificationEval.ts`
（`global` 必須。`asia-northeast1` は Gemini 3.x が 404）。

### 結果（現行パイプライン: Gemini 3.5-flash @ global）

| fixture | sensitivity 分布 | over-restriction |
|---|---|---|
| mhlw-labor-conditions-notice-general | Public×5 | 0/5 |
| mhlw-r07-model-work-rules | Public×5 | 0/5 |
| mhlw-overtime-limit-guide | Public×5 | 0/5 |
| nta-withholding-form-blank-scan | Public×5 | 0/5 |

**全体 over-restriction 率: 0/20 (0.0%)** — 本番で誤分類された当の文書も含め、現行では Public で安定。

## 結論: 既に修正済み（stale artifact）

誤レコードは2つの修正より**前**に作られた:
- 「公開様式・テンプレートの扱い」プロンプト指示（`prompt.ts` 22–25行）landed: commit `f764062` 2026-05-20 **10:44Z**（誤レコード 03:18Z より後）
- Gemini 3.5 移行: commit `03a0364` 2026-06-03（5/20 時点は旧モデル）

→ 当時の Public⇔Restricted の揺れは**旧プロンプト×旧モデル**の挙動。現行（公開様式指示 + 3.5）では再現せず（0/20）。
**curator のプロンプト/モデル修正は不要**（既に効いている）。本 eval を**回帰ゲート**として残す。

## 留保と残作業

- 0/20 は「皆無」の証明ではない（片側95%上限 ≈ 14%）。重要度が上がれば N を増やして上限を締める。
- 第2トラック（変換精度）は未着手。既存 `src/eval/conversion/` + `.expected.json` で公開文書を測れる。

## 是正（2026-06-09 実施）

本番の誤レコード `d2e75082`（公開テンプレが Restricted/blocked のまま）を **`scripts/recurateDocument.ts` で現行 curator により再分類して是正**した。

- 再 curate 結果: **Public / direct**（「未記入テンプレートで実データを含まない」と正しく判定）。
- 書き込み後の状態: `status=curated / sensitivity=Public / aiUsePolicy=direct / sensitivitySource=curator / masker=null`（direct 文書の canonical 状態に正規化）。検証済み。
- これで同一文書の2レコードがともに Public/direct となり、公開テンプレが Context Package から不当に除外される状態は解消。
- スクリプトは dry-run 既定・`--apply` 明示時のみ書き込み、再 curate が direct でない場合は中断する安全設計。再利用可能な remediation ツールとして残す。
