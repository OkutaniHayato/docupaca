import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
      },
    ],
  },
  // API Routeで外部パッケージを使用可能にする
  experimental: {
    serverComponentsExternalPackages: [
      '@google/generative-ai',
      'pdf-lib',
    ],
  },
};

export default nextConfig;