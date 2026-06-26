'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/', label: 'ダッシュボード' },
  { href: '/upload', label: 'アップロード' },
  { href: '/import/google-sheets', label: 'Google Sheets 取り込み', hiddenInDemo: true },
  { href: '/context-package', label: 'Context Package' },
] as const;

function isActivePath(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

type SiteNavProps = {
  demoMode?: boolean;
};

export function SiteNav({ demoMode = false }: SiteNavProps) {
  const pathname = usePathname();
  const visibleNavItems = demoMode
    ? navItems.filter((item) => !('hiddenInDemo' in item && item.hiddenInDemo))
    : navItems;

  return (
    <nav className="site-header__nav" aria-label="主要ナビゲーション">
      {visibleNavItems.map((item) => {
        const isActive = isActivePath(pathname, item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
