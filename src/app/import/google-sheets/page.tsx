import Link from 'next/link';
import '../../styles.css';
import { isDemoMode } from '../../../lib/demoMode';
import { ImportForm } from './ImportForm';

export const dynamic = 'force-dynamic';

export default function GoogleSheetsImportPage() {
  const demoMode = isDemoMode();

  return (
    <main className="page-shell upload-shell">
      <nav className="upload-nav" aria-label="パンくず">
        <Link href="/">トップへ戻る</Link>
        {' · '}
        <Link href="/upload">ファイルアップロード</Link>
      </nav>
      <header className="upload-header">
        <p className="eyebrow">{demoMode ? '公開デモ' : 'Google Sheets'}</p>
        <h1>
          {demoMode
            ? '公開デモでは外部文書の取り込みを無効化しています'
            : 'スプレッドシートを URL から取り込む'}
        </h1>
        <p className="lead upload-lead">
          {demoMode
            ? '公開URLでは任意の外部文書を投入できません。合成サンプル文書の取り込みからデモを開始してください。'
            : 'Drive 上の Google スプレッドシートをスナップショット化し、既存の Curator / Masker パイプラインへ投入します。読み取りにはサービスアカウントへの共有が必要です。'}
        </p>
      </header>
      {demoMode ? (
        <p className="upload-queue__cta">
          <Link href="/upload">サンプル文書を取り込む</Link>
        </p>
      ) : (
        <ImportForm />
      )}
    </main>
  );
}
