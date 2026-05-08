import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { curatorFlow } from '../../../agents/curator/flow';
import { modelId } from '../../../agents/_shared/genkitClient';
import { FieldValue, getFirestoreClient } from '../../../lib/firestore';
import { deleteRawObject, uploadRawObject } from '../../../lib/storage';
import {
  DOCUMENTS_COLLECTION,
  MAX_UPLOAD_BYTES,
  buildRawObjectPath,
  decodeUtf8Strict,
  getAllowedExtension,
  isAllowedMimeType,
  sanitizeOriginalFileName,
  toSerializableCurator,
  type DocumentUploadSuccessResponse,
} from '../../../lib/documents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CURATOR_FAILURE_CLIENT_MESSAGE =
  '分類処理に失敗しました。設定またはログを確認してください。';

/** Firestore `curatorError.message` 用（詳細可）。 */
function curatorErrorDetailForFirestore(error: unknown): string {
  if (error instanceof Error && error.message) {
    return `分類処理に失敗しました。${error.message}`;
  }
  return '分類処理に失敗しました。';
}

function defaultContentTypeForExt(
  ext: string
): 'text/plain' | 'text/markdown' | 'text/csv' {
  if (ext === '.md') return 'text/markdown';
  if (ext === '.csv') return 'text/csv';
  return 'text/plain';
}

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: 'multipart フォームを解析できませんでした。' },
      { status: 400 }
    );
  }

  const fileFields = formData.getAll('file');
  if (fileFields.length !== 1) {
    return NextResponse.json(
      { error: 'file フィールドにはファイルを正確に1つ指定してください。' },
      { status: 400 }
    );
  }

  const fileEntry = fileFields[0];
  if (!fileEntry || typeof fileEntry === 'string') {
    return NextResponse.json(
      { error: 'file フィールドにはファイルを正確に1つ指定してください。' },
      { status: 400 }
    );
  }

  const file = fileEntry as File;
  if (file.size === 0) {
    return NextResponse.json(
      { error: '空のファイルはアップロードできません。' },
      { status: 400 }
    );
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: 'ファイルサイズは 1 MB 以下にしてください。' },
      { status: 413 }
    );
  }

  const displayName = file.name?.trim() || 'file.txt';
  const extCheck = getAllowedExtension(displayName);
  if (!extCheck) {
    return NextResponse.json(
      { error: '対応している拡張子は .txt / .md / .csv のみです。' },
      { status: 415 }
    );
  }

  const mime = (file.type ?? '').trim();
  if (mime && !isAllowedMimeType(mime)) {
    return NextResponse.json(
      { error: 'このファイルの Content-Type は受け付けていません。' },
      { status: 415 }
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const content = decodeUtf8Strict(arrayBuffer);
  if (content === null) {
    return NextResponse.json(
      { error: 'UTF-8 として解釈できないバイト列です。' },
      { status: 400 }
    );
  }

  if (!process.env.KNOWLEDGE_HUB_BUCKET?.trim()) {
    return NextResponse.json(
      { error: 'サーバー設定 (KNOWLEDGE_HUB_BUCKET) が未完了です。' },
      { status: 503 }
    );
  }

  const docId = randomUUID();
  const safeOriginalFileName = sanitizeOriginalFileName(displayName);
  const storagePath = buildRawObjectPath(docId, safeOriginalFileName);
  const contentType = mime
    ? mime
    : defaultContentTypeForExt(extCheck);

  try {
    await uploadRawObject(storagePath, buffer, contentType);
  } catch (e) {
    console.error('[documents] GCS upload failed', e);
    return NextResponse.json(
      { error: 'クラウドストレージへのアップロードに失敗しました。' },
      { status: 502 }
    );
  }

  const db = getFirestoreClient();
  const docRef = db.collection(DOCUMENTS_COLLECTION).doc(docId);
  const now = FieldValue.serverTimestamp();

  try {
    await docRef.set({
      id: docId,
      fileName: displayName,
      contentType,
      byteSize: buffer.length,
      storagePath,
      status: 'uploaded',
      createdAt: now,
      updatedAt: now,
      curator: null,
      curatorError: null,
    });
  } catch (e) {
    console.error('[documents] Firestore create failed', e);
    try {
      await deleteRawObject(storagePath);
    } catch (delErr) {
      console.error('[documents] GCS rollback after Firestore create failed', delErr);
    }
    return NextResponse.json(
      { error: 'メタデータの保存に失敗しました。' },
      { status: 502 }
    );
  }

  try {
    await docRef.update({
      status: 'curating',
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.error('[documents] Firestore curating update failed', e);
    return NextResponse.json(
      { error: 'メタデータの更新に失敗しました。', docId },
      { status: 502 }
    );
  }

  try {
    const curatorResult = await curatorFlow({
      fileName: displayName,
      content,
    });
    const completedAt = new Date();
    await docRef.update({
      status: 'curated',
      updatedAt: FieldValue.serverTimestamp(),
      curator: {
        documentType: curatorResult.documentType,
        businessDomain: curatorResult.businessDomain,
        sensitivity: curatorResult.sensitivity,
        freshness: curatorResult.freshness,
        isAuthoritativeCandidate: curatorResult.isAuthoritativeCandidate,
        aiUsePolicy: curatorResult.aiUsePolicy,
        rationale: curatorResult.rationale,
        completedAt: FieldValue.serverTimestamp(),
        modelId,
      },
      curatorError: null,
    });

    const body: DocumentUploadSuccessResponse = {
      docId,
      fileName: displayName,
      contentType,
      byteSize: buffer.length,
      storagePath,
      status: 'curated',
      curator: toSerializableCurator(curatorResult, modelId, completedAt),
    };
    return NextResponse.json(body);
  } catch (e) {
    console.error('[documents] curatorFlow failed', e);
    const detail = curatorErrorDetailForFirestore(e);
    const truncated =
      detail.length > 8000 ? `${detail.slice(0, 8000)}…` : detail;
    try {
      await docRef.update({
        status: 'failed',
        updatedAt: FieldValue.serverTimestamp(),
        curator: null,
        curatorError: {
          message: truncated,
          occurredAt: FieldValue.serverTimestamp(),
        },
      });
    } catch (updateErr) {
      console.error('[documents] failed status update', updateErr);
    }
    return NextResponse.json(
      { error: CURATOR_FAILURE_CLIENT_MESSAGE, docId },
      { status: 500 }
    );
  }
}
