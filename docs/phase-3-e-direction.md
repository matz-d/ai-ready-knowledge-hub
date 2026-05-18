# Phase 3-E 方向性メモ: Processing Boundary + Cloud DLP Trust Modes

> 作成: 2026-05-15  
> 背景: Phase 3-D で CI/CD、Cloud IAP、AuditEvent の最小監査ログが整った。Phase 3-E は「クラウドに何が到達し、どの境界でマスキングされ、どの目的で AI に渡されたか」を説明できるようにし、Cloud DLP 本格統合を Processing Boundary の設計と一緒に固める。

---

## 1. ゴール

Phase 3-E では、AI-Ready Knowledge Hub の標準運用を **Profile-A: `cloud-managed`** として完成度を上げる。生データは Cloud Run / GCS / Firestore の管理境界に入り、構造化後に Cloud DLP + Masker residual risk で安全化し、Context Package へ進む。

一方で、顧客が「当社クラウド境界に生データを入れたくない」と要求する将来ケースには、**Profile-B: `cloud-sanitized-ingress`** を契約・スキーマ・監査仕様だけ先に定義する。Phase 3-E では Edge Sanitizer や顧客 GCP プロジェクトへの実デプロイは実装しない。

**Phase 3-E の一行定義:**

> Cloud-managed を標準の信頼境界として磨き、Cloud DLP と目的拘束つき監査メタデータで「なぜ AI に渡してよいか」を説明できる状態にする。

---

## 2. 決定済み事項

| 論点 | 決定 |
|---|---|
| Q1: MVP の標準処理境界 | `cloud-managed` を標準とする。生データは当社管理 GCP 境界へ入り、構造化後に Cloud DLP / Masker を通す。 |
| Q2: `local-only` という呼称 | 使わない。物理境界と信頼境界が混同されるため、TCB と ProcessingProfile で表現する。 |
| Q3: `sanitize-local-then-cloud` | ブラウザ WASM DLP としては採用しない。監査上、ルール配信元とサプライチェーン証明が弱く、SME 導入手順も重くなるため。 |
| Q4: 高セキュリティ将来モード | `cloud-sanitized-ingress` を contract-only で予約する。顧客 GCP プロジェクト内 Edge Sanitizer がマスク済み payload だけを当社 ingress に送る構成を想定する。 |
| Q5: 処理モード表現 | 単一 enum だけに閉じ込めず、`ingressBoundary` / `sanitizationStage` / `inferenceScope` の直交属性を持つ。MVP では名前付き preset として `profileName` も持つ。 |
| Q6: Purpose binding | Context Package 1 個につき purpose 1 個を監査単位として扱う。`document.export` AuditEvent には目的拘束の識別子を残す。 |
| Q7: BigQuery write-once audit | 正しい方向性として採用するが、Phase 3-E では本実装しない。AuditEvent shape を将来二重書きできる形へ寄せる。 |

---

## 3. TCB と ProcessingProfile

### 3.1 TCB の考え方

Phase 3-E では「ローカル / クラウド」という言葉だけで安全性を説明しない。正本として、次を TCB（Trusted Computing Base）として明示する。

| 項目 | 説明 |
|---|---|
| Ingress boundary | 生データまたはマスク済みデータが最初に到達する境界。 |
| Sanitization stage | マスキング / DLP が行われる境界。 |
| Inference scope | LLM / AI 推論が行われる境界。 |
| Persistent storage | 生データ、マスク済みデータ、chunk、AuditEvent が保存される場所。 |
| Evidence | 境界越え、DLP 実行、AI 投入を後から説明する証跡。 |

### 3.2 型の正本案

Phase 3-E で実装する場合の最小型は次の形に寄せる。

```ts
type ProcessingProfileName = 'cloud-managed' | 'cloud-sanitized-ingress';

type ProcessingProfile = {
  profileName: ProcessingProfileName;
  ingressBoundary: 'tenant-cloud' | 'tenant-edge';
  sanitizationStage: 'post-ingress' | 'pre-ingress';
  inferenceScope: 'shared-cloud' | 'tenant-isolated';
};
```

### 3.3 MVP preset

| Preset | 属性 | Phase 3-E の扱い |
|---|---|---|
| `cloud-managed` | `tenant-cloud / post-ingress / shared-cloud` | **実装対象**。既存 upload / Workspace import / Context Package 経路の標準 profile。 |
| `cloud-sanitized-ingress` | `tenant-edge / pre-ingress / shared-cloud` | **contract-only**。スキーマと監査項目だけ定義し、実行経路は後フェーズ。 |

