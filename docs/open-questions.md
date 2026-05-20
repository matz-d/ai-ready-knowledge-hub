# 未決定事項

次に再開する時、ここから議論を始める。

---

## R4: Knowledge Inventory のビジュアル形式

**決定**: ヒートマップ (業務領域 × 文書種別)

**決定理由:**
- このビジュアルは作品の「視覚的アイコン」になる = デモ動画のサムネイルにもなる重要要素
- SMEの「うちの情報、こんなに偏ってたんだ」体験が一番出る
- x軸/y軸ラベルがそのままCurator分類体系になる

**次のアクション:** R5 と統合 (eval/expected-labels.json 作成は R5 で扱う)。

---

## R5: Curator 分類体系の最終確定

**決定**: W1-1 PoC では以下の6分類項目で確定。実際の JSON 出力には、評価・デバッグ用の `rationale` も含める。
- 文書種別: 契約書 / テンプレート / 案内文 / メモ / チェックリスト / 表 / 規程 / その他
- 業務領域: 顧問契約管理 / 給与計算 / 年末調整 / 就業規則 / 助成金相談 / 顧客対応 / 法改正対応 / 社内手順 / 教育・研修 / 料金管理 / その他
- 機密度: Public / Internal / Confidential / Restricted
- 鮮度: current / superseded_candidate
- 正本候補: boolean (`isAuthoritativeCandidate`)
- AI利用方針: direct / requires_masking / blocked

**補足:**
- AI利用方針は機密度から派生し、Zod refine で整合性を検証する。
- Public/Internal → `direct`
- Confidential → `requires_masking`
- Restricted → `blocked`

**次のアクション:** Week 6 eval 用に `eval/expected-labels.json` を作成し、分類品質の期待値を固定する。

---

## R9: 2ヶ月マイルストーン

**全体ゴール (仮置き):**
- 6月中旬: 動くMVP + デモ動画 + Proto Pedia登録
- 6月下旬-7月上旬: 磨き込み

---

### Week 1 (5/5-5/11) — クローズ (5/8 で実質完了)

**位置付け: 「実装完成」ではなく「技術リスク検証」**

5/8 中に W1-1〜W1-4 + 統合作業まで完了。詳細振り返りは [docs/week1-retrospective.md](week1-retrospective.md)。

**到達点:**

| # | 検証項目 | 成果物 |
|---|---|---|
| W1-1 | Genkit + Vertex AI で structured output が返る | 完了: Curator flow で sample-data 10/10 Zod parse 通過 (`src/agents/curator/`) |
| W1-2 | A8 residualRisk 判定が動く | 完了: `maskerRiskFlow` が `Restricted` 格上げ / `Confidential` 維持を structured JSON で返す (`src/agents/masker/`) |
| W1-3 | A9 Markdown export が動く | 完了: `src/lib/exportContextPackage.ts` が Package Manifest + Instructions + AI-Ready Sources の Markdown を生成 |
| W1-4 | Next.js 最小アプリが Cloud Run にデプロイできる | 完了: `ai-ready-knowledge-hub-w1` を `asia-northeast1` にデプロイ、認証付きHTTP 200確認 |
| W1-Close | poc/ 削除 + R5 enum 正本化 + 固定デモ fixture の通常 UI からの切り離し | 完了: `docs/decisions.md` D-W1-Close。`poc/` 削除済み |
| W1-API seed | Curator flow を Route Handler から呼ぶ | 完了: `src/app/api/curator/route.ts` で `POST /api/curator` を実装 |

**Week 1 で意図的にやらないこと (当時のスコープ):**
- Cloud DLP 統合
- Curator/Masker eval パイプライン

**補足 (2026-05-08 更新):** `POST /api/curator` の Route Handler に加え、Walking Skeleton として
`POST /api/documents` と `/upload` UI（GCS + Firestore + Curator 一括）を実装済み。さらに
Task2 で `SimpleMasker` → `maskerRiskFlow` pipeline、Task3 で Restricted 昇格・Context Package
除外の pure 関数群を実装済み。

