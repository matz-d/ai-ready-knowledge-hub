# セキュリティレビュー プロンプト集（観点別）

汎用 `/security-review`（ブランチ差分の1パス全体スキャン）では、本製品の急所が薄まりがち。
このプロジェクトの脅威モデルは「機密文書 × per-client デプロイ × GCP 前段」に偏っているため、
観点（視点）ごとに分割し、別セッション／サブエージェントへ**独立して**渡す前提のプロンプト集。

## 前提（このプロジェクト固有）

- **デプロイ方式**: 各クライアント環境に Docker イメージを構築・デプロイする **per-client シングルテナント**（SaaS マルチテナントではない）。越境防止の主軸は物理デプロイ分離。
- **intra-org authz**: 初期は実質1〜少人数で**全員が全件閲覧可＝意図した仕様**。doc-level の閲覧権限が無いことは現状バグではない。文書ごとの権限管理はスケール時の将来スコープ（issue 化済み）。
- **Safety Invariants（CLAUDE.md）**: 生PII/credential を commit しない、masking/exclusion は product-critical、判断不能文書は exclusion か human confirmation を優先、Context Package は「使える/除外/足りない/確認」を区別。

## 使い方

各レビューに渡すプロンプト = **「共通ヘッダ」+「観点ブロック1つ」**。観点ごとに別レビューへ独立して投げる。
対象は「リポジトリ全体」または「特定ブランチ差分」のどちらでも、ヘッダ冒頭の `### スコープ` を差し替える。

---

## 共通ヘッダ（全プロンプト共通で先頭に貼る）

```
あなたはシニアセキュリティエンジニアです。AI-Ready Knowledge Hub（SME向け、機密文書をAIに渡す前段プラットフォーム。Next.js + Genkit/Vertex AI + Cloud Run + Firestore + GCS + Cloud DLP。各クライアント環境に Docker イメージを構築する per-client シングルテナント）に対し、指定された「観点ブロック」に限定した集中セキュリティレビューを行ってください。

### スコープ
- 対象: リポジトリ全体（または: <branch/PR を指定>）。
- まず CLAUDE.md の "Repository Map" / "Where To Start" / "Safety Invariants" を読み、脅威モデルを把握してから観点ブロックの対象ファイルを精読する。

### 方針（誤検知の最小化）
1. 実際に悪用可能（>80%確信）な脆弱性だけを報告。理論・スタイル・低影響は除外。
2. 影響重視: 不正アクセス / データ漏洩 / 権限昇格 / 生PII露出 / イメージへのシークレット焼き込み につながるものを優先。
3. 既存の問題ではなく「コードが現に持つ具体的な欠陥」を、攻撃経路つきで示す。

### 除外（報告しない）
- DoS / リソース枯渇 / レート制限。
- ディスク上のシークレット保存そのもの（別管理）。古い第三者ライブラリ起因。
- テストのみのファイル。ドキュメント(.md)。ログへの非PII出力。
- env / CLI フラグは信頼値（攻撃者が改変できる前提にしない）。UUIDは推測不能とみなす。
- クライアント側 JS/TS の権限チェック欠如（サーバ側責務）。理論的 race / timing。
- per-client シングルテナント前提のため「文書ごとの閲覧権限が無い」こと自体は現状仕様（将来スコープ）。脆弱性として報告しない。

### 出力形式（Markdown）
各 finding: 「ファイル:行番号 / Severity(High|Medium) / カテゴリ / 説明 / 攻撃シナリオ(具体的な入力→結果) / 修正案 / 確信度(1-10)」。
確信度8未満は出さない。High/Medium のみ。該当なしなら「該当なし」と根拠を1段落で書く。
```

---

## 観点① per-client デプロイ & イメージ完全性

```
## 観点: per-client デプロイとイメージ完全性
本製品は各クライアント環境に Docker イメージを構築・デプロイする per-client シングルテナント方式（SaaS マルチテナントではない）。
越境防止の主軸は物理デプロイ分離なので、tenantId 照合ではなく「イメージに何が焼き込まれるか」を検証する。

### 対象
- Dockerfile / .dockerignore / マルチステージ build
- ビルド・デプロイ設定（cloudbuild、.github/workflows/deploy-demo.yml 等の CI/CD）
- イメージにコピーされる範囲（sample-data/, .env*, credential, service account, 固有 project ID）

### チェック項目
1. シークレット（HMAC署名鍵 / service account key / APIキー / DLP・Vertex クレデンシャル）が ENV / ARG / COPY でイメージに焼き込まれていないか。マルチステージでも build-time secret が最終レイヤに残っていないか（履歴レイヤ含む）。
2. クライアント固有データ・実データ・.env・credential が .dockerignore で除外されず最終イメージに混入していないか。sample-data に synthetic 以外が無いか。
3. config / credential が build 時でなく runtime 注入（env / mounted secret / Secret Manager）になっているか。1つのイメージを複数クライアントに配る際、あるクライアントの値が別クライアントへ漏れる経路がないか。
4. デプロイ workflow が credential をログ / アーティファクト / イメージタグに残していないか。
```
セキュリティレビュー結果 — 観点① per-client デプロイ & イメージ完全性

