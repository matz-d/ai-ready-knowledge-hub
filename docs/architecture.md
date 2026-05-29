# システムアーキテクチャ

## 現在の実装状態 (2026-05-08)

W1 で Curator / Masker の Genkit flow、A9 Markdown export、Cloud Run デプロイ検証まで完了。
W2 Walking Skeleton として `/upload` → `POST /api/documents` で、multipart 検証のあと
`orchestrateUploadProcessing`（`src/lib/uploadOrchestrator.ts`）が原本を Cloud Storage
(`raw/{docId}/{safeOriginalFileName}`)、メタデータを Firestore (`documents/{docId}`) に
書き、`curatorFlow` と必要時 `maskerPipelineFlow` までを同一リクエスト内で完結させ、
結果を UI に返す経路を実装済み。

MVP のマスク処理はルールベースの `SimpleMasker` とし、プロバイダ境界だけを固定しておき、将来 Cloud DLP に差し替え可能にする。
Task2 で `SimpleMasker` → 既存 `maskerRiskFlow` → `ai_safe_ready` / `restricted_promoted`
の pipeline を実装し、実 Vertex 接続でサンプル 2 件の期待挙動を確認済み。

Task3 で Masker の `Restricted` 昇格を文書メタデータへ反映する純関数と、Context Package
入力ビルダを実装済み。W1 snapshot を読み取り時に適用し、Restricted 文書の本文が
`Full AI-Ready Sources` に入らないことを `npm run context:demo` で確認済み。

### HTTP API: `/api/documents` と `/api/curator`

- **`POST /api/documents`**: ブラウザの `/upload` UI から呼ぶ。HTTP 境界では multipart の
  パースと検証（ファイル数・サイズ・拡張子・MIME・UTF-8 または XLSX 解析・必須環境変数）のみ行い、
  副作用の順序はすべて `uploadOrchestrator` に委ねる。
- **`POST /api/curator`**: **UI の upload flow からは使わない。** Curator flow 単体の
  curl / eval / smoke 用 route。評価・疎通確認に残す。本番の upload 縦串は常に
  `/api/documents` → `uploadOrchestrator` を通る。

#### Upload flow（`POST /api/documents` → `uploadOrchestrator`）

```text
[A] HTTP boundary
    /api/documents parses multipart formData, validates file count, size,
    extension, MIME, UTF-8 or XLSX parsing, and required env.

[B] Raw object upload
    orchestrator uploads the original file to GCS:
    raw/{docId}/{safeOriginalFileName}

[C] Firestore initial set
    orchestrator creates the document metadata with status='uploaded'.
    If this fails, raw GCS object is deleted.

[D] Firestore curating transition
    orchestrator updates status='curating'.
    If this fails, raw GCS object and Firestore document are rolled back.

[E] Curator phase
    orchestrator calls curatorFlow and derives:
    direct -> curated
    blocked -> blocked
    requires_masking -> masking

[F] Curator terminal or masking handoff
    curated / blocked are written to Firestore and returned.
    masking continues into Masker.

[G] Masker phase
    orchestrator calls maskerPipelineFlow only when status='masking'.
    ai_safe_ready uploads masked object first, then updates Firestore to ai_safe.
    If Firestore update fails after masked upload, masked object is deleted.
    restricted_promoted updates Firestore to restricted without creating a masked object.

[H] HTTP response
    /api/documents serializes curated / blocked / ai_safe / restricted results
    for the UI. Curator or Masker failures return docId when available.
```

未実装の主要部分は Cloud DLP 統合、Strategist / Interviewer、Knowledge Inventory の実
Firestore 一覧・詳細 UI、GitHub Actions eval の強化などである。

### Task2: Masker Pipeline MVP

`src/agents/masker/pipelineFlow.ts` は、Curator の `aiUsePolicy === 'requires_masking'`
を入口条件として、原本テキストを `SimpleMasker` でマスクし、その結果を既存
`maskerRiskFlow` に渡す。

- `src/agents/masker/maskingSchema.ts` … `MaskingInput` / `MaskedSpan` / `MaskingResult` / `AiSafeVersion`
- `src/agents/masker/simpleMasker.ts` … 決定的なルールベースマスク + SHA-256 hash
- `src/agents/masker/pipelineSchema.ts` … `ai_safe_ready` / `restricted_promoted` の出力 schema
- `src/agents/masker/pipelineFlow.ts` … SimpleMasker → residual risk → 分岐
- `scripts/runMaskerPipeline.ts` … CLI smoke (`npm run masker:pipeline -- <path>`)

