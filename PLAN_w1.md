# W1-1: Genkit + Vertex AI 最小 PoC 実装プラン

## 0. Context

Week 1 (5/5-5/11) は **「実装完成」ではなく「技術リスク検証」** の位置づけ (`docs/open-questions.md` R9)。今日 5/8 から残り 3 日 (5/9・5/10・5/11) で W1-1〜W1-4 の検証を回す。

W1-1 が検証する **唯一の問い**:
> Genkit + `@genkit-ai/vertexai` + Gemini 2.5 Flash + Zod で、**Curator 6 項目の構造化 JSON** が Zod 検証を通る形で安定して返ってくるか。

通れば `docs/decisions.md` D1 (Genkit 本採用) に確信。通らなければ D1 撤退条件 (Vertex AI SDK 直接 hand-roll) に切替材料となる。

**スコープ外** (W1-2 以降で別建て): Cloud Storage / Firestore / DLP / Next.js / A8 残存リスク / A9 Markdown export / Curator eval。

## 1. 確定済み判断 (本セッションで合意)

1. **PoC 場所**: `poc/w1/` 配下に隔離。`src/` 本体に仮コードを混ぜない
2. **移植前提で production 品質で書くもの**: Zod schema / prompt / TS type / 純関数
3. **モデル**: Gemini 2.5 Flash で開始 (Pro 切替は Week 3-4)
4. **スキーマ粒度**: Curator 6 項目フル
5. **GCP**: プロジェクトもこれから作成。リージョン `asia-northeast1` 固定

## 2. GCP セットアップ (5/9 AM)

```bash
export PROJECT_ID="ai-ready-knowledge-hub"

# 2.1 プロジェクト作成
gcloud projects create "$PROJECT_ID" --name="AI-Ready Knowledge Hub" --set-as-default

# 2.2 課金紐付け (BILLING_ACCOUNT_ID は `gcloud billing accounts list` で確認)
gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT_ID"

# 2.3 Vertex AI API 有効化
gcloud config set project "$PROJECT_ID"
gcloud services enable aiplatform.googleapis.com

# 2.4 ADC 設定
gcloud auth application-default login
gcloud auth application-default set-quota-project "$PROJECT_ID"
```

**実装着手時に必ず確認 (Plan agent が WebFetch ブロックで未確認)**:
- `https://genkit.dev/docs/plugins/vertex-ai/` で `vertexAI.model('gemini-2.5-flash')` 形式のモデル指定が現在の TypeScript API で有効か
- `ai.generate({ output: { schema: ... } })` で responseSchema が立つか、別キー名か
- `asia-northeast1` で Gemini 2.5 Flash が利用できること（本プロジェクトでは確定済み）。PoC は `gemini-2.5-flash` のみとし、レガシー世代モデルへのフォールバックは設けない。

## 3. poc/w1/ ディレクトリ構造

```
poc/w1/
├── package.json              # genkit, @genkit-ai/google-genai, zod, tsx, typescript
├── tsconfig.json             # ES2022, strict, noEmit (tsx で実行)
├── .env.local                # GOOGLE_CLOUD_PROJECT, GOOGLE_CLOUD_LOCATION (gitignore)
├── .gitignore                # node_modules, .env.local, .genkit
├── README.md                 # 検証手順 + Week 2 引き継ぎ
├── src/
│   ├── curatorSchema.ts      # [移植対象] Zod 6項目
│   ├── curatorPrompt.ts      # [移植対象] system / user prompt builder
│   ├── curatorFlow.ts        # [捨てる]   Genkit flow 配線
│   └── runCurator.ts         # [捨てる]   検証用 main
└── sample/
    └── sample-doc.txt        # sample-data/accounting-office/年末調整_案内文.txt をコピー
```

`package.json` 主要依存: `genkit ^1.0.0`, `@genkit-ai/google-genai ^1.0.0`, `zod ^3.23.0`, `dotenv ^16.4.0`, devDeps `tsx`, `typescript`, `@types/node`, `genkit-cli`。

## 4. 主要ファイル内容方針

### 4.1 `src/curatorSchema.ts` (移植対象 / production 品質)

Zod 6 項目 + 判定根拠 + `refine` で機密度↔AI利用ポリシーの整合性検証。`describe` で各フィールドに日本語注釈。

PoC 用に enum を **暫定確定** (R5):
- `documentType`: 契約書 / テンプレート / 案内文 / メモ / チェックリスト / 表 / 規程 / その他
- `businessDomain`: 顧問契約管理 / 給与計算 / 年末調整 / 就業規則 / 助成金相談 / 顧客対応 / 法改正対応 / 社内手順 / 教育・研修 / 料金管理 / その他 (R5 候補に「料金管理」追加 — 料金表が「その他」に落ちないように)
- `sensitivity`: Public / Internal / Confidential / Restricted (A3 確定済み)
- `freshness`: current / superseded_candidate
- `isAuthoritativeCandidate`: boolean
- `aiUsePolicy`: direct / requires_masking / blocked
  - Public/Internal → `direct`
  - Confidential → `requires_masking` (Masker でAI参照可能版へ変換する対象)
  - Restricted → `blocked`
  - `refine` で sensitivity ↔ aiUsePolicy の整合性を検証
