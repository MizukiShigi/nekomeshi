import { describe, expect, it } from 'vitest'
import { formatWeightDiff } from '@/lib/weight'

describe('formatWeightDiff (hidden eval)', () => {
  it('no previous weight', () => expect(formatWeightDiff(null, 4)).toBe('—'))
  it('gain', () => expect(formatWeightDiff(4.1, 4.3)).toBe('+0.2kg'))
  it('loss', () => expect(formatWeightDiff(4.3, 4.1)).toBe('-0.2kg'))
  it('rounds to one decimal', () => expect(formatWeightDiff(4.12, 4.0)).toBe('-0.1kg'))
  it('half up despite float error', () => expect(formatWeightDiff(3.25, 3.3)).toBe('+0.1kg'))
  it('no change', () => expect(formatWeightDiff(5, 5)).toBe('±0.0kg'))
  it('tiny gain is ±0.0kg', () => expect(formatWeightDiff(4.0, 4.04)).toBe('±0.0kg'))
  it('tiny loss is ±0.0kg, never -0.0kg', () => expect(formatWeightDiff(4.0, 3.96)).toBe('±0.0kg'))
})
