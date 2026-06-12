# リファクタリング計画（2026-06-11）

正本: このファイル。実施状況は本ファイルのチェックボックスを更新する。
前提: 提出 2026-07-10 まで約4週。P1-D 成熟化は完了（PR #35）。**P1-E → P2** が機能側の正本順序
（`docs/next-actions-2026-06-10.md`）。**リファクタリングは機能計画をブロックしない範囲で、
P1-E が触る領域を先に整地する**という方針で優先順位を付ける。

---

## A. 調査サマリ

### A-1. 健全な点（壊さないこと自体が価値）

| 観点 | 現状 |
|---|---|
| 型衛生 | `as any` 0件 / `as unknown as` 1件（src 全体、テスト除く） |
| 意図コメント | 決定ID（D-PROD-1 等）・docs 参照付きの不変条件コメントが要所に存在 |
| テスト | 874件 green（2026-06-12）、`__tests__/` 同居方式で一貫 |
| CI | conversion-eval（P1-D zero checks = blocker）+ deploy + actionlint |
| 境界宣言 | CLAUDE.md に Repository Map / Safety Invariants が明文化済み |

リファクタリング中の不変条件: **Safety Invariants に関わる挙動
（fail-closed、safety gate、restricted 終端、マスキング順序）は一切変えない。**
機械的な移動・抽出に限定し、各フェーズで `pnpm typecheck` / `pnpm test` /
（構造変更時）`pnpm build` を green に保つ。

### A-2. 確認された負債（バイブコーディング由来の堆積）

1. **`src/lib/uploadOrchestrator.ts` = 1639行の god module**。
   1ファイルに5責務が同居:
   - Firestore update draft builder 群（`buildAiSafeFirestoreUpdate` /
     `buildRestrictedFirestoreUpdate` / `buildSafetyGateRestrictedFirestoreUpdate` /
     `buildBaseInitialDocumentBody` / `buildUploadInitialDocumentBody` /
     `buildImportedSnapshotInitialDocumentBody`）
   - Curator / Masker phase runner（`runCuratorPhase` / `runMaskerPhase` /
     `runCuratorAndMaskerLifecycle`）
   - PDF 経路 orchestration（`orchestratePdfPath` 約260行 + `runPdfCuratorPhase` +
     `terminateRestrictedByUnmaskablePii` + `persistPdfHealthStageEval`）
   - audit 記録（`recordDocumentConvertAudit` / `recordConversionFailure` / `recordPhaseFailure`）
   - GCS / Firestore cleanup（`safeDeleteMaskedObject` / `safeDeleteRawObject` /
     `safeDeleteFirestoreDoc`）
   テスト側も鏡像で 1406行（`uploadOrchestrator.test.ts`）。

2. **`timestampToIso` の4重複 + 変種1**。
   `inventoryFirestoreAdapter.ts:28` / `conversionEvalStorage.ts:91` /
   `chunkFirestoreAdapter.ts:69` / `contextPackageJobs/firestoreAdapter.ts:30` に
   ほぼ同一実装。戻り値型が `string` と `string | undefined` で既に分岐（ドリフトの初期症状）。
   `importedSnapshotOrchestrator.ts:490` に `timestampToDate` 変種。

3. **本番ロジックが `src/eval/` 配下に居る**。
   `src/eval/conversion/documentIrToKnowledgeChunk.ts`（462行）は本番の
   chunk 生成本体で、`uploadOrchestrator.ts`（本番 upload 経路）が import している。
   「eval = 非本番の評価コード」という名前空間の含意と実態が乖離し、
   eval 改修時に本番経路を壊すリスクの認知が働かない。

4. **`src/app/api/documents/route.ts`（401行）のコメントと実態の乖離**。
   ヘッダコメントは「責務は HTTP 境界に限定する」と宣言するが、実体には
   `PDF_SUBTYPE_PRE_FLIGHT_CONFIGS`（PDF subtype 判定→extractor dispatch）、
   feature flag 分岐、chunk 同期生成などのビジネスロジックが堆積。
   route handler はテストしにくい層なので、ロジックが滞留するほど検証コストが上がる。

5. **`ContextPackageForm.tsx` = 901行 / useState 18本超の god component**。
   candidates 取得・選択状態・job lifecycle polling・download/copy・エラー詳細が
   1コンポーネントに同居。

