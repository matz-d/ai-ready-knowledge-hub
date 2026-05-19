import type { Storage } from '@google-cloud/storage';
import { describe, expect, it, vi } from 'vitest';
import type { DocumentIr } from '../../eval/conversion/documentIr';
import {
  DOCUMENT_IR_GCS_VERSION,
  documentIrStoragePath,
  readDocumentIrSnapshot,
  writeDocumentIrSnapshot,
} from '../documentIrStorage';

// ── Test fixtures ──────────────────────────────────────────────────────────

const MINIMAL_DOCUMENT_IR: DocumentIr = {
  schemaVersion: 1,
  source: {
    fileName: 'mhlw-guide.pdf',
    mediaType: 'application/pdf',
    sourceKind: 'upload',
    sourceSubtype: 'official-doc-pdf',
  },
  pages: [
    {
      pageNumber: 1,
      blocks: [
        {
          blockId: 'p1-b0',
          kind: 'paragraph',
          text: '時間外労働の上限規制について',
        },
      ],
    },
  ],
};

// ── Fake Storage factory ───────────────────────────────────────────────────
//
// Simulates the GCS chainable API: storage.bucket(name).file(path).{exists,download,save}
// `existingFiles` maps GCS object path → stored content (object → JSON-serialised; raw string → verbatim).

type SavedEntry = { body: string; opts: unknown };

function makeFakeStorage(existingFiles: Map<string, unknown | string> = new Map()): {
  storage: Storage;
  savedFiles: Map<string, SavedEntry>;
  bucketSpy: ReturnType<typeof vi.fn>;
  fileSpy: ReturnType<typeof vi.fn>;
} {
  const savedFiles = new Map<string, SavedEntry>();

  const fileSpy = vi.fn((filePath: string) => ({
    exists: vi.fn(async (): Promise<[boolean]> => [existingFiles.has(filePath)]),
    download: vi.fn(async (): Promise<[Buffer]> => {
      const data = existingFiles.get(filePath);
      if (data === undefined) {
        throw Object.assign(new Error(`No such object: ${filePath}`), { code: 404 });
      }
      const content = typeof data === 'string' ? data : JSON.stringify(data);
      return [Buffer.from(content, 'utf-8')];
    }),
    save: vi.fn(async (body: string, opts: unknown) => {
      savedFiles.set(filePath, { body, opts });
    }),
  }));

  const bucketSpy = vi.fn((_bucketName: string) => ({ file: fileSpy }));

  const storage = { bucket: bucketSpy } as unknown as Storage;

  return { storage, savedFiles, bucketSpy, fileSpy };
}

// ── documentIrStoragePath ──────────────────────────────────────────────────

describe('documentIrStoragePath', () => {
  it('returns raw/{docId}/document-ir/v1.json', () => {
    expect(documentIrStoragePath('doc-1')).toBe(
      `raw/doc-1/document-ir/${DOCUMENT_IR_GCS_VERSION}.json`
    );
  });

  it('embeds the docId verbatim', () => {
    const docId = '00000000-0000-4000-8000-000000000001';
    expect(documentIrStoragePath(docId)).toContain(docId);
  });

  it('throws for an empty docId', () => {
    expect(() => documentIrStoragePath('')).toThrow(
      'documentIrStoragePath: docId must be non-empty'
    );
  });

  it('throws for a whitespace-only docId', () => {
    expect(() => documentIrStoragePath('   ')).toThrow(
      'documentIrStoragePath: docId must be non-empty'
    );
  });
});

// ── writeDocumentIrSnapshot ────────────────────────────────────────────────

describe('writeDocumentIrSnapshot', () => {
  it('writes to the correct bucket and path', async () => {
    const { storage, bucketSpy, fileSpy } = makeFakeStorage();

    await writeDocumentIrSnapshot({
      bucketName: 'test-bucket',
      docId: 'doc-1',
      documentIr: MINIMAL_DOCUMENT_IR,
      storage,
    });

    expect(bucketSpy).toHaveBeenCalledWith('test-bucket');
    expect(fileSpy).toHaveBeenCalledWith('raw/doc-1/document-ir/v1.json');
  });

  it('saves with content-type application/json', async () => {
    const { storage, savedFiles } = makeFakeStorage();

    await writeDocumentIrSnapshot({
      bucketName: 'test-bucket',
      docId: 'doc-1',
      documentIr: MINIMAL_DOCUMENT_IR,
      storage,
    });

    const saved = savedFiles.get('raw/doc-1/document-ir/v1.json');
    expect(saved).toBeDefined();
    expect((saved?.opts as { contentType?: string })?.contentType).toBe(
      'application/json'
    );
  });

  it('writes valid JSON with a trailing newline', async () => {
    const { storage, savedFiles } = makeFakeStorage();

    await writeDocumentIrSnapshot({
      bucketName: 'test-bucket',
      docId: 'doc-1',
      documentIr: MINIMAL_DOCUMENT_IR,
      storage,
    });

    const body = savedFiles.get('raw/doc-1/document-ir/v1.json')?.body ?? '';
    expect(() => JSON.parse(body)).not.toThrow();
    expect(body.endsWith('\n')).toBe(true);
  });

  it('returns the GCS object path', async () => {
    const { storage } = makeFakeStorage();

    const path = await writeDocumentIrSnapshot({
      bucketName: 'test-bucket',
      docId: 'doc-1',
      documentIr: MINIMAL_DOCUMENT_IR,
      storage,
    });

    expect(path).toBe('raw/doc-1/document-ir/v1.json');
  });

  it('validates the DocumentIR before writing — invalid IR throws without touching storage', async () => {
    const { storage, savedFiles } = makeFakeStorage();

    await expect(
      writeDocumentIrSnapshot({
        bucketName: 'test-bucket',
        docId: 'doc-1',
        documentIr: {
          ...MINIMAL_DOCUMENT_IR,
          schemaVersion: 999 as unknown as 1, // invalid version
        },
        storage,
      })
    ).rejects.toThrow();

    // Storage must not have been called
    expect(savedFiles.size).toBe(0);
  });
});

