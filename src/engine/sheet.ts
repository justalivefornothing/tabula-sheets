import { parseNumericString } from './coerce.ts'
import { evaluate, type EvalContext } from './evaluator.ts'
import { VOLATILE_FUNCTIONS } from './functions/index.ts'
import { DependencyGraph } from './graph.ts'
import { callsAny, collectRefs, ParseError, parseFormula, type Node } from './parser.ts'
import { cellKey, keyCol, keyRow, MAX_COLS, MAX_ROWS } from './refs.ts'
import { isError, makeError, type CellFormat, type Rect, type Scalar } from './types.ts'

export interface CellData {
  /** Exactly what the user typed (formulas start with '='). */
  raw: string
  /** Current computed (or literal) value. */
  value: Scalar
  /** Parsed formula, when raw is a syntactically valid formula. */
  ast?: Node
  isFormula: boolean
  format?: CellFormat
}

export interface CellEdit {
  row: number
  col: number
  /** Omit to leave the content untouched (format-only edit). */
  raw?: string
  /** `null` clears the format; omit to leave it untouched. */
  format?: CellFormat | null
}

export interface RecalcResult {
  /** Number of formula cells evaluated. */
  recomputed: number
  /** Wall-clock milliseconds. */
  ms: number
  /** Cells whose displayed value changed (for the UI flash). */
  changed: number[]
  /** Cells marked #CYCLE!. */
  cycles: number[]
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** Parse a literal (non-formula) input into a value plus an implied format. */
export function parseLiteral(raw: string): { value: Scalar; impliedFormat?: CellFormat } {
  if (raw === '') return { value: null }
  const upper = raw.trim().toUpperCase()
  if (upper === 'TRUE') return { value: true }
  if (upper === 'FALSE') return { value: false }
  // Plain numbers (including exponent forms) stay 'general'; symbols imply a format.
  if (/^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(raw)) return { value: Number(raw) }
  const n = parseNumericString(raw)
  if (n !== null) {
    const t = raw.trim()
    if (t.endsWith('%')) {
      const decimals = (t.match(/\.(\d+)%$/)?.[1].length ?? 0)
      return { value: n, impliedFormat: { kind: 'percent', decimals } }
    }
    if (t.includes('$')) return { value: n, impliedFormat: { kind: 'currency', decimals: 2 } }
    if (t.includes(',')) return { value: n, impliedFormat: { kind: 'number', decimals: t.includes('.') ? (t.split('.')[1]?.length ?? 0) : 0 } }
    return { value: n }
  }
  // A leading apostrophe forces text ('0123 keeps its zero).
  if (raw.startsWith("'")) return { value: raw.slice(1) }
  return { value: raw }
}

export function isFormulaInput(raw: string): boolean {
  return raw.length > 1 && raw[0] === '='
}

function valuesEqual(a: Scalar, b: Scalar): boolean {
  if (a === b) return true
  if (isError(a) && isError(b)) return a.code === b.code
  return false
}

export class Sheet {
  readonly cells = new Map<number, CellData>()
  readonly graph = new DependencyGraph()
  readonly colWidths = new Map<number, number>()
  readonly rowHeights = new Map<number, number>()
  /** Every formula cell, for full recalculation. */
  private readonly formulaKeys = new Set<number>()
  /** Formula cells calling TODAY()/RAND()/... which recompute on every pass. */
  private readonly volatileKeys = new Set<number>()
  /** Cells edited since the last recalculation. */
  private pending = new Set<number>()
  /** Total number of formula evaluations performed (used by tests and the bench). */
  evalCount = 0
  private extentStale = true
  private maxRow = -1
  private maxCol = -1
  private clock: () => Date = () => new Date()

  private readonly ctx: EvalContext = {
    getCell: (row, col) => {
      if (row < 0 || col < 0 || row >= MAX_ROWS || col >= MAX_COLS) return makeError('#REF!')
      return this.cells.get(cellKey(row, col))?.value ?? null
    },
    usedRows: () => this.usedRows(),
    usedCols: () => this.usedCols(),
    now: () => this.clock(),
  }

