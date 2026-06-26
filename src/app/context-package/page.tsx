import Link from 'next/link';
import '../styles.css';
import { isDemoMode } from '../../lib/demoMode';
import { ContextPackageForm } from './ContextPackageForm';

export default function ContextPackagePage() {
  const demoMode = isDemoMode();

  return (
    <main className="page-shell upload-shell">
      <nav className="upload-nav" aria-label="パンくず">
        <Link href="/">トップへ戻る</Link>
      </nav>
      <header className="upload-header">
        <p className="eyebrow">Context Package</p>
        <h1>目的を入力して、AIに渡せる文脈を生成する</h1>
        <p className="lead upload-lead">
          {demoMode
            ? '公開デモでは合成サンプルだけを対象に、目的に合致するチャンクを選別します。Purpose は自由に入力できますが、実名・顧客情報・機密情報は入れないでください。'
            : 'Purpose を入力すると、Inventory から目的に合致するチャンクを選別し、NotebookLM・Gemini・RAG などに渡せる Context Package として出力します。Inventory が空の場合は先にドキュメントをアップロードしてください。'}
        </p>
      </header>
      <ContextPackageForm demoMode={demoMode} />
    </main>
  );
}
