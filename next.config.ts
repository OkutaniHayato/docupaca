import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
      },
    ],
  },
  // API Routeで外部パッケージを使用可能にする
  serverExternalPackages: [
    '@google/generative-ai',
    'sharp',
    'xlsx',
    'pdf-parse',
    'csv-parse',
  ],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      if (typeof config.externals !== 'function') {
        config.externals = [config.externals || {}, 'xlsx', 'pdf-parse', 'csv-parse'];
      }
    }
    return config;
  },
};

export default nextConfig;