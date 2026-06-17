/**
 * `POST /api/documents` の責務は HTTP 境界に限定する。
 *
 * - multipart formData 解析、`file` フィールド検証
 * - サイズ / 拡張子 / MIME / UTF-8 または XLSX 解析 / バケット設定（`getKnowledgeHubBucketName()`）検証
 * - PDF は `dispatchPdfExtraction` へ委譲後、`orchestrateUploadProcessing` へ渡す
 *   （GCS / Firestore / Curator / Masker の副作用順序は `src/lib/uploadOrchestrator/` 側）
 * - upload 完了後の `documents/{docId}/chunks` 同期生成
 * - 成功・失敗レスポンスの整形（Curator/Masker 段の失敗は `docId` 付き 500、その他基盤は 502）
 */
import { NextResponse } from 'next/server';
import { modelId } from '../../../agents/_shared/genkitClient';
import {
  CuratorPhaseError,
  MaskerPhaseError,
  orchestrateUploadProcessing,
} from '../../../lib/uploadOrchestrator';
import { getKnowledgeHubBucketName } from '../../../lib/storage';
import {
  MAX_UPLOAD_BYTES,
  decodeUtf8Strict,
  getAllowedExtension,
  isAllowedMimeType,
} from '../../../lib/documents';
import { documentUploadSuccessBodyFromOrchestrate } from '../../../lib/documentUploadResponseMapper';
import { buildCsvCuratorInput } from '../../../lib/extractors/csvExtractor';
import { buildXlsxCuratorInput } from '../../../lib/extractors/xlsxExtractor';
import {
  buildPdfCuratorContent,
  createFirestorePdfFlagReader,
  dispatchPdfExtraction,
  PDF_CONFLICTING_SUBTYPE_FLAGS_MESSAGE,
  PDF_EXTRACTION_FAILED_MESSAGE,
  PDF_UPLOAD_BETA_DISABLED_MESSAGE,
  type PdfExtractionDispatchFailure,
  type PdfExtractionResult,
} from '../../../lib/extractors/pdfExtractionDispatcher';
import { replaceChunksForDoc } from '../../../lib/chunkRegenerator';
import { auditActorFromRequest, recordAuditEvent } from '../../../lib/audit/auditEvent';
import { getFirestoreClient } from '../../../lib/firestore';
import {
  cloudTasksPdfTableAssistIngestEnqueuer,
  PdfTableAssistQueueNotConfiguredError,
} from '../../../lib/pdfTableAssistIngestEnqueuer';
import { PdfTableAssistTaskSigningNotConfiguredError } from '../../../lib/pdfTableAssistTaskSigning';
import type { PdfFlagEnabledReader } from '../../../lib/extractors/pdfExtractionDispatcher';
import type { OrchestrateAuditContext } from '../../../lib/uploadOrchestrator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CURATOR_FAILURE_CLIENT_MESSAGE =
  '分類処理に失敗しました。設定またはログを確認してください。';

const MASKER_FAILURE_CLIENT_MESSAGE =
  'マスク処理に失敗しました。設定またはログを確認してください。';

const CHUNK_GENERATION_FAILURE_CLIENT_MESSAGE =
  'チャンク生成に失敗しました。設定またはログを確認してください。';

function pdfDispatchFailureResponse(
  failure: PdfExtractionDispatchFailure,
  tenantId: string
): NextResponse {
  switch (failure.code) {
    case 'no_flag_enabled':
      return NextResponse.json(
        { error: PDF_UPLOAD_BETA_DISABLED_MESSAGE },
        { status: 403 }
      );
    case 'conflicting_flags':
      console.warn('[documents] conflicting PDF conversion feature flags', {
        tenantId,
        enabledFlagIds: failure.enabledFlagIds,
      });
      return NextResponse.json(
        { error: PDF_CONFLICTING_SUBTYPE_FLAGS_MESSAGE },
        { status: 403 }
      );
    case 'extraction_failed':
      console.error('[documents] PDF extraction failed', failure.cause);
      return NextResponse.json(
        { error: PDF_EXTRACTION_FAILED_MESSAGE },
        { status: 400 }
      );
  }
}

