export {
  buildAiSafeFirestoreUpdate,
  buildImportedSnapshotInitialDocumentBody,
  buildRestrictedFirestoreUpdate,
  buildSafetyGateRestrictedFirestoreUpdate,
  buildUploadInitialDocumentBody,
  maskerSummaryFromPipeline,
  UNMASKABLE_PII_RESTRICTION_REASON,
  type AiSafeTerminalFirestoreUpdateDraft,
  type FirestoreInitialDocumentDraft,
  type FirestoreMaskerWriteBlockDraft,
  type RestrictedTerminalFirestoreUpdateDraft,
  type RunMaskerArgs,
  type SafetyGateRestrictedFirestoreUpdateDraft,
} from './firestoreDrafts';

export {
  CuratorPhaseError,
  MaskerPhaseError,
  runCuratorAndMaskerLifecycle,
  runMaskerPhase,
} from './phases';

export {
  recordConversionFailure,
  recordPhaseFailure,
} from './audit';

export {
  safeDeleteFirestoreDoc,
  safeDeleteMaskedObject,
  safeDeleteRawObject,
} from './cleanup';

export {
  orchestrateUploadProcessing,
  transitionDocumentToCurating,
} from './orchestrate';

export type {
  MaskerSummary,
  OrchestrateAuditContext,
  OrchestrateInput,
  OrchestrateResult,
  PdfConversionAudit,
  RunCuratorAndMaskerLifecycleArgs,
} from './types';
