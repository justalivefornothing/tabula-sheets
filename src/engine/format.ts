import { formatGeneralNumber } from './coerce.ts'
import { formatDate } from './dates.ts'
import { isError, type CellFormat, type Scalar } from './types.ts'

/**
 * Number-format patterns, a pragmatic subset of the Excel mini-language:
 *   0        required digit        #        optional digit
 *   ,        thousands grouping    .        decimal point
 *   %        scale by 100          $ € £    literal currency
 *   "text"   literal               yyyy mm dd ...  date tokens (see dates.ts)
 * Sections separated by ';' are positive;negative;zero.
 */

interface NumericPattern {
  prefix: string
  suffix: string
  grouping: boolean
  minInt: number
  decimals: number
  percent: boolean
}

const DATE_TOKEN = /[ymd]/i

function isDatePattern(p: string): boolean {
  // Strip quoted literals first, then look for date letters with no digit placeholders.
  const stripped = p.replace(/"[^"]*"/g, '')
  return DATE_TOKEN.test(stripped) && !/[0#]/.test(stripped)
}

const patternCache = new Map<string, NumericPattern>()

function parseNumericPattern(section: string): NumericPattern {
  const cached = patternCache.get(section)
  if (cached) return cached
  let prefix = ''
  let suffix = ''
  let grouping = false
  let minInt = 0
  let decimals = 0
  let percent = false
  let seenDigits = false
  let inDecimals = false
  let i = 0
  while (i < section.length) {
    const ch = section[i]
    if (ch === '"') {
      const close = section.indexOf('"', i + 1)
      const end = close < 0 ? section.length : close
      const lit = section.slice(i + 1, end)
      if (seenDigits) suffix += lit
      else prefix += lit
      i = end + 1
      continue
    }
    if (ch === '0' || ch === '#') {
      seenDigits = true
      if (inDecimals) decimals++
      else if (ch === '0') minInt++
      i++
      continue
    }
    if (ch === ',') {
      if (seenDigits && !inDecimals) grouping = true
      i++
      continue
    }
    if (ch === '.') {
      if (seenDigits) inDecimals = true
      else {
        seenDigits = true
        inDecimals = true
      }
      i++
      continue
    }
    if (ch === '%') {
      percent = true
      if (seenDigits) suffix += '%'
      else prefix += '%'
      i++
      continue
    }
    if (ch === '\\') {
      const lit = section[i + 1] ?? ''
      if (seenDigits) suffix += lit
      else prefix += lit
      i += 2
      continue
    }
    if (ch === '_' || ch === '*') {
      i += 2
      continue
    }
    if (seenDigits) suffix += ch
    else prefix += ch
    i++
  }
  const result = { prefix, suffix, grouping, minInt, decimals, percent }
  patternCache.set(section, result)
  return result
}

function groupThousands(intPart: string): string {
  let out = ''
  for (let i = 0; i < intPart.length; i++) {
    const fromEnd = intPart.length - i
    out += intPart[i]
    if (fromEnd > 1 && (fromEnd - 1) % 3 === 0) out += ','
  }
  return out
}

function applyNumericPattern(n: number, pat: NumericPattern): string {
  let v = pat.percent ? n * 100 : n
  const negative = v < 0
  v = Math.abs(v)
  const fixed = v.toFixed(pat.decimals)
  let [intPart, frac] = fixed.split('.')
  if (intPart === '0' && pat.minInt === 0 && pat.decimals > 0) intPart = ''
  if (intPart.length < pat.minInt) intPart = intPart.padStart(pat.minInt, '0')
  if (pat.grouping) intPart = groupThousands(intPart)
  const body = frac !== undefined && pat.decimals > 0 ? `${intPart}.${frac}` : intPart
  return (negative ? '-' : '') + pat.prefix + body + pat.suffix
}

/** Format a number with an Excel-style pattern (used by TEXT and cell formats). */
export function formatNumber(n: number, pattern: string): string {
  const p = pattern.trim()
  if (p === '' || p.toLowerCase() === 'general') return formatGeneralNumber(n)
  if (isDatePattern(p)) return formatDate(n, p)
  const sections = p.split(';')
  let section = sections[0]
  let value = n
  if (n < 0 && sections.length > 1) {
    section = sections[1]
    value = -n
  } else if (n === 0 && sections.length > 2) {
    section = sections[2]
  }
  return applyNumericPattern(value, parseNumericPattern(section))
}

/** Pattern implied by a cell's format settings. */
export function patternForFormat(fmt: CellFormat | undefined): string | null {
  if (!fmt || !fmt.kind || fmt.kind === 'general' || fmt.kind === 'text') return null
  const dec = fmt.decimals ?? (fmt.kind === 'percent' ? 0 : 2)
  const frac = dec > 0 ? '.' + '0'.repeat(dec) : ''
  switch (fmt.kind) {
    case 'number':
      return `#,##0${frac}`
    case 'percent':
      return `0${frac}%`
    case 'currency':
      return `$#,##0${frac};-$#,##0${frac}`
    case 'date':
      return fmt.pattern ?? 'yyyy-mm-dd'
  }
}

/** Display text for a cell value given its format. */
export function displayValue(value: Scalar, fmt?: CellFormat): string {
  if (value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (isError(value)) return value.code
  const pattern = patternForFormat(fmt)
  if (pattern) return formatNumber(value, pattern)
  return formatGeneralNumber(value)
}
