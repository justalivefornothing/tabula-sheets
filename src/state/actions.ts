import { loadSample } from '../data/samples.ts'
import { displayValue } from '../engine/format.ts'
import { cellKey, coordToA1, MAX_COLS, MAX_ROWS, rectCellCount, rectToA1 } from '../engine/refs.ts'
import { inferSmartFill, type SmartFillOutcome } from '../engine/smartfill.ts'
import type { CellFormat, Rect } from '../engine/types.ts'
import type { CellEdit } from '../engine/sheet.ts'
import { loadDocument, setLastSheetId } from './persist.ts'
import { activeCell, selectionRect, useStore, workbook, type EditMode, type Selection } from './store.ts'

type Move = 'down' | 'right' | 'up' | 'left' | 'none'

const store = (): ReturnType<typeof useStore.getState> => useStore.getState()

// ------------------------------------------------------------------ editing

export function startEditing(row: number, col: number, mode: EditMode, initialText?: string, source: 'cell' | 'bar' = 'cell'): void {
  const raw = workbook.sheet.getRaw(row, col)
  const text = initialText ?? raw
  store().setEditing({ row, col, text, caret: text.length, mode, source, refInsert: null })
}

export function updateEditing(text: string, caret: number): void {
  const ed = store().editing
  if (!ed) return
  store().setEditing({ ...ed, text, caret, refInsert: null })
}

export function setEditingCaret(caret: number): void {
  const ed = store().editing
  if (!ed || ed.caret === caret) return
  store().setEditing({ ...ed, caret, refInsert: ed.refInsert && caret === ed.refInsert.end ? ed.refInsert : null })
}

/** Insert (or replace the just-inserted) reference text at the caret while editing a formula. */
export function insertReference(refText: string): void {
  const ed = store().editing
  if (!ed) return
  const span = ed.refInsert ?? { start: ed.caret, end: ed.caret }
  const text = ed.text.slice(0, span.start) + refText + ed.text.slice(span.end)
  const end = span.start + refText.length
  store().setEditing({ ...ed, text, caret: end, refInsert: { start: span.start, end } })
}

export function commitEditing(move: Move = 'none'): void {
  const s = store()
  const ed = s.editing
  if (!ed) return
  s.setEditing(null)
  const current = workbook.sheet.getRaw(ed.row, ed.col)
  if (ed.text !== current) {
    const result = workbook.setCell(ed.row, ed.col, ed.text)
    if (result.cycles.length > 0) s.showToast(`Circular reference: ${result.cycles.length} cell${result.cycles.length > 1 ? 's' : ''} marked #CYCLE!`)
  }
  s.selectCell(ed.row, ed.col)
  if (move !== 'none') moveActive(move)
}

export function cancelEditing(): void {
  const s = store()
  const ed = s.editing
  if (!ed) return
  s.setEditing(null)
  s.selectCell(ed.row, ed.col)
}

// --------------------------------------------------------------- navigation

function clampRow(r: number): number {
  return Math.max(0, Math.min(MAX_ROWS - 1, r))
}
function clampCol(c: number): number {
  return Math.max(0, Math.min(MAX_COLS - 1, c))
}

export function moveActive(dir: Move, extend = false, step = 1): void {
  const s = store()
  const sel = s.selection
  const dr = dir === 'down' ? step : dir === 'up' ? -step : 0
  const dc = dir === 'right' ? step : dir === 'left' ? -step : 0
  if (extend) {
    const focus = { row: clampRow(sel.focus.row + dr), col: clampCol(sel.focus.col + dc) }
    s.setSelection({ anchor: sel.anchor, focus, mode: 'cells' })
  } else {
    const a = activeCell(sel)
    const next = { row: clampRow(a.row + dr), col: clampCol(a.col + dc) }
    s.selectCell(next.row, next.col)
  }
}

