import './loadEnv';
import { strategistFlow } from '../src/agents/strategist/flow';
import { computeChunkSourceHash } from '../src/lib/knowledgeChunkSchema';
import type { StrategistChunkInput } from '../src/agents/strategist/schema';
import type { KnowledgeChunk, KnowledgeChunkLocator } from '../src/lib/knowledgeChunkSchema';

const UPDATED_AT = '2026-05-14T09:00:00.000Z';

const purpose =
  '顧問先からの相続税相談に答えるため、社内の最新ナレッジから使える根拠・除外すべき資料・不足確認事項を整理する。';

function makeParagraphChunkInput(params: {
  docId: string;
  chunkId: string;
  fileName: string;
  text: string;
  documentType: StrategistChunkInput['parent']['documentType'];
  businessDomain: StrategistChunkInput['parent']['businessDomain'];
  freshness: StrategistChunkInput['parent']['freshness'];
  isAuthoritativeCandidate: boolean;
  updatedAt?: string;
}): StrategistChunkInput {
  const locator: KnowledgeChunkLocator = { kind: 'paragraph' };
  const chunk: KnowledgeChunk = {
    id: params.chunkId,
    docId: params.docId,
    schemaVersion: 1,
    sourceType: 'text',
    structureType: 'paragraph',
    locator,
    title: params.fileName,
    text: params.text,
    sensitivity: 'Internal',
    aiUsePolicy: 'direct',
    sensitivitySource: 'inherited',
    extractionProvider: 'csv',
    sourceHash: computeChunkSourceHash({
      extractorInput: params.text,
      locator,
    }),
    createdAt: params.updatedAt ?? UPDATED_AT,
    updatedAt: params.updatedAt ?? UPDATED_AT,
  };

  return {
    chunk,
    parent: {
      docId: params.docId,
      fileName: params.fileName,
      documentType: params.documentType,
      businessDomain: params.businessDomain,
      freshness: params.freshness,
      isAuthoritativeCandidate: params.isAuthoritativeCandidate,
      updatedAt: params.updatedAt ?? UPDATED_AT,
    },
  };
}

const chunkInputs: StrategistChunkInput[] = [
  makeParagraphChunkInput({
    docId: 'doc-inheritance-current',
    chunkId: 'chunk-inheritance-flow-v2026',
    fileName: '相続税相談_初回ヒアリングチェックリスト.md',
    documentType: 'チェックリスト',
    businessDomain: '顧客対応',
    freshness: 'current',
    isAuthoritativeCandidate: true,
    text: [
      '相続税の初回相談では、被相続人の死亡日、相続人の構成、遺言書の有無、財産目録の有無を最初に確認する。',
      '申告期限は相続開始を知った日の翌日から10か月以内であるため、期限までの残り期間を相談冒頭で確認する。',
      '社内回答では、個別税額の断定前に財産評価資料と過去贈与の有無を追加確認する。',
    ].join('\n'),
  }),
  makeParagraphChunkInput({
    docId: 'doc-payroll-mismatch',
    chunkId: 'chunk-payroll-exception',
    fileName: '給与計算_例外対応メモ.txt',
    documentType: 'メモ',
    businessDomain: '給与計算',
    freshness: 'current',
    isAuthoritativeCandidate: false,
    text: [
      '月途中入社者の社会保険料控除は、資格取得日と締日を確認してから処理する。',
      '住民税の特別徴収額に差異がある場合は、市区町村通知書を確認する。',
    ].join('\n'),
  }),
  makeParagraphChunkInput({
    docId: 'doc-inheritance-old',
    chunkId: 'chunk-inheritance-legacy-deduction',
    fileName: '旧_相続税基礎控除メモ_2014.txt',
    documentType: 'メモ',
    businessDomain: '顧客対応',
    freshness: 'superseded_candidate',
    isAuthoritativeCandidate: true,
    updatedAt: '2014-12-20T09:00:00.000Z',
    text: [
      '旧制度の相続税基礎控除に関する社内メモ。',
      '現在の相談回答に使う前に、最新税制・現行チェックリストとの差分確認が必要。',
    ].join('\n'),
  }),
];

async function main(): Promise<void> {
  const result = await strategistFlow({
    purpose,
    chunkInputs,
    safetyExcludedCount: 0,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
