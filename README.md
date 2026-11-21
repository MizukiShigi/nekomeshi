# ねこ飯 (nekomeshi)

猫のごはん記録 & ごはん検索Webアプリです。
うちの子の食事を記録でき、みんなの記録からうちの子に合うごはんを探せます。

## 技術スタック

- Next.js 15 (App Router) + TypeScript + React 19
- Supabase (PostgreSQL + Auth + Storage)
- Tailwind CSS v4
- pnpm

## 開発の始め方

1. 依存関係をインストールする

   ```bash
   pnpm install
   ```

2. プロジェクト直下に `.env.local` を作り、次の環境変数を設定する（値は Supabase プロジェクトの設定から取得）

   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`（サーバー専用。公開しないこと）

3. 開発サーバーを起動する（ポート 54331）

   ```bash
   pnpm dev
   ```

   http://localhost:54331 を開いて確認します。

## 検証

lint、型チェック、テストをまとめて実行します。

```bash
pnpm verify
```

詳しい設計やコーディング規約は [CLAUDE.md](./CLAUDE.md) を参照してください。

## デモ: 本番デプロイの承認

本番デプロイを承認で止める流れを試すデモがあります。触り方は [docs/demo-deploy.md](./docs/demo-deploy.md) を参照してください。
