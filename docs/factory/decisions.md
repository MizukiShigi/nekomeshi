# ファクトリの判断と理由

作ったときに決めたことと、その理由と背景。見直すときは、ここにある「見直す条件」を先に確かめる

設計のもとにした調査（GitHub で回すファクトリ 53 例、検証の方法、失敗例）は別リポの調査メモにある。ここでは判断に効いたものだけを出典つきで書く

## 1. ランナーは手元で動かし、記録の正本は GitHub にする

- 決めたこと: `pnpm factory run` を、`gh` と `claude` にログインした端末で動かす。Issue、PR、コメント、ラベル、Actions の結果を正本にする
- 理由:
  - Actions だけで閉じるには、PR を作る名義と承認する名義を別にする必要がある。PR の作成者は自分の PR を承認できない
  - このリポにある App は承認用の `nekomeshi-review-bot` 1つだけ。新しい App を作るのは人間の作業
  - 手元のランナーは人間のアカウントで push するので、CI が普通に起動し、既存の Bot がそのまま承認できる。Actions 標準の `GITHUB_TOKEN` で push した場合は、次のワークフローが起動しない（[GitHub Docs](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow#triggering-a-workflow-from-a-workflow)）
- 見直す条件: 判定用とは別の App を作れば、同じランナーを Actions の定時実行で動かせる。ランナーは `gh` と `claude` を呼ぶだけなので、作り直しは要らない
- 背景: 実装のエージェントは本番の権限を持たないので、手元でも Actions でも渡すものは同じ。Stripe も実装エージェントを本番と実データから切り離している（[Minions Part 2](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2)）

## 2. 既存の PR Review Judge を残し、ファクトリの判定と二重にする

- 決めたこと: 自動マージには、PR Review Judge が `skip-human-review` を付けて Bot が承認し、さらにファクトリの判定も通ることを求める
- 理由:
  - PR Review Judge は人間が作った関門で、ファクトリ以外の PR にも効く。ファクトリの判定は修正ループの出口
  - どちらかが人間に回すと言えば人間に回る。片方の誤りで自動マージされない
- 影響: PR Review Judge の基準（[pr-tiers.md](../../.github/pr-review-judge/pr-tiers.md)）は「30 行を超えるロジック変更」「`src/components/**` のロジック変更」を人間に回す。コードの PR の多くは人間に回る。緩めるかは人間が決める
- 対応: PR Review Judge の critical path（何もマッチしない仮のパスだった）に、ファクトリの人間レビュー必須パスを入れた。2つのリストのずれは `factory/src/judge-sync.test.ts` が検出する

## 3. 自動マージは並走から始める

- 決めたこと: `merge.mode: shadow`。文書だけの PR はマージし、コードの PR はマージせずに `factory:merge-ok` を付けて人間を待つ
- 理由:
  - main へのマージは Vercel の本番デプロイになる
  - 調べた主要 7 例に、エージェントのコードを自動でマージする例はない。elastic の自動マージは依存更新の bot の PR だけ（[elastic/oblt-aw](https://github.com/elastic/oblt-aw)）
  - Anthropic は新しいレビュー役を、人間の承認を待つコメントから始め、自動承認した分を抜き取りで確かめる（[Anthropic](https://claude.com/blog/how-anthropic-secures-its-ai-native-software-development-lifecycle)）。Assembled は全件を人間の判定と突き合わせてから広げた（[Assembled](https://www.assembled.com/blog/code-review-bottlenecks-how-we-hill-climbed-our-way-to-higher-pr-throughput)）
  - 起動しないアプリの PR が自動マージされ、同じ日に revert した例がある（[dark-factory-experiment](https://github.com/coleam00/dark-factory-experiment/blob/HEAD/FACTORY.md)）
- 見直す条件: `pnpm factory metrics` の「並走」の行で、`factory:merge-ok` を付けた PR を人間が戻したり閉じたりしなくなったら `on` にする

## 4. レビューは観点を分け、別々の実行にする

- 決めたこと: 完了条件、セキュリティ、規約と設計の 3 観点。観点ごとに Claude Code を別に起動し、実装のときの会話は渡さない
- 理由:
  - 完了条件と規約は、Matt Pocock の code-review skill の Spec と Standards の 2 軸と同じ分け方。サブエージェントを分けて結果を混ぜない（[mattpocock/skills](https://github.com/mattpocock/skills)）
  - セキュリティは、Anthropic が観点を狭く切ったレビュー役と `/security-review` を使っている（[Anthropic](https://claude.com/blog/how-anthropic-secures-its-ai-native-software-development-lifecycle)、[claude-code-security-review](https://github.com/anthropics/claude-code-security-review)）
- 入れなかった観点: 性能、互換性、テストの質。互換性は、マイグレーションが必ず人間に回ることで見る。見逃しが出たら観点を足す（メルペイは見逃しを直した PR から観点を足している。[speakerdeck](https://speakerdeck.com/yuyaumetsu/xiu-zheng-prwoshi-heterehiyusukirukaxian-kunaru-claude-codeniyoruzi-ji-gai-shan-saikuru)）。観点を増やすと誤った指摘も増えるので、Cloudflare は差分の大きさで動かすレビュー役の数を変えている（[Cloudflare](https://blog.cloudflare.com/ai-code-review)）

## 5. 直させるのは critical と high だけ。証拠のない指摘と差分の外の指摘は数えない

- 理由:
  - medium と low まで直させると、好みの違いでループが回り続ける。astro はレビュー役と修正役が平行線になったら人に回して止める（[Cloudflare blog](https://blog.cloudflare.com/astro-issue-triage/)）
  - Anthropic はレビュー役に、指摘が正しいことの証明を書かせている
  - Cloudflare と Anthropic の code-review プラグインは、観点ごとに「指摘しないもの」を書いている
- 仕組み: レビューの出力は JSON（`--json-schema`）。`evidence` が空の high は数えない。差分に入っていないファイルへの指摘も数えない（`factory/src/decide.ts`）

## 6. 修正は 2 回まで

- 理由: Vercel eve の値（[Vercel](https://vercel.com/kb/guide/eve-software-factory)）。2 回で直らないものは、Issue が足りないか人間の判断が要るものとして扱う
- 超えたら `agent:blocked` を付けて止め、理由を残す

## 7. ループを続けるか、マージするかは AI ではなくランナーが決める

- 理由: AI に任せると、AI が「直した」と言えばループが終わる。決まった処理にしておくと、同じ入力から後で判断を確かめられる
- PR Review Judge の Claude による影響度の判定は人間が作ったものなので、そのまま残した。人間に回す方向にしか働かないことを、判定を二重にすること（2.）で担保する

## 8. Issue は手元で作り、Actions 側では質問も分割もしない

- 決めたこと: 手元で `/factory-issues`（質問して、縦に分けて、Issue にする）。ランナーの実装の AI は質問しない。足りなければ `agent:blocked` で止まる
- 理由:
  - Matt Pocock も質問と分割を手元の `/grill-me` と `/to-issues` で済ませる。sandcastle の実装のプロンプトには、質問して止まる手順がない（[mattpocock/sandcastle](https://github.com/mattpocock/sandcastle)）
  - Actions で質問させる形（Vercel eve）は、答えるまで止まり、答えた後にラベルを付け直す手間がかかる
  - 本番のログやデータを見る調査も、人間がいる手元なら本人の権限でできる。ファクトリには本番の権限を渡さない
- 変えたこと: Matt Pocock の `/to-issues` にある、分け方を人間に確かめる手順は外した。分け方は AI が決め、人間は異議があれば言う

## 9. 1 つの振る舞いごとに縦に分け、1 つの Issue から PR を 1 つ出す

- 理由:
  - 層ごとに分けると、途中の PR では動くかを確かめられず、完了条件のレビューも層の中のテストしか見られない
  - 観点別レビューと判定が、PR を 1 組の受け入れ条件と突き合わせられる
  - 同じ Issue に PR が二重にできるのを、ブランチ名（`factory/issue-<n>`）で防げる
- 大きい Issue は、手元で振る舞いごとの Issue に分け、`Blocked by` で順番をつなぐ。ランナーは `Blocked by` の Issue が閉じるまで拾わない

## 10. main が赤いときは着手しない。最初に main を緑にした

- 理由: 赤い main の上では、どの PR も検証が落ち、AI が関係ないエラーを直しにいく。dotnet/runtime では、指示ファイルと環境を整える前の成功率が 38%、整えた後が 69%（[.NET Blog](https://devblogs.microsoft.com/dotnet/ten-months-with-cca-in-dotnet-runtime/)）
- 対応: 型エラーと lint エラーが 1 件ずつ残っていたので、ファクトリを入れる前に人間の作業として直した（#20）。型エラーは、フード詳細の構造化データが旧プロパティ名を見ていて、評価が一度も出力されていなかった実際の不具合だった

## 11. public リポなので、付けた人と書いた人の権限を確かめる

- 決めたこと: `ready-for-agent` と `agent:fix` は、付けた人に書き込み権限があるときだけ拾う。書き込み権限のない人のコメントは、エージェントに渡さない
- 理由: Issue のタイトルや本文からエージェントに指示を入れ、秘密を持ち出させた事例がある（[PromptPwnd](https://www.aikido.dev/blog/promptpwnd-github-actions-ai-agents)、[Clinejection](https://adnanthekhan.com/posts/clinejection/)）

## 12. プロンプトと設定は main から読む

- 理由: PR の中で判定の規則やプロンプトを書き換えて通すのを防ぐ。elastic も承認の方針を PR ではなく base から読む
- 例外: `pnpm factory eval` は、改善を試すためにワークツリーのプロンプトを読む

## 13. エージェントに渡すツールを絞る

- 渡すもの: ファイルの読み書き、`pnpm verify`（とその一部）、git のコミットまで。`ls` や `grep` のような読むだけのコマンドは、Claude Code が初めから許している
- 渡さないもの: push、`gh`、ネットワーク、`.env`、依存の追加。設定は `--setting-sources project` と `--strict-mcp-config` で、ランナーを動かす人の個人の skill や MCP を読まない
- 理由: Meta の「Agents Rule of Two」は、信頼できない入力、機微なデータ、外への送信のうち 3 つがそろう作業を自律で動かさないとしている（[Meta](https://ai.meta.com/blog/practical-ai-agent-security/)）。このファクトリは機微なデータと外への送信を持たせない

## 14. eval は 2 種類

- 実装の eval: Issue と同じ形の課題を実装させ、AI には見せない隠しテストで合否を見る。タイムゾーンの不具合を隠さないよう、隠しテストは UTC で回す
- レビューの eval: 仕込んだ不具合（RLS を通らない admin クライアントへの差し替え）をセキュリティの観点が見つけるか、無害な変更（表記の変更）を指摘しないか
- 使い方: プロンプトや観点を変える PR では、変更前と変更後で `pnpm factory eval` を回して結果を貼る。詳しくは [evaluation.md](evaluation.md)

## 15. ふりかえりは PR にし、採否は人間が決める

- 決めたこと: `pnpm factory retro` が、実行記録と人間のコメントから、プロンプト・CLAUDE.md・eval の小さな変更を PR にする
- 理由: Warp はレビューの指摘からレビューの skill を直す外側のループを回している（[Warp](https://www.warp.dev/blog/software-factory-build-guide)）。`factory/**` は人間レビュー必須なので、ファクトリが自分の規則を勝手に緩めることはできない

## 16. モデルは Sonnet 5.5

- 理由: 小さな Issue なら十分で、Opus より速く安い。段階ごとに `factory/config.json` で変えられる
- 変えるときは eval で前後を比べる

## 17. ブランチ名でファクトリの PR を見分ける

- 決めたこと: ファクトリが作る PR のブランチは `factory/issue-<n>`、ふりかえりは `factory/retro-<日時>`。人間が手で出すファクトリの修正は `chore/` で始める
- 理由: 最初は `factory/` で始まるブランチをすべてファクトリの PR として数え、人間が出した修正 PR で上限に達して Issue を拾わなかった（#31、#32 で直した）

## 18. Claude の課金は API キーに固定し、設定に書く

- 決めたこと: `factory/config.json` の `auth.apiKeyEnv` が指す環境変数の API キーで課金する（既定は `ANTHROPIC_API_KEY`）。起動時に、キーがあることと、`claude auth status` の `apiKeySource` がそのキーになることを確かめ、満たさなければエージェントを動かす前に止める。実行記録に課金先を残す
- 理由: 環境に `ANTHROPIC_API_KEY` があると、Claude Code は claude.ai のログインよりキーを優先する。最初の夜の実行は、ランナーを起動したシェルの `~/.zshrc` にあったキーで課金されていて、文書の「ログイン済みの claude を使う」と食い違っていた。課金先がシェルしだいで変わらないようにする
- 実行記録の費用（Claude Code の `total_cost_usd`）は、API の定価で計算した見積もりなので、API キーでの課金と同じ物差しで比べられる
