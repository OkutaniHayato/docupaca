# my-nextjs-firebase-app

Next.js + Firebase プロジェクト

## セットアップ状況

✅ ステップ1: プロジェクト基本設定 完了

## 次のステップ

### 1. 環境変数の設定

```bash
cp .env.local.example .env.local
# .env.local を編集してFirebase認証情報を設定
```

### 2. Firebase プロジェクトの初期化

```bash
firebase login
firebase init hosting
```

### 3. 開発サーバーの起動

```bash
npm run dev
```

### 4. CI/CDセットアップ（オプション）

```bash
cd ..
./setup-cicd.sh
```

### 5. チーム用ドキュメント作成（オプション）

```bash
cd ..
./setup-team-docs.sh
```

## CI/CD設定状況

✅ ステップ2: GitHub Actions CI/CD 完了

### 設定済みワークフロー

- **Development**: `develop` ブランチへのpushで自動デプロイ
- **Staging**: `staging` ブランチへのpushで自動デプロイ
- **Production**: `main` ブランチへのpushで自動デプロイ
- **Preview**: Pull Request作成時にプレビュー環境を自動生成

### 次のステップ

1. GitHubリポジトリを作成
2. GitHub Secretsを設定（詳細は後ほどドキュメント作成）
3. ブランチ保護ルールを設定


## チーム開発ドキュメント

✅ ステップ3: チーム開発用ドキュメント 完了

### 作成されたドキュメント

- **BRANCHING_STRATEGY.md**: ブランチ戦略とワークフロー
- **GITHUB_SECRETS_SETUP.md**: GitHub Secrets設定手順
- **docs/coding-rules/00-README.md**: コーディング規則

### 推奨される次のステップ

1. チームメンバーにドキュメントを共有
2. ブランチ保護ルールを設定
3. PRテンプレートを作成
4. 定期的なコードレビュー会を設定

## ⚠️ セキュリティルールについて

### 現在の状態：開発モード

開発中は `firestore.rules` と `storage.rules` がテストモード（全てのアクセスを許可）になっています。

**これは開発・テストを簡単にするためです。**

### 本番リリース前にやること

本番リリース前に、必ずセキュリティルールを厳格なものに変更してください。

1. `firestore.rules` と `storage.rules` のファイル内にコメントで本番用ルールの例があります
2. コメントを参考に、適切なルールに書き換えてください
3. デプロイ：
```bash
   firebase deploy --only firestore:rules,storage:rules
```

詳細は[Firebaseセキュリティルールのドキュメント](https://firebase.google.com/docs/firestore/security/get-started)を参照してください。