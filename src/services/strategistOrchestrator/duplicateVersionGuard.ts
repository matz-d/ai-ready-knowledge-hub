import type {
  HumanReviewQuestion,
  IncludedChunkRef,
  StrategistOutput,
} from '../../agents/strategist/schema';
import type { StrategistOrchestratorParent } from './types';

type HumanConfirmationRequiredRef = StrategistOutput['excluded'][number];

type JoinedParentLookup = Map<
  string,
  { parent: StrategistOrchestratorParent }
>;

export type DuplicateVersionGuardInput = {
  included: IncludedChunkRef[];
  joinedByKey: JoinedParentLookup;
};

export type DuplicateVersionGuardResult = {
  included: IncludedChunkRef[];
  humanConfirmationRequired: HumanConfirmationRequiredRef[];
  humanReviewQuestions: HumanReviewQuestion[];
};

type VersionFamilyStem = {
  stem: string;
  hasVersionMarker: boolean;
};

const VERSION_MARKER_PATTERNS: RegExp[] = [
  /\(改訂版?\)/gi,
  /\(新版\)/gi,
  /\(旧版\)/gi,
  /[_\-\s]*旧版?/gu,
  /[_\-\s]*新版?/gu,
  /[_\-\s]v(\d+)/gi,
  /版(\d+)/g,
  /[_\-\s](20\d{2})/g,
  /[_\-\.](old|draft|new|latest|current)/gi,
  /^旧/u,
  /^新/u,
];

const WEAK_FILENAME_HINT = /旧|old|draft|superseded|廃止|archive/i;
const STRONG_FILENAME_HINT = /新|latest|current|改訂|rev\d/i;

/**
 * 明らかな version family を filename から推定する。
 * 推定できない（stem が短い、version 差分の手がかりが無い）場合は null。
 */
export function extractVersionFamilyStem(fileName: string): VersionFamilyStem | null {
  const withoutExtension = fileName.replace(/\.[^.]+$/u, '').trim();
  if (withoutExtension.length < 3) {
    return null;
  }

  let stem = withoutExtension;
  let hasVersionMarker = false;
  for (const pattern of VERSION_MARKER_PATTERNS) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    const globalPattern = new RegExp(pattern.source, flags);
    if (globalPattern.test(stem)) {
      hasVersionMarker = true;
    }
    stem = stem.replace(globalPattern, '');
  }

  stem = stem.replace(/[_\-\s]+/gu, ' ').trim().toLowerCase();
  if (stem.length < 3) {
    return null;
  }

  return { stem, hasVersionMarker };
}

function parentForDoc(
  docId: string,
  joinedByKey: JoinedParentLookup,
): StrategistOrchestratorParent | null {
  for (const [key, joined] of joinedByKey) {
    const [joinedDocId] = key.split('\u0000');
    if (joinedDocId === docId) {
      return joined.parent;
    }
  }
  return null;
}

function obviousVersionFamily(
  left: StrategistOrchestratorParent,
  right: StrategistOrchestratorParent,
): boolean {
  const leftFamily = extractVersionFamilyStem(left.fileName);
  const rightFamily = extractVersionFamilyStem(right.fileName);
  if (!leftFamily || !rightFamily || leftFamily.stem !== rightFamily.stem) {
    return false;
  }

  const freshnessDiffers =
    left.freshness !== right.freshness &&
    (left.freshness === 'current' ||
      right.freshness === 'current' ||
      left.freshness === 'superseded_candidate' ||
      right.freshness === 'superseded_candidate');

  return leftFamily.hasVersionMarker || rightFamily.hasVersionMarker || freshnessDiffers;
}

/**
 * 同一 version family 内で「残す」側を決める弱いヒント合成スコア。
 * updatedAt / freshness / filename は authoritative truth ではない。
 */
export function scoreDocumentVersionStrength(
  parent: StrategistOrchestratorParent,
): number {
  let score = 0;

  if (parent.freshness === 'current') {
    score += 100;
  } else if (parent.freshness === 'superseded_candidate') {
    score -= 50;
  }

  if (parent.isAuthoritativeCandidate === true) {
    score += 20;
  }

  const updatedAt = parent.updatedAt ? Date.parse(parent.updatedAt) : Number.NaN;
  if (!Number.isNaN(updatedAt)) {
    score += updatedAt / 1e12;
  }

  const fileName = parent.fileName;
  if (WEAK_FILENAME_HINT.test(fileName)) {
    score -= 40;
  }
  if (STRONG_FILENAME_HINT.test(fileName)) {
    score += 15;
  }

  const versionMatch = fileName.match(/v(\d+)|版(\d+)/iu);
  if (versionMatch) {
    score += Number.parseInt(versionMatch[1] ?? versionMatch[2] ?? '0', 10) * 5;
  }

  const yearMatch = fileName.match(/20(\d{2})/u);
  if (yearMatch) {
    score += Number.parseInt(yearMatch[1] ?? '0', 10);
  }

  return score;
}

