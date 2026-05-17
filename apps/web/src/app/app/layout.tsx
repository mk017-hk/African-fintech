'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { loadTokensFromStorage } from '@/lib/api';

const nav = [
  { href: '/app',           label: 'Wallets'      },
  { href: '/app/send',      label: 'Send'         },
  { href: '/app/receive',   label: 'Receive'      },
  { href: '/app/activity',  label: 'Activity'     },
  { href: '/app/kyc',       label: 'KYC'          },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  useEffect(() => { loadTokensFromStorage(); }, []);
  return (
    <div className="min-h-screen flex">
      <aside className="w-60 border-r border-border bg-surface p-5">
        <div className="text-lg font-semibold mb-8">AfriStable</div>
        <nav className="space-y-1">
          {nav.map((n) => (
            <Link key={n.href} href={n.href as never}
              className={`block rounded-lg px-3 py-2 text-sm ${path === n.href ? 'bg-white/5 text-text' : 'text-muted hover:text-text'}`}>
              {n.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
