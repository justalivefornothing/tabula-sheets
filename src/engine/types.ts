/**
 * Core value types for the Tabula formula engine.
 *
 * The engine is dependency-free and DOM-free: every module under src/engine/
 * imports only its siblings, so the whole thing runs (and is tested) in Node.
 */

export type ErrorCode =
  | '#DIV/0!'
  | '#REF!'
  | '#NAME?'
  | '#VALUE!'
  | '#N/A'
  | '#NUM!'
  | '#CYCLE!'
  | '#ERROR!'

export interface ErrorValue {
  readonly kind: 'error'
  readonly code: ErrorCode
  readonly message?: string
}

/** A scalar cell value. `null` is an empty cell. */
export type Scalar = number | string | boolean | ErrorValue | null

/**
 * A lazily-read rectangular block of scalars. Ranges evaluate to a Matrix so
 * that whole-column references (A:A) never materialise 100,000 entries.
 */
export interface Matrix {
  readonly kind: 'matrix'
  readonly rows: number
  readonly cols: number
  at(row: number, col: number): Scalar
}

export type Value = Scalar | Matrix

export const ERROR_CODES: readonly ErrorCode[] = [
  '#DIV/0!',
  '#REF!',
  '#NAME?',
  '#VALUE!',
  '#N/A',
  '#NUM!',
  '#CYCLE!',
  '#ERROR!',
]

export function makeError(code: ErrorCode, message?: string): ErrorValue {
  return message === undefined ? { kind: 'error', code } : { kind: 'error', code, message }
}

export function isError(v: Value): v is ErrorValue {
  return typeof v === 'object' && v !== null && v.kind === 'error'
}

export function isMatrix(v: Value): v is Matrix {
  return typeof v === 'object' && v !== null && v.kind === 'matrix'
}

export function isErrorCode(s: string): s is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(s)
}

/**
 * Thrown inside the evaluator to propagate an error value up through
 * operators and functions. Caught at the formula boundary (and by IFERROR).
 */
export class FormulaError extends Error {
  readonly code: ErrorCode
  constructor(code: ErrorCode, message?: string) {
    super(message ?? code)
    this.code = code
  }
  toValue(): ErrorValue {
    return makeError(this.code, this.message === this.code ? undefined : this.message)
  }
}

export function matrixFromRows(rows: Scalar[][]): Matrix {
  const nRows = rows.length
  const nCols = nRows === 0 ? 0 : rows[0].length
  return {
    kind: 'matrix',
    rows: nRows,
    cols: nCols,
    at: (r, c) => rows[r]?.[c] ?? null,
  }
}

/** Cell coordinates are zero-based internally; A1 is { row: 0, col: 0 }. */
export interface CellCoord {
  readonly row: number
  readonly col: number
}

export interface CellRef extends CellCoord {
  readonly absRow: boolean
  readonly absCol: boolean
}

export interface RangeRef {
  readonly start: CellRef
  readonly end: CellRef
  /** A:A style — the row extent is the whole sheet. */
  readonly wholeCol: boolean
  /** 1:1 style — the column extent is the whole sheet. */
  readonly wholeRow: boolean
}

export interface Rect {
  readonly r0: number
  readonly c0: number
  readonly r1: number
  readonly c1: number
}

export type FormatKind = 'general' | 'number' | 'percent' | 'currency' | 'date' | 'text'

export interface CellFormat {
  kind?: FormatKind
  decimals?: number
  bold?: boolean
  align?: 'left' | 'right' | 'center'
  /** Override pattern for date formats, e.g. "yyyy-mm-dd". */
  pattern?: string
}
