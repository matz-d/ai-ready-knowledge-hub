import { describe, expect, it } from 'vitest';
import {
  consolidateMissingAndQuestions,
  consolidateMissingAndQuestionsDeterministic,
} from '../consolidateGaps';

describe('consolidateMissingAndQuestionsDeterministic', () => {
  it('dedupes missing topics and human review questions deterministically', () => {
    const result = consolidateMissingAndQuestionsDeterministic([
      {
        missing: [
          { topic: '最新の運用責任者', whyNeeded: '確認先を確定するため。' },
          { topic: '最新の運用責任者', whyNeeded: '重複は捨てる。' },
        ],
        humanReviewQuestions: [
          {
            question: '旧ルールを廃止済みとして扱ってよいですか？',
            relatedChunkIds: ['chunk-a'],
          },
          {
            question: '旧ルールを廃止済みとして扱ってよいですか？',
            relatedChunkIds: ['chunk-b'],
          },
        ],
      },
      {
        missing: [{ topic: '  最新の運用責任者  ', whyNeeded: '別表記。' }],
        humanReviewQuestions: [
          { question: '承認フローは現行のままでよいですか？' },
        ],
      },
    ]);

    expect(result.missing).toEqual([
      { topic: '最新の運用責任者', whyNeeded: '確認先を確定するため。' },
    ]);
    expect(result.humanReviewQuestions).toEqual([
      {
        question: '旧ルールを廃止済みとして扱ってよいですか？',
        relatedChunkIds: ['chunk-a', 'chunk-b'],
      },
      { question: '承認フローは現行のままでよいですか？' },
    ]);
    expect(result.consolidation).toBe('deterministic');
  });
});

describe('consolidateMissingAndQuestions', () => {
  it('skips reduceFlow for a single batch', async () => {
    const batchOutputs = [
      {
        missing: [{ topic: '不足トピック', whyNeeded: '必要。' }],
        humanReviewQuestions: [],
      },
    ];
    const reduceFlow = async () => {
      throw new Error('single batch should not reduce');
    };

    const result = await consolidateMissingAndQuestions({
      purpose: 'test',
      includedSummary: [],
      batchOutputs,
      reduceFlow,
    });

    expect(result).toEqual(
      consolidateMissingAndQuestionsDeterministic(batchOutputs),
    );
  });

  it('uses reduceFlow after deterministic dedupe', async () => {
    const batchOutputs = [
      {
        missing: [{ topic: '不足トピック', whyNeeded: '必要。' }],
        humanReviewQuestions: [
          { question: '承認者は誰ですか？', relatedChunkIds: ['chunk-1'] },
        ],
      },
      {
        missing: [{ topic: '別の不足トピック', whyNeeded: '必要。' }],
        humanReviewQuestions: [],
      },
    ];
    const reduceCalls: unknown[] = [];
    const reduceFlow = async (input: unknown) => {
      reduceCalls.push(input);
      return {
      missing: [],
      humanReviewQuestions: [
        { question: '承認者は誰ですか？', relatedChunkIds: ['chunk-1'] },
      ],
      };
    };

    const result = await consolidateMissingAndQuestions({
      purpose: 'test',
      includedSummary: [
        {
          docId: 'doc-1',
          fileName: 'a.md',
          chunkId: 'chunk-1',
          rationale: 'included',
        },
      ],
      batchOutputs,
      reduceFlow,
    });

    expect(result).toEqual({
      missing: [],
      humanReviewQuestions: [
        { question: '承認者は誰ですか？', relatedChunkIds: ['chunk-1'] },
      ],
      consolidation: 'llm',
    });
    expect(reduceCalls).toEqual([
      expect.objectContaining({ allowedChunkIds: ['chunk-1'] }),
    ]);
  });

  it('falls back to deterministic consolidation when reduceFlow fails', async () => {
    const batchOutputs = [
      {
        missing: [{ topic: '不足トピック', whyNeeded: '必要。' }],
        humanReviewQuestions: [],
      },
      {
        missing: [{ topic: '別の不足トピック', whyNeeded: '必要。' }],
        humanReviewQuestions: [],
      },
    ];

    const result = await consolidateMissingAndQuestions({
      purpose: 'test',
      includedSummary: [],
      batchOutputs,
      reduceFlow: async () => {
        throw new Error('reduce unavailable');
      },
    });

    expect(result).toEqual({
      ...consolidateMissingAndQuestionsDeterministic(batchOutputs),
      consolidation: 'deterministic_fallback',
    });
  });
});