Week 2 の残りは、Task1/2/3 の接続（Upload 後に Masker pipeline を呼び Firestore へ
AI-safe 版 / Restricted 昇格を保存）、Inventory 実 Firestore UI、Purpose Query など。

**理由:**
これらは「未知数の少ない作業」(=実装すれば動くと分かっている)。先に未知数の多い Vertex AI API / Genkit / A8/A9 設計の検証を済ませることで、Week 2 以降に詰まるリスクを減らす。

---

### Week 2 以降 (5/12-) — 2026-05-14 時点の実績・見通し

**2026-05-14 更新**: Phase 3-C（App Loop Foundation）が Week 2 初週で完了。以下を達成済み。

| Phase | 完了日 | 内容 |
|---|---|---|
| Phase 3-A | 5/10 以前 | Google Sheets Snapshot Import |
| Phase 3-B | 5/13 | Workspace resync・schemaVersion 2・鮮度バッジ |
| Phase 3-C | 5/14 | Purpose → Strategist → Context Package アプリ一巡 |

**Phase 3-C 達成内容（2026-05-14）:**
- 3-C-1: `strategistFlow` 固定 + `pnpm strategist` smoke script
- 3-C-2: `StrategistOrchestrator` service 層（Firestore + safety gate + Strategist、stub DI 対応）
- 3-C-3: `buildStrategistContextPackage()` — StrategistOrchestratorResult → ContextPackageExportInput + markdown
- 3-C-4: `POST /api/context-package` 同期 API
- 3-C-5: `/context-package` UI + source coverage 全 source 確認済み（upload `.txt` / `.md` / `.csv` / `.xlsx` + Google Sheets + Google Docs）
- Phase 3-C-5 バグ修正 6 件（malformed doc skip、txt/md chunk 生成、upload 後 auto-chunk、Docs route 分岐、Docs error mapping、backfill usage）
- CodeRabbit review: 5 件 apply / 11 件 skip（[docs/decisions.md D-P3-C](decisions.md) に根拠記録）

**次フェーズ（2026-05-20 現在）:**

| 候補 | 内容 | 優先度 |
|---|---|---|
| ~~Phase 3-D~~ | ~~Cloud IAP + CI/CD（GitHub Actions → Cloud Run）~~ | **完了** (2026-05-14) |
| ~~Phase 3-E~~ | ~~Processing Boundary + Cloud DLP Trust Modes~~ | **完了** (2026-05-18) |
| ~~Phase 3-H / H-2~~ | ~~Document Conversion PoC + subtype 1 薄い本線統合 + Eval 育成ループ~~ | **完了** (2026-05-20) |
| **Phase 3-H-3** | slide-pdf / scan-pdf 本線統合 + `inferenceDestination` | **次に着手** |
| Phase 3-F | デモ polish・動画シナリオ・見栄え調整 | H-3 後 |
| Phase 3-G | `cloud-sanitized-ingress` prototype | 高セキュリティ顧客向け後続 |

**次のアクション**: Phase 3-H-3 に着手する。前提は [docs/phase-3-h-2-direction.md](phase-3-h-2-direction.md) §13 Completion Snapshot と [docs/phase-3-h-3-direction.md](phase-3-h-3-direction.md) 着手ゲート。

---

## 細かい未決定事項

### Genkit 設定の詳細
- **決定済み**: Cloud Run へのデプロイ方式は Next.js standalone + multi-stage Dockerfile。正本は [docs/phase-3-d-direction.md](phase-3-d-direction.md)。
- Genkit Flow の Server Action からの呼び出し方
- 環境変数 (Vertex AIプロジェクトID、リージョン等) の管理

### Cloud Storage バケット設計
- **MVP確定**: `KNOWLEDGE_HUB_BUCKET` で単一バケットを指定し、原本は `raw/{docId}/{safeOriginalFileName}` に保存する。
- **実検証済み**: `ai-ready-knowledge-hub-uploads` を `asia-northeast1` に作成し、`/upload` → GCS object 作成を確認済み。
- 残未決: ライフサイクルポリシー (検証用は短期削除するか)