6. **`importedSnapshotOrchestrator.ts`（577行）と uploadOrchestrator の並行進化**。
   `maskerSummaryFromDocument` vs `maskerSummaryFromPipeline`、
   ファイル名正規化ヘルパ群（`normalizeImported*` 3種）など、
   同型概念が2ファイルで別実装。

7. **`scripts/` 23本に常用と一回限りが混在**。
   常用 ops（`regenerateChunks` / `runCurator` / eval 系）と、
   一回限りの migration / 検証（`backfillSourceKind` / `recurateDocument` /
   `verifyP1fPayrollAcceptance` / `buildDeliveryE2ePackage` /
   `compareScanPdfGoldenSidecarToMainline`）の区別が命名にもREADMEにも無い。

8. **`docs/` 47ファイルにインデックス無し**。
   フェーズログを docs/ に置くのは CLAUDE.md 公認だが、「どれが正本で
   どれが歴史か」は記憶（MEMORY.md / 各docの相互参照）に依存。
   phase-2 〜 phase-4 の direction 系は大半が完了済みの歴史文書。

9. **poc/ ↔ src/ の片方向依存 + 移植コピー**。
   `src/lib/extractors/` は poc から移植（コメントで出自記録）、
   poc 側は逆に `src/` を import（`scanPdfGeminiOcr` 等は共有化済み）。
   依存は poc → src の一方向で違反ではないが、extract ロジックの一部が
   2箇所に存在しドリフト可能。`pnpm typecheck` が poc も検査するため
   src のリファクタが poc のビルドを壊し得る（結合コスト）。

10. **役割を終えた可能性のある feature flag**。
    `pdf-conversion-subtype-1/2/3` は Phase 3-H 完了済みパイプラインのゲートだが、
    flag 読み（Firestore read）が upload 毎に残る。退役判断が未実施。

### A-3. 原理原則の評価

| 原則 | 評価 | 根拠 |
|---|---|---|
| 単一責務 (SRP) | ✗ | 負債1, 4, 5（god module / route層ロジック / god component） |
| DRY | △ | 負債2, 6, 9（小ヘルパ重複・並行進化。大規模コピペは無し） |
| レイヤリング | △ | 負債3（eval→本番の向き逆転）、4（route→ドメイン漏れ）。それ以外の依存方向は健全 |
| 命名と実態の一致 | △ | 負債3（`eval/` の名前空間）、4（ヘッダコメント乖離） |
| YAGNI / 死蔵コード | △ | 負債7, 10。未使用 export の網羅検査は未実施（Phase 0 で knip 導入） |
| 型安全 | ✓ | `as any` 0件。Zod schema 境界が機能 |
| テスト容易性 | △ | 純関数抽出は進んでいるが、god module 内の private 関数はテスト不可で、テストが巨大ファイルに鏡像化 |
| 文書化 | ✓（過剰気味） | 意図コメント・決定記録は優秀。docs/ の構造化だけが欠落 |

---

## B. フェーズ計画

優先順位の原理: **(1) 安全・低コストで即効のもの → (2) P1-E が触る領域の整地 →
(3) 提出後でよい構造改善**。各フェーズは独立して merge 可能（checkpoint commit →
同 PR 続行スタイル）。

### Phase 0: 棚卸しと可視化（即時 / 半日 / リスクほぼゼロ）

コード挙動を一切変えない。

- [x] **`scripts/README.md` 新設**: 各スクリプトを `常用 ops` / `eval` /
      `一回限り（実施済み・日付付き）` に分類した表を置く。
- [x] **一回限りスクリプトの隔離**: 実施済み migration / 検証スクリプト
      （`backfillSourceKind` / `recurateDocument` / `verifyP1fPayrollAcceptance` /
      `buildDeliveryE2ePackage` / `compareScanPdfGoldenSidecarToMainline` /
      `verifyScanPdfUnmaskableFixture`）を `scripts/oneoff/` へ移動し、
      package.json の対応エントリを整理。git 履歴に残るので削除でも可だが、
      evidence doc から参照されているものは移動に留める。
