import { exportContextPackageMarkdown } from '../lib/exportContextPackage';
import {
  accountingOfficeInventory,
  effectiveSensitivity,
  inventoryDomains,
  inventorySensitivityLevels,
  type InventorySnapshotEntry,
} from '../demo/inventory';
import { payrollTrainingStrategistFixture } from '../demo/strategistFixture';
import type {
  AiUsePolicy,
  BusinessDomain,
  DocumentType,
  Freshness,
  Sensitivity,
} from '../agents/curator/schema';
import './styles.css';

// W2 で Server Action から実データを引く前提。snapshot だけの今は no-op だが残す。
export const dynamic = 'force-dynamic';

const rawFileExamples = [
  '顧問契約書_実案件サンプル.txt',
  '給与計算チェックリスト.md',
  '古い料金表_2023.csv',
  '顧客対応メモ_匿名化.txt',
  '就業規則テンプレート.md',
];

/**
 * デモで強調表示する文書のファイル名。
 * R5 enum と独立した「ストーリーテリング都合の選択」なのでファイル名で指定する。
 */
const highlightedFileNames = new Set<string>([
  '給与計算チェックリスト.md',
  '顧問契約書_実案件サンプル.txt',
  '古い料金表_2023.csv',
]);

function countByDomainAndSensitivity(
  domain: BusinessDomain,
  sensitivity: Sensitivity
): number {
  return accountingOfficeInventory.filter(
    (entry) =>
      entry.businessDomain === domain &&
      effectiveSensitivity(entry) === sensitivity
  ).length;
}

function heatClass(count: number): string {
  if (count >= 3) return 'heat-cell heat-cell-high';
  if (count === 2) return 'heat-cell heat-cell-mid';
  if (count === 1) return 'heat-cell heat-cell-low';
  return 'heat-cell';
}

const sensitivityLabels: Record<Sensitivity, string> = {
  Public: '公開可',
  Internal: '社内向け',
  Confidential: '機密',
  Restricted: '要制限',
};

function sensitivityLabel(sensitivity: Sensitivity): string {
  return sensitivityLabels[sensitivity];
}

const freshnessLabels: Record<Freshness, string> = {
  current: '現行',
  superseded_candidate: '旧版候補',
};

function freshnessLabel(freshness: Freshness): string {
  return freshnessLabels[freshness];
}

const aiPolicyLabels: Record<AiUsePolicy, string> = {
  direct: 'そのままAI参照可',
  requires_masking: 'マスク後にAI参照可',
  blocked: 'AI参照不可',
};

function aiPolicyLabel(policy: AiUsePolicy): string {
  return aiPolicyLabels[policy];
}

function documentTypeBadge(type: DocumentType): string {
  return type;
}