function buildHumanReviewQuestion(params: {
  weakerFileName: string;
  strongerFileName: string;
  relatedChunkIds: string[];
}): HumanReviewQuestion {
  return {
    question:
      `関連する複数バージョンの文書が検出されました。` +
      `「${params.weakerFileName}」の内容をこの目的で使用してよいですか？` +
      `より新しい候補として「${params.strongerFileName}」も含まれています。`,
    relatedChunkIds: params.relatedChunkIds,
  };
}

function buildHumanConfirmationRef(ref: IncludedChunkRef): HumanConfirmationRequiredRef {
  return {
    docId: ref.docId,
    chunkId: ref.chunkId,
    reason: 'human_confirmation_required',
    rationale:
      '同一バージョン候補の文書が複数含まれているため、人間による最新版確認が必要です。',
  };
}

/**
 * full-coverage merge 後の included について、明らかな duplicate/version family
 * だけを決定論的に検出し、弱い側を human_confirmation_required へ回す。
 *
 * - stale / superseded と断言する auto-exclude はしない（uncertain conflict は human review）
 * - 新しい chunk / doc id は発明しない
 * - 明らかな family が推定できない場合は no-op
 */
export function applyDuplicateVersionAmbiguityGuard(
  input: DuplicateVersionGuardInput,
): DuplicateVersionGuardResult {
  if (input.included.length === 0) {
    return { included: [], humanConfirmationRequired: [], humanReviewQuestions: [] };
  }

  const includedByDoc = new Map<string, IncludedChunkRef[]>();
  for (const ref of input.included) {
    const existing = includedByDoc.get(ref.docId) ?? [];
    existing.push(ref);
    includedByDoc.set(ref.docId, existing);
  }

  const docIds = Array.from(includedByDoc.keys());
  const parents = new Map<string, StrategistOrchestratorParent>();
  for (const docId of docIds) {
    const parent = parentForDoc(docId, input.joinedByKey);
    if (parent) {
      parents.set(docId, parent);
    }
  }

  const routedToReview = new Set<string>();
  const humanReviewQuestions: HumanReviewQuestion[] = [];

  for (let leftIndex = 0; leftIndex < docIds.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < docIds.length; rightIndex += 1) {
      const leftDocId = docIds[leftIndex]!;
      const rightDocId = docIds[rightIndex]!;
      const leftParent = parents.get(leftDocId);
      const rightParent = parents.get(rightDocId);
      if (!leftParent || !rightParent) {
        continue;
      }
      if (!obviousVersionFamily(leftParent, rightParent)) {
        continue;
      }

      const leftScore = scoreDocumentVersionStrength(leftParent);
      const rightScore = scoreDocumentVersionStrength(rightParent);
      if (leftScore === rightScore) {
        continue;
      }

      const weakerDocId = leftScore < rightScore ? leftDocId : rightDocId;
      const strongerParent = leftScore < rightScore ? rightParent : leftParent;
      const weakerParent = leftScore < rightScore ? leftParent : rightParent;
      const weakerRefs = includedByDoc.get(weakerDocId) ?? [];
      if (weakerRefs.length === 0) {
        continue;
      }

      for (const ref of weakerRefs) {
        routedToReview.add(`${ref.docId}\u0000${ref.chunkId}`);
      }

      humanReviewQuestions.push(
        buildHumanReviewQuestion({
          weakerFileName: weakerParent.fileName,
          strongerFileName: strongerParent.fileName,
          relatedChunkIds: weakerRefs.map((ref) => ref.chunkId),
        }),
      );
    }
  }

  if (routedToReview.size === 0) {
    return {
      included: input.included,
      humanConfirmationRequired: [],
      humanReviewQuestions: [],
    };
  }

  const included = input.included.filter(
    (ref) => !routedToReview.has(`${ref.docId}\u0000${ref.chunkId}`),
  );
  const humanConfirmationRequired = input.included
    .filter((ref) => routedToReview.has(`${ref.docId}\u0000${ref.chunkId}`))
    .map((ref) => buildHumanConfirmationRef(ref));

  return { included, humanConfirmationRequired, humanReviewQuestions };
}
