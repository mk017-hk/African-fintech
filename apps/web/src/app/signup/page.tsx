'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

export default function SignupPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null); setLoading(true);
    const form = new FormData(e.currentTarget);
    try {
      await api('/v1/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          email: form.get('email'),
          password: form.get('password'),
          phoneE164: form.get('phone') || undefined,
          countryCode: form.get('country'),
          acceptedTerms: true,
        }),
        auth: false,
      });
      router.push('/verify');
    } catch (err) {
      setError((err as Error).message);
    } finally { setLoading(false); }
  }

  return (
    <main className="max-w-md mx-auto px-6 py-16">
      <h1 className="text-3xl font-semibold mb-2">Create your account</h1>
      <p className="text-muted mb-8">12-character password minimum. We&apos;ll email you a one-time code to verify.</p>
      <form onSubmit={onSubmit} className="space-y-4 card">
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input className="input" type="email" id="email" name="email" required autoComplete="email" />
        </div>
        <div>
          <label className="label" htmlFor="phone">Phone (optional, E.164)</label>
          <input className="input" type="tel" id="phone" name="phone" placeholder="+2547XXXXXXXX" autoComplete="tel" />
        </div>
        <div>
          <label className="label" htmlFor="country">Country (ISO-2)</label>
          <input className="input" type="text" id="country" name="country" required maxLength={2}
            placeholder="KE" pattern="[A-Z]{2}" />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input className="input" type="password" id="password" name="password" required
            autoComplete="new-password" minLength={12} />
        </div>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary w-full" type="submit" disabled={loading}>
          {loading ? 'Creating…' : 'Create account'}
        </button>
      </form>
    </main>
  );
}