export default function Home() {
  const markdown = exportContextPackageMarkdown(
    payrollTrainingStrategistFixture
  );
  const promotedDocuments = accountingOfficeInventory.filter(
    (entry) => entry.maskerEvaluation?.recommendedSensitivity === 'Restricted'
  );
  const canonicalDocuments = accountingOfficeInventory.filter(
    (entry) => entry.isAuthoritativeCandidate
  ).length;
  const highlightedDocuments = accountingOfficeInventory.filter((entry) =>
    highlightedFileNames.has(entry.fileName)
  );

  return (
    <main className="page-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">AI-Ready Knowledge Hub</p>
          <h1>散らばった社内文書を、AIに渡せる文脈へ。</h1>
          <p className="lead">
            社内に散らばった文書を分類し、安全判定を加え、NotebookLM /
            Gemini / RAG に渡せる Context Package へ整えます。
          </p>
        </div>
        <div className="status-panel" aria-label="デモの到達点">
          <span>今回の対象</span>
          <strong>社労士事務所の10文書</strong>
          <small>給与計算AIに渡すべき情報を選別する</small>
        </div>
      </section>

      <section className="flow-strip" aria-label="Demo flow">
        <div>
          <span>01</span>
          散らばった社内文書
        </div>
        <div>
          <span>02</span>
          AIが分類・安全判定
        </div>
        <div>
          <span>03</span>
          使える情報 / 除外情報 / 足りない情報
        </div>
        <div>
          <span>04</span>
          Context Package 出力
        </div>
      </section>

      <section className="metric-grid" aria-label="Inventory metrics">
        <div className="metric-card">
          <span>原本文書</span>
          <strong>{accountingOfficeInventory.length}</strong>
          <p>PDF、CSV、メモ、テンプレート相当の混在資料</p>
        </div>
        <div className="metric-card">
          <span>正本候補</span>
          <strong>{canonicalDocuments}</strong>
          <p>Curator が公式・標準として参照しうると判定</p>
        </div>
        <div className="metric-card warning">
          <span>Maskerが格上げ</span>
          <strong>{promotedDocuments.length}</strong>
          <p>マスク後も再識別リスクが残るため Restricted</p>
        </div>
        <div className="metric-card">
          <span>目的別に採用</span>
          <strong>
            {payrollTrainingStrategistFixture.includedDocuments.length}
          </strong>
          <p>給与計算AI向けに Strategist が採用した文書</p>
        </div>
      </section>

      <section className="chapter-block" aria-labelledby="scattered-heading">
        <div className="chapter-kicker">1. Scattered files</div>
        <div className="before-after-grid">
          <div className="file-stack-panel">
            <h2 id="scattered-heading">整理前: ファイル名だけでは判断できない</h2>
            <div className="file-stack">
              {rawFileExamples.map((fileName) => (
                <div className="file-chip" key={fileName}>
                  <span>{fileName.split('.').pop()}</span>
                  {fileName}
                </div>
              ))}
            </div>
          </div>

          <div className="file-stack-panel after-panel">
            <h2>整理後: 目的と安全性で意味づけされる</h2>
            <div className="meaning-list">
              <div>
                <strong>使える</strong>
                <span>給与計算チェックリスト、匿名化済み相談メモ</span>
              </div>
              <div>
                <strong>除外する</strong>
                <span>旧料金表、目的外の案内文</span>
              </div>
              <div>
                <strong>人間確認</strong>
                <span>実案件契約書、顧問先ごとの例外ルール</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section-block" aria-labelledby="inventory-heading">
        <div className="section-heading">
          <div>
            <p className="chapter-kicker">2. Structured Inventory</p>
            <h2 id="inventory-heading">文書カード</h2>
          </div>
          <p>
            Curator (Genkit + Vertex AI) が R5 enum で出力した分類結果。
            <code> npm run inventory:snapshot </code>
            で実LLMの出力に上書きできます。
          </p>
        </div>

        <div className="document-card-grid">
          {highlightedDocuments.map((entry) => (
            <DocumentCard key={entry.fileName} entry={entry} />
          ))}
        </div>

        <div className="inventory-table-wrap">
          <table className="inventory-table">
            <thead>
              <tr>
                <th>文書</th>
                <th>種別</th>
                <th>業務領域</th>
                <th>機密度</th>
                <th>鮮度</th>
                <th>正本候補</th>
                <th>AI利用方針</th>
              </tr>
            </thead>
            <tbody>
              {accountingOfficeInventory.map((entry) => {
                const promoted =
                  entry.maskerEvaluation?.recommendedSensitivity ===
                  'Restricted';
                const sensitivity = effectiveSensitivity(entry);
                return (
                  <tr
                    key={entry.fileName}
                    className={promoted ? 'promoted-row' : undefined}
                  >
                    <td>
                      <strong>{entry.fileName}</strong>
                      <span>{entry.rationale}</span>
                    </td>
                    <td>{documentTypeBadge(entry.documentType)}</td>
                    <td>{entry.businessDomain}</td>
                    <td>
                      <span
                        className={`badge sensitivity-${sensitivity.toLowerCase()}`}
                      >
                        {sensitivityLabel(sensitivity)}
                      </span>
                    </td>
                    <td>{freshnessLabel(entry.freshness)}</td>
                    <td>{entry.isAuthoritativeCandidate ? '候補' : '-'}</td>
                    <td>
                      <span className="policy-text">
                        {aiPolicyLabel(entry.aiUsePolicy)}
                      </span>
                      {promoted ? (
                        <span className="promotion-note">Maskerが格上げ</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="insight-grid" aria-label="Inventory insights">
        <div className="summary-panel heatmap-panel">
          <div className="chapter-kicker">3. Safety decision</div>
          <h2>機密度の分布</h2>
          <div className="heatmap">
            <div className="heat-corner" />
            {inventorySensitivityLevels.map((sensitivity) => (
              <div className="heat-label" key={sensitivity}>
                {sensitivityLabel(sensitivity)}
              </div>
            ))}
            {inventoryDomains.map((domain) => (
              <div className="heat-row" key={domain}>
                <div className="heat-domain">{domain}</div>
                {inventorySensitivityLevels.map((sensitivity) => {
                  const count = countByDomainAndSensitivity(
                    domain,
                    sensitivity
                  );
                  return (
                    <div className={heatClass(count)} key={sensitivity}>
                      {count}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="summary-panel">
          <div className="chapter-kicker">A8 residual risk</div>
          <h2>マスクしても渡せない情報</h2>
          {promotedDocuments.length === 0 ? (
            <p>このスナップショットでは Masker による格上げはありません。</p>
          ) : (
            promotedDocuments.map((entry) => (
              <div className="risk-callout" key={entry.fileName}>
                <span>Maskerが格上げ</span>
                <strong>{entry.fileName}</strong>
                <p>{entry.maskerEvaluation?.rationale}</p>
                <small>
                  {sensitivityLabel(entry.sensitivity)} {'->'}{' '}
                  {sensitivityLabel('Restricted')}
                </small>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="preview-grid" aria-label="Export preview">
        <div className="summary-panel">
          <div className="chapter-kicker">4. Purpose Package</div>
          <h2>目的別パッケージ</h2>
          <dl>
            <div>
              <dt>目的</dt>
              <dd>{payrollTrainingStrategistFixture.purpose}</dd>
            </div>
            <div>
              <dt>確認した文書</dt>
              <dd>{payrollTrainingStrategistFixture.sourceDocumentsReviewed}</dd>
            </div>
            <div>
              <dt>使える情報</dt>
              <dd>{payrollTrainingStrategistFixture.includedDocuments.length}</dd>
            </div>
            <div>
              <dt>除外情報</dt>
              <dd>{payrollTrainingStrategistFixture.excludedDocuments.length}</dd>
            </div>
            <div>
              <dt>人間確認</dt>
              <dd>
                {payrollTrainingStrategistFixture.humanReviewDocuments?.length ??
                  0}
              </dd>
            </div>
          </dl>
        </div>

        <div className="markdown-panel">
          <h2>Context Package Markdown</h2>
          <pre>{markdown}</pre>
        </div>
      </section>
    </main>
  );
}

function DocumentCard({ entry }: { entry: InventorySnapshotEntry }) {
  const promoted =
    entry.maskerEvaluation?.recommendedSensitivity === 'Restricted';
  const sensitivity = effectiveSensitivity(entry);
  return (
    <article className={`document-card ${promoted ? 'danger-card' : ''}`}>
      <div className="card-topline">
        <span>{documentTypeBadge(entry.documentType)}</span>
        <span>{entry.businessDomain}</span>
      </div>
      <h3>{entry.fileName}</h3>
      <p>{entry.rationale}</p>
      <div className="card-badges">
        <span
          className={`badge sensitivity-${sensitivity.toLowerCase()}`}
        >
          {sensitivityLabel(sensitivity)}
        </span>
        <span className="plain-badge">{freshnessLabel(entry.freshness)}</span>
        <span className="plain-badge">{aiPolicyLabel(entry.aiUsePolicy)}</span>
      </div>
    </article>
  );
}
