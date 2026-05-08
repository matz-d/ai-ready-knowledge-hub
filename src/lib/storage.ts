import { Storage } from '@google-cloud/storage';

function requireBucketName(): string {
  const name = process.env.KNOWLEDGE_HUB_BUCKET?.trim();
  if (!name) {
    throw new Error(
      'KNOWLEDGE_HUB_BUCKET が未設定です。.env.local.example を参照してください。'
    );
  }
  return name;
}

/**
 * 原本バイナリを GCS に保存する。パスは `raw/{docId}/{safeOriginalFileName}` 形式。
 */
export async function uploadRawObject(
  objectPath: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  const storage = new Storage();
  const bucket = storage.bucket(requireBucketName());
  const file = bucket.file(objectPath);
  await file.save(body, {
    contentType,
    resumable: false,
    metadata: { cacheControl: 'private, max-age=0' },
  });
}

/**
 * GCS 上のオブジェクトを削除する（ロールバック用）。
 */
export async function deleteRawObject(objectPath: string): Promise<void> {
  const storage = new Storage();
  const bucket = storage.bucket(requireBucketName());
  const file = bucket.file(objectPath);
  await file.delete({ ignoreNotFound: true });
}
