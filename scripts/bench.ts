/**
 * Recalculation benchmark.
 *
 *   npm run bench
 *
 * Builds a 50,000-row sheet where A_i is random and B_i = A_i * 2 + B_{i-1}
 * (a 50,000-deep dependency chain), then measures:
 *   1. a full recalculation of every formula cell
 *   2. an edit to A49990, which must recompute only B49990..B50000 (11 cells)
 */
import { performance } from 'node:perf_hooks'
import { Sheet } from '../src/engine/sheet.ts'
import type { CellEdit } from '../src/engine/sheet.ts'

const ROWS = 50_000

function fmt(ms: number): string {
  return `${ms.toFixed(2)} ms`
}

// Deterministic PRNG so runs are comparable.
let seed = 0x9e3779b9
function rand(): number {
  seed ^= seed << 13
  seed ^= seed >>> 17
  seed ^= seed << 5
  return ((seed >>> 0) % 100_000) / 100
}

console.log(`Tabula recalculation benchmark — ${ROWS.toLocaleString()} formula cells\n`)

const sheet = new Sheet()
const edits: CellEdit[] = []
for (let i = 0; i < ROWS; i++) {
  edits.push({ row: i, col: 0, raw: rand().toFixed(2) })
  edits.push({ row: i, col: 1, raw: i === 0 ? '=A1*2' : `=A${i + 1}*2+B${i}` })
}

const tBuild0 = performance.now()
const build = sheet.setMany(edits)
const tBuild = performance.now() - tBuild0
console.log(`build + initial recalc      ${fmt(tBuild)}  (${build.recomputed.toLocaleString()} formulas parsed & evaluated)`)

// Full recalculation, best of 3
let fullBest = Infinity
let fullCount = 0
for (let k = 0; k < 3; k++) {
  const r = sheet.recalcAll()
  fullBest = Math.min(fullBest, r.ms)
  fullCount = r.recomputed
}
console.log(`full recalculation          ${fmt(fullBest)}  (${fullCount.toLocaleString()} cells, best of 3)`)

// Incremental edit near the bottom of the chain, best of 5
const editRow = 49_989 // A49990
let editBest = Infinity
let editCount = 0
for (let k = 0; k < 5; k++) {
  const before = sheet.evalCount
  const r = sheet.set(editRow, 0, String(100 + k))
  editBest = Math.min(editBest, r.ms)
  editCount = sheet.evalCount - before
}
console.log(`edit A49990 (incremental)   ${fmt(editBest)}  (${editCount} cells recomputed, best of 5)`)

// Sanity: the chain value must equal the closed form
let expected = 0
for (let i = 0; i < ROWS; i++) expected += (sheet.getValue(i, 0) as number) * 2
const actual = sheet.getValue(ROWS - 1, 1) as number
const ok = Math.abs(expected - actual) < 1e-6 * Math.max(1, Math.abs(expected))
console.log(`\nB50000 = ${actual.toFixed(2)} (expected ${expected.toFixed(2)}) ${ok ? 'OK' : 'MISMATCH'}`)

const pass = fullBest < 800 && editBest < 5 && editCount <= 11 && ok
console.log(`\nTargets: full < 800 ms, edit < 5 ms recomputing <= 11 cells  ->  ${pass ? 'PASS' : 'FAIL'}`)
if (!pass) process.exitCode = 1
