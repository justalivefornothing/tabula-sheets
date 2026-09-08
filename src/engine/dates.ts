/**
 * Serial dates: days since 1899-12-30, so serial 1 = 1900-01-01 and
 * 2024-03-04 = 45355 — the same numbering Excel and Sheets use (minus the
 * fictional 1900-02-29, which we deliberately do not reproduce).
 */

const MS_PER_DAY = 86_400_000
const EPOCH_MS = Date.UTC(1899, 11, 30)

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export interface YMD {
  year: number
  month: number // 1-12
  day: number // 1-31
}

/** Build a serial from y/m/d with Excel-style overflow (month 13 -> next year). */
export function dateToSerial(year: number, month: number, day: number): number {
  const ms = Date.UTC(year, month - 1, day)
  return Math.round((ms - EPOCH_MS) / MS_PER_DAY)
}

export function serialToYMD(serial: number): YMD {
  const d = new Date(EPOCH_MS + Math.floor(serial) * MS_PER_DAY)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

export function serialToDate(serial: number): Date {
  return new Date(EPOCH_MS + serial * MS_PER_DAY)
}

export function todaySerial(now: Date = new Date()): number {
  return dateToSerial(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

/** Day of week: 0 = Sunday. */
export function serialWeekday(serial: number): number {
  return serialToDate(serial).getUTCDay()
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/** Add months, clamping the day to the target month's length (EDATE semantics). */
export function addMonths(serial: number, months: number): number {
  const { year, month, day } = serialToYMD(serial)
  const total = year * 12 + (month - 1) + months
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  const nd = Math.min(day, daysInMonth(ny, nm))
  return dateToSerial(ny, nm, nd)
}

/**
 * Format a serial date with a pattern using tokens
 *   yyyy yy | mmmm mmm mm m | dddd ddd dd d
 * Any other character is emitted literally.
 */
export function formatDate(serial: number, pattern: string): string {
  const { year, month, day } = serialToYMD(serial)
  const weekday = serialWeekday(serial)
  let out = ''
  let i = 0
  const p = pattern
  while (i < p.length) {
    const ch = p[i].toLowerCase()
    if (ch === 'y' || ch === 'm' || ch === 'd') {
      let j = i
      while (j < p.length && p[j].toLowerCase() === ch) j++
      const run = j - i
      if (ch === 'y') out += run >= 4 ? String(year).padStart(4, '0') : String(year % 100).padStart(2, '0')
      else if (ch === 'm') {
        if (run >= 4) out += MONTH_NAMES[month - 1]
        else if (run === 3) out += MONTH_NAMES[month - 1].slice(0, 3)
        else if (run === 2) out += String(month).padStart(2, '0')
        else out += String(month)
      } else {
        if (run >= 4) out += DAY_NAMES[weekday]
        else if (run === 3) out += DAY_NAMES[weekday].slice(0, 3)
        else if (run === 2) out += String(day).padStart(2, '0')
        else out += String(day)
      }
      i = j
      continue
    }
    if (ch === '"') {
      const close = p.indexOf('"', i + 1)
      const end = close < 0 ? p.length : close
      out += p.slice(i + 1, end)
      i = end + 1
      continue
    }
    out += p[i]
    i++
  }
  return out
}

/** Recognised text date shapes, tried in order. Returns null when no shape matches. */
export function parseDateText(text: string): number | null {
  const t = text.trim()
  let m: RegExpExecArray | null
  // ISO yyyy-mm-dd or yyyy/mm/dd
  m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t)
  if (m) return validYMD(+m[1], +m[2], +m[3])
  // US mm/dd/yyyy
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t)
  if (m) return validYMD(+m[3], +m[1], +m[2])
  // "March 4, 2024" / "Mar 4 2024"
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(t)
  if (m) {
    const mo = monthFromName(m[1])
    return mo ? validYMD(+m[3], mo, +m[2]) : null
  }
  // "4 March 2024" / "4-Mar-2024"
  m = /^(\d{1,2})[\s-]([A-Za-z]{3,9})\.?[\s-,]+(\d{4})$/.exec(t)
  if (m) {
    const mo = monthFromName(m[2])
    return mo ? validYMD(+m[3], mo, +m[1]) : null
  }
  return null
}

export function monthFromName(name: string): number | null {
  const lower = name.toLowerCase()
  for (let i = 0; i < 12; i++) {
    const full = MONTH_NAMES[i].toLowerCase()
    if (full === lower || full.slice(0, 3) === lower) return i + 1
  }
  return null
}

function validYMD(y: number, m: number, d: number): number | null {
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null
  return dateToSerial(y, m, d)
}
