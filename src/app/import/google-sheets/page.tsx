import Link from 'next/link';
import '../../styles.css';
import { ImportForm } from './ImportForm';

export const dynamic = 'force-dynamic';

export default function GoogleSheetsImportPage() {
  return (
    <main className="page-shell upload-shell">
      <nav className="upload-nav" aria-label="パンくず">
        <Link href="/">トップへ戻る</Link>
        {' · '}
        <Link href="/upload">ファイルアップロード</Link>
      </nav>
      <header className="upload-header">
        <p className="eyebrow">Google Sheets</p>
        <h1>スプレッドシートを URL から取り込む</h1>
        <p className="lead upload-lead">
          Drive 上の Google スプレッドシートをスナップショット化し、既存の Curator /
          Masker パイプラインへ投入します。読み取りにはサービスアカウントへの共有が必要です。
        </p>
      </header>
      <ImportForm />
    </main>
  );
}