### Cloud DLP provider 調整
- **Phase 3-E 方針（2026-05-15）**: `cloud-managed` を標準 ProcessingProfile とし、Cloud DLP の `minLikelihood` / replacement token / ruleSetVersion を固める。`cloud-sanitized-ingress` は contract-only profile として予約し、ブラウザ WASM DLP / strict local only は MVP では採用しない。
- **実検証済み (2026-05-11)**: `MASKER_PROVIDER=cloud-dlp` で `maskerPipelineFlow` から provider 差し替え可能。`顧問契約書_実案件サンプル.txt` は DLP で 25 span 検出、`顧客対応メモ_匿名化.txt` は DLP span 0 件でも Gemini residual risk が `restricted_promoted` を返した。
- 残未決: `minLikelihood` を設定するか
- 残未決: `PERSON_NAME` / `LOCATION` / `STREET_ADDRESS` が住所周辺を細かく分割する挙動を、デモ前に token 表示・infoType 絞り込み・custom dictionary のどれで整えるか
- 残未決: replacement token を DLP 既定の `[INFO_TYPE]` のまま使うか、既存 `SimpleMasker` と同じ `[REDACTED:TYPE]` に寄せるか
- 残未決: 日本向け custom dictionary（顧客名、社内担当者、支店名など）をどの段階で導入するか

### Phase 3-H-2 で解消した未決（2026-05-20）

以下は [docs/decisions.md](decisions.md) と [docs/phase-3-h-2-direction.md](phase-3-h-2-direction.md) に正本化済み。H-3 では再議論しない（変更時は新しい決定エントリを足す）。

| 論点 | 解消内容 | 出典 |
|---|---|---|
| subtype 1 本線統合の有無・方式 | feature flag + Curator まで + `direct` のみ chunk 化 | `D-P3-H-3` / `D-P3-H-4` |
| feature flag 粒度 | Firestore `feature_flags`、allow-list + `expiresAt` | `D-P3-H-4 Q1` |
| DocumentIR / eval 保存先 | GCS `raw/{docId}/document-ir/v1.json`、Firestore `conversion_eval` | `D-P3-H-4 Q2–Q3` |
| `requires_masking` PDF | `curated` + `maskingPending: true`、chunk なし | `D-P3-H-4 Q5`、IAP 実機確認 |
| ConversionEval 型・runner・CI 三段 | `src/eval/conversion/*`、health 必須 / heuristic warn / golden 手動 | `D-P3-E Q8`、`D-P3-H-5b` |
| subtype 1 heuristic 閾値（初期） | M2-D 分布 + DLP 実測 2 件 | `D-P3-H-5` |
| golden の意味 | 重要フィールド recall（完全一致ではない） | §7.2、M4 実装 |
| subtype 1 変換器 | `pdf-parse` 本線、MarkItDown は PoC のみ | `D-P3-H-1` |
| 評価器 CI 接続タイミング | health = PR 必須 + ruleset、heuristic = warning、golden = 月次 | `D-P3-H-5b` |
| 最初の縦串 subtype | `official-doc-pdf` | `D-P3-H-2` |

**H-2 完了後の初回運用タスク（未決ではないが優先作業）:** golden `expected.json` チューニング（初回 recall ベースライン §7.4、[docs/phase-3-h-2-monthly-review.md](phase-3-h-2-monthly-review.md)）。

---

### Phase 3-H-3（slide-pdf / scan-pdf 本線統合）

**方針ドラフト（2026-05-20）:** [docs/phase-3-h-3-direction.md](phase-3-h-3-direction.md) と [docs/decisions.md](decisions.md) `D-P3-H-6`（ドラフト）を正とする。実装着手前に以下を確定する。

