import { describe, expect, it } from 'vitest'
import { expandSearchQuery } from './utils'

describe('expandSearchQuery', () => {
  it('半角カナを全角カナにする', () => {
    expect(expandSearchQuery('ﾛｲﾔﾙ')).toEqual(['ロイヤル'])
  })
  it('全角英数を半角英数にする', () => {
    expect(expandSearchQuery('ＣＩＡＯ')).toEqual(['CIAO'])
    expect(expandSearchQuery('ＡＢＣ１２３')).toEqual(['ABC123'])
  })
  it('ひらがなをカタカナにする', () => {
    expect(expandSearchQuery('ろいやる')).toEqual(['ロイヤル'])
  })
  it('全角・半角スペースで分割し前後の空白を無視する', () => {
    expect(expandSearchQuery('  ろいやる　ＣＩＡＯ cat 　')).toEqual([
      'ロイヤル',
      'CIAO',
      'cat',
    ])
  })
  it('空白のみは空配列', () => {
    expect(expandSearchQuery('  　 ')).toEqual([])
  })
})
