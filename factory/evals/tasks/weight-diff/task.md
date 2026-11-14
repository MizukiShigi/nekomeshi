## What to build
猫の体重の変化を見せるため、前回の体重からの差を表示用の文字列にする関数を足す

`src/lib/weight.ts` に `formatWeightDiff(prevKg: number | null, currentKg: number): string` を作る

## Acceptance criteria
- [ ] 前回の体重がない（null）なら「—」
- [ ] 差を小数第1位に四捨五入し、符号を付けて返す（例: +0.2kg、-0.1kg）
- [ ] 四捨五入して0になるなら「±0.0kg」（「-0.0kg」にしない）
- [ ] 浮動小数の誤差で表示がずれない（3.25kg から 3.3kg は +0.1kg、4.1kg から 4.3kg は +0.2kg）
- [ ] Vitest のテストがある

## Out of scope
- 画面への組み込み

## Blocked by
None
