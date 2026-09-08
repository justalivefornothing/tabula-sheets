import { compareScalars, scalarOf, toBoolean } from '../coerce.ts'
import { FormulaError, isError, isMatrix, type Matrix, type Scalar, type Value } from '../types.ts'
import { def, err, looselyEqual, requireMatrix, toInt, type FnDef } from './helpers.ts'

function sameType(a: Scalar, b: Scalar): boolean {
  return typeof a === typeof b
}

/** Index of the largest entry <= key (ascending data), or -1. */
function approxAscending(key: Scalar, get: (i: number) => Scalar, n: number): number {
  let best = -1
  for (let i = 0; i < n; i++) {
    const v = get(i)
    if (v === null || isError(v) || !sameType(v, key)) continue
    const cmp = compareScalars(v, key)
    if (cmp <= 0) best = i
    else break
  }
  return best
}

/** Index of the smallest entry >= key (descending data), or -1. */
function approxDescending(key: Scalar, get: (i: number) => Scalar, n: number): number {
  let best = -1
  for (let i = 0; i < n; i++) {
    const v = get(i)
    if (v === null || isError(v) || !sameType(v, key)) continue
    const cmp = compareScalars(v, key)
    if (cmp >= 0) best = i
    else break
  }
  return best
}

function exactIndex(key: Scalar, get: (i: number) => Scalar, n: number): number {
  for (let i = 0; i < n; i++) if (looselyEqual(get(i), key)) return i
  return -1
}

function keyOf(v: Value): Scalar {
  const s = scalarOf(v)
  if (isError(s)) throw new FormulaError(s.code, s.message)
  return s
}

function subMatrix(m: Matrix, r0: number, c0: number, rows: number, cols: number): Matrix {
  return { kind: 'matrix', rows, cols, at: (r, c) => m.at(r0 + r, c0 + c) }
}

export const lookupFunctions: FnDef[] = [
  def(
    'VLOOKUP',
    'lookup',
    'VLOOKUP(key, table, column, [approximate])',
    'Finds key in the first column of table and returns the value from the given column.',
    3,
    4,
    (args) => {
      const key = keyOf(args[0])
      const table = requireMatrix(args[1])
      const col = toInt(args[2]) - 1
      const approx = args.length > 3 ? toBoolean(args[3]) : true
      if (col < 0 || col >= table.cols) return err('#REF!', 'VLOOKUP column is outside the table')
      const idx = approx
        ? approxAscending(key, (i) => table.at(i, 0), table.rows)
        : exactIndex(key, (i) => table.at(i, 0), table.rows)
      if (idx < 0) return err('#N/A', `VLOOKUP could not find ${String(key)}`)
      return table.at(idx, col)
    },
  ),
  def(
    'HLOOKUP',
    'lookup',
    'HLOOKUP(key, table, row, [approximate])',
    'Finds key in the first row of table and returns the value from the given row.',
    3,
    4,
    (args) => {
      const key = keyOf(args[0])
      const table = requireMatrix(args[1])
      const row = toInt(args[2]) - 1
      const approx = args.length > 3 ? toBoolean(args[3]) : true
      if (row < 0 || row >= table.rows) return err('#REF!', 'HLOOKUP row is outside the table')
      const idx = approx
        ? approxAscending(key, (i) => table.at(0, i), table.cols)
        : exactIndex(key, (i) => table.at(0, i), table.cols)
      if (idx < 0) return err('#N/A', `HLOOKUP could not find ${String(key)}`)
      return table.at(row, idx)
    },
  ),
  def('INDEX', 'lookup', 'INDEX(range, row, [column])', 'Returns the value at a row/column position in a range.', 2, 3, (args) => {
    const m = requireMatrix(args[0])
    let row = toInt(args[1])
    let col = args.length > 2 ? toInt(args[2]) : 0
    // A single-row or single-column range accepts one index.
    if (args.length === 2 && m.rows === 1 && m.cols > 1) {
      col = row
      row = 1
    }
    if (row === 0 && col === 0) return m
    if (row === 0) {
      if (col < 1 || col > m.cols) return err('#REF!')
      return subMatrix(m, 0, col - 1, m.rows, 1)
    }
    if (col === 0) {
      if (row < 1 || row > m.rows) return err('#REF!')
      if (m.cols === 1) return m.at(row - 1, 0)
      return subMatrix(m, row - 1, 0, 1, m.cols)
    }
    if (row < 1 || row > m.rows || col < 1 || col > m.cols) return err('#REF!', 'INDEX position is outside the range')
    return m.at(row - 1, col - 1)
  }),
  def('MATCH', 'lookup', 'MATCH(key, range, [type])', 'Position of key in a one-dimensional range (type 1, 0 or -1).', 2, 3, (args) => {
    const key = keyOf(args[0])
    const m = requireMatrix(args[1])
    const type = args.length > 2 ? toInt(args[2]) : 1
    if (m.rows !== 1 && m.cols !== 1) return err('#N/A', 'MATCH needs a single row or column')
    const n = m.rows === 1 ? m.cols : m.rows
    const get = m.rows === 1 ? (i: number) => m.at(0, i) : (i: number) => m.at(i, 0)
    const idx = type === 0 ? exactIndex(key, get, n) : type > 0 ? approxAscending(key, get, n) : approxDescending(key, get, n)
    if (idx < 0) return err('#N/A', `MATCH could not find ${String(key)}`)
    return idx + 1
  }),
  def(
    'XLOOKUP',
    'lookup',
    'XLOOKUP(key, lookup_range, return_range, [if_not_found])',
    'Exact-match lookup returning the parallel value from return_range.',
    3,
    4,
    (args) => {
      const key = keyOf(args[0])
      const lookup = requireMatrix(args[1])
      const ret = requireMatrix(args[2])
      const vertical = lookup.cols === 1
      const n = vertical ? lookup.rows : lookup.cols
      const get = vertical ? (i: number) => lookup.at(i, 0) : (i: number) => lookup.at(0, i)
      const idx = exactIndex(key, get, n)
      if (idx < 0) {
        if (args.length > 3) return args[3]
        return err('#N/A', `XLOOKUP could not find ${String(key)}`)
      }
      if (vertical) {
        if (ret.cols === 1) return ret.at(idx, 0)
        return subMatrix(ret, idx, 0, 1, ret.cols)
      }
      if (ret.rows === 1) return ret.at(0, idx)
      return subMatrix(ret, 0, idx, ret.rows, 1)
    },
  ),
  def('CHOOSE', 'lookup', 'CHOOSE(index, value1, [value2, ...])', 'Returns the value at the given 1-based index.', 2, Infinity, (args) => {
    const i = toInt(args[0])
    if (i < 1 || i >= args.length) return err('#VALUE!', 'CHOOSE index out of range')
    return args[i]
  }),
  def('ROWS', 'lookup', 'ROWS(range)', 'Number of rows in a range.', 1, 1, (args) => (isMatrix(args[0]) ? args[0].rows : 1)),
  def('COLUMNS', 'lookup', 'COLUMNS(range)', 'Number of columns in a range.', 1, 1, (args) => (isMatrix(args[0]) ? args[0].cols : 1)),
]
