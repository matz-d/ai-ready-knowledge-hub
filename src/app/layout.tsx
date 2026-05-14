import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import './styles.css';

export const metadata: Metadata = {
  title: 'AI-Ready Knowledge Hub',
  description: 'Context Package export PoC',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <header className="site-header">
          <div className="site-header__inner">
            <Link href="/" className="site-header__brand">
              AI-Ready Knowledge Hub
            </Link>
            <nav className="site-header__nav" aria-label="主要ナビゲーション">
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
