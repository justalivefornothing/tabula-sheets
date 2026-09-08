import { compareScalars, parseNumericString, scalarOf, toNumber, toText } from '../coerce.ts'
import { FormulaError, isError, isMatrix, type Matrix, type Scalar, type Value } from '../types.ts'

export interface FnContext {
  now(): Date
}

export type FnCategory = 'math' | 'logic' | 'lookup' | 'text' | 'date' | 'stats' | 'info'

export interface FnDef {
  readonly name: string
  readonly category: FnCategory
  /** Human signature for docs / hints, e.g. "SUM(value1, [value2, ...])". */
  readonly signature: string
  readonly description: string
  readonly minArgs: number
  readonly maxArgs: number
  /** Volatile functions (TODAY, RAND) are recomputed on every recalculation. */
  readonly volatile?: boolean
  /** Eager implementation. */
  readonly fn?: (args: Value[], ctx: FnContext) => Value
  /** Lazy implementation receives thunks (IF, IFERROR, AND, OR ...). */
  readonly lazyFn?: (args: Array<() => Value>, ctx: FnContext) => Value
}

export function def(
  name: string,
  category: FnCategory,
  signature: string,
  description: string,
  minArgs: number,
  maxArgs: number,
  fn: (args: Value[], ctx: FnContext) => Value,
  volatile = false,
): FnDef {
  return volatile
    ? { name, category, signature, description, minArgs, maxArgs, fn, volatile }
    : { name, category, signature, description, minArgs, maxArgs, fn }
}

export function lazyDef(
  name: string,
  category: FnCategory,
  signature: string,
  description: string,
  minArgs: number,
  maxArgs: number,
  lazyFn: (args: Array<() => Value>, ctx: FnContext) => Value,
): FnDef {
  return { name, category, signature, description, minArgs, maxArgs, lazyFn }
}

export const err = (code: FormulaError['code'], message?: string): never => {
  throw new FormulaError(code, message)
}

/** Integer coercion with truncation toward zero (Excel semantics for indices). */
export function toInt(v: Value): number {
  return Math.trunc(toNumber(v))
}

/** Is the scalar "present" for COUNTA purposes? */
export function isPresent(s: Scalar): boolean {
  return s !== null && s !== ''
}

/** Flatten a value into a scalar list (row-major). */
export function flatten(v: Value): Scalar[] {
  if (!isMatrix(v)) return [v]
  const out: Scalar[] = []
  for (let r = 0; r < v.rows; r++) for (let c = 0; c < v.cols; c++) out.push(v.at(r, c))
  return out
}

export function flattenAll(args: Value[]): Scalar[] {
  const out: Scalar[] = []
  for (const a of args) for (const s of flatten(a)) out.push(s)
  return out
}

/** Numbers only, ignoring text/blank/boolean inside ranges; errors propagate. */
export function numbersIn(args: Value[]): number[] {
  const out: number[] = []
  for (const a of args) {
    if (isMatrix(a)) {
      for (let r = 0; r < a.rows; r++)
        for (let c = 0; c < a.cols; c++) {
          const s = a.at(r, c)
          if (typeof s === 'number') out.push(s)
          else if (isError(s)) throw new FormulaError(s.code, s.message)
        }
    } else if (a !== null) {
      out.push(toNumber(a))
    }
  }
  return out
}

/** Treat a scalar argument as a 1x1 matrix so range functions accept both. */
export function requireMatrix(v: Value): Matrix {
  if (isMatrix(v)) return v
  const s = scalarOf(v)
  if (isError(s)) throw new FormulaError(s.code, s.message)
  return { kind: 'matrix', rows: 1, cols: 1, at: () => s }
}

/** Case-insensitive equality with numeric awareness, used by exact lookups. */
export function looselyEqual(a: Scalar, b: Scalar): boolean {
  if (isError(a) || isError(b)) return false
  if (a === null) a = ''
  if (b === null) b = ''
  if (typeof a === typeof b) {
    if (typeof a === 'string') return a.toLowerCase() === (b as string).toLowerCase()
    return a === b
  }
  return false
}

/**
 * Build a predicate from a SUMIF/COUNTIF criterion:
 *   ">5" "<=3" "<>x" "=abc" plain values, and wildcards * ? in text.
 */
export function makeCriterion(crit: Value): (s: Scalar) => boolean {
  const c = scalarOf(crit)
  if (isError(c)) throw new FormulaError(c.code, c.message)
  if (typeof c === 'string') {
    const m = /^(<>|>=|<=|=|<|>)(.*)$/.exec(c)
    if (m) {
      const op = m[1]
      const rhsText = m[2]
      const rhsNum = parseNumericString(rhsText)
      const rhs: Scalar = rhsNum !== null ? rhsNum : rhsText
      if (op === '=' || op === '<>') {
        const eq = typeof rhs === 'string' ? wildcardMatcher(rhs) : (s: Scalar) => looselyEqual(s, rhs)
        if (op === '=') return (s) => (rhs === '' ? s === null || s === '' : eq(s))
        return (s) => (rhs === '' ? !(s === null || s === '') : !eq(s))
      }
      return (s) => {
        if (s === null || isError(s)) return false
        if (typeof rhs === 'number' && typeof s !== 'number') return false
        if (typeof rhs === 'string' && typeof s !== 'string') return false
        const cmp = compareScalars(s, rhs)
        switch (op) {
          case '>':
            return cmp > 0
          case '>=':
            return cmp >= 0
          case '<':
            return cmp < 0
          default:
            return cmp <= 0
        }
      }
    }
    const asNum = parseNumericString(c)
    if (asNum !== null) return (s) => (typeof s === 'number' ? s === asNum : typeof s === 'string' && parseNumericString(s) === asNum)
    return wildcardMatcher(c)
  }
  if (c === null) return (s) => s === null || s === ''
  return (s) => looselyEqual(s, c)
}

function wildcardMatcher(pattern: string): (s: Scalar) => boolean {
  if (!/[*?]/.test(pattern)) {
    const lower = pattern.toLowerCase()
    return (s) => typeof s === 'string' && s.toLowerCase() === lower
  }
  const re = new RegExp(
    '^' +
      pattern
        .split(/(\*|\?)/)
        .map((part) => (part === '*' ? '.*' : part === '?' ? '.' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
        .join('') +
      '$',
    'i',
  )
  return (s) => typeof s === 'string' && re.test(s)
}

export { toNumber, toText }
