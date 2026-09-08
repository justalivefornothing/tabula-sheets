import { compareScalars, scalarOf, toNumber, toText } from './coerce.ts'
import { FUNCTIONS, SPECIAL_FORMS, type FnContext } from './functions/index.ts'
import type { BinaryOp, Node } from './parser.ts'
import { FormulaError, isError, isMatrix, makeError, type CellCoord, type Matrix, type RangeRef, type Scalar, type Value } from './types.ts'

export interface EvalContext extends FnContext {
  /** Current value of a cell (already recalculated when reached in topological order). */
  getCell(row: number, col: number): Scalar
  /** Rows / columns that currently hold content; whole-column ranges clamp to this. */
  usedRows(): number
  usedCols(): number
  /** The cell being evaluated, for ROW() / COLUMN() without arguments. */
  cell?: CellCoord
}

function rangeMatrix(ref: RangeRef, ctx: EvalContext): Matrix {
  const r0 = ref.start.row
  const c0 = ref.start.col
  let r1 = ref.end.row
  let c1 = ref.end.col
  if (ref.wholeCol) r1 = Math.max(r0, Math.min(r1, ctx.usedRows() - 1))
  if (ref.wholeRow) c1 = Math.max(c0, Math.min(c1, ctx.usedCols() - 1))
  return {
    kind: 'matrix',
    rows: r1 - r0 + 1,
    cols: c1 - c0 + 1,
    at: (r, c) => ctx.getCell(r0 + r, c0 + c),
  }
}

function arithmetic(op: BinaryOp, l: Value, r: Value): number {
  const a = toNumber(l)
  const b = toNumber(r)
  let out: number
  switch (op) {
    case '+':
      out = a + b
      break
    case '-':
      out = a - b
      break
    case '*':
      out = a * b
      break
    case '/':
      if (b === 0) throw new FormulaError('#DIV/0!')
      out = a / b
      break
    case '^':
      out = Math.pow(a, b)
      break
    default:
      throw new FormulaError('#ERROR!', `Unknown operator ${op}`)
  }
  if (!Number.isFinite(out)) throw new FormulaError('#NUM!', 'Result is not a finite number')
  return out
}

function comparison(op: BinaryOp, l: Value, r: Value): boolean {
  const a = scalarOf(l)
  const b = scalarOf(r)
  const cmp = compareScalars(a, b)
  switch (op) {
    case '=':
      return cmp === 0
    case '<>':
      return cmp !== 0
    case '<':
      return cmp < 0
    case '>':
      return cmp > 0
    case '<=':
      return cmp <= 0
    case '>=':
      return cmp >= 0
    default:
      throw new FormulaError('#ERROR!', `Unknown comparison ${op}`)
  }
}

function evalNode(node: Node, ctx: EvalContext): Value {
  switch (node.type) {
    case 'number':
    case 'string':
    case 'boolean':
      return node.value
    case 'error':
      throw new FormulaError(node.code)
    case 'ref': {
      const v = ctx.getCell(node.ref.row, node.ref.col)
      if (isError(v)) throw new FormulaError(v.code, v.message)
      return v
    }
    case 'range':
      return rangeMatrix(node.ref, ctx)
    case 'name':
      throw new FormulaError('#NAME?', `Unknown name "${node.name}"`)
    case 'unary': {
      const v = evalNode(node.operand, ctx)
      if (node.op === '-') return -toNumber(v)
      return toNumber(v)
    }
    case 'percent':
      return toNumber(evalNode(node.operand, ctx)) / 100
    case 'binary': {
      const l = evalNode(node.left, ctx)
      const r = evalNode(node.right, ctx)
      switch (node.op) {
        case '&':
          return toText(l) + toText(r)
        case '=':
        case '<>':
        case '<':
        case '>':
        case '<=':
        case '>=':
          return comparison(node.op, l, r)
        default:
          return arithmetic(node.op, l, r)
      }
    }
    case 'call':
      return evalCall(node, ctx)
  }
}

function evalCall(node: Extract<Node, { type: 'call' }>, ctx: EvalContext): Value {
  if (SPECIAL_FORMS.has(node.name)) return evalSpecialForm(node, ctx)
  const fn = FUNCTIONS.get(node.name)
  if (!fn) throw new FormulaError('#NAME?', `Unknown function ${node.name}`)
  const n = node.args.length
  if (n < fn.minArgs || n > fn.maxArgs) {
    const expected = fn.maxArgs === Infinity ? `at least ${fn.minArgs}` : fn.minArgs === fn.maxArgs ? `${fn.minArgs}` : `${fn.minArgs} to ${fn.maxArgs}`
    throw new FormulaError('#N/A', `${fn.name} expects ${expected} argument${fn.minArgs === 1 && fn.maxArgs === 1 ? '' : 's'} but got ${n}`)
  }
  if (fn.lazyFn) {
    return fn.lazyFn(
      node.args.map((a) => () => evalNode(a, ctx)),
      ctx,
    )
  }
  const args: Value[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const v = evalNode(node.args[i], ctx)
    if (!isMatrix(v) && isError(v)) throw new FormulaError(v.code, v.message)
    args[i] = v
  }
  return fn.fn!(args, ctx)
}

function evalSpecialForm(node: Extract<Node, { type: 'call' }>, ctx: EvalContext): Value {
  const arg = node.args[0]
  if (node.args.length > 1) throw new FormulaError('#N/A', `${node.name} expects at most 1 argument`)
  if (!arg) {
    if (!ctx.cell) throw new FormulaError('#VALUE!', `${node.name}() needs a cell context`)
    return node.name === 'ROW' ? ctx.cell.row + 1 : ctx.cell.col + 1
  }
  if (arg.type === 'ref') return node.name === 'ROW' ? arg.ref.row + 1 : arg.ref.col + 1
  if (arg.type === 'range') return node.name === 'ROW' ? arg.ref.start.row + 1 : arg.ref.start.col + 1
  throw new FormulaError('#VALUE!', `${node.name} expects a reference`)
}

/**
 * Evaluate a parsed formula to a single cell value. Errors never escape: they
 * become error values, and unexpected exceptions become #ERROR!.
 */
export function evaluate(node: Node, ctx: EvalContext): Scalar {
  try {
    const v = evalNode(node, ctx)
    if (isMatrix(v)) {
      if (v.rows === 1 && v.cols === 1) return v.at(0, 0)
      throw new FormulaError('#VALUE!', 'A range cannot be shown in a single cell; wrap it in a function like SUM')
    }
    return v
  } catch (e) {
    if (e instanceof FormulaError) return e.toValue()
    if (e instanceof RangeError) return makeError('#ERROR!', 'Formula is too deeply nested')
    return makeError('#ERROR!', e instanceof Error ? e.message : String(e))
  }
}
