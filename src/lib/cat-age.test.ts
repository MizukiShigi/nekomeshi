import { describe, expect, it } from 'vitest'
import { formatCatAge, getCatAge } from './cat-age'

const at = (iso: string) => new Date(iso)

describe('getCatAge', () => {
  it('満年齢と満月齢を数える', () => {
    expect(getCatAge('2024-08-01', '2026-11-15')).toEqual({ years: 2, months: 3 })
  })
  it('誕生日の前日まではまだ前の月齢', () => {
    expect(getCatAge('2024-08-16', '2026-11-15')).toEqual({ years: 2, months: 2 })
    expect(getCatAge('2024-08-15', '2026-11-15')).toEqual({ years: 2, months: 3 })
  })
  it('誕生日の前日まではまだ前の年齢', () => {
    expect(getCatAge('2024-11-16', '2026-11-15')).toEqual({ years: 1, months: 11 })
    expect(getCatAge('2024-11-15', '2026-11-15')).toEqual({ years: 2, months: 0 })
  })
  it('生まれた月のうちは0か月', () => {
    expect(getCatAge('2026-11-01', '2026-11-15')).toEqual({ years: 0, months: 0 })
  })
  it('月末生まれは短い月では月末日を応当日とする', () => {
    expect(getCatAge('2026-01-31', '2026-02-27')).toEqual({ years: 0, months: 0 })
    expect(getCatAge('2026-01-31', '2026-02-28')).toEqual({ years: 0, months: 1 })
    expect(getCatAge('2026-01-31', '2026-03-30')).toEqual({ years: 0, months: 1 })
    expect(getCatAge('2026-01-31', '2026-03-31')).toEqual({ years: 0, months: 2 })
  })
  it('うるう日生まれは平年では2/28を応当日とする', () => {
    expect(getCatAge('2024-02-29', '2025-02-27')).toEqual({ years: 0, months: 11 })
    expect(getCatAge('2024-02-29', '2025-02-28')).toEqual({ years: 1, months: 0 })
    expect(getCatAge('2024-02-29', '2028-02-29')).toEqual({ years: 4, months: 0 })
  })
  it('未来の日付・不正な値は null', () => {
    expect(getCatAge('2026-11-16', '2026-11-15')).toBeNull()
    expect(getCatAge('abc', '2026-11-15')).toBeNull()
    expect(getCatAge('2026-02-30', '2026-11-15')).toBeNull()
  })
  it('now の Date は日本時間の日付で判定する', () => {
    // UTC 2026-11-14 16:00 = JST 2026-11-15 01:00
    expect(getCatAge('2026-11-15', at('2026-11-14T16:00:00Z'))).toEqual({ years: 0, months: 0 })
    expect(getCatAge('2026-11-15', at('2026-11-14T14:00:00Z'))).toBeNull()
  })
})

describe('formatCatAge', () => {
  it('表示形式', () => {
    expect(formatCatAge({ years: 2, months: 3 })).toBe('2歳3か月')
    expect(formatCatAge({ years: 0, months: 5 })).toBe('5か月')
    expect(formatCatAge({ years: 0, months: 0 })).toBe('0か月')
    expect(formatCatAge({ years: 1, months: 0 })).toBe('1歳0か月')
  })
})
