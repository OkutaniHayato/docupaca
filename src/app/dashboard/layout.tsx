"use client";

import React from 'react';
import Image from 'next/image';
import { AuthGuard } from '../../components/AuthGuard';
import UserMenu from './UserMenu';
import SidebarNav from './SidebarNav';
import { SidebarProvider, useSidebar } from '@/context/SidebarContext';
import { ChevronLeft, ChevronRight } from 'lucide-react';

function DashboardContent({ children }: { children: React.ReactNode }) {
  const { isCollapsed, toggleSidebar } = useSidebar();

  return (
    <div className="flex h-screen bg-gray-50">
      {/* --- サイドバー --- */}
      <aside
        className={`bg-green-900 text-white shadow-md flex flex-col transition-all duration-300 ${
          isCollapsed ? 'w-16' : 'w-64'
        }`}
      >
        {/* ロゴエリア + 折りたたみボタン */}
        <div className={`p-4 flex items-center ${isCollapsed ? 'flex-col gap-2' : 'justify-between'}`}>
          <div className={`flex items-center ${isCollapsed ? 'justify-center' : ''}`}>
            <Image
              src="/logo.png"
              alt="ドキュパカ"
              width={40}
              height={40}
              className="flex-shrink-0 rounded-lg bg-white/10 p-1"
            />
            {!isCollapsed && (
              <span className="ml-2 text-xl font-semibold text-white whitespace-nowrap">
                ドキュパカ！
              </span>
            )}
          </div>
          <button
            onClick={toggleSidebar}
            className="flex items-center justify-center rounded p-1.5 text-white/70 hover:bg-green-700 hover:text-white transition-colors"
            title={isCollapsed ? 'メニューを展開' : 'メニューを折りたたむ'}
          >
            {isCollapsed ? (
              <ChevronRight className="h-5 w-5" />
            ) : (
              <ChevronLeft className="h-5 w-5" />
            )}
          </button>
        </div>

        {/* --- ナビゲーション --- */}
        <div className="flex-1 px-2 overflow-y-auto">
          <SidebarNav />
        </div>
      </aside>

      {/* --- メインコンテンツエリア --- */}
      <div className="flex flex-1 flex-col overflow-hidden">

        {/* ヘッダー */}
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
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <SidebarProvider>
        <DashboardContent>{children}</DashboardContent>
      </SidebarProvider>
    </AuthGuard>
  );
}
