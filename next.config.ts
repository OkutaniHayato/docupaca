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
  // react-pdf用のWebpack設定
  webpack: (config: any) => {
    // canvasモジュールをクライアントサイドで無効化
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;