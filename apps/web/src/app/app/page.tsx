'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Wallet {
  id: string; currency: string; type: 'STABLECOIN' | 'FIAT'; status: string;
  availableBalance: string; pendingBalance: string; lockedBalance: string;
}

export default function WalletsPage() {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ wallets: Wallet[] }>('/v1/wallets')
      .then((r) => setWallets(r.wallets))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  async function createWallet(currency: string) {
    await api('/v1/wallets', { method: 'POST', body: JSON.stringify({ currency }) });
    const r = await api<{ wallets: Wallet[] }>('/v1/wallets');
    setWallets(r.wallets);
  }

  return (
    <section>
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Wallets</h1>
        <div className="flex gap-2">
          {['USDC', 'USDT', 'USD', 'NGN', 'KES', 'GHS'].map((c) => (
            <button key={c} onClick={() => createWallet(c)} className="btn btn-ghost text-sm">+ {c}</button>
          ))}
        </div>
      </header>
      {loading && <p className="text-muted">Loading…</p>}
      {error && <p className="error">{error}</p>}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {wallets.map((w) => (
          <article key={w.id} className="card">
            <div className="flex items-center justify-between">
              <span className="kpi-label">{w.type}</span>
              <span className={`text-xs ${w.status === 'ACTIVE' ? 'text-accent' : 'text-warning'}`}>{w.status}</span>
            </div>
            <div className="mt-2">
              <div className="kpi">{w.availableBalance} <span className="text-muted text-base">{w.currency}</span></div>
              {Number(w.pendingBalance) > 0 && (
                <div className="text-xs text-muted mt-1">Pending: {w.pendingBalance}</div>
              )}
              {Number(w.lockedBalance) > 0 && (
                <div className="text-xs text-muted">Locked: {w.lockedBalance}</div>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
