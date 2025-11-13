# デプロイ前の確認とビルド手順

## エラーの原因

`functions\lib\index.js does not exist` というエラーは、ローカル環境で TypeScript のビルドが完了していないことを示しています。

## 解決手順

### 1. functionsディレクトリに移動

```bash
cd functions
```

### 2. 依存関係がインストールされているか確認

```bash
npm install
```

### 3. TypeScriptをビルド

```bash
npm run build
```

成功すると以下のように表示されます：
```
> functions@1.0.0 build
> tsc
```

### 4. libディレクトリが生成されたか確認

Windowsの場合：
```bash
dir lib
```

Mac/Linuxの場合：
```bash
ls -la lib
```

以下のファイルが存在することを確認：
- `lib/index.js`
- `lib/index.js.map`

### 5. プロジェクトルートに戻る

```bash
cd ..
```

### 6. デプロイ実行

```bash
firebase deploy --only functions
```

## トラブルシューティング

### ビルドエラーが出る場合

TypeScriptのエラーを確認：
```bash
cd functions
npx tsc --noEmit
```

### node_modulesが破損している場合

```bash
cd functions
rm -rf node_modules package-lock.json
npm install
npm run build
```

### それでも解決しない場合

functionsディレクトリの構造を確認：
```bash
cd functions
dir /s
```

以下が存在することを確認：
- `src/index.ts`
- `package.json`
- `tsconfig.json`
- `node_modules/`
- `lib/index.js`（ビルド後）
