import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createTaskMock, queuePathMock } = vi.hoisted(() => ({
  createTaskMock: vi.fn(),
  queuePathMock: vi.fn(),
}));

vi.mock('@google-cloud/tasks', () => ({
  CloudTasksClient: vi.fn().mockImplementation(function CloudTasksClient() {
    return {
      queuePath: queuePathMock,
      createTask: createTaskMock,
    };
  }),
}));

import {
  PdfTableAssistQueueNotConfiguredError,
  cloudTasksPdfTableAssistIngestEnqueuer,
} from '../pdfTableAssistIngestEnqueuer';
import { verifyPdfTableAssistTaskPayload } from '../pdfTableAssistTaskSigning';

function clearEnv() {
  delete process.env.GOOGLE_CLOUD_PROJECT;
  delete process.env.GOOGLE_CLOUD_LOCATION;
  delete process.env.PDF_TABLE_ASSIST_TASKS_LOCATION;
  delete process.env.PDF_TABLE_ASSIST_TASKS_QUEUE;
  delete process.env.PDF_TABLE_ASSIST_WORKER_BASE_URL;
  delete process.env.PDF_TABLE_ASSIST_WORKER_SA_EMAIL;
  delete process.env.PDF_TABLE_ASSIST_WORKER_OIDC_AUDIENCE;
  delete process.env.PDF_TABLE_ASSIST_WORKER_TOKEN;
  delete process.env.PDF_TABLE_ASSIST_TASK_SIGNING_SECRET;
  vi.unstubAllEnvs();
  delete process.env.CONTEXT_PACKAGE_TASKS_LOCATION;
  delete process.env.CONTEXT_PACKAGE_TASKS_QUEUE;
  delete process.env.CONTEXT_PACKAGE_WORKER_BASE_URL;
  delete process.env.CONTEXT_PACKAGE_WORKER_SA_EMAIL;
  delete process.env.CONTEXT_PACKAGE_WORKER_OIDC_AUDIENCE;
  delete process.env.CONTEXT_PACKAGE_JOB_TOKEN;
}

beforeEach(() => {
  vi.clearAllMocks();
  clearEnv();
  queuePathMock.mockReturnValue(
    'projects/project-1/locations/asia-northeast1/queues/table-assist'
  );
  createTaskMock.mockResolvedValue([{ name: 'task-1' }]);
});

afterEach(() => {
  clearEnv();
  vi.unstubAllEnvs();
});

