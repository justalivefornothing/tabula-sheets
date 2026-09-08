import { scalarOf, toBoolean } from '../coerce.ts'
import { FormulaError, isError, isMatrix, type Scalar, type Value } from '../types.ts'
import { def, err, lazyDef, looselyEqual, type FnDef } from './helpers.ts'

/** Evaluate a logical argument: ranges contribute every non-empty cell. */
function* logicalValues(v: Value): Generator<boolean> {
  if (isMatrix(v)) {
    for (let r = 0; r < v.rows; r++) {
      for (let c = 0; c < v.cols; c++) {
        const s = v.at(r, c)
        if (typeof s === 'boolean') yield s
        else if (typeof s === 'number') yield s !== 0
        else if (isError(s)) throw new FormulaError(s.code, s.message)
      }
    }
  } else {
    yield toBoolean(v)
  }
}

function safeEval(thunk: () => Value): Value | FormulaError {
  try {
    const v = thunk()
    if (!isMatrix(v) && isError(v)) return new FormulaError(v.code, v.message)
    return v
  } catch (e) {
    if (e instanceof FormulaError) return e
    throw e
  }
}

export const logicFunctions: FnDef[] = [
  lazyDef('IF', 'logic', 'IF(condition, value_if_true, [value_if_false])', 'Chooses a value based on a condition.', 2, 3, (args) => {
    const cond = toBoolean(args[0]())
    if (cond) return args[1]()
    return args.length > 2 ? args[2]() : false
  }),
  lazyDef('IFS', 'logic', 'IFS(condition1, value1, [condition2, value2, ...])', 'Returns the value for the first true condition.', 2, Infinity, (args) => {
    if (args.length % 2 !== 0) return err('#N/A', 'IFS needs condition/value pairs')
    for (let i = 0; i < args.length; i += 2) {
      if (toBoolean(args[i]())) return args[i + 1]()
    }
    return err('#N/A', 'No IFS condition matched')
  }),
  lazyDef('SWITCH', 'logic', 'SWITCH(expression, case1, value1, [case2, value2, ...], [default])', 'Matches an expression against cases.', 3, Infinity, (args) => {
    const subject = scalarOf(args[0]())
    if (isError(subject)) throw new FormulaError(subject.code, subject.message)
    const pairs = Math.floor((args.length - 1) / 2)
    for (let i = 0; i < pairs; i++) {
      const candidate = scalarOf(args[1 + i * 2]())
      if (looselyEqual(subject, candidate)) return args[2 + i * 2]()
    }
    if ((args.length - 1) % 2 === 1) return args[args.length - 1]()
    return err('#N/A', 'No SWITCH case matched')
  }),
  lazyDef('AND', 'logic', 'AND(logical1, [logical2, ...])', 'TRUE if every argument is TRUE.', 1, Infinity, (args) => {
    let any = false
    for (const a of args) {
      for (const b of logicalValues(a())) {
        any = true
        if (!b) return false
      }
    }
    return any ? true : err('#VALUE!', 'AND needs at least one logical value')
  }),
  lazyDef('OR', 'logic', 'OR(logical1, [logical2, ...])', 'TRUE if any argument is TRUE.', 1, Infinity, (args) => {
    let any = false
    for (const a of args) {
      for (const b of logicalValues(a())) {
        any = true
        if (b) return true
      }
    }
    return any ? false : err('#VALUE!', 'OR needs at least one logical value')
  }),
  def('XOR', 'logic', 'XOR(logical1, [logical2, ...])', 'TRUE if an odd number of arguments are TRUE.', 1, Infinity, (args) => {
    let count = 0
    for (const a of args) for (const b of logicalValues(a)) if (b) count++
    return count % 2 === 1
  }),
  def('NOT', 'logic', 'NOT(logical)', 'Inverts a boolean.', 1, 1, (args) => !toBoolean(args[0])),
  def('TRUE', 'logic', 'TRUE()', 'The boolean TRUE.', 0, 0, () => true),
  def('FALSE', 'logic', 'FALSE()', 'The boolean FALSE.', 0, 0, () => false),
  lazyDef('IFERROR', 'logic', 'IFERROR(value, value_if_error)', 'Replaces any error with a fallback.', 2, 2, (args) => {
    const r = safeEval(args[0])
    if (r instanceof FormulaError) return args[1]()
    return r
  }),
  lazyDef('IFNA', 'logic', 'IFNA(value, value_if_na)', 'Replaces #N/A with a fallback.', 2, 2, (args) => {
    const r = safeEval(args[0])
    if (r instanceof FormulaError) {
      if (r.code === '#N/A') return args[1]()
      throw r
    }
    return r
  }),
  lazyDef('ISERROR', 'info', 'ISERROR(value)', 'TRUE if the value is any error.', 1, 1, (args) => safeEval(args[0]) instanceof FormulaError),
  lazyDef('ISNA', 'info', 'ISNA(value)', 'TRUE if the value is #N/A.', 1, 1, (args) => {
    const r = safeEval(args[0])
    return r instanceof FormulaError && r.code === '#N/A'
  }),
  def('ISBLANK', 'info', 'ISBLANK(value)', 'TRUE if the cell is empty.', 1, 1, (args) => scalarOrNull(args[0]) === null),
  def('ISNUMBER', 'info', 'ISNUMBER(value)', 'TRUE if the value is a number.', 1, 1, (args) => typeof scalarOrNull(args[0]) === 'number'),
  def('ISTEXT', 'info', 'ISTEXT(value)', 'TRUE if the value is text.', 1, 1, (args) => typeof scalarOrNull(args[0]) === 'string'),
  def('ISLOGICAL', 'info', 'ISLOGICAL(value)', 'TRUE if the value is a boolean.', 1, 1, (args) => typeof scalarOrNull(args[0]) === 'boolean'),
  def('ISEVEN', 'info', 'ISEVEN(number)', 'TRUE if the number is even.', 1, 1, (args) => {
    const s = scalarOrNull(args[0])
    if (typeof s !== 'number') return err('#VALUE!')
    return Math.trunc(s) % 2 === 0
  }),
  def('ISODD', 'info', 'ISODD(number)', 'TRUE if the number is odd.', 1, 1, (args) => {
    const s = scalarOrNull(args[0])
    if (typeof s !== 'number') return err('#VALUE!')
    return Math.abs(Math.trunc(s)) % 2 === 1
  }),
]

/** Scalar view that keeps error values as data instead of throwing (for IS* tests). */
function scalarOrNull(v: Value): Scalar {
  if (isMatrix(v)) return v.rows === 1 && v.cols === 1 ? v.at(0, 0) : err('#VALUE!')
  return v
}
