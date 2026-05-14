import Link from 'next/link';
import '../styles.css';
import { ContextPackageForm } from './ContextPackageForm';

export default function ContextPackagePage() {
  return (
    <main className="page-shell upload-shell">
      <nav className="upload-nav" aria-label="パンくず">
        <Link href="/">トップへ戻る</Link>
      </nav>
      <header className="upload-header">
        <p className="eyebrow">Context Package</p>
        <h1>目的を入力して、AIに渡せる文脈を生成する</h1>
        <p className="lead upload-lead">
          Purpose を入力すると、Inventory から目的に合致するチャンクを選別し、
          NotebookLM・Gemini・RAG などに渡せる Context Package として出力します。
          Inventory が空の場合は先にドキュメントをアップロードしてください。
        </p>
      </header>
      <ContextPackageForm />
    </main>
  );
}
