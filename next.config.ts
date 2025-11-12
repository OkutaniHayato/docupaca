// next.config.ts (Turbopack運用向け)
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'firebasestorage.googleapis.com' },
    ],
  },
  // Turbopackでは webpack 設定は書かない
};

export default nextConfig;
