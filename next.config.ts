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
      // externals を object 形式で設定（webpack の仕様に合わせる）
      if (typeof config.externals !== 'function') {
        config.externals = {
          ...(typeof config.externals === 'object' ? config.externals : {}),
          'xlsx': 'xlsx',
          'pdf-parse': 'pdf-parse',
          'csv-parse': 'csv-parse',
        };
      }
    }
    return config;
  },
};

export default nextConfig;