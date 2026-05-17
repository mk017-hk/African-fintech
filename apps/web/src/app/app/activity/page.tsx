'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Tx {
  id: string; type: string; status: string; amount: string; currency: string;
  feeAmount: string; createdAt: string;
}

export default function ActivityPage() {
  const [txs, setTxs] = useState<Tx[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ transactions: Tx[] }>('/v1/transfers?limit=50')
      .then((r) => setTxs(r.transactions))
      .catch((e) => setError((e as Error).message));
  }, []);

  return (
    <section>
      <h1 className="text-2xl font-semibold mb-6">Activity</h1>
      {error && <p className="error mb-4">{error}</p>}
      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-left text-muted">
            <tr>
              <th className="p-3">When</th><th className="p-3">Type</th><th className="p-3">Status</th>
              <th className="p-3 text-right">Amount</th><th className="p-3 text-right">Fee</th>
            </tr>
          </thead>
          <tbody>
            {txs.map((t) => (
              <tr key={t.id} className="border-t border-border">
                <td className="p-3 text-muted">{new Date(t.createdAt).toLocaleString()}</td>
                <td className="p-3">{t.type}</td>
                <td className="p-3"><StatusBadge status={t.status} /></td>
                <td className="p-3 text-right">{t.amount} {t.currency}</td>
                <td className="p-3 text-right text-muted">{t.feeAmount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === 'COMPLETED' ? 'text-accent'
    : status === 'FAILED' || status === 'CANCELLED' ? 'text-danger'
    : status === 'REQUIRES_APPROVAL' ? 'text-warning'
    : 'text-muted';
  return <span className={`${color} text-xs uppercase tracking-wide`}>{status}</span>;
}
