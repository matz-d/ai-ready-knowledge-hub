/**
 * Context Package job を worker へ渡す enqueue 抽象。
 *
 * 既定実装は Cloud Tasks へ HTTP task を作成し、worker route
 * `POST /api/context-package/jobs/{jobId}/run` を OIDC 認証付きで叩かせる。
 * テストや別環境で差し替えられるよう interface 越しに利用する。
 *
 * 必要な環境変数（既定実装）:
 * - `GOOGLE_CLOUD_PROJECT`                  : queue が属する project
 * - `CONTEXT_PACKAGE_TASKS_LOCATION`        : queue の location（既定 `GOOGLE_CLOUD_LOCATION`）
 * - `CONTEXT_PACKAGE_TASKS_QUEUE`           : queue id
 * - `CONTEXT_PACKAGE_WORKER_BASE_URL`       : worker を公開している base URL
 * - `CONTEXT_PACKAGE_WORKER_SA_EMAIL`       : OIDC token を発行する service account
 * - `CONTEXT_PACKAGE_WORKER_OIDC_AUDIENCE`（任意）: OIDC audience。worker が IAP 配下なら
 *     **IAP OAuth client ID** を設定する（既定の audience は target URL なので IAP は弾く）。
 *     worker SA には IAP access（roles/iap.httpsResourceAccessor）も必要。
 * - `CONTEXT_PACKAGE_JOB_TOKEN`（任意）     : worker 側の共有シークレット検証用ヘッダ
 */
import type { CloudTasksClient } from '@google-cloud/tasks';

export interface ContextPackageJobEnqueuer {
  enqueue(jobId: string): Promise<void>;
}

/** enqueue 設定が不足しているときに投げる。route 側で 503 に対応づける。 */
export class JobQueueNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(`Cloud Tasks queue is not configured: missing ${missing.join(', ')}`);
    this.name = 'JobQueueNotConfiguredError';
  }
}

type CloudTasksEnqueuerConfig = {
  project: string;
  location: string;
  queue: string;
  workerBaseUrl: string;
  serviceAccountEmail: string;
  oidcAudience?: string;
  sharedToken?: string;
};

function resolveConfig(): CloudTasksEnqueuerConfig {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location =
    process.env.CONTEXT_PACKAGE_TASKS_LOCATION ??
    process.env.GOOGLE_CLOUD_LOCATION;
  const queue = process.env.CONTEXT_PACKAGE_TASKS_QUEUE;
  const workerBaseUrl = process.env.CONTEXT_PACKAGE_WORKER_BASE_URL;
  const serviceAccountEmail = process.env.CONTEXT_PACKAGE_WORKER_SA_EMAIL;

  const missing: string[] = [];
  if (!project) missing.push('GOOGLE_CLOUD_PROJECT');
  if (!location) missing.push('CONTEXT_PACKAGE_TASKS_LOCATION');
  if (!queue) missing.push('CONTEXT_PACKAGE_TASKS_QUEUE');
  if (!workerBaseUrl) missing.push('CONTEXT_PACKAGE_WORKER_BASE_URL');
  if (!serviceAccountEmail) missing.push('CONTEXT_PACKAGE_WORKER_SA_EMAIL');
  if (missing.length > 0) {
    throw new JobQueueNotConfiguredError(missing);
  }

  return {
    project: project!,
    location: location!,
    queue: queue!,
    workerBaseUrl: workerBaseUrl!.replace(/\/$/, ''),
    serviceAccountEmail: serviceAccountEmail!,
    oidcAudience: process.env.CONTEXT_PACKAGE_WORKER_OIDC_AUDIENCE,
    sharedToken: process.env.CONTEXT_PACKAGE_JOB_TOKEN,
  };
}

let sharedClient: CloudTasksClient | null = null;
/**
 * Cloud Tasks SDK は proto を動的ロードするため、トップレベル import すると Next.js
 * のビルド時 page data 収集で「module too dynamic」になる。enqueue 実行時に動的
 * import して評価を遅延させる。
 */
async function getCloudTasksClient(): Promise<CloudTasksClient> {
  if (!sharedClient) {
    const { CloudTasksClient } = await import('@google-cloud/tasks');
    sharedClient = new CloudTasksClient();
  }
  return sharedClient;
}

/**
 * Cloud Tasks に HTTP task を作成する既定 enqueuer。task body には jobId を含め、
 * worker は URL path の jobId を正本とする（body は冗長な確認用）。
 */
export const cloudTasksEnqueuer: ContextPackageJobEnqueuer = {
  async enqueue(jobId: string): Promise<void> {
    const config = resolveConfig();
    const client = await getCloudTasksClient();
    const parent = client.queuePath(config.project, config.location, config.queue);
    const url = `${config.workerBaseUrl}/api/context-package/jobs/${jobId}/run`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (config.sharedToken) {
      headers['X-Context-Package-Job-Token'] = config.sharedToken;
    }

    await client.createTask({
      parent,
      task: {
        // task name に jobId を使い、同一 job の重複 enqueue を Cloud Tasks 側で抑止する
        // （直近で同名 task が完了済みでも一定時間は重複作成が拒否される）。
        name: `${parent}/tasks/${jobId}`,
        httpRequest: {
          httpMethod: 'POST',
          url,
          headers,
          body: Buffer.from(JSON.stringify({ jobId })).toString('base64'),
          oidcToken: {
            serviceAccountEmail: config.serviceAccountEmail,
            // IAP 配下では audience に IAP OAuth client ID を渡す必要がある。
            ...(config.oidcAudience ? { audience: config.oidcAudience } : {}),
          },
        },
      },
    });
  },
};