---

## 4. スコープ

### やること

| 優先 | 項目 | 内容 |
|---|---|---|
| 1 | Cloud DLP 本格統合 | `minLikelihood`、replacement token、対象 infoType、ruleSetVersion を固定する。 |
| 2 | ProcessingProfile の正本化 | `cloud-managed` / `cloud-sanitized-ingress` の TCB、境界、データフローを docs と型で表現する。 |
| 3 | AuditEvent 拡張方針 | `processingProfile`、`purposeBinding`、`inferenceDestination`、`ruleSetVersion`、`maskingMetrics` を将来二重書きしやすい shape に整理する。 |
| 4 | `document.export` の purpose binding | Context Package export 単位で purpose を監査に残し、「どの目的でどの AI-ready data を渡したか」を追えるようにする。 |
| 5 | `cloud-sanitized-ingress` contract | §5.2 を正本とし、受理 payload schema、`boundaryEvidence`、`correlationId`、未マスク疑い reject 方針を文書化する。実装・endpoint はしない。 |
| 6 | DLP / Masker eval の最小設計 | sample-data に対して、期待する masking / restricted promotion / rule hits を固定する足場を作る。 |
| 7 | デモ説明の更新 | 営業向けに Profile-A のデータフローを 1 枚で説明できる文章へ整える。 |

### やらないこと

- Edge Sanitizer の実装（顧客境界で動かすサニタイザ本体のコード・バイナリ・運用スクリプトを含む）
- 顧客 GCP プロジェクトへの deploy / BYOC / Terraform（`cloud-sanitized-ingress` を成立させるための顧客側・当社側 IaC のいずれも Phase 3-E では扱わない）
- 当社クラウド側の **sanitized payload 受理用 HTTP endpoint**（Route Handler / Cloud Run の新ルート。契約は §5.2 で文書化のみ）
- ブラウザ WASM DLP
- Strict local only / ローカル LLM
- PDF / 画像 / Slide の `cloud-sanitized-ingress` 対応
- BigQuery write-once AuditEvent の本実装
- VPC-SC / CMEK の本格構築
- 顧客ごとの custom DLP rule editor

---

## 5. データフロー境界

### Profile-A: `cloud-managed`

| 面 | 方針 |
|---|---|
| Ingress | 生データを Cloud Run route が受け、GCS raw object に保存する。 |
| Structure | Cloud Run 上で extractor が `.txt` / `.md` / `.csv` / `.xlsx` / Workspace snapshot を chunk 化する。 |
| Sanitization | 構造化後の chunk / 文書本文に Cloud DLP provider と Masker residual risk を適用する。 |
| Storage | GCS に raw / masked object、Firestore に document metadata / chunks / maskedText を保存する。 |
| Inference | Vertex AI / Genkit flow が Curator / Masker / Strategist を実行する。 |
| Audit | Firestore AuditEvent に import / reimport / export を append-only で記録する。将来 BigQuery へ二重書きする。 |

### Profile-B: `cloud-sanitized-ingress`（contract-only）

| 面 | 方針 |
|---|---|
| Ingress | 顧客 GCP プロジェクト内 Edge Sanitizer が生データを受ける。当社 cloud ingress はマスク済み payload のみ受ける。 |
| Structure | Phase 3-E では実装しない。将来は Edge 側で text/chunk 化済み payload を送る。 |
| Sanitization | `pre-ingress`。DLP ruleSetVersion と maskingMetrics を payload に含める。 |
| Storage | 当社 GCS / Firestore にはマスク済み data のみ保存する。生データは当社側に存在しない設計にする。 |
| Inference | 当社 shared-cloud inference に渡す入力はマスク済み chunk のみ。 |
| Audit | 顧客側 boundary evidence と当社 AuditEvent を correlation id でつなぐ。両方が揃って 1 回の処理証跡とみなす。 |

### 5.2 `cloud-sanitized-ingress` contract 正本（Phase 3-E は文書のみ）

本節は **将来**の当社 ingress が「マスク済みと主張される payload」のみを受け取るときの **契約（JSON の形・証跡・拒否方針）** を固定する。§5 の Profile-B 表と矛盾しない。Phase 3-E では **実装・エンドポイント・Edge デプロイは一切行わない**（§4「やらないこと」参照）。

#### Phase 3-E で実装しないもの（再掲）

次は本 profile を「動かす」ための要素であり、Phase 3-E のスコープ外とする。