// ── readDocumentIrSnapshot ─────────────────────────────────────────────────

describe('readDocumentIrSnapshot', () => {
  it('returns a parsed and validated DocumentIr', async () => {
    const objectPath = documentIrStoragePath('doc-1');
    const { storage } = makeFakeStorage(new Map([[objectPath, MINIMAL_DOCUMENT_IR]]));

    const result = await readDocumentIrSnapshot({
      bucketName: 'test-bucket',
      docId: 'doc-1',
      storage,
    });

    expect(result).toEqual(MINIMAL_DOCUMENT_IR);
  });

  it('reads from the correct bucket and path', async () => {
    const objectPath = documentIrStoragePath('doc-42');
    const { storage, bucketSpy, fileSpy } = makeFakeStorage(
      new Map([[objectPath, MINIMAL_DOCUMENT_IR]])
    );

    await readDocumentIrSnapshot({
      bucketName: 'prod-bucket',
      docId: 'doc-42',
      storage,
    });

    expect(bucketSpy).toHaveBeenCalledWith('prod-bucket');
    expect(fileSpy).toHaveBeenCalledWith(objectPath);
  });

  it('returns null when the object does not exist', async () => {
    const { storage } = makeFakeStorage(); // empty — no existing files

    const result = await readDocumentIrSnapshot({
      bucketName: 'test-bucket',
      docId: 'doc-missing',
      storage,
    });

    expect(result).toBeNull();
  });

  it('throws SyntaxError when stored content is not valid JSON', async () => {
    const objectPath = documentIrStoragePath('doc-1');
    // Store a raw string (not an object) so makeFakeStorage passes it verbatim
    const { storage } = makeFakeStorage(new Map([[objectPath, '<<invalid-json-truncated>>']]));


    await expect(
      readDocumentIrSnapshot({
        bucketName: 'test-bucket',
        docId: 'doc-1',
        storage,
      })
    ).rejects.toThrow(SyntaxError);
  });

  it('throws ZodError when stored document fails schema validation', async () => {
    const objectPath = documentIrStoragePath('doc-1');
    const invalid = {
      schemaVersion: 1,
      source: MINIMAL_DOCUMENT_IR.source,
      pages: 'not-an-array', // invalid
    };
    const { storage } = makeFakeStorage(new Map([[objectPath, invalid]]));

    await expect(
      readDocumentIrSnapshot({
        bucketName: 'test-bucket',
        docId: 'doc-1',
        storage,
      })
    ).rejects.toThrow();
  });

  it('round-trips: written snapshot can be read back correctly', async () => {
    // Use a single fake that acts as both write target and read source
    const savedFiles = new Map<string, unknown>();

    const savingStorage = {
      bucket: vi.fn((_name: string) => ({
        file: vi.fn((path: string) => ({
          exists: vi.fn(async (): Promise<[boolean]> => [savedFiles.has(path)]),
          download: vi.fn(async (): Promise<[Buffer]> => {
            const body = savedFiles.get(path);
            return [Buffer.from(body as string, 'utf-8')];
          }),
          save: vi.fn(async (body: string) => {
            savedFiles.set(path, body);
          }),
        })),
      })),
    } as unknown as Storage;

    await writeDocumentIrSnapshot({
      bucketName: 'test-bucket',
      docId: 'round-trip-doc',
      documentIr: MINIMAL_DOCUMENT_IR,
      storage: savingStorage,
    });

    const result = await readDocumentIrSnapshot({
      bucketName: 'test-bucket',
      docId: 'round-trip-doc',
      storage: savingStorage,
    });

    expect(result).toEqual(MINIMAL_DOCUMENT_IR);
  });
});
