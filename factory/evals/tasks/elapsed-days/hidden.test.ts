import { describe, expect, it } from 'vitest'
import { formatElapsedDays } from '@/lib/elapsed'
import { formatDate } from '@/lib/utils'

const now = new Date('2026-11-15T00:30:00+09:00')

describe('formatElapsedDays (hidden eval)', () => {
  it('same JST day is 今日', () => expect(formatElapsedDays('2026-11-15T00:05:00+09:00', now)).toBe('今日'))
  it('crossing JST midnight is 昨日 even when UTC says same day', () =>
    expect(formatElapsedDays('2026-11-14T23:50:00+09:00', now)).toBe('昨日'))
  it('accepts a Date', () => expect(formatElapsedDays(new Date('2026-11-14T10:00:00+09:00'), now)).toBe('昨日'))
  it('3 days', () => expect(formatElapsedDays('2026-11-12T12:00:00+09:00', now)).toBe('3日前'))
  it('6 days', () => expect(formatElapsedDays('2026-11-09T12:00:00+09:00', now)).toBe('6日前'))
  it('13 days is 1週間前', () => expect(formatElapsedDays('2026-11-02T12:00:00+09:00', now)).toBe('1週間前'))
  it('29 days is 4週間前', () => expect(formatElapsedDays('2026-10-17T12:00:00+09:00', now)).toBe('4週間前'))
  it('30 days falls back to formatDate', () =>
    expect(formatElapsedDays('2026-10-16T12:00:00+09:00', now)).toBe(formatDate('2026-10-16T12:00:00+09:00')))
  it('future is 今日', () => expect(formatElapsedDays('2026-11-16T10:00:00+09:00', now)).toBe('今日'))
})
