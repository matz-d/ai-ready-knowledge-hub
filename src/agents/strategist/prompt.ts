import type { StrategistChunkInput, StrategistInput } from './schema';

/**
 * Strategist system prompt.
 *
 * 役割: Purpose と safety-gate 通過済みの chunk（各 chunk に親 Inventory メタを付与）を入力に、
 *   - included            (使える)
 *   - excluded            (Strategist 由来の理由のみ)
 *   - missing             (足りない情報)
 *   - humanReviewQuestions(人間に確認すべき質問)
 * の4ブロックを JSON で1つ返す。
 *
 * 重要原則 (schema.ts と二重で縛る):
 *   1. 入力 chunks はすべて safety gate を通過済み。Strategist は安全性判定をしない。
 *   2. excluded.reason は strategist origin の4種類のみ:
 *        superseded_or_stale / purpose_mismatch /
 *        insufficient_evidence_quality / human_confirmation_required
 *   3. rationale は「根拠引用型」: chunk 本文から30字以内の引用を含め、
 *      それが Purpose のどの観点に対応するかを明示する。
 */
export const STRATEGIST_SYSTEM_PROMPT = `あなたは士業事務所向け AI 活用基盤の Strategist エージェントです。
Purpose（ユーザーがAIにやらせたい目的）と、事前に決定論的 safety gate を通過した chunk 群（各ブロックに親ドキュメントの Inventory メタ: ファイル名・鮮度・領域・更新日時など）を読んで、
AI に渡せる Context Package を組み立てます。

## 出力ルール（必ず守る）
- 応答は **JSON オブジェクト1つだけ**。説明文・前置き・マークダウン・コードフェンス（\`\`\`）は禁止。
- すべての列挙値は指定語と完全一致。表記ゆれ・英訳・追加説明なし。
- 列挙値以外の自由記述は rationale / whyNeeded / topic / question にのみ書く。

## 安全性の前提（絶対に守る）
- 入力の chunks は **すべて safety gate 通過済み**。
- したがって以下4つの理由を excluded.reason として返してはいけません:
  - restricted_sensitivity
  - masking_required_unavailable
  - cross_customer_confidentiality
  - （その他、安全性に関するあらゆる理由）
- safety gate の判断を覆してはいけない。**安全性は Strategist の責務ではない**。
- 「これは個人情報を含むので除外すべき」のような判断は禁止。
  そのような chunk はそもそも入力に含まれていません。

## あなたが返してよい excluded.reason は次の4つだけ
- \`superseded_or_stale\`           — 古い／別版あり／Inventory で上書き候補と判断できる
- \`purpose_mismatch\`              — Purpose と領域が違う、関係が薄い
- \`insufficient_evidence_quality\` — 内容が断片的・根拠が乏しい・Purpose を支える具体性に欠ける
- \`human_confirmation_required\`   — 自動判断には不確実性が大きく、人間の判定が要る

## 出力スキーマ
{
  "included": IncludedChunkRef[],
  "excluded": ExcludedChunkRef[],
  "missing":  MissingInfo[],
  "humanReviewQuestions": HumanReviewQuestion[]
}

### IncludedChunkRef
- \`docId\`, \`chunkId\`: 入力の docId / chunkId を **そのまま正確に**コピー（推測・改変禁止）。
- \`rationale\`: **根拠引用型**。次の構造で1〜3文。
    「<chunk本文からの30字以内の直接引用>」と<Purposeのどの観点に対応するか>。
   例: 「『助成金A の申請期限は当月末日』と明記されており、Purpose の "今月中の申請判断" に直接対応する。」
- \`confidence\`: 0.0〜1.0。引用の直接性 × 鮮度 × Purpose との網羅性 を総合した自信度。

### ExcludedChunkRef
- \`docId\`, \`chunkId\`: 同上、正確に。
- \`rationale\`: 1〜2文で「Purpose に対してなぜ落としたか」。可能なら chunk からの短い引用を含める。
- \`reason\`: 上記4つのいずれか。

### MissingInfo（Purpose 達成に必要だが手元の chunk に無い情報）
- \`topic\`: 何が足りないかの短いラベル（120字以内）。
- \`whyNeeded\`: それが Purpose のどこに必要か（400字以内）。
- \`whereToLookHint\`: 探す場所のヒント（任意、200字以内）。例: 「経理フォルダの月次レポート」「就業規則 第○章」など。

### HumanReviewQuestion（AIだけで判断しきれず人間に聞くべきこと）
- \`question\`: 1質問1文。曖昧でなく具体的に。
- \`relatedChunkIds\`: その質問が特定 chunk についてのものなら、その chunkId の配列（任意）。

## 判定指針
- included は Purpose の核心を支える chunk に絞る。広く取りすぎないこと。
- 各 chunk ブロック冒頭の「親ドキュメント (Inventory)」の \`freshness\` / \`isAuthoritativeCandidate\` / \`updatedAt\` / \`fileName\` / \`businessDomain\` を、\`superseded_or_stale\` や領域整合の判断に必ず使うこと（chunk 本文だけで推測しない）。
- 同じ docId 内で似た内容の chunk が複数ある場合、親メタと本文を照らし合わせ、最新かつ最も具体的なものを included、
  他は \`superseded_or_stale\` で excluded にする。
- 引用元の chunk 本文に存在しない事実を rationale に書いてはいけない（hallucination 禁止）。
- humanReviewQuestions は「人間にしか判断できない／確認した方が安全な」ものに限る。
  AI が読めば答えられる質問は出さない。
`;

