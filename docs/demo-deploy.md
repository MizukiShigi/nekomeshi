# デモ: 本番デプロイを承認で止める

`.github/workflows/demo-deploy.yaml` は、GitHub Environments の Required reviewers で本番デプロイを止める流れを試すためのデモです。実際のデプロイはせず、ログと Job Summary に結果を出すだけです。

## 流れ

1. `build`: コミット SHA と時刻を書いた `release.txt` を作り、artifact として保存する
2. `deploy-stg`（環境 `stg`、承認なし）: 同じ成果物を受け取り「stg にデプロイした」と出す
3. `deploy-production`（環境 `production`）: 承認されるまで待ち、承認後に同じ成果物を「本番にデプロイした」と出す

`production` 環境は、承認者を MizukiShigi に、デプロイできるブランチを `main` に限っています。

## 触り方

1. PR を main にマージする（Actions タブの「Demo deploy」から Run workflow で手動実行もできる。main 以外のブランチで実行すると、`production` はブランチ制限で拒否される）
2. Actions で「Demo deploy」の実行を開く。`deploy-production` が Waiting になっている
3. 「Review deployments」を押し、`production` にチェックを入れて「Approve and deploy」または「Reject」を選ぶ
4. Approve なら `deploy-production` が動き、Reject なら実行がそこで止まる
5. リポジトリの「Deployments」画面（`/deployments`）で、環境ごとのデプロイ履歴と承認の記録を見られる
