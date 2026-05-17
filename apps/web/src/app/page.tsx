import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="max-w-5xl mx-auto px-6 py-20">
      <header className="mb-16">
        <p className="text-muted text-sm uppercase tracking-wider">AfriStable Pay</p>
        <h1 className="text-5xl md:text-6xl font-semibold tracking-tight mt-3">
          One account. Every African market. Settled in stablecoins.
        </h1>
        <p className="text-muted mt-6 max-w-2xl">
          Send, receive, and convert money across borders, between mobile-money networks, banks,
          and stablecoin rails — with the controls and audit trails real money infrastructure demands.
        </p>
        <div className="flex gap-3 mt-8">
          <Link href="/signup" className="btn btn-primary">Create account</Link>
          <Link href="/login"  className="btn btn-ghost">Sign in</Link>
        </div>
      </header>

      <section className="grid md:grid-cols-3 gap-4">
        <div className="card">
          <h3 className="font-semibold mb-2">Multi-currency wallets</h3>
          <p className="text-muted text-sm">Hold USDC, USDT, USD, NGN, KES, GHS, ZAR — convert in seconds at a transparent rate.</p>
        </div>
        <div className="card">
          <h3 className="font-semibold mb-2">Stablecoin rails</h3>
          <p className="text-muted text-sm">Deposit and withdraw via Ethereum, Polygon, Base, Solana, Stellar. Idempotent, signed, monitored.</p>
        </div>
        <div className="card">
          <h3 className="font-semibold mb-2">Local payouts</h3>
          <p className="text-muted text-sm">M-Pesa, MTN, Orange, Airtel, plus banks via Flutterwave and Paystack. Webhook-verified end-to-end.</p>
        </div>
      </section>
    </main>
  );
}
