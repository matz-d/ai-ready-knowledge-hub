import type { Storage } from '@google-cloud/storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getKnowledgeHubBucketNameMock } = vi.hoisted(() => ({
  getKnowledgeHubBucketNameMock: vi.fn(),
}));

vi.mock('../../storage', () => ({
  getKnowledgeHubBucketName: getKnowledgeHubBucketNameMock,
}));

import {
  contextPackageJobResultObjectPath,
  deleteContextPackageJobResult,
  readContextPackageJobResult,
  writeContextPackageJobResult,
} from '../resultStorage';

type SavedEntry = { body: string; opts: unknown };
type ExistingEntry = {
  payload: unknown | string;
  metadata?: { tenantId?: string; jobId?: string };
};

function makeFakeStorage(
  existingFiles: Map<string, unknown | string | ExistingEntry> = new Map(),
): {
  storage: Storage;
  savedFiles: Map<string, SavedEntry>;
  deletedFiles: string[];
  bucketSpy: ReturnType<typeof vi.fn>;
  fileSpy: ReturnType<typeof vi.fn>;
} {
  const savedFiles = new Map<string, SavedEntry>();
  const deletedFiles: string[] = [];
  const fileSpy = vi.fn((filePath: string) => ({
    save: vi.fn(async (body: string, opts: unknown) => {
      savedFiles.set(filePath, { body, opts });
    }),
    delete: vi.fn(async () => {
      deletedFiles.push(filePath);
    }),
    getMetadata: vi.fn(async () => {
      const data = existingFiles.get(filePath);
      const metadata =
        data && typeof data === 'object' && 'payload' in data
          ? (data as ExistingEntry).metadata
          : undefined;
      return [{ metadata: metadata ?? {} }];
    }),
    download: vi.fn(async (): Promise<[Buffer]> => {
      const data = existingFiles.get(filePath);
      if (data === undefined) {
        throw Object.assign(new Error(`No such object: ${filePath}`), { code: 404 });
      }
      const payload =
        data && typeof data === 'object' && 'payload' in data ? data.payload : data;
      const content = typeof payload === 'string' ? payload : JSON.stringify(payload);
      return [Buffer.from(content, 'utf-8')];
    }),
  }));
  const bucketSpy = vi.fn((_bucketName: string) => ({ file: fileSpy }));
  const storage = { bucket: bucketSpy } as unknown as Storage;
  return { storage, savedFiles, deletedFiles, bucketSpy, fileSpy };
}

beforeEach(() => {
  getKnowledgeHubBucketNameMock.mockReturnValue('knowledge-hub-bucket');
});

describe('contextPackageJobResultObjectPath', () => {
  it('tenant/job を URL-safe path segment にエンコードする', () => {
    expect(contextPackageJobResultObjectPath('tenant 1', 'job/1')).toBe(
      'context-package/job-results/tenant%201/job%2F1.json',
    );
  });

  it('空文字/空白のみの segment は拒否する', () => {
    expect(() => contextPackageJobResultObjectPath(' ', 'job-1')).toThrow(
      'context package job result path segment must be non-empty',
    );
  });
});

describe('writeContextPackageJobResult', () => {
  it('JSON payload を既定 bucket/path に保存し resultRef を返す', async () => {
    const { storage, savedFiles, bucketSpy, fileSpy } = makeFakeStorage();
    const payload = { markdown: '# hello', summary: { included: 2 } };

    const resultRef = await writeContextPackageJobResult({
      tenantId: 'tenant-1',
      jobId: 'job-1',
      payload,
      storage,
    });

    expect(bucketSpy).toHaveBeenCalledWith('knowledge-hub-bucket');
    expect(fileSpy).toHaveBeenCalledWith(
      'context-package/job-results/tenant-1/job-1.json',
    );
    const saved = savedFiles.get('context-package/job-results/tenant-1/job-1.json');
    expect(saved).toBeDefined();
    expect(JSON.parse(saved?.body ?? '{}')).toEqual(payload);
    expect(resultRef).toEqual({
      storage: 'gcs',
      bucket: 'knowledge-hub-bucket',
      objectPath: 'context-package/job-results/tenant-1/job-1.json',
      contentType: 'application/json',
      byteSize: Buffer.byteLength(JSON.stringify(payload), 'utf8'),
    });
  });
});

describe('readContextPackageJobResult', () => {
  it('GCS object を JSON object として読み出す', async () => {
    const objectPath = 'context-package/job-results/tenant-1/job-1.json';
    const { storage } = makeFakeStorage(
      new Map([[objectPath, { markdown: '# from gcs', counts: { included: 1 } }]]),
    );

    const payload = await readContextPackageJobResult(
      {
        storage: 'gcs',
        bucket: 'knowledge-hub-bucket',
        objectPath,
        contentType: 'application/json',
        byteSize: 10,
      },
      storage,
    );

    expect(payload).toEqual({ markdown: '# from gcs', counts: { included: 1 } });
  });

  it('JSON object 以外（配列など）は拒否する', async () => {
    const objectPath = 'context-package/job-results/tenant-1/job-1.json';
    const { storage } = makeFakeStorage(new Map([[objectPath, [1, 2, 3]]]));

    await expect(
      readContextPackageJobResult(
        {
          storage: 'gcs',
          bucket: 'knowledge-hub-bucket',
          objectPath,
          contentType: 'application/json',
          byteSize: 3,
        },
        storage,
      ),
    ).rejects.toThrow('offloaded context package result must be a JSON object');
  });

  it('expected tenant/job 指定時は path と metadata の一致を確認する', async () => {
    const objectPath = 'context-package/job-results/tenant-1/job-1.json';
    const { storage } = makeFakeStorage(
      new Map([
        [
          objectPath,
          {
            payload: { markdown: '# from gcs' },
            metadata: { tenantId: 'tenant-1', jobId: 'job-1' },
          },
        ],
      ]),
    );

    const payload = await readContextPackageJobResult(
      {
        storage: 'gcs',
        bucket: 'knowledge-hub-bucket',
        objectPath,
        contentType: 'application/json',
        byteSize: 10,
      },
      { tenantId: 'tenant-1', jobId: 'job-1' },
      storage,
    );

    expect(payload).toEqual({ markdown: '# from gcs' });
  });

  it('expected tenant/job と path が違う resultRef は拒否する', async () => {
    const objectPath = 'context-package/job-results/tenant-2/job-1.json';
    const { storage } = makeFakeStorage(new Map([[objectPath, { markdown: '# nope' }]]));

    await expect(
      readContextPackageJobResult(
        {
          storage: 'gcs',
          bucket: 'knowledge-hub-bucket',
          objectPath,
          contentType: 'application/json',
          byteSize: 10,
        },
        { tenantId: 'tenant-1', jobId: 'job-1' },
        storage,
      ),
    ).rejects.toThrow('offloaded context package result path does not match job');
  });
});

describe('deleteContextPackageJobResult', () => {
  it('resultRef の object を削除する', async () => {
    const objectPath = 'context-package/job-results/tenant-1/job-1.json';
    const { storage, deletedFiles } = makeFakeStorage();

    await deleteContextPackageJobResult(
      {
        storage: 'gcs',
        bucket: 'knowledge-hub-bucket',
        objectPath,
        contentType: 'application/json',
        byteSize: 10,
      },
      storage,
    );

    expect(deletedFiles).toEqual([objectPath]);
  });
});
