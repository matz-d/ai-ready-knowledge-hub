import Link from 'next/link';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import './styles.css';
import { wasPromotedByMasker } from '../agents/masker/upgrade';
import { adaptW1SnapshotEntries, type InventoryDocument } from '../lib/inventory';
import { listInventoryDocumentsFromFirestore } from '../lib/inventoryFirestoreAdapter';
import { buildContextPackageExportInput } from '../lib/contextPackageInput';
import { exportContextPackageMarkdown } from '../lib/exportContextPackage';
import type { Sensitivity } from '../agents/curator/schema';
import { ReimportButton } from './_components/ReimportButton';

export const dynamic = 'force-dynamic';

type InventorySectionState = {
  source: 'firestore' | 'w1-fallback';
  documents: InventoryDocument[];
  exportInput: ReturnType<typeof buildContextPackageExportInput>;
  previewMd: string;
  heading: string;
  kicker: string;
  note: string;
  reviewedLabel: string;
  fallbackReason?: string;
};

function buildInventoryState(args: {
  source: InventorySectionState['source'];
  documents: InventoryDocument[];
  purpose: string;
  heading: string;
  kicker: string;
  note: string;
  reviewedLabel: string;
  fallbackReason?: string;
  /** W1 snapshot fallback only — real exports omit placeholder bodies by default. */
  allowPlaceholderBodies?: boolean;
}): InventorySectionState {
  const exportInput = buildContextPackageExportInput({
    purpose: args.purpose,
    documents: args.documents,
    allowPlaceholderBodies: args.allowPlaceholderBodies,
  });
  const fullMd = exportContextPackageMarkdown(exportInput);
  const previewMd = fullMd.split('\n').slice(0, 36).join('\n');
  return { ...args, exportInput, previewMd };
}

function readW1InventoryFallback(
  fallbackReason: string
): InventorySectionState | null {
  try {
    const snapshotPath = join(
      process.cwd(),
      'docs/w1-artifacts/inventory.snapshot.json'
    );
    const raw = JSON.parse(readFileSync(snapshotPath, 'utf-8'));
    const documents = adaptW1SnapshotEntries(raw);
    return buildInventoryState({
      source: 'w1-fallback',
      documents,
      purpose:
        'Fallback demo: W1 snapshot adapted from docs/w1-artifacts because Firestore inventory was unavailable',
      heading: 'Knowledge Inventory（W1 snapshot fallback）',
      kicker: 'Demo fallback',
      note:
        'Firestore documents collection を正本として読もうとしましたが失敗したため、退避済み W1 snapshot を fallback 表示しています。実データとは同期していません。',
      reviewedLabel: 'inventory.snapshot の行数',
      fallbackReason,
      allowPlaceholderBodies: true,
    });
  } catch {
    return null;
  }
}

async function readInventorySection(): Promise<InventorySectionState | null> {
  try {
    const documents = await listInventoryDocumentsFromFirestore();
    return buildInventoryState({
      source: 'firestore',
      documents,
      purpose: 'Firestore documents inventory - effective metadata for AI-ready review',
      heading: 'Knowledge Inventory（Firestore documents）',
      kicker: 'Live Inventory',
      note:
        'Firestore documents collection の effective fields を読み、Curator / Masker の判定結果を Inventory と Context Package 入力へ変換しています。',
      reviewedLabel: 'Firestore terminal document count',
    });
  } catch (e) {
    const fallbackReason = e instanceof Error ? e.message : String(e);
    console.error('[inventory] Firestore inventory read failed', e);
    return readW1InventoryFallback(fallbackReason);
  }
}

function sensitivityPillClass(sensitivity: Sensitivity): string {
  switch (sensitivity) {
    case 'Restricted':
      return 'sensitivity-pill sensitivity-restricted';
    case 'Confidential':
      return 'sensitivity-pill sensitivity-confidential';
    case 'Internal':
      return 'sensitivity-pill sensitivity-internal';
    case 'Public':
      return 'sensitivity-pill sensitivity-public';
  }
}

function statusBadgeClass(status: InventoryDocument['status']): string {
  const suffix = status.replace('_', '-');
  return `document-flow-status-badge document-flow-status-badge--${suffix}`;
}