Upload 経路では `uploadOrchestrator` が `requires_masking` のときのみ `maskerPipelineFlow`
を呼ぶ（上記 [G]）。**PDF**（`documentIr` あり）は text と同じ Masker 終端だが、DocumentIR 保存・conversion eval・audit の後に Masker を実行し、`ai_safe` 時は `documentIrToKnowledgeChunks` → 逐次 `maskKnowledgeChunk` → `replaceChunksForDocument` まで行う（`D-P3-M-PDF-1`）。

### Task3: Restricted 昇格と Context Package 除外（純関数）

Masker の `recommendedSensitivity === 'Restricted'` を文書メタデータへ反映し（`sensitivity` /
`aiUsePolicy` / `sensitivitySource` / `originalCuratorSensitivity` / `sensitivityReason`）、
`exportContextPackageMarkdown` に渡す前に Context Package 入力ビルダで必ず除外する。

- `src/agents/masker/upgrade.ts` … `applyMaskerUpgrade` / `isBlockedForAi` / `needsMaskerEvaluation` 等
- `src/lib/inventory.ts` … W1 `inventory.snapshot.json` を **読み取り時** に `InventoryDocument` へ変換（JSON 改変なし）
- `src/lib/contextPackageInput.ts` … `ContextPackageExportInput` 組み立て（Restricted・未マスク機密の二重防止）
- `src/agents/strategist/types.ts` … 将来の Strategist 戻り値の型スタブ
- 検証: `npm run context:demo`（CLI）、トップ画面の W1 適用デモ（Firestore ライブ同期ではない）

### W2 MVP: Firestore `documents/{docId}` と GCS レイアウト

正本仕様は [docs/firestore-schema.md](firestore-schema.md)。本セクションでは要点だけ示す。

**Document shape の方針 (D-W2-Schema):**

- Effective top-level (`sensitivity` / `aiUsePolicy` / `sensitivitySource` / `originalCuratorSensitivity` / `sensitivityReason`) は Inventory クエリの主役。
- 生データは `curator` / `masker` ブロックに不変記録として保持。Masker 昇格があっても `curator.sensitivity` は書き換えない。
- マスク済み本文は GCS `masked/{docId}/{safeOriginalFileName}` が正本。Firestore は `aiSafeStoragePath` パスのみ保持。
- `contentSha256` を `uploaded` 時に書き、Masker の `sourceContentHash` と照合できるようにする。

**Lifecycle state machine:**

```
        uploaded
            │
            ▼
        curating ──── (curator 失敗) ────► failed
            ├──── aiUsePolicy === 'direct' ───────────────► curated
            ├──── aiUsePolicy === 'blocked' ──────────────► blocked
            └──── aiUsePolicy === 'requires_masking' ─────► masking
                                                              │
                                                              ├── (masker 失敗) ─► failed
                                                              ├── ai_safe_ready ─► ai_safe
                                                              └── restricted_promoted ─► restricted
```

終端は 5 つ: `curated`（Curator だけで AI 参照可）/ `blocked`（Curator 時点で AI 参照不可）/ `ai_safe`（Masker 後に AI 参照版あり）/ `restricted`（Masker 後に Restricted 昇格）/ `failed`（Curator か Masker が失敗、成功側のブロックは保持）。

**Cloud Storage レイアウト:**

```
gs://{KNOWLEDGE_HUB_BUCKET}/
  raw/{docId}/{safeOriginalFileName}     # 原本
  masked/{docId}/{safeOriginalFileName}  # ai_safe_ready 時のみ
```

`docId` は UUID、`safeOriginalFileName` はパス区切りを除去した表示用ファイル名（最大 200 文字）。`restricted_promoted` のときは masked オブジェクトを作らない。

## 全体構成図

