import { describe, expect, it } from 'vitest'
import { parseCsv, toCsv, toTsv, parseTsv } from './csv.ts'
import { shiftFormula } from './rewrite.ts'
import { inferSeries } from './series.ts'
import { Workbook } from './workbook.ts'

describe('reference rewriting', () => {
  it('shifts relative parts and keeps absolute parts', () => {
    expect(shiftFormula('=A1+$B$1', 2, 0)).toBe('=A3+$B$1')
    expect(shiftFormula('=A1', 0, 1)).toBe('=B1')
    expect(shiftFormula('=$A1+A$1', 1, 1)).toBe('=$A2+B$1')
    expect(shiftFormula('=SUM(A1:B2)*2', 3, 1)).toBe('=SUM(B4:C5)*2')
    expect(shiftFormula('=SUM(A:A)+SUM(1:1)', 1, 1)).toBe('=SUM(B:B)+SUM(2:2)')
    expect(shiftFormula('=SUM($A:$A)', 1, 1)).toBe('=SUM($A:$A)')
  })
  it('leaves function names, strings and plain values alone', () => {
    expect(shiftFormula('=LOG10(A1) & "A1"', 1, 0)).toBe('=LOG10(A2) & "A1"')
    expect(shiftFormula('hello', 1, 1)).toBe('hello')
    expect(shiftFormula('=TRUE', 1, 1)).toBe('=TRUE')
  })
  it('produces #REF! when shifted off the sheet', () => {
    expect(shiftFormula('=A1', -1, 0)).toBe('=#REF!')
    expect(shiftFormula('=A1+B1', 0, -1)).toBe('=#REF!+A1')
  })
})

