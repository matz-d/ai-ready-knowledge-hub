# `src/eval/`

**評価・品質ゲート専用**のコードです。conversion eval、P1-D quality gate、golden/heuristic チェックなど、CI とローカル eval script が使うモジュールを置きます。

## 本番経路から import しない

Next.js API routes、`uploadOrchestrator`、Firestore adapter など **本番の ingest / Context Package 経路**は `src/lib/` を正本としてください。過去に `eval/` 配下に置かれていた本番ロジック（例: `documentIrToKnowledgeChunk`）は `src/lib/conversion/` へ移しています。

`eval/conversion/index.ts` に `@deprecated` 再 export が残る場合があります。新規コードは移転先を直接 import してください。

### 意図的な例外: `DocumentIr` 型

`src/eval/conversion/documentIr.ts`（`DocumentIr` / `parseDocumentIr` / subtype schema）は、
本番 extractors（`src/lib/extractors/*`）と eval の双方から参照される共有型の正本として
**当面 `src/eval/conversion/` に残す**（Phase 2 実施メモ参照）。chunk 生成ロジック本体は
`src/lib/conversion/` へ移済み。将来 `src/lib/conversion/documentIr.ts` へ移す場合は
eval 側に shim を残す想定。

## 関連

- 品質ゲート設計: `docs/p1-d-extraction-masking-quality-gate.md`
- eval scripts: `scripts/README.md`（eval セクション）
- リファクタ計画: `docs/refactoring-plan-2026-06-11.md` Phase 2
