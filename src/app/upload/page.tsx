import Link from 'next/link';
import '../styles.css';
import { UploadForm } from './UploadForm';

export const dynamic = 'force-dynamic';

export default function UploadPage() {
  return (
    <main className="page-shell upload-shell">
      <nav className="upload-nav" aria-label="パンくず">
        <Link href="/">トップへ戻る</Link>
      </nav>
      <header className="upload-header">
        <p className="eyebrow">アップロード</p>
        <h1>文書を1件アップロードして分類する</h1>
        <p className="lead upload-lead">
          .txt / .md / .csv / .xlsx / .pdf（最大 5 MB）に対応しています。アップロードした文書は
          安全な保管領域に保存され、Curator がすぐに機密度と AI 利用方針を分類します。
          PDF 対応はベータ版です。
        </p>
      </header>
      <UploadForm />
    </main>
  );
}