describe('workbook: fill, paste, undo/redo', () => {
  it('filling =A1+$B$1 from C1 down to C3 yields =A3+$B$1 in C3', () => {
    const wb = new Workbook()
    wb.execute('edit', 'seed', [
      { row: 0, col: 0, raw: '1' },
      { row: 1, col: 0, raw: '2' },
      { row: 2, col: 0, raw: '3' },
      { row: 0, col: 1, raw: '10' },
      { row: 0, col: 2, raw: '=A1+$B$1' },
    ])
    wb.fill({ r0: 0, c0: 2, r1: 0, c1: 2 }, { r0: 0, c0: 2, r1: 2, c1: 2 })
    expect(wb.sheet.getRaw(2, 2)).toBe('=A3+$B$1')
    expect(wb.sheet.getRaw(1, 2)).toBe('=A2+$B$1')
    expect(wb.sheet.getValue(2, 2)).toBe(13)
  })

  it('fills numeric and date series from two seeds, repeats otherwise', () => {
    const wb = new Workbook()
    wb.execute('edit', 'seed', [
      { row: 0, col: 0, raw: '1' },
      { row: 1, col: 0, raw: '3' },
      { row: 0, col: 1, raw: 'Jan' },
      { row: 0, col: 2, raw: '2024-01-31' },
      { row: 1, col: 2, raw: '2024-02-29' },
    ])
    wb.fill({ r0: 0, c0: 0, r1: 1, c1: 0 }, { r0: 0, c0: 0, r1: 4, c1: 0 })
    expect([2, 3, 4].map((r) => wb.sheet.getRaw(r, 0))).toEqual(['5', '7', '9'])
    wb.fill({ r0: 0, c0: 1, r1: 0, c1: 1 }, { r0: 0, c0: 1, r1: 3, c1: 1 })
    expect([1, 2, 3].map((r) => wb.sheet.getRaw(r, 1))).toEqual(['Feb', 'Mar', 'Apr'])
    wb.fill({ r0: 0, c0: 2, r1: 1, c1: 2 }, { r0: 0, c0: 2, r1: 3, c1: 2 })
    expect(wb.sheet.getRaw(2, 2)).toBe('2024-03-29')
    expect(inferSeries(['Item 1', 'Item 2'])!(0)).toBe('Item 3')
    expect(inferSeries(['Q1'])!(1)).toBe('Q3')
    expect(inferSeries(['hello'])).toBeNull()
    expect(inferSeries(['Monday', 'Wednesday'])!(0)).toBe('Friday')
  })

  it('fills to the right, shifting columns', () => {
    const wb = new Workbook()
    wb.execute('edit', 'seed', [
      { row: 0, col: 0, raw: '=B5*2' },
    ])
    wb.fill({ r0: 0, c0: 0, r1: 0, c1: 0 }, { r0: 0, c0: 0, r1: 0, c1: 2 })
    expect(wb.sheet.getRaw(0, 2)).toBe('=D5*2')
  })

  it('pasting =A1 one column right yields =B1; plain TSV pastes as values', () => {
    const wb = new Workbook()
    wb.setCell(0, 0, '=A1')
    wb.setCell(2, 2, '=A1')
    const payload = wb.copy({ r0: 2, c0: 2, r1: 2, c1: 2 })
    wb.paste({ row: 2, col: 3 }, payload.text)
    expect(wb.sheet.getRaw(2, 3)).toBe('=B1')
    wb.paste({ row: 5, col: 0 }, 'x\t1\ny\t2')
    expect(wb.sheet.getRaw(5, 0)).toBe('x')
    expect(wb.sheet.getValue(6, 1)).toBe(2)
  })

  it('tiles a single copied cell over a selection', () => {
    const wb = new Workbook()
    wb.setCell(0, 0, '=ROW()')
    const payload = wb.copy({ r0: 0, c0: 0, r1: 0, c1: 0 })
    wb.paste({ row: 2, col: 1 }, payload.text, { r0: 2, c0: 1, r1: 4, c1: 1 })
    expect([2, 3, 4].map((r) => wb.sheet.getValue(r, 1))).toEqual([3, 4, 5])
  })

  it('cut + paste moves cells without rewriting their formulas', () => {
    const wb = new Workbook()
    wb.setCell(0, 0, '5')
    wb.setCell(0, 1, '=A1*2')
    const payload = wb.cut({ r0: 0, c0: 1, r1: 0, c1: 1 })
    wb.paste({ row: 3, col: 3 }, payload.text)
    expect(wb.sheet.getRaw(0, 1)).toBe('')
    expect(wb.sheet.getRaw(3, 3)).toBe('=A1*2')
    expect(wb.sheet.getValue(3, 3)).toBe(10)
  })

  it('undo after a 100-cell fill restores all 100 cells in one step; redo re-applies', () => {
    const wb = new Workbook()
    wb.setCell(0, 0, '1')
    wb.setCell(1, 0, '2')
    wb.fill({ r0: 0, c0: 0, r1: 1, c1: 0 }, { r0: 0, c0: 0, r1: 101, c1: 0 })
    expect(wb.sheet.getValue(101, 0)).toBe(102)
    expect(wb.log.size()).toBe(3)
    wb.undo()
    for (let r = 2; r <= 101; r++) expect(wb.sheet.getRaw(r, 0)).toBe('')
    expect(wb.sheet.getValue(1, 0)).toBe(2)
    wb.redo()
    for (let r = 2; r <= 101; r++) expect(wb.sheet.getValue(r, 0)).toBe(r + 1)
    expect(wb.log.canRedo()).toBe(false)
  })

  it('undo restores formats and dependent formulas; new edits truncate the redo tail', () => {
    const wb = new Workbook()
    wb.setCell(0, 0, '10')
    wb.setCell(0, 1, '=A1*2')
    wb.setFormat({ r0: 0, c0: 0, r1: 0, c1: 0 }, { kind: 'currency' })
    expect(wb.sheet.getFormat(0, 0)).toEqual({ kind: 'currency' })
    wb.undo()
    expect(wb.sheet.getFormat(0, 0)).toBeUndefined()
    wb.undo()
    expect(wb.sheet.getValue(0, 1)).toBeNull()
    wb.setCell(3, 3, 'new')
    expect(wb.log.canRedo()).toBe(false)
    expect(wb.log.list().map((c) => c.label)).toEqual(['Edit A1', 'Edit D4'])
  })

  it('resize is undoable', () => {
    const wb = new Workbook()
    wb.resize('col', 2, 180)
    expect(wb.sheet.colWidths.get(2)).toBe(180)
    wb.undo()
    expect(wb.sheet.colWidths.get(2)).toBeUndefined()
    wb.redo()
    expect(wb.sheet.colWidths.get(2)).toBe(180)
  })

  it('import replaces the sheet as a single command and export round-trips values', () => {
    const wb = new Workbook()
    wb.setCell(9, 9, 'old')
    wb.importCsv('name,qty\r\n"Widget, large",3\r\n')
    expect(wb.sheet.getRaw(0, 0)).toBe('name')
    expect(wb.sheet.getRaw(1, 0)).toBe('Widget, large')
    expect(wb.sheet.getValue(1, 1)).toBe(3)
    expect(wb.sheet.getRaw(9, 9)).toBe('')
    expect(wb.exportCsv()).toBe('name,qty\r\n"Widget, large",3\r\n')
    wb.undo()
    expect(wb.sheet.getRaw(9, 9)).toBe('old')
    expect(wb.sheet.getRaw(0, 0)).toBe('')
  })

  it('documents round-trip', () => {
    const wb = new Workbook()
    wb.setCell(0, 0, '=1+1')
    wb.setFormat({ r0: 0, c0: 0, r1: 0, c1: 0 }, { kind: 'number', decimals: 1 })
    wb.resize('row', 0, 40)
    const doc = wb.toDocument()
    const other = new Workbook()
    other.loadDocument(doc)
    expect(other.sheet.getValue(0, 0)).toBe(2)
    expect(other.sheet.getFormat(0, 0)).toEqual({ kind: 'number', decimals: 1 })
    expect(other.sheet.rowHeights.get(0)).toBe(40)
  })
})

describe('CSV codec (RFC 4180)', () => {
  const grid = [
    ['name', 'quote', 'note'],
    ['Widget, large', 'she said "hi"', 'line one\nline two'],
    ['', 'trailing,comma,', 'crlf\r\ninside'],
  ]
  it('round-trips a grid with quotes, commas and embedded newlines', () => {
    const csv = toCsv(grid)
    expect(parseCsv(csv)).toEqual(grid)
  })
  it('round-trips canonical text byte-for-byte', () => {
    const csv = 'name,quote,note\r\n"Widget, large","she said ""hi""","line one\nline two"\r\n,"trailing,comma,","crlf\r\ninside"\r\n'
    expect(toCsv(parseCsv(csv))).toBe(csv)
    expect(parseCsv(csv)).toEqual(grid)
  })
  it('accepts LF and CR line endings and a missing final newline', () => {
    expect(parseCsv('a,b\nc,d')).toEqual([['a', 'b'], ['c', 'd']])
    expect(parseCsv('a,b\rc,d\r')).toEqual([['a', 'b'], ['c', 'd']])
    expect(parseCsv('"a\r\nb",c')).toEqual([['a\r\nb', 'c']])
    expect(parseCsv('')).toEqual([])
    expect(parseCsv('﻿x,y\n')).toEqual([['x', 'y']])
  })
  it('TSV for the clipboard', () => {
    expect(toTsv([['a', 'b'], ['c\td', 'e']])).toBe('a\tb\n"c\td"\te')
    expect(parseTsv('a\tb\n"c\td"\te')).toEqual([['a', 'b'], ['c\td', 'e']])
  })
})