const pipelineSteps = [
  {
    number: '01',
    title: 'Collect',
    body: '社内に散らばった PDF、CSV、メモ、テンプレートを目的ごとに集める。',
  },
  {
    number: '02',
    title: 'Classify',
    body: 'Curator が文書種別、業務領域、機密度、鮮度、AI 利用方針を判定する。',
  },
  {
    number: '03',
    title: 'Mask',
    body: 'Masker が個人情報や顧客情報の残存リスクを見て、必要なら人間確認へ回す。',
  },
  {
    number: '04',
    title: 'Package',
    body: '目的に合う情報、除外情報、不足情報、確認質問を Context Package にまとめる。',
  },
];

const implementationStatus = [
  {
    label: 'Curator flow',
    status: 'available',
    detail: 'Genkit + Vertex AI の structured output と Zod 検証を実装済み。',
  },
  {
    label: 'Masker residual risk',
    status: 'available',
    detail: 'マスク後テキストの再識別リスク判定を flow として実装済み。',
  },
  {
    label: 'Runtime API',
    status: 'available',
    detail: 'POST /api/curator で Curator flow を呼び出せる。',
  },
  {
    label: 'Upload UI',
    status: 'available',
    detail: 'POST /api/documents で GCS 保存・Firestore メタデータ・Curator 分類まで一括実行。',
  },
  {
    label: 'Knowledge Inventory UI',
    status: 'available',
    detail:
      'Firestore documents collection を正本として一覧と Package 件数を表示する。',
  },
  {
    label: 'Strategist',
    status: 'next',
    detail: '目的別の採用・除外・不足知識の判断は実 agent として実装する。',
  },
];

const curatorFields = [
  'documentType',
  'businessDomain',
  'sensitivity',
  'freshness',
  'isAuthoritativeCandidate',
  'aiUsePolicy',
  'rationale',
];