/** Whole mebibytes for client-facing copy (limit is defined in binary units). */
function formatBytesAsMB(bytes: number): string {
  return `${Math.floor(bytes / (1024 * 1024))} MB`;
}

function defaultContentTypeForExt(
  ext: string
):
  | 'text/plain'
  | 'text/markdown'
  | 'text/csv'
  | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  | 'application/pdf' {
  if (ext === '.md') return 'text/markdown';
  if (ext === '.csv') return 'text/csv';
  if (ext === '.xlsx') {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  if (ext === '.pdf') return 'application/pdf';
  return 'text/plain';
}

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: 'multipart フォームを解析できませんでした。' },
      { status: 400 }
    );
  }

  const fileFields = formData.getAll('file');
  if (fileFields.length !== 1) {
    return NextResponse.json(
      { error: 'file フィールドにはファイルを正確に1つ指定してください。' },
      { status: 400 }
    );
  }

  const fileEntry = fileFields[0];
  if (!fileEntry || typeof fileEntry === 'string') {
    return NextResponse.json(
      { error: 'file フィールドにはファイルを正確に1つ指定してください。' },
      { status: 400 }
    );
  }

  const file = fileEntry as File;
  if (file.size === 0) {
    return NextResponse.json(
      { error: '空のファイルはアップロードできません。' },
      { status: 400 }
    );
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        error: `ファイルサイズは ${formatBytesAsMB(MAX_UPLOAD_BYTES)} 以下にしてください。`,
      },
      { status: 413 }
    );
  }

  const displayName = file.name?.trim() || 'file.txt';
  const extCheck = getAllowedExtension(displayName);
  if (!extCheck) {
    return NextResponse.json(
      { error: '対応している拡張子は .txt / .md / .csv / .xlsx / .pdf のみです。' },
      { status: 415 }
    );
  }

  const mime = (file.type ?? '').trim();
  if (mime && !isAllowedMimeType(mime)) {
    return NextResponse.json(
      { error: 'このファイルの Content-Type は受け付けていません。' },
      { status: 415 }
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // ── PDF-specific pre-flight: feature flag check + extraction ─────────────
  // Done before the orchestration try/catch so failure modes are clean 4xx/403,
  // not confused with 5xx CuratorPhaseError / MaskerPhaseError.
  let pdfExtractionResult: PdfExtractionResult | undefined;
  let pdfAuditContext: OrchestrateAuditContext | undefined;
  let pdfFlagReader: PdfFlagEnabledReader | undefined;

  if (extCheck === '.pdf') {
    let tenantId: string;
    try {
      pdfAuditContext = auditActorFromRequest(request);
      tenantId = pdfAuditContext.tenantId;
    } catch {
      tenantId = '';
    }
    const db = getFirestoreClient();
    pdfFlagReader = createFirestorePdfFlagReader(db, tenantId);
    // Sync upload must never run table-assist; only the async worker may pass 'async'.
    const pdfDispatchOutcome = await dispatchPdfExtraction({
      buffer,
      fileName: displayName,
      isFlagEnabled: pdfFlagReader,
      tableAssistMode: 'disabled',
    });

    if (!pdfDispatchOutcome.ok) {
      return pdfDispatchFailureResponse(pdfDispatchOutcome.failure, tenantId);
    }

    pdfExtractionResult = pdfDispatchOutcome.result;
  }

  // ── Content extraction for non-PDF formats ────────────────────────────────
  let content: string;
  let curatorContent: string | undefined;
  let curatorInputMode: 'full_text' | 'table_manifest' | undefined;
  if (extCheck === '.xlsx') {
    try {
      const tableCuratorInput = await buildXlsxCuratorInput({
        fileName: displayName,
        content: buffer,
      });
      content = tableCuratorInput.normalizedMarkdown;
      curatorContent = tableCuratorInput.content;
      curatorInputMode = tableCuratorInput.inputMode;
    } catch {
      return NextResponse.json(
        { error: '.xlsx ファイルを解析できませんでした。' },
        { status: 400 }
      );
    }
  } else if (extCheck === '.pdf') {
    // textContent already extracted above; used as extractorInput for chunk hashing
    content = pdfExtractionResult!.textContent;
  } else {
    const decoded = decodeUtf8Strict(arrayBuffer);
    if (decoded === null) {
      return NextResponse.json(
        { error: 'UTF-8 として解釈できないバイト列です。' },
        { status: 400 }
      );
    }
    content = decoded;
    if (extCheck === '.csv') {
      const tableCuratorInput = buildCsvCuratorInput({
        fileName: displayName,
        content,
      });
      curatorContent = tableCuratorInput.content;
      curatorInputMode = tableCuratorInput.inputMode;
    }
  }

  try {
    getKnowledgeHubBucketName();
  } catch {
    return NextResponse.json(
      { error: 'サーバー設定 (KNOWLEDGE_HUB_BUCKET) が未完了です。' },
      { status: 503 }
    );
  }

  const contentType = mime ? mime : defaultContentTypeForExt(extCheck);

  try {
    const result = await orchestrateUploadProcessing({
      displayName,
      contentType,
      buffer,
      content,
      ...(pdfExtractionResult
        ? {
            documentIr: pdfExtractionResult.documentIr,
            sourceSubtype: pdfExtractionResult.documentIr.source.sourceSubtype,
            pdfCuratorContent: buildPdfCuratorContent(pdfExtractionResult),
            pdfCuratorInputMode:
              pdfExtractionResult.pageGroupPlan === undefined
                ? 'full_text'
                : 'page_group_manifest',
            auditContext: pdfAuditContext,
            conversion: pdfExtractionResult.conversion,
          }
        : {
            ...(curatorContent !== undefined
              ? {
                  curatorContent,
                  curatorInputMode: curatorInputMode ?? 'full_text',
                }
              : {}),
          }),
    });

    // PDF chunking is handled inside orchestratePdfPath — skip replaceChunksForDoc.
    if (extCheck !== '.pdf') {
      try {
        await replaceChunksForDoc(result.docId);
      } catch (chunkError) {
        console.error('[documents] chunk generation failed', chunkError);
        return NextResponse.json(
          { error: CHUNK_GENERATION_FAILURE_CLIENT_MESSAGE, docId: result.docId },
          { status: 500 }
        );
      }
    }

    const body = documentUploadSuccessBodyFromOrchestrate({
      displayName,
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
          fileName: displayName,
          sourceKind: 'upload',
          sensitivity: result.curator.sensitivity,
        },
        result: 'success',
      });
    } catch (auditErr) {
      console.error('[documents] recordAuditEvent failed', auditErr);
    }

    if (
      pdfExtractionResult?.documentIr.source.sourceSubtype === 'official-doc-pdf' &&
      result.kind !== 'restricted' &&
      pdfAuditContext !== undefined &&
      pdfFlagReader !== undefined
    ) {
      try {
        if (await pdfFlagReader('pdf-table-assist')) {
          await cloudTasksPdfTableAssistIngestEnqueuer.enqueue({
            docId: result.docId,
            tenantId: pdfAuditContext.tenantId,
            actor: pdfAuditContext.actor,
          });
        }
      } catch (enqueueErr) {
        if (
          enqueueErr instanceof PdfTableAssistQueueNotConfiguredError ||
          enqueueErr instanceof PdfTableAssistTaskSigningNotConfiguredError
        ) {
          console.warn('[documents] table-assist async enqueue skipped', {
            docId: result.docId,
            missing: enqueueErr.message,
          });
        } else {
          console.error('[documents] table-assist async enqueue failed', {
            docId: result.docId,
            error: enqueueErr,
          });
        }
      }
    }

    return NextResponse.json(body);
  } catch (e) {
    console.error('[documents] upload processing failed', e);

    if (e instanceof CuratorPhaseError) {
      return NextResponse.json(
        { error: CURATOR_FAILURE_CLIENT_MESSAGE, docId: e.docId },
        { status: 500 }
      );
    }

    if (e instanceof MaskerPhaseError) {
      return NextResponse.json(
        { error: MASKER_FAILURE_CLIENT_MESSAGE, docId: e.docId },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: 'アップロード処理に失敗しました。' },
      { status: 502 }
    );
  }
}
