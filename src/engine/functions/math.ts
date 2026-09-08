import { toNumber } from '../coerce.ts'
import { FormulaError, isError, isMatrix, type Scalar, type Value } from '../types.ts'
import { def, err, flattenAll, isPresent, makeCriterion, numbersIn, requireMatrix, toInt, type FnDef } from './helpers.ts'

function roundTo(n: number, digits: number, mode: 'nearest' | 'up' | 'down'): number {
  const factor = Math.pow(10, digits)
  const scaled = n * factor
  // Nudge to defeat binary representation error (2.675 -> 2.68).
  const nudged = scaled + (scaled >= 0 ? 1e-9 : -1e-9)
  let r: number
  if (mode === 'nearest') r = Math.sign(nudged) * Math.round(Math.abs(nudged))
  else if (mode === 'up') r = Math.sign(nudged) * Math.ceil(Math.abs(nudged) - 2e-9)
  else r = Math.sign(nudged) * Math.trunc(Math.abs(nudged))
  const out = r / factor
  return out === 0 ? 0 : out
}

function countIf(args: Value[]): number {
  const range = requireMatrix(args[0])
  const test = makeCriterion(args[1])
  let n = 0
  for (let r = 0; r < range.rows; r++) for (let c = 0; c < range.cols; c++) if (test(range.at(r, c))) n++
  return n
}

/** Shared engine for SUMIF / AVERAGEIF: returns the matched numbers. */
function matchedNumbers(args: Value[]): number[] {
  const range = requireMatrix(args[0])
  const test = makeCriterion(args[1])
  const target = args.length > 2 ? requireMatrix(args[2]) : range
  const out: number[] = []
  for (let r = 0; r < range.rows; r++) {
    for (let c = 0; c < range.cols; c++) {
      if (!test(range.at(r, c))) continue
      const v = r < target.rows && c < target.cols ? target.at(r, c) : null
      if (typeof v === 'number') out.push(v)
      else if (isError(v)) throw new FormulaError(v.code, v.message)
    }
  }
  return out
}

let randState = 0x2f6e2b1

/** Deterministic xorshift RNG so tests and benchmarks are reproducible. */
export function seedRandom(seed: number): void {
  randState = seed | 0 || 1
}

function nextRandom(): number {
  let x = randState
  x ^= x << 13
  x ^= x >>> 17
  x ^= x << 5
  randState = x | 0
  return ((x >>> 0) % 1_000_000) / 1_000_000
}