- Edge Sanitizer（顧客 GCP 内で生データを受け、マスク済み payload を組み立てるコンポーネント）の実装
- 顧客 GCP プロジェクトへの deploy、BYOC、Terraform による環境構築
- 当社側の **sanitized payload 受理 endpoint**（HTTP API の新設。Phase 3-G 以降の検討対象）

#### 受理 payload の最小スキーマ（契約案）

ingress が受理する想定 JSON は、少なくとも次を **必須** とする。フィールド名は実装時に Zod / OpenAPI に落とすが、意味はここを正とする。

| フィールド | 型（概念） | 必須 | 説明 |
|---|---|---|---|
| `schemaVersion` | number | はい | 契約版。初期案は `1`。後から breaking change するときに増やす。 |
| `processingProfile` | object | はい | §3.2 の `ProcessingProfile` と一致すること。`profileName` は必ず `'cloud-sanitized-ingress'`。`ingressBoundary` / `sanitizationStage` / `inferenceScope` は §3.3 の preset と一致すること。 |
| `correlationId` | string | はい | **1 回の取り込み試行**を顧客側証跡と当社側 `AuditEvent` で結ぶ識別子。推奨は UUID v4。不透明な高エントロピー文字列でもよいが、衝突耐性とログ検索可能性を満たすこと。 |
| `ruleSetVersion` | string | はい | Edge で適用した DLP / マスキングルール束の版（例: `dlp-ruleset-2026-05-15-v1`）。§7 の方針と整合する命名でよい。 |
| `maskingMetrics` | object | はい | `detected` / `replaced` / `falsePositiveReviewed`（数値）。§6.1 `ProcessingRecord` の最小形と同じ意味。 |
| `chunks` | array | はい | 当社側ストレージに載せる **マスク済みテキスト** の単位。各要素は少なくとも `text: string`（マスク後本文）を持つ。locator・metadata は Phase 3-G 以降で `KnowledgeChunk` 相当へ拡張可能。空配列は「受理しても意味がない」ため契約上は許容しない（バリデーションで弾く想定）。 |
| `boundaryEvidence` | object | はい | 下記「境界証跡」を満たすオブジェクト。 |

任意フィールド（契約の拡張ポイント、Phase 3-E では未実装）:

- `purposeBinding` の先行指定（将来、export 単位の purpose と突合する場合）
- `tenantDocumentRef`（顧客側の文書 ID。当社 `docId` とは別系統）

**当社境界に生の平文を載せない:** `chunks[].text` はマスク適用後のみ。生データや「マスク前のハッシュのみ」では本文として受理しない（ハッシュは `boundaryEvidence` 側の設計次第で、平文を当社に送らない範囲に留める）。

#### 境界証跡（`boundaryEvidence`）の必須内容

顧客 Edge で「いつ・どのルール束で・どの程度マスキングしたか」を後から説明できる最小セット。

| フィールド | 型（概念） | 必須 | 説明 |
|---|---|---|---|
| `evidenceVersion` | string | はい | 証跡スキーマ版。例: `edge-evidence-v1`。 |
| `sanitizedAt` | string (ISO8601) | はい | Edge 上でサニタイズが完了した時刻（UTC 推奨）。 |
| `ruleSetVersionApplied` | string | はい | 実際に適用したルール束の版。ルートの `ruleSetVersion` と **一致**すること（不一致は拒否方針）。 |
| `sanitizerComponentId` | string | はい | Edge サニタイザのビルド識別子（リリースタグ、コミット SHA、顧客パッケージ版など）。人間が「どのバイナリか」を辿れる粒度。 |

任意: `edgeTenantRef`（顧客側テナント・環境の表示名）、`parentCorrelationId`（バッチ分割時の親 ID）。

#### `correlationId` の運用ルール（契約）

- 顧客の監査ログ（Edge 側）と当社の `AuditEvent`（将来の ingress / `document.import` 相当）に **同一文字列** を記録する。
- **再送・リトライ**では同一 `correlationId` を使うか、使わないかを契約で決める。推奨: 再送は同一 ID（冪等キー）とし、当社側は重複検知時に既処理として応答する設計を Phase 3-G で検討する。Phase 3-E では実装しない。
- 当社が証跡として追えることのみ必須とし、顧客内部の user id を載せるかは契約・法務の対象（本節では必須にしない）。

#### 未マスク疑い payload の拒否方針（契約）

当社 ingress（将来実装）は **fail-closed** とする前提を固定する。次のいずれかに該当する場合、**永続化せず**拒否する（HTTP ステータスは Phase 3-G で OpenAPI に書く; 概念として 4xx）。