  /** Override the clock (tests pin TODAY()). */
  setClock(fn: () => Date): void {
    this.clock = fn
  }

  getCell(row: number, col: number): CellData | undefined {
    return this.cells.get(cellKey(row, col))
  }

  getValue(row: number, col: number): Scalar {
    return this.cells.get(cellKey(row, col))?.value ?? null
  }

  getRaw(row: number, col: number): string {
    return this.cells.get(cellKey(row, col))?.raw ?? ''
  }

  getFormat(row: number, col: number): CellFormat | undefined {
    return this.cells.get(cellKey(row, col))?.format
  }

  usedRows(): number {
    this.refreshExtent()
    return this.maxRow + 1
  }

  usedCols(): number {
    this.refreshExtent()
    return this.maxCol + 1
  }

  /** Bounding rectangle of non-empty cells, or null for an empty sheet. */
  usedRange(): Rect | null {
    this.refreshExtent()
    if (this.maxRow < 0) return null
    return { r0: 0, c0: 0, r1: this.maxRow, c1: this.maxCol }
  }

  private refreshExtent(): void {
    if (!this.extentStale) return
    let mr = -1
    let mc = -1
    for (const key of this.cells.keys()) {
      const r = keyRow(key)
      const c = keyCol(key)
      if (r > mr) mr = r
      if (c > mc) mc = c
    }
    this.maxRow = mr
    this.maxCol = mc
    this.extentStale = false
  }

  /** Set a single cell and recalculate. */
  set(row: number, col: number, raw: string): RecalcResult {
    this.stage({ row, col, raw })
    return this.recalc()
  }

  /** Apply many edits, then recalculate once. */
  setMany(edits: readonly CellEdit[]): RecalcResult {
    for (const e of edits) this.stage(e)
    return this.recalc()
  }

  /** Stage an edit without recalculating; call recalc() afterwards. */
  stage(edit: CellEdit): void {
    const { row, col } = edit
    if (row < 0 || col < 0 || row >= MAX_ROWS || col >= MAX_COLS) return
    const key = cellKey(row, col)
    const existing = this.cells.get(key)

    let format: CellFormat | undefined = existing?.format
    if (edit.format !== undefined) format = edit.format === null ? undefined : { ...edit.format }

    if (edit.raw === undefined) {
      // Format-only change
      if (existing) {
        existing.format = format
        if (format && Object.keys(format).length === 0) existing.format = undefined
      } else if (format && Object.keys(format).length > 0) {
        this.cells.set(key, { raw: '', value: null, isFormula: false, format })
        this.extentStale = true
      }
      return
    }

    const raw = edit.raw
    if (existing?.isFormula) {
      this.graph.clear(key)
      this.formulaKeys.delete(key)
      this.volatileKeys.delete(key)
    }

    if (raw === '' && (!format || Object.keys(format).length === 0)) {
      if (existing) {
        this.cells.delete(key)
        this.extentStale = true
      }
      this.pending.add(key)
      return
    }

    if (isFormulaInput(raw)) {
      const cell: CellData = { raw, value: null, isFormula: true, format }
      try {
        const ast = parseFormula(raw.slice(1))
        cell.ast = ast
        const { cells, ranges } = collectRefs(ast)
        const rects: Rect[] = ranges.map((r) => ({
          r0: r.start.row,
          c0: r.start.col,
          r1: Math.min(r.end.row, MAX_ROWS - 1),
          c1: Math.min(r.end.col, MAX_COLS - 1),
        }))
        this.graph.set(key, cells, rects)
        if (callsAny(ast, VOLATILE_FUNCTIONS)) this.volatileKeys.add(key)
      } catch (e) {
        const msg = e instanceof ParseError ? e.message : e instanceof Error ? e.message : String(e)
        cell.value = makeError('#ERROR!', msg)
      }
      this.formulaKeys.add(key)
      this.cells.set(key, cell)
    } else {
      const { value, impliedFormat } = parseLiteral(raw)
      const fmt = format ?? impliedFormat
      this.cells.set(key, { raw, value, isFormula: false, format: fmt })
    }
    this.extentStale = true
    this.pending.add(key)
  }

