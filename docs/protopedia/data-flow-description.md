# データフロー（Protopedia 提出用）

データの流れは大きく2系統です。**① 文書アップロード処理**で社内文書を安全な状態へ整え、**② 目的クエリ**で目的に合わせた Context Package を生成します。

## ① 文書アップロード処理（POST /api/documents → uploadOrchestrator）

HTTP 境界（`POST /api/documents`）は multipart の検証だけを担当し、副作用の順序はすべて **uploadOrchestrator** に委ねます。

1. **受信・検証** — 件数・サイズ・拡張子・MIME・UTF-8 / XLSX 解析を検証（[A]）
2. **原本を保存** — Cloud Storage の `raw/{docId}/…` に保存（正本は GCS）（[B]）
3. **メタデータ作成** — Firestore の `documents/{docId}` を作成し、status を `uploaded → curating` へ遷移（[C][D]）
4. **Curator 分類** — 種別・業務領域・機密度を判定し、AI 利用方針を `direct / blocked / requires_masking` に派生（[E]）
5. **Masker（必要時）** — `requires_masking` のときだけ Cloud DLP + Gemini で PII をマスクし、残存リスクを再評価（[G]）
6. **UI へ応答** — 結果（`curated / blocked / ai_safe / restricted`）を直列化して返却（[H]）

**安全性の要は rollback と状態遷移**です。いずれかの段階で失敗した場合、GCS と Firestore を逆順に rollback delete し、成功側の監査ブロックは保持します。文書の終端状態は `curated`（Curator だけで AI 参照可）・`blocked`（AI 参照不可）・`ai_safe`（マスク後に AI 参照版あり）・`restricted`（Masker が機密度を格上げ）・`failed` の5つです。

## ② 目的クエリ → Context Package 生成

1. **目的を入力** — 自然言語の purpose（例:「月次の給与計算業務を安全に学べる AI を作りたい」）
2. **候補を抽出** — `POST /api/context-package/candidates`。Firestore の Inventory から候補を選定する **metadata-only の助言レイヤ**で、本文・LLM・GCS は読みません
3. **候補を確認** — 「使う / 除外 / 要確認」と不足情報のヒントを提示
4. **文書を選択** — 生成前に、人間が include する docId を選ぶ
5. **生成** — `POST /api/context-package` → safetyGate → Strategist
6. **Context Package** — 「使える / 除外 / 不足 / 確認質問」を整理し、Markdown または NotebookLM 用 source bundle（.zip）として Export

**Restricted 文書は自動除外**されます（アップロード処理の格上げ結果 A8 を尊重）。除外文書は理由付きで Excluded に列挙し、本文は下流 AI に渡しません。候補抽出を metadata-only に保つことで、生成前に人間が安全に確認できる前段を実現しています。