- `rationale`: string (1-3 文の判定根拠 — eval 時のデバッグ用)

### 4.2 `src/curatorPrompt.ts` (移植対象 / production 品質)

`CURATOR_SYSTEM_PROMPT` (system) + `buildCuratorUserPrompt({fileName, content})` (user)。

system は 6 項目それぞれの判定基準と enum 値を全て埋め込む。「JSON only、enum 完全一致、表記揺れ厳禁」を強調。

### 4.3 `src/curatorFlow.ts` (捨てる / PoC 配線)

```ts
import { genkit } from 'genkit';
import { vertexAI } from '@genkit-ai/google-genai';

const modelId = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

export const ai = genkit({
  plugins: [vertexAI({
    location: process.env.GOOGLE_CLOUD_LOCATION ?? 'asia-northeast1',
    projectId: process.env.GOOGLE_CLOUD_PROJECT,
  })],
  model: vertexAI.model(modelId),
});

export const curatorFlow = ai.defineFlow(
  { name: 'curatorFlow', inputSchema: CuratorInput, outputSchema: CuratorOutput },
  async (input) => {
    const { output } = await ai.generate({
      system: CURATOR_SYSTEM_PROMPT,
      prompt: buildCuratorUserPrompt(input),
      output: { schema: CuratorOutput },
      config: { temperature: 0.0 },
    });
    if (!output) throw new Error('no structured output');
    return output;
  },
);
```

**Fallback**: `output.schema` が動かない場合は `text` 取得 → `responseMimeType: 'application/json'` config + 自前 `JSON.parse` → `CuratorOutput.parse()`。

### 4.4 `src/runCurator.ts` (捨てる / 検証エントリ)

`process.argv[2]` でファイルパスを受け、`readFile` → `curatorFlow({fileName, content})` → `console.log(JSON.stringify(result, null, 2))`。

## 5. 検証手順 (5/10)

```bash
cd poc/w1
npm install
npm run curator                                                # sample/sample-doc.txt
npm run curator:ui                                             # Genkit dev UI (localhost:4000)

# sample-data 10 件を全件回す (10/10 Zod parse 通過が成功条件)
for f in ../../sample-data/accounting-office/*.{txt,md,csv}; do
  echo "=== $f ==="; npm run curator -- "$f"
done
```

**期待出力 (年末調整_案内文.txt)**:
```json
{
  "documentType": "案内文",
  "businessDomain": "年末調整",
  "sensitivity": "Internal",
  "freshness": "current",
  "isAuthoritativeCandidate": true,
  "aiUsePolicy": "direct",
  "rationale": "..."
}
```

**成功条件**: sample-data 10 件すべてで Zod parse が通る。分類品質は手動 smoke check として記録し、期待 enum 一致率や precision/recall は Week 6 の eval パイプラインで扱う。

**2026-05-08 実装・検証メモ**:
- `poc/w1` に `npm run curator:all` を追加し、sample-data 10 件を一括検証できるようにした。
- `npm run curator` と `npm run curator:all` は通過。`Curator validation: 10/10 passed` を確認済み。
- Genkit docs で `@genkit-ai/google-genai` の `vertexAI` initializer と `output: { schema }`、Google Cloud docs で Gemini 2.5 Flash の `asia-northeast1` 対応を確認済み。
- `GOOGLE_CLOUD_PROJECT` 未設定警告は出たが、ADC のデフォルト設定で Vertex AI 呼び出しは成功した。次回以降は `.env.local` に project/location を明示する。

## 6. 失敗パターン切り分け

