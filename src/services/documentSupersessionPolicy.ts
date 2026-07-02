import type { Freshness } from '../agents/curator/schema';

export type DocumentSupersessionCandidate = {
  id: string;
  fileName: string;
  freshness?: Freshness;
  isAuthoritativeCandidate?: boolean;
  updatedAt?: string;
  /**
   * Future explicit metadata. Current inventory does not persist these yet, but
   * the policy keeps them as the highest-confidence path once available.
   */
  supersededBy?: string;
  version?: string | number;
  effectiveDate?: string;
  /** Whether this document can currently serve as the replacement source. */
  eligibleAsCurrent?: boolean;
};

export type VersionFamilyStem = {
  stem: string;
  hasVersionMarker: boolean;
};

export type SupersessionConfidence = 'high' | 'medium' | 'low';

export type DocumentSupersessionMember<T extends DocumentSupersessionCandidate> = {
  document: T;
  family: VersionFamilyStem;
  versionScore: number;
};

export type DocumentSupersessionGroup<T extends DocumentSupersessionCandidate> = {
  familyStem: string;
  confidence: SupersessionConfidence;
  currentRepresentative?: DocumentSupersessionMember<T>;
  superseded: DocumentSupersessionMember<T>[];
  ambiguous: DocumentSupersessionMember<T>[];
};

export type DocumentSupersessionPolicyResult<T extends DocumentSupersessionCandidate> = {
  groups: DocumentSupersessionGroup<T>[];
  currentRepresentatives: DocumentSupersessionMember<T>[];
  superseded: DocumentSupersessionMember<T>[];
  ambiguous: DocumentSupersessionMember<T>[];
};

const VERSION_MARKER_PATTERNS: RegExp[] = [
  /\(改訂版?\)/giu,
  /\(新版\)/giu,
  /\(旧版\)/giu,
  /(?:^|[_\-\s(（])旧版(?=$|[_\-\s)）.])/gu,
  /(?:^|[_\-\s(（])新版(?=$|[_\-\s)）.])/gu,
  /[_\-\s]v(\d+)/giu,
  /版(\d+)/gu,
  /[_\-\s](20\d{2})(?=$|[_\-\s).])/gu,
  /[_\-\.](old|draft|new|latest|current)(?=$|[_\-\s).])/giu,
];

const WEAK_FILENAME_HINT =
  /(?:^|[_\-\s(（])旧版(?=$|[_\-\s)）.])|old|draft|superseded|廃止|archive/iu;
const STRONG_FILENAME_HINT =
  /(?:^|[_\-\s(（])新(?:版)?(?:$|[_\-\s)）.])|latest|current|改訂|rev\d/iu;

/**
 * Infers an obvious version family from a file name. It intentionally ignores
 * Japanese fiscal-year-like names such as `2023年度研修資料.md`, because those are
 * often subject matter rather than replacement versions.
 */
export function extractVersionFamilyStem(fileName: string): VersionFamilyStem | null {
  const withoutExtension = fileName.replace(/\.[^.]+$/u, '').trim();
  if (withoutExtension.length < 3) {
    return null;
  }

  let stem = withoutExtension;
  let hasVersionMarker = false;
  for (const pattern of VERSION_MARKER_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(stem)) {
      hasVersionMarker = true;
    }
    stem = stem.replace(pattern, '');
  }

  stem = stem.replace(/[_\-\s]+/gu, ' ').trim().toLowerCase();
  if (stem.length < 3) {
    return null;
  }

  return { stem, hasVersionMarker };
}

export function scoreDocumentVersionStrength(
  document: DocumentSupersessionCandidate,
): number {
  let score = 0;

  if (document.freshness === 'current') {
    score += 100;
  } else if (document.freshness === 'superseded_candidate') {
    score -= 50;
  }

  if (document.isAuthoritativeCandidate === true) {
    score += 20;
  }

  const effectiveDate = document.effectiveDate
    ? Date.parse(document.effectiveDate)
    : Number.NaN;
  if (!Number.isNaN(effectiveDate)) {
    score += effectiveDate / 1e12;
  }

  const updatedAt = document.updatedAt ? Date.parse(document.updatedAt) : Number.NaN;
  if (!Number.isNaN(updatedAt)) {
    score += updatedAt / 1e12;
  }

  const fileName = document.fileName;
  if (WEAK_FILENAME_HINT.test(fileName)) {
    score -= 40;
  }
  if (STRONG_FILENAME_HINT.test(fileName)) {
    score += 15;
  }

  const explicitVersion = Number.parseInt(String(document.version ?? ''), 10);
  if (!Number.isNaN(explicitVersion)) {
    score += explicitVersion * 10;
  }

  const versionMatch = fileName.match(/v(\d+)|版(\d+)/iu);
  if (versionMatch) {
    score += Number.parseInt(versionMatch[1] ?? versionMatch[2] ?? '0', 10) * 5;
  }

  const yearMatch = fileName.match(/(?:^|[_\-\s])(20\d{2})(?=$|[_\-\s).])/u);
  if (yearMatch) {
    score += Number.parseInt(yearMatch[1] ?? '0', 10) - 2000;
  }

  return score;
}

