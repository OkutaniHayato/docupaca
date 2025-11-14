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
  // pdfjs-dist用のWebpack設定
  webpack: (config: any) => {
    // canvasモジュールをクライアントサイドで無効化
    config.resolve.alias.canvas = false;
    // pdfjs-distのWorkerを正しく扱う
    config.module = config.module || {};
    config.module.rules = config.module.rules || [];
    config.module.rules.push({
      test: /\.mjs$/,
      include: /node_modules/,
      type: 'javascript/auto',
    });
    return config;
  },
};

export default nextConfig;