/** Ctrl+Arrow: jump to the edge of the current data block, like Excel. */
export function jumpActive(dir: Move, extend = false): void {
  const s = store()
  const sel = s.selection
  const from = extend ? sel.focus : activeCell(sel)
  const dr = dir === 'down' ? 1 : dir === 'up' ? -1 : 0
  const dc = dir === 'right' ? 1 : dir === 'left' ? -1 : 0
  const sheet = workbook.sheet
  const used = sheet.usedRange()
  const maxR = used ? used.r1 : 0
  const maxC = used ? used.c1 : 0
  const filled = (r: number, c: number): boolean => sheet.getRaw(r, c) !== ''
  let r = from.row
  let c = from.col
  const inBounds = (rr: number, cc: number): boolean => rr >= 0 && cc >= 0 && rr < MAX_ROWS && cc < MAX_COLS
  if (!inBounds(r + dr, c + dc)) return
  if (filled(r, c) && filled(r + dr, c + dc)) {
    while (inBounds(r + dr, c + dc) && filled(r + dr, c + dc)) {
      r += dr
      c += dc
    }
  } else {
    r += dr
    c += dc
    while (inBounds(r + dr, c + dc) && !filled(r, c) && r <= maxR + 1 && c <= maxC + 1) {
      r += dr
      c += dc
    }
    if (!filled(r, c)) {
      r = dr > 0 ? Math.max(from.row, maxR) : dr < 0 ? 0 : r
      c = dc > 0 ? Math.max(from.col, maxC) : dc < 0 ? 0 : c
      if (dr > 0 && r === from.row) r = MAX_ROWS - 1
      if (dc > 0 && c === from.col) c = MAX_COLS - 1
    }
  }
  const target = { row: clampRow(r), col: clampCol(c) }
  if (extend) s.setSelection({ anchor: sel.anchor, focus: target, mode: 'cells' })
  else s.selectCell(target.row, target.col)
}

export function selectAll(): void {
  const s = store()
  const a = activeCell(s.selection)
  s.setSelection({ anchor: a, focus: a, mode: 'all' })
}

export function selectRange(sel: Selection): void {
  store().setSelection(sel)
}

// ------------------------------------------------------------------ editing ops

export function clearSelection(): void {
  const rect = workbook.boundRect(selectionRect(store().selection))
  workbook.clearRange(rect)
}

export function undo(): void {
  const s = store()
  if (s.editing) cancelEditing()
  const r = workbook.undo()
  if (!r) s.showToast('Nothing to undo')
}

export function redo(): void {
  const s = store()
  if (s.editing) cancelEditing()
  const r = workbook.redo()
  if (!r) s.showToast('Nothing to redo')
}

export function applyFormat(patch: Partial<CellFormat>, label?: string): void {
  const rect = selectionRect(store().selection)
  workbook.setFormat(rect, patch, label)
}

export function toggleBold(): void {
  const a = activeCell(store().selection)
  const bold = workbook.sheet.getFormat(a.row, a.col)?.bold ?? false
  applyFormat({ bold: bold ? undefined : true }, bold ? 'Remove bold' : 'Bold')
}

export function setNumberFormat(kind: CellFormat['kind']): void {
  const a = activeCell(store().selection)
  const current = workbook.sheet.getFormat(a.row, a.col)
  const decimals = kind === 'percent' ? (current?.kind === 'percent' ? current.decimals : 0) : kind === 'number' || kind === 'currency' ? (current?.decimals ?? 2) : undefined
  const patch: Partial<CellFormat> = { kind: kind === 'general' ? undefined : kind, decimals, pattern: undefined }
  applyFormat(patch, `Format as ${kind}`)
}

export function changeDecimals(delta: number): void {
  const a = activeCell(store().selection)
  const current = workbook.sheet.getFormat(a.row, a.col)
  const kind = current?.kind && current.kind !== 'general' && current.kind !== 'text' && current.kind !== 'date' ? current.kind : 'number'
  const base = current?.decimals ?? (kind === 'percent' ? 0 : 2)
  const decimals = Math.max(0, Math.min(8, base + delta))
  applyFormat({ kind, decimals }, delta > 0 ? 'Increase decimals' : 'Decrease decimals')
}

export function setAlign(align: CellFormat['align']): void {
  applyFormat({ align }, `Align ${align}`)
}

// --------------------------------------------------------------- clipboard

