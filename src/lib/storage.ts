import { Storage } from '@google-cloud/storage';

/**
 * KNOWLEDGE_HUB_BUCKET の集中アクセス点。route.ts / orchestrator / storage 内部の
 * いずれもこの関数を経由する。.env.local.example を参照。
 */
export function getKnowledgeHubBucketName(): string {
  const name = process.env.KNOWLEDGE_HUB_BUCKET?.trim();
  if (!name) {
    throw new Error(
      'KNOWLEDGE_HUB_BUCKET が未設定です。.env.local.example を参照してください。'
    );
  }
  return name;
}

function bucketFile(objectPath: string) {
  return new Storage().bucket(getKnowledgeHubBucketName()).file(objectPath);
}

/**
 * Context Package export 用に GCS object を UTF-8 text として読む。
 * 本文の正本は Firestore metadata ではなく GCS にあるため、export adapter から使う。
 */
export async function readTextObject(objectPath: string): Promise<string> {
  const [body] = await bucketFile(objectPath).download();
  return body.toString('utf-8');
}

/**
 * 原本バイナリを GCS に保存する。パスは `raw/{docId}/{safeOriginalFileName}` 形式。
 */
export async function uploadRawObject(
  objectPath: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  await bucketFile(objectPath).save(body, {
    contentType,
    resumable: false,
    metadata: { cacheControl: 'private, max-age=0' },
  });
}

/**
 * GCS 上のオブジェクトを削除する（ロールバック用）。
 */
export async function deleteRawObject(objectPath: string): Promise<void> {
  await bucketFile(objectPath).delete({ ignoreNotFound: true });
}

/** Masker pipeline が ai_safe_ready のときに呼ぶ。restricted_promoted では呼ばない。 */
export type MaskedObjectMetadata = {
  sourceContentHash: string;
  aiSafeSchemaVersion: 1;
  provider: string;
};

/**
 * AI 参照版本文を `masked/{docId}/{safeOriginalFileName}` に保存する。
 * GCS の object metadata (X-Goog-Meta-*) に `sourceContentHash` / `aiSafeSchemaVersion` /
 * `provider` を入れ、再生成判定や integrity 検証の足場とする。
 *
 * GCS の `metadata.metadata` は string 値のみ受け付けるため、数値・リテラルは String() でシリアライズする。
 */
export async function uploadMaskedObject(
  objectPath: string,
  body: string | Buffer,
  metadata: MaskedObjectMetadata
): Promise<void> {
  await bucketFile(objectPath).save(body, {
    contentType: 'text/plain; charset=utf-8',
    resumable: false,
    metadata: {
      cacheControl: 'private, max-age=0',
      metadata: {
        sourceContentHash: metadata.sourceContentHash,
        aiSafeSchemaVersion: String(metadata.aiSafeSchemaVersion),
        provider: metadata.provider,
      },
    },
  });
}

/**
 * Masker 失敗時に masked オブジェクトを消すための rollback。
 * D-W2-Step2 の方針: orchestrator は masked 残置せず failed に倒す。
 */
export async function deleteMaskedObject(objectPath: string): Promise<void> {
  await bucketFile(objectPath).delete({ ignoreNotFound: true });
}