```
┌─────────────────────────────────────────────────────────────┐
│ Browser (Next.js App Router on Cloud Run)                   │
│  - Dump Box (file upload)                                   │
│  - Inventory Map (heatmap, 業務領域 × 文書種別)             │
│  - Purpose Query Console                                    │
└─────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ Next.js Server Actions / Route Handlers                     │
│  - POST /api/documents: multipart 検証 → uploadOrchestrator │
│    (GCS / Firestore / Curator / Masker の順序・rollback)    │
│  - POST /api/curator: Curator 単体 smoke（UI upload 非経路） │
│  - Run Strategist + Interviewer Agent on demand (将来)     │
└─────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ Agent Layer (Genkit TypeScript)                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐ ┌────────────┐  │
│  │ Curator  │→│ Masker   │→│ Strategist   │→│ Interviewer│  │
│  │ (分類)   │ │ (マスク) │ │ (目的→計画)  │ │ (質問生成) │  │
│  └──────────┘ └──────────┘ └──────────────┘ └────────────┘  │
│       ▲            │              │                │         │
│       │ 逆feedback │              │                │         │
│       │ 機密度格上げ│              ▼                ▼         │
│       └────────────┘          Vertex AI         Vertex AI     │
│                               (Gemini           (Gemini       │
│       │            │          2.5 Flash)        2.5 Flash)    │
│       ▼            ▼              │                           │
│   Vertex AI    Cloud DLP          ▼                           │
│   (Gemini      + Vertex AI    Context Package                 │
│   2.5 Flash)   (Gemini)           │                           │
│                                   ▼                           │
│                              Markdown Export (A9)             │
└─────────────────────────────────────────────────────────────┘

Masker → Curator の逆矢印 (A8): Masker が `recommendedSensitivity: "Restricted"`
を返した場合、Curator が管理する文書 metadata の機密度を Restricted に格上げする。
Strategist は格上げ済み文書を Context Package から自動除外する。
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ Data Layer                                                  │
│  - Cloud Storage: 原本オブジェクト raw/…、AI 参照用マスク済  │
│    オブジェクト masked/…（ai_safe のときのみ。正本は GCS）   │
│  - Firestore: 文書メタデータ・Curator/Masker 監査ブロック・ │
│    tags。本文・マスク済み本文は Firestore に持たず、        │
│    GCS パス参照（例: aiSafeStoragePath）とハッシュのみ      │
│  - MVPではタグ検索を使用 (Vector embeddings は将来拡張)   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ DevOps Layer (まわす)                                       │
│  - GitHub Actions: deploy to Cloud Run on main push         │
│  - GitHub Actions: Curator簡易eval on PR                    │
│    - ground truth set vs 実際のCurator出力                  │
│    - Masker eval / PII precision-recall は将来拡張          │
└─────────────────────────────────────────────────────────────┘
```

---

## 4エージェントの責務

### Curator Agent
**入力**: アップロード文書 (PDF/text/md/CSV)

**出力** (構造化):
- 文書種別 (契約書、テンプレ、案内文、メモ、表 etc)
- 業務領域 (給与計算、年末調整、就業規則、契約 etc)
- 機密度 (Public / Internal / Confidential / Restricted)
- 鮮度 (現行 / 旧版候補)
- 正本候補フラグ (重複候補)
- AI利用方針 (機密度から自動派生)

**自律的判断**:
- 文書要旨を読んで業務領域を判定
- 同名・近似タイトルの既存文書をFirestoreで検索 → 重複判定
- 日付メタデータ + 内容から鮮度判定

### Masker Agent
**入力**: Curator が **`aiUsePolicy === 'requires_masking'`** に振った文書の原本テキスト（`maskerPipelineFlow` の入口と一致。Walking Skeleton では主に機密度 `Confidential`）。**`Restricted` は Curator 時点で AI 参照不可のため Masker には渡さず**、`blocked` などで終端する。

**処理 (三段)**:
1. **Cloud DLP** で構造化PII検出
   - JAPAN_INDIVIDUAL_NUMBER (マイナンバー)
   - JAPAN_BANK_ACCOUNT
   - JAPAN_PASSPORT
   - JAPAN_DRIVERS_LICENSE_NUMBER
   - JP_PHONE_NUMBER
   - PERSON_NAME, EMAIL_ADDRESS 等
2. **Vertex AI (Gemini)** で文脈依存PII判定
   - 「特定顧客との具体的取引内容」
   - 「内部判断基準が露呈する記述」
3. **Vertex AI (Gemini)** で残存リスク再評価 (A8)
   - マスク後の文章を入力に、「特定企業・特定取引・特定個人が再識別可能か」を判定
   - 再識別リスクが残ると判定された場合、`recommendedSensitivity: "Restricted"` を返す

**出力**:
```ts
type MaskerOutput = {
  maskedContent: string;
  maskedSpans: Array<{ start: number; end: number; type: string }>;
  residualRisk: {
    detected: boolean;
    reasons: string[];          // 例: "顧客固有の契約条件が再識別可能"
  };
  recommendedSensitivity: "Confidential" | "Restricted";
};
```