- [x] **`docs/INDEX.md` 新設**: 「現役の正本」（next-actions / p1-d / operate-deliver-readiness /
      production-readiness / decisions / architecture / setup-gcp / firestore-schema）と
      「完了フェーズの歴史」（phase-2〜4 direction 系・smoke 系）を分けて一覧化。
      ファイル移動はしない（リンク切れ回避）。
- [x] **knip（または ts-prune）を devDependency に追加**し、未使用 export レポートを
      一度取得して結果を本ファイル末尾に追記。
      ※ `pnpm-workspace.yaml` の `minimumReleaseAge: 4320` に従い、
      公開3日以内のバージョンは入れない。

検証: `pnpm typecheck`（package.json 変更があるため）。

### Phase 1: 重複ヘルパの統合（即時 / 半日 / 低リスク）

- [x] `src/lib/firestoreTimestamps.ts` を新設し、`timestampToIso`（`string | undefined` 版に統一）
      と `timestampToDate` を移す。呼び出し5箇所
      （`inventoryFirestoreAdapter` / `conversionEvalStorage` / `chunkFirestoreAdapter` /
      `contextPackageJobs/firestoreAdapter` / `importedSnapshotOrchestrator`）を差し替え。
      `conversionEvalStorage` だけ戻り値が non-optional `string` なので、
      呼び出し側で fallback を明示する（暗黙挙動を変えない）。
- [x] knip レポートで確認した未使用 export の削除（自明なもののみ。判断が要るものは
      本ファイルに列挙して保留）。

検証: `pnpm typecheck` / `pnpm test`。

### Phase 2: `src/eval/` から本番ロジックを救出（P1-E 着手前 / 1日 / 中リスク）

**P1-E（大ファイル事前分割 + table fallback）は chunk 生成・extractor 周りを触るので、
その前にこの整地を済ませると P1-E の diff が素直になる。**

- [x] `src/eval/conversion/documentIrToKnowledgeChunk.ts` を
      `src/lib/conversion/documentIrToKnowledgeChunk.ts` へ移動
      （`documentIr.ts` の型定義も本番共用なら同様に移すか、依存方向を確認して判断）。
- [x] `src/eval/conversion/index.ts` から再 export を残し、scripts/ と eval 内部の
      import は当面壊さない（再 export には `@deprecated` JSDoc で移転先を明記）。
- [x] `uploadOrchestrator.ts` / `chunkRegenerator.ts` の import を新パスへ。
- [x] 移動後、`src/eval/` 直下に「このディレクトリは評価専用。本番経路から import
      しない」という README を1枚置き、向きの逆転を再発防止。

検証: `pnpm typecheck` / `pnpm test` / `pnpm build`（本番経路の import 変更のため）。

**Phase 2 実施メモ（2026-06-12）**:
- `documentIr.ts` は extractors / eval の双方から参照されるため `src/eval/conversion/` に残置。
  chunk 生成本体のみ `src/lib/conversion/` へ移動。
- `chunkRegenerator.ts` は当該 import なし（計画記載は upload 経路のみが本番依存だった）。
- 旧パス `src/eval/conversion/documentIrToKnowledgeChunk.ts` は `@deprecated` shim を残し、
  scripts / eval テストの import を維持。

### Phase 3: `uploadOrchestrator.ts` の分割（P1-E 着手前〜並行 / 1–2日 / 中リスク）

機械的な move-only 分割。ロジック・分岐・例外順序は1行も変えない。

- [x] `src/lib/uploadOrchestrator/` ディレクトリ化:
  - `firestoreDrafts.ts` — draft builder 群と draft 型（約400行）
  - `phases.ts` — `runCuratorPhase` / `runMaskerPhase` / `runCuratorAndMaskerLifecycle` /
    `CuratorPhaseError` / `MaskerPhaseError`
  - `pdfPath.ts` — `orchestratePdfPath` / `runPdfCuratorPhase` /
    `terminateRestrictedByUnmaskablePii` / `persistPdfHealthStageEval`
    （**D-PROD-1 safety gate を含む。コメントごと無傷で移す**）
  - `audit.ts` — `recordDocumentConvertAudit` / `recordConversionFailure` / `recordPhaseFailure`
  - `cleanup.ts` — `safeDelete*` 3関数
  - `orchestrate.ts` — `orchestrateUploadProcessing` / `transitionDocumentToCurating`
  - `types.ts` — 公開型（`OrchestrateInput` / `OrchestrateResult` 等）
  - `index.ts` — 既存の公開シンボルを全て再 export（**外部 import パスを
    変えない**。`from '../lib/uploadOrchestrator'` がそのまま解決される）
