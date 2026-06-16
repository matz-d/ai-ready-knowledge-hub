import { NextResponse } from 'next/server';
import { auditActorFromRequest } from '../../../../../lib/audit/auditEvent';
import {
  reprocessPdfWithTableAssist,
  type PdfTableAssistReprocessFailure,
} from '../../../../../lib/pdfTableAssistReprocessor';
import {
  PDF_CONFLICTING_SUBTYPE_FLAGS_MESSAGE,
  PDF_EXTRACTION_FAILED_MESSAGE,
  PDF_UPLOAD_BETA_DISABLED_MESSAGE,
} from '../../../../../lib/extractors/pdfExtractionDispatcher';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function failureResponse(failure: PdfTableAssistReprocessFailure): NextResponse {
  switch (failure.code) {
    case 'document_not_found':
      return NextResponse.json({ error: 'document_not_found' }, { status: 404 });
    case 'document_not_reprocessable':
      return NextResponse.json(
        {
          error: 'document_not_reprocessable',
          status: failure.status,
        },
        { status: 409 }
      );
    case 'not_uploaded_pdf':
      return NextResponse.json({ error: 'not_uploaded_pdf' }, { status: 409 });
    case 'not_official_doc_pdf':
      return NextResponse.json(
        { error: 'not_official_doc_pdf' },
        { status: 409 }
      );
    case 'raw_content_hash_mismatch':
      return NextResponse.json(
        { error: 'raw_content_hash_mismatch' },
        { status: 409 }
      );
    case 'reprocess_in_progress':
      return NextResponse.json(
        { error: 'reprocess_in_progress' },
        { status: 409 }
      );
    case 'table_assist_flag_disabled':
      return NextResponse.json(
        { error: 'pdf_table_assist_disabled' },
        { status: 403 }
      );
    case 'pdf_dispatch_failed':
      switch (failure.failure.code) {
        case 'no_flag_enabled':
          return NextResponse.json(
            { error: PDF_UPLOAD_BETA_DISABLED_MESSAGE },
            { status: 403 }
          );
        case 'conflicting_flags':
          return NextResponse.json(
            { error: PDF_CONFLICTING_SUBTYPE_FLAGS_MESSAGE },
            { status: 403 }
          );
        case 'extraction_failed':
          console.error(
            '[documents/table-assist] PDF extraction failed',
            failure.failure.cause
          );
          return NextResponse.json(
            { error: PDF_EXTRACTION_FAILED_MESSAGE },
            { status: 400 }
          );
      }
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ docId: string }> }
) {
  const { docId } = await params;
  if (!docId?.trim()) {
    return NextResponse.json({ error: 'doc_id_required' }, { status: 400 });
  }

  let auditContext: ReturnType<typeof auditActorFromRequest>;
  try {
    auditContext = auditActorFromRequest(request);
  } catch {
    return NextResponse.json({ error: 'tenant_required' }, { status: 401 });
  }

  const outcome = await reprocessPdfWithTableAssist({
    docId,
    tenantId: auditContext.tenantId,
    auditContext,
  });

  if (!outcome.ok) {
    return failureResponse(outcome.failure);
  }

  return NextResponse.json(outcome.result.body);
}
