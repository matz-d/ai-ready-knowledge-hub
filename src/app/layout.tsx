import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import './styles.css';

export const metadata: Metadata = {
  title: 'AI-Ready Knowledge Hub',
  description:
    '散らばった社内文書を分類・マスキングし、目的別に AI へ渡せる Context Package に変換する',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <header className="site-header">
          <div className="site-header__inner">
            <Link href="/" className="site-header__brand">
              <span className="site-header__brand-mark" aria-hidden="true">
                AI
              </span>
              <span>AI-Ready Knowledge Hub</span>
            </Link>
            <nav className="site-header__nav" aria-label="主要ナビゲーション">
              <Link href="/">ダッシュボード</Link>
              <Link href="/upload">アップロード</Link>
              <Link href="/import/google-sheets">Google Sheets 取り込み</Link>
              <Link href="/context-package">Context Package</Link>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