- [ ] テスト 1406行も同じ軸で `__tests__/` 配下に分割（describe 単位の機械移動）。
      ※ 現状 top-level `describe` が 1 本のため保留（任意）。
- [ ] 分割後に初めて見える「ファイル内 private だった関数」のうち、テスト価値が高いもの
      （`buildMaskerWriteBlockDraft` 等）は export してテストを足す（任意）。

検証: `pnpm typecheck` / `pnpm test` / `pnpm build`。
PR は move-only commit と（やるなら）テスト追加 commit を分ける。

**Phase 3 実施メモ（2026-06-12）**: 1639行の単一ファイルを 8 ファイルに move-only 分割。
`uploadOrchestrator.ts` を削除し `uploadOrchestrator/index.ts` がモジュール解決の入口。
テスト分割・private 関数の新規 export は任意タスクとして保留。

### Phase 4: route 層からの extraction dispatch 退避（P2 前後 / 1日 / 低〜中リスク）

- [x] `PDF_SUBTYPE_PRE_FLIGHT_CONFIGS` と subtype 判定・feature flag 分岐を
      `src/lib/extractors/pdfExtractionDispatcher.ts`（仮）へ移し、
      route.ts はヘッダコメントの宣言どおり「formData 検証 → dispatch 委譲 →
      レスポンス整形」だけにする。
- [x] dispatcher は純関数 + 注入依存（flag reader）にして単体テストを新設。
      route.test.ts（1099行）のうち dispatch 関連ケースを dispatcher 側へ移管。

検証: `pnpm typecheck` / `pnpm test` / `pnpm build`。

**Phase 4 実施メモ（2026-06-12）**: `dispatchPdfExtraction` + `createFirestorePdfFlagReader`
を `src/lib/extractors/pdfExtractionDispatcher.ts` に集約。route は失敗を HTTP へ
マップするのみ。dispatch 詳細テストは `pdfExtractionDispatcher.test.ts` へ移管し、
`route.test.ts` の PDF ブロックは HTTP 境界の薄い統合テストに縮小。

### Phase 5: 提出後（2026-07-10 以降）に回す構造改善

提出前にやらない理由: デモ採点に直結せず、UI/orchestrator はデモ磨き（P2）で
触る可能性があり、並行変更の衝突コストが利得を上回る。

- [ ] **`ContextPackageForm.tsx` 分解**: `useCandidates` / `useContextPackageJob` /
      `useExportActions` の3カスタムフック + 表示コンポーネント数枚へ。
      18本の useState を関心ごとの reducer に畳む。
- [ ] **orchestrator 2系統の共通化**: `importedSnapshotOrchestrator` と
      `uploadOrchestrator` の同型部分（masker summary 構築、終端 status 遷移）を
      共有モジュールへ。Phase 3 の分割が済んでいれば差分が見えやすい。
- [ ] **poc/ の扱い決定**（コードでなく判断）:
      案A = 現状維持（typecheck 結合を許容） / 案B = poc を typecheck から外し
      「凍結アーカイブ」と README 宣言 / 案C = 共有部分を完全に src へ吸収し poc 削除。
      推奨は **B**（P1-E で scan-pdf poc を再利用する可能性が残るため削除は早い。
      ただし src リファクタの度に poc が壊れる結合は切る）。
- [ ] **feature flag 退役判断**: `pdf-conversion-subtype-1/2/3` が全テナント恒久 ON なら
      flag 読みを削除し、`FEATURE_FLAG_IDS` を空に戻す（Firestore read 削減 +
      死分岐除去）。本番 Firestore の flag document 現値を確認してから。
- [ ] **docs/ アーカイブ移動**: INDEX.md（Phase 0）運用が安定したら、
      歴史文書を `docs/archive/` へ実際に移動し相互リンクを修正。

### 明示的に「やらない」こと