describe('cloudTasksPdfTableAssistIngestEnqueuer', () => {
  it('creates an OIDC HTTP task for the table-assist worker route', async () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'project-1';
    process.env.PDF_TABLE_ASSIST_TASKS_LOCATION = 'asia-northeast1';
    process.env.PDF_TABLE_ASSIST_TASKS_QUEUE = 'table-assist';
    process.env.PDF_TABLE_ASSIST_WORKER_BASE_URL = 'https://service.example/';
    process.env.PDF_TABLE_ASSIST_WORKER_SA_EMAIL =
      'table-assist-worker@project-1.iam.gserviceaccount.com';
    process.env.PDF_TABLE_ASSIST_WORKER_OIDC_AUDIENCE = 'iap-client-id';
    process.env.PDF_TABLE_ASSIST_WORKER_TOKEN = 'secret';
    process.env.PDF_TABLE_ASSIST_TASK_SIGNING_SECRET = 'signing-secret';

    const request = {
      docId: 'doc-1',
      tenantId: 'tenant-1',
      actor: {
        userId: 'user-1',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      },
    };

    await cloudTasksPdfTableAssistIngestEnqueuer.enqueue(request);

    expect(queuePathMock).toHaveBeenCalledWith(
      'project-1',
      'asia-northeast1',
      'table-assist'
    );
    expect(createTaskMock).toHaveBeenCalledWith({
      parent: 'projects/project-1/locations/asia-northeast1/queues/table-assist',
      task: expect.objectContaining({
        name: 'projects/project-1/locations/asia-northeast1/queues/table-assist/tasks/table-assist-doc-1',
        httpRequest: expect.objectContaining({
          httpMethod: 'POST',
          url: 'https://service.example/api/documents/doc-1/table-assist/run',
          headers: {
            'Content-Type': 'application/json',
            'X-Pdf-Table-Assist-Worker-Token': 'secret',
          },
          oidcToken: {
            serviceAccountEmail:
              'table-assist-worker@project-1.iam.gserviceaccount.com',
            audience: 'iap-client-id',
          },
        }),
      }),
    });

    const task = createTaskMock.mock.calls[0][0].task;
    const body = JSON.parse(
      Buffer.from(task.httpRequest.body, 'base64').toString('utf8')
    );
    expect(body.docId).toBe('doc-1');
    expect(body.tenantId).toBe('tenant-1');
    expect(body.actor).toEqual(request.actor);
    expect(body.issuedAt).toEqual(expect.any(String));
    expect(body.signature).toEqual(expect.any(String));

    const verified = verifyPdfTableAssistTaskPayload(body, {
      secret: 'signing-secret',
    });
    expect(verified.ok).toBe(true);
  });

  it('rejects enqueue in production when task signing secret is missing', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    process.env.GOOGLE_CLOUD_PROJECT = 'project-1';
    process.env.PDF_TABLE_ASSIST_TASKS_LOCATION = 'asia-northeast1';
    process.env.PDF_TABLE_ASSIST_TASKS_QUEUE = 'table-assist';
    process.env.PDF_TABLE_ASSIST_WORKER_BASE_URL = 'https://service.example/';
    process.env.PDF_TABLE_ASSIST_WORKER_SA_EMAIL =
      'table-assist-worker@project-1.iam.gserviceaccount.com';

    await expect(
      cloudTasksPdfTableAssistIngestEnqueuer.enqueue({
        docId: 'doc-1',
        tenantId: 'tenant-1',
        actor: {
          userId: 'user-1',
          ipAddress: '127.0.0.1',
          userAgent: 'vitest',
        },
      })
    ).rejects.toThrow(/PDF_TABLE_ASSIST_TASK_SIGNING_SECRET/);
    expect(createTaskMock).not.toHaveBeenCalled();
  });

  it('falls back to the existing context-package Cloud Tasks env', async () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'project-1';
    process.env.GOOGLE_CLOUD_LOCATION = 'asia-northeast1';
    process.env.CONTEXT_PACKAGE_TASKS_QUEUE = 'context-package-jobs';
    process.env.CONTEXT_PACKAGE_WORKER_BASE_URL = 'https://service.example';
    process.env.CONTEXT_PACKAGE_WORKER_SA_EMAIL =
      'context-worker@project-1.iam.gserviceaccount.com';
    process.env.CONTEXT_PACKAGE_JOB_TOKEN = 'shared-secret';

    await cloudTasksPdfTableAssistIngestEnqueuer.enqueue({
      docId: 'doc.1',
      tenantId: 'tenant-1',
      actor: {
        userId: 'user-1',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      },
    });

    expect(queuePathMock).toHaveBeenCalledWith(
      'project-1',
      'asia-northeast1',
      'context-package-jobs'
    );
    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        task: expect.objectContaining({
          name: expect.stringContaining('/tasks/table-assist-doc-1'),
          httpRequest: expect.objectContaining({
            headers: expect.objectContaining({
              'X-Pdf-Table-Assist-Worker-Token': 'shared-secret',
            }),
            oidcToken: {
              serviceAccountEmail:
                'context-worker@project-1.iam.gserviceaccount.com',
            },
          }),
        }),
      })
    );
  });

  it('rejects GOOGLE_CLOUD_LOCATION=global because Cloud Tasks queues are regional', async () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'project-1';
    process.env.GOOGLE_CLOUD_LOCATION = 'global';
    process.env.CONTEXT_PACKAGE_TASKS_QUEUE = 'context-package-jobs';
    process.env.CONTEXT_PACKAGE_WORKER_BASE_URL = 'https://service.example';
    process.env.CONTEXT_PACKAGE_WORKER_SA_EMAIL =
      'context-worker@project-1.iam.gserviceaccount.com';

    await expect(
      cloudTasksPdfTableAssistIngestEnqueuer.enqueue({
        docId: 'doc-1',
        tenantId: 'tenant-1',
        actor: {
          userId: 'user-1',
          ipAddress: '127.0.0.1',
          userAgent: 'vitest',
        },
      })
    ).rejects.toThrow(/regional Cloud Tasks location/);
    expect(createTaskMock).not.toHaveBeenCalled();
  });

  it('throws a typed configuration error when required queue env is missing', async () => {
    await expect(
      cloudTasksPdfTableAssistIngestEnqueuer.enqueue({
        docId: 'doc-1',
        tenantId: 'tenant-1',
        actor: {
          userId: 'user-1',
          ipAddress: '127.0.0.1',
          userAgent: 'vitest',
        },
      })
    ).rejects.toBeInstanceOf(PdfTableAssistQueueNotConfiguredError);
    expect(createTaskMock).not.toHaveBeenCalled();
  });
});
