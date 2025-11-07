import React from 'react';
import { AuthGuard } from '../../components/AuthGuard'; 
import UserMenu from './UserMenu'; 
import SidebarNav from './SidebarNav'; // SidebarNav をインポート

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <div className="flex h-screen bg-gray-50">
        
        {/* --- サイドバー --- */}
        <aside className="w-64 bg-green-900 text-white shadow-md flex flex-col">
          {/* ロゴ */}
          <div className="p-4">
            <h2 className="text-2xl font-semibold text-white">
              ドキュパカ！
            </h2>
          </div>
          
          {/* --- ナビゲーション（SidebarNav.tsx を使用） --- */}
          <div className="flex-1 p-4 overflow-y-auto">
            <SidebarNav />
          </div>
        </aside>

        {/* --- メインコンテンツエリア --- */}
        <div className="flex flex-1 flex-col overflow-hidden">
          
          {/* ヘッダー (UserMenu を配置) */}
          <header className="flex items-center justify-between border-b border-gray-200 bg-white p-4 shadow-sm">
            <div>
              <h1 className="text-xl font-semibold text-gray-800">ダッシュボード</h1>
            </div>
            <div>
              <UserMenu /> 
            </div>
          </header>

          {/* メインコンテンツ */}
          <main className="flex-1 overflow-y-auto p-6">
            {children}
          </main>
        </div>
      </div>
    </AuthGuard>
  );
}