import { FormulaError, isError, isMatrix, type Matrix, type Scalar, type Value } from './types.ts'

/**
 * Spreadsheet coercion rules.
 *
 *  - Empty cells are 0 in numeric context, "" in text context, FALSE in logic.
 *  - Booleans are 1/0 in numeric context.
 *  - Numeric-looking strings ("12", " 3.5 ", "50%", "$1,200") coerce to numbers;
 *    anything else raises #VALUE!.
 *  - Error values always propagate (thrown as FormulaError).
 */

const NUMERIC_STRING = /^\s*[-+]?(\$?)(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?([eE][-+]?\d+)?\s*(%?)\s*$/

export function parseNumericString(s: string): number | null {
  if (!NUMERIC_STRING.test(s)) return null
  let t = s.trim()
  let percent = false
  if (t.endsWith('%')) {
    percent = true
    t = t.slice(0, -1).trim()
  }
  let sign = 1
  if (t.startsWith('-')) {
    sign = -1
    t = t.slice(1)
  } else if (t.startsWith('+')) {
    t = t.slice(1)
  }
  if (t.startsWith('$')) t = t.slice(1)
  t = t.replace(/,/g, '')
  if (t === '' || t === '.') return null
  const n = Number(t)
  if (!Number.isFinite(n)) return null
  const v = sign * n
  return percent ? v / 100 : v
}

/** Take a single scalar out of a value; 1x1 matrices collapse, larger ones are #VALUE!. */
export function scalarOf(v: Value): Scalar {
  if (isMatrix(v)) {
    if (v.rows === 1 && v.cols === 1) return v.at(0, 0)
    throw new FormulaError('#VALUE!', 'Expected a single value but got a range')
  }
  return v
}

export function toNumber(v: Value): number {
  const s = scalarOf(v)
  if (typeof s === 'number') {
    return s
  }
  if (s === null) return 0
  if (typeof s === 'boolean') return s ? 1 : 0
  if (isError(s)) throw new FormulaError(s.code, s.message)
  const n = parseNumericString(s)
  if (n === null) throw new FormulaError('#VALUE!', `Cannot convert "${s}" to a number`)
  return n
}

export function toText(v: Value): string {
  const s = scalarOf(v)
  if (s === null) return ''
  if (typeof s === 'string') return s
  if (typeof s === 'number') return formatGeneralNumber(s)
  if (typeof s === 'boolean') return s ? 'TRUE' : 'FALSE'
  throw new FormulaError(s.code, s.message)
}

export function toBoolean(v: Value): boolean {
  const s = scalarOf(v)
  if (s === null) return false
  if (typeof s === 'boolean') return s
  if (typeof s === 'number') return s !== 0
  if (isError(s)) throw new FormulaError(s.code, s.message)
  const u = s.trim().toUpperCase()
  if (u === 'TRUE') return true
  if (u === 'FALSE') return false
  const n = parseNumericString(s)
  if (n !== null) return n !== 0
  throw new FormulaError('#VALUE!', `Cannot convert "${s}" to a boolean`)
}

/** Throw if the scalar is an error value. */
export function assertNotError(s: Scalar): void {
  if (isError(s)) throw new FormulaError(s.code, s.message)
}

/**
 * General number display: up to 10 significant digits, no trailing zeros,
 * exponent form for very large/small magnitudes.
 */
export function formatGeneralNumber(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n)
  const abs = Math.abs(n)
  if (abs !== 0 && (abs >= 1e15 || abs < 1e-9)) {
    return n.toExponential(6).replace(/\.?0+e/, 'e').replace('e+', 'E+').replace('e-', 'E-')
  }
  const s = n.toPrecision(10)
  const trimmed = s.includes('e') ? s : s.replace(/\.?0+$/, '')
  return trimmed === '-0' ? '0' : trimmed
}

/**
 * Comparison used by = <> < > <= >= and by sorting functions.
 * Type order (Excel): numbers < strings < booleans. Strings compare
 * case-insensitively. Empty cells act as 0 / "" / FALSE against their peer.
 */
export function compareScalars(a: Scalar, b: Scalar): number {
  assertNotError(a)
  assertNotError(b)
  if (a === null && b === null) return 0
  if (a === null) {
    // Empty behaves as 0 / "" / FALSE against its peer's type.
    if (typeof b === 'number') return b > 0 ? -1 : b < 0 ? 1 : 0
    if (typeof b === 'string') return b === '' ? 0 : -1
    if (typeof b === 'boolean') return b ? -1 : 0
    return 0
  }
  if (b === null) return -compareScalars(b, a)
  const ra = rank(a)
  const rb = rank(b)
  if (ra !== rb) return ra < rb ? -1 : 1
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0
  if (typeof a === 'string' && typeof b === 'string') {
    const la = a.toLowerCase()
    const lb = b.toLowerCase()
    return la < lb ? -1 : la > lb ? 1 : 0
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? 1 : -1
  return 0
}

function rank(s: Scalar): number {
  if (typeof s === 'number') return 0
  if (typeof s === 'string') return 1
  if (typeof s === 'boolean') return 2
  return 0
}

/** Iterate every scalar of a value (a scalar yields itself). */
export function* iterScalars(v: Value): Generator<Scalar> {
  if (isMatrix(v)) {
    for (let r = 0; r < v.rows; r++) for (let c = 0; c < v.cols; c++) yield v.at(r, c)
  } else {
    yield v
  }
}

/**
 * Collect numbers for aggregate functions (SUM, AVERAGE, ...). Inside ranges,
 * text and booleans are ignored; as direct scalar arguments they coerce.
 * Errors anywhere propagate.
 */
export function collectNumbers(args: Value[]): number[] {
  const out: number[] = []
  for (const a of args) {
    if (isMatrix(a)) {
      for (let r = 0; r < a.rows; r++) {
        for (let c = 0; c < a.cols; c++) {
          const s = a.at(r, c)
          if (typeof s === 'number') out.push(s)
          else if (isError(s)) throw new FormulaError(s.code, s.message)
        }
      }
    } else if (a !== null) {
      out.push(toNumber(a))
    }
  }
  return out
}

export function matrixOf(v: Value): Matrix {
  if (isMatrix(v)) return v
  return { kind: 'matrix', rows: 1, cols: 1, at: () => v }
}
