import { describe, expect, it } from 'vitest'
import { reviewRows } from './retro.ts'

describe('reviewRows', () => {
  it('keeps the perspective and every severity from a review comment', () => {
    const body = [
      '<!-- factory-review -->',
      '#### acceptance',
      '',
      '| 重大度 | 場所 | 指摘 |',
      '|---|---|---|',
      '| medium | `README.md:27` | `pnpm dev` は実際にはポート 54331 で起動しない |',
      '#### security',
      '指摘なし',
    ].join('\n')
    expect(reviewRows(26, body)).toEqual(['PR #26 [acceptance] medium README.md:27: `pnpm dev` は実際にはポート 54331 で起動しない'])
  })
})
