"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext'; // 

/**
 * ルートページ (/)
 * 認証状態をチェックし、/login または /dashboard にリダイレクトする
 */
export default function RootPage() {
  const { currentUser, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // 
    if (loading) {
      return; // 
    }

    if (currentUser) {
      // 
      router.push('/dashboard');
    } else {
      // 
      router.push('/login');
    }
  }, [currentUser, loading, router]);

  // 
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <p className="text-lg text-gray-600">
        読み込み中...!!
      </p>
    </div>
  );
}