| 症状 | 推定原因 | 対処 |
|---|---|---|
| `default credentials` エラー | ADC 未設定 | `gcloud auth application-default login` 再実行 |
| `quota project` エラー | quota project 未設定 | `set-quota-project $PROJECT_ID` |
| `403` / `aiplatform` | API 無効 | `services enable aiplatform.googleapis.com` |
| `404 Model not found` (Tokyo) | モデル ID・エンドポイント・リージョン指定の誤り | `GEMINI_MODEL`・`GOOGLE_CLOUD_LOCATION` を確認。別リージョンに寄せる場合は [リージョン一覧](https://cloud.google.com/vertex-ai/generative-ai/docs/learn/locations) を参照（1.5 系への退避は想定しない） |
| Zod parse 失敗 (enum) | LLM が enum を勝手に作成 | プロンプト強化 / temperature=0 確認 / responseSchema 有効化確認 |
| Zod parse 失敗 (refine) | sensitivity↔aiUsePolicy 不整合 | プロンプトで派生ルール強調 or post-process で計算 |
| `output is undefined` | Genkit が responseSchema を立てていない | `responseMimeType: 'application/json'` + 自前 parse fallback |

Genkit dev UI のトレース画面で「responseSchema が JSON Schema として送信されているか」を目視確認。

## 7. 撤退判断 (D1 保険プラン)

**5/10 (土) 終了時点で全部該当 → 撤退**:
1. 1 件も Zod parse を通せていない
2. 失敗原因が Genkit/Vertex AI プラグイン側 (プロンプト調整で解決見込みなし)
3. fallback (responseMimeType + 自前 parse) も Genkit 経由で動かない

**撤退時の行動 (5/11)**:
- `poc/w1/` → `poc/w1-genkit-attempt/` にリネーム保存 (発表資料用)
- `poc/w1-handroll/` 新規作成、`@google-cloud/aiplatform` を直接呼ぶ
- `curatorSchema.ts` `curatorPrompt.ts` (移植対象、production 品質) はそのままコピー再利用
- `docs/decisions.md` に撤退記録を追記

**部分撤退** (1, 2 該当だが 3 だけ違う): Genkit `defineFlow` と dev UI は維持、`output.schema` は使わず `text` + 自前 parse。Week 2 への影響最小。

## 8. Week 2 への引き継ぎチェックリスト

- [ ] `curatorSchema.ts` `curatorPrompt.ts` が production 品質 (enum・refine・JSDoc)
- [ ] sample-data 10 件で Zod parse 通過、分類品質の手動 smoke check 結果を記録
- [ ] `poc/w1/README.md` に解決済み Genkit/プラグインバージョンを記録
- [ ] `docs/decisions.md` に検証結果 (本採用 or 撤退) を追記
- [ ] `docs/open-questions.md` R5 を「PoC 確定 enum」に更新
- [ ] Genkit dev UI トレースのスクショ 1 枚 (発表資料「実装力」用)

**Week 2 移植**:
- `poc/w1/src/curatorSchema.ts` → `src/agents/curator/schema.ts`
- `poc/w1/src/curatorPrompt.ts` → `src/agents/curator/prompt.ts`
- `curatorFlow.ts` `runCurator.ts` は破棄、Next.js Route Handler 前提で書き直し

## 9. タイムライン

| 日 | 作業 | 完了条件 |
|---|---|---|
| 5/9 AM | GCP セットアップ + Genkit docs 確認 | `gcloud aiplatform get-token` 通過 |
| 5/9 PM | poc/w1/ ひな形 + schema + prompt | `tsc --noEmit` 通過 |
| 5/10 AM | flow + runCurator + 1 件で parse 通過 | sample-doc.txt で OK |
| 5/10 PM | 10 件回す + プロンプト調整 / 撤退判定 | 10/10 Zod parse 通過 or 撤退決定 |
| 5/11 AM | README + 引き継ぎ + decisions/open-questions 更新 | W1-1 closed |
| 5/11 PM | W1-2 着手 (別プラン) | — |

## 10. Critical Files (新規作成)

- `poc/w1/package.json`
- `poc/w1/tsconfig.json`
- `poc/w1/.env.local`
- `poc/w1/.gitignore`
- `poc/w1/README.md`
- `poc/w1/src/curatorSchema.ts` (移植対象)
- `poc/w1/src/curatorPrompt.ts` (移植対象)
- `poc/w1/src/curatorFlow.ts`
- `poc/w1/src/runCurator.ts`
- `poc/w1/sample/sample-doc.txt`

## 11. 本ファイルの位置づけ

- `PLAN_w1.md` はプロジェクトルートに置く (PoC 期間中の作業ハブ)
- `docs/` ではなく直下に置く理由: 一時的な作業ドキュメントで、Week 1 終了時に `docs/week1-retrospective.md` 等にまとめ直して `PLAN_w1.md` は削除する想定
- 本プランの内容と乖離するような状況変化があった場合は、PLAN_w1.md を直接編集して更新する

## 12. W1-2: A8 residualRisk PoC メモ

**検証する問い**:
> マスキング後テキストを Vertex AI + Zod structured output に通し、Masker が `recommendedSensitivity: "Restricted"` を返すことで Curator 判定を覆す A8 逆feedback の中核判断を実装できるか。

**追加ファイル**:
- `poc/w1/src/genkitClient.ts`
- `poc/w1/src/maskerRiskSchema.ts`
- `poc/w1/src/maskerRiskPrompt.ts`
- `poc/w1/src/maskerRiskFlow.ts`
- `poc/w1/src/runMaskerRisk.ts`
- `poc/w1/sample/masked-contract-risk.txt`
- `poc/w1/sample/masked-memo-safe.txt`

**実行コマンド**:

```bash
cd poc/w1
npm run masker:risk
npm run masker:risk -- sample/masked-memo-safe.txt
```

**2026-05-08 実装・検証メモ**:
- `sample/masked-contract-risk.txt` は、契約期間と顧問料が残っているため `residualRisk.detected: true` / `recommendedSensitivity: "Restricted"` で Zod parse 通過。
- `sample/masked-memo-safe.txt` は、固有情報がプレースホルダー化されているため `residualRisk.detected: false` / `recommendedSensitivity: "Confidential"` で Zod parse 通過。
- W1-1 の Genkit 初期化を `genkitClient.ts` に切り出し、Curator / Masker residualRisk の両 flow で共有した。