  /** Recalculate everything downstream of the staged edits. */
  recalc(): RecalcResult {
    const seeds = this.pending
    this.pending = new Set()
    for (const v of this.volatileKeys) seeds.add(v)
    return this.recalcFrom(seeds)
  }

  /** Mark every formula dirty and recompute the whole sheet. */
  recalcAll(): RecalcResult {
    this.pending = new Set()
    return this.recalcFrom(new Set(this.formulaKeys))
  }

  /**
   * Incremental recalculation:
   *   1. BFS from the seeds along dependent edges to collect the dirty formulas.
   *   2. Kahn's algorithm over the dirty subgraph: in-degree = number of dirty
   *      precedents; evaluate nodes as their in-degree hits zero.
   *   3. Whatever never reaches zero is part of (or downstream of) a cycle: #CYCLE!.
   */
  private recalcFrom(seeds: Set<number>): RecalcResult {
    const t0 = now()
    const dirty = new Set<number>()
    const depsCache = new Map<number, Set<number>>()
    const queue: number[] = []

    const dependentsOf = (key: number): Set<number> => {
      let d = depsCache.get(key)
      if (!d) {
        d = this.graph.dependentsOf(keyRow(key), keyCol(key))
        depsCache.set(key, d)
      }
      return d
    }

    for (const s of seeds) {
      if (this.formulaKeys.has(s) && !dirty.has(s)) {
        dirty.add(s)
      }
      queue.push(s)
    }
    for (let i = 0; i < queue.length; i++) {
      const k = queue[i]
      for (const d of dependentsOf(k)) {
        if (!dirty.has(d)) {
          dirty.add(d)
          queue.push(d)
        }
      }
    }

    const indeg = new Map<number, number>()
    for (const k of dirty) indeg.set(k, 0)
    for (const k of dirty) {
      for (const d of dependentsOf(k)) {
        if (dirty.has(d)) indeg.set(d, (indeg.get(d) ?? 0) + 1)
      }
    }

    const ready: number[] = []
    for (const [k, n] of indeg) if (n === 0) ready.push(k)

    const changed: number[] = []
    let recomputed = 0
    let head = 0
    while (head < ready.length) {
      const k = ready[head++]
      const cell = this.cells.get(k)
      if (cell) {
        const before = cell.value
        this.evaluateCell(k, cell)
        recomputed++
        if (!valuesEqual(before, cell.value)) changed.push(k)
      }
      indeg.delete(k)
      for (const d of dependentsOf(k)) {
        const n = indeg.get(d)
        if (n === undefined) continue
        if (n === 1) {
          indeg.set(d, 0)
          ready.push(d)
        } else indeg.set(d, n - 1)
      }
    }

    const cycles: number[] = []
    for (const k of indeg.keys()) {
      const cell = this.cells.get(k)
      if (!cell) continue
      cycles.push(k)
      const before = cell.value
      cell.value = makeError('#CYCLE!', 'This cell depends on itself')
      if (!valuesEqual(before, cell.value)) changed.push(k)
    }

    // Non-formula seeds that changed value are reported too (for the UI flash).
    for (const s of seeds) if (!dirty.has(s) && this.cells.has(s)) changed.push(s)

    return { recomputed, ms: now() - t0, changed, cycles }
  }

  private evaluateCell(key: number, cell: CellData): void {
    this.evalCount++
    if (!cell.ast) return // parse error: value already holds #ERROR!
    this.ctx.cell = { row: keyRow(key), col: keyCol(key) }
    cell.value = evaluate(cell.ast, this.ctx)
  }

  /** Iterate non-empty cells (raw content or format). */
  *entries(): IterableIterator<[number, CellData]> {
    yield* this.cells.entries()
  }

  formulaCount(): number {
    return this.formulaKeys.size
  }

  clear(): void {
    this.cells.clear()
    for (const k of this.formulaKeys) this.graph.clear(k)
    this.formulaKeys.clear()
    this.volatileKeys.clear()
    this.pending.clear()
    this.colWidths.clear()
    this.rowHeights.clear()
    this.extentStale = true
  }
}
