import type {
  BusinessDomain,
  DocumentType,
  Freshness,
  Sensitivity,
} from '../../agents/curator/schema';
import type { DocumentLifecycleStatus } from '../../lib/documents';
import type { ExclusionReason } from '../../agents/strategist/schema';

export type CandidateRecommendation = 'include' | 'exclude' | 'needs_review';

/**
 * Metadata-only representation of a candidate document for purpose-driven selection.
 * No body text, aiSafeContent, maskedText, or chunk data — advisory layer only.
 */
export type CandidateDoc = {
  docId: string;
  fileName: string;
  documentType: DocumentType;
  businessDomain: BusinessDomain;
  sensitivity: Sensitivity;
  freshness: Freshness;
  isAuthoritativeCandidate: boolean;
  status: DocumentLifecycleStatus;
  updatedAt?: string;
  score: number;
  recommendation: CandidateRecommendation;
  /** Populated for exclude/needs_review only — never for include (enum stays clean). */
  reasonCode?: ExclusionReason;
  reasonLabel?: string;
  reasonDetail?: string;
  /** Human-readable match explanation for include. */
  matchReason?: string;
  scoreBreakdown?: Record<string, number>;
};