該当なし（High / Medium の確定脆弱性なし）

リポジトリ全体を対象に、per-client シングルテナント方式における「イメージへ何が焼き込まれるか」を主軸として精査した結果、確信度8以上で報告すべき脆弱性は検出されませんでした。 調査サブタスクが2件の候補を挙げましたが、いずれも独立した誤検知フィルタリングで FALSE POSITIVE（確信度 2/10・3/10）と判定され、閾値（8）未満のため報告対象外です。根拠は次のとおり。①シークレット非焼き込み: Dockerfile のビルド入力は非機密のフィーチャーフラグ（NEXT_PUBLIC_CONTEXT_PACKAGE_ASYNC_ENABLED）と NODE_OPTIONS のみで、秘密の ARG/ENV/COPY は無し。実行時シークレット（CONTEXT_PACKAGE_JOB_TOKEN 等）は gcloud run deploy --set-secrets=...:latest（Secret Manager）でランタイム注入、CI 認証は Workload Identity Federation でSA キーファイルがランナー・イメージのどこにも存在しない。BEGIN ... PRIVATE KEY / client_secret / AIza... / ghp_ / sk- 等のリポジトリ全体 grep もヒット無し。②実データ非混入: 最終 runner ステージは .next/standalone .next/static public sample-data のみ COPY、sample-data/ は README で合成データと明示（電話番号は XXXX、「実案件サンプル」も架空のデモデータ）、.env.local は git 非追跡かつ .dockerignore（*.local / .env.*）で除外、追跡されている tmp/*.json は合成 golden で最終イメージ未コピー。③ビルド時 vs ランタイム設定: クライアント固有値（GOOGLE_CLOUD_PROJECT / KNOWLEDGE_HUB_BUCKET / IAP_JWT_AUDIENCE / tenant id / worker URL）はすべて --set-env-vars でランタイム注入、src/ にプロジェクト ID・バケット名・SA メールのハードコード無し → 同一イメージを複数クライアントへ配布してもクライアント間で値が漏れる経路なし。④デプロイワークフローのログ漏洩: ワークフローはシークレットを Secret Manager 名（vars.*）でのみ参照し、ログ出力は非機密の識別子（イメージタグ・short SHA・サービス URL）のみ。テナント分離はドキュメントどおり物理デプロイ分離で成立しており、tenantId 改ざんによる単一デプロイ内の越境アクセスは不可能。

---
参考: 調査した上で「脆弱性ではない」と判定した防御強化候補（報告対象外・記録のみ）

ぬけもれチェックの透明性のため、検討して棄却または対応した2件を記録します。

1. （対応済み）デモワークフローの本番フォールバック — 以前は `.github/workflows/deploy-demo.yml` が `vars.DEMO_GCP_PROJECT_ID || vars.GCP_PROJECT_ID` 等で本番 Variables へ暗黙フォールバックしていた。現行は `DEMO_*` の明示設定を必須とし、本番 `GCP_PROJECT_ID` / `KNOWLEDGE_HUB_BUCKET` との衝突も validate ステップで拒否する（deploy-demo.yml:51–98）。誤設定による本番誤デプロイリスクは workflow 層で抑止済み。
2. （対応済み）転送ヘッダによる識別子偽装 — `prepareRequestAuthHeaders`（`src/lib/auth/prepareRequestAuthHeaders.ts`）がクライアント供給の `x-knowledge-hub-*` / `x-goog-authenticated-user-email` を JWT 検証前に delete し、検証成功時のみ email を set してから `x-knowledge-hub-*` を再付与。`resolveTenantIdFromAuth` は IAP email を forwarded より優先（resolveTenantIdFromAuth.ts:95–126）。テスト: `prepareRequestAuthHeaders.test.ts` / `middleware.test.ts`。将来マルチテナント SaaS 化時は、middleware バイパス経路の増加と `KNOWLEDGE_HUB_TENANT_ID` ピン有無を再評価すること。
---

## 観点② 認証・認可 / Cloud Tasks 署名

```
## 観点: 認証・認可と非同期ジョブの真正性
1デプロイ = 1クライアント組織の信頼境界。IAP OIDC（人間アクセス）と HMAC署名 Cloud Tasks payload（機械間）の真正性を検証する。
※初期運用は「全員全件閲覧可」が意図仕様。文書ごとの権限が無いこと自体は報告しない。owner/role gating コードが既に存在する場合のみ、その回避経路を見る。

### 対象
- IAP / OIDC 検証層（src/lib/ auth）
- Cloud Tasks enqueue / worker route（HMAC 署名生成・検証）、async Context Package job、reprocess endpoint

### チェック項目
1. worker route の HMAC 署名検証が constant-time か。署名なし/不正/古い署名を fail-closed で弾くか。署名対象に payload 全体（docId 等）が含まれ、部分署名すり替えが不可か。
2. 署名検証をバイパスする分岐（dev フラグ、署名欠如時の素通り、catch での continue）がないか。
3. IAP OIDC の audience（IAP OAuth client ID）/ issuer を実検証しているか。X-Goog-* 等のヘッダを無検証で信頼していないか。
4. reprocess / candidates / job-result 取得 endpoint が認証必須で、未認証で叩けないか（認証境界の有無。doc 単位の権限ではなく「デプロイの認証境界そのもの」を見る）。
5. （gating コードがある場合のみ）restricted / PII を含む文書や job 結果の owner/role チェックに回避経路がないか。
```
セキュリティレビュー結果 — 観点② 認証・認可 / Cloud Tasks 署名

結論: 該当なし（報告閾値 確信度8以上の High/Medium 脆弱性は検出せず）

調査対象の真正性メカニズムは、本プロジェクトの脅威モデル（1デプロイ=1クライアント信頼境界、IAP OIDC＝人間、HMAC署名 Cloud Tasks payload＝機械間）に対して fail-closed で一貫実装 されており、攻撃者が現に悪用できる具体的欠陥は見つからなかった。根拠を以下に要約する。

Cloud Tasks 署名（src/lib/pdfTableAssistTaskSigning.ts） — timingSafeEqual による長さ事前チェック付き定数時間比較（80–87行）、署名対象は docId/tenantId/actor(userId/ipAddress/userAgent)/issuedAt の全フィールドを決定論的 JSON（キーソート）で canonical 化（58–74行）、24時間の replay 窓（198–207行）。worker route（table-assist/run/route.ts）は URL の docId と署名 payload の docId を再照合（109行）するため、他文書の署名を流用した付け替えは不可。本番（NODE_ENV==='production'）では secret 未設定でも task_signature_required で 401（169–172行）＝fail-closed、enqueuer 側も assertTaskSigningConfiguredForEnqueue で本番未署名を拒否（enqueuer 144–148行）。署名検証をバイパスする fail-open は非本番かつ secret 未設定時のみで、本番経路には存在しない。

worker token gate — table-assist/run は token 未設定時に token gate を素通り（40–42行）するが、直後の署名検証が本番で fail-closed なので素通りは穴にならない。jobs/[jobId]/run（29行）と jobs/sweep（21–23行）は本番で token 必須（fail-closed）。catch での素通り（continue）や dev フラグによる検証無効化は無い。

IAP OIDC（`src/lib/auth/verifyIapJwt.ts` + `src/lib/auth/prepareRequestAuthHeaders.ts` + `src/middleware.ts`） — jose の jwtVerify で audience（IAP OAuth client ID）と issuer（`https://cloud.google.com/iap`）を実検証（verifyIapJwt.ts:66–69行）。`prepareRequestAuthHeaders` がクライアント供給の `x-knowledge-hub-*` / `x-goog-authenticated-user-email` を検証前に delete し、JWT 検証成功時のみ email を set してから `x-knowledge-hub-*` を再付与。`AUTH_MODE==='iap'` では assertion 欠如・検証失敗・未検証 identity いずれも middleware catch で 401（middleware.ts:31–37行）＝未認証の外部到達は fail-closed。matcher は全 API route を包含（middleware.ts:42–44行）。

認証境界と既存 gating — jobs/[jobId]/result・/status・DELETE は job.request.tenantId !== tenantId で存在秘匿 404（result 27行 / status 51行 / 95行）。GCS offload result の読み取りは resultRef.objectPath を期待パスと一致検証＋オブジェクト metadata の tenantId/jobId クロスチェック（resultStorage.ts 76–92行）、パスは encodeURIComponent（7–12行）でパストラバーサル不可。

---
参考: 報告閾値未満（確信度 < 8、修正は任意）

完全性のため、過去に除外した観察のうち対応済みのものを1点記す。

- （対応済み）転送ヘッダ・未検証 IAP email による identity 詐称 — `prepareRequestAuthHeaders`（`src/lib/auth/prepareRequestAuthHeaders.ts`）が検証前にクライアント供給の `x-knowledge-hub-*` / `x-goog-authenticated-user-email` を delete し、JWT 検証成功時のみ email を set してから `x-knowledge-hub-*` を再付与。`middleware.ts` は同関数を呼び出し、失敗時は 401。`resolveTenantIdFromAuth` は IAP email を forwarded より優先。テスト: `prepareRequestAuthHeaders.test.ts` / `middleware.test.ts`。`IAP_JWT_AUDIENCE` 未設定時も unsigned ヘッダは信頼せず fail-closed（起動時 warn のみ）。
---

## 観点③ PII・マスキング安全性 / 生PII at-rest

```
## 観点: PII保護とマスキングの不変条件
masking/exclusion は product-critical。over-mask は許容、under-mask（生PII流出）は hard-fail という非対称が守られているかを検証する。

### 対象
- src/agents/masker/ , src/lib/columnSensitivityRules.ts
- safety gate（unmaskablePiiFindings.count >= 1 → restricted、restrictionSource:'safety_gate'。orchestratePdfPath の curator直後・aiUsePolicy分岐前）
- 生PII保持面: GCS raw/ prefix（DocumentIR snapshot + 元アップロード）、lifecycle delete、attachContextPackageBodies / regenerateChunksForDoc の raw 読み
- masked/{docId}/ 本文 prefix

### チェック項目
1. safety gate が全生成経路（特に aiUsePolicy='direct'＝masker非通過 経路）で効いているか。gate を迂回して生PII が chunk/IR snapshot/eval に新規に残る経路がないか。
2. restricted / excluded 文書が Context Package / candidates / export のいずれかに本文として漏れないか（exclusion は「断言」のはずが「予測」に落ちていないか）。
3. masker の under-mask（検出漏れ）が fail-open になっていないか。例外時に未マスク本文が下流へ流れないか。
4. raw/ の生PII が想定外の status / 経路で読み出され、ai_safe/export に混入しないか。
5. ログ・エラーメッセージ・API レスポンスに生PII（人名/マイナンバー様12桁/顧客情報）が出ていないか。
```
セキュリティレビュー結果（観点③ PII・マスキング安全性 / 生PII at-rest）

前提：このブランチの差分について

git diff（コミット差分）は空です。ブランチ上の唯一の変更は未追跡の docs/security-review-prompts.md（ドキュメント＝レビュー対象外）のみで、レビュー可能なコード変更はありません。指示どおり「リポジトリ全体」を対象に、PII・マスキングの不変条件に絞って生成経路・export 経路・raw at-rest 経路を精読しました。

該当なし

確信度8以上の High/Medium 脆弱性は検出されませんでした。

根拠：観点③のチェック項目5点すべてについて、悪用可能な具体的欠陥を発見できませんでした。トレースした各経路は多層の fail-closed 防御で守られています — ①安全ゲートの網羅性: orchestratePdfPath（src/lib/uploadOrchestrator/pdfPath.ts:263）の unmaskablePiiFindingsCount >= 1 ゲートは aiUsePolicy 分岐より前に置かれ、Masker を通らない direct 経路も含めて restrict する。restrict 時は DocumentIR snapshot・health eval・chunk 生成をいずれもスキップし、生PII を新規アーティファクトに残さない。②export での未マスク露出防止: includedBodyForChunk（toContextPackage.ts:43）は requires_masking chunk に maskedText が無い場合 raw text を返さず例外を投げる（fail-closed）。buildChunkAwareContextPackageExportInput（contextPackageInput.ts:227,231）は親が restricted/blocked の chunk と chunk-level Restricted/blocked を二重に除外。③JSON 境界: responseView.ts の projection が included を AI-safe 本文のみに、excluded/safetyExcluded をメタデータのみに落とし、StrategistChunkSelection が保持する raw text を API 応答へ載せない。④raw/ 読み出し: contextPackageBodyObjectPath（contextPackageFirestoreAdapter.ts:36）は curated＋非マスクのみ raw を読み、requires_masking/maskingPending/restricted/blocked には null を返す。ai_safe は masked オブジェクト（aiSafeStoragePath）のみ。⑤Masker の fail-open 不在: provider 失敗（applyMask）・per-chunk マスク失敗・Firestore 更新失敗はすべて例外伝播し、ai_safe コミットをロールバックして MaskerPhaseError を投げる（phases.ts:363, pdfPath.ts:402-408）。決定論マスカの検出漏れは maskerRiskFlow（masked 本文に対する残余リスク判定→Restricted 昇格）が backstop。⑥周辺経路: 候補 API は metadata-only（selectCandidates.ts、本文・GCS・LLM 不参照）、async job 結果は buildContextPackageResponsePayload の安全 projection のみを保存（schema.ts:68「raw chunk.text は含めない」）、table-assist 再処理は raw hash 照合後に同一 orchestratePdfPath ゲートを再適用し restricted/blocked 時は chunk を消去（pdfTableAssistReprocessor.ts:343,398）。ログ・エラーメッセージに人名/マイナンバー様/顧客情報の出力は確認されず（console.* は error オブジェクトと非PIIのみ）。

補足（脆弱性ではないが審査前の留意点）

- 検出品質の限界は残る（コード欠陥ではない）: 決定論マスカと maskerRiskFlow の両層が同一PIIを取りこぼす場合のみ生PIIが ai_safe に残り得ます。これは ruleset/モデルの検出精度の問題であり、本レビュー（悪用可能なコード欠陥）の対象外です。既存の eval:p1d:masker-drift（piiLeakCount を hard-fail）でカバーする運用継続を推奨します。
- MASKER_PROVIDER: 本番 deploy workflow（`deploy.yml`）は未設定時 **`cloud-dlp`** を Cloud Run へ注入。ランタイムコード（`provider.ts:15`）は env 未設定時 `simple-rule` が既定のため、Cloud Run 外（ローカル等）では弱いマスカになりうる。env は信頼値扱いのため脆弱性として報告はしないが、本番 deploy 後は Cloud Run env で `MASKER_PROVIDER=cloud-dlp` を確認すること。
---

## 観点④ 入力検証・インジェクション

```
## 観点: 入力検証とインジェクション
ユーザー入力（アップロードファイル、purpose、docId、Google Sheets/Docs URL/ID）が sink に届くまでのデータフローを追う。

### 対象
- Upload: src/lib/uploadOrchestrator.ts, src/app/upload/, src/app/api/documents/
- Google import: src/lib/googleSheetsSnapshotImporter.ts, src/app/import/google-sheets/, src/app/api/import/google-sheets/
- API route の入力 schema 検証（Zod 等）
- Firestore クエリ構築

### チェック項目
1. アップロード: fileName / path にパストラバーサル（../, 絶対パス, NULバイト）が入り、GCS key やローカル一時パスを脱出できないか。content-type / 拡張子の検証。
2. Google Sheets/Docs import: 与えられた URL/ID から Drive を読む際、ID/URL 検証が甘く、想定外リソース（他者の Drive、内部 metadata エンドポイント）へ到達できないか（host/protocol を制御できる SSRF のみ対象）。
3. API route の body/query が Zod 等で検証されず、型・範囲外値が下流（Firestore, GCS, LLM 呼び出し）に届かないか。
4. Firestore: ユーザー入力がコレクション名 / ドキュメントパス / フィールドパスに連結され、意図外クエリにならないか。
5. （prompt injection は「AI system prompt にユーザー入力を含めること自体」は対象外。ただし文書本文経由で exclusion/safety 判定をコード側で覆せる経路があれば報告。）
```

セキュリティレビュー結果 — 観点④ 入力検証・インジェクション

対象スコープ（リポジトリ全体、入力検証/インジェクション）を、アップロード・Google import・API route 入力検証・Firestore クエリ構築・本文経由の判定迂回の各データフローについて、ユーザー入力が sink へ届くまで追跡しました。

結論: 該当なし（High/Medium・確信度8以上の報告対象なし）

精査の結果、確信度8以上で「現に悪用可能」な High/Medium の脆弱性は検出されませんでした。根拠は以下のとおりです。各観点の sink がいずれも既存の防御で塞がれており、攻撃者制御の入力が危険な操作へ素通りする経路を確認できませんでした。

① アップロードのパストラバーサル — 防御済み。 file.name（攻撃者制御）は GCS キー化の前に sanitizeOriginalFileName()（src/lib/documents.ts:63）で /・\ を _ に置換し NUL を除去します。さらにオブジェクトパスは raw/{docId}/... / masked/{docId}/... 形式で、docId は randomUUID()（orchestrate.ts:76）です。区切り文字が無効化されるためバケット内 prefix を脱出できず、拡張子（getAllowedExtension）・MIME（isAllowedMimeType）・UTF-8/XLSX 解析も検証済みです。

② Google Sheets/Docs import の SSRF — 該当なし。 urlOrFileId は parseGoogleSheetsInput/parseGoogleDocsInput で fileId を /^[a-zA-Z0-9_-]{20,}$/（googleSheetsSnapshotImporter.ts:91, googleDocsSnapshotImporter.ts:52）に厳格制限し、drive.files.get/export({ fileId }) 経由で常に googleapis.com の Drive API を叩きます。攻撃者が制御できるのは fileId（パス相当）のみで、host/protocol は制御不能のため、報告対象の SSRF（host/protocol 制御）に該当しません。

③ API route の入力検証 — Zod で網羅。 POST /api/context-package（purpose ≤2000, docIds は要素 ≤200・件数上限, limit/mode enum）、/candidates、/import/google-sheets、/jobs/sweep はいずれも z.safeParse で型・範囲・列挙を検証してから下流へ渡しています。curator route も CuratorInput.safeParse でゲートします。

④ Firestore クエリ構築 — 注入面なし。 ユーザー入力はコレクション名・フィールドパスに連結されず、固定コレクション（documents/auditEvents/jobs）の .doc(<UUID もしくは Zod 検証済み id>) と .where('<固定フィールド>', '==', value) のみで使われます。GCS オフロード結果パスも encodeURIComponent()（resultStorage.ts）でセグメントを符号化します。

⑤ 本文経由の判定迂回 — 該当なし。 exclusion/safety 判定はコード側では curator 出力の sensitivity と安全ゲート（unmaskablePiiFindings.count >= 1 → restricted）に基づき、文書本文テキストが真偽値を直接反転させるコード経路は存在しません（LLM プロンプトへの本文混入自体は対象外）。加えて XSS sink（dangerouslySetInnerHTML 等）・eval/child_process への攻撃者入力経路も無し。HMAC 署名（pdfTableAssistTaskSigning.ts）と worker トークン照合は timingSafeEqual を使用。

検討したが報告対象外（参考）

観測: （対応済み）`prepareRequestAuthHeaders` / `middleware` がクライアント供給の `x-knowledge-hub-*` / `x-goog-authenticated-user-email` を JWT 検証前に剥がし、検証成功時のみ identity を付与するため、本番 IAP 経路でのヘッダ詐称は成立しない
箇所: `src/lib/auth/prepareRequestAuthHeaders.ts` / `src/middleware.ts`
報告しない理由: hardening 済み。`resolveTenantIdFromAuth` の forwarded 分岐（resolveTenantIdFromAuth.ts:109–126）は middleware 済みヘッダ用の残存パス。middleware をバイパスする直接呼び出しが増えた場合のみ再検討。`AUTH_MODE=local` の公開デモは認証なし前提で別脅威モデル
────────────────────────────────────────
観測: 非同期 worker トークン照合が === で非定数時間
箇所: jobs/[jobId]/run/route.ts:31
報告しない理由: ネットワーク越しのトークン timing
  攻撃は実用的でなく、IAP/OIDC + 署名の多層で保護。理論的
   timing として除外
────────────────────────────────────────
観測: 署名未設定かつ NODE_ENV 非 production 時に
  table-assist worker が無署名 payload を受理
箇所: pdfTableAssistTaskSigning.ts:127
報告しない理由: 成立条件が env（信頼値）依存。本番は
  NODE_ENV=production で署名必須となるため除外
---

## 観点⑤ 出力・配信境界 / zip 生成

```
## 観点: Context Package 出力と source bundle の配信境界
「使える/除外/足りない/確認」の4分類境界と、NotebookLM 用 source bundle zip 生成の安全性を検証する。

### 対象
- src/lib/exportContextPackage.ts（markdown + source 分割 bundle）
- source bundle zip 生成（included 各=個別生ソース + 00-CONTEXT-PACKAGE-GUIDE.md、excluded は source 不在）
- download / copy endpoint、client zip（fflate 等）

### チェック項目
1. zip 生成時、エントリ名がユーザー由来（fileName）でパストラバーサル/zip-slip 的なエントリ（../, 絶対パス）を作れないか。
2. excluded / restricted 文書のソースが「source 不在」のはずが、bundle や markdown に本文として混入する経路がないか。
3. download endpoint が呼び出し主体の認証境界を検証しているか（job-result/bundle の直リンクで、認可されていない呼び出しが成果物を取得できないか）。
4. export に含めるべきでない内部 metadata（生PII findings 詳細、内部パス、署名鍵）が markdown/guide に書き出されていないか。
```

セキュリティレビュー結果（観点⑤ 出力・配信境界 / zip 生成）

結論: 該当なし（High/Medium・確信度 8 以上の脆弱性なし）

識別サブタスクが、ユーザー由来の入力（アップロード fileName・文書本文・リクエストパラメータ・purpose）から、zip エントリ生成・本文混入・成果物配信までのデータフローを精査した結果、確信度 7 以上の悪用可能な脆弱性は検出されなかったため、確信度 8 以上を対象とする本レポートには報告すべき finding はありません。各チェック項目について、現コードが具体的にどう防御しているかを以下に根拠として示します。

チェック1（zip-slip / パストラバーサル）: bundle のエントリ名はサーバ側 exportContextPackageSourceBundle（src/lib/exportContextPackage.ts:475）が生成し、included 文書名は dedupeFileName → sanitizeSourceBundleFileName（exportContextPackage.ts:332）→ sanitizeOriginalFileName（src/lib/documents.ts:63）を必ず通る。/ \ を _ 化、null byte 除去、.. の畳み込み、先頭ドット・末尾ドット/空白除去、Windows 予約名拒否まで行うため、../../etc/passwd 等は平坦な無害名に縮退する。guide 名は定数。クライアント zip writer（src/app/context-package/sourceBundleZip.ts:96）は file.fileName を生で使うが、その唯一の生成元はサーバ payload builder（contextPackagePayload.ts:21）であり、区切り文字・絶対パス・ドライブレターがエントリ名まで生き残る経路はない。

チェック2（excluded/restricted 本文の混入）: runSafetyGate（src/agents/strategist/safetyGate.ts:56）が strategist 選定前に Restricted/blocked/maskedText 欠落の requires_masking を決定論的に除去するため included には安全 chunk のみが残る。本文は includedBodyForChunk（toContextPackage.ts:43）のみが供給し、requires_masking は maskedText を返し、欠落時は生本文を出さず throw する。excluded 文書は markdown・bundle とも「source 不在（exclusion by absence）」でメタデータのみ。JSON 射影層（responseView.ts）も included→aiSafeContent のみ、excluded→本文なしで同一不変条件を強制している。

チェック3（download endpoint の認可境界）: jobs/[jobId]/result（.../result/route.ts:26）他は auditActorFromRequest → resolveTenantIdFromAuth で呼び出し主体を解決し、job.request.tenantId !== tenantId で 404（存在自体を秘匿、jobId は UUID）。offload reader readContextPackageJobResult（resultStorage.ts:61）は tenantId+jobId から期待 GCS objectPath を再導出し、resultRef の objectPath/カスタムメタデータ不一致を拒否するため、偽造 resultRef による別オブジェクト読み出しは不可。worker run は OIDC + 共有シークレットトークンで保護（run/route.ts:25）。

チェック4（内部メタデータの書き出し）: markdown / 00-CONTEXT-PACKAGE-GUIDE.md が出すのは purpose・件数・日付・ファイル名・除外理由・sensitivity enum・missing knowledge・questions のみ。生 PII findings の詳細、内部ファイルシステム/GCS パス、署名鍵・シークレットは一切書き出されない。reason 文字列は safety-gate コードまたは strategist rationale であり文書本文ではない。プレビューは React エスケープ済み <pre>{markdown}</pre> で描画され、dangerouslySetInnerHTML/innerHTML の sink は存在しない。

---
参考（閾値未満・現スコープ外、findings ではない）

最終チェックの網羅性のため、確信度 7 未満かつ現行スコープ（per-client シングルテナント）で報告対象外と判断した観察を 2 点記録します。いずれも提出ブロッカーではありません。

- （対応済み）転送ヘッダ信頼 — `prepareRequestAuthHeaders` が IAP モードでクライアント供給ヘッダを剥がし JWT 検証済み identity のみを `x-knowledge-hub-*` へ束ねる（`prepareRequestAuthHeaders.ts` / `middleware.ts`）。`resolveTenantIdFromAuth` は IAP email を forwarded より優先（resolveTenantIdFromAuth.ts:95–126）。将来マルチテナント化時は middleware バイパス経路の有無を再評価すること（既知債務 #54/#49）。
- GET /api/documents/[docId]（src/app/api/documents/[docId]/route.ts:19）が job routes と異なり tenant チェックを持たない（IAP + demo-mode フィルタのみ依存）。返すのはメタデータのみ（本文/PII text なし）で、シングルテナントでは moot のため authz 一貫性のメモに留める。
---

## 観点⑥ シークレット・暗号

```
## 観点: シークレットと暗号処理
HMAC 鍵 / service account / 署名・乱数の扱いを検証する（ディスク保存そのものは対象外、コード上の誤用が対象）。
※ per-client デプロイのため、ハードコード鍵は観点①（イメージ焼き込み）と相互に重大。

### 対象
- HMAC 署名鍵の取得・利用箇所（Cloud Tasks payload 署名）
- service account / Vertex AI / DLP クレデンシャルの取得
- 署名検証・トークン比較・乱数生成

### チェック項目
1. HMAC/署名鍵やAPIキーがソースにハードコードされていないか（env / Secret Manager 経由が正、リテラル混入を探す）。
2. 署名・トークンの比較が非 constant-time（=== や単純比較）でタイミング差を生まないか。
3. セキュリティ用途の乱数に Math.random 等の非暗号論的乱数を使っていないか（トークン/nonce/ID）。
4. 弱いハッシュ/アルゴリズム（MD5/SHA1 を完全性・署名目的で）を使っていないか。
5. クレデンシャルやトークンがレスポンス/ログ/エラーに出ていないか。
```
セキュリティレビュー結果 — 観点⑥（シークレットと暗号処理）

該当なし（High / Medium 0件）

観点⑥のチェック項目1〜5を、Cloud Tasks payload の HMAC 署名経路・worker 共有トークン検証・IAP JWT 検証・ID/nonce 生成・ハッシュ利用の全コードパスについて精読した結果、>80%確信で悪用可能な High/Medium の欠陥は検出されなかった。署名鍵・トークンはすべて process.env 経由でソースにリテラル混入がなく、トークン・署名の比較は node:crypto の timingSafeEqual（長さ事前チェック付き＝timingSafeEqual が長さ不一致で throw する仕様への正しい防御）で constant-time、ID・nonce はすべて CSPRNG（randomUUID / randomBytes）で生成され Math.random は production コードに皆無、署名・完全性目的のハッシュはすべて HMAC-SHA256 / SHA-256 で MD5・SHA1 の誤用なし、エラー・ログ・レスポンスにシークレットやトークン値の漏洩は確認されなかった。よって審査前の最終チェックとして、観点⑥に関するブロッカーは無いと判断する。

検証根拠（確認済み事項）

チェック項目: 1. ハードコード鍵/APIキー
確認箇所: pdfTableAssistTaskSigning.ts:38-44（署名鍵）、enqueuer
  :113-115、table-assist/run/route.ts:31-33、sweep/route.ts:20
結果: ✅ 全て process.env 経由。リテラル混入なし
────────────────────────────────────────
チェック項目: 2. 非 constant-time 比較
確認箇所: 署名: pdfTableAssistTaskSigning.ts:80-87 /
  worker token: table-assist/run/route.ts:21-28 / sweep
  token: sweep/route.ts:26-29
結果: ✅ いずれも長さガード＋timingSafeEqual
────────────────────────────────────────
チェック項目: 3. 非暗号論的乱数
確認箇所: randomUUID（jobId/docId/leaseId/attemptToken）、randomBytes(8)（audit
  auditEvent.ts:224）。Math.random 検索＝production 0件
結果: ✅ CSPRNG のみ
────────────────────────────────────────
チェック項目: 4. 弱いハッシュ/アルゴリズム
確認箇所: HMAC: createHmac('sha256', …) :77 / 全
  createHash は SHA-256（auditEvent.ts:244,
  knowledgeChunkSchema.ts:144, firestoreSchema.ts:219,
  simpleMasker.ts:181）
結果: ✅ MD5/SHA1 なし
────────────────────────────────────────
チェック項目: 5.
  クレデンシャル/トークンのログ・レスポンス露出
確認箇所: table-assist/run/route.ts:138（docId+error
  のみ）、sweep/route.ts:62,65、API レスポンス全件
結果: ✅ 署名・トークン値の出力なし

補足（誤検知として除外した観察点）

- attemptToken の === 比較（contextPackageJobs/firestoreAdapter.ts:206,231）: lease 所有権の楽観排他チェック。randomUUID（122bit）をサーバ側 Firestore に保存し外部送信しないため、timing oracle 対象ではない。UUID は推測不能（除外規約準拠）。脆弱性ではない。
- worker token 未設定時に isAuthorized が true を返す（table-assist/run/route.ts:40）: 意図的な defense-in-depth 設計で、本番では verifyPdfTableAssistTaskPayload の署名ゲート（NODE_ENV==='production' で必須）が独立に閉じる。env 値は信頼前提（除外規約準拠）のため認証バイパスにあたらない。
- IAP JWT 検証（auth/verifyIapJwt.ts）: jose の jwtVerify で audience + issuer + remote JWK を検証する標準実装。誤用なし。