- 残未決: **Masker 本線統合（PDF 経路）** を Phase 3-H-3 内で行うか、別フェーズに送るか（`D-P3-H-6 Q5` 推奨は後送り）
- 残未決: **slide-pdf 本線**で Gemini 失敗時に `pdf-parse` fallback を許すか、health gate で fail-closed にするか（PoC は fallback、`D-P3-H-6 Q2`）
- 残未決: **scan-pdf** の quota 超過・timeout・コスト上限と fail-closed の具体値
- 残未決: subtype 2 / 3 の **heuristic 閾値**（[docs/phase-3-h-slide-pdf-poc.md](phase-3-h-slide-pdf-poc.md) 暫定表は PoC 候補のみ）
- 残未決: `sample-data/document-conversion/{slide-pdf,scan-pdf}/*.expected.json` の golden 粒度と月次レビュー手順の subtype 拡張
- 残未決: `pdf-conversion-subtype-2` / `pdf-conversion-subtype-3` の **公開範囲拡大条件**（subtype 1 M5 判断の踏襲か再定義か）
- 残未決: `document.convert` の **`inferenceDestination`** に載せる model / region の tenant override 要否（固定 env のみで足りるか）
- 残未決: PoC の `ocrUsage` / `ocrCost` を `ConversionEvalResult` 本線 schema に昇格するか

### Document Conversion Eval（H-3 以降の残未決）

**Phase 3-H-2 で解消済み:** 6 軸契約、案 B ロールアップ、subtype 1 の型/runner/fixture/CI 三段、golden = recall、`*.expected.json` は fixture 横配置（`sample-data/document-conversion/official-doc-pdf/`）。

**H-3 に持ち越す（subtype 1 運用・横断）:**

- **`safety_readiness.maskableChunkRate` の再定義** — 公開文書 DLP 実測では観測のみ（`D-P3-H-5`）。PII-bearing 本線 eval または Masker 統合後に blocker 化するか再検討。
- **golden `expected.json` チューニング** — 初回 recall 0.05〜0.19（§7.4）。chunk 分割に合わせた expected 更新が初回月次タスク。
- **`coverage.pageCoverage` の再確認** — official-doc-pdf 観測が 10 件程度溜まったら `>= 1.0` pass の妥当性を見直す。
- **案 C（成熟度別 blocker 軸）への移行条件** — 案 B 試走後の再評価（現状維持）。
- **feature flag 公開範囲拡大条件** — subtype 1 は dev tenant 限定のまま。subtype 2/3 は別 flag で再判断。
- **`inferenceDestination`** — subtype 2/3 の Vertex 呼出時に `document.convert` へ必須（[docs/phase-3-h-3-direction.md](phase-3-h-3-direction.md) §4.2）。
- **Masker 本線統合（PDF 経路）** — `requires_masking` PDF の chunk 化と `safety_readiness` 本格評価（`D-P3-H-6 Q5` 推奨は後送り）。

### 提供形態

- **2026-05-18 方針**: Managed SaaS だけを前提にせず、ライトな顧客向けの Managed SaaS、士業・法人の本命としての Dedicated SaaS / Private deployment、より慎重な顧客向けの Customer-managed / BYOC、最厳格顧客向けの `cloud-sanitized-ingress` を分けて扱う。正本は [docs/offering-model.md](offering-model.md)。
- 残未決: Dedicated SaaS の具体的な分離単位（顧客ごと GCP project / shared project 内専用 Cloud Run / 専用 Firestore+GCS のどこまでを初期商用ラインにするか）
- 残未決: Customer-managed を `ProcessingProfile` として `customer-managed` に分けるか、提供形態としてのみ扱うか
- 残未決: Managed SaaS のトライアルで許可するデータ種別（匿名化済み資料、テンプレート、社内手順書、低リスク資料など）の明文化

### Spreadsheet chunk 粒度
- **Phase 2 確定**: `.xlsx` は 1 sheet の used range を 1 chunk として扱う。used range 内に複数の論理表が並ぶ場合も、Phase 2 では空行分割などの表検出は行わない。
- 残未決: 複数論理表の検出をどのタイミングで入れるか（連続空行、タイトル行、結合セル、小計行などの扱いを先に設計する）。
- 残未決: 巨大 sheet を Context Package に入れる際の上限・警告・人間確認フローをどう設計するか。

### Firestore スキーマ
- MVP の `documents/{docId}` 形状は `docs/architecture.md`（W2 MVP）を参照
- **実検証済み**: `documents/{docId}` に `status='curated'` と Curator 7フィールドを保存確認済み。
- 残未決: `ai_safe_version` の保存位置（サブコレクション `documents/{docId}/ai_safe_version/v1` か、metadata 内 status + 別本文保存か）
- vector index はMVPでは作らない (将来拡張)

