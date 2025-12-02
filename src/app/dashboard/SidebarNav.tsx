"use client";

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useSidebar } from '@/context/SidebarContext';
import {
  LayoutDashboard,
  Settings,
  History,
  KeyRound,
  LogOut,
  GraduationCap,
  Building2,
  BookOpen
} from 'lucide-react';

const menuItems = [
  {
    name: 'ダッシュボード',
    href: '/dashboard',
    icon: LayoutDashboard
  },
  {
    name: '実行履歴',
    href: '/dashboard/history',
    icon: History
  },
  {
    name: 'OCR設定',
    href: '/dashboard/settings',
    icon: Settings
  },
  {
    name: '学習設定',
    href: '/dashboard/learning',
    icon: GraduationCap
  },
  {
    name: 'ナレッジ管理',
    href: '/dashboard/knowledge',
    icon: BookOpen
  },
  {
    name: '組織マスタ',
    href: '/dashboard/organizations',
    icon: Building2
  },
  {
    name: 'APIキー',
    href: '/dashboard/apikeys',
    icon: KeyRound
  },
];

export default function SidebarNav() {
  const pathname = usePathname();
  const { logout } = useAuth();
  const { isCollapsed } = useSidebar();

  return (
    <div className="flex h-full flex-col justify-between overflow-y-auto">
      {/* --- 上部メニュー --- */}
      <nav className="mt-4 space-y-1">
        {menuItems.map((item) => {
          const isActive = pathname === item.href ||
            (item.href !== '/dashboard' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center rounded px-4 py-2.5 transition duration-200 ${
                isActive
                  ? 'bg-green-700 text-white'
                  : 'text-white hover:bg-green-700'
              } ${isCollapsed ? 'justify-center' : ''}`}
              title={isCollapsed ? item.name : undefined}
            >
              <item.icon className={`h-5 w-5 ${isCollapsed ? '' : 'mr-3'}`} />
              {!isCollapsed && item.name}
            </Link>
          );
        })}
      </nav>

      {/* --- 下部メニュー（ログアウト） --- */}
      <div className="pb-4">
        <button
          onClick={() => logout()}
          className={`flex w-full items-center rounded px-4 py-2.5 text-white transition duration-200 hover:bg-green-700 ${
            isCollapsed ? 'justify-center' : ''
          }`}
          title={isCollapsed ? 'ログアウト' : undefined}
        >
          <LogOut className={`h-5 w-5 ${isCollapsed ? '' : 'mr-3'}`} />
          {!isCollapsed && 'ログアウト'}
        </button>
      </div>
    </div>
  );
}
