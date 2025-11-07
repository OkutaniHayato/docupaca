"use client";

import { useState, useEffect } from 'react'; 
import { useRouter } from 'next/navigation';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/config/firebase'; 
import { useAuth } from '@/context/AuthContext'; 

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null); 
  const [isLoading, setIsLoading] = useState(false); 
  const router = useRouter();
  const { currentUser, loading } = useAuth(); 

  // 
  useEffect(() => {
    // 
    if (!loading && currentUser) {
      router.push('/dashboard');
    }
  }, [currentUser, loading, router]);

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      await signInWithEmailAndPassword(auth, email, password);
      // 
      router.push('/dashboard');

    } catch (err: unknown) { 
      console.error("Login Error:", err);
      
      if (err instanceof Error && 'code' in err) {
        const firebaseError = err as { code: string }; 
        if (firebaseError.code === 'auth/invalid-credential') {
          setError("メールアドレスまたはパスワードが間違っています。");
        } else {
          setError("ログインに失敗しました。");
        }
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

  // 
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      {/* ---  --- */}
      <div className="w-full max-w-md space-y-8">
        <div>
          <h1 className="text-center text-3xl font-bold text-gray-900">
            ドキュパカ！
          </h1>
          <h2 className="mt-2 text-center text-lg font-semibold text-gray-600">
            ログイン
          </h2>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleLogin}>
          <div className="space-y-4 rounded-md shadow-sm">
            
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
                // 
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
                autoComplete="current-password"
                required
                // 
                className="relative block w-full appearance-none rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-500 focus:z-10 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500 sm:text-sm"
                placeholder="パスワード"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
              />
            </div>
          </div>

          {/* */}
          {error && (
            <p className="text-center text-sm text-red-600">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between">
            {/* */}
            <div className="text-sm">
              <a 
                href="#" 
                // 
                className="font-medium text-green-800 hover:text-green-700"
              >
                パスワードを忘れた場合
              </a>
            </div>
          </div>

          <div>
            {/* */}
            <button
              type="submit"
              // 
              // 
              className="group relative flex w-full justify-center rounded-lg border border-transparent bg-green-800 py-2 px-4 text-sm font-semibold text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50"
              disabled={isLoading}
            >
              {isLoading ? 'ログイン中...' : 'ログイン'}
            </button>
          </div>
        </form>

        {/* */}
        <p className="mt-2 text-center text-sm text-gray-600">
          アカウントをお持ちでないですか？{' '}
          <a 
            href="/signup" // 
            // 
            className="font-medium text-green-800 hover:text-green-700"
          >
            新規登録はこちら
          </a>
        </p>
      </div>
    </div>
  );
}