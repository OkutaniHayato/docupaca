"use client";

import React, { useState } from 'react';
import { useAuth } from '@/context/AuthContext'; 

/**
 * ヘッダー用 ユーザーメニュー
 * (Eメール表示)
 */
export default function UserMenu() {
  const { currentUser } = useAuth();
  const [isOpen, setIsOpen] = useState(false); // ドロップダウン開閉用

  if (!currentUser) {
    return null; // 認証情報がまだない場合は何も表示しない
  }

  return (
    <div className="relative">
      {/* ユーザーアイコン (クリックでドロップダウン開閉) */}
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="h-10 w-10 rounded-full bg-gray-300 flex items-center justify-center text-gray-600 font-semibold"
      >
        {/* ユーザー名の頭文字などを表示 (例) */}
        {currentUser.email?.charAt(0).toUpperCase() || 'U'}
      </button> {/* {/* ドロップダウンメニュー */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 z-10">
          <div className="py-1">
            <div className="px-4 py-2 text-sm text-gray-700">
              <p className="font-medium">Signed in as</p>
              <p className="truncate">{currentUser.email}</p>
            </div>
            {/* ログアウトボタンは SidebarNav に移動済み */}
          </div>
        </div>
      )}
    </div>
  );
}