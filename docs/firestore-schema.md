# Firestore document schema (`documents/{docId}`)

W2 MVP で `/upload` から始まる Walking Skeleton が書き込む Firestore document の正本仕様。
本ファイルは `src/lib/firestoreSchema.ts`（実 TS 型）と一対一で対応させる。スキーマを変更したら必ず両方を同時に更新する。

関連: [docs/architecture.md](architecture.md) / [docs/decisions.md](decisions.md) (D-W2-Schema)

---

## 設計原則

1. **effective top + audit block 分離**: 「現在 AI に渡してよいか」の判断材料は document トップレベルに置き、Curator / Masker の生データは `curator` / `masker` ブロックに不変記録として保持する。Inventory クエリ (`where sensitivity == 'Restricted'`) と監査トレース (「Curator が当初どう判定したか」) の責務を分離する。
2. **maskedContent は GCS が正本**: Firestore document には保存せず、`masked/{docId}/{safeOriginalFileName}` のパスのみ持つ。Firestore document の 1 MiB 上限に張り付くリスクを避ける。
3. **Masker 昇格は不可逆**: 一度 `sensitivitySource: 'masker'` になった document を Curator 値に戻す経路は持たない（A8 と整合）。
4. **status='failed' は一本化**: Masker pipeline 失敗時も `status='failed'` に倒す。`curator` ブロックは成功記録として保持され、`maskerError` ブロックに失敗詳細が残る。UI 側で「Curator 成功・Masker 失敗」を組み立てる。
5. **終端 status は扱い方を表す**: `curated` は Curator だけで AI 参照可、`blocked` は Curator 時点で AI 不可、`ai_safe` は Masker 後に AI 参照版あり、`restricted` は Masker 後に AI 不可へ昇格、を意味する。
6. **source metadata と保存名を分離する**: `externalSource.name` は Drive 等の原本名、`fileName` は document の表示・処理名、`storagePath` は GCS object key。Google Sheets import では API 成功レスポンスも Firestore に保存した `fileName` を返し、`storagePath` や API body の `displayName` から推測しない。

---

## TypeScript 型（正本）

```ts
import type { Timestamp } from '@google-cloud/firestore';
import type {
  AiUsePolicy,
  BusinessDomain,
  DocumentType,
  Freshness,
  Sensitivity,
} from '../agents/curator/schema';

export const FIRESTORE_DOCUMENT_SCHEMA_VERSION = 1 as const;

export type FirestoreDocumentStatus =
  | 'uploaded'   // GCS 保存・Firestore set 直後
  | 'curating'   // Curator flow 実行中
  | 'masking'    // Curator 成功・Masker pipeline 実行中
  | 'curated'    // Curator 完了・AI 参照可 (direct) の終端
  | 'blocked'    // Curator 完了・AI 参照不可 (blocked) の終端
  | 'ai_safe'    // Masker 完了・AI 参照版あり (ai_safe_ready) の終端
  | 'restricted' // Masker 完了・Restricted 昇格 (restricted_promoted) の終端
  | 'failed';    // どこかで失敗。詳細は curatorError / maskerError ブロック

export type FirestoreSourceKind = 'upload' | 'google_workspace';

export type FirestoreExternalSource = {
  provider: 'google_drive';
  workspaceMimeType: 'application/vnd.google-apps.spreadsheet';
  fileId: string;
  name: string;                  // Drive 上の原本名
  webViewLink?: string;
  modifiedTime?: string;
  importedAt: string;
  exportedAt: string;
  exportMimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
};

export type FirestoreDocument = {
  // ── identity ───────────────────────────
  id: string;
  schemaVersion: typeof FIRESTORE_DOCUMENT_SCHEMA_VERSION;
  fileName: string;                    // document の表示・処理用名
  contentType: string;
  byteSize: number;
  contentSha256: string;               // upload raw bytes または imported snapshot bytes の SHA256
  sourceKind: FirestoreSourceKind;
  externalSource: FirestoreExternalSource | null;
  storagePath: string;                 // raw/{docId}/{safeOriginalFileName}
  aiSafeStoragePath: string | null;   // masked/{docId}/{safeOriginalFileName}（ai_safe_ready のみ）

  // ── lifecycle ──────────────────────────
  status: FirestoreDocumentStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;

  // ── effective evaluation (top-level, クエリ対象) ─
  // Curator 完了時に Curator 値で初期化され、Masker Restricted 昇格時に Masker 値で上書きされる。
  // どちらが書いたかは sensitivitySource で識別する。
  documentType: DocumentType | null;
  businessDomain: BusinessDomain | null;
  sensitivity: Sensitivity | null;
  freshness: Freshness | null;
  isAuthoritativeCandidate: boolean | null;
  aiUsePolicy: AiUsePolicy | null;
  sensitivitySource: 'curator' | 'masker' | null;
  originalCuratorSensitivity: Sensitivity | null;  // Masker 昇格時のみ非 null
  sensitivityReason: string | null;                // Masker 昇格理由

  // ── audit blocks (生データ・追跡用) ────
  curator: {
    documentType: DocumentType;
    businessDomain: BusinessDomain;
    sensitivity: Sensitivity;        // Curator が出した生の判定（Masker が上書きしても残る）
    freshness: Freshness;
    isAuthoritativeCandidate: boolean;
    aiUsePolicy: AiUsePolicy;
    rationale: string;
    completedAt: Timestamp;
    modelId: string;
  } | null;
  curatorError: { message: string; occurredAt: Timestamp } | null;

  masker: {
    decision: 'ai_safe_ready' | 'restricted_promoted';
    provider: 'simple-rule';                       // 将来 'cloud-dlp' に拡張
    maskedSpansCount: number;                      // UI 表示用の集計
    ruleHits: Record<string, number>;              // どのルールが何回当たったか
    residualRisk: { detected: boolean; reasons: string[] };
    rationale: string;
    recommendedSensitivity: 'Confidential' | 'Restricted';
    sourceContentHash: string;                     // 上の contentSha256 と一致するはず
    aiSafeSchemaVersion: 1;                        // src/agents/masker/maskingSchema.ts の AiSafeVersion.schemaVersion と整合
    completedAt: Timestamp;
    modelId: string;                               // residualRisk 評価に使った Vertex モデル
  } | null;
  maskerError: { message: string; occurredAt: Timestamp } | null;
};
```

