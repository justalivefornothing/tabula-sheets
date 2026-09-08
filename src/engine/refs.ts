import type { CellCoord, CellRef, RangeRef, Rect } from './types.ts'

/** Sheet dimensions. Keys pack (row, col) into one integer, so cols < 2^10. */
export const MAX_ROWS = 100_000
export const MAX_COLS = 52
const COL_BITS = 10
const COL_MASK = (1 << COL_BITS) - 1

export function cellKey(row: number, col: number): number {
  return (row << COL_BITS) | col
}

export function keyRow(key: number): number {
  return key >> COL_BITS
}

export function keyCol(key: number): number {
  return key & COL_MASK
}

export function keyToCoord(key: number): CellCoord {
  return { row: keyRow(key), col: keyCol(key) }
}

/** 0 -> "A", 25 -> "Z", 26 -> "AA". */
export function colToLetters(col: number): string {
  let s = ''
  let n = col + 1
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** "A" -> 0, "Z" -> 25, "AA" -> 26. Case-insensitive. Returns -1 if invalid. */
export function lettersToCol(letters: string): number {
  if (letters.length === 0 || letters.length > 3) return -1
  let n = 0
  for (let i = 0; i < letters.length; i++) {
    const ch = letters.charCodeAt(i) & ~0x20 // uppercase
    if (ch < 65 || ch > 90) return -1
    n = n * 26 + (ch - 64)
  }
  return n - 1
}

export function coordToA1(row: number, col: number): string {
  return colToLetters(col) + String(row + 1)
}

export function refToA1(ref: CellRef): string {
  return (ref.absCol ? '$' : '') + colToLetters(ref.col) + (ref.absRow ? '$' : '') + String(ref.row + 1)
}

export function rangeToA1(range: RangeRef): string {
  if (range.wholeCol) {
    const a = (range.start.absCol ? '$' : '') + colToLetters(range.start.col)
    const b = (range.end.absCol ? '$' : '') + colToLetters(range.end.col)
    return `${a}:${b}`
  }
  if (range.wholeRow) {
    const a = (range.start.absRow ? '$' : '') + String(range.start.row + 1)
    const b = (range.end.absRow ? '$' : '') + String(range.end.row + 1)
    return `${a}:${b}`
  }
  return `${refToA1(range.start)}:${refToA1(range.end)}`
}

const CELL_RE = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})$/

/** Parse "A1", "$A$1", "A$1", "$A1". Returns null when not a cell reference. */
export function parseCellRef(text: string): CellRef | null {
  const m = CELL_RE.exec(text)
  if (!m) return null
  const col = lettersToCol(m[2])
  const row = parseInt(m[4], 10) - 1
  if (col < 0 || row < 0) return null
  return { row, col, absRow: m[3] === '$', absCol: m[1] === '$' }
}

/** Parse "A1", "A1:B3", "A:A", "2:2". */
export function parseRangeOrCell(text: string): CellRef | RangeRef | null {
  const t = text.trim()
  const colon = t.indexOf(':')
  if (colon < 0) return parseCellRef(t)
  const a = t.slice(0, colon)
  const b = t.slice(colon + 1)
  const ca = parseCellRef(a)
  const cb = parseCellRef(b)
  if (ca && cb) return normaliseRange(ca, cb)
  const colRe = /^(\$?)([A-Za-z]{1,3})$/
  const ma = colRe.exec(a)
  const mb = colRe.exec(b)
  if (ma && mb) {
    const c0 = lettersToCol(ma[2])
    const c1 = lettersToCol(mb[2])
    if (c0 < 0 || c1 < 0) return null
    return wholeColumnRange(c0, c1, ma[1] === '$', mb[1] === '$')
  }
  const rowRe = /^(\$?)(\d{1,7})$/
  const ra = rowRe.exec(a)
  const rb = rowRe.exec(b)
  if (ra && rb) {
    return wholeRowRange(parseInt(ra[2], 10) - 1, parseInt(rb[2], 10) - 1, ra[1] === '$', rb[1] === '$')
  }
  return null
}

export function wholeColumnRange(c0: number, c1: number, abs0 = false, abs1 = false): RangeRef {
  const lo = Math.min(c0, c1)
  const hi = Math.max(c0, c1)
  return {
    start: { row: 0, col: lo, absRow: true, absCol: lo === c0 ? abs0 : abs1 },
    end: { row: MAX_ROWS - 1, col: hi, absRow: true, absCol: hi === c1 ? abs1 : abs0 },
    wholeCol: true,
    wholeRow: false,
  }
}

export function wholeRowRange(r0: number, r1: number, abs0 = false, abs1 = false): RangeRef {
  const lo = Math.min(r0, r1)
  const hi = Math.max(r0, r1)
  return {
    start: { row: lo, col: 0, absRow: lo === r0 ? abs0 : abs1, absCol: true },
    end: { row: hi, col: MAX_COLS - 1, absRow: hi === r1 ? abs1 : abs0, absCol: true },
    wholeCol: false,
    wholeRow: true,
  }
}

/** Build a range whose start is the top-left corner regardless of input order. */
export function normaliseRange(a: CellRef, b: CellRef): RangeRef {
  const r0 = Math.min(a.row, b.row)
  const r1 = Math.max(a.row, b.row)
  const c0 = Math.min(a.col, b.col)
  const c1 = Math.max(a.col, b.col)
  const startRowAbs = a.row <= b.row ? a.absRow : b.absRow
  const endRowAbs = a.row <= b.row ? b.absRow : a.absRow
  const startColAbs = a.col <= b.col ? a.absCol : b.absCol
  const endColAbs = a.col <= b.col ? b.absCol : a.absCol
  return {
    start: { row: r0, col: c0, absRow: startRowAbs, absCol: startColAbs },
    end: { row: r1, col: c1, absRow: endRowAbs, absCol: endColAbs },
    wholeCol: false,
    wholeRow: false,
  }
}

export function isRangeRef(x: CellRef | RangeRef): x is RangeRef {
  return 'start' in x
}

export function rangeRect(range: RangeRef): Rect {
  return { r0: range.start.row, c0: range.start.col, r1: range.end.row, c1: range.end.col }
}

export function rectContains(rect: Rect, row: number, col: number): boolean {
  return row >= rect.r0 && row <= rect.r1 && col >= rect.c0 && col <= rect.c1
}

export function rectFromCoords(a: CellCoord, b: CellCoord): Rect {
  return {
    r0: Math.min(a.row, b.row),
    c0: Math.min(a.col, b.col),
    r1: Math.max(a.row, b.row),
    c1: Math.max(a.col, b.col),
  }
}

export function rectToA1(rect: Rect): string {
  if (rect.r0 === rect.r1 && rect.c0 === rect.c1) return coordToA1(rect.r0, rect.c0)
  if (rect.r0 === 0 && rect.r1 >= MAX_ROWS - 1) return `${colToLetters(rect.c0)}:${colToLetters(rect.c1)}`
  if (rect.c0 === 0 && rect.c1 >= MAX_COLS - 1) return `${rect.r0 + 1}:${rect.r1 + 1}`
  return `${coordToA1(rect.r0, rect.c0)}:${coordToA1(rect.r1, rect.c1)}`
}

export function rectCellCount(rect: Rect): number {
  return (rect.r1 - rect.r0 + 1) * (rect.c1 - rect.c0 + 1)
}