1. **スキーマ違反**: 必須キー欠落、`processingProfile` が preset と不一致、`chunks` が空、型不正。
2. **ルール版の不整合**: `boundaryEvidence.ruleSetVersionApplied` とルートの `ruleSetVersion` が一致しない。
3. **未マスク疑い（自動検知）**: 受信テキスト（`chunks[].text` の連結または各要素）に対し、契約で定めた **高感度 detector**（例: クレジットカード番号の Luhn 相当、メールアドレス正規表現、日本のマイナンバー形式、国際電話の桁パターン等）が閾値を超えてヒットした場合。detector 一覧と閾値は Phase 3-G で実装に落とす; Phase 3-E では「高感度 pattern に基づき拒否しうる」ことのみ固定する。
4. **証跡欠落**: `boundaryEvidence` が必須フィールドを欠く、または `sanitizedAt` が未来すぎる・著しく古いなど、運用で定めた鮮度ウィンドウ外（ウィンドウ値は Phase 3-G）。

**故意にしないこと:** `maskingMetrics.detected === 0` **単独**を拒否理由にしない（マスク対象が本当にない文書がありうる）。PII 疑いシグナルと組み合わせたときのエスカレーションは Phase 3-G で設計する。

#### Phase 3-G への引き継ぎ（実装時に決めること）

- 受理 endpoint のパス・認証（IAP / mTLS / 顧客発行 JWT）の選択
- detector 一覧・閾値・多言語・全角半角の正規化
- 冪等性（同一 `correlationId` の再送）と Firestore 書き込みの競合解消
- `chunks` を `KnowledgeChunk` スキーマへ写すマッピング（locator なし chunk の扱い）

---

## 6. AuditEvent / ProcessingRecord

Phase 3-E では既存 `AuditEvent` を大改造しない。まず `document.export` を中心に、将来の二重書きと目的拘束に耐える payload を設計する。

### 6.1 最小メタデータ

```ts
type ProcessingRecord = {
  processingProfile: {
    profileName: 'cloud-managed' | 'cloud-sanitized-ingress';
    ingressBoundary: 'tenant-cloud' | 'tenant-edge';
    sanitizationStage: 'post-ingress' | 'pre-ingress';
    inferenceScope: 'shared-cloud' | 'tenant-isolated';
  };
  maskingStage: 'cloud-post-ingress' | 'edge-pre-ingress';
  ruleSetVersion: string;
  appliedDlpRules: string[];
  maskingMetrics: {
    detected: number;
    replaced: number;
    falsePositiveReviewed: number;
  };
  purposeBinding: string;
  inferenceDestination: {
    vendor: 'vertex';
    region: string;
    model: string;
  };
  dataResidency: {
    storage: string;
    processing: string;
  };
};
```

### 6.2 Purpose binding

`purposeBinding` は Context Package export 単位で発行する。初期実装では、次のいずれかでよい。

| 候補 | 内容 | Phase 3-E 推奨 |
|---|---|---|
| hash-based | normalized purpose + timestamp + tenantId の hash | 実装が軽い。MVP向き。 |
| explicit id | `contextPackages/{packageId}` を作り、その id を使う | 将来の本命。保存設計が増えるため後続候補。 |

Phase 3-E では hash-based で開始し、将来 `contextPackages` collection を作る時に移行できるようにする。

---

## 7. Cloud DLP 方針

### 7.1 DLP config

Phase 3-E では `cloudDlpMasker` に次の設定を持たせる。

| 項目 | 方針 |
|---|---|
| `minLikelihood` | Phase 3-E の実装値は `POSSIBLE`。過剰検出が強い場合に `LIKELY` へ上げる余地は後続検証で扱う。 |
| replacement token | DLP 既定の `[INFO_TYPE]` ではなく、`[REDACTED:<INFO_TYPE>]` に固定する。例: `[REDACTED:PERSON_NAME]`。 |
| infoTypes | 既存 `EMAIL_ADDRESS` / `PHONE_NUMBER` / `PERSON_NAME` / `LOCATION` / `STREET_ADDRESS` / `DATE_OF_BIRTH` / `CREDIT_CARD_NUMBER` / `JAPAN_INDIVIDUAL_NUMBER` / `JAPAN_BANK_ACCOUNT` を初期正本にする。 |
| ruleSetVersion | DLP config bundle として `dlp-ruleset-2026-05-15-v1` を明示する。 |
| custom dictionary | Phase 3-E では設計候補まで。顧客名 / 担当者名 / 支店名などは後続で tenant override として扱う。 |

### 7.2 LLM との役割分担