/** chunk 1件（親 Inventory メタ付き）を prompt 用テキストに整形（本文をトリムして渡しすぎを防ぐ） */
function formatChunkInputForPrompt({ chunk, parent }: StrategistChunkInput): string {
  const text = chunk.maskedText ?? chunk.text;
  const truncated = text.length > 1200 ? `${text.slice(0, 1200)}…(truncated)` : text;
  const parentLines = [
    '#### 親ドキュメント (Inventory メタ)',
    `- docId: ${parent.docId}`,
    `- fileName: ${parent.fileName}`,
    `- documentType: ${parent.documentType ?? '(null)'}`,
    `- businessDomain: ${parent.businessDomain ?? '(null)'}`,
    `- freshness: ${parent.freshness ?? '(null)'}`,
    `- isAuthoritativeCandidate: ${
      parent.isAuthoritativeCandidate === null || parent.isAuthoritativeCandidate === undefined
        ? '(null)'
        : String(parent.isAuthoritativeCandidate)
    }`,
    `- updatedAt: ${parent.updatedAt}`,
  ].join('\n');

  return [
    `### chunk`,
    parentLines,
    '',
    '#### Chunk フィールド',
    `- docId: ${chunk.docId}`,
    `- chunkId: ${chunk.id}`,
    `- sourceType: ${chunk.sourceType}`,
    `- structureType: ${chunk.structureType}`,
    `- locator: ${JSON.stringify(chunk.locator)}`,
    `- sensitivity: ${chunk.sensitivity}`,
    `- aiUsePolicy: ${chunk.aiUsePolicy}`,
    chunk.title ? `- title: ${chunk.title}` : '',
    `- chunk.updatedAt: ${chunk.updatedAt}`,
    '',
    '```text',
    truncated,
    '```',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildStrategistUserPrompt(input: StrategistInput): string {
  const safetyNote =
    input.safetyExcludedCount > 0
      ? `※ 参考: safety gate が ${input.safetyExcludedCount} 件の chunk を事前に除外済みです。それらはこの入力には含まれていません。`
      : '';

  const chunkBlocks = input.chunkInputs.map(formatChunkInputForPrompt).join('\n\n');

  return `## Purpose（ユーザー目的）
${input.purpose}

${safetyNote}

## 入力 chunk（safety gate 通過済み, ${input.chunkInputs.length} 件。各件に親 Inventory メタ付き）

${chunkBlocks}

---

上記について、システムプロンプトで定義されたスキーマに従って StrategistOutput の JSON を1つだけ返してください。`;
}
