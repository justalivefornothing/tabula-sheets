import { describe, expect, it } from 'vitest'
import { cellKey } from './refs.ts'
import { Sheet } from './sheet.ts'
import { isError, type Scalar } from './types.ts'

const code = (v: Scalar): string => (isError(v) ? v.code : String(v))

describe('dependency graph & incremental recalculation', () => {
  it('recomputes exactly the dirty chain in topological order', () => {
    const s = new Sheet()
    s.setMany([
      { row: 0, col: 0, raw: '1' }, // A1
      { row: 0, col: 1, raw: '=A1+1' }, // B1
      { row: 0, col: 2, raw: '=B1*2' }, // C1
    ])
    expect(s.getValue(0, 2)).toBe(4)
    const before = s.evalCount
    const result = s.set(0, 0, '5')
    expect(s.evalCount - before).toBe(2)
    expect(result.recomputed).toBe(2)
    expect(s.getValue(0, 1)).toBe(6)
    expect(s.getValue(0, 2)).toBe(12)
    // Unrelated cells never recompute.
    s.set(5, 5, '=1+1')
    const before2 = s.evalCount
    s.set(0, 0, '7')
    expect(s.evalCount - before2).toBe(2)
  })

  it('evaluates diamonds once per node', () => {
    const s = new Sheet()
    s.setMany([
      { row: 0, col: 0, raw: '1' }, // A1
      { row: 0, col: 1, raw: '=A1*2' }, // B1
      { row: 0, col: 2, raw: '=A1*3' }, // C1
      { row: 0, col: 3, raw: '=B1+C1' }, // D1
    ])
    const before = s.evalCount
    const r = s.set(0, 0, '2')
    expect(r.recomputed).toBe(3)
    expect(s.evalCount - before).toBe(3)
    expect(s.getValue(0, 3)).toBe(10)
  })

  it('marks cycles with #CYCLE! and restores values when the cycle is broken', () => {
    const s = new Sheet()
    s.set(0, 0, '=B1')
    const r = s.set(0, 1, '=A1')
    expect(code(s.getValue(0, 0))).toBe('#CYCLE!')
    expect(code(s.getValue(0, 1))).toBe('#CYCLE!')
    expect(r.cycles.sort()).toEqual([cellKey(0, 0), cellKey(0, 1)].sort())
    s.set(0, 1, '5')
    expect(s.getValue(0, 1)).toBe(5)
    expect(s.getValue(0, 0)).toBe(5)
  })

  it('detects self-reference and longer cycles, and downstream cells inherit #CYCLE!', () => {
    const s = new Sheet()
    s.set(0, 0, '=A1+1')
    expect(code(s.getValue(0, 0))).toBe('#CYCLE!')
    s.setMany([
      { row: 1, col: 0, raw: '=B2' },
      { row: 1, col: 1, raw: '=C2' },
      { row: 1, col: 2, raw: '=A2' },
      { row: 1, col: 3, raw: '=A2*2' },
    ])
    expect(code(s.getValue(1, 0))).toBe('#CYCLE!')
    expect(code(s.getValue(1, 2))).toBe('#CYCLE!')
    expect(code(s.getValue(1, 3))).toBe('#CYCLE!')
    s.set(1, 2, '10')
    expect(s.getValue(1, 0)).toBe(10)
    expect(s.getValue(1, 3)).toBe(20)
  })

  it('range subscriptions: editing a cell inside a referenced range dirties the formula', () => {
    const s = new Sheet()
    s.set(0, 1, '=SUM(A1:A10)') // B1
    expect(s.getValue(0, 1)).toBe(0)
    const before = s.evalCount
    s.set(4, 0, '7') // A5
    expect(s.evalCount - before).toBe(1)
    expect(s.getValue(0, 1)).toBe(7)
    // A cell outside the range does not dirty it.
    const before2 = s.evalCount
    s.set(20, 0, '100') // A21
    expect(s.evalCount - before2).toBe(0)
  })

  it('whole-column references track new rows', () => {
    const s = new Sheet()
    s.set(0, 1, '=COUNT(A:A)') // B1
    s.set(0, 0, '1')
    s.set(1, 0, '2')
    expect(s.getValue(0, 1)).toBe(2)
    s.set(500, 0, '3')
    expect(s.getValue(0, 1)).toBe(3)
    s.set(1, 0, 'text')
    expect(s.getValue(0, 1)).toBe(2)
    // A formula living inside its own whole-column range is a cycle.
    s.set(2, 0, '=SUM(A:A)')
    expect(code(s.getValue(2, 0))).toBe('#CYCLE!')
  })

  it('reports changed cells for the UI flash and recompute counts', () => {
    const s = new Sheet()
    s.setMany([
      { row: 0, col: 0, raw: '1' },
      { row: 0, col: 1, raw: '=A1' },
      { row: 0, col: 2, raw: '=IF(A1>100,"big","small")' },
    ])
    const r = s.set(0, 0, '2')
    expect(r.recomputed).toBe(2)
    // B1 changed (1 -> 2); C1 stays "small" so it is not in the changed list.
    expect(r.changed).toContain(cellKey(0, 1))
    expect(r.changed).not.toContain(cellKey(0, 2))
  })

  it('handles removing a formula and clearing dependencies', () => {
    const s = new Sheet()
    s.set(0, 0, '1')
    s.set(0, 1, '=A1*10')
    s.set(0, 1, '')
    const before = s.evalCount
    s.set(0, 0, '2')
    expect(s.evalCount - before).toBe(0)
    expect(s.getValue(0, 1)).toBeNull()
  })

  it('volatile cells recompute on every pass', () => {
    const s = new Sheet()
    let day = 4
    s.setClock(() => new Date(2024, 2, day))
    s.set(0, 0, '=TODAY()')
    const first = s.getValue(0, 0)
    day = 5
    s.set(5, 5, 'x')
    expect(s.getValue(0, 0)).toBe((first as number) + 1)
  })

  it('full recalculation visits every formula once', () => {
    const s = new Sheet()
    const edits = []
    for (let i = 0; i < 100; i++) {
      edits.push({ row: i, col: 0, raw: String(i) })
      edits.push({ row: i, col: 1, raw: i === 0 ? '=A1*2' : `=A${i + 1}*2+B${i}` })
    }
    s.setMany(edits)
    const before = s.evalCount
    const r = s.recalcAll()
    expect(r.recomputed).toBe(100)
    expect(s.evalCount - before).toBe(100)
    expect(s.getValue(99, 1)).toBe(2 * (99 * 100) / 2)
  })
})