function groupCandidates<T extends DocumentSupersessionCandidate>(
  documents: readonly T[],
): Map<string, DocumentSupersessionMember<T>[]> {
  const membersByFamily = new Map<string, DocumentSupersessionMember<T>[]>();
  for (const document of documents) {
    const family = extractVersionFamilyStem(document.fileName);
    if (!family) {
      continue;
    }
    const members = membersByFamily.get(family.stem) ?? [];
    members.push({
      document,
      family,
      versionScore: scoreDocumentVersionStrength(document),
    });
    membersByFamily.set(family.stem, members);
  }
  return membersByFamily;
}

function hasFreshnessSignal<T extends DocumentSupersessionCandidate>(
  members: readonly DocumentSupersessionMember<T>[],
): boolean {
  const values = new Set(members.map((member) => member.document.freshness));
  return values.has('current') && values.has('superseded_candidate');
}

function confidenceForFamily<T extends DocumentSupersessionCandidate>(
  members: readonly DocumentSupersessionMember<T>[],
): SupersessionConfidence | null {
  if (members.length < 2) {
    return null;
  }
  if (members.some((member) => member.document.supersededBy)) {
    return 'high';
  }
  if (members.some((member) => member.family.hasVersionMarker)) {
    return 'medium';
  }
  if (hasFreshnessSignal(members)) {
    return 'low';
  }
  return null;
}

function explicitSupersededByGroup<T extends DocumentSupersessionCandidate>(
  familyStem: string,
  members: readonly DocumentSupersessionMember<T>[],
): DocumentSupersessionGroup<T> | null {
  const byId = new Map(members.map((member) => [member.document.id, member]));
  const superseded = members.filter(
    (member) =>
      member.document.supersededBy !== undefined &&
      byId.has(member.document.supersededBy),
  );
  if (superseded.length === 0) {
    return null;
  }

  const representativeIds = new Set(
    superseded.flatMap((member) => [member.document.supersededBy!]),
  );
  if (representativeIds.size !== 1) {
    return {
      familyStem,
      confidence: 'high',
      superseded: [],
      ambiguous: [...members],
    };
  }

  const representative = byId.get(Array.from(representativeIds)[0]!);
  if (!representative || representative.document.eligibleAsCurrent === false) {
    return {
      familyStem,
      confidence: 'high',
      currentRepresentative: representative,
      superseded: [],
      ambiguous: [...members],
    };
  }

  return {
    familyStem,
    confidence: 'high',
    currentRepresentative: representative,
    superseded,
    ambiguous: members.filter(
      (member) => member !== representative && !superseded.includes(member),
    ),
  };
}

function heuristicGroup<T extends DocumentSupersessionCandidate>(
  familyStem: string,
  confidence: SupersessionConfidence,
  members: readonly DocumentSupersessionMember<T>[],
): DocumentSupersessionGroup<T> {
  const strongestScore = Math.max(...members.map((member) => member.versionScore));
  const strongestMembers = members.filter(
    (member) => member.versionScore === strongestScore,
  );
  if (
    strongestMembers.length !== 1 ||
    strongestMembers[0]!.document.eligibleAsCurrent === false
  ) {
    return {
      familyStem,
      confidence,
      superseded: [],
      ambiguous: [...members],
    };
  }

  const currentRepresentative = strongestMembers[0]!;
  const weaker = members.filter((member) => member.versionScore < strongestScore);
  if (confidence === 'low') {
    return {
      familyStem,
      confidence,
      currentRepresentative,
      superseded: [],
      ambiguous: weaker,
    };
  }

  return {
    familyStem,
    confidence,
    currentRepresentative,
    superseded: weaker,
    ambiguous: [],
  };
}

export function evaluateDocumentSupersessionPolicy<
  T extends DocumentSupersessionCandidate,
>(documents: readonly T[]): DocumentSupersessionPolicyResult<T> {
  const groups: DocumentSupersessionGroup<T>[] = [];
  for (const [familyStem, members] of groupCandidates(documents)) {
    const confidence = confidenceForFamily(members);
    if (!confidence) {
      continue;
    }
    const explicit = explicitSupersededByGroup(familyStem, members);
    groups.push(explicit ?? heuristicGroup(familyStem, confidence, members));
  }

  return {
    groups,
    currentRepresentatives: groups.flatMap((group) =>
      group.currentRepresentative ? [group.currentRepresentative] : [],
    ),
    superseded: groups.flatMap((group) => group.superseded),
    ambiguous: groups.flatMap((group) => group.ambiguous),
  };
}
