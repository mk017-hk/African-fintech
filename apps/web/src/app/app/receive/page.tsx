'use client';

import { useState } from 'react';
import { api } from '@/lib/api';

export default function ReceivePage() {
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    try {
      const r = await api<{ requestId: string; payUrl: string }>('/v1/transfers/requests', {
        method: 'POST',
        body: JSON.stringify({
          amount: f.get('amount'),
          currency: f.get('currency'),
          note: f.get('note') || undefined,
        }),
      });
      setLink(r.payUrl);
    } catch (err) { setError((err as Error).message); }
  }

  return (
    <section className="max-w-xl">
      <h1 className="text-2xl font-semibold mb-6">Request money</h1>
      <form onSubmit={create} className="card space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Amount</label>
            <input className="input" name="amount" pattern="\d+(\.\d+)?" required />
          </div>
          <div>
            <label className="label">Currency</label>
            <select className="input" name="currency" defaultValue="USDC">
              {['USDC','USDT','USD','NGN','KES','GHS'].map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label">Note</label>
          <input className="input" name="note" maxLength={280} />
        </div>
        <button className="btn btn-primary w-full">Generate payment link</button>
      </form>
      {link && (
        <div className="card mt-4">
          <p className="kpi-label mb-2">Share this link or QR</p>
          <code className="block text-accent break-all">{link}</code>
        </div>
      )}
      {error && <p className="error mt-4">{error}</p>}
    </section>
  );
}
