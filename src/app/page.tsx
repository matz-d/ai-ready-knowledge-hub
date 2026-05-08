import {
  exportContextPackageMarkdown,
  sampleContextPackage,
} from '../lib/exportContextPackage';
import './styles.css';

export default function Home() {
  const markdown = exportContextPackageMarkdown(sampleContextPackage);

  return (
    <main className="page-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">AI-Ready Knowledge Hub</p>
          <h1>Context Package Export</h1>
          <p className="lead">
            Purpose Query に対して選ばれた文書だけを、下流AIに渡せる
            Markdown package として出力する最小PoCです。
          </p>
        </div>
        <div className="status-panel" aria-label="PoC status">
          <span>W1-3</span>
          <strong>A9 Markdown export ready</strong>
        </div>
      </section>

      <section className="preview-grid" aria-label="Export preview">
        <div className="summary-panel">
          <h2>Package Manifest</h2>
          <dl>
            <div>
              <dt>Purpose</dt>
              <dd>{sampleContextPackage.purpose}</dd>
            </div>
            <div>
              <dt>Reviewed</dt>
              <dd>{sampleContextPackage.sourceDocumentsReviewed}</dd>
            </div>
            <div>
              <dt>Included</dt>
              <dd>{sampleContextPackage.includedDocuments.length}</dd>
            </div>
            <div>
              <dt>Human review</dt>
              <dd>{sampleContextPackage.humanReviewDocuments?.length ?? 0}</dd>
            </div>
          </dl>
        </div>

        <div className="markdown-panel">
          <h2>Markdown Output</h2>
          <pre>{markdown}</pre>
        </div>
      </section>
    </main>
  );
}