export default async function Home() {
  const inventoryState = await readInventorySection();

  return (
    <main className="page-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">AI-Ready Knowledge Hub</p>
          <h1>社内文書を、AIに渡せる文脈へ整える。</h1>
          <p className="lead">
            NotebookLM、Gemini、RAG の前段で、散らばった社内情報を分類し、
            機密情報の扱いを判断し、目的別の Context Package に変換するための
            SME 向けプラットフォームです。
          </p>
          <p className="home-upload-cta">
            <Link href="/upload">文書をアップロードして分類（Walking Skeleton）</Link>
          </p>
        </div>
        <div className="status-panel" aria-label="実装ステータス">
          <span>Current build</span>
          <strong>実データ接続（Walking Skeleton）</strong>
          <small>
            Upload → GCS → Firestore → Curator の経路を `/upload` から試せます（GCP
            設定と ADC が必要）。
          </small>
        </div>
      </section>

      <section className="flow-strip" aria-label="Context package pipeline">
        {pipelineSteps.map((step) => (
          <div key={step.number}>
            <span>{step.number}</span>
            <strong>{step.title}</strong>
            <small>{step.body}</small>
          </div>
        ))}
      </section>

      <section className="metric-grid" aria-label="Implementation metrics">
        <div className="metric-card">
          <span>implemented</span>
          <strong>4</strong>
          <p>Curator、Masker、Curator API、Upload + Storage + Firestore 経路</p>
        </div>
        <div className="metric-card">
          <span>schema fields</span>
          <strong>{curatorFields.length}</strong>
          <p>Curator が返す分類・安全判定フィールド</p>
        </div>
        <div className="metric-card">
          <span>archived</span>
          <strong>W1</strong>
          <p>固定サンプル出力は docs/w1-artifacts に退避</p>
        </div>
        <div className="metric-card warning">
          <span>next</span>
          <strong>W2</strong>
          <p>Inventory 一覧・詳細、Masker 連携、Purpose Query など</p>
        </div>
      </section>

      {inventoryState ? (
        <section
          className="section-block inventory-demo-section"
          aria-labelledby="inventory-demo-heading"
        >
          <div className="section-heading">
            <div>
              <p className="chapter-kicker">{inventoryState.kicker}</p>
              <h2 id="inventory-demo-heading">{inventoryState.heading}</h2>
            </div>
            <p className="inventory-demo-note">
              {inventoryState.note}
              {inventoryState.fallbackReason ? (
                <>
                  <br />
                  <span>Firestore error: {inventoryState.fallbackReason}</span>
                </>
              ) : null}
            </p>
          </div>

          <div className="package-summary-grid" aria-label="Context Package summary">
            <div className="package-summary-card">
              <span>Included in export</span>
              <strong>{inventoryState.exportInput.includedDocuments.length}</strong>
              <p>Full AI-Ready Sources に本文が載る想定</p>
            </div>
            <div className="package-summary-card package-summary-card--warn">
              <span>Human review</span>
              <strong>
                {inventoryState.exportInput.humanReviewDocuments?.length ?? 0}
              </strong>
              <p>Restricted、未マスク機密、など</p>
            </div>
            <div className="package-summary-card">
              <span>Reviewed count</span>
              <strong>{inventoryState.exportInput.sourceDocumentsReviewed}</strong>
              <p>{inventoryState.reviewedLabel}</p>
            </div>
          </div>

          {inventoryState.documents.length > 0 ? (
            <div className="inventory-card-grid">
              {inventoryState.documents.map((doc) => (
                <article className="inventory-card" key={doc.id}>
                  <header className="inventory-card-header">
                    <h3 className="inventory-card-title">
                      <Link
                        href={`/documents/${doc.id}`}
                        className="inventory-card-title-link"
                      >
                        {doc.fileName}
                      </Link>
                    </h3>
                    <span
                      className={sensitivityPillClass(doc.sensitivity)}
                      title="effective sensitivity"
                    >
                      {doc.sensitivity}
                    </span>
                  </header>
                  <p className="inventory-card-meta">
                    {doc.documentType} · {doc.businessDomain}
                  </p>
                  <dl className="inventory-card-dl">
                    <div>
                      <dt>Status</dt>
                      <dd>
                        <span className={statusBadgeClass(doc.status)}>
                          {doc.status}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt>AI policy</dt>
                      <dd>{doc.aiUsePolicy}</dd>
                    </div>
                    <div>
                      <dt>Source</dt>
                      <dd>{doc.sensitivitySource}</dd>
                    </div>
                    <div>
                      <dt>AI-safe path</dt>
                      <dd>{doc.aiSafeStoragePath ?? '—'}</dd>
                    </div>
                  </dl>
                  {wasPromotedByMasker(doc) ? (
                    <p className="inventory-masker-promo" role="status">
                      Masker により Restricted へ格上げ（原本 Curator:{' '}
                      {doc.originalCuratorSensitivity ?? '—'}）
                    </p>
                  ) : null}
                  {doc.sourceKind === 'google_workspace' &&
                  (doc.externalSourceWebViewLink ?? doc.externalSourceFileId) ? (
                    <div className="inventory-card-actions">
                      <ReimportButton
                        urlOrFileId={
                          doc.externalSourceWebViewLink ??
                          doc.externalSourceFileId!
                        }
                        className="inventory-card-reimport"
                      />
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <div className="inventory-empty-state">
              <h3>Firestore の Inventory はまだ空です</h3>
              <p>
                terminal status の document が作られるとここに表示されます。まずは{' '}
                <Link href="/upload">/upload</Link> から文書をアップロードしてください。
              </p>
            </div>
          )}

          <div className="package-preview-block">
            <h3 className="package-preview-heading">Context Package 先頭プレビュー</h3>
            <pre className="package-preview-pre">{inventoryState.previewMd}</pre>
          </div>
        </section>
      ) : null}

      <section className="section-block" aria-labelledby="runtime-heading">
        <div className="section-heading">
          <div>
            <p className="chapter-kicker">Runtime Path</p>
            <h2 id="runtime-heading">固定デモではなく、実行経路を中心にする</h2>
          </div>
          <p>
            Inventory は Firestore documents collection を正本として読みます。Firestore
            に接続できない場合だけ、W1 snapshot を fallback 表示します。文書の実アップロードと分類は{' '}
            <Link href="/upload">/upload</Link> から実行できます。
          </p>
        </div>

        <div className="status-grid">
          {implementationStatus.map((item) => (
            <article className="status-card" key={item.label}>
              <div className="card-topline">
                <span className={`state-pill state-${item.status}`}>
                  {item.status}
                </span>
              </div>
              <h3>{item.label}</h3>
              <p>{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="preview-grid" aria-label="Developer handoff">
        <div className="summary-panel">
          <div className="chapter-kicker">API Seed</div>
          <h2>Curator request</h2>
          <dl>
            <div>
              <dt>Endpoint</dt>
              <dd>POST /api/curator</dd>
            </div>
            <div>
              <dt>Runtime</dt>
              <dd>Node.js on Next.js Route Handler</dd>
            </div>
            <div>
              <dt>Input</dt>
              <dd>fileName と content</dd>
            </div>
            <div>
              <dt>Output</dt>
              <dd>Curator schema の structured JSON</dd>
            </div>
          </dl>
        </div>

        <div className="markdown-panel">
          <h2>Curator output fields</h2>
          <div className="field-list">
            {curatorFields.map((field) => (
              <code key={field}>{field}</code>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
