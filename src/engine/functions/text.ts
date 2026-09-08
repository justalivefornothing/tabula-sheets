import { parseNumericString, scalarOf, toBoolean, toNumber, toText } from '../coerce.ts'
import { parseDateText } from '../dates.ts'
import { formatNumber } from '../format.ts'
import { FormulaError, isError, isMatrix, type Scalar, type Value } from '../types.ts'
import { def, err, flatten, toInt, type FnDef } from './helpers.ts'

/** Title-case: first letter of each alphabetic run upper, the rest lower. */
export function properCase(s: string): string {
  // Any letter that does not follow another letter starts a word (Excel semantics: "o'neil" -> "O'Neil").
  return s.toLowerCase().replace(/(^|[^\p{L}])(\p{Ll})/gu, (_m, pre: string, ch: string) => pre + ch.toUpperCase())
}

function textArgs(args: Value[]): string[] {
  const out: string[] = []
  for (const a of args) {
    if (isMatrix(a)) {
      for (const s of flatten(a)) out.push(toText(s))
    } else out.push(toText(a))
  }
  return out
}

function findIn(needle: string, hay: string, start: number, caseSensitive: boolean): number {
  if (start < 1 || start > hay.length + 1) return err('#VALUE!', 'Start position is out of range')
  const idx = caseSensitive
    ? hay.indexOf(needle, start - 1)
    : hay.toLowerCase().indexOf(needle.toLowerCase(), start - 1)
  if (idx < 0) return err('#VALUE!', `"${needle}" not found`)
  return idx + 1
}

function nthOccurrence(hay: string, needle: string, n: number, fromEnd: boolean): number {
  if (needle === '') return -1
  if (!fromEnd) {
    let idx = -1
    for (let i = 0; i < n; i++) {
      idx = hay.indexOf(needle, idx + 1)
      if (idx < 0) return -1
    }
    return idx
  }
  let idx = hay.length
  for (let i = 0; i < n; i++) {
    idx = hay.lastIndexOf(needle, idx - 1)
    if (idx < 0) return -1
  }
  return idx
}

