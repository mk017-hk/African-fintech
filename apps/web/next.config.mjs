/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { typedRoutes: true },

  // Same-origin proxy. The browser only ever calls /api/* on the web origin;
  // Next.js rewrites those to the API server. Eliminates CORS, cross-origin
  // cookie issues, and the need to expose port 4000 publicly in environments
  // like Codespaces. In production, set API_INTERNAL_URL to the private
  // service URL (e.g. http://api.railway.internal:4000 or the k8s service DNS).
  async rewrites() {
    const target = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
    return [
      { source: '/api/:path*', destination: `${target}/:path*` },
    ];
  },

  // Send strong security headers from the edge as a defence-in-depth layer.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options',          value: 'DENY' },
          { key: 'X-Content-Type-Options',   value: 'nosniff' },
          { key: 'Referrer-Policy',          value: 'no-referrer' },
          { key: 'Permissions-Policy',       value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security',value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
    ];
  },
};
export default nextConfig;
