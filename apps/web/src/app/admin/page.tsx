'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Approval {
  id: string; kind: string; status: string; createdAt: string;
  subjectUser: { email: string; kycTier: string };
  transaction: null | { amount: string; currency: string; status: string };
  payload: { usdAmount?: number; rail?: string; reasons?: Array<{ rule: string; score: number }> };
}

export default function AdminDashboard() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ items: Approval[] }>('/v1/admin/approvals?status=PENDING&limit=50')
      .then((r) => setApprovals(r.items))
      .catch((e) => setError((e as Error).message));
  }, []);

  async function decide(id: string, decision: 'APPROVED' | 'REJECTED') {
    await api('/v1/admin/approvals/decide', {
      method: 'POST',
      body: JSON.stringify({ approvalId: id, decision }),
    });
    setApprovals((a) => a.filter((x) => x.id !== id));
  }

  return (
    <main className="max-w-6xl mx-auto p-8">
      <h1 className="text-2xl font-semibold mb-6">Admin · Approval queue</h1>
      {error && <p className="error mb-4">{error}</p>}
      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-left text-muted">
            <tr>
              <th className="p-3">When</th><th className="p-3">User</th><th className="p-3">Kind</th>
              <th className="p-3 text-right">USD</th><th className="p-3">Reasons</th><th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {approvals.map((a) => (
              <tr key={a.id} className="border-t border-border">
                <td className="p-3 text-muted">{new Date(a.createdAt).toLocaleString()}</td>
                <td className="p-3">{a.subjectUser.email} <span className="text-muted">({a.subjectUser.kycTier})</span></td>
                <td className="p-3">{a.kind} <span className="text-muted">{a.payload.rail}</span></td>
                <td className="p-3 text-right">{a.payload.usdAmount?.toFixed(2)}</td>
                <td className="p-3 text-muted">{(a.payload.reasons ?? []).map((r) => r.rule).join(', ')}</td>
                <td className="p-3 flex gap-2 justify-end">
                  <button onClick={() => decide(a.id, 'APPROVED')} className="btn btn-primary text-xs">Approve</button>
                  <button onClick={() => decide(a.id, 'REJECTED')} className="btn btn-ghost  text-xs">Reject</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
