'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, setTokens } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null); setLoading(true);
    const form = new FormData(e.currentTarget);
    try {
      const res = await api<{ accessToken: string; refreshToken: string }>('/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
        auth: false,
      });
      setTokens(res);
      router.push('/app');
    } catch (err) {
      setError((err as Error).message);
    } finally { setLoading(false); }
  }

  return (
    <main className="max-w-md mx-auto px-6 py-16">
      <h1 className="text-3xl font-semibold mb-2">Welcome back</h1>
      <p className="text-muted mb-8">Sign in to your AfriStable account.</p>
      <form onSubmit={onSubmit} className="space-y-4 card">
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input className="input" type="email" id="email" name="email" required autoComplete="email" />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input className="input" type="password" id="password" name="password" required autoComplete="current-password" />
        </div>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary w-full" type="submit" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