---

## Lifecycle state machine

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

終端は 5 つ:

- `curated`: Curator が `aiUsePolicy === 'direct'` を返し、原文のまま AI 参照可
- `blocked`: Curator が `aiUsePolicy === 'blocked'` を返し、Masker pipeline をスキップして AI 参照不可
- `ai_safe`: Masker pipeline が `ai_safe_ready` を返し、GCS に AI 参照版がある
- `restricted`: Masker pipeline が `restricted_promoted` を返し、AI 参照不可へ昇格
- `failed`: Curator または Masker のいずれかが失敗（成功側のブロックは保持）

---

## 終端ごとの具体例

### Case A: aiUsePolicy='direct'（Masker skip → terminal: `curated`）

```ts
{
  id: '...',
  schemaVersion: 1,
  fileName: '就業規則テンプレート.md',
  contentType: 'text/markdown',
  byteSize: 1234,
  contentSha256: 'abc...',
  sourceKind: 'upload',
  externalSource: null,
  storagePath: 'raw/<uuid>/就業規則テンプレート.md',
  aiSafeStoragePath: null,
  status: 'curated',
  documentType: '規程',
  businessDomain: '就業規則',
  sensitivity: 'Internal',
  freshness: 'current',
  isAuthoritativeCandidate: true,
  aiUsePolicy: 'direct',
  sensitivitySource: 'curator',
  originalCuratorSensitivity: null,
  sensitivityReason: null,
  curator: { /* 同じ値 + rationale + completedAt + modelId */ },
  curatorError: null,
  masker: null,
  maskerError: null,
}
```

### Case B: aiUsePolicy='blocked'（Masker skip → terminal: `blocked`）

```ts
{
  // ...
  aiSafeStoragePath: null,
  status: 'blocked',
  sensitivity: 'Restricted',
  aiUsePolicy: 'blocked',
  sensitivitySource: 'curator',
  originalCuratorSensitivity: null,
  sensitivityReason: null,
  curator: { sensitivity: 'Restricted', aiUsePolicy: 'blocked', /* ... */ },
  masker: null,
  maskerError: null,
}
```

### Case C: requires_masking → ai_safe_ready（terminal: `ai_safe`）

```ts
{
  // ...
  aiSafeStoragePath: 'masked/<uuid>/顧客対応メモ_匿名化.txt',
  status: 'ai_safe',
  documentType: 'メモ',
  businessDomain: '顧客対応',
  sensitivity: 'Confidential',         // top は Confidential のまま
  aiUsePolicy: 'requires_masking',
  sensitivitySource: 'curator',        // 昇格なし
  originalCuratorSensitivity: null,
  sensitivityReason: null,
  curator: { sensitivity: 'Confidential', aiUsePolicy: 'requires_masking', /* ... */ },
  masker: {
    decision: 'ai_safe_ready',
    provider: 'simple-rule',
    maskedSpansCount: 7,
    ruleHits: { email: 1, phone_like: 2, label_shimei: 4 },
    residualRisk: { detected: false, reasons: ['氏名・連絡先のみ・取引特定なし'] },
    rationale: '個別取引や顧客固有条件は出現せず再識別不能',
    recommendedSensitivity: 'Confidential',
    sourceContentHash: 'abc...',
    aiSafeSchemaVersion: 1,
    completedAt: <Timestamp>,
    modelId: 'gemini-2.5-flash',
  },
  maskerError: null,
}
```

### Case D: requires_masking → restricted_promoted（terminal: `restricted`）

