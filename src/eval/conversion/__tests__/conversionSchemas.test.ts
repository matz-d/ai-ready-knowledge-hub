import { describe, expect, it } from 'vitest';
import { KnowledgeChunkSchema } from '../../../lib/knowledgeChunkSchema';
import {
  assertConversionEvalResultStageShape,
  ConversionEvalResultSchema,
  createEmptyConversionEvalResult,
  parseConversionEvalResult,
} from '../conversionEvalResult';
import {
  CONVERSION_EVAL_AXES_MEASURED_BY_STAGE,
  CONVERSION_EVAL_BLOCKER_AXES,
} from '../conversionEvalStage';
import {
  DocumentIrSchema,
  documentSourceSubtypeToKnowledgeChunkSourceType,
  parseDocumentIr,
} from '../documentIr';
import {
  attachOverallStatus,
  rollupOverallStatus,
} from '../rollupOverallStatus';
import { evalSafetyReadiness } from '../evalSafetyReadiness';

describe('DocumentIrSchema', () => {
  it('parses a minimal official-doc-pdf scaffold', () => {
    const ir = parseDocumentIr({
      schemaVersion: 1,
      source: {
        fileName: 'sample.pdf',
        mediaType: 'application/pdf',
        sourceKind: 'poc',
        sourceSubtype: 'official-doc-pdf',
      },
      pages: [
        {
          pageNumber: 1,
          blocks: [
            {
              blockId: 'p1-b1',
              kind: 'paragraph',
              text: 'hello',
              locator: { pageNumber: 1 },
            },
          ],
        },
      ],
    });
    expect(ir.schemaVersion).toBe(1);
    expect(
      documentSourceSubtypeToKnowledgeChunkSourceType(
        ir.source.sourceSubtype
      )
    ).toBe('pdf');
  });

  it('rejects invalid block kind', () => {
    const parsed = DocumentIrSchema.safeParse({
      schemaVersion: 1,
      source: {
        fileName: 'x.pdf',
        mediaType: 'application/pdf',
        sourceKind: 'poc',
        sourceSubtype: 'official-doc-pdf',
      },
      pages: [
        {
          pageNumber: 1,
          blocks: [{ blockId: 'b1', kind: 'imageText', text: 'x' }],
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });
});

describe('ConversionEvalResultSchema', () => {
  it('parses empty result and stage shape rules', () => {
    const empty = createEmptyConversionEvalResult();
    expect(ConversionEvalResultSchema.parse(empty)).toEqual(empty);
    assertConversionEvalResultStageShape(empty, 'health');
    assertConversionEvalResultStageShape(empty, 'heuristic');
  });

  it('rejects golden-only fields before golden stage', () => {
    const withGolden = createEmptyConversionEvalResult();
    withGolden.safetyReadiness.piiDetectionRecall = 0.9;
    expect(() =>
      assertConversionEvalResultStageShape(withGolden, 'heuristic')
    ).toThrow(/piiDetectionRecall/);
  });

  it('allows golden-only fields at golden stage', () => {
    const golden = createEmptyConversionEvalResult();
    golden.semanticRetention.keyFieldRecall = 0.8;
    golden.locatorQuality.locatorAccuracy = 0.7;
    golden.safetyReadiness.piiDetectionRecall = 0.9;
    assertConversionEvalResultStageShape(golden, 'golden');
    expect(parseConversionEvalResult(golden)).toEqual(golden);
  });
});

describe('stage maturity metadata', () => {
  it('lists blocker axes and per-stage measured axes', () => {
    expect(CONVERSION_EVAL_BLOCKER_AXES).toEqual([
      'schema_validity',
      'safety_readiness',
    ]);
    expect(CONVERSION_EVAL_AXES_MEASURED_BY_STAGE.health).not.toContain(
      'safety_readiness'
    );
    expect(CONVERSION_EVAL_AXES_MEASURED_BY_STAGE.heuristic).toContain(
      'safety_readiness'
    );
    expect(CONVERSION_EVAL_AXES_MEASURED_BY_STAGE.golden).toContain(
      'semantic_retention'
    );
  });
});

describe('safety_readiness health rollup', () => {
  it('returns pass at health even when heuristic metrics look bad', () => {
    const result = createEmptyConversionEvalResult();
    result.safetyReadiness.unmaskablePiiFindings = 99;
    result.safetyReadiness.maskableChunkRate = 0;
    expect(evalSafetyReadiness(result, 'health')).toBe('pass');
    expect(rollupOverallStatus(result, 'health').status).toBe('pass');
    expect(
      attachOverallStatus(result, 'health').overall.reasons
    ).not.toContain('safety_readiness: fail');
  });
});

describe('KnowledgeChunk alignment', () => {
  it('accepts pdf locator shape produced by official-doc-pdf adapter mapping', () => {
    const chunk = KnowledgeChunkSchema.parse({
      id: 'c1',
      docId: 'd1',
      schemaVersion: 1,
      sourceType: 'pdf',
      structureType: 'paragraph',
      locator: { kind: 'pdf', page: 1, paragraphId: 'table-0-row-1' },
      text: 'cell',
      sensitivity: 'Public',
      aiUsePolicy: 'direct',
      sensitivitySource: 'inherited',
      extractionProvider: 'pdf',
      sourceHash: 'abc',
      createdAt: '2026-05-18T00:00:00.000Z',
      updatedAt: '2026-05-18T00:00:00.000Z',
    });
    expect(chunk.locator.kind).toBe('pdf');
  });
});
