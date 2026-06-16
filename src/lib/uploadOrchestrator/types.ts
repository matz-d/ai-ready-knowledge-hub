import type { DocumentReference } from '@google-cloud/firestore';
import type { CuratorOutputResult } from '../../agents/curator/schema';
import type { DocumentIr, DocumentSourceSubtype } from '../../eval/conversion/documentIr';
import type { TableAssistSummary } from '../extractors/officialDocPdfTableAssist';
import type {
  AuditConverterId,
  AuditInferenceDestination,
  AuditEventWrite,
} from '../audit/auditEvent';
import type { FirestoreExternalSource } from '../firestoreSchema';

/**
 * Audit metadata describing how a PDF was converted. Built at the route
 * boundary (next to the extractor) and threaded through the orchestrator so
 * the `document.convert` AuditEvent can carry the right `converterId` and
 * `inferenceDestination` per Phase 3-H-3 §4.2.
 *
 * For official-doc-pdf this defaults to `{ converterId: 'pdf-parse' }` (no
 * inferenceDestination). For slide-pdf / scan-pdf Vertex-success paths the
 * caller fills in `inferenceDestination`.
 */
export type PdfConversionAudit = {
  converterId: AuditConverterId;
  inferenceDestination?: AuditInferenceDestination;
  /**
   * Count of Gemini OCR `piiFindings` with `maskability === 'unmaskable'`.
   * Required on scan-pdf `gemini-vertex-ocr` success paths (set at route boundary).
   */
  unmaskablePiiFindingsCount?: number;
  /** Grounded Gemini table-assist summary (official-doc-pdf, metadata only). */
  tableAssist?: TableAssistSummary;
};
export type CuratorInputMode =
  | 'full_text'
  | 'page_group_manifest'
  | 'table_manifest';
export type PdfCuratorInputMode = Extract<
  CuratorInputMode,
  'full_text' | 'page_group_manifest'
>;
export type OrchestrateAuditContext = {
  tenantId: string;
  actor: AuditEventWrite['actor'];
};

export type OrchestrateInput = {
  displayName: string;
  contentType: string;
  buffer: Buffer;
  content: string;
  /**
   * Present when the file is a PDF (Phase 3-H-2 M1).
   * When set, orchestrator uses the PDF path instead of the text path.
   */
  documentIr?: DocumentIr;
  /** Required when documentIr is present. */
  sourceSubtype?: DocumentSourceSubtype;
  /** When set, PDF conversion records `document.convert` AuditEvent (Phase 3-H-2 M2). */
  auditContext?: OrchestrateAuditContext;
  /**
   * PDF conversion audit metadata (Phase 3-H-3 §4.2). Required by spec when
   * `documentIr` is set; defaults to `{ converterId: 'pdf-parse' }` for
   * backwards compatibility with subtype 1 callers that don't pass it yet.
   */
  conversion?: PdfConversionAudit;
  /**
   * Optional PDF-only Curator input. Keeps `content` as the full extracted text
   * for chunk hashing and Masker input while allowing large PDFs to classify
   * from a page-group manifest.
   */
  pdfCuratorContent?: string;
  /**
   * Describes whether `pdfCuratorContent` is complete text or a sampled
   * manifest. Sampled manifests are not trusted for direct AI use decisions.
   */
  pdfCuratorInputMode?: PdfCuratorInputMode;
  /**
   * Optional non-PDF Curator input. Keeps `content` as the full source for
   * Masker while allowing large tables to classify from a bounded manifest.
   */
  curatorContent?: string;
  /**
   * Describes whether `curatorContent` is complete text or a sampled manifest.
   * Sampled manifests are not trusted for direct AI use decisions.
   */
  curatorInputMode?: CuratorInputMode;
};

export type MaskerSummary = {
  decision: 'ai_safe_ready' | 'restricted_promoted';
  provider: 'simple-rule' | 'cloud-dlp';
  maskedSpansCount: number;
  ruleHits: Record<string, number>;
  residualRisk: { detected: boolean; reasons: string[] };
  rationale: string;
  recommendedSensitivity: 'Confidential' | 'Restricted';
  completedAt: Date;
  modelId: string;
};

export type OrchestrateResult =
  | {
      kind: 'curated';
      docId: string;
      storagePath: string;
      curator: CuratorOutputResult;
      curatorCompletedAt: Date;
      /**
       * Legacy park flag (PDF M1). New uploads run Masker on the PDF path and
       * return `ai_safe` / `restricted` instead of parking.
       */
      maskingPending?: boolean;
    }
  | {
      kind: 'blocked';
      docId: string;
      storagePath: string;
      curator: CuratorOutputResult;
      curatorCompletedAt: Date;
    }
  | {
      kind: 'ai_safe';
      docId: string;
      storagePath: string;
      aiSafeStoragePath: string;
      curator: CuratorOutputResult;
      curatorCompletedAt: Date;
      masker: MaskerSummary;
    }
  | {
      kind: 'restricted';
      docId: string;
      storagePath: string;
      curator: CuratorOutputResult;
      curatorCompletedAt: Date;
      /** Origin of the restriction: Masker-promoted vs a deterministic safety gate (D-PROD-1). */
      restrictionSource: 'masker' | 'safety_gate';
      sensitivityReason: string;
      /** Present only for Masker-promoted restrictions. */
      masker?: MaskerSummary;
      /** Present only for Masker-promoted restrictions. */
      originalCuratorSensitivity?: NonNullable<CuratorOutputResult['sensitivity']>;
    };
export type RunCuratorAndMaskerLifecycleArgs = {
  docRef: DocumentReference;
  docId: string;
  displayName: string;
  content: string;
  curatorContent?: string;
  curatorInputMode?: CuratorInputMode;
  contentSha256: string;
  sourceKind: 'upload' | 'google_workspace';
  externalSource: FirestoreExternalSource | null;
  storagePath: string;
  aiSafeStoragePath: string;
};
