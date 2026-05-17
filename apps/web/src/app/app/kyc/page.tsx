'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface KycStatus {
  currentTier: string;
  latest: null | { id: string; status: string; targetTier: string; rejectionReason: string | null };
}

export default function KycPage() {
  const [data, setData] = useState<KycStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api<KycStatus>('/v1/kyc/status').then(setData).catch((e) => setError((e as Error).message));
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true); setError(null);
    const f = new FormData(e.currentTarget);
    try {
      await api('/v1/kyc/submit', {
        method: 'POST',
        body: JSON.stringify({
          targetTier: 'TIER_2',
          firstName: f.get('firstName'),
          lastName:  f.get('lastName'),
          dateOfBirth: f.get('dob'),
          city: f.get('city'),
          nationalId: f.get('nationalId') || undefined,
          documents: [{ type: 'NATIONAL_ID', storageKey: 's3://placeholder/key' }],
        }),
      });
      const s = await api<KycStatus>('/v1/kyc/status');
      setData(s);
    } catch (err) { setError((err as Error).message); }
    finally { setSubmitting(false); }
  }

  return (
    <section className="max-w-xl">
      <h1 className="text-2xl font-semibold mb-2">Identity verification</h1>
      <p className="text-muted mb-6">Higher tiers unlock larger transaction limits and more rails.</p>
      <div className="card mb-4">
        <p className="kpi-label">Current tier</p>
        <p className="kpi">{data?.currentTier ?? '…'}</p>
        {data?.latest && (
          <p className="text-sm text-muted mt-2">
            Latest submission: {data.latest.status} → {data.latest.targetTier}
            {data.latest.rejectionReason && <span className="block text-danger">{data.latest.rejectionReason}</span>}
          </p>
        )}
      </div>

      <form onSubmit={submit} className="card space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">First name</label><input className="input" name="firstName" required /></div>
          <div><label className="label">Last name</label> <input className="input" name="lastName" required /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Date of birth</label><input className="input" type="date" name="dob" required /></div>
          <div><label className="label">City</label>          <input className="input" name="city" /></div>
        </div>
        <div>
          <label className="label">National ID (optional, encrypted)</label>
          <input className="input" name="nationalId" />
        </div>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary w-full" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit for review'}
        </button>
      </form>
    </section>
  );
}
