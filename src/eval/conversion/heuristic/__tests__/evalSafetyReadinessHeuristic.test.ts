import { describe, expect, it, vi } from 'vitest';
import type { CloudDlpClient } from '../../../../agents/masker/cloudDlpMasker';
import { parseDocumentIr } from '../../documentIr';
import {
  evalSafetyReadinessHeuristic,
  SAFETY_READINESS_DRY_RUN_RESULT,
} from '../evalSafetyReadinessHeuristic';
import { runConversionEvalHeuristic } from '../runConversionEvalHeuristic';

const DOCUMENT_IR = parseDocumentIr({
  schemaVersion: 1,
  source: {
    fileName: 'safety-smoke.pdf',
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

function findingFor(content: string, text: string) {
  const start = content.indexOf(text);
  if (start < 0) {
    throw new Error(`test fixture text not found: ${text}`);
  }
  return {
    infoType: { name: 'EMAIL_ADDRESS' },
    location: {
      byteRange: {
        start: Buffer.byteLength(content.slice(0, start), 'utf8'),
        end: Buffer.byteLength(content.slice(0, start + text.length), 'utf8'),
      },
    },
  };
}

function findingBetween(content: string, startText: string, endText: string) {
  const start = content.indexOf(startText);
  const endStart = content.indexOf(endText);
  if (start < 0 || endStart < 0) {
    throw new Error(`test fixture boundary text not found`);
  }
  const end = endStart + endText.length;
  return {
    infoType: { name: 'PERSON_NAME' },
    location: {
      byteRange: {
        start: Buffer.byteLength(content.slice(0, start), 'utf8'),
        end: Buffer.byteLength(content.slice(0, end), 'utf8'),
      },
    },
  };
}

function createClient(): CloudDlpClient & {
  inspectContent: ReturnType<typeof vi.fn>;
  deidentifyContent: ReturnType<typeof vi.fn>;
} {
  const inspectContent = vi.fn().mockImplementation(async (request) => {
    const content = String(request.item?.value ?? '');
    return [
      {
        result: {
          findings: [
            findingFor(content, 'safe@example.com'),
            findingFor(content, 'image@example.com'),
            findingFor(content, 'nolocator@example.com'),
            findingBetween(content, 'Boundary', 'Person'),
          ],
        },
      },
    ];
  });
  const deidentifyContent = vi.fn().mockResolvedValue([{ item: { value: '' } }]);
  return { inspectContent, deidentifyContent };
}

describe('evalSafetyReadinessHeuristic', () => {
  it('maps DLP spans to maskable chunks and counts unmaskable findings', async () => {
    const client = createClient();
    const result = await evalSafetyReadinessHeuristic(
      {
        documentIr: DOCUMENT_IR,
        chunks: [
          {
            docId: 'doc-1',
            text: 'Contact safe@example.com.',
            structureType: 'paragraph',
            locator: { kind: 'pdf', page: 1 },
          },
          {
            docId: 'doc-1',
            text: 'OCR image@example.com.',
            structureType: 'imageText',
            locator: { kind: 'imageText' },
          },
          {
            docId: 'doc-1',
            text: 'Missing locator nolocator@example.com.',
            structureType: 'paragraph',
          },
          {
            docId: 'doc-1',
            text: 'Boundary',
            structureType: 'paragraph',
            locator: { kind: 'pdf', page: 1, paragraphId: 'a' },
          },
          {
            docId: 'doc-1',
            text: 'Person',
            structureType: 'paragraph',
            locator: { kind: 'pdf', page: 1, paragraphId: 'b' },
          },
        ],
      },
      { projectId: 'test-project', client }
    );

    expect(result.safetyReadiness).toEqual({
      // imageText, missing locator, and boundary-spanning finding.
      unmaskablePiiFindings: 3,
      maskableChunkRate: 1 / 5,
    });
    expect(client.inspectContent).toHaveBeenCalledTimes(1);
    expect(client.deidentifyContent).toHaveBeenCalledTimes(1);
  });

  it('returns fixed values and skips DLP when dryRun is enabled', async () => {
    const client = createClient();
    const result = await evalSafetyReadinessHeuristic(
      {
        documentIr: DOCUMENT_IR,
        chunks: [
          {
            docId: 'doc-1',
            text: 'Contact safe@example.com.',
            structureType: 'paragraph',
            locator: { kind: 'pdf', page: 1 },
          },
        ],
      },
      { dryRun: true, projectId: 'test-project', client }
    );

    expect(result).toEqual(SAFETY_READINESS_DRY_RUN_RESULT);
    expect(client.inspectContent).not.toHaveBeenCalled();
    expect(client.deidentifyContent).not.toHaveBeenCalled();
  });

  it('calls DLP once per distinct docId', async () => {
    const inspectContent = vi.fn().mockResolvedValue([{ result: { findings: [] } }]);
    const deidentifyContent = vi
      .fn()
      .mockResolvedValue([{ item: { value: '' } }]);
    const client = { inspectContent, deidentifyContent };

    const result = await evalSafetyReadinessHeuristic(
      {
        documentIr: DOCUMENT_IR,
        chunks: [
          { docId: 'doc-1', text: 'a', locator: { kind: 'pdf' } },
          { docId: 'doc-1', text: 'b', locator: { kind: 'pdf' } },
          { docId: 'doc-2', text: 'c', locator: { kind: 'pdf' } },
        ],
      },
      { projectId: 'test-project', client }
    );

    expect(result.safetyReadiness).toEqual({
      unmaskablePiiFindings: 0,
      maskableChunkRate: 0,
    });
    expect(inspectContent).toHaveBeenCalledTimes(2);
    expect(deidentifyContent).toHaveBeenCalledTimes(2);
  });

  it('returns a perfect rate for an empty chunk list', async () => {
    const client = createClient();
    const result = await evalSafetyReadinessHeuristic(
      { documentIr: DOCUMENT_IR, chunks: [] },
      { projectId: 'test-project', client }
    );

    expect(result.safetyReadiness).toEqual({
      unmaskablePiiFindings: 0,
      maskableChunkRate: 1,
    });
    expect(client.inspectContent).not.toHaveBeenCalled();
  });

  it('can produce a full heuristic-stage ConversionEvalResult', async () => {
    const result = await runConversionEvalHeuristic({
      documentIr: DOCUMENT_IR,
      chunks: [
        {
          docId: 'doc-1',
          text: 'Contact safe@example.com.',
          structureType: 'paragraph',
          locator: { kind: 'pdf', page: 1 },
        },
      ],
      safetyReadinessOptions: { dryRun: true },
    });

    expect(result.schemaValidity.passed).toBe(true);
    expect(result.coverage.pageCoverage).toBe(1);
    expect(result.locatorQuality.hasPageLocators).toBe(true);
    expect(result.contextPackageReadiness.chunkCount).toBe(1);
    expect(result.safetyReadiness).toEqual(
      SAFETY_READINESS_DRY_RUN_RESULT.safetyReadiness
    );
    expect(result.overall.status).toBe('pass');
  });
});
