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
        <p className="eyebrow">Upload</p>
        <h1>文書を1件アップロードして分類する</h1>
        <p className="lead upload-lead">
          .txt / .md / .csv（最大 1 MB）を送信すると、原本を Cloud Storage に保存し、
          Firestore にメタデータを記録したうえで Curator が即時に分類します。
        </p>
      </header>
      <UploadForm />
    </main>
  );
}
