import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { adaptW1SnapshotEntries } from '../src/lib/inventory';
import { buildContextPackageExportInput } from '../src/lib/contextPackageInput';
import { buildFirestoreContextPackageExportInput } from '../src/lib/contextPackageFirestoreAdapter';
import { exportContextPackageMarkdown } from '../src/lib/exportContextPackage';

type DemoMode = 'live' | 'w1';

class MissingKnowledgeHubBucketError extends Error {
  constructor() {
    super(
      'KNOWLEDGE_HUB_BUCKET が未設定です。Firestore/GCS 正本で実行するにはバケット名を環境変数に設定してください。'
    );
    this.name = 'MissingKnowledgeHubBucketError';
  }
}

class EmptyFirestoreCorpusError extends Error {
  constructor() {
    super(
      'Firestore documents が空です。`documents` collection に Context Package export 対象データがありません。'
    );
    this.name = 'EmptyFirestoreCorpusError';
  }
}

function resolveMode(argv: string[]): DemoMode {
  const useW1 = argv.includes('--w1');
  const useLive = argv.includes('--live');

  if (useW1 && useLive) {
    throw new Error('`--live` と `--w1` は同時に指定できません。');
  }

  if (useW1) {
    return 'w1';
  }

  return 'live';
}

function buildW1FixtureExportInput() {
  const snapshotPath = join(
    process.cwd(),
    'docs/w1-artifacts/inventory.snapshot.json'
  );
  const raw = JSON.parse(readFileSync(snapshotPath, 'utf-8'));
  const documents = adaptW1SnapshotEntries(raw);

  return buildContextPackageExportInput({
    purpose:
      'Demo fixture: W1 snapshot adapted with Restricted exclusion',
    documents,
    generatedAt: new Date(),
    missingKnowledge: ['Live Firestore corpus was not used for this run.'],
    questionsForHumanOwner: [
      'Which advisory contract samples may be used in production demos?',
    ],
    allowPlaceholderBodies: true,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | number | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' || typeof code === 'number') {
    return code;
  }
  return undefined;
}

function isLikelyAuthOrAdcError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  const code = errorCode(error);
  return (
    code === 7 ||
    code === 16 ||
    code === 401 ||
    code === 403 ||
    message.includes('application default credentials') ||
    message.includes('could not load the default credentials') ||
    message.includes('unable to detect a project id') ||
    message.includes('permission denied') ||
    message.includes('unauthenticated') ||
    message.includes('google_application_credentials')
  );
}

function isLikelyGcsObjectMissing(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  const code = errorCode(error);
  if (code === 404) return true;

  return (
    (message.includes('no such object') ||
      message.includes('object does not exist') ||
      message.includes('not found')) &&
    (message.includes('storage') ||
      message.includes('gcs') ||
      message.includes('bucket') ||
      message.includes('object'))
  );
}

function explainLiveFailure(error: unknown): string {
  const message = errorMessage(error);

  if (error instanceof MissingKnowledgeHubBucketError) {
    return `[context:demo:live] ${message}`;
  }

  if (error instanceof EmptyFirestoreCorpusError) {
    return `[context:demo:live] ${message}`;
  }

  if (isLikelyAuthOrAdcError(error)) {
    return `[context:demo:live] GCP 認証に失敗しました (ADC / IAM)。\`gcloud auth application-default login\` または \`GOOGLE_APPLICATION_CREDENTIALS\` と権限設定を確認してください。 details: ${message}`;
  }

  if (isLikelyGcsObjectMissing(error)) {
    return `[context:demo:live] GCS object の本文取得に失敗しました。object が存在しないか読み取り権限がありません。 details: ${message}`;
  }

  return `[context:demo:live] Firestore/GCS 正本からの export に失敗しました。details: ${message}`;
}

async function buildLiveExportInput() {
  if (!process.env.KNOWLEDGE_HUB_BUCKET?.trim()) {
    throw new MissingKnowledgeHubBucketError();
  }

  const exportInput = await buildFirestoreContextPackageExportInput({
    purpose:
      'Firestore documents Context Package — effective metadata with GCS bodies',
    generatedAt: new Date(),
    missingKnowledge: [
      'Purpose-specific strategist selection is not connected yet.',
    ],
    questionsForHumanOwner: [
      'Which business objective should this Context Package optimize for?',
    ],
  });

  if (exportInput.sourceDocumentsReviewed === 0) {
    throw new EmptyFirestoreCorpusError();
  }

  return exportInput;
}

async function main() {
  let mode: DemoMode | null = null;

  try {
    mode = resolveMode(process.argv.slice(2));
    const exportInput =
      mode === 'w1'
        ? buildW1FixtureExportInput()
        : await buildLiveExportInput();

    const md = exportContextPackageMarkdown(exportInput);

    console.log(md);
    console.error(
      `\n--- context:demo:${mode} summary: included=${exportInput.includedDocuments.length}, humanReview=${exportInput.humanReviewDocuments?.length ?? 0}, excluded=${exportInput.excludedDocuments.length} ---\n`
    );
  } catch (error) {
    if (mode === 'live') {
      console.error(explainLiveFailure(error));
    } else if (mode === 'w1') {
      console.error(
        `[context:demo:w1] W1 fixture export に失敗しました。details: ${errorMessage(error)}`
      );
    } else {
      console.error(`[context:demo] ${errorMessage(error)}`);
    }

    process.exitCode = 1;
  }
}

await main();
