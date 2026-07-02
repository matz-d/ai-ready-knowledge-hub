import type {
  HumanReviewQuestion,
  IncludedChunkRef,
  StrategistOutput,
} from '../../agents/strategist/schema';
import {
  evaluateDocumentSupersessionPolicy,
  extractVersionFamilyStem,
  scoreDocumentVersionStrength,
} from '../documentSupersessionPolicy';
import type { StrategistOrchestratorParent } from './types';

export { extractVersionFamilyStem, scoreDocumentVersionStrength };

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

/**
 * full-coverage merge 後の included について、明らかな duplicate/version family
 * だけを決定論的に検出し、family 内の弱い側をまとめて human_confirmation_required へ回す。
 *
 * - stale / superseded と断言する auto-exclude はしない（uncertain conflict は human review）
 * - 新しい chunk / doc id は発明しない
 * - 明らかな family が推定できない場合は no-op
 *
 * 段階ごとの責務の違いに注意（共有 policy は同一だが結論が異なる）:
 *   - 候補 UI（classifyInventory / applyCrossDocumentVersionExclusions）は生成前の
 *     metadata-only 助言レイヤなので、明確に superseded な旧版は auto-exclude まで降格する。
 *   - 本 guard は生成後の included に対する最終ゲートなので、断言せず
 *     human_confirmation_required に留める（送信は予測、除外は断言）。
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

  const parents = buildParentByDocId(input.joinedByKey);
  const policy = evaluateDocumentSupersessionPolicy(
    Array.from(includedByDoc.keys()).flatMap((docId) => {
      const parent = parents.get(docId);
      if (!parent) {
        return [];
      }
      return [{ ...parent, eligibleAsCurrent: true }];
    }),
  );

  const routedToReview = new Set<string>();
  const humanReviewQuestions: HumanReviewQuestion[] = [];

  for (const group of policy.groups) {
    const weakerMembers = [...group.superseded, ...group.ambiguous];
    if (!group.currentRepresentative || weakerMembers.length === 0) {
      continue;
    }

    for (const member of weakerMembers) {
      for (const ref of includedByDoc.get(member.document.id) ?? []) {
        routedToReview.add(`${ref.docId}\u0000${ref.chunkId}`);
      }
    }

    humanReviewQuestions.push(
      buildHumanReviewQuestion({
        weakerFileNames: weakerMembers.map((member) => member.document.fileName),
        strongerFileName: group.currentRepresentative.document.fileName,
        relatedChunkIds: weakerMembers.flatMap((member) =>
          (includedByDoc.get(member.document.id) ?? []).map((ref) => ref.chunkId),
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
