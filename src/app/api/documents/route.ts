/**
 * `POST /api/documents` の責務は HTTP 境界に限定する。
 *
 * - multipart formData 解析、`file` フィールド検証
 * - サイズ / 拡張子 / MIME / UTF-8 または XLSX 解析 / バケット設定（`getKnowledgeHubBucketName()`）検証
 * - `orchestrateUploadProcessing` への委譲（GCS / Firestore / Curator / Masker の副作用順序は
 *   `src/lib/uploadOrchestrator.ts` 側の単一責務）
 * - upload 完了後の `documents/{docId}/chunks` 同期生成
 * - 成功・失敗レスポンスの整形（Curator/Masker 段の失敗は `docId` 付き 500、その他基盤は 502）
 */
import { NextResponse } from 'next/server';
import { modelId } from '../../../agents/_shared/genkitClient';
import {
  CuratorPhaseError,
  MaskerPhaseError,
  orchestrateUploadProcessing,
  type PdfConversionAudit,
} from '../../../lib/uploadOrchestrator';
import { getKnowledgeHubBucketName } from '../../../lib/storage';
import {
  MAX_UPLOAD_BYTES,
  decodeUtf8Strict,
  getAllowedExtension,
  isAllowedMimeType,
} from '../../../lib/documents';
import { documentUploadSuccessBodyFromOrchestrate } from '../../../lib/documentUploadResponseMapper';
import { xlsxToNormalizedMarkdown } from '../../../lib/extractors/xlsxExtractor';
import { extractPdfFromBuffer } from '../../../lib/extractors/pdfDocumentExtractor';
import { extractSlidePdfFromBuffer } from '../../../lib/extractors/slidePdfDocumentExtractor';
import { extractScanPdfFromBuffer } from '../../../lib/extractors/scanPdfDocumentExtractor';
import { replaceChunksForDoc } from '../../../lib/chunkRegenerator';
import { auditActorFromRequest, recordAuditEvent } from '../../../lib/audit/auditEvent';
import { getFeatureFlag, isFeatureEnabled } from '../../../lib/featureFlags';
import { getFirestoreClient } from '../../../lib/firestore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CURATOR_FAILURE_CLIENT_MESSAGE =
  '分類処理に失敗しました。設定またはログを確認してください。';

const MASKER_FAILURE_CLIENT_MESSAGE =
  'マスク処理に失敗しました。設定またはログを確認してください。';

const CHUNK_GENERATION_FAILURE_CLIENT_MESSAGE =
  'チャンク生成に失敗しました。設定またはログを確認してください。';

type PdfExtractionResult = {
  textContent: string;
  documentIr: Awaited<
    ReturnType<typeof extractPdfFromBuffer>
  >['documentIr'];
  /** Audit metadata threaded into `document.convert` (Phase 3-H-3 §4.2). */
  conversion: PdfConversionAudit;
};

type PdfSubtypePreFlightConfig = {
  flagId:
    | 'pdf-conversion-subtype-1'
    | 'pdf-conversion-subtype-2'
    | 'pdf-conversion-subtype-3';
  extract: (args: { buffer: Buffer; fileName: string }) => Promise<PdfExtractionResult>;
};

/** Gemini OCR `piiFindings` only — not heuristic DLP / Masker output. */
function countUnmaskablePiiFromGeminiOcr(
  piiFindings: ReadonlyArray<{ maskability: 'maskable' | 'unmaskable' }>
): number {
  return piiFindings.filter((finding) => finding.maskability === 'unmaskable')
    .length;
}

const PDF_SUBTYPE_PRE_FLIGHT_CONFIGS: readonly PdfSubtypePreFlightConfig[] = [
  {
    flagId: 'pdf-conversion-subtype-3',
    extract: async ({ buffer, fileName }) => {
      const result = await extractScanPdfFromBuffer({ buffer, fileName });
      return {
        textContent: result.textContent,
        documentIr: result.documentIr,
        conversion: {
          converterId: result.conversion.converterId,
          inferenceDestination: {
            vendor: 'vertex',
            region: result.conversion.region,
            model: result.conversion.model,
          },
          unmaskablePiiFindingsCount: countUnmaskablePiiFromGeminiOcr(
            result.conversion.piiFindings
          ),
        },
      };
    },
  },
  {
    flagId: 'pdf-conversion-subtype-2',
    extract: async ({ buffer, fileName }) => {
      const result = await extractSlidePdfFromBuffer({ buffer, fileName });
      return {
        textContent: result.textContent,
        documentIr: result.documentIr,
        conversion: {
          converterId: result.conversion.converterId,
          inferenceDestination: {
            vendor: 'vertex',
            region: result.conversion.region,
            model: result.conversion.model,
          },
        },
      };
    },
  },
  {
    flagId: 'pdf-conversion-subtype-1',
    extract: async ({ buffer, fileName }) => {
      const result = await extractPdfFromBuffer({
        buffer,
        fileName,
        sourceSubtype: 'official-doc-pdf',
      });
      return {
        textContent: result.textContent,
        documentIr: result.documentIr,
        conversion: { converterId: 'pdf-parse' },
      };
    },
  },
] as const;

const PDF_CONFLICTING_SUBTYPE_FLAGS_MESSAGE =
  'PDF 変換の feature flag が競合しています。同一テナントで PDF 変換 subtype flag (official-doc-pdf / slide-pdf / scan-pdf) を複数同時に有効にできません。';

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

  if (extCheck === '.pdf') {
    let tenantId: string;
    try {
      ({ tenantId } = auditActorFromRequest(request));
    } catch {
      tenantId = '';
    }
    const db = getFirestoreClient();
    const enabledPdfConfigs: PdfSubtypePreFlightConfig[] = [];
    for (const config of PDF_SUBTYPE_PRE_FLIGHT_CONFIGS) {
      const flag = await getFeatureFlag(db, config.flagId);
      if (isFeatureEnabled(flag, tenantId)) {
        enabledPdfConfigs.push(config);
      }
    }

    if (enabledPdfConfigs.length === 0) {
      return NextResponse.json(
        {
          error:
            'PDF アップロードはベータ機能です。テナントのアクセス権を確認してください。',
        },
        { status: 403 }
      );
    }

    if (enabledPdfConfigs.length > 1) {
      console.warn('[documents] conflicting PDF conversion feature flags', {
        tenantId,
        enabledFlagIds: enabledPdfConfigs.map((config) => config.flagId),
      });
      return NextResponse.json(
        { error: PDF_CONFLICTING_SUBTYPE_FLAGS_MESSAGE },
        { status: 403 }
      );
    }

    const selectedPdfConfig = enabledPdfConfigs[0]!;

    try {
      pdfExtractionResult = await selectedPdfConfig.extract({
        buffer,
        fileName: displayName,
      });
    } catch (error) {
      console.error('[documents] PDF extraction failed', error);
      return NextResponse.json(
        { error: 'PDF ファイルを解析できませんでした。' },
        { status: 400 }
      );
    }
  }

  // ── Content extraction for non-PDF formats ────────────────────────────────
  let content: string;
  if (extCheck === '.xlsx') {
    try {
      content = await xlsxToNormalizedMarkdown(buffer);
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
  let pdfAuditContext: ReturnType<typeof auditActorFromRequest> | undefined;
  if (pdfExtractionResult) {
    try {
      pdfAuditContext = auditActorFromRequest(request);
    } catch (auditErr) {
      console.warn('[documents] auditActorFromRequest failed', auditErr);
      pdfAuditContext = undefined;
    }
  }

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
            auditContext: pdfAuditContext,
            conversion: pdfExtractionResult.conversion,
          }
        : {}),
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
