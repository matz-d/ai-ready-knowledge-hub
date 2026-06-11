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
  /(?:^|[_\-\s(（])旧版(?=$|[_\-\s)）.])/gu,
  /(?:^|[_\-\s(（])新版(?=$|[_\-\s)）.])/gu,
  /[_\-\s]v(\d+)/gi,
  /版(\d+)/g,
  /[_\-\s](20\d{2})/g,
  /[_\-\.](old|draft|new|latest|current)/gi,
];

const WEAK_FILENAME_HINT =
  /(?:^|[_\-\s(（])旧版(?=$|[_\-\s)）.])|old|draft|superseded|廃止|archive/iu;
const STRONG_FILENAME_HINT =
  /(?:^|[_\-\s(（])新(?:版)?(?:$|[_\-\s)）.])|latest|current|改訂|rev\d/iu;

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

function buildParentByDocId(
  joinedByKey: JoinedParentLookup,
): Map<string, StrategistOrchestratorParent> {
  const parents = new Map<string, StrategistOrchestratorParent>();
  for (const [key, joined] of joinedByKey) {
    const [joinedDocId] = key.split('\u0000');
    if (joinedDocId && !parents.has(joinedDocId)) {
      parents.set(joinedDocId, joined.parent);
    }
  }
  return parents;
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
  weakerFileNames: string[];
  strongerFileName: string;
  relatedChunkIds: string[];
}): HumanReviewQuestion {
  const weakerNames = params.weakerFileNames
    .map((fileName) => `「${fileName}」`)
    .join('、');
  return {
    question:
      `関連する複数バージョンの文書が検出されました。` +
      `${weakerNames}の内容をこの目的で使用してよいですか？` +
      `最も新しい候補として「${params.strongerFileName}」も含まれています。`,
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

type VersionFamilyMember = {
  docId: string;
  refs: IncludedChunkRef[];
  parent: StrategistOrchestratorParent;
  family: VersionFamilyStem;
  score: number;
};

function hasVersionFreshnessSignal(members: readonly VersionFamilyMember[]): boolean {
  const freshnessValues = new Set(
    members.map((member) => member.parent.freshness).filter(Boolean),
  );
  if (freshnessValues.size <= 1) {
    return false;
  }
  return (
    freshnessValues.has('current') ||
    freshnessValues.has('superseded_candidate')
  );
}

function shouldInspectVersionFamily(
  members: readonly VersionFamilyMember[],
): boolean {
  if (members.length < 2) {
    return false;
  }
  return (
    members.some((member) => member.family.hasVersionMarker) ||
    hasVersionFreshnessSignal(members)
  );
}

/**
 * full-coverage merge 後の included について、明らかな duplicate/version family
 * だけを決定論的に検出し、family 内の弱い側をまとめて human_confirmation_required へ回す。
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
  const parents = buildParentByDocId(input.joinedByKey);
  const membersByFamily = new Map<string, VersionFamilyMember[]>();
  for (const docId of docIds) {
    const parent = parents.get(docId);
    const family = parent ? extractVersionFamilyStem(parent.fileName) : null;
    const refs = includedByDoc.get(docId) ?? [];
    if (!parent || !family || refs.length === 0) {
      continue;
    }
    const existing = membersByFamily.get(family.stem) ?? [];
    existing.push({
      docId,
      refs,
      parent,
      family,
      score: scoreDocumentVersionStrength(parent),
    });
    membersByFamily.set(family.stem, existing);
  }

  const routedToReview = new Set<string>();
  const humanReviewQuestions: HumanReviewQuestion[] = [];

  for (const members of membersByFamily.values()) {
    if (!shouldInspectVersionFamily(members)) {
      continue;
    }
    const strongestScore = Math.max(...members.map((member) => member.score));
    const strongestMembers = members.filter(
      (member) => member.score === strongestScore,
    );
    if (strongestMembers.length !== 1) {
      continue;
    }
    const weakerMembers = members.filter((member) => member.score < strongestScore);
    if (weakerMembers.length === 0) {
      continue;
    }

    for (const member of weakerMembers) {
      for (const ref of member.refs) {
        routedToReview.add(`${ref.docId}\u0000${ref.chunkId}`);
      }
    }

    humanReviewQuestions.push(
      buildHumanReviewQuestion({
        weakerFileNames: weakerMembers.map((member) => member.parent.fileName),
        strongerFileName: strongestMembers[0]!.parent.fileName,
        relatedChunkIds: weakerMembers.flatMap((member) =>
          member.refs.map((ref) => ref.chunkId),
        ),
      }),
    );
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
