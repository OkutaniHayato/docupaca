"use client";

import React, { 
  createContext, 
  useContext, 
  useEffect, 
  useState, 
  ReactNode 
} from 'react';
import { User, onAuthStateChanged, signOut } from 'firebase/auth';
// config/firebase.ts から auth をインポート
import { auth } from '@/config/firebase'; 
import { useRouter } from 'next/navigation';

// Context が提供する値の型定義
interface AuthContextType {
  currentUser: User | null;
  loading: boolean;
  logout: () => Promise<void>;
}

// Context の作成 (デフォルト値は null)
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Context を使用するためのカスタムフック
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// AuthProvider コンポーネント
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true); // 認証状態の確認中
  const router = useRouter();

  // Firebase の認証状態の変化を監視
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setLoading(false);
    });

    // コンポーネントがアンマウントされる時に監視を解除
    return () => unsubscribe();
  }, []);

  // ログアウト処理
  const logout = async () => {
    try {
      await signOut(auth);
      // ログアウト後、ログインページにリダイレクト
      router.push('/login');
    } catch (error) {
      console.error("Logout Error:", error);
    }
  };

  const value = {
    currentUser,
    loading,
    logout,
  };

  // loading が true の間は何も表示しない（またはローディング画面を表示）
  // これにより、認証状態が確定するまで子コンポーネントを描画しない
  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};