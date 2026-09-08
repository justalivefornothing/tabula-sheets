import { DAY_NAMES, MONTH_NAMES } from './dates.ts'

/**
 * Autofill series inference from seed values (the raw text of the seed cells).
 * Returns a generator for the i-th value *after* the seeds, or null when the
 * seeds do not form a recognisable series (the caller then repeats/copies).
 */
export type SeriesFn = (i: number) => string

const EPS = 1e-9

function allNumeric(seeds: string[]): number[] | null {
  const nums: number[] = []
  for (const s of seeds) {
    if (!/^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(s)) return null
    nums.push(Number(s))
  }
  return nums
}

function formatLike(value: number, sample: string): string {
  const decimals = (sample.trim().split('.')[1] ?? '').length
  const fixed = decimals > 0 ? value.toFixed(decimals) : String(Math.round(value * 1e9) / 1e9)
  return fixed
}

/** Linear extrapolation: constant step if the diffs agree, else least squares. */
function linear(nums: number[]): (i: number) => number {
  const n = nums.length
  if (n === 1) return (i) => nums[0] + i + 1
  const step = nums[1] - nums[0]
  let constant = true
  for (let k = 2; k < n; k++) if (Math.abs(nums[k] - nums[k - 1] - step) > EPS) constant = false
  if (constant) return (i) => nums[n - 1] + step * (i + 1)
  // least squares fit y = a + b x
  let sx = 0
  let sy = 0
  let sxx = 0
  let sxy = 0
  for (let x = 0; x < n; x++) {
    sx += x
    sy += nums[x]
    sxx += x * x
    sxy += x * nums[x]
  }
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx)
  const a = (sy - b * sx) / n
  return (i) => a + b * (n + i)
}

function cyclic(seeds: string[], names: readonly string[], abbreviate: boolean): SeriesFn | null {
  const list = abbreviate ? names.map((x) => x.slice(0, 3)) : names
  const idx = seeds.map((s) => list.findIndex((x) => x.toLowerCase() === s.trim().toLowerCase()))
  if (idx.some((i) => i < 0)) return null
  const step = seeds.length > 1 ? (idx[1] - idx[0] + list.length) % list.length || list.length : 1
  for (let k = 2; k < idx.length; k++) if ((idx[k] - idx[k - 1] + list.length) % list.length !== step % list.length) return null
  const upper = seeds[0] === seeds[0].toUpperCase()
  const last = idx[idx.length - 1]
  return (i) => {
    const name = list[(last + step * (i + 1)) % list.length]
    return upper ? name.toUpperCase() : name
  }
}

export function inferSeries(seeds: string[]): SeriesFn | null {
  if (seeds.length === 0) return null
  const nums = allNumeric(seeds)
  if (nums) {
    if (seeds.length === 1) return null // single number: copy, like Excel's plain drag
    const f = linear(nums)
    return (i) => formatLike(f(i), seeds[seeds.length - 1])
  }
  // Month / weekday names
  for (const [names, abbr] of [
    [MONTH_NAMES, false],
    [MONTH_NAMES, true],
    [DAY_NAMES, false],
    [DAY_NAMES, true],
  ] as const) {
    const f = cyclic(seeds, names, abbr)
    if (f) return f
  }
  // Text with a trailing integer: "Item 1", "Q1", "Week 10"
  const parts = seeds.map((s) => /^(.*?)(\d+)$/.exec(s))
  if (parts.every((p) => p !== null)) {
    const prefixes = parts.map((p) => p![1])
    if (prefixes.every((p) => p === prefixes[0])) {
      const numbers = parts.map((p) => parseInt(p![2], 10))
      const width = parts[parts.length - 1]![2].length
      const padded = parts[parts.length - 1]![2].startsWith('0')
      const f = seeds.length === 1 ? (i: number) => numbers[0] + i + 1 : linear(numbers)
      return (i) => {
        const v = Math.round(f(i))
        const digits = padded ? String(v).padStart(width, '0') : String(v)
        return prefixes[0] + digits
      }
    }
  }
  // ISO-looking dates with a constant day step
  const dates = seeds.map((s) => /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim()))
  if (seeds.length >= 2 && dates.every((d) => d !== null)) {
    const days = dates.map((d) => Date.UTC(+d![1], +d![2] - 1, +d![3]) / 86_400_000)
    const f = linear(days)
    return (i) => {
      const d = new Date(Math.round(f(i)) * 86_400_000)
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
    }
  }
  return null
}
