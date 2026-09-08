import { toNumber } from '../coerce.ts'
import { isMatrix, type Value } from '../types.ts'
import { def, err, flatten, flattenAll, looselyEqual, numbersIn, requireMatrix, toInt, type FnDef } from './helpers.ts'
import { numericScalars } from './math.ts'

function variance(nums: number[], sample: boolean): number {
  const n = nums.length
  if (n < (sample ? 2 : 1)) return err('#DIV/0!', 'Not enough numbers')
  const mean = nums.reduce((a, b) => a + b, 0) / n
  const ss = nums.reduce((a, b) => a + (b - mean) * (b - mean), 0)
  return ss / (sample ? n - 1 : n)
}

function sortedNumbers(args: Value[]): number[] {
  return numbersIn(args).sort((a, b) => a - b)
}

export const statsFunctions: FnDef[] = [
  def('MEDIAN', 'stats', 'MEDIAN(value1, [value2, ...])', 'Middle value.', 1, Infinity, (args) => {
    const nums = sortedNumbers(args)
    const n = nums.length
    if (n === 0) return err('#DIV/0!')
    return n % 2 === 1 ? nums[(n - 1) / 2] : (nums[n / 2 - 1] + nums[n / 2]) / 2
  }),
  def('STDEV', 'stats', 'STDEV(value1, [value2, ...])', 'Sample standard deviation.', 1, Infinity, (args) =>
    Math.sqrt(variance(numbersIn(args), true)),
  ),
  def('STDEVP', 'stats', 'STDEVP(value1, [value2, ...])', 'Population standard deviation.', 1, Infinity, (args) =>
    Math.sqrt(variance(numbersIn(args), false)),
  ),
  def('VAR', 'stats', 'VAR(value1, [value2, ...])', 'Sample variance.', 1, Infinity, (args) => variance(numbersIn(args), true)),
  def('VARP', 'stats', 'VARP(value1, [value2, ...])', 'Population variance.', 1, Infinity, (args) => variance(numbersIn(args), false)),
  def('RANK', 'stats', 'RANK(value, range, [ascending])', 'Rank of a value within a range (1 = largest by default).', 2, 3, (args) => {
    const v = toNumber(args[0])
    const nums = numericScalars(flatten(requireMatrix(args[1])))
    const ascending = args.length > 2 ? toInt(args[2]) !== 0 : false
    if (!nums.includes(v)) return err('#N/A', 'Value is not in the range')
    let rank = 1
    for (const n of nums) if (ascending ? n < v : n > v) rank++
    return rank
  }),
  def('LARGE', 'stats', 'LARGE(range, k)', 'k-th largest value.', 2, 2, (args) => {
    const nums = numbersIn([args[0]]).sort((a, b) => b - a)
    const k = toInt(args[1])
    if (k < 1 || k > nums.length) return err('#NUM!')
    return nums[k - 1]
  }),
  def('SMALL', 'stats', 'SMALL(range, k)', 'k-th smallest value.', 2, 2, (args) => {
    const nums = sortedNumbers([args[0]])
    const k = toInt(args[1])
    if (k < 1 || k > nums.length) return err('#NUM!')
    return nums[k - 1]
  }),
  def('MODE', 'stats', 'MODE(value1, [value2, ...])', 'Most frequent number.', 1, Infinity, (args) => {
    const nums = numbersIn(args)
    const counts = new Map<number, number>()
    let best: number | null = null
    let bestCount = 1
    for (const n of nums) {
      const c = (counts.get(n) ?? 0) + 1
      counts.set(n, c)
      if (c > bestCount || (c === bestCount && best === null && c > 1)) {
        best = n
        bestCount = c
      }
    }
    if (best === null) return err('#N/A', 'No repeated values')
    return best
  }),
  def('PERCENTILE', 'stats', 'PERCENTILE(range, k)', 'k-th percentile (0..1) with linear interpolation.', 2, 2, (args) => {
    const nums = sortedNumbers([args[0]])
    const k = toNumber(args[1])
    if (nums.length === 0 || k < 0 || k > 1) return err('#NUM!')
    const pos = (nums.length - 1) * k
    const lo = Math.floor(pos)
    const hi = Math.ceil(pos)
    return nums[lo] + (nums[hi] - nums[lo]) * (pos - lo)
  }),
  def('COUNTUNIQUE', 'stats', 'COUNTUNIQUE(value1, [value2, ...])', 'Number of distinct non-empty values.', 1, Infinity, (args) => {
    const seen: Value[] = []
    for (const s of flattenAll(args)) {
      if (s === null || s === '') continue
      if (!seen.some((x) => !isMatrix(x) && looselyEqual(x, s))) seen.push(s)
    }
    return seen.length
  }),
  def('AVERAGEA', 'stats', 'AVERAGEA(value1, [value2, ...])', 'Mean where text counts as 0 and TRUE as 1.', 1, Infinity, (args) => {
    let sum = 0
    let n = 0
    for (const s of flattenAll(args)) {
      if (s === null) continue
      n++
      if (typeof s === 'number') sum += s
      else if (typeof s === 'boolean') sum += s ? 1 : 0
    }
    if (n === 0) return err('#DIV/0!')
    return sum / n
  }),
]
