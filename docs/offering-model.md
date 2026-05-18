# 提供形態メモ

> 作成: 2026-05-18  
> 背景: 機密文書や士業顧客情報を扱うプロダクトは、Managed SaaS だけを前提にすると導入心理・契約・監査の壁が高い。機能ロードマップとは別に、顧客が選べる信頼境界として提供形態を整理する。

---

## 1. 基本方針

AI-Ready Knowledge Hub は、NotebookLM / Gemini / RAG の前段で、社内文書を分類・マスキングし、目的別 Context Package に変換する。扱うデータには個人情報、顧客情報、契約情報、暗黙知が含まれうるため、将来の商用提供では **顧客の慎重さに応じた複数の提供形態**を用意する。

**基本方針:**

> Managed SaaS を入口にしつつ、士業・法人の本命は Dedicated SaaS / Private deployment として設計する。さらに厳格な顧客には Customer-managed / sanitized ingress を将来オプションとして残す。

---

## 2. 提供形態

| 提供形態 | 想定顧客 | 説明 | 主な ProcessingProfile |
|---|---|---|---|
| Managed SaaS | ライトな顧客、試用、低リスク資料から始める SME | 当社管理環境で文書を受け、Cloud DLP + Masker を通して Context Package を作る。導入が速い。 | `cloud-managed` |
| Dedicated SaaS / Private deployment | 士業・法人の本命顧客 | 顧客専用の GCP project / Cloud Run / Firestore / GCS などで運用する。運用は当社が持つが、環境は専用化する。 | `cloud-managed` の専用環境 |
| Customer-managed / BYOC | 情シス・監査要件が強い顧客 | 顧客クラウド環境内にデプロイし、顧客がインフラ境界を管理する。導入・運用は重いが信頼境界を説明しやすい。 | 将来 `customer-managed` 候補 |
| Sanitized ingress / Edge Sanitizer | 生データを当社境界に入れられない顧客 | 顧客側でサニタイズ済み payload を作り、当社側はマスク済み chunk と境界証跡だけを受け取る。 | `cloud-sanitized-ingress` |

---

## 3. 推奨する商用導線

### 3.1 Managed SaaS

低リスク資料・匿名化済み資料・テンプレート・社内手順書から始める入口。

訴求:

> まずは文書を入れて、AI に渡せる Context Package を作りましょう。

注意点:

- 実顧客の契約書、給与資料、マイナンバーに近い資料を最初から預かる前提にしない。
- トライアルではサンプルデータ、匿名化済みデータ、テンプレートを推奨する。
- `cloud-managed` の DLP / AuditEvent / purpose binding を信頼材料として説明する。

### 3.2 Dedicated SaaS / Private deployment

士業・法人向けの本命。

訴求:

> 御社専用環境で、社内文書を AI-ready に変換できます。

想定:

- 顧客ごとの専用 GCP project または専用 Cloud Run / Firestore / GCS。
- 専用 service account、専用ログ、専用バケット、リージョン固定。
- 運用は当社が支援するが、他顧客との論理・物理分離を強く説明できる。

この形は、Managed SaaS より信頼しやすく、Customer-managed より導入が軽い。商用化時の最初の高単価プラン候補とする。

### 3.3 Customer-managed / BYOC

顧客がクラウド環境を管理したい場合の将来形。

訴求:

> 御社のクラウド環境内にデプロイできます。

注意点:

- Terraform、アップデート、監視、障害対応、権限設計、サポート境界が重い。
- MVP / ハッカソン提出時点の主戦場にしない。
- 将来 `ProcessingProfile` に `customer-managed` を追加するかは、Dedicated SaaS の商談実績を見て判断する。

### 3.4 Sanitized ingress

Phase 3-E で contract-only として予約した高セキュリティ profile。

訴求:

> 生データは御社環境から出しません。マスク済み chunk と証跡だけを受け取ります。

注意点:

- Edge Sanitizer、顧客側 deploy、認証、boundary evidence、correlationId、未マスク疑い reject が必要。
- 導入ハードルが高いため、最初の売り物ではなく Enterprise option として扱う。
- Phase 3-G で prototype する候補。

---

## 4. ロードマップとの関係

| Phase | 提供形態との関係 |
|---|---|
| Phase 3-E | `cloud-managed` を標準 ProcessingProfile として固定。`cloud-sanitized-ingress` は contract-only。 |
| Phase 3-H | PDF / Slide / 画像の構造化で、提供形態に関わらずプロダクト本体価値を伸ばす。 |
| Phase 3-G | `cloud-sanitized-ingress` prototype。高セキュリティ顧客向け。 |
| Phase 4 | Dedicated SaaS / Customer-managed / write-once audit / CMEK / VPC-SC を商用要件として検討。 |

---

## 5. 現時点の判断

提出まで一ヶ月以上ある現時点では、提供形態の不安は本ドキュメントと Phase 3-E の ProcessingProfile で受け止める。一方で、次に実装価値が大きいのは、顧客が実際に持っている PDF / Slide / 画像を扱えるようにする Phase 3-H である。

したがって、次フェーズの実装優先度は次の順とする。

1. Phase 3-H: Document Conversion PoC
2. Phase 3-F: Document Conversion を含むデモ polish
3. Phase 3-G: Sanitized ingress prototype
4. Phase 4: Dedicated / customer-managed 商用設計

---

## 関連ドキュメント

- [phase-3-e-direction.md](phase-3-e-direction.md) — ProcessingProfile / Cloud DLP Trust Modes
- [phase-3-h-direction.md](phase-3-h-direction.md) — Document Conversion PoC
- [open-questions.md](open-questions.md) — 未決定事項
