/**
 * Async table-assist ingest worker enqueue.
 *
 * Upload stays synchronous and table-assist remains gated to the worker context:
 * this enqueuer only asks Cloud Tasks to call the worker route after an
 * official-doc-pdf upload has already reached a terminal state.
 */
import type { CloudTasksClient } from '@google-cloud/tasks';
import type { OrchestrateAuditContext } from './uploadOrchestrator';
import {
  PdfTableAssistTaskSigningNotConfiguredError,
  isPdfTableAssistTaskSigningConfigured,
  signPdfTableAssistTaskPayload,
} from './pdfTableAssistTaskSigning';

export interface PdfTableAssistIngestEnqueuer {
  enqueue(request: PdfTableAssistIngestRequest): Promise<void>;
}

export type PdfTableAssistIngestRequest = {
  docId: string;
  tenantId: string;
  actor: OrchestrateAuditContext['actor'];
};

export class PdfTableAssistQueueNotConfiguredError extends Error {
  constructor(problems: string[]) {
    super(
      `PDF table-assist Cloud Tasks queue is not configured: ${problems.join(
        ', '
      )}`
    );
    this.name = 'PdfTableAssistQueueNotConfiguredError';
  }
}

type CloudTasksTableAssistConfig = {
  project: string;
  location: string;
  queue: string;
  workerBaseUrl: string;
  serviceAccountEmail: string;
  oidcAudience?: string;
  sharedToken?: string;
};

function firstPresent(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.trim().length > 0);
}

function resolveConfig(): CloudTasksTableAssistConfig {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location = firstPresent(
    process.env.PDF_TABLE_ASSIST_TASKS_LOCATION,
    process.env.CONTEXT_PACKAGE_TASKS_LOCATION,
    process.env.GOOGLE_CLOUD_LOCATION
  );
  const queue = firstPresent(
    process.env.PDF_TABLE_ASSIST_TASKS_QUEUE,
    process.env.CONTEXT_PACKAGE_TASKS_QUEUE
  );
  const workerBaseUrl = firstPresent(
    process.env.PDF_TABLE_ASSIST_WORKER_BASE_URL,
    process.env.CONTEXT_PACKAGE_WORKER_BASE_URL
  );
  const serviceAccountEmail = firstPresent(
    process.env.PDF_TABLE_ASSIST_WORKER_SA_EMAIL,
    process.env.CONTEXT_PACKAGE_WORKER_SA_EMAIL
  );

  const missing: string[] = [];
  if (!project) missing.push('GOOGLE_CLOUD_PROJECT');
  if (!location) missing.push('PDF_TABLE_ASSIST_TASKS_LOCATION');
  if (!queue) missing.push('PDF_TABLE_ASSIST_TASKS_QUEUE');
  if (!workerBaseUrl) missing.push('PDF_TABLE_ASSIST_WORKER_BASE_URL');
  if (!serviceAccountEmail) missing.push('PDF_TABLE_ASSIST_WORKER_SA_EMAIL');
  if (missing.length > 0) {
    throw new PdfTableAssistQueueNotConfiguredError(
      missing.map((name) => `missing ${name}`)
    );
  }
  // GOOGLE_CLOUD_LOCATION is `global` in this project for Gemini 3.x, but
  // Cloud Tasks queues are regional. Require an explicit regional override.
  if (location === 'global') {
    throw new PdfTableAssistQueueNotConfiguredError([
      'PDF_TABLE_ASSIST_TASKS_LOCATION must be a regional Cloud Tasks location; GOOGLE_CLOUD_LOCATION=global is not valid for Cloud Tasks',
    ]);
  }

  return {
    project: project!,
    location: location!,
    queue: queue!,
    workerBaseUrl: workerBaseUrl!.replace(/\/$/, ''),
    serviceAccountEmail: serviceAccountEmail!,
    oidcAudience: firstPresent(
      process.env.PDF_TABLE_ASSIST_WORKER_OIDC_AUDIENCE,
      process.env.CONTEXT_PACKAGE_WORKER_OIDC_AUDIENCE
    ),
    sharedToken: firstPresent(
      process.env.PDF_TABLE_ASSIST_WORKER_TOKEN,
      process.env.CONTEXT_PACKAGE_JOB_TOKEN
    ),
  };
}

let sharedClient: CloudTasksClient | null = null;

async function getCloudTasksClient(): Promise<CloudTasksClient> {
  if (!sharedClient) {
    const { CloudTasksClient } = await import('@google-cloud/tasks');
    sharedClient = new CloudTasksClient();
  }
  return sharedClient;
}

function taskIdForDoc(docId: string): string {
  return `table-assist-${docId}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 500);
}

function buildTaskBody(request: PdfTableAssistIngestRequest): Record<string, unknown> {
  if (process.env.NODE_ENV === 'production') {
    return signPdfTableAssistTaskPayload(request);
  }
  if (isPdfTableAssistTaskSigningConfigured()) {
    return signPdfTableAssistTaskPayload(request);
  }
  return request;
}

function assertTaskSigningConfiguredForEnqueue(): void {
  if (process.env.NODE_ENV === 'production' && !isPdfTableAssistTaskSigningConfigured()) {
    throw new PdfTableAssistTaskSigningNotConfiguredError();
  }
}

export const cloudTasksPdfTableAssistIngestEnqueuer: PdfTableAssistIngestEnqueuer =
  {
    async enqueue(request): Promise<void> {
      assertTaskSigningConfiguredForEnqueue();
      const config = resolveConfig();
      const client = await getCloudTasksClient();
      const parent = client.queuePath(config.project, config.location, config.queue);
      const url = `${config.workerBaseUrl}/api/documents/${request.docId}/table-assist/run`;
      const taskBody = buildTaskBody(request);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (config.sharedToken) {
        headers['X-Pdf-Table-Assist-Worker-Token'] = config.sharedToken;
      }

      await client.createTask({
        parent,
        task: {
          name: `${parent}/tasks/${taskIdForDoc(request.docId)}`,
          httpRequest: {
            httpMethod: 'POST',
            url,
            headers,
            body: Buffer.from(JSON.stringify(taskBody)).toString('base64'),
            oidcToken: {
              serviceAccountEmail: config.serviceAccountEmail,
              ...(config.oidcAudience ? { audience: config.oidcAudience } : {}),
            },
          },
        },
      });
    },
  };