マスキングそのものを LLM に依存しない。DLP / rule-based masker が決定論的に masked spans を作り、LLM は次に限定する。

- Curator: 文書分類、業務領域、AI 利用方針
- Masker residual risk: マスキング後も再識別リスクが残るかの評価
- Strategist: Purpose に対する採用 / 除外 / 不足 / 人間確認質問

---

## 8. 既存コードとの接続点

| 既存ファイル | 役割 | Phase 3-E の扱い |
|---|---|---|
| `src/agents/masker/cloudDlpMasker.ts` | Cloud DLP provider | `minLikelihood`、replacement token、ruleSetVersion を追加する主対象。 |
| `src/agents/masker/maskingSchema.ts` | masking result 型 | ruleSetVersion / maskingMetrics の表現を検討する。 |
| `src/lib/firestoreSchema.ts` | document metadata 正本 | ProcessingProfile を document に持たせるか AuditEvent に閉じるかを実装前に決める。Phase 3-E は最小変更優先。 |
| `src/lib/audit/auditEvent.ts` | AuditEvent append-only 書き込み | `document.export` の purposeBinding / processing profile 追加候補。 |
| `src/app/api/context-package/route.ts` | Context Package export 入口 | purposeBinding を生成し AuditEvent へ渡す候補。 |
| `src/lib/contextPackageFirestoreAdapter.ts` | Firestore から export input を構成 | 将来 `contextPackages/{id}` を作る場合の接続点。 |
| `docs/demo-scenario.md` | デモ物語 | Profile-A の安全境界と DLP を説明できるように更新する。 |

---

## 9. DoD

Phase 3-E は次を満たしたら完了とする。

- `cloud-managed` が標準 profile としてドキュメントに固定されている。
- `cloud-sanitized-ingress` が contract-only profile としてドキュメントに固定されている（契約の細部は §5.2。Phase 3-E で Edge / 顧客 deploy / BYOC / Terraform / 受理 endpoint を実装しないことも §4・§5.2 で明示されている）。
- `local-only` / ブラウザ WASM DLP を MVP の処理境界として採用しない判断が記録されている。
- Cloud DLP provider の `minLikelihood`、replacement token、ruleSetVersion 方針が実装または実装可能な具体仕様になっている。
- Context Package export の AuditEvent に `purposeBinding` を残す方針が実装または具体仕様になっている。
- `ProcessingProfile` の型方針が docs と実装候補で一致している。
- BigQuery write-once audit は後続と明記され、現時点の Firestore AuditEvent の限界が説明されている。
- **Document Conversion Eval の評価契約（6軸 / `ConversionEvalResult` の docs 上の型案 / 三段階成熟度 / `overall.status` ロールアップ規約）が本文書に固定されている。`src/` への型実装、評価器ランナー、golden fixture 作成、`poc/document-conversion/` 作成、CI への評価器接続はいずれも Phase 3-H に送ることが明記されている。**
- `pnpm test`、`pnpm typecheck`、必要に応じて `pnpm build` が通る。

### 9.1 完了確認 (2026-05-18)

- `ProcessingProfile` preset は docs / `src/lib/processingProfile.ts` / `document.export` AuditEvent で一致している。
- Cloud DLP provider は `minLikelihood=POSSIBLE`、replacement token `[REDACTED:<INFO_TYPE>]`、`ruleSetVersion=dlp-ruleset-2026-05-15-v1` で固定済み。
- `local-only` / ブラウザ WASM DLP / strict local only は MVP 採用ではなく、不採用・スコープ外の判断としてのみ残っている。
- Cloud DLP live smoke は ADC を使って実行済み。`顧問契約書_実案件サンプル.txt` で 25 spans を検出し、`JAPAN_BANK_ACCOUNT` も rule hit に含まれる。
- `pnpm test`、`pnpm typecheck`、`pnpm build` は通過済み。

---

## 10. Document Conversion Eval（評価契約の予約）

### 10.1 目的と非目的

**目的:**

PDF / 画像 / Slide / Office 系の本格変換を Phase 3-H で着手する前に、**「何をもって良い変換結果と呼ぶか」の評価契約**を Phase 3-E のうちに固定する。変換器を比較する前に物差しを固定することで、Phase 3-H 以降の PoC（`poc/document-conversion/`、Phase 3-H で作成）の手戻りを抑え、Gemini / MarkItDown / Docling / Document AI / Gemma などを **同じ評価軸で比較できる足場**を repo に刻む。

**非目的:**

