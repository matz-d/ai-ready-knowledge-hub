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
        <h1>複数の文書をまとめてアップロードして分類する</h1>
        <p className="lead upload-lead">
          .txt / .md / .csv / .xlsx / .pdf（1ファイル最大 5 MB・一度に最大 20 件）に対応しています。
          複数ファイルを選ぶと1件ずつ順に取り込み、ファイルごとに進捗・成否を表示します。
          失敗しても他のファイルは継続し、失敗分だけ再試行できます。取り込んだ文書は
          安全な保管領域に保存され、Curator がすぐに機密度と AI 利用方針を分類します。
          PDF 対応はベータ版です。
        </p>
      </header>
      <UploadForm />
    </main>
  );
}
