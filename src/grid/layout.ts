/**
 * Pure layout math for the virtualized grid: maps between pixel space and
 * row/column indices given per-column widths and sparse row-height overrides.
 * No DOM here so it can be unit-tested in Node.
 */

export const DEFAULT_COL_WIDTH = 100
export const DEFAULT_ROW_HEIGHT = 24
export const HEADER_HEIGHT = 26
export const MIN_COL_WIDTH = 32
export const MIN_ROW_HEIGHT = 18

export interface VisibleRange {
  /** First index intersecting the viewport. */
  start: number
  /** Last index intersecting the viewport (inclusive). */
  end: number
}

export class GridLayout {
  readonly rows: number
  readonly cols: number
  private colX: number[] = []
  private colW: number[] = []
  /** Sorted [row, height] overrides. */
  private rowOverrides: Array<[number, number]> = []
  private defaultRowHeight = DEFAULT_ROW_HEIGHT

  constructor(rows: number, cols: number, colWidths: ReadonlyMap<number, number>, rowHeights: ReadonlyMap<number, number>) {
    this.rows = rows
    this.cols = cols
    this.setColumnWidths(colWidths)
    this.setRowHeights(rowHeights)
  }

  setColumnWidths(colWidths: ReadonlyMap<number, number>): void {
    this.colW = new Array(this.cols)
    this.colX = new Array(this.cols + 1)
    let x = 0
    for (let c = 0; c < this.cols; c++) {
      const w = Math.max(MIN_COL_WIDTH, colWidths.get(c) ?? DEFAULT_COL_WIDTH)
      this.colW[c] = w
      this.colX[c] = x
      x += w
    }
    this.colX[this.cols] = x
  }

  setRowHeights(rowHeights: ReadonlyMap<number, number>): void {
    this.rowOverrides = [...rowHeights.entries()]
      .filter(([r]) => r >= 0 && r < this.rows)
      .map(([r, h]) => [r, Math.max(MIN_ROW_HEIGHT, h)] as [number, number])
      .sort((a, b) => a[0] - b[0])
  }

  get totalWidth(): number {
    return this.colX[this.cols]
  }

  get totalHeight(): number {
    let extra = 0
    for (const [, h] of this.rowOverrides) extra += h - this.defaultRowHeight
    return this.rows * this.defaultRowHeight + extra
  }

  colWidth(c: number): number {
    return this.colW[c] ?? DEFAULT_COL_WIDTH
  }

  /** Left edge of a column in content coordinates. */
  colLeft(c: number): number {
    return this.colX[Math.min(Math.max(c, 0), this.cols)]
  }

  rowHeight(r: number): number {
    // Binary search the sparse overrides.
    const o = this.rowOverrides
    let lo = 0
    let hi = o.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (o[mid][0] === r) return o[mid][1]
      if (o[mid][0] < r) lo = mid + 1
      else hi = mid - 1
    }
    return this.defaultRowHeight
  }

  /** Top edge of a row in content coordinates. */
  rowTop(r: number): number {
    let extra = 0
    for (const [row, h] of this.rowOverrides) {
      if (row >= r) break
      extra += h - this.defaultRowHeight
    }
    return r * this.defaultRowHeight + extra
  }

  /** Column containing content-x, or -1 when beyond the last column. */
  colAt(x: number): number {
    if (x < 0) return -1
    if (x >= this.totalWidth) return -1
    let lo = 0
    let hi = this.cols - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.colX[mid] <= x) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  /** Row containing content-y, or -1 when outside the sheet. */
  rowAt(y: number): number {
    if (y < 0 || y >= this.totalHeight) return -1
    if (this.rowOverrides.length === 0) return Math.min(this.rows - 1, Math.floor(y / this.defaultRowHeight))
    let lo = 0
    let hi = this.rows - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.rowTop(mid) <= y) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  /** Columns intersecting [scrollX, scrollX + width). */
  visibleCols(scrollX: number, width: number): VisibleRange {
    if (width <= 0 || this.cols === 0) return { start: 0, end: -1 }
    const start = Math.max(0, this.colAt(Math.min(scrollX, this.totalWidth - 1)))
    let end = this.colAt(Math.min(scrollX + width - 1, this.totalWidth - 1))
    if (end < 0) end = this.cols - 1
    return { start, end }
  }

  /** Rows intersecting [scrollY, scrollY + height). */
  visibleRows(scrollY: number, height: number): VisibleRange {
    if (height <= 0 || this.rows === 0) return { start: 0, end: -1 }
    const start = Math.max(0, this.rowAt(Math.min(scrollY, this.totalHeight - 1)))
    let end = this.rowAt(Math.min(scrollY + height - 1, this.totalHeight - 1))
    if (end < 0) end = this.rows - 1
    return { start, end }
  }

  /** Scroll offset that brings a cell fully into a viewport of the given size. */
  scrollToReveal(row: number, col: number, scrollX: number, scrollY: number, width: number, height: number): { x: number; y: number } {
    let x = scrollX
    let y = scrollY
    const left = this.colLeft(col)
    const right = left + this.colWidth(col)
    if (left < scrollX) x = left
    else if (right > scrollX + width) x = right - width
    const top = this.rowTop(row)
    const bottom = top + this.rowHeight(row)
    if (top < scrollY) y = top
    else if (bottom > scrollY + height) y = bottom - height
    return { x: Math.max(0, x), y: Math.max(0, y) }
  }
}

/** Width of the row-number gutter for a given row count. */
export function rowHeaderWidth(rows: number): number {
  const digits = String(rows).length
  return Math.max(40, 16 + digits * 8)
}