- 変換器そのものを Phase 3-E で実装しない。
- `ConversionEvalResult` を `src/` に落とす型実装（Zod / OpenAPI 化を含む）を Phase 3-E では行わない。
- golden fixture（正解データ）を Phase 3-E では作らない。
- `poc/document-conversion/` ディレクトリも Phase 3-E では作らない（Phase 3-H で作成）。
- 評価器ランナー（CI に組み込む scaffold）は Phase 3-E では作らない。
- CI への評価器接続も Phase 3-E では行わない。

### 10.2 評価対象は「変換器」ではなく「変換後の構造化結果」

Phase 3-E が固定するのは、**変換後の `DocumentIR` / `KnowledgeChunk` 相当の構造化結果に対する評価軸**であり、変換器そのもの（Gemini / MarkItDown / Docling 等）の比較指標ではない。

また、golden eval は「完璧な `DocumentIR` 全体との完全一致」を主目的にしない。PDF / 画像 / Slide は正解構造が一意に決まりにくいため、golden fixture は **残ってほしい重要情報の recall** を測るために使う。完全一致ではなく、金額・日付・当事者・見出し・表の主要セル・画像内帳票項目・Masker / DLP が処理すべき個人情報候補などが、downstream で扱える粒度と locator つきで残っているかを見る。

理由:

- 変換器は今後増減する。評価対象を変換器側に置くと、軸を変換器ごとに作り直す羽目になる。
- このプロダクトの downstream 契約は Curator / Masker / Strategist / Context Package であり、**Strategist が安全に採用 / 除外判断できる構造化結果**かどうかが本質。
- Phase 3-E で固定する Cloud DLP の `ruleSetVersion` / replacement token / Masker residual risk が、変換後 chunk の粒度に依存する。downstream の前提を満たさない変換器を `safety_readiness` 軸で落とせる足場が必要。

### 10.3 6つの評価軸

| 軸 | 見たいこと | 正解データ要否 | Phase 3-E 段階での扱い |
|---|---|---|---|
| `schema_validity` | `DocumentIR` / `KnowledgeChunk` schema に通るか | 不要 | health check（必須） |
| `coverage` | ページ・段落・表が十分に抽出されているか | 一部必要 | heuristic eval（chunk数 / 空 chunk / 極端な短さで近似） |
| `locator_quality` | page / table / row / bbox など根拠位置が追えるか | 一部必要 | heuristic eval（locator 有無のみ） |
| `semantic_retention` | 金額・日付・当事者・見出しなど重要情報が残っているか。完全一致ではなく期待フィールド recall を見る | 必要 | golden eval（Phase 3-H 以降） |
| `safety_readiness` | DLP / Masker が効く粒度・構造で出ているか（PII が残っているかではなく、PII が来た時に Masker が捕捉・置換できる形か）| 一部必要 | heuristic eval（unmaskable PII 件数 / maskable chunk 比率） |
| `context_package_readiness` | Strategist が採用 / 除外判断できる chunk になっているか | 一部必要 | heuristic eval（chunk 件数 / 平均長 / oversized / empty） |

### 10.4 ConversionEvalResult 型（評価器インターフェース）

評価器の実装は Phase 3-H 以降だが、**インターフェースは Phase 3-E で固定する**。これにより、Phase 3-H で複数変換器を並列に試した結果を、同じ JSON shape で比較・蓄積できる。

```ts
type ConversionEvalResult = {
  schemaValidity: {
    passed: boolean;
    errors: string[];
  };
  coverage: {
    pageCoverage: number;
    textDensityWarnings: string[];
    tableCandidates: number;
  };
  locatorQuality: {
    hasPageLocators: boolean;
    hasTableLocators: boolean;
    locatorAccuracy?: number; // golden eval 段階のみ
  };
  semanticRetention: {
    keyFieldRecall?: number;          // golden eval 段階のみ
    missingExpectedFields: string[];  // golden eval 段階のみ
  };
  safetyReadiness: {
    // golden eval 段階のみ。Masker が拾うべき PII をどれだけ拾えたかの recall
    piiDetectionRecall?: number;
    // 変換結果の中で「DLP/Masker が span 単位で捕捉・置換できない形」で混入している PII の件数。
    // 例: 画像化されたテキストに埋まった氏名、表セルが結合されて locator が立たない PII、
    //     chunk 境界をまたいで分断された連結 PII など。
    // Masker 適用後の "残存リスク"（A8 / maskerRiskFlow の責任領域）とは別物。
    // Conversion Eval が見るのは「Masker が効く形か」であり、「Masker 後に何が残るか」ではない。
    unmaskablePiiFindings: number;
    // 構造上 Masker / DLP を適用可能な chunk の比率。低いと変換結果が安全処理に乗らない。
    maskableChunkRate: number;
  };
  contextPackageReadiness: {
    chunkCount: number;
    averageChunkLength: number;
    oversizedChunks: number;
    emptyChunks: number;
  };
  overall: {
    status: 'pass' | 'warn' | 'fail';
    reasons: string[];
  };
};
```

