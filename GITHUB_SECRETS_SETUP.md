# GitHub Secrets 設定ガイド

CI/CDパイプラインを動作させるために、以下のSecretsをGitHubリポジトリに設定する必要があります。

## 設定場所

`Settings` → `Secrets and variables` → `Actions` → `New repository secret`

---

## 🔵 Development環境

| Secret名 | 取得方法 |
|----------|---------|
| `DEV_FIREBASE_API_KEY` | Firebase Console → プロジェクト設定 → 全般 |
| `DEV_FIREBASE_AUTH_DOMAIN` | Firebase Console → プロジェクト設定 → 全般 |
| `DEV_FIREBASE_PROJECT_ID` | Firebase Console → プロジェクト設定 → 全般 |
| `DEV_FIREBASE_STORAGE_BUCKET` | Firebase Console → プロジェクト設定 → 全般 |
| `DEV_FIREBASE_MESSAGING_SENDER_ID` | Firebase Console → プロジェクト設定 → 全般 |
| `DEV_FIREBASE_APP_ID` | Firebase Console → プロジェクト設定 → 全般 |
| `DEV_FIREBASE_CLIENT_EMAIL` | Firebase Console → プロジェクト設定 → サービスアカウント |
| `DEV_FIREBASE_PRIVATE_KEY` | Firebase Console → プロジェクト設定 → サービスアカウント → 新しい秘密鍵の生成 |
| `DEV_FIREBASE_SERVICE_ACCOUNT` | 上記で生成されたJSONファイルの内容全体 |

---

## 🟡 Staging環境

| Secret名 | 取得方法 |
|----------|---------|
| `STAGING_FIREBASE_API_KEY` | Stagingプロジェクトの Firebase Console → プロジェクト設定 → 全般 |
| `STAGING_FIREBASE_AUTH_DOMAIN` | 同上 |
| `STAGING_FIREBASE_PROJECT_ID` | 同上 |
| `STAGING_FIREBASE_STORAGE_BUCKET` | 同上 |
| `STAGING_FIREBASE_MESSAGING_SENDER_ID` | 同上 |
| `STAGING_FIREBASE_APP_ID` | 同上 |
| `STAGING_FIREBASE_CLIENT_EMAIL` | Stagingプロジェクトのサービスアカウント |
| `STAGING_FIREBASE_PRIVATE_KEY` | Stagingプロジェクトのサービスアカウント秘密鍵 |
| `STAGING_FIREBASE_SERVICE_ACCOUNT` | StagingプロジェクトのJSONファイル全体 |

---

## 🔴 Production環境

| Secret名 | 取得方法 |
|----------|---------|
| `PROD_FIREBASE_API_KEY` | ProductionプロジェクトのFirebase Console → プロジェクト設定 → 全般 |
| `PROD_FIREBASE_AUTH_DOMAIN` | 同上 |
| `PROD_FIREBASE_PROJECT_ID` | 同上 |
| `PROD_FIREBASE_STORAGE_BUCKET` | 同上 |
| `PROD_FIREBASE_MESSAGING_SENDER_ID` | 同上 |
| `PROD_FIREBASE_APP_ID` | 同上 |
| `PROD_FIREBASE_CLIENT_EMAIL` | Productionプロジェクトのサービスアカウント |
| `PROD_FIREBASE_PRIVATE_KEY` | Productionプロジェクトのサービスアカウント秘密鍵 |
| `PROD_FIREBASE_SERVICE_ACCOUNT` | ProductionプロジェクトのJSONファイル全体 |

---

## 📝 Service Account JSON の取得手順

1. [Firebase Console](https://console.firebase.google.com) を開く
2. プロジェクトを選択
3. ⚙️ プロジェクト設定 → サービスアカウント
4. 「新しい秘密鍵の生成」をクリック
5. ダウンロードされたJSONファイルを開く
6. **全内容をコピー**してGitHub Secretsに貼り付け

**注意**: JSONファイルは安全に保管し、Gitにコミットしないでください！

---

## 🔐 Private Key の形式

Private Key は以下の形式で設定してください：

```
-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...
（省略）
...
-----END PRIVATE KEY-----
```

改行は `\n` に変換されます（自動処理されます）。

---

## ✅ 設定確認

全てのSecretsを設定したら、以下の方法で確認できます：

1. GitHub Actions タブを開く
2. 任意のワークフローを手動実行
3. エラーなく完了すればOK

---

## 🚨 トラブルシューティング

### エラー: "Error: Unable to authenticate"

→ `FIREBASE_SERVICE_ACCOUNT` の内容を確認してください

### エラー: "Error: Invalid private key"

→ `FIREBASE_PRIVATE_KEY` の形式を確認してください（BEGIN/END含む）

### デプロイが失敗する

→ Firebase Hosting が有効化されているか確認してください

---

## 🎯 クイックスタート

まずは開発環境だけ設定して試す場合：

1. DEV_* で始まる9つのSecretsを設定
2. `develop` ブランチを作成
3. `develop` ブランチにpush
4. GitHub Actions タブで自動デプロイを確認

本番運用時にStaging/Productionの設定を追加してください。
