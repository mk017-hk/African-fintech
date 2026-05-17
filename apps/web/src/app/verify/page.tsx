'use client';

import { useState } from 'react';
import { api } from '@/lib/api';

export default function VerifyPage() {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function verify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null); setStatus(null);
    const form = new FormData(e.currentTarget);
    try {
      await api('/v1/auth/otp/verify', {
        method: 'POST',
        body: JSON.stringify({ challengeId: form.get('challengeId'), code: form.get('code') }),
        auth: false,
      });
      setStatus('Verified. You can now sign in.');
    } catch (err) { setError((err as Error).message); }
  }

  return (
    <main className="max-w-md mx-auto px-6 py-16">
      <h1 className="text-3xl font-semibold mb-2">Verify your email</h1>
      <p className="text-muted mb-6">Enter the 6-digit code we sent you.</p>
      <form onSubmit={verify} className="space-y-4 card">
        <div>
          <label className="label" htmlFor="challengeId">Challenge ID</label>
          <input className="input" id="challengeId" name="challengeId" required />
        </div>
        <div>
          <label className="label" htmlFor="code">Code</label>
          <input className="input" id="code" name="code" required maxLength={6} pattern="\d{6}" inputMode="numeric" />
        </div>
        {error && <p className="error">{error}</p>}
        {status && <p className="text-accent text-sm">{status}</p>}
        <button className="btn btn-primary w-full" type="submit">Verify</button>
      </form>
    </main>
  );
}
