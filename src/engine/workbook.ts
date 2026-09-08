import { CommandLog, type CellSnapshot, type Command, type CommandKind, type LayoutChange } from './commands.ts'
import { parseCsv, parseTsv, toCsv, toTsv } from './csv.ts'
import { displayValue } from './format.ts'
import { cellKey, keyCol, keyRow, MAX_COLS, MAX_ROWS, rectCellCount, rectToA1 } from './refs.ts'
import { shiftFormula } from './rewrite.ts'
import { inferSeries } from './series.ts'
import { isFormulaInput, Sheet, type CellEdit, type RecalcResult } from './sheet.ts'
import type { CellCoord, CellFormat, Rect } from './types.ts'

export interface ChangeEvent {
  kind: 'cells' | 'layout' | 'history' | 'load'
  recalc?: RecalcResult
  command?: Command
}

export interface SheetDocument {
  version: 1
  id: string
  name: string
  cells: Array<[row: number, col: number, raw: string, format?: CellFormat]>
  colWidths: Array<[index: number, width: number]>
  rowHeights: Array<[index: number, height: number]>
  updatedAt: number
}

export interface ClipboardPayload {
  /** Plain text for the system clipboard (TSV of displayed values). */
  text: string
  /** Where the cells came from, so formulas can be shifted on paste. */
  origin: Rect
  cells: CellSnapshot[]
  cut: boolean
}

const EMPTY_RESULT: RecalcResult = { recomputed: 0, ms: 0, changed: [], cycles: [] }

function randomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

/**
 * A sheet plus its command log: every mutation goes through `execute`, which
 * snapshots the affected cells before and after so it can be undone in one step.
 */
export class Workbook {
  readonly sheet = new Sheet()
  readonly log = new CommandLog()
  id = randomId()
  name = 'Untitled sheet'
  private clipboard: ClipboardPayload | null = null
  private readonly listeners = new Set<(ev: ChangeEvent) => void>()
  lastRecalc: RecalcResult = EMPTY_RESULT

