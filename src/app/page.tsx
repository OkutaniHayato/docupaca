'use client';

import { useEffect, useState } from 'react';
import { db } from '@/config/firebase';
import { collection, getDocs } from 'firebase/firestore';

export default function Home() {
  const [status, setStatus] = useState('接続中...');

  useEffect(() => {
    const testConnection = async () => {
      try {
        // Firestoreに接続テスト
        const testCollection = collection(db, 'test');
        await getDocs(testCollection);
        setStatus('✅ Firebase接続成功！');
      } catch (error) {
        setStatus('❌ Firebase接続エラー: ' + error);
      }
    };

    testConnection();
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">Docupaca</h1>
        <p className="text-xl">{status}</p>
      </div>
    </div>
  );
}