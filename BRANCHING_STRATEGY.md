# ブランチ戦略

## ブランチ構成

### メインブランチ

| ブランチ名 | 用途 | 保護設定 | デプロイ先 |
|-----------|------|----------|-----------|
| `main` | 本番環境 | レビュー必須（2人以上） | Production |
| `staging` | ステージング環境 | レビュー必須（1人以上） | Staging |
| `develop` | 開発環境 | レビュー必須（1人以上） | Development |

### 作業ブランチ

| ブランチ名 | 命名規則 | 派生元 | マージ先 |
|-----------|---------|--------|---------|
| Feature | `feature/機能名` | `develop` | `develop` |
| Bugfix | `bugfix/バグ名` | `develop` | `develop` |
| Hotfix | `hotfix/修正内容` | `main` | `main` と `develop` |

## ワークフロー

### 1. 新機能開発

```bash
# 1. developブランチを最新化
git checkout develop
git pull origin develop

# 2. featureブランチ作成
git checkout -b feature/new-awesome-feature

# 3. 開発・コミット
git add .
git commit -m "feat: 新機能を追加"

# 4. プッシュ
git push origin feature/new-awesome-feature

# 5. GitHub上でPR作成（develop <- feature/new-awesome-feature）
```

### 2. バグ修正

```bash
# 1. developブランチから派生
git checkout develop
git pull origin develop
git checkout -b bugfix/fix-login-error

# 2. 修正・コミット
git add .
git commit -m "fix: ログインエラーを修正"

# 3. プッシュ & PR
git push origin bugfix/fix-login-error
```

### 3. リリースフロー

```bash
# Development → Staging
git checkout staging
git pull origin staging
git merge develop
git push origin staging

# レビュー・QA後、問題なければ本番へ

# Staging → Production
git checkout main
git pull origin main
git merge staging
git push origin main
```

### 4. 緊急修正（Hotfix）

```bash
# 1. mainから派生
git checkout main
git pull origin main
git checkout -b hotfix/critical-security-fix

# 2. 修正・コミット
git add .
git commit -m "fix: セキュリティ脆弱性を修正"

# 3. mainにマージ
git checkout main
git merge hotfix/critical-security-fix
git push origin main

# 4. developにも反映
git checkout develop
git merge hotfix/critical-security-fix
git push origin develop

# 5. hotfixブランチ削除
git branch -d hotfix/critical-security-fix
```

## コミットメッセージ規約

Conventional Commitsに従います：

```
<type>: <description>

[optional body]

[optional footer]
```

### Type一覧

- `feat`: 新機能
- `fix`: バグ修正
- `docs`: ドキュメント変更
- `style`: コードスタイル変更（機能に影響なし）
- `refactor`: リファクタリング
- `perf`: パフォーマンス改善
- `test`: テスト追加・修正
- `chore`: ビルド・補助ツール変更

### 例

```bash
feat: ユーザー登録機能を追加
fix: ログイン時のエラーを修正
docs: READMEにセットアップ手順を追加
refactor: 認証ロジックをカスタムフックに分離
```

## Pull Request ルール

### PRテンプレート

```markdown
## 変更内容
- 

## 関連Issue
Closes #

## テスト方法
1. 
2. 

## チェックリスト
- [ ] ローカルでビルドが通る
- [ ] ESLintエラーなし
- [ ] テストを追加した
- [ ] ドキュメント更新した
```

### レビュー基準

- **Development**: 1人以上の承認
- **Staging**: 1人以上の承認 + QAチェック
- **Production**: 2人以上の承認 + QAチェック

## 注意事項

1. **developへの直接push禁止**: 必ずPRを経由する
2. **mainへの直接push禁止**: stagingからのマージのみ
3. **コンフリクト解決**: PRマージ前に必ず解決する
4. **レビュー待機時間**: 24時間以内にレビューする