**逆feedback (A8):**
`recommendedSensitivity === "Restricted"` の場合、Firestore の文書 metadata の機密度を
`Restricted` に更新する。この更新は Masker が Curator の判定を覆す挙動であり、
4エージェントの協調を成立させる中核的な自律判断点。

### Strategist Agent
**入力**: ユーザの目的 (自然言語)

**処理**:
1. 目的を分解 (誰が、何を、どう使うか)
2. Inventory から候補文書を検索 (MVPではタグ検索 + LLM選定)
3. AI参照版がある文書はそちらを優先
4. 候補を「使える」「除外」に分類
5. 不足領域を判定 → Interviewer を呼ぶ

**出力 (Context Package)**:
- 使える情報 (理由付き)
- 除外すべき情報 (理由付き)
- 足りない情報 (領域)
- Interviewer への質問依頼

### Interviewer Agent
**入力**: 不足領域 + 既存文書からの文脈

**処理**:
- 暗黙知が必要そうなポイントを抽出
- 質問を生成
- 回答を受けて追加質問を判断 (将来拡張)

**MVP実装メモ:**
内部実装は Strategist flow 内の質問生成ステップでよい。画面上は Interviewer Agent の出力として見せる。

**出力**:
- 質問リスト (3〜7個程度)

---

## データフロー (典型的なユースケース)

### Case 1: ファイルアップロード時

Walking Skeleton の実装順序は `POST /api/documents` の [A]–[H] と一致する。概念的には次の通り。

```
User → /upload → POST /api/documents
    [A] multipart 検証（件数・サイズ・拡張子・MIME・UTF-8 または XLSX 解析・env）
    [B] uploadOrchestrator → GCS raw/{docId}/{safeOriginalFileName}
    [C] Firestore documents/{docId} 初期作成 (status=uploaded)
        （失敗時: raw オブジェクト削除）
    [D] status=curating へ更新
        （失敗時: raw 削除 + Firestore ドキュメント削除）
    [E] curatorFlow → direct | blocked | requires_masking
    [F] curated / blocked → Firestore 書き込み → レスポンス返却
        requires_masking → status=masking のまま [G] へ
    [G] maskerPipelineFlow（masking のときのみ）
        ai_safe_ready → GCS masked を先に作成 → Firestore を ai_safe に更新
            （Firestore 失敗時: masked オブジェクト rollback delete）
        restricted_promoted → masked オブジェクトは作らず Firestore を restricted に更新
    [H] Route Handler が curated / blocked / ai_safe / restricted を UI 向けに直列化
        （Curator / Masker 失敗時は docId を返せる範囲で含める）

将来: Cloud DLP + Vertex の本格マスキングは同じ orchestrator フェーズ [G] に差し替え可能。
```

### Case 1b: PDF アップロード（`documentIr` あり、`D-P3-M-PDF-1`）

text 経路（Case 1）の [A]–[D] は同じ。以降 `orchestratePdfPath` に分岐する。

```
[E] runPdfCuratorPhase
    direct / blocked → 既存どおり curated / blocked 終端（direct は chunk 化）
    requires_masking → status=curating のまま（maskingPending は立てない）
[F] writeDocumentIrSnapshot (GCS)
[G] persistPdfHealthStageEval + document.convert audit
[H] requires_masking のみ runMaskerPhase（text 経路と同型）
    ai_safe_ready → masked GCS + Firestore ai_safe
        → documentIrToKnowledgeChunks(requires_masking)
        → maskKnowledgeChunk をチャンクごと逐次（chunkRegenerator 同型）
        → replaceChunksForDocument
    restricted_promoted → chunk 化なし
失敗:
    maskerPipeline / per-chunk mask → maskerError（MaskerPhaseError、conversionError と二重記録しない）
    post-ai_safe の chunk 保存 → conversionError + masked GCS 削除 + aiSafeStoragePath=null
```

H-3 以前の `curated + maskingPending: true` park は新規 upload では使わない（レガシー行のみ inventory で許容）。

### Case 2: Purpose Query 実行時

```
User → Purpose Query 入力
    → Strategist Agent 起動
        → 目的分解
        → Firestore で候補文書検索 (MVPでは tag filter)
        → Restricted 文書は自動除外 (A8 の格上げ結果を尊重)
        → Curator/Masker結果を考慮し取捨選択
        → Context Package 組み立て
        → 不足判定 → Interviewer Agent 起動
            → 質問生成
    → Context Package + 質問 を UI に返す
    → User が [Export as Markdown] ボタンを押下 (A9)
        → src/lib/exportContextPackage.ts 経由でMarkdown文字列を生成
        → Excluded セクションに Restricted 文書名を理由付きで列挙 (本文は含めない)
        → Included セクションに ai_safe_version 本文を inline で含める
        → ブラウザにダウンロードを返す
```