### 10.5 三段階の成熟度

評価器は最初から完璧でなくてよい。**同じ評価軸に向かって、health check → heuristic eval → golden eval に育てる**ことを正本方針とする。

| 段階 | 対象軸 | 正解データ | CI 接続 |
|---|---|---|---|
| health check | `schema_validity`, `context_package_readiness`（一部）| 不要 | 必須 gate |
| heuristic eval | + `coverage`, `locator_quality`, `safety_readiness`（`unmaskablePiiFindings` / `maskableChunkRate` の heuristic 集計） | 一部 | warning gate |
| golden eval | + `semantic_retention`, `safety_readiness`（`piiDetectionRecall`）, `locator_quality`（accuracy） | 必要 | 後続 |

Phase 3-E で固定するのは「この三段階の存在と、軸の割当」まで。各段階の閾値・golden fixture の中身・CI 配線は Phase 3-H で決める。

### 10.6 overall.status のロールアップ規約

**正本: 案B（ブロッカー軸方式）**

- `schema_validity` と `safety_readiness` を **ブロッカー軸**とする。
- ブロッカー軸が **fail** 条件に該当した場合、`overall.status = 'fail'`。
- ブロッカー軸が **warn** 条件に該当した場合、`overall.status = 'warn'`。
- 非ブロッカー軸が **fail** 条件に該当した場合、`overall.status` 上は **`'warn'` に降格**する（fail にしない）。
- 非ブロッカー軸の **warn 単独**は、`overall.status` を昇格させない。`reasons` にも残さず、軸ごとの詳細フィールドにのみ反映する。
- `reasons` に積むのは、**overall.status の判定に効いた事象**だけ（ブロッカー軸の fail / warn、非ブロッカー軸の fail 降格）。非ブロッカー軸単独 warn を `reasons` に積むと「reasons が空でない＝warn」というショートカット実装が誘発されるため、明示的に禁じる。
- `reasons` は最大 1-3 件を目安に圧縮する。
- 各軸の「fail / warn / pass 該当」の具体的閾値は Phase 3-H で決定する。Phase 3-E では軸ごとの判定関数の存在だけ予約する。

擬似コード:

```ts
function rollupOverallStatus(result: ConversionEvalResult): {
  status: 'pass' | 'warn' | 'fail';
  reasons: string[];
} {
  // 軸ごとの判定（fail / warn / pass）は Phase 3-H で確定する閾値関数に委譲。
  // ここではロールアップの構造だけを示す。
  const schema = evalSchemaValidity(result);           // 'fail' | 'warn' | 'pass'
  const safety = evalSafetyReadiness(result);          // 'fail' | 'warn' | 'pass'
  const nonBlockerFails = collectNonBlockerFails(result);   // 非ブロッカー軸で fail 条件に該当した軸名
  // 非ブロッカー軸の warn は overall.status に昇格させないため、ロールアップでは収集しない。

  const reasons: string[] = [];

  // 1. ブロッカー軸 fail は最優先で全体 fail
  if (schema === 'fail') reasons.push('schema_validity: fail');
  if (safety === 'fail') reasons.push('safety_readiness: fail');
  if (schema === 'fail' || safety === 'fail') {
    return { status: 'fail', reasons };
  }

  // 2. ブロッカー軸 warn は全体 warn に昇格
  if (schema === 'warn') reasons.push('schema_validity: warn');
  if (safety === 'warn') reasons.push('safety_readiness: warn');

  // 3. 非ブロッカー軸 fail は warn に降格して全体 warn に昇格
  for (const axis of nonBlockerFails) {
    reasons.push(`${axis}: fail (downgraded to warn)`);
  }

  if (reasons.length > 0) return { status: 'warn', reasons };
  return { status: 'pass', reasons: [] };
}
```

ポイント:

- `reasons` に積むものを「全体status の判定に効いたもの」に限定したため、`reasons.length > 0 ⇒ warn` が成立する（非ブロッカー warn でショートカットが汚染されない）。
- 非ブロッカー軸 warn の情報は失われない。`ConversionEvalResult` の軸ごとのフィールド（`coverage.textDensityWarnings` 等）に残るため、人間レビューや heuristic 分析で参照できる。
- ブロッカー軸 fail と非ブロッカー fail（降格）は `reasons` 上で表記を分け、どれが overall を fail に押し上げたかを後から区別できる。