- Firestore adapter 4本の統一 framework 化 — 各 adapter の差異（collection 構造・
  serialize 形）は本質的で、抽象化は早すぎる。timestamp ヘルパ統合（Phase 1）で十分。
- `sensitivitySource` enum 拡張などスキーマ波及を伴う整理 — 既に「inventory 波及回避で
  広げない」と決定済み（D-PROD-1）。リファクタの名目で蒸し返さない。
- テスト基盤の置き換え・lint ルール大量追加 — 861件 green の資産を提出前に揺らさない。

---

## C. 実施順序と機能計画との噛み合わせ

```
今すぐ        : Phase 0（棚卸し）→ Phase 1（重複統合）   … 合計1日、いつでも中断可
P1-E 着手前   : Phase 2（eval 救出）→ Phase 3（orchestrator 分割）
                ※ P1-E の diff を素直にするための整地。P1-E が先に走り出したら
                  Phase 3 は P1-E 完了後に繰り下げ（衝突回避が優先）
P2 期間中     : Phase 4 は余力があれば。なければ提出後
提出後        : Phase 5 全部
```

## D. knip レポート

### D-1. Phase 0 初回スナップショット（2026-06-12）

`knip@6.16.1`（公開 2026-06-06、`minimumReleaseAge` 準拠）。`pnpm knip`（デフォルト設定）。

| カテゴリ | 件数 |
|---|---|
| Unused files | 9 |
| Unused exports | 182 |
| Unused exported types | 139 |

Phase 1 で `src/agents/strategist/types.ts` 削除・`exportConversionEvalSamples` の file-private 化後、
件数は D-2 へ低下。以降の正本は **D-2（最新）**。

### D-2. 最新スナップショット（2026-06-12、Phase 0〜4 完了後）

`pnpm knip --reporter compact`（デフォルト設定・entry 自動検出なし）。

| カテゴリ | 件数 | 備考 |
|---|---|---|
| Unused files | 8 | 下表参照。`oneoff/`・CI 専用 script は手動 entry のため false positive 多い |
| Unused exports | 42 | Phase 1 削除後に大幅減。残りは eval barrel / poc adapter が大半 |
| Unused exported types | 42 | 同上 |
| Unused dependencies | 0 | — |
| Unused devDependencies | 0 | — |

### Unused files（8）— 判断メモ

| ファイル | knip 判定 | 判断 |
|---|---|---|
| `scripts/oneoff/*`（6件中 knip が5件検出） | unused | **保留** — 手動 entry。`verifyScanPdfUnmaskableFixture` は `package.json` 経由で entry 扱い |
| `scripts/runConversionEvalForCi.ts` | unused | **保留** — CI workflow から `tsx` 直接起動 |
| `scripts/regenerateScanPdfGoldenSidecars.ts` | unused | **保留** — 手動 golden 再生成 |
| `poc/.../generate-synthetic-unmaskable-pii-scan.ts` | unused | **保留** — fixture 生成用 |
| ~~`src/agents/strategist/types.ts`~~ | — | **削除済（Phase 1）** |

### Unused exports — パターン別サマリ（削除候補の優先度付け用）

1. **`src/eval/conversion/index.ts` barrel** — schema 定数・型の re-export が外部未参照（eval 内部・scripts 直 import が多い）
2. **`poc/document-conversion/**`** — PoC adapter / eval helper（本番 `src/` とは分離。削除対象外）
3. **Zod `*Schema` export** — runtime では `parse*` のみ使用、schema 自体は未 import（型推論・テスト用として意図的な可能性）
4. **`src/services/strategistOrchestrator/index.ts` type re-export** — 公開 API 型。knip は barrel 経由の間接参照を見落としやすい
5. **`scripts/exportConversionEvalSamples.ts` 内部 helper** — ファイル内 private 化候補（`timestampToIsoOrNull` 等）

Phase 1 では「自明なもののみ」削除。上記 3・4 は判断保留リストへ。

### Phase 1 で実施した削除（2026-06-12）

| 対象 | 理由 |
|---|---|
| `src/agents/strategist/types.ts` | `schema.ts` への再 export のみ。import 参照ゼロ |
| `scripts/exportConversionEvalSamples.ts` の `export` 3関数 | 同一ファイル内利用のみ。`export` を外して file-private 化 |
