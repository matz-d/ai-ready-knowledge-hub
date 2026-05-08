# Week 1 振り返り (2026-05-05 〜 2026-05-08 で実質クローズ)

`PLAN_w1.md` に書いていた W1-1〜W1-4 の技術リスク検証は 5/8 中に完了した。本ファイルは
`PLAN_w1.md` を畳んだ要約 + W2 への引き継ぎメモ。原本 PLAN は git history で追える。

## W1 の問いと答え

| # | 問い | 答え | 一次成果物 |
|---|---|---|---|
| W1-1 | Genkit + Vertex AI で Curator 6 項目の structured output が安定して取れるか | はい。10/10 件 Zod parse 通過。4 段フォールバック (structured / text JSON / format=json+schema / format=json) を実装し常用化 | `src/agents/curator/{schema,prompt,flow}.ts` |
| W1-2 | A8 residualRisk 判定 (Confidential -> Restricted の逆feedback) が動くか | はい。`masked-contract-risk.txt` で Restricted、`masked-memo-safe.txt` で Confidential を実観測 | `src/agents/masker/{schema,prompt,flow}.ts` |
| W1-3 | A9 Markdown export が動くか | はい。Package Manifest + Instructions + Included/Excluded + Missing + Full Sources を純関数で生成 | `src/lib/exportContextPackage.ts` |
| W1-4 | Next.js 最小アプリが Cloud Run にデプロイできるか | はい。`ai-ready-knowledge-hub-w1` が `asia-northeast1` で HTTP 200 (組織ポリシー上 allUsers 公開不可、認証付きで確認) | Cloud Run service |

## D1 (Genkit 本採用) は継続

撤退条件に該当する事象は出なかった。`@genkit-ai/google-genai` 1.33.x + `gemini-2.5-flash` + Zod superRefine の組み合わせで実用充分。

## W1 後半に発生した整合性問題と対処

W1-3/W1-4 後の見た目作り込みフェーズで、UI 都合の独自 enum (`Contract|Template|...` 英語、`current|needs review|old candidate`) が `src/demo/inventory.ts` に発生し、R5 で確定した日本語 enum と二重管理になりかけた。

**5/8 PM に正本化を実施 (`docs/decisions.md` D-W1-Close)**:

- `poc/w1/` を削除
- Zod schema / prompt / Genkit flow を `src/agents/{curator,masker,_shared}/` に昇格
- `src/demo/inventory.ts` を `InventorySnapshotEntry = CuratorOutputResult + fileName + maskerEvaluation` 型に書き換え、独自 enum を排除
- `scripts/generateInventorySnapshot.ts` を追加し、UI に渡す snapshot を `npm run inventory:snapshot` で実 LLM 出力に上書きできるようにした
- root `package.json` に Genkit / Vertex / zod / tsx を統合、`npm run typecheck` および `npm run build` 通過

## W2 引き継ぎチェックリスト

- [ ] `.env.local` を root に作成 (`docs/setup-gcp.md` 参照)
- [ ] `npm run inventory:snapshot` を 1 回実行し、`src/demo/inventory.snapshot.json` を実 LLM 出力で初期化 (UI から読む配線は W2 で追加)
- [ ] `src/agents/curator/flow.ts` を Next.js Server Action / Route Handler から呼ぶ最小経路を作る (Walking Skeleton)
- [ ] Cloud Storage バケット作成 + Firestore セットアップ (`docs/open-questions.md` の細かい未決定事項を消化)
- [ ] アップロード UI → curatorFlow → Firestore 永続化までの最小縦串
- [ ] `eval/expected-labels.json` の作成 (`docs/open-questions.md` R4 / R5 の宿題)

## 触らなかったが残してある資産

- `sample-data/accounting-office/` 全 10 ファイル
- `sample-data/masked/masked-contract-risk.txt` `masked-memo-safe.txt` (Masker A8 評価のリファレンス入力)

## 教訓

「production 品質で書くものとデモ用に殴り書くものを分ける」原則 (poc-workspace-policy)
は移植時にも適用すべきで、UI 都合で勝手に enum を作り直すと正本との衝突が発生する。
W2 では「Curator が返す型を UI が直接受け取る」一筆書きを維持する。