export const mathFunctions: FnDef[] = [
  def('SUM', 'math', 'SUM(value1, [value2, ...])', 'Adds all numbers in the arguments.', 1, Infinity, (args) =>
    numbersIn(args).reduce((a, b) => a + b, 0),
  ),
  def('AVERAGE', 'math', 'AVERAGE(value1, [value2, ...])', 'Arithmetic mean of the numbers.', 1, Infinity, (args) => {
    const nums = numbersIn(args)
    if (nums.length === 0) return err('#DIV/0!', 'AVERAGE of no numbers')
    return nums.reduce((a, b) => a + b, 0) / nums.length
  }),
  def('MIN', 'math', 'MIN(value1, [value2, ...])', 'Smallest number.', 1, Infinity, (args) => {
    const nums = numbersIn(args)
    return nums.length === 0 ? 0 : Math.min(...nums)
  }),
  def('MAX', 'math', 'MAX(value1, [value2, ...])', 'Largest number.', 1, Infinity, (args) => {
    const nums = numbersIn(args)
    return nums.length === 0 ? 0 : Math.max(...nums)
  }),
  def('COUNT', 'math', 'COUNT(value1, [value2, ...])', 'Counts numeric values.', 1, Infinity, (args) => {
    let n = 0
    for (const a of args) {
      if (isMatrix(a)) {
        for (let r = 0; r < a.rows; r++) for (let c = 0; c < a.cols; c++) if (typeof a.at(r, c) === 'number') n++
      } else if (typeof a === 'number' || typeof a === 'boolean') n++
      else if (typeof a === 'string' && !Number.isNaN(Number(a)) && a.trim() !== '') n++
    }
    return n
  }),
  def('COUNTA', 'math', 'COUNTA(value1, [value2, ...])', 'Counts non-empty values.', 1, Infinity, (args) =>
    flattenAll(args).filter(isPresent).length,
  ),
  def('COUNTBLANK', 'math', 'COUNTBLANK(range)', 'Counts empty cells.', 1, 1, (args) =>
    flattenAll(args).filter((s) => !isPresent(s)).length,
  ),
  def('COUNTIF', 'math', 'COUNTIF(range, criterion)', 'Counts cells that meet a criterion.', 2, 2, (args) => countIf(args)),
  def('SUMIF', 'math', 'SUMIF(range, criterion, [sum_range])', 'Sums cells that meet a criterion.', 2, 3, (args) =>
    matchedNumbers(args).reduce((a, b) => a + b, 0),
  ),
  def('AVERAGEIF', 'math', 'AVERAGEIF(range, criterion, [average_range])', 'Averages cells that meet a criterion.', 2, 3, (args) => {
    const nums = matchedNumbers(args)
    if (nums.length === 0) return err('#DIV/0!')
    return nums.reduce((a, b) => a + b, 0) / nums.length
  }),
  def('SUMPRODUCT', 'math', 'SUMPRODUCT(range1, [range2, ...])', 'Sum of element-wise products.', 1, Infinity, (args) => {
    const mats = args.map(requireMatrix)
    const rows = mats[0].rows
    const cols = mats[0].cols
    for (const m of mats) if (m.rows !== rows || m.cols !== cols) return err('#VALUE!', 'SUMPRODUCT ranges must be the same size')
    let total = 0
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let p = 1
        for (const m of mats) {
          const s = m.at(r, c)
          if (isError(s)) throw new FormulaError(s.code, s.message)
          p *= typeof s === 'number' ? s : typeof s === 'boolean' ? (s ? 1 : 0) : 0
        }
        total += p
      }
    }
    return total
  }),
  def('PRODUCT', 'math', 'PRODUCT(value1, [value2, ...])', 'Multiplies all numbers.', 1, Infinity, (args) => {
    const nums = numbersIn(args)
    return nums.length === 0 ? 0 : nums.reduce((a, b) => a * b, 1)
  }),
  def('ROUND', 'math', 'ROUND(number, [digits])', 'Rounds to a number of digits.', 1, 2, (args) =>
    roundTo(toNumber(args[0]), args.length > 1 ? toInt(args[1]) : 0, 'nearest'),
  ),
  def('ROUNDUP', 'math', 'ROUNDUP(number, [digits])', 'Rounds away from zero.', 1, 2, (args) =>
    roundTo(toNumber(args[0]), args.length > 1 ? toInt(args[1]) : 0, 'up'),
  ),
  def('ROUNDDOWN', 'math', 'ROUNDDOWN(number, [digits])', 'Rounds toward zero.', 1, 2, (args) =>
    roundTo(toNumber(args[0]), args.length > 1 ? toInt(args[1]) : 0, 'down'),
  ),
  def('TRUNC', 'math', 'TRUNC(number, [digits])', 'Truncates to digits.', 1, 2, (args) =>
    roundTo(toNumber(args[0]), args.length > 1 ? toInt(args[1]) : 0, 'down'),
  ),
  def('INT', 'math', 'INT(number)', 'Rounds down to the nearest integer.', 1, 1, (args) => Math.floor(toNumber(args[0]))),
  def('ABS', 'math', 'ABS(number)', 'Absolute value.', 1, 1, (args) => Math.abs(toNumber(args[0]))),
  def('SIGN', 'math', 'SIGN(number)', 'Sign of a number (-1, 0, 1).', 1, 1, (args) => Math.sign(toNumber(args[0]))),
  def('MOD', 'math', 'MOD(number, divisor)', 'Remainder with the sign of the divisor.', 2, 2, (args) => {
    const n = toNumber(args[0])
    const d = toNumber(args[1])
    if (d === 0) return err('#DIV/0!')
    return n - d * Math.floor(n / d)
  }),
  def('POWER', 'math', 'POWER(base, exponent)', 'Raises base to a power.', 2, 2, (args) => {
    const r = Math.pow(toNumber(args[0]), toNumber(args[1]))
    if (!Number.isFinite(r)) return err('#NUM!')
    return r
  }),
  def('SQRT', 'math', 'SQRT(number)', 'Square root.', 1, 1, (args) => {
    const n = toNumber(args[0])
    if (n < 0) return err('#NUM!', 'SQRT of a negative number')
    return Math.sqrt(n)
  }),
  def('EXP', 'math', 'EXP(number)', 'e raised to a power.', 1, 1, (args) => Math.exp(toNumber(args[0]))),
  def('LN', 'math', 'LN(number)', 'Natural logarithm.', 1, 1, (args) => {
    const n = toNumber(args[0])
    if (n <= 0) return err('#NUM!')
    return Math.log(n)
  }),
  def('LOG', 'math', 'LOG(number, [base])', 'Logarithm with a base (default 10).', 1, 2, (args) => {
    const n = toNumber(args[0])
    const base = args.length > 1 ? toNumber(args[1]) : 10
    if (n <= 0 || base <= 0 || base === 1) return err('#NUM!')
    return Math.log(n) / Math.log(base)
  }),
  def('LOG10', 'math', 'LOG10(number)', 'Base-10 logarithm.', 1, 1, (args) => {
    const n = toNumber(args[0])
    if (n <= 0) return err('#NUM!')
    return Math.log10(n)
  }),
  def('PI', 'math', 'PI()', 'The constant pi.', 0, 0, () => Math.PI),
  def('CEILING', 'math', 'CEILING(number, [significance])', 'Rounds up to a multiple.', 1, 2, (args) => {
    const n = toNumber(args[0])
    const sig = args.length > 1 ? toNumber(args[1]) : 1
    if (sig === 0) return 0
    return Math.ceil(n / sig - 1e-12) * sig
  }),
  def('FLOOR', 'math', 'FLOOR(number, [significance])', 'Rounds down to a multiple.', 1, 2, (args) => {
    const n = toNumber(args[0])
    const sig = args.length > 1 ? toNumber(args[1]) : 1
    if (sig === 0) return 0
    return Math.floor(n / sig + 1e-12) * sig
  }),
  def('RAND', 'math', 'RAND()', 'Pseudo-random number in [0, 1).', 0, 0, () => nextRandom(), true),
  def(
    'RANDBETWEEN',
    'math',
    'RANDBETWEEN(low, high)',
    'Pseudo-random integer between low and high.',
    2,
    2,
    (args) => {
      const lo = Math.ceil(toNumber(args[0]))
      const hi = Math.floor(toNumber(args[1]))
      if (hi < lo) return err('#NUM!')
      return lo + Math.floor(nextRandom() * (hi - lo + 1))
    },
    true,
  ),
]

/** Utility used by stats: numeric scalars from a list with error propagation. */
export function numericScalars(list: Scalar[]): number[] {
  const out: number[] = []
  for (const s of list) {
    if (typeof s === 'number') out.push(s)
    else if (isError(s)) throw new FormulaError(s.code, s.message)
  }
  return out
}
