'use client';

import { useState } from 'react';
import { api, newIdempotencyKey } from '@/lib/api';

interface Quote {
  id: string; fromAmount: string; toAmount: string; rate: string; feeAmount: string;
  feeCurrency: string; expiresAt: string; rail: string;
}

export default function SendPage() {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [destination, setDestination] = useState({ kind: 'phone', value: '' });

  async function getQuote(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    try {
      const q = await api<Quote>('/v1/quotes', {
        method: 'POST',
        body: JSON.stringify({
          fromCurrency: f.get('from'),
          toCurrency:   f.get('to'),
          fromAmount:   f.get('amount'),
          rail: 'internal',
        }),
      });
      setQuote(q);
    } catch (err) { setError((err as Error).message); }
  }

  async function confirm() {
    if (!quote) return;
    setError(null); setStatus(null);
    try {
      const body = {
        quoteId: quote.id,
        destination: destination.kind === 'phone'
          ? { kind: 'phone', phoneE164: destination.value }
          : { kind: 'user', userId: destination.value },
      };
      const r = await api<{ transactionId: string; status: string }>('/v1/transfers', {
        method: 'POST',
        headers: { 'Idempotency-Key': newIdempotencyKey() },
        body: JSON.stringify(body),
      });
      setStatus(`${r.status}: tx ${r.transactionId}`);
      setQuote(null);
    } catch (err) { setError((err as Error).message); }
  }

  return (
    <section className="max-w-xl">
      <h1 className="text-2xl font-semibold mb-6">Send money</h1>
      <form onSubmit={getQuote} className="card space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">From</label>
            <select className="input" name="from" defaultValue="USDC">
              {['USDC','USDT','USD','NGN','KES','GHS'].map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="label">To</label>
            <select className="input" name="to" defaultValue="USDC">
              {['USDC','USDT','USD','NGN','KES','GHS'].map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Amount</label>
            <input className="input" name="amount" type="text" pattern="\d+(\.\d+)?" required />
          </div>
        </div>
        <button className="btn btn-primary w-full" type="submit">Get quote</button>
      </form>

      {quote && (
        <div className="card mt-4">
          <h3 className="font-semibold mb-3">Quote</h3>
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-muted">You send</dt><dd>{quote.fromAmount}</dd>
            <dt className="text-muted">Recipient gets</dt><dd>{quote.toAmount}</dd>
            <dt className="text-muted">Rate</dt><dd>{quote.rate}</dd>
            <dt className="text-muted">Fee</dt><dd>{quote.feeAmount} {quote.feeCurrency}</dd>
            <dt className="text-muted">Expires</dt><dd>{new Date(quote.expiresAt).toLocaleTimeString()}</dd>
          </dl>
          <div className="mt-4 space-y-2">
            <label className="label">Destination</label>
            <div className="flex gap-2">
              <select className="input" value={destination.kind}
                onChange={(e) => setDestination((d) => ({ ...d, kind: e.target.value }))}>
                <option value="phone">Phone (E.164)</option>
                <option value="user">User ID</option>
              </select>
              <input className="input" value={destination.value}
                onChange={(e) => setDestination((d) => ({ ...d, value: e.target.value }))}
                placeholder={destination.kind === 'phone' ? '+2547XXXXXXXX' : 'user_…'} />
            </div>
          </div>
          <button onClick={confirm} className="btn btn-primary w-full mt-4">Confirm send</button>
        </div>
      )}

      {error && <p className="error mt-4">{error}</p>}
      {status && <p className="text-accent mt-4">{status}</p>}
    </section>
  );
}
