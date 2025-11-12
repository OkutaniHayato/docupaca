import path from 'path';
import CopyPlugin from 'copy-webpack-plugin';
import type { Configuration } from 'webpack';
import type { NextConfig } from 'next';

// 'pdfjs-dist' の main エントリポイント (build/pdf.js) へのパスを取得
// --- ▼ 修正箇所 ▼ ---
// 以下の '@ts-expect-error' コメント行を削除します (エラーが発生していないため不要)
// --- ▲ 修正箇所 ▲ ---
const pdfJsMainPath = require.resolve('pdfjs-dist');

// 'build' フォルダへのパスを取得 (pdfJsMainPath は .../build/pdf.js のため)
const pdfJsBuildDir = path.dirname(pdfJsMainPath);

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
  
  webpack: (
    config: Configuration,
    { isServer }: { isServer: boolean }
  ) => {
    if (!isServer) {
      config.plugins = config.plugins || []; 
      config.plugins.push(
        new CopyPlugin({
          patterns: [
            {
              from: path.posix.join(
                pdfJsBuildDir.replace(/\\/g, '/'),
                'pdf.worker.min.mjs' 
              ),
              to: path.join(__dirname, 'public'), 
            },
          ],
        })
      );
    }
    return config;
  },
};

export default nextConfig;