# コーディング規則

プロジェクトの品質を保つためのコーディング規則です。

## 📂 ディレクトリ構造

```
src/
├── app/                # Next.js App Router
│   ├── (auth)/        # 認証関連ページ
│   ├── (dashboard)/   # ダッシュボード
│   └── api/           # API Routes
├── components/        # Reactコンポーネント
│   ├── ui/           # 再利用可能なUIコンポーネント
│   └── features/     # 機能別コンポーネント
├── lib/              # ユーティリティ関数
├── hooks/            # カスタムフック
├── config/           # 設定ファイル
└── types/            # TypeScript型定義
```

## 🎨 命名規則

### ファイル名

- **コンポーネント**: PascalCase（例: `UserProfile.tsx`）
- **ユーティリティ**: camelCase（例: `formatDate.ts`）
- **フック**: camelCase + use prefix（例: `useAuth.ts`）

### 変数・関数名

- **変数**: camelCase（例: `userName`）
- **定数**: UPPER_SNAKE_CASE（例: `MAX_RETRY_COUNT`）
- **関数**: camelCase（例: `getUserData`）
- **コンポーネント**: PascalCase（例: `UserProfile`）

## 📝 TypeScript ルール

### 型定義

```typescript
// ✅ Good
interface User {
  id: string;
  name: string;
  email: string;
}

// ❌ Bad
const user: any = {...};
```

### 明示的な型注釈

```typescript
// ✅ Good
const fetchUser = async (id: string): Promise<User> => {
  // ...
};

// ❌ Bad
const fetchUser = async (id) => {
  // ...
};
```

## 🧩 コンポーネント設計

### 関数コンポーネント

```typescript
// ✅ Good
interface ButtonProps {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
}

export const Button: React.FC<ButtonProps> = ({ 
  label, 
  onClick, 
  variant = 'primary' 
}) => {
  return (
    <button onClick={onClick} className={variant}>
      {label}
    </button>
  );
};

// ❌ Bad
export const Button = (props: any) => {
  return <button>{props.label}</button>;
};
```

### カスタムフック

```typescript
// ✅ Good
export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  
  // ...
  
  return { user, loading, signIn, signOut };
};
```

## 🔥 Firebase ルール

### Firestoreアクセス

```typescript
// ✅ Good
import { db } from '@/config/firebase';
import { collection, getDocs } from 'firebase/firestore';

const fetchUsers = async () => {
  const usersRef = collection(db, 'users');
  const snapshot = await getDocs(usersRef);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

// ❌ Bad
const fetchUsers = async () => {
  const data = await db.collection('users').get();
  return data.docs;
};
```

## 📦 インポート順序

```typescript
// 1. React関連
import { useState, useEffect } from 'react';

// 2. 外部ライブラリ
import { collection, getDocs } from 'firebase/firestore';

// 3. 内部モジュール（絶対パス）
import { db } from '@/config/firebase';
import { Button } from '@/components/ui/Button';

// 4. 相対パス
import { formatDate } from '../utils/date';

// 5. 型定義
import type { User } from '@/types';
```

## 🧪 テスト

### ファイル配置

```
src/
├── components/
│   ├── Button.tsx
│   └── Button.test.tsx
```

### テストの書き方

```typescript
import { render, screen } from '@testing-library/react';
import { Button } from './Button';

describe('Button', () => {
  it('ラベルが表示される', () => {
    render(<Button label="Click me" onClick={() => {}} />);
    expect(screen.getByText('Click me')).toBeInTheDocument();
  });
});
```

## 📋 ESLint / Prettier

プロジェクトは自動フォーマット設定済みです：

```bash
# Lint チェック
npm run lint

# 自動修正
npm run lint:fix
```

## 🚫 禁止事項

1. **any型の使用**: 型安全性を失うため禁止
2. **console.log**: 本番コードに残さない
3. **直接的なDOM操作**: Reactの仕組みを使う
4. **グローバル変数**: モジュールスコープを使う
5. **ハードコード**: 環境変数や定数を使う

## ✅ チェックリスト

PR作成前に確認：

- [ ] TypeScript型エラーなし
- [ ] ESLint警告なし
- [ ] ビルドが通る
- [ ] テストが通る（あれば）
- [ ] 不要なconsole.logを削除
- [ ] コミットメッセージが規約に従っている