```ts
{
  // ...
  aiSafeStoragePath: null,             // 作らない
  status: 'restricted',
  sensitivity: 'Restricted',           // top が Masker 値で上書き
  aiUsePolicy: 'blocked',
  sensitivitySource: 'masker',
  originalCuratorSensitivity: 'Confidential',  // Curator の元判定を保持
  sensitivityReason: '顧客固有条件と契約金額が再識別可能 (...)',
  curator: { sensitivity: 'Confidential', aiUsePolicy: 'requires_masking', /* ... */ },
  masker: {
    decision: 'restricted_promoted',
    residualRisk: { detected: true, reasons: ['...', '...'] },
    recommendedSensitivity: 'Restricted',
    /* ... */
  },
  maskerError: null,
}
```

### Case E: Masker 実行中に失敗（terminal: `failed`）

```ts
{
  // ...
  status: 'failed',
  curator: { /* 成功記録は保持 */ },
  curatorError: null,
  masker: null,
  maskerError: { message: 'Vertex API 呼び出し失敗: ...', occurredAt: <Timestamp> },
}
```

---

## GCS レイアウト

```
gs://{KNOWLEDGE_HUB_BUCKET}/
  raw/{docId}/{safeOriginalFileName}     # 原本（既存）
  masked/{docId}/{safeOriginalFileName}  # ai_safe_ready 時のみ
```

- `restricted_promoted` のときは masked オブジェクトを **作らない**（AI 参照版を渡せない判定）。
- masked object の object metadata に `sourceContentHash`, `aiSafeSchemaVersion`, `provider` を入れる。再生成判定や integrity 検証に使う。

---

## Optional: `maskingPending`（レガシー PDF park）

`documents/{docId}.maskingPending` は optional。Phase 3-H-2 M1（`D-P3-H-4 Q5`）では `requires_masking` PDF を `status='curated'` + `maskingPending: true` で Masker 待ちにした。

**2026-05-29 以降の新規 PDF upload**（`D-P3-M-PDF-1`）では:

- Curator が `requires_masking` のとき `status='curating'` のまま DocumentIR / eval / audit を実行
- 本線 Masker 後に `ai_safe` または `restricted` へ遷移（`maskingPending` は `null`）
- `ai_safe` では masked GCS + per-chunk `maskedText` を Firestore chunks に保存

既存の `maskingPending: true` 行は inventory / invariant で引き続き有効。再処理は chunkRegenerator 等の別経路。

---

## 想定 Firestore index（Step 4 で必要）

```
status ASC, updatedAt DESC                             # Inventory 一覧
sensitivity ASC                                        # Restricted バッジ集計
status ASC, sensitivitySource ASC                      # 「Masker が昇格した文書」集計
businessDomain ASC, documentType ASC                   # ヒートマップ
```

複合インデックスは `firestore.indexes.json` に整備する（Step 4 で実装）。

---

## 不変条件 (invariants)

実装側でアサート可能な制約:

1. `aiSafeStoragePath !== null` ⇔ `status === 'ai_safe'` かつ `masker?.decision === 'ai_safe_ready'`。`status === 'failed'` では **null**（post-`ai_safe` 失敗時は masked GCS 削除後に `failed` 更新 — `D-P3-M-PDF-1` §6）
2. `sensitivitySource === 'masker'` ⇒ `originalCuratorSensitivity !== null` かつ `sensitivity === 'Restricted'` かつ `aiUsePolicy === 'blocked'` かつ `status === 'restricted'`
3. `originalCuratorSensitivity !== null` ⇒ `sensitivitySource === 'masker'`
4. `masker !== null` ⇒ `curator !== null` かつ `curator.aiUsePolicy === 'requires_masking'`
5. `masker.sourceContentHash === contentSha256`（同一原本由来であることの証跡）
6. `status === 'curated'` ⇒ `curator.aiUsePolicy === 'direct'`、**または** レガシー PDF park（`requires_masking` かつ `maskingPending === true`、H-3 / `D-P3-H-4 Q5`）。新規 PDF upload は `D-P3-M-PDF-1` により `ai_safe` / `restricted` 終端となり、この park 行は作らない。
7. `status === 'blocked'` ⇒ `curator.aiUsePolicy === 'blocked'`
8. `status === 'restricted'` ⇒ `masker.decision === 'restricted_promoted'` かつ `sensitivitySource === 'masker'`

これらは pure 関数で検証可能（`src/lib/firestoreSchema.ts` に invariant validator として置く想定）。

---

## マイグレーション方針

- `schemaVersion` フィールドを document に持つ。読み取り時に未対応バージョンなら明示エラーにする。
- 既存 Walking Skeleton で書かれた document（`schemaVersion` フィールドなし、`status: 'uploaded'|'curating'|'curated'|'failed'`）は、Step 2 着手時に手動削除する。MVP では履歴永続化はやらない（A4 と整合）。