---

## DevOps (まわす)

### CI/CD
- `main` ブランチへのpush → GitHub Actions → Cloud Run へ自動デプロイ
- 環境変数は GitHub Secrets + Workload Identity Federation 経由 (Cloud Run側で参照)

### Curator 簡易評価パイプライン
PRオープン時に GitHub Actions が実行:

```
sample-data/accounting-office/ の文書群
    → Curator Agent 実行
        → 出力を eval/expected-labels.json と比較
        → 各タグカテゴリの precision/recall/F1 を計算
    → 結果を PR コメントに投稿
    → 閾値割れたら CI 失敗
```

MVP評価対象:
- Curator: 文書種別 / 業務領域 / 機密度 / 鮮度 / AI利用方針 / 正本候補

将来拡張:
- Masker: PII検出位置の precision/recall

### 比較ベンチマーク
`openai/privacy-filter` (英語OSS) と日本語マイナンバー検出率を比較し、`eval/benchmark/` に結果を出力。発表資料の根拠データに使う。ただしMVPでは後回し。

---

## ディレクトリ構成

### 現在

```
.
├── README.md
├── CLAUDE.md
├── package.json
├── next.config.ts
├── docs/
│   ├── architecture.md
│   ├── concept.md
│   ├── decisions.md
│   ├── demo-scenario.md
│   ├── hackathon.md
│   ├── open-questions.md
│   ├── scope.md
│   ├── setup-gcp.md
│   ├── tech-stack.md
│   ├── week1-retrospective.md
│   └── w1-artifacts/
│       └── inventory.snapshot.json
├── scripts/
│   ├── generateInventorySnapshot.ts
│   ├── loadEnv.ts
│   ├── runCurator.ts
│   ├── runCuratorAll.ts
│   └── runMaskerRisk.ts
├── src/
│   ├── agents/
│   │   ├── _shared/genkitClient.ts
│   │   ├── curator/{schema,prompt,flow}.ts
│   │   └── masker/{schema,prompt,flow,pipelineFlow,simpleMasker,upgrade}.ts
│   ├── app/
│   │   ├── api/
│   │   │   ├── curator/route.ts    # Curator 単体 smoke（UI upload 非経路）
│   │   │   └── documents/route.ts  # upload UI → orchestrator
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── styles.css
│   └── lib/
│       ├── uploadOrchestrator.ts   # GCS / Firestore / Curator / Masker 順序
│       └── exportContextPackage.ts
└── sample-data/
    ├── accounting-office/
    └── masked/
```

### MVP 完成時の予定

```
.
├── README.md
├── LICENSE                          # Apache 2.0
├── .gitignore
├── package.json
├── tsconfig.json
├── next.config.ts                  # Cloud Run 用 standalone 出力
├── .github/
│   └── workflows/
│       ├── deploy.yml               # Cloud Run デプロイ
│       └── eval.yml                 # Curator簡易評価
├── docs/
│   ├── concept.md
│   ├── scope.md
│   ├── demo-scenario.md
│   ├── hackathon.md
│   ├── architecture.md
│   ├── tech-stack.md
│   ├── decisions.md
│   ├── open-questions.md
│   └── w1-artifacts/
├── src/
│   ├── app/                         # Next.js App Router
│   ├── components/
│   ├── lib/
│   │   ├── firestore.ts
│   │   ├── storage.ts
│   │   ├── dlp.ts
│   │   └── exportContextPackage.ts   # A9: Markdown export
│   └── agents/                      # Genkit flows
│       ├── _shared/
│       ├── curator/
│       ├── masker/
│       ├── strategist/
│       └── interviewer/
├── sample-data/
│   └── accounting-office/
└── eval/
    ├── expected-labels.json
    ├── run-curator-eval.ts
    └── benchmark/
        └── compare-with-privacy-filter.ts # 将来拡張
```

---

## 関連ドキュメント

- [docs/tech-stack.md](tech-stack.md) — 個別技術の詳細
- [docs/decisions.md](decisions.md) — なぜこの構成か
- [docs/concept.md](concept.md) — エージェント設計の背景
