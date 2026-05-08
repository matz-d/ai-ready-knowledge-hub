import type { AiUsePolicy, Sensitivity } from '../curator/schema';
import type { ResidualRiskOutputResult } from './schema';

export type SensitivitySource = 'curator' | 'masker';

/** Metadata fields affected by Masker Restricted promotion (Firestore-ready shape). */
export type MaskerUpgradeFields = {
  sensitivity: Sensitivity;
  aiUsePolicy: AiUsePolicy;
  sensitivitySource?: SensitivitySource;
  originalCuratorSensitivity?: Sensitivity;
  sensitivityReason?: string;
};

function deriveSensitivityReason(riskOutput: ResidualRiskOutputResult): string {
  const tail = riskOutput.residualRisk.reasons.join('; ');
  return tail.length > 0 ? `${riskOutput.rationale} (${tail})` : riskOutput.rationale;
}

/**
 * When Masker recommends Restricted, promote effective metadata to Restricted / blocked
 * with masker provenance. Confidential recommendation leaves the document unchanged.
 */
export function applyMaskerUpgrade<T extends MaskerUpgradeFields>(
  document: T,
  riskOutput: ResidualRiskOutputResult
): T {
  if (riskOutput.recommendedSensitivity !== 'Restricted') {
    return { ...document };
  }

  return {
    ...document,
    sensitivity: 'Restricted',
    aiUsePolicy: 'blocked',
    sensitivitySource: 'masker',
    originalCuratorSensitivity:
      document.originalCuratorSensitivity ?? document.sensitivity,
    sensitivityReason: deriveSensitivityReason(riskOutput),
  };
}

export function wasPromotedByMasker(document: MaskerUpgradeFields): boolean {
  return (
    document.sensitivity === 'Restricted' && document.sensitivitySource === 'masker'
  );
}

/**
 * True when Curator still requires masking but no Masker outcome exists yet.
 */
export function needsMaskerEvaluation(document: {
  aiUsePolicy: AiUsePolicy;
  maskerEvaluation?: ResidualRiskOutputResult;
}): boolean {
  if (document.aiUsePolicy !== 'requires_masking') {
    return false;
  }
  return document.maskerEvaluation === undefined;
}

export function isBlockedForAi(document: MaskerUpgradeFields): boolean {
  return document.sensitivity === 'Restricted' || document.aiUsePolicy === 'blocked';
}
