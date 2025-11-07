"use client";

import { ReactNode, useEffect } from 'react';
import { useRouter } from 'next/navigation';
// AuthContext.tsx から useAuth をインポート
import { useAuth } from '@/context/AuthContext'; 

/**
 * 認証ガードコンポーネント
 * currentUser が null (未ログイン) の場合、/login にリダイレクトする
 */
export const AuthGuard = ({ children }: { children: ReactNode }) => {
  const { currentUser, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // 認証状態の読み込みが完了し (loading: false)、
    // かつ currentUser が null (未ログイン) だったら
    if (!loading && !currentUser) {
      router.push('/login');
    }
  }, [currentUser, loading, router]);

  // 読み込み中、またはログイン済みの場合は、子コンポーネントを表示
  // (未ログインの場合はリダイレクトが実行されるまでの間だけ表示される)
  if (loading || !currentUser) {
    // TODO: ここでローディングスピナーなどを表示しても良い
    return <p>Loading...</p>; // 仮のローディング表示
  }

  // ログイン済み
  return <>{children}</>;
};