### CI/CD認証

**Phase 3-D 完了（2026-05-14）。正本は [docs/decisions.md](decisions.md) の `D-P3-D` と [docs/phase-3-d-direction.md](phase-3-d-direction.md)。**

| 論点 | 決定 |
|---|---|
| GH Actions の GCP 認証方式 | Workload Identity Federation（WIF）実装済み。Service Account JSON key 不使用。 |
| GitHub Secrets の管理範囲 | GCP 認証用 JSON key なし。project / region / WIF provider / SA は GitHub Variables で管理済み。 |
| Cloud Run サービスアカウント | deploy SA `github-deployer` / runtime SA `aiknh-runner` で分離済み。 |
| tenantId | IAP email domain 由来。`KNOWLEDGE_HUB_TENANT_ID` override 対応済み。 |
| Cloud Run public access | IAP 直接保護済み。匿名 302/401 確認済み。`allow-unauthenticated` 不使用。 |
| Dockerfile | multi-stage / Node 22 / pnpm / standalone 実装済み（442MB）。 |
| verifyIapJwt | `src/lib/auth/verifyIapJwt.ts` 実装済み・middleware 統合済み。 |
| AuditEvent | import / reimport / export の 3 action を Firestore に記録済み。 |

### サンプルデータの中身

**確定済み (scope.md `サンプルデータ方針` および `sample-data/README.md` 参照):**
- ファイル数: 全10ファイル (3ペア×2 + 単体4件) — 作成済み
- ペア構造: 顧問契約書 / 顧客対応メモ / 給与計算 の3ペアで、それぞれ異なるエージェント挙動を担当
- 単体: 就業規則テンプレート、年末調整案内文、料金表(現行+旧版)
- 個人情報の演出: 顧問契約書_実案件サンプルにのみ集中させ、架空の社名・人名・住所・電話 (XXXX形式) を埋め込み済み
- 旧版料金表との差分: 約10%値上げ + 「法改正対応含む」「軽微な改定」の文言追加
- 各実案件版の発火想定ルール: R1/R2/R6 (顧問契約書実案件), S2 (顧客対応メモ匿名化), Strategist不足質問 (給与計算例外メモ) — `sample-data/README.md` に表で整理

**残未決:**
- ground truth ラベルファイル (`eval/expected-labels.json`) の作成 — D-3 で対応予定
- 各ファイルが Curator 評価で期待される機密度・業務領域・文書種別ラベルの確定

### eval ground truth の作り方
- 手動アノテーション vs Geminiで生成→手動修正
- ラベルの粒度

### Phase 3-G 引き継ぎ（`cloud-sanitized-ingress`）

**Phase 3-E で文書固定済み（実装なし）:** 将来の当社 ingress が受け取るマスク済み payload の最小 JSON 形、`boundaryEvidence` の必須キー、`correlationId` の役割、未マスク疑い時の fail-closed 拒否の考え方、および Phase 3-E に含めない範囲（Edge Sanitizer、顧客 GCP deploy、BYOC、Terraform、sanitized payload 受理 endpoint）。正本は [docs/phase-3-e-direction.md](phase-3-e-direction.md) §5.2。

**Phase 3-G で検討する未決（実装に入るとき）:**

- 受理 HTTP endpoint のパス・認証（IAP / mTLS / 顧客発行 JWT 等）
- 未マスク疑い detector の一覧・閾値・正規化（全角半角・多言語）
- 同一 `correlationId` 再送時の冪等性と Firestore 書き込みの競合解消
- `chunks[]` を本線の `KnowledgeChunk` に写すマッピング（locator なしの扱い）
- 拒否時の `AuditEvent`（失敗理由を残すか、サイレント drop 禁止か）

---

## 関連ドキュメント

- [docs/phase-3-h-2-direction.md](phase-3-h-2-direction.md) — Phase 3-H-2 完了スナップショット（§13）
- [docs/decisions.md](decisions.md) — 確定事項
- [docs/architecture.md](architecture.md) — 技術構成
- [docs/concept.md](concept.md) — プロダクトコンセプト