  subscribe(fn: (ev: ChangeEvent) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(ev: ChangeEvent): void {
    for (const l of this.listeners) l(ev)
  }

  // ---------------------------------------------------------------- snapshots

  snapshot(coords: Iterable<CellCoord>): CellSnapshot[] {
    const out: CellSnapshot[] = []
    for (const { row, col } of coords) {
      const cell = this.sheet.getCell(row, col)
      const snap: CellSnapshot = { row, col, raw: cell?.raw ?? '' }
      if (cell?.format) snap.format = { ...cell.format }
      out.push(snap)
    }
    return out
  }

  private applySnapshots(snaps: readonly CellSnapshot[]): RecalcResult {
    const edits: CellEdit[] = snaps.map((s) => ({ row: s.row, col: s.col, raw: s.raw, format: s.format ?? null }))
    return this.sheet.setMany(edits)
  }

  /** Run a batch of edits as a single undoable command. */
  execute(kind: CommandKind, label: string, edits: readonly CellEdit[], layout?: LayoutChange[]): RecalcResult {
    const coords = new Map<number, CellCoord>()
    for (const e of edits) coords.set(cellKey(e.row, e.col), { row: e.row, col: e.col })
    const before = this.snapshot(coords.values())
    const result = this.sheet.setMany(edits)
    const after = this.snapshot(coords.values())
    if (layout) for (const l of layout) this.applyLayout(l.axis, l.index, l.after)
    const command = this.log.push({ kind, label, before, after, layout })
    this.lastRecalc = result
    this.emit({ kind: 'cells', recalc: result, command })
    return result
  }

  undo(): RecalcResult | null {
    const cmd = this.log.undo()
    if (!cmd) return null
    const result = this.applySnapshots(cmd.before)
    if (cmd.layout) for (const l of cmd.layout) this.applyLayout(l.axis, l.index, l.before)
    this.lastRecalc = result
    this.emit({ kind: 'history', recalc: result, command: cmd })
    return result
  }

  redo(): RecalcResult | null {
    const cmd = this.log.redo()
    if (!cmd) return null
    const result = this.applySnapshots(cmd.after)
    if (cmd.layout) for (const l of cmd.layout) this.applyLayout(l.axis, l.index, l.after)
    this.lastRecalc = result
    this.emit({ kind: 'history', recalc: result, command: cmd })
    return result
  }

  // ------------------------------------------------------------- basic edits

  setCell(row: number, col: number, raw: string): RecalcResult {
    const current = this.sheet.getRaw(row, col)
    if (current === raw) return EMPTY_RESULT
    const label = raw === '' ? `Clear ${rectToA1({ r0: row, c0: col, r1: row, c1: col })}` : `Edit ${rectToA1({ r0: row, c0: col, r1: row, c1: col })}`
    return this.execute('edit', label, [{ row, col, raw }])
  }

  clearRange(rect: Rect): RecalcResult {
    const edits: CellEdit[] = []
    for (const [key, cell] of this.cellsIn(rect)) {
      if (cell.raw !== '') edits.push({ row: keyRow(key), col: keyCol(key), raw: '' })
    }
    if (edits.length === 0) return EMPTY_RESULT
    return this.execute('clear', `Clear ${rectToA1(rect)}`, edits)
  }

  /** Merge a format patch into every cell of a rectangle (bounded to the used area for whole rows/cols). */
  setFormat(rect: Rect, patch: Partial<CellFormat>, label?: string): RecalcResult {
    const bounded = this.boundRect(rect)
    const edits: CellEdit[] = []
    for (let r = bounded.r0; r <= bounded.r1; r++) {
      for (let c = bounded.c0; c <= bounded.c1; c++) {
        const existing = this.sheet.getFormat(r, c) ?? {}
        const next: CellFormat = { ...existing, ...patch }
        for (const k of Object.keys(next) as (keyof CellFormat)[]) if (next[k] === undefined) delete next[k]
        edits.push({ row: r, col: c, format: Object.keys(next).length ? next : null })
      }
    }
    if (edits.length === 0) return EMPTY_RESULT
    return this.execute('format', label ?? `Format ${rectToA1(rect)}`, edits)
  }

  /** Clamp a rectangle to the used area plus the selection's own extent (never 100k rows). */
  boundRect(rect: Rect): Rect {
    const used = this.sheet.usedRange()
    const maxR = Math.max(used?.r1 ?? 0, 0)
    const maxC = Math.max(used?.c1 ?? 0, 0)
    return {
      r0: rect.r0,
      c0: rect.c0,
      r1: rect.r1 >= MAX_ROWS - 1 ? Math.max(maxR, rect.r0) : rect.r1,
      c1: rect.c1 >= MAX_COLS - 1 ? Math.max(maxC, rect.c0) : rect.c1,
    }
  }

  private *cellsIn(rect: Rect): IterableIterator<[number, { raw: string; format?: CellFormat }]> {
    const count = rectCellCount(rect)
    if (count > this.sheet.cells.size * 4) {
      for (const [key, cell] of this.sheet.cells) {
        const r = keyRow(key)
        const c = keyCol(key)
        if (r >= rect.r0 && r <= rect.r1 && c >= rect.c0 && c <= rect.c1) yield [key, cell]
      }
      return
    }
    for (let r = rect.r0; r <= rect.r1; r++) {
      for (let c = rect.c0; c <= rect.c1; c++) {
        const cell = this.sheet.getCell(r, c)
        if (cell) yield [cellKey(r, c), cell]
      }
    }
  }

  // -------------------------------------------------------------------- fill

  /**
   * Fill from `source` into `target` (target contains source). Formulas are
   * shifted relative to their source cell; runs of plain values extend as a
   * series when the seeds form one, otherwise they repeat.
   */
  fill(source: Rect, target: Rect): RecalcResult {
    const edits: CellEdit[] = []
    const down = target.r1 > source.r1
    const up = target.r0 < source.r0
    const right = target.c1 > source.c1
    const left = target.c0 < source.c0
    if (!down && !up && !right && !left) return EMPTY_RESULT

    const vertical = down || up
    const lanes = vertical ? range(source.c0, source.c1) : range(source.r0, source.r1)
    const seedIdx = vertical ? range(source.r0, source.r1) : range(source.c0, source.c1)
    const forward = down || right
    const from = vertical ? (forward ? source.r1 + 1 : target.r0) : forward ? source.c1 + 1 : target.c0
    const to = vertical ? (forward ? target.r1 : source.r0 - 1) : forward ? target.c1 : source.c0 - 1

    for (const lane of lanes) {
      const seeds = seedIdx.map((i) => (vertical ? this.sheet.getCell(i, lane) : this.sheet.getCell(lane, i)))
      const seedRaws = seeds.map((s) => s?.raw ?? '')
      const anyFormula = seedRaws.some(isFormulaInput)
      const anyEmpty = seedRaws.some((s) => s === '')
      const orderedSeeds = forward ? seedRaws : seedRaws.slice().reverse()
      const series = !anyFormula && !anyEmpty ? inferSeries(orderedSeeds) : null
      const n = seeds.length
      let k = 0
      for (let pos = forward ? from : to; forward ? pos <= to : pos >= from; pos += forward ? 1 : -1, k++) {
        const srcOffset = forward ? k % n : n - 1 - (k % n)
        const seed = seeds[srcOffset]
        const seedPos = seedIdx[srcOffset]
        let raw: string
        if (series) raw = series(k)
        else raw = shiftFormula(seed?.raw ?? '', vertical ? pos - seedPos : 0, vertical ? 0 : pos - seedPos)
        const row = vertical ? pos : lane
        const col = vertical ? lane : pos
        edits.push({ row, col, raw, format: seed?.format ? { ...seed.format } : null })
      }
    }
    if (edits.length === 0) return EMPTY_RESULT
    return this.execute('fill', `Fill ${rectToA1(target)}`, edits)
  }

  // --------------------------------------------------------------- clipboard

  /** Copy a rectangle: returns the payload (text for the system clipboard). */
  copy(rect: Rect, cut = false): ClipboardPayload {
    const bounded = this.boundRect(rect)
    const rows: string[][] = []
    const cells: CellSnapshot[] = []
    for (let r = bounded.r0; r <= bounded.r1; r++) {
      const line: string[] = []
      for (let c = bounded.c0; c <= bounded.c1; c++) {
        const cell = this.sheet.getCell(r, c)
        line.push(cell ? displayValue(cell.value, cell.format) : '')
        const snap: CellSnapshot = { row: r, col: c, raw: cell?.raw ?? '' }
        if (cell?.format) snap.format = { ...cell.format }
        cells.push(snap)
      }
      rows.push(line)
    }
    this.clipboard = { text: toTsv(rows), origin: bounded, cells, cut }
    return this.clipboard
  }

  cut(rect: Rect): ClipboardPayload {
    return this.copy(rect, true)
  }

  /** The last in-app copy, used when the system clipboard text still matches it. */
  internalClipboard(): ClipboardPayload | null {
    return this.clipboard
  }

  /**
   * Paste at `at`. If `text` matches the internal clipboard the original raw
   * formulas are pasted with their references shifted; otherwise the text is
   * parsed as TSV. A single copied cell tiles over a multi-cell target.
   */
  paste(at: CellCoord, text: string, target?: Rect): RecalcResult {
    const internal = this.clipboard && this.clipboard.text === text ? this.clipboard : null
    const edits: CellEdit[] = []
    if (internal) {
      const { origin, cells } = internal
      const h = origin.r1 - origin.r0 + 1
      const w = origin.c1 - origin.c0 + 1
      const reps = tileCount(target, at, h, w)
      if (internal.cut) {
        for (const s of cells) edits.push({ row: s.row, col: s.col, raw: '', format: null })
      }
      for (let tr = 0; tr < reps.rows; tr++) {
        for (let tc = 0; tc < reps.cols; tc++) {
          const dRow = at.row + tr * h - origin.r0
          const dCol = at.col + tc * w - origin.c0
          for (const s of cells) {
            const row = s.row + dRow
            const col = s.col + dCol
            if (row >= MAX_ROWS || col >= MAX_COLS) continue
            // Cut moves formulas without rewriting them (they still point at the same cells).
            const raw = internal.cut ? s.raw : shiftFormula(s.raw, dRow, dCol)
            edits.push({ row, col, raw, format: s.format ? { ...s.format } : null })
          }
        }
      }
      if (internal.cut) this.clipboard = { ...internal, cut: false, origin: { r0: at.row, c0: at.col, r1: at.row + h - 1, c1: at.col + w - 1 }, cells: cells.map((s) => ({ ...s, row: s.row + at.row - origin.r0, col: s.col + at.col - origin.c0 })) }
    } else {
      const rows = parseTsv(text.replace(/\r?\n$/, ''))
      if (rows.length === 0) return EMPTY_RESULT
      const h = rows.length
      const w = Math.max(...rows.map((r) => r.length))
      const reps = tileCount(target, at, h, w)
      for (let tr = 0; tr < reps.rows; tr++) {
        for (let tc = 0; tc < reps.cols; tc++) {
          for (let r = 0; r < h; r++) {
            for (let c = 0; c < rows[r].length; c++) {
              const row = at.row + tr * h + r
              const col = at.col + tc * w + c
              if (row >= MAX_ROWS || col >= MAX_COLS) continue
              edits.push({ row, col, raw: rows[r][c] })
            }
          }
        }
      }
    }
    if (edits.length === 0) return EMPTY_RESULT
    const dest = pasteRect(edits)
    return this.execute(internal?.cut ? 'cut' : 'paste', `${internal?.cut ? 'Move to' : 'Paste'} ${rectToA1(dest)}`, edits)
  }

  // --------------------------------------------------------------------- CSV

  importCsv(text: string, label = 'Import CSV'): RecalcResult {
    const rows = parseCsv(text)
    const edits: CellEdit[] = []
    const touched = new Set<number>()
    for (let r = 0; r < rows.length && r < MAX_ROWS; r++) {
      for (let c = 0; c < rows[r].length && c < MAX_COLS; c++) {
        edits.push({ row: r, col: c, raw: rows[r][c], format: null })
        touched.add(cellKey(r, c))
      }
    }
    for (const key of this.sheet.cells.keys()) {
      if (!touched.has(key)) edits.push({ row: keyRow(key), col: keyCol(key), raw: '', format: null })
    }
    if (edits.length === 0) return EMPTY_RESULT
    return this.execute('import', `${label} (${rows.length} rows)`, edits)
  }

  exportCsv(): string {
    const used = this.sheet.usedRange()
    if (!used) return ''
    const rows: string[][] = []
    for (let r = used.r0; r <= used.r1; r++) {
      const line: string[] = []
      for (let c = used.c0; c <= used.c1; c++) {
        const cell = this.sheet.getCell(r, c)
        line.push(cell ? displayValue(cell.value, cell.format) : '')
      }
      rows.push(line)
    }
    return toCsv(rows)
  }

  // ------------------------------------------------------------------ layout

  private applyLayout(axis: 'col' | 'row', index: number, size: number | undefined): void {
    const map = axis === 'col' ? this.sheet.colWidths : this.sheet.rowHeights
    if (size === undefined) map.delete(index)
    else map.set(index, size)
    this.emit({ kind: 'layout' })
  }

  resize(axis: 'col' | 'row', index: number, size: number | undefined): void {
    const map = axis === 'col' ? this.sheet.colWidths : this.sheet.rowHeights
    const before = map.get(index)
    if (before === size) return
    const change: LayoutChange = { axis, index, before, after: size }
    this.applyLayout(axis, index, size)
    const what = axis === 'col' ? `column ${rectToA1({ r0: 0, c0: index, r1: MAX_ROWS - 1, c1: index })}` : `row ${index + 1}`
    const command = this.log.push({ kind: 'resize', label: `Resize ${what}`, before: [], after: [], layout: [change] })
    this.emit({ kind: 'history', command })
  }

  // --------------------------------------------------------------- documents

  toDocument(): SheetDocument {
    const cells: SheetDocument['cells'] = []
    for (const [key, cell] of this.sheet.entries()) {
      const entry: SheetDocument['cells'][number] = [keyRow(key), keyCol(key), cell.raw]
      if (cell.format) entry.push({ ...cell.format })
      cells.push(entry)
    }
    return {
      version: 1,
      id: this.id,
      name: this.name,
      cells,
      colWidths: [...this.sheet.colWidths.entries()],
      rowHeights: [...this.sheet.rowHeights.entries()],
      updatedAt: Date.now(),
    }
  }

  /** Replace the whole workbook state (no undo entry; the history is reset). */
  loadDocument(doc: SheetDocument): RecalcResult {
    this.sheet.clear()
    this.log.clear()
    this.clipboard = null
    this.id = doc.id
    this.name = doc.name
    for (const [row, col, raw, format] of doc.cells) this.sheet.stage({ row, col, raw, format: format ?? null })
    for (const [i, w] of doc.colWidths) this.sheet.colWidths.set(i, w)
    for (const [i, h] of doc.rowHeights) this.sheet.rowHeights.set(i, h)
    const result = this.sheet.recalc()
    this.lastRecalc = result
    this.emit({ kind: 'load', recalc: result })
    return result
  }

  /** Start a fresh, empty sheet. */
  reset(name = 'Untitled sheet'): void {
    this.loadDocument({ version: 1, id: randomId(), name, cells: [], colWidths: [], rowHeights: [], updatedAt: Date.now() })
  }
}

function range(a: number, b: number): number[] {
  const out: number[] = []
  for (let i = a; i <= b; i++) out.push(i)
  return out
}

function tileCount(target: Rect | undefined, at: CellCoord, h: number, w: number): { rows: number; cols: number } {
  if (!target) return { rows: 1, cols: 1 }
  const th = target.r1 - target.r0 + 1
  const tw = target.c1 - target.c0 + 1
  if (target.r0 !== at.row || target.c0 !== at.col) return { rows: 1, cols: 1 }
  if (th >= MAX_ROWS - 1 || tw >= MAX_COLS - 1) return { rows: 1, cols: 1 }
  return {
    rows: th % h === 0 ? th / h : 1,
    cols: tw % w === 0 ? tw / w : 1,
  }
}

function pasteRect(edits: readonly CellEdit[]): Rect {
  let r0 = Infinity
  let c0 = Infinity
  let r1 = -1
  let c1 = -1
  for (const e of edits) {
    if (e.row < r0) r0 = e.row
    if (e.col < c0) c0 = e.col
    if (e.row > r1) r1 = e.row
    if (e.col > c1) c1 = e.col
  }
  return { r0, c0, r1, c1 }
}
