import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { modelId } from '../../../../agents/_shared/genkitClient';
import { buildCsvCuratorInput } from '../../../../lib/extractors/csvExtractor';
import { getFirestoreClient } from '../../../../lib/firestore';
import { hashContentSha256 } from '../../../../lib/firestoreSchema';
import {
  DEMO_SAMPLE_SET_FIELD,
  DEMO_SAMPLE_SET_ID,
  isDemoMode,
} from '../../../../lib/demoMode';
import {
  orchestrateUploadProcessing,
  type OrchestrateResult,
} from '../../../../lib/uploadOrchestrator';
import { replaceChunksForDoc } from '../../../../lib/chunkRegenerator';
import { getKnowledgeHubBucketName } from '../../../../lib/storage';
import { DOCUMENTS_COLLECTION } from '../../../../lib/documents';
import { auditActorFromRequest, recordAuditEvent } from '../../../../lib/audit/auditEvent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEMO_SAMPLE_FILES = [
  '給与計算チェックリスト.md',
  '給与計算_例外対応メモ.txt',
  '就業規則テンプレート.md',
  '料金表_2026.csv',
  '料金表_2023.csv',
  '顧客対応メモ_匿名化.txt',
] as const;

type DemoSampleDocument = {
  fileName: string;
  docId?: string;
  status: 'imported' | 'already_present' | 'failed';
  lifecycleStatus?: OrchestrateResult['kind'];
  error?: string;
};

function contentTypeForFile(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.csv')) return 'text/csv';
  return 'text/plain';
}

async function findExistingDocId(contentSha256: string): Promise<string | null> {
  const snapshot = await getFirestoreClient()
    .collection(DOCUMENTS_COLLECTION)
    .where('contentSha256', '==', contentSha256)
    .limit(1)
    .get();
  return snapshot.docs[0]?.id ?? null;
}

async function markDemoSampleDocument(docId: string): Promise<void> {
  await getFirestoreClient()
    .collection(DOCUMENTS_COLLECTION)
    .doc(docId)
    .set(
      {
        [DEMO_SAMPLE_SET_FIELD]: DEMO_SAMPLE_SET_ID,
      },
      { merge: true }
    );
}

function samplePath(fileName: string): string {
  return join(process.cwd(), 'sample-data', 'accounting-office', fileName);
}

async function ingestSample(
  fileName: string,
  request: Request
): Promise<DemoSampleDocument> {
  try {
    const buffer = await readFile(samplePath(fileName));
    const contentType = contentTypeForFile(fileName);
    const content = buffer.toString('utf-8');
    const contentSha256 = hashContentSha256(buffer);
    const existingDocId = await findExistingDocId(contentSha256);
    if (existingDocId) {
      await markDemoSampleDocument(existingDocId);
      return { fileName, docId: existingDocId, status: 'already_present' };
    }

    const csvInput = fileName.toLowerCase().endsWith('.csv')
      ? buildCsvCuratorInput({ fileName, content })
      : null;
    const result = await orchestrateUploadProcessing({
      displayName: fileName,
      contentType,
      buffer,
      content,
      ...(csvInput
        ? {
            curatorContent: csvInput.content,
            curatorInputMode: csvInput.inputMode,
          }
        : {}),
    });

    await replaceChunksForDoc(result.docId);
    await markDemoSampleDocument(result.docId);

    try {
      const { tenantId, actor } = auditActorFromRequest(request);
      await recordAuditEvent({
        tenantId,
        actor,
        action: 'document.import',
        target: {
          docId: result.docId,
          fileName,
          sourceKind: 'upload',
          sensitivity: result.curator.sensitivity,
        },
        result: 'success',
      });
    } catch (auditErr) {
      console.error('[demo] recordAuditEvent failed', auditErr);
    }

    return {
      fileName,
      docId: result.docId,
      status: 'imported',
      lifecycleStatus: result.kind,
    };
  } catch (error) {
    console.error('[demo] sample ingest failed', { fileName, error });
    return {
      fileName,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function POST(request: Request) {
  if (!isDemoMode()) {
    return NextResponse.json({ error: 'demo_mode_disabled' }, { status: 403 });
  }

  try {
    getKnowledgeHubBucketName();
  } catch {
    return NextResponse.json(
      { error: 'サーバー設定 (KNOWLEDGE_HUB_BUCKET) が未完了です。' },
      { status: 503 }
    );
  }

  const documents: DemoSampleDocument[] = [];
  for (const fileName of DEMO_SAMPLE_FILES) {
    documents.push(await ingestSample(fileName, request));
  }

  const imported = documents.filter((doc) => doc.status === 'imported').length;
  const alreadyPresent = documents.filter(
    (doc) => doc.status === 'already_present'
  ).length;
  const failed = documents.filter((doc) => doc.status === 'failed').length;

  return NextResponse.json({
    sampleSet: DEMO_SAMPLE_SET_ID,
    modelId,
    imported,
    alreadyPresent,
    failed,
    documents,
  });
}
