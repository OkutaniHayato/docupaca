import type { Metadata } from "next";
import "./globals.css";
// AuthProvider をインポート
import { AuthProvider } from "@/context/AuthContext";

export const metadata: Metadata = {
  title: "ドキュパカ！",
  description: "AI-OCR 管理アプリ「ドキュパカ！」",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>
        {/* AuthProvider で全体をラップ */}
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}