**根拠（A8 との整合）:**

- `docs/decisions.md` A8（Masker→Curator 逆 feedback）の「非対称リスクで安全側に倒す」哲学を、Conversion Eval 層にもそのまま持ち込む。
- 変換結果に PII が残る、または schema が壊れている、という downstream を破綻させる失敗は他軸で吸収させない。
- それ以外の品質低下（locator が弱い、coverage が低い、semantic retention が落ちている）は **「人間が見て判断する材料」**として `reasons` に残せば足りる。CI を red にして変換器選定そのものを止める性質ではない。

**将来メモ: 案C（成熟度別運用、Phase 3-H 以降の検討候補）**

成熟度（health / heuristic / golden）ごとに blocker 軸セットを変える運用は、将来オプションとして残す。具体的には:

- health check 段階: `schema_validity` のみ blocker
- heuristic eval 段階: `schema_validity` + `safety_readiness` を blocker（= 案 B）
- golden eval 段階: 上記 + `semantic_retention` の閾値も blocker（顧客特有の必須フィールド recall を CI gate にする）

Phase 3-E では案 B で固定する。案 C は Phase 3-H 以降、golden fixture が揃ったタイミングで再評価する。

### 10.7 Phase 3-E でやる / やらない（境界の再確認）

**やる:**

- 6 評価軸の定義（10.3）
- `ConversionEvalResult` 型の固定（10.4）
- 三段階成熟度の宣言（10.5）
- `overall.status` ロールアップ規約の固定（10.6、案B）
- A8 との哲学的整合の明文化（10.6 根拠）

**やらない（いずれも Phase 3-H で着手）:**

- `ConversionEvalResult` を `src/` に落とす型実装（TypeScript 正本化、Zod / OpenAPI 化を含む）
- 評価器ランナーの実装
- 各軸の fail / warn 閾値の確定
- golden fixture の作成・整備
- `poc/document-conversion/` ディレクトリ作成
- 任意の PDF / Slide / 画像変換器の試走
- CI への評価器接続

### 10.8 Phase 3-H への引き継ぎ

Phase 3-H 着手時に、本節を起点に次を順番で固める想定。Phase 3-H 設計時にこの順序自体を再検討してよい。

1. `poc/document-conversion/` ディレクトリを repo 直下に作成。
2. 最初の比較対象を MarkItDown 単体 / Gemini 直 PDF / MarkItDown → Gemini 補正 の 3 系統に固定。
3. 各軸の fail / warn 閾値関数を、サンプル数件で手チューニングして暫定値を決める。
4. golden fixture を sample-data（士業事務所サンプル）から 3-5 件作る。`semantic_retention` の `missingExpectedFields` 用に「必ず残ってほしいフィールド」リストを fixture 横に置く。
5. health check 評価器を最初に CI gate に入れる。heuristic eval は warning gate にとどめる。golden eval は手動実行 + 月次レビュー段階で start。
6. ここまでが回ってから、本線（`src/`）への変換器組み込みを検討する。

---

## 11. 後続候補

Phase 3-E 完了後の候補は次の通り。

| 候補 | 内容 |
|---|---|
| Phase 3-F | デモ polish、Knowledge Inventory ヒートマップ、動画シナリオ、トップページ古い status 表示の更新。 |
| Phase 3-G | `cloud-sanitized-ingress` の prototype。§5.2 contract に沿った sanitized payload endpoint、schema / 未マスク疑い reject、`correlationId` による顧客証跡と `AuditEvent` の突合。 |
| Phase 3-H | PDF / 画像 / Slide の document-conversion PoC。MarkItDown / Gemini / Docling 等を `poc/document-conversion` で比較する。 |
| Phase 4 | BigQuery / Cloud Logging write-once audit、CMEK / VPC-SC、tenant policy engine。 |

---

## 関連ドキュメント

- [docs/phase-3-d-direction.md](phase-3-d-direction.md) — CI/CD + IAP + AuditEvent
- [docs/open-questions.md](open-questions.md) — 次フェーズ候補と未決定事項
- [docs/decisions.md](decisions.md) — 採用判断ログ
- [docs/demo-scenario.md](demo-scenario.md) — デモシナリオ
- [docs/phase-2-design.md](phase-2-design.md) — KnowledgeChunk / Context Package 設計
