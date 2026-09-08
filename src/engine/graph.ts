import { cellKey, rectContains } from './refs.ts'
import type { CellCoord, Rect } from './types.ts'

/**
 * Bidirectional dependency graph between cells.
 *
 * Direct references (A1) are stored as explicit edges in both directions.
 * Range references (A1:A10, A:A) are stored as *subscriptions*: each formula
 * owns a list of rectangles, and the rectangles are indexed into coarse
 * buckets of BUCKET_ROWS rows per column. Asking "who depends on cell X?"
 * unions the direct dependents with every subscriber in X's bucket whose
 * rectangle actually contains X. This keeps =SUM(A:A) O(1) to register
 * instead of O(100 000) edges.
 */

const BUCKET_SHIFT = 8 // 256 rows per bucket
const COL_BITS = 6 // up to 64 columns

function bucketKey(rowBlock: number, col: number): number {
  return (rowBlock << COL_BITS) | col
}

export class DependencyGraph {
  private readonly precedents = new Map<number, Set<number>>()
  private readonly dependents = new Map<number, Set<number>>()
  private readonly rangeSubs = new Map<number, Rect[]>()
  private readonly buckets = new Map<number, Set<number>>()

  /** Replace the dependency set of a formula cell. */
  set(key: number, cells: readonly CellCoord[], rects: readonly Rect[]): void {
    this.clear(key)
    if (cells.length > 0) {
      const pre = new Set<number>()
      for (const c of cells) {
        const k = cellKey(c.row, c.col)
        pre.add(k)
        let deps = this.dependents.get(k)
        if (!deps) {
          deps = new Set()
          this.dependents.set(k, deps)
        }
        deps.add(key)
      }
      this.precedents.set(key, pre)
    }
    if (rects.length > 0) {
      this.rangeSubs.set(key, rects.slice())
      for (const r of rects) this.indexRect(key, r, true)
    }
  }

  /** Remove every edge and subscription owned by `key`. */
  clear(key: number): void {
    const pre = this.precedents.get(key)
    if (pre) {
      for (const p of pre) {
        const deps = this.dependents.get(p)
        if (deps) {
          deps.delete(key)
          if (deps.size === 0) this.dependents.delete(p)
        }
      }
      this.precedents.delete(key)
    }
    const rects = this.rangeSubs.get(key)
    if (rects) {
      for (const r of rects) this.indexRect(key, r, false)
      this.rangeSubs.delete(key)
    }
  }

  private indexRect(key: number, rect: Rect, add: boolean): void {
    const b0 = rect.r0 >> BUCKET_SHIFT
    const b1 = rect.r1 >> BUCKET_SHIFT
    for (let c = rect.c0; c <= rect.c1; c++) {
      for (let b = b0; b <= b1; b++) {
        const bk = bucketKey(b, c)
        if (add) {
          let set = this.buckets.get(bk)
          if (!set) {
            set = new Set()
            this.buckets.set(bk, set)
          }
          set.add(key)
        } else {
          const set = this.buckets.get(bk)
          if (set) {
            set.delete(key)
            if (set.size === 0) this.buckets.delete(bk)
          }
        }
      }
    }
  }

  /** Formula cells that read (row, col) directly or through a range. */
  dependentsOf(row: number, col: number): Set<number> {
    const out = new Set<number>()
    const direct = this.dependents.get(cellKey(row, col))
    if (direct) for (const d of direct) out.add(d)
    const bucket = this.buckets.get(bucketKey(row >> BUCKET_SHIFT, col))
    if (bucket) {
      for (const f of bucket) {
        const rects = this.rangeSubs.get(f)
        if (!rects) continue
        for (const r of rects) {
          if (rectContains(r, row, col)) {
            out.add(f)
            break
          }
        }
      }
    }
    return out
  }

  /** Direct cell precedents of a formula (ranges are reported separately). */
  precedentsOf(key: number): ReadonlySet<number> {
    return this.precedents.get(key) ?? EMPTY
  }

  rangesOf(key: number): readonly Rect[] {
    return this.rangeSubs.get(key) ?? []
  }

  hasDependents(row: number, col: number): boolean {
    return this.dependentsOf(row, col).size > 0
  }

  /** Total number of direct edges, for diagnostics. */
  edgeCount(): number {
    let n = 0
    for (const s of this.precedents.values()) n += s.size
    return n
  }
}

const EMPTY: ReadonlySet<number> = new Set()