export function copySelection(cut = false): string {
  const rect = selectionRect(store().selection)
  const payload = cut ? workbook.cut(rect) : workbook.copy(rect)
  const count = rectCellCount(workbook.boundRect(rect))
  store().showToast(`${cut ? 'Cut' : 'Copied'} ${count} cell${count === 1 ? '' : 's'}`)
  return payload.text
}

export function pasteText(text: string): void {
  const s = store()
  const rect = selectionRect(s.selection)
  const at = { row: rect.r0, col: rect.c0 }
  const result = workbook.paste(at, text, rect)
  if (result.recomputed === 0 && result.changed.length === 0 && text.trim() === '') s.showToast('Nothing to paste')
}

/** Copy via the async clipboard API (toolbar button); falls back to the internal clipboard. */
export async function copyToSystemClipboard(cut = false): Promise<void> {
  const text = copySelection(cut)
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    /* internal clipboard still works */
  }
}

export async function pasteFromSystemClipboard(): Promise<void> {
  let text: string | null = null
  try {
    text = await navigator.clipboard.readText()
  } catch {
    text = workbook.internalClipboard()?.text ?? null
  }
  if (text === null) {
    store().showToast('Clipboard is empty or unavailable — use Ctrl+V')
    return
  }
  pasteText(text)
}

// -------------------------------------------------------------------- fill

export function fillTo(target: Rect): void {
  const source = selectionRect(store().selection)
  const result = workbook.fill(source, target)
  if (result.changed.length > 0 || result.recomputed > 0) {
    store().setSelection({ anchor: { row: target.r0, col: target.c0 }, focus: { row: target.r1, col: target.c1 }, mode: 'cells' })
  }
}

/** Ctrl+D / Ctrl+R: fill the selection from its first row / column. */
export function fillSelection(direction: 'down' | 'right'): void {
  const rect = selectionRect(store().selection)
  if (rect.r1 >= MAX_ROWS - 1 || rect.c1 >= MAX_COLS - 1) return
  const source = direction === 'down' ? { ...rect, r1: rect.r0 } : { ...rect, c1: rect.c0 }
  if ((direction === 'down' && rect.r1 === rect.r0) || (direction === 'right' && rect.c1 === rect.c0)) return
  workbook.fill(source, rect)
}

// --------------------------------------------------------------------- CSV

export function importCsvText(text: string, fileName?: string): void {
  const s = store()
  if (s.editing) cancelEditing()
  const result = workbook.importCsv(text, fileName ? `Import ${fileName}` : 'Import CSV')
  if (fileName) {
    workbook.name = fileName.replace(/\.csv$/i, '')
    s.setSheetName(workbook.name)
  }
  s.selectCell(0, 0)
  s.showToast(`Imported ${result.changed.length.toLocaleString('en-US')} cells`)
}

