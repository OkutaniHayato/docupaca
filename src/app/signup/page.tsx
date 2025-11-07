"use client";

import { useState, useEffect } from 'react'; // 
import { useRouter } from 'next/navigation';
import { createUserWithEmailAndPassword } from 'firebase/auth'; // 
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'; // 
import { auth, db } from '@/config/firebase'; // 
import { useAuth } from '@/context/AuthContext'; // 

/**
 * * (
 */
export default function SignUpPage() {
  // 
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // UI
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  
  const router = useRouter();
  const { currentUser, loading } = useAuth(); // 

  // 
  useEffect(() => {
    // 
    if (!loading && currentUser) {
      router.push('/dashboard');
    }
  }, [currentUser, loading, router]);

  /**
   * */
  const handleSignUp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    // 
    if (password !== confirmPassword) {
      setError("パスワードが一致しません。");
      return;
    }

    setIsLoading(true);

    try {
      // 1. Firebase Authentication 
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // 2. Firestore 'users'  [cite: 79-84]
      // 
      await setDoc(doc(db, "users", user.uid), {
        full_name: fullName, // 
        email: user.email,     // 
        created_at: serverTimestamp(), // 
      });

      // 
      router.push('/dashboard');

    } catch (err: unknown) { // 
      // Firebase 
      console.error("SignUp Error:", err);
      if (err instanceof Error) { // 
        setError(err.message || "登録に失敗しました。");
      } else {
        setError("不明なエラーが発生しました。");
      }
    } finally {
      setIsLoading(false);
    }
  };

  // 
  if (loading || currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-lg text-gray-600">
          読み込み中...
        </p>
      </div>
    );
  }

  return (
    // 
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      {/* */}
      <div className="w-full max-w-md space-y-8">
        <div>
          <h1 className="text-center text-3xl font-bold text-gray-900">
            ドキュパカ！
          </h1>
          {/* h2  (font-bold) */}
          <h2 className="mt-2 text-center text-xl font-bold text-gray-600">
            新規アカウント登録
          </h2>
        </div>

        {/* */}
        <form className="mt-8 space-y-6" onSubmit={handleSignUp}>
          <div className="space-y-4 rounded-md shadow-sm">

            {/* (DB users.full_name ) */}
            <div>
              <label htmlFor="full-name" className="sr-only">
                氏名
              </label>
              <input
                id="full-name"
                name="fullName"
                type="text"
                autoComplete="name"
                required
                //  [cite: 72-76]
                className="relative block w-full appearance-none rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 focus:z-10 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500 sm:text-sm"
                placeholder="氏名"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                disabled={isLoading}
              />
            </div>
            
            {/* */}
            <div>
              <label htmlFor="email-address" className="sr-only">
                メールアドレス
              </label>
              <input
                id="email-address"
                name="email"
                type="email"
                autoComplete="email"
                required
                //  [cite: 72-76]
                className="relative block w-full appearance-none rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 focus:z-10 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500 sm:text-sm"
                placeholder="メールアドレス"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
              />
            </div>

            {/* */}
            <div>
              <label htmlFor="password" className="sr-only">
                パスワード
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                //  [cite: 72-76]
                className="relative block w-full appearance-none rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 focus:z-10 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500 sm:text-sm"
                placeholder="パスワード"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
              />
            </div>

            {/* （） */}
            <div>
              <label htmlFor="confirm-password" className="sr-only">
                パスワード（確認用）
              </label>
              <input
                id="confirm-password"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                //  [cite: 72-76]
                className="relative block w-full appearance-none rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 focus:z-10 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500 sm:text-sm"
                placeholder="パスワード（確認用）"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={isLoading}
              />
            </div>

          </div>

          {/* */}
          {error && (
            // Error 
            <p className="text-center text-sm text-red-600">
              {error}
            </p>
          )}

          <div>
            {/* */}
            <button
              type="submit"
              //  [cite: 66-71]
              // Primary  (#166534)
              className="group relative flex w-full justify-center rounded-lg border border-transparent bg-green-800 py-2 px-4 text-sm font-semibold text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50"
              disabled={isLoading}
            >
              {isLoading ? '登録中...' : '登録する'}
            </button>
          </div>
        </form>

        {/* */}
        <p className="mt-2 text-center text-sm text-gray-600">
          すでにアカウントをお持ちですか？{' '}
          <a 
            href="/login" // 
            // Primary  (#166534)
            className="font-medium text-green-800 hover:text-green-700"
          >
            ログインはこちら
          </a>
        </p>
      </div>
    </div>
  );
}