export const textFunctions: FnDef[] = [
  def('CONCAT', 'text', 'CONCAT(text1, [text2, ...])', 'Joins values into one string.', 1, Infinity, (args) => textArgs(args).join('')),
  def('CONCATENATE', 'text', 'CONCATENATE(text1, [text2, ...])', 'Joins values into one string.', 1, Infinity, (args) => textArgs(args).join('')),
  def('TEXTJOIN', 'text', 'TEXTJOIN(delimiter, ignore_empty, text1, [text2, ...])', 'Joins values with a delimiter.', 3, Infinity, (args) => {
    const delim = toText(args[0])
    const ignoreEmpty = toBoolean(args[1])
    const parts = textArgs(args.slice(2))
    return (ignoreEmpty ? parts.filter((p) => p !== '') : parts).join(delim)
  }),
  def('LEFT', 'text', 'LEFT(text, [count])', 'Leading characters.', 1, 2, (args) => {
    const n = args.length > 1 ? toInt(args[1]) : 1
    if (n < 0) return err('#VALUE!')
    return toText(args[0]).slice(0, n)
  }),
  def('RIGHT', 'text', 'RIGHT(text, [count])', 'Trailing characters.', 1, 2, (args) => {
    const n = args.length > 1 ? toInt(args[1]) : 1
    if (n < 0) return err('#VALUE!')
    const s = toText(args[0])
    return n === 0 ? '' : s.slice(-n)
  }),
  def('MID', 'text', 'MID(text, start, count)', 'Characters from a 1-based start position.', 3, 3, (args) => {
    const s = toText(args[0])
    const start = toInt(args[1])
    const count = toInt(args[2])
    if (start < 1 || count < 0) return err('#VALUE!')
    return s.slice(start - 1, start - 1 + count)
  }),
  def('LEN', 'text', 'LEN(text)', 'Number of characters.', 1, 1, (args) => toText(args[0]).length),
  def('UPPER', 'text', 'UPPER(text)', 'Upper-case.', 1, 1, (args) => toText(args[0]).toUpperCase()),
  def('LOWER', 'text', 'LOWER(text)', 'Lower-case.', 1, 1, (args) => toText(args[0]).toLowerCase()),
  def('PROPER', 'text', 'PROPER(text)', 'Capitalises each word.', 1, 1, (args) => properCase(toText(args[0]))),
  def('TRIM', 'text', 'TRIM(text)', 'Removes extra spaces.', 1, 1, (args) => toText(args[0]).trim().replace(/\s+/g, ' ')),
  def('CLEAN', 'text', 'CLEAN(text)', 'Removes non-printable characters.', 1, 1, (args) => toText(args[0]).replace(/[\x00-\x1f\x7f]/g, '')),
  def('REPT', 'text', 'REPT(text, count)', 'Repeats text.', 2, 2, (args) => {
    const n = toInt(args[1])
    if (n < 0 || n > 10000) return err('#VALUE!')
    return toText(args[0]).repeat(n)
  }),
  def('EXACT', 'text', 'EXACT(text1, text2)', 'Case-sensitive equality.', 2, 2, (args) => toText(args[0]) === toText(args[1])),
  def('SUBSTITUTE', 'text', 'SUBSTITUTE(text, old, new, [occurrence])', 'Replaces text.', 3, 4, (args) => {
    const s = toText(args[0])
    const oldText = toText(args[1])
    const newText = toText(args[2])
    if (oldText === '') return s
    if (args.length > 3) {
      const n = toInt(args[3])
      if (n < 1) return err('#VALUE!')
      const idx = nthOccurrence(s, oldText, n, false)
      if (idx < 0) return s
      return s.slice(0, idx) + newText + s.slice(idx + oldText.length)
    }
    return s.split(oldText).join(newText)
  }),
  def('REPLACE', 'text', 'REPLACE(text, start, count, new_text)', 'Replaces characters by position.', 4, 4, (args) => {
    const s = toText(args[0])
    const start = toInt(args[1])
    const count = toInt(args[2])
    if (start < 1 || count < 0) return err('#VALUE!')
    return s.slice(0, start - 1) + toText(args[3]) + s.slice(start - 1 + count)
  }),
  def('FIND', 'text', 'FIND(search, text, [start])', 'Case-sensitive position of search in text.', 2, 3, (args) =>
    findIn(toText(args[0]), toText(args[1]), args.length > 2 ? toInt(args[2]) : 1, true),
  ),
  def('SEARCH', 'text', 'SEARCH(search, text, [start])', 'Case-insensitive position of search in text.', 2, 3, (args) =>
    findIn(toText(args[0]), toText(args[1]), args.length > 2 ? toInt(args[2]) : 1, false),
  ),
  def('TEXTBEFORE', 'text', 'TEXTBEFORE(text, delimiter, [instance])', 'Text before the nth delimiter (negative counts from the end).', 2, 3, (args) => {
    const s = toText(args[0])
    const d = toText(args[1])
    const n = args.length > 2 ? toInt(args[2]) : 1
    if (n === 0) return err('#VALUE!')
    const idx = nthOccurrence(s, d, Math.abs(n), n < 0)
    if (idx < 0) return err('#N/A', `Delimiter "${d}" not found`)
    return s.slice(0, idx)
  }),
  def('TEXTAFTER', 'text', 'TEXTAFTER(text, delimiter, [instance])', 'Text after the nth delimiter (negative counts from the end).', 2, 3, (args) => {
    const s = toText(args[0])
    const d = toText(args[1])
    const n = args.length > 2 ? toInt(args[2]) : 1
    if (n === 0) return err('#VALUE!')
    const idx = nthOccurrence(s, d, Math.abs(n), n < 0)
    if (idx < 0) return err('#N/A', `Delimiter "${d}" not found`)
    return s.slice(idx + d.length)
  }),
  def('TEXT', 'text', 'TEXT(value, format)', 'Formats a number with a pattern like "0.00", "#,##0", "0%", "yyyy-mm-dd".', 2, 2, (args) => {
    const v = scalarOf(args[0])
    if (isError(v)) throw new FormulaError(v.code, v.message)
    const pattern = toText(args[1])
    if (typeof v === 'string') {
      const n = parseNumericString(v)
      if (n === null) return v
      return formatNumber(n, pattern)
    }
    return formatNumber(toNumber(v), pattern)
  }),
  def('VALUE', 'text', 'VALUE(text)', 'Converts text to a number (also parses dates).', 1, 1, (args) => {
    const s = scalarOf(args[0])
    if (typeof s === 'number') return s
    if (typeof s === 'string') {
      const n = parseNumericString(s)
      if (n !== null) return n
      const d = parseDateText(s)
      if (d !== null) return d
      return err('#VALUE!', `Cannot convert "${s}" to a number`)
    }
    return toNumber(s)
  }),
  def('CHAR', 'text', 'CHAR(code)', 'Character for a code point.', 1, 1, (args) => {
    const n = toInt(args[0])
    if (n < 1 || n > 0x10ffff) return err('#VALUE!')
    return String.fromCodePoint(n)
  }),
  def('CODE', 'text', 'CODE(text)', 'Code point of the first character.', 1, 1, (args) => {
    const s = toText(args[0])
    if (s.length === 0) return err('#VALUE!')
    return s.codePointAt(0) ?? 0
  }),
  def('N', 'text', 'N(value)', 'Converts a value to a number (text becomes 0).', 1, 1, (args) => {
    const s = scalarOf(args[0])
    if (typeof s === 'number') return s
    if (typeof s === 'boolean') return s ? 1 : 0
    if (isError(s)) throw new FormulaError(s.code, s.message)
    return 0
  }),
  def('T', 'text', 'T(value)', 'Returns text values, empty for anything else.', 1, 1, (args) => {
    const s: Scalar = scalarOf(args[0])
    return typeof s === 'string' ? s : ''
  }),
]
