## What to build
記録が「いつのものか」をひと目で分かるように、日時を経過日数の言葉に直す関数を足す

`src/lib/elapsed.ts` に `formatElapsedDays(from: Date | string, now: Date): string` を作る

## Acceptance criteria
- [ ] 日付の区切りは日本時間（Asia/Tokyo）で数える。実行環境のタイムゾーンに左右されない
- [ ] `from` が `now` と同じ日なら「今日」
- [ ] 1日前なら「昨日」
- [ ] 2〜6日前なら「N日前」（例: 3日前）
- [ ] 7〜29日前なら「N週間前」（日数を7で割って切り捨て。例: 13日前は1週間前）
- [ ] 30日以上前なら `src/lib/utils.ts` の `formatDate(from)` の結果
- [ ] `from` が `now` より後なら「今日」
- [ ] Vitest のテストがある

## Out of scope
- 画面への組み込み

## Blocked by
None
