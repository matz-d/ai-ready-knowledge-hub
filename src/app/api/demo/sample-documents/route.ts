import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { modelId } from '../../../../agents/_shared/genkitClient';
import { buildCsvCuratorInput } from '../../../../lib/extractors/csvExtractor';
import { FieldValue, getFirestoreClient } from '../../../../lib/firestore';
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
import type { DocumentUploadSuccessResponse } from '../../../../lib/documents';
import {
  documentUploadSuccessBodyFromFirestoreDocument,
  documentUploadSuccessBodyFromOrchestrate,
} from '../../../../lib/documentUploadResponseMapper';
import { auditActorFromRequest, recordAuditEvent } from '../../../../lib/audit/auditEvent';
import { parseFirestoreDocumentSnapshot } from '../../../../lib/parseFirestoreDocumentData';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEMO_SAMPLE_FILES = [
  '顧客対応メモ_匿名化.txt',
  '料金表_2023.csv',
  '料金表_2026.csv',
  '就業規則テンプレート.md',
  '給与計算_例外対応メモ.txt',
  '給与計算チェックリスト.md',
  '年末調整_案内文.txt',
  '顧問契約書テンプレ.md',
  '顧客対応メモ_書式.md',
  '顧問契約書_実案件サンプル.txt',
] as const;

type DemoSampleDocument = {
  fileName: string;
  docId?: string;
  status: 'imported' | 'already_present' | 'failed';
  lifecycleStatus?: OrchestrateResult['kind'];
  result?: DocumentUploadSuccessResponse;
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

async function markDemoSampleDocument(
  docId: string,
  fileName: string
): Promise<void> {
  await getFirestoreClient()
    .collection(DOCUMENTS_COLLECTION)
    .doc(docId)
    .set(
      {
        fileName,
        [DEMO_SAMPLE_SET_FIELD]: DEMO_SAMPLE_SET_ID,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

async function readDemoSampleResult(args: {
  docId: string;
  kind: 'created' | 'overwritten';
}): Promise<DocumentUploadSuccessResponse | undefined> {
  const snapshot = await getFirestoreClient()
    .collection(DOCUMENTS_COLLECTION)
    .doc(args.docId)
    .get();
  if (!snapshot.exists) return undefined;

  const parsed = parseFirestoreDocumentSnapshot(snapshot);
  return (
    documentUploadSuccessBodyFromFirestoreDocument({
      doc: parsed,
      ingestMeta: { kind: args.kind },
    }) ?? undefined
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
      await markDemoSampleDocument(existingDocId, fileName);
      await replaceChunksForDoc(existingDocId);
      const result = await readDemoSampleResult({
        docId: existingDocId,
        kind: 'overwritten',
      });
      return {
        fileName,
        docId: existingDocId,
        status: 'already_present',
        lifecycleStatus: result?.status,
        ...(result ? { result } : {}),
      };
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
    await markDemoSampleDocument(result.docId, fileName);

    const responseResult =
      (await readDemoSampleResult({ docId: result.docId, kind: 'created' })) ??
      documentUploadSuccessBodyFromOrchestrate({
        displayName: fileName,
        contentType,
        byteSize: buffer.length,
        modelId,
        result,
        ingestMeta: { kind: 'created' },
      });

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
      result: responseResult,
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