export function exportCsvDownload(): void {
  const csv = workbook.exportCsv()
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${workbook.name.replace(/[^\w\- ]+/g, '').trim() || 'sheet'}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ------------------------------------------------------------------ sheets

function afterLoad(): void {
  const s = store()
  s.setEditing(null)
  s.selectCell(0, 0)
  s.setSmartFill({ inputs: null, outputCol: null })
  s.setGhost(new Map())
  s.setHome(false)
  s.setSheetName(workbook.name)
  setLastSheetId(workbook.id)
}

export function newSheet(): void {
  workbook.reset('Untitled sheet')
  afterLoad()
}

export function openSample(id: string): void {
  const doc = loadSample(id)
  if (!doc) return
  workbook.loadDocument(doc)
  afterLoad()
}

export async function openSaved(id: string): Promise<boolean> {
  const doc = await loadDocument(id)
  if (!doc) return false
  workbook.loadDocument(doc)
  afterLoad()
  return true
}

export function renameSheet(name: string): void {
  const trimmed = name.trim()
  if (!trimmed) return
  workbook.name = trimmed
  store().setSheetName(trimmed)
  // Nudge the autosave.
  workbook.execute('format', `Rename to ${trimmed}`, [])
}

// -------------------------------------------------------------- smart fill

export interface SmartFillView {
  inputs: Rect
  outputCol: number
  examples: Array<{ row: number; input: string; output: string }>
  remainingRows: number[]
  outcome: SmartFillOutcome | null
}

/** Gather examples (typed outputs next to inputs) and run the synthesizer. */
export function computeSmartFill(): SmartFillView | null {
  const s = store()
  const { inputs, outputCol } = s.smartFill
  if (!inputs || outputCol === null) return null
  const sheet = workbook.sheet
  const examples: SmartFillView['examples'] = []
  const remainingRows: number[] = []
  const r1 = Math.min(inputs.r1, inputs.r0 + 5000)
  for (let r = inputs.r0; r <= r1; r++) {
    const input = sheet.getCell(r, inputs.c0)
    const inputText = input ? String(input.raw.startsWith('=') ? displayOf(r, inputs.c0) : input.raw) : ''
    if (inputText === '') continue
    const out = sheet.getRaw(r, outputCol)
    if (out !== '') examples.push({ row: r, input: inputText, output: out })
    else remainingRows.push(r)
  }
  if (examples.length === 0) return { inputs, outputCol, examples, remainingRows, outcome: null }
  const remainingInputs = remainingRows.map((r) => {
    const cell = sheet.getCell(r, inputs.c0)
    return cell ? (cell.raw.startsWith('=') ? displayOf(r, inputs.c0) : cell.raw) : ''
  })
  const outcome = inferSmartFill(
    examples.map((e) => ({ input: e.input, output: e.output })),
    remainingInputs,
  )
  return { inputs, outputCol, examples, remainingRows, outcome }
}

function displayOf(row: number, col: number): string {
  const cell = workbook.sheet.getCell(row, col)
  return cell ? displayValue(cell.value, cell.format) : ''
}

export function setSmartFillFromSelection(what: 'inputs' | 'output'): void {
  const s = store()
  const rect = workbook.boundRect(selectionRect(s.selection))
  if (what === 'inputs') {
    const used = workbook.sheet.usedRange()
    let r1 = rect.r1
    if (rect.r1 - rect.r0 < 1 && used) {
      // A single cell: take the contiguous block below it as the input column.
      r1 = rect.r0
      while (r1 + 1 <= used.r1 && workbook.sheet.getRaw(r1 + 1, rect.c0) !== '') r1++
    }
    const inputs = { r0: rect.r0, c0: rect.c0, r1, c1: rect.c0 }
    const outputCol = s.smartFill.outputCol ?? Math.min(MAX_COLS - 1, rect.c0 + 1)
    s.setSmartFill({ inputs, outputCol })
    s.showToast(`Smart Fill inputs: ${rectToA1(inputs)}`)
  } else {
    s.setSmartFill({ outputCol: rect.c0 })
    s.showToast(`Smart Fill output column: ${coordToA1(0, rect.c0).replace(/\d+$/, '')}`)
  }
}

export function applySmartFill(view: SmartFillView): void {
  if (!view.outcome?.ok) return
  const edits: CellEdit[] = []
  view.remainingRows.forEach((r, i) => {
    const v = view.outcome && view.outcome.ok ? view.outcome.result.preview[i] : null
    if (v !== null && v !== undefined) edits.push({ row: r, col: view.outputCol, raw: v.startsWith('=') ? "'" + v : v })
  })
  if (edits.length === 0) return
  const rect = { r0: view.inputs.r0, c0: view.outputCol, r1: view.inputs.r1, c1: view.outputCol }
  workbook.execute('smartfill', `Smart Fill ${rectToA1(rect)} (${edits.length} cells)`, edits)
  store().setGhost(new Map())
  store().showToast(`Smart Fill applied to ${edits.length} cells`)
}

export function refreshGhost(view: SmartFillView | null): void {
  const s = store()
  const ghost = new Map<number, string>()
  if (view?.outcome?.ok) {
    view.remainingRows.forEach((r, i) => {
      const v = view.outcome && view.outcome.ok ? view.outcome.result.preview[i] : null
      if (v) ghost.set(cellKey(r, view.outputCol), v)
    })
  }
  const prev = s.ghost
  if (prev.size === ghost.size && [...ghost].every(([k, v]) => prev.get(k) === v)) return
  s.setGhost(ghost)
}
