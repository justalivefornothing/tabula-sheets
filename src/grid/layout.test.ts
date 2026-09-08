import { describe, expect, it } from 'vitest'
import { DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT, GridLayout } from './layout.ts'

describe('grid layout / virtualization math', () => {
  const layout = new GridLayout(100_000, 52, new Map([[1, 200]]), new Map([[5, 48]]))

  it('models 100,000 rows x 52 columns without materialising them', () => {
    expect(layout.totalHeight).toBe(100_000 * DEFAULT_ROW_HEIGHT + (48 - DEFAULT_ROW_HEIGHT))
    expect(layout.totalWidth).toBe(51 * DEFAULT_COL_WIDTH + 200)
  })

  it('only reports the rows and columns intersecting the viewport', () => {
    // rows 0-4 (120px) + tall row 5 (48px) + rows 6.. => 480px ends inside row 18
    const rows = layout.visibleRows(0, 480)
    expect(rows).toEqual({ start: 0, end: 18 })
    expect(layout.visibleRows(0, 481)).toEqual({ start: 0, end: 19 })
    const deep = layout.visibleRows(1_000_000, 480)
    // 1,000,000 px down, past the one tall row (+24px): row index shifts by one.
    expect(deep.start).toBe(Math.floor((1_000_000 - 24) / DEFAULT_ROW_HEIGHT))
    expect(deep.end - deep.start).toBeLessThanOrEqual(21)
    const cols = layout.visibleCols(150, 400)
    expect(cols).toEqual({ start: 1, end: 4 })
  })

  it('maps pixels to indices with resized columns and rows', () => {
    expect(layout.colAt(99)).toBe(0)
    expect(layout.colAt(100)).toBe(1)
    expect(layout.colAt(299)).toBe(1)
    expect(layout.colAt(300)).toBe(2)
    expect(layout.colLeft(2)).toBe(300)
    expect(layout.rowAt(5 * 24)).toBe(5)
    expect(layout.rowAt(5 * 24 + 47)).toBe(5)
    expect(layout.rowAt(5 * 24 + 48)).toBe(6)
    expect(layout.rowTop(6)).toBe(6 * 24 + 24)
    expect(layout.rowHeight(5)).toBe(48)
    expect(layout.rowAt(-1)).toBe(-1)
    expect(layout.colAt(layout.totalWidth + 5)).toBe(-1)
  })

  it('clamps at the last row and column', () => {
    const v = layout.visibleRows(layout.totalHeight - 10, 500)
    expect(v.end).toBe(99_999)
    const c = layout.visibleCols(layout.totalWidth - 10, 500)
    expect(c.end).toBe(51)
  })

  it('computes the scroll offset that reveals a cell', () => {
    expect(layout.scrollToReveal(0, 0, 0, 0, 500, 300)).toEqual({ x: 0, y: 0 })
    const r = layout.scrollToReveal(50, 0, 0, 0, 500, 300)
    expect(r.y).toBe(50 * 24 + 24 + 24 - 300)
    const c = layout.scrollToReveal(0, 10, 0, 0, 500, 300)
    expect(c.x).toBe(layout.colLeft(10) + 100 - 500)
  })
})
