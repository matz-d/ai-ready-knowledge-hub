import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { isDemoMode } from '../lib/demoMode';
import { SiteNav } from './_components/SiteNav';
import './styles.css';

export const metadata: Metadata = {
  title: 'AI-Ready Knowledge Hub',
  description:
    '散らばった社内文書を分類・マスキングし、目的別に AI へ渡せる Context Package に変換する',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const demoMode = isDemoMode();

  return (
    <html lang="ja">
      <body suppressHydrationWarning>
        <header className="site-header">
          <div className="site-header__inner">
            <Link href="/" className="site-header__brand">
              <span className="site-header__brand-mark" aria-hidden="true">
                AI
              </span>
              <span>AI-Ready Knowledge Hub</span>
            </Link>
            <SiteNav demoMode={demoMode} />
          </div>
        </header>
        {demoMode ? (
          <div className="demo-mode-banner" role="status">
            <strong>公開デモ</strong>
            <span>
              任意アップロードは無効です。投入できるのは合成サンプルのみで、環境は定期リセット前提です。
            </span>
          </div>
        ) : null}
        {children}
      </body>
    </html>
  );
}
