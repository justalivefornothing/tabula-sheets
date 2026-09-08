import { create } from 'zustand'
import { MAX_COLS, MAX_ROWS, rectFromCoords } from '../engine/refs.ts'
import type { CellCoord, Rect } from '../engine/types.ts'
import { Workbook } from '../engine/workbook.ts'

/** The single workbook instance. It is a plain object; the store tracks a version counter. */
export const workbook = new Workbook()

export type SelectionMode = 'cells' | 'rows' | 'cols' | 'all'

export interface Selection {
  anchor: CellCoord
  focus: CellCoord
  mode: SelectionMode
}

export type EditMode = 'typing' | 'full'

export interface EditingState {
  row: number
  col: number
  text: string
  caret: number
  /** 'typing' started by typing over the cell (arrows commit); 'full' via F2/double-click (arrows move the caret). */
  mode: EditMode
  source: 'cell' | 'bar'
  /** Span of the reference most recently inserted by clicking a cell, so dragging can extend it. */
  refInsert: { start: number; end: number } | null
}

export type Panel = 'history' | 'smartfill' | null

export interface SmartFillConfig {
  inputs: Rect | null
  outputCol: number | null
}

export interface UIState {
  /** Incremented whenever the workbook changes; components subscribe to re-render. */
  version: number
  selection: Selection
  editing: EditingState | null
  panel: Panel
  home: boolean
  status: { recomputed: number; ms: number }
  saveState: 'saved' | 'saving' | 'unsaved' | 'error' | 'off'
  toast: { text: string; id: number } | null
  smartFill: SmartFillConfig
  /** Smart Fill preview text keyed by cell key, drawn as ghost text in the grid. */
  ghost: ReadonlyMap<number, string>
  sheetName: string

  bump(): void
  setSelection(selection: Selection): void
  selectCell(row: number, col: number): void
  setEditing(editing: EditingState | null): void
  setPanel(panel: Panel): void
  setHome(home: boolean): void
  setStatus(status: { recomputed: number; ms: number }): void
  setSaveState(s: UIState['saveState']): void
  showToast(text: string): void
  setSmartFill(cfg: Partial<SmartFillConfig>): void
  setGhost(ghost: ReadonlyMap<number, string>): void
  setSheetName(name: string): void
}

let toastId = 0

export const useStore = create<UIState>()((set) => ({
  version: 0,
  selection: { anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 }, mode: 'cells' },
  editing: null,
  panel: null,
  home: false,
  status: { recomputed: 0, ms: 0 },
  saveState: 'saved',
  toast: null,
  smartFill: { inputs: null, outputCol: null },
  ghost: new Map(),
  sheetName: workbook.name,

  bump: () => set((s) => ({ version: s.version + 1 })),
  setSelection: (selection) => set({ selection }),
  selectCell: (row, col) => set({ selection: { anchor: { row, col }, focus: { row, col }, mode: 'cells' } }),
  setEditing: (editing) => set({ editing }),
  setPanel: (panel) => set({ panel }),
  setHome: (home) => set({ home }),
  setStatus: (status) => set({ status }),
  setSaveState: (saveState) => set({ saveState }),
  showToast: (text) => {
    const id = ++toastId
    set({ toast: { text, id } })
    setTimeout(() => set((s) => (s.toast?.id === id ? { toast: null } : {})), 2600)
  },
  setSmartFill: (cfg) => set((s) => ({ smartFill: { ...s.smartFill, ...cfg } })),
  setGhost: (ghost) => set({ ghost }),
  setSheetName: (sheetName) => set({ sheetName }),
}))

/** Rectangle covered by a selection (whole rows/columns span the sheet). */
export function selectionRect(sel: Selection): Rect {
  const r = rectFromCoords(sel.anchor, sel.focus)
  switch (sel.mode) {
    case 'rows':
      return { r0: r.r0, r1: r.r1, c0: 0, c1: MAX_COLS - 1 }
    case 'cols':
      return { c0: r.c0, c1: r.c1, r0: 0, r1: MAX_ROWS - 1 }
    case 'all':
      return { r0: 0, c0: 0, r1: MAX_ROWS - 1, c1: MAX_COLS - 1 }
    default:
      return r
  }
}

/** The active cell: the anchor, clamped inside the sheet. */
export function activeCell(sel: Selection): CellCoord {
  return { row: Math.min(sel.anchor.row, MAX_ROWS - 1), col: Math.min(sel.anchor.col, MAX_COLS - 1) }
}

// Keep the store in sync with engine changes.
workbook.subscribe((ev) => {
  const s = useStore.getState()
  s.bump()
  if (ev.recalc) s.setStatus({ recomputed: ev.recalc.recomputed, ms: ev.recalc.ms })
  if (ev.kind === 'load') s.setSheetName(workbook.name)
})
