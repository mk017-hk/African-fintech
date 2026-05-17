/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { typedRoutes: true },
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
