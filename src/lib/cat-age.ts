export type CatAge = { years: number; months: number }

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

function parseYmd(s: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return [y, mo, d]
}

function toJstYmd(now: Date): [number, number, number] {
  const j = new Date(now.getTime() + JST_OFFSET_MS)
  return [j.getUTCFullYear(), j.getUTCMonth() + 1, j.getUTCDate()]
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

/**
 * 誕生日(YYYY-MM-DD)から満年齢・満月齢を求める。基準日は日本時間の今日。
 * 応当日が存在しない月(月末生まれ・うるう日生まれ)は、その月の末日を応当日とする。
 * 誕生日が不正・未来の場合は null。
 * `now` は Date か 'YYYY-MM-DD'(日本時間の日付)。
 */
export function getCatAge(birthday: string, now: Date | string = new Date()): CatAge | null {
  const b = parseYmd(birthday)
  const t = typeof now === 'string' ? parseYmd(now) : toJstYmd(now)
  if (!b || !t) return null
  const [by, bm, bd] = b
  const [ty, tm, td] = t

  let months = (ty - by) * 12 + (tm - bm)
  if (td < Math.min(bd, daysInMonth(ty, tm))) months -= 1
  if (months < 0) return null
  return { years: Math.floor(months / 12), months: months % 12 }
}

export function formatCatAge({ years, months }: CatAge): string {
  return years > 0 ? `${years}歳${months}か月` : `${months}か月`
}

/** 誕生日の表示文字列。「2024-08-01（2歳3か月）」。未登録・未来・不正な日付では年齢を付けない。 */
export function formatBirthday(birthday: string | null, now: Date | string = new Date()): string | null {
  if (!birthday) return null
  const age = getCatAge(birthday, now)
  return age ? `${birthday}（${formatCatAge(age)}）` : birthday
}
