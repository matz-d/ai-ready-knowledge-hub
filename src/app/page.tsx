import './styles.css';

export const dynamic = 'force-dynamic';

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
    label: 'Knowledge Inventory UI',
    status: 'next',
    detail: 'W2 で Cloud Storage / Firestore 接続後に実データ表示へ切り替える。',
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

export default function Home() {
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
        </div>
        <div className="status-panel" aria-label="実装ステータス">
          <span>Current build</span>
          <strong>実データ接続準備</strong>
          <small>
            W1 の固定デモ表示を外し、実データ接続へ進むための画面に整理済み。
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
          <strong>3</strong>
          <p>Curator、Masker、Curator API の実行経路</p>
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
          <p>Upload UI、Storage、Firestore、実 Inventory 表示</p>
        </div>
      </section>

      <section className="section-block" aria-labelledby="runtime-heading">
        <div className="section-heading">
          <div>
            <p className="chapter-kicker">Runtime Path</p>
            <h2 id="runtime-heading">固定デモではなく、実行経路を中心にする</h2>
          </div>
          <p>
            この画面は固定サンプル出力を読みません。現在は
            実装済み flow と次に接続するデータ経路を見せるだけにしています。
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
