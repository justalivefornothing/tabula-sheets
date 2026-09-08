import { canInsertReferenceAt, referencesInFormula } from '../engine/highlight.ts'
import { MAX_COLS, MAX_ROWS, rectToA1 } from '../engine/refs.ts'
import type { CellCoord, Rect } from '../engine/types.ts'
import {
  clearSelection,
  commitEditing,
  copySelection,
  fillSelection,
  fillTo,
  insertReference,
  jumpActive,
  moveActive,
  pasteText,
  redo,
  selectAll,
  startEditing,
  toggleBold,
  undo,
} from '../state/actions.ts'
import { activeCell, selectionRect, useStore, workbook } from '../state/store.ts'
import { DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT, GridLayout, HEADER_HEIGHT, MIN_COL_WIDTH, MIN_ROW_HEIGHT, rowHeaderWidth } from './layout.ts'
import { FLASH_MS, GridRenderer, type RefHighlight } from './renderer.ts'

type Zone = 'body' | 'colHeader' | 'rowHeader' | 'corner' | 'outside'

interface Hit {
  zone: Zone
  row: number
  col: number
  x: number
  y: number
}

type Drag =
  | { kind: 'select'; mode: 'cells' | 'rows' | 'cols' }
  | { kind: 'resize'; axis: 'col' | 'row'; index: number; startPos: number; startSize: number }
  | { kind: 'fill'; source: Rect }
  | { kind: 'ref'; start: CellCoord }

const RESIZE_GRIP = 5
const HANDLE_GRIP = 7

export interface GridElements {
  root: HTMLElement
  canvas: HTMLCanvasElement
  scroller: HTMLElement
  spacer: HTMLElement
  editor: HTMLElement
}

/**
 * Owns the canvas renderer, scroll position, mouse/keyboard interaction and
 * the editor overlay position. React only mounts the DOM and hands it over.
 */
export class GridController {
  readonly layout: GridLayout
  private readonly renderer: GridRenderer
  private scrollX = 0
  private scrollY = 0
  private width = 0
  private height = 0
  private headerW = rowHeaderWidth(MAX_ROWS)
  private readonly headerH = HEADER_HEIGHT
  private readonly flashes = new Map<number, number>()
  private drag: Drag | null = null
  private hoverResize: { axis: 'col' | 'row'; index: number } | null = null
  private fillPreview: Rect | null = null
  private raf = 0
  private autoScrollRaf = 0
  private lastMouse: { x: number; y: number } | null = null
  private readonly cleanups: Array<() => void> = []
  private readonly els: GridElements

  constructor(els: GridElements) {
    this.els = els
    this.layout = new GridLayout(MAX_ROWS, MAX_COLS, workbook.sheet.colWidths, workbook.sheet.rowHeights)
    this.renderer = new GridRenderer(els.canvas)
    this.updateSpacer()
    this.attach()
    this.measure()
    this.scheduleDraw()
  }

  // ------------------------------------------------------------- lifecycle

  private attach(): void {
    const { scroller, root } = this.els
    const on = <E extends Event>(el: HTMLElement | Document | Window, type: string, fn: (e: E) => void, opts?: AddEventListenerOptions): void => {
      const listener = fn as unknown as EventListener
      el.addEventListener(type, listener, opts)
      this.cleanups.push(() => el.removeEventListener(type, listener, opts))
    }
    on(scroller, 'scroll', () => this.onScroll())
    on(scroller, 'mousedown', (e: MouseEvent) => this.onMouseDown(e))
    on(scroller, 'dblclick', (e: MouseEvent) => this.onDoubleClick(e))
    on(scroller, 'mousemove', (e: MouseEvent) => this.onHover(e))
    on(scroller, 'mouseleave', () => this.setHoverResize(null))
    on(window, 'mousemove', (e: MouseEvent) => this.onMouseMove(e))
    on(window, 'mouseup', (e: MouseEvent) => this.onMouseUp(e))
    on(scroller, 'keydown', (e: KeyboardEvent) => this.onKeyDown(e))
    on(document, 'copy', (e: ClipboardEvent) => this.onClipboard(e, 'copy'))
    on(document, 'cut', (e: ClipboardEvent) => this.onClipboard(e, 'cut'))
    on(document, 'paste', (e: ClipboardEvent) => this.onClipboard(e, 'paste'))
    on(root, 'dragover', (e: DragEvent) => {
      e.preventDefault()
    })

    const ro = new ResizeObserver(() => {
      this.measure()
      this.scheduleDraw()
    })
    ro.observe(root)
    this.cleanups.push(() => ro.disconnect())

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onTheme = (): void => {
      this.renderer.refreshTheme()
      this.scheduleDraw()
    }
    mq.addEventListener('change', onTheme)
    this.cleanups.push(() => mq.removeEventListener('change', onTheme))

    this.cleanups.push(
      useStore.subscribe((state, prev) => {
        if (state.version !== prev.version) this.onWorkbookChanged()
        if (state.selection !== prev.selection && !this.drag) {
          const a = state.editing ? null : state.selection.focus
          if (a) this.ensureVisible(a.row, a.col)
        }
        if (state.editing !== prev.editing) this.positionEditor()
        this.scheduleDraw()
      }),
    )
    this.cleanups.push(
      workbook.subscribe((ev) => {
        if (ev.recalc) {
          const now = performance.now()
          const keys = ev.recalc.changed
          // Cap the flash set so a 50k-cell import does not stall the renderer.
          for (let i = 0; i < keys.length && i < 5000; i++) this.flashes.set(keys[i], now)
        }
      }),
    )
  }

  destroy(): void {
    for (const c of this.cleanups) c()
    this.cleanups.length = 0
    cancelAnimationFrame(this.raf)
    cancelAnimationFrame(this.autoScrollRaf)
  }

  private onWorkbookChanged(): void {
    this.layout.setColumnWidths(workbook.sheet.colWidths)
    this.layout.setRowHeights(workbook.sheet.rowHeights)
    this.updateSpacer()
    this.positionEditor()
  }

  private measure(): void {
    const rect = this.els.scroller.getBoundingClientRect()
    this.width = this.els.scroller.clientWidth || rect.width
    this.height = this.els.scroller.clientHeight || rect.height
    this.els.canvas.style.width = `${rect.width}px`
    this.els.canvas.style.height = `${rect.height}px`
  }

  private updateSpacer(): void {
    this.els.spacer.style.width = `${this.layout.totalWidth + this.headerW}px`
    this.els.spacer.style.height = `${this.layout.totalHeight + this.headerH}px`
  }

  // --------------------------------------------------------------- drawing

  scheduleDraw(): void {
    if (this.raf) return
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      this.draw()
    })
  }

  private refHighlights(): RefHighlight[] {
    const ed = useStore.getState().editing
    if (!ed || !ed.text.startsWith('=')) return []
    const colors = this.renderer.refColors()
    return referencesInFormula(ed.text).map((r) => ({ rect: r.rect, color: colors[r.colorIndex % colors.length] }))
  }

  private draw(): void {
    const state = useStore.getState()
    const now = performance.now()
    for (const [k, t] of this.flashes) if (now - t > FLASH_MS) this.flashes.delete(k)
    const sel = state.selection
    const rect = selectionRect(sel)
    this.renderer.draw({
      sheet: workbook.sheet,
      layout: this.layout,
      width: Math.ceil(this.els.canvas.getBoundingClientRect().width) || this.width,
      height: Math.ceil(this.els.canvas.getBoundingClientRect().height) || this.height,
      scrollX: this.scrollX,
      scrollY: this.scrollY,
      headerW: this.headerW,
      headerH: this.headerH,
      dpr: window.devicePixelRatio || 1,
      selection: rect,
      selectionMode: sel.mode,
      active: activeCell(sel),
      editing: state.editing ? { row: state.editing.row, col: state.editing.col } : null,
      refHighlights: this.refHighlights(),
      ghost: state.ghost,
      flashes: this.flashes,
      now,
      fillPreview: this.fillPreview,
      hoverResize: this.hoverResize,
    })
    if (this.flashes.size > 0) this.scheduleDraw()
  }

  // ---------------------------------------------------------------- scroll

  private onScroll(): void {
    this.scrollX = this.els.scroller.scrollLeft
    this.scrollY = this.els.scroller.scrollTop
    this.positionEditor()
    this.scheduleDraw()
  }

  ensureVisible(row: number, col: number): void {
    const bodyW = this.width - this.headerW
    const bodyH = this.height - this.headerH
    if (bodyW <= 0 || bodyH <= 0) return
    const { x, y } = this.layout.scrollToReveal(row, col, this.scrollX, this.scrollY, bodyW, bodyH)
    if (x !== this.scrollX || y !== this.scrollY) {
      this.els.scroller.scrollLeft = x
      this.els.scroller.scrollTop = y
    }
  }

  // ---------------------------------------------------------------- editor

  positionEditor(): void {
    const ed = useStore.getState().editing
    const el = this.els.editor
    if (!ed) {
      el.style.display = 'none'
      return
    }
    const x = this.headerW + this.layout.colLeft(ed.col) - this.scrollX
    const y = this.headerH + this.layout.rowTop(ed.row) - this.scrollY
    const w = this.layout.colWidth(ed.col)
    const h = this.layout.rowHeight(ed.row)
    // Grow to the right for long input, like a real spreadsheet.
    const needed = Math.min(this.width - x - 4, Math.max(w, measureText(ed.text, ed.text.startsWith('=') ? '13px "IBM Plex Mono", monospace' : '13px Inter, sans-serif') + 20))
    el.style.display = 'block'
    el.style.left = `${x - 1}px`
    el.style.top = `${y - 1}px`
    el.style.width = `${Math.max(w, needed) + 2}px`
    el.style.height = `${h + 2}px`
    el.classList.toggle('formula', ed.text.startsWith('='))
  }

  // ------------------------------------------------------------- hit tests

  private hit(e: MouseEvent): Hit {
    const rect = this.els.scroller.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    if (x < 0 || y < 0 || x > this.width || y > this.height) return { zone: 'outside', row: -1, col: -1, x, y }
    if (x < this.headerW && y < this.headerH) return { zone: 'corner', row: -1, col: -1, x, y }
    const col = this.layout.colAt(x - this.headerW + this.scrollX)
    const row = this.layout.rowAt(y - this.headerH + this.scrollY)
    if (y < this.headerH) return { zone: 'colHeader', row: -1, col, x, y }
    if (x < this.headerW) return { zone: 'rowHeader', row, col: -1, x, y }
    return { zone: 'body', row, col, x, y }
  }

  private resizeHit(h: Hit): { axis: 'col' | 'row'; index: number } | null {
    if (h.zone === 'colHeader') {
      const cx = h.x - this.headerW + this.scrollX
      const c = this.layout.colAt(cx)
      if (c < 0) return null
      const left = this.layout.colLeft(c)
      const right = left + this.layout.colWidth(c)
      if (right - cx <= RESIZE_GRIP) return { axis: 'col', index: c }
      if (cx - left <= RESIZE_GRIP && c > 0) return { axis: 'col', index: c - 1 }
    } else if (h.zone === 'rowHeader') {
      const cy = h.y - this.headerH + this.scrollY
      const r = this.layout.rowAt(cy)
      if (r < 0) return null
      const top = this.layout.rowTop(r)
      const bottom = top + this.layout.rowHeight(r)
      if (bottom - cy <= RESIZE_GRIP) return { axis: 'row', index: r }
      if (cy - top <= RESIZE_GRIP && r > 0) return { axis: 'row', index: r - 1 }
    }
    return null
  }

  private fillHandleHit(h: Hit): boolean {
    const state = useStore.getState()
    if (state.editing || state.selection.mode !== 'cells' || h.zone !== 'body') return false
    const rect = selectionRect(state.selection)
    const hx = this.headerW + this.layout.colLeft(rect.c1) + this.layout.colWidth(rect.c1) - this.scrollX
    const hy = this.headerH + this.layout.rowTop(rect.r1) + this.layout.rowHeight(rect.r1) - this.scrollY
    return Math.abs(h.x - hx) <= HANDLE_GRIP && Math.abs(h.y - hy) <= HANDLE_GRIP
  }

  private setHoverResize(v: { axis: 'col' | 'row'; index: number } | null): void {
    const changed = (v?.axis !== this.hoverResize?.axis) || v?.index !== this.hoverResize?.index
    this.hoverResize = v
    const cls = this.els.scroller.classList
    cls.toggle('resize-col', v?.axis === 'col')
    cls.toggle('resize-row', v?.axis === 'row')
    if (changed) this.scheduleDraw()
  }

  // ----------------------------------------------------------------- mouse

  private onHover(e: MouseEvent): void {
    if (this.drag) return
    const h = this.hit(e)
    const rs = this.resizeHit(h)
    this.setHoverResize(rs)
    const cls = this.els.scroller.classList
    cls.toggle('fill', !rs && this.fillHandleHit(h))
    cls.toggle('pointer', !rs && (h.zone === 'colHeader' || h.zone === 'rowHeader' || h.zone === 'corner'))
  }

  private onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return
    const h = this.hit(e)
    if (h.zone === 'outside') return
    const state = useStore.getState()
    const ed = state.editing

    // Clicking a cell while typing a formula inserts a reference.
    if (ed && h.zone === 'body' && h.row >= 0 && h.col >= 0) {
      const insertable = ed.refInsert !== null && ed.caret === ed.refInsert.end ? true : canInsertReferenceAt(ed.text, ed.caret)
      if (insertable && !(h.row === ed.row && h.col === ed.col)) {
        e.preventDefault() // keep focus in the editor
        insertReference(rectToA1({ r0: h.row, c0: h.col, r1: h.row, c1: h.col }))
        this.drag = { kind: 'ref', start: { row: h.row, col: h.col } }
        return
      }
    }
    if (ed) commitEditing()

    const rs = this.resizeHit(h)
    if (rs) {
      e.preventDefault()
      const startSize = rs.axis === 'col' ? this.layout.colWidth(rs.index) : this.layout.rowHeight(rs.index)
      this.drag = { kind: 'resize', axis: rs.axis, index: rs.index, startPos: rs.axis === 'col' ? e.clientX : e.clientY, startSize }
      return
    }

    if (this.fillHandleHit(h)) {
      e.preventDefault()
      this.drag = { kind: 'fill', source: selectionRect(state.selection) }
      this.fillPreview = null
      return
    }

    this.els.scroller.focus({ preventScroll: true })
    e.preventDefault()
    const sel = state.selection
    if (h.zone === 'corner') {
      selectAll()
      return
    }
    if (h.zone === 'colHeader' && h.col >= 0) {
      const anchor = e.shiftKey ? sel.anchor : { row: 0, col: h.col }
      useStore.getState().setSelection({ anchor: { row: anchor.row, col: anchor.col }, focus: { row: 0, col: h.col }, mode: 'cols' })
      this.drag = { kind: 'select', mode: 'cols' }
      return
    }
    if (h.zone === 'rowHeader' && h.row >= 0) {
      const anchor = e.shiftKey ? sel.anchor : { row: h.row, col: 0 }
      useStore.getState().setSelection({ anchor, focus: { row: h.row, col: 0 }, mode: 'rows' })
      this.drag = { kind: 'select', mode: 'rows' }
      return
    }
    if (h.zone === 'body' && h.row >= 0 && h.col >= 0) {
      if (e.shiftKey) {
        useStore.getState().setSelection({ anchor: sel.anchor, focus: { row: h.row, col: h.col }, mode: 'cells' })
      } else {
        useStore.getState().selectCell(h.row, h.col)
      }
      this.drag = { kind: 'select', mode: 'cells' }
    }
  }

  private onDoubleClick(e: MouseEvent): void {
    const h = this.hit(e)
    const rs = this.resizeHit(h)
    if (rs) {
      this.autoFit(rs.axis, rs.index)
      return
    }
    if (h.zone === 'body' && h.row >= 0 && h.col >= 0 && !useStore.getState().editing) {
      startEditing(h.row, h.col, 'full')
    }
  }

  private onMouseMove(e: MouseEvent): void {
    const d = this.drag
    if (!d) return
    const h = this.hit(e)
    this.lastMouse = { x: h.x, y: h.y }
    if (d.kind === 'resize') {
      const delta = (d.axis === 'col' ? e.clientX : e.clientY) - d.startPos
      const size = Math.max(d.axis === 'col' ? MIN_COL_WIDTH : MIN_ROW_HEIGHT, Math.round(d.startSize + delta))
      const map = d.axis === 'col' ? workbook.sheet.colWidths : workbook.sheet.rowHeights
      map.set(d.index, size)
      this.onWorkbookChanged()
      this.scheduleDraw()
      return
    }
    const cell = this.cellUnderPointer(h)
    if (!cell) {
      this.startAutoScroll()
      return
    }
    this.stopAutoScroll()
    this.applyDragTo(cell, h)
  }

  /** Cell under the pointer, clamped to the sheet when dragging past the headers. */
  private cellUnderPointer(h: Hit): CellCoord | null {
    const cx = Math.max(0, h.x - this.headerW) + this.scrollX
    const cy = Math.max(0, h.y - this.headerH) + this.scrollY
    if (h.x > this.width || h.y > this.height || h.x < this.headerW - 40 || h.y < this.headerH - 40) return null
    let col = this.layout.colAt(cx)
    let row = this.layout.rowAt(cy)
    if (col < 0) col = cx < 0 ? 0 : MAX_COLS - 1
    if (row < 0) row = cy < 0 ? 0 : MAX_ROWS - 1
    return { row, col }
  }

  private applyDragTo(cell: CellCoord, h: Hit): void {
    const d = this.drag
    if (!d) return
    const state = useStore.getState()
    if (d.kind === 'select') {
      const sel = state.selection
      const focus =
        d.mode === 'cols' ? { row: 0, col: cell.col } : d.mode === 'rows' ? { row: cell.row, col: 0 } : cell
      if (focus.row !== sel.focus.row || focus.col !== sel.focus.col) {
        state.setSelection({ anchor: sel.anchor, focus, mode: d.mode })
      }
    } else if (d.kind === 'fill') {
      const src = d.source
      // Extend in the dominant direction only.
      const dRow = cell.row > src.r1 ? cell.row - src.r1 : cell.row < src.r0 ? cell.row - src.r0 : 0
      const dCol = cell.col > src.c1 ? cell.col - src.c1 : cell.col < src.c0 ? cell.col - src.c0 : 0
      let target: Rect
      if (Math.abs(dRow) >= Math.abs(dCol)) {
        target = dRow > 0 ? { ...src, r1: cell.row } : dRow < 0 ? { ...src, r0: cell.row } : src
      } else {
        target = dCol > 0 ? { ...src, c1: cell.col } : { ...src, c0: cell.col }
      }
      this.fillPreview = target
      this.scheduleDraw()
    } else if (d.kind === 'ref') {
      const r0 = Math.min(d.start.row, cell.row)
      const r1 = Math.max(d.start.row, cell.row)
      const c0 = Math.min(d.start.col, cell.col)
      const c1 = Math.max(d.start.col, cell.col)
      insertReference(rectToA1({ r0, c0, r1, c1 }))
    }
    void h
  }

  private startAutoScroll(): void {
    if (this.autoScrollRaf) return
    const step = (): void => {
      this.autoScrollRaf = 0
      const m = this.lastMouse
      if (!this.drag || !m) return
      const speed = 14
      let dx = 0
      let dy = 0
      if (m.x > this.width) dx = speed
      else if (m.x < this.headerW) dx = -speed
      if (m.y > this.height) dy = speed
      else if (m.y < this.headerH) dy = -speed
      if (dx || dy) {
        this.els.scroller.scrollLeft += dx
        this.els.scroller.scrollTop += dy
        this.scrollX = this.els.scroller.scrollLeft
        this.scrollY = this.els.scroller.scrollTop
        const clampedHit: Hit = { zone: 'body', row: -1, col: -1, x: Math.min(Math.max(m.x, this.headerW), this.width - 1), y: Math.min(Math.max(m.y, this.headerH), this.height - 1) }
        const cell = this.cellUnderPointer(clampedHit)
        if (cell) this.applyDragTo(cell, clampedHit)
        this.autoScrollRaf = requestAnimationFrame(step)
      }
    }
    this.autoScrollRaf = requestAnimationFrame(step)
  }

  private stopAutoScroll(): void {
    if (this.autoScrollRaf) cancelAnimationFrame(this.autoScrollRaf)
    this.autoScrollRaf = 0
  }

  private onMouseUp(_e: MouseEvent): void {
    const d = this.drag
    if (!d) return
    this.drag = null
    this.stopAutoScroll()
    if (d.kind === 'resize') {
      const map = d.axis === 'col' ? workbook.sheet.colWidths : workbook.sheet.rowHeights
      const size = map.get(d.index)
      // Restore the pre-drag size, then record the change through the command log.
      if (d.startSize === (d.axis === 'col' ? DEFAULT_COL_WIDTH : DEFAULT_ROW_HEIGHT)) map.delete(d.index)
      else map.set(d.index, d.startSize)
      if (size !== undefined && size !== d.startSize) workbook.resize(d.axis, d.index, size)
      else this.onWorkbookChanged()
      this.scheduleDraw()
    } else if (d.kind === 'fill') {
      const target = this.fillPreview
      this.fillPreview = null
      if (target) fillTo(target)
      this.scheduleDraw()
    } else if (d.kind === 'ref') {
      // Keep editing; focus stays in the editor input.
      const ed = useStore.getState().editing
      if (ed) this.focusEditor()
    }
  }

  private focusEditor(): void {
    const input = this.els.editor.querySelector('input') ?? document.querySelector<HTMLInputElement>('[data-formula-bar-input]')
    input?.focus()
  }

  // ------------------------------------------------------------- auto-fit

  autoFit(axis: 'col' | 'row', index: number): void {
    if (axis === 'col') {
      const used = workbook.sheet.usedRange()
      const rows: number[] = []
      if (used) for (let r = used.r0; r <= Math.min(used.r1, used.r0 + 5000); r++) rows.push(r)
      const w = this.renderer.measureColumn(workbook.sheet, index, rows)
      const size = w === 0 ? undefined : Math.max(MIN_COL_WIDTH, Math.ceil(w) + 14)
      workbook.resize('col', index, size)
    } else {
      workbook.resize('row', index, undefined)
    }
  }

  // -------------------------------------------------------------- keyboard

  private onKeyDown(e: KeyboardEvent): void {
    const state = useStore.getState()
    if (state.editing) return // the editor input handles its own keys
    const ctrl = e.ctrlKey || e.metaKey
    const sel = state.selection
    const a = activeCell(sel)
    const key = e.key

    const handled = (): void => {
      e.preventDefault()
      e.stopPropagation()
    }

    if (ctrl) {
      switch (key.toLowerCase()) {
        case 'z':
          handled()
          if (e.shiftKey) redo()
          else undo()
          return
        case 'y':
          handled()
          redo()
          return
        case 'a':
          handled()
          selectAll()
          return
        case 'b':
          handled()
          toggleBold()
          return
        case 'd':
          handled()
          fillSelection('down')
          return
        case 'r':
          handled()
          fillSelection('right')
          return
        case 'home':
          handled()
          state.selectCell(0, 0)
          return
        case 'end': {
          handled()
          const used = workbook.sheet.usedRange()
          state.selectCell(used?.r1 ?? 0, used?.c1 ?? 0)
          return
        }
        case 'arrowdown':
        case 'arrowup':
        case 'arrowleft':
        case 'arrowright':
          handled()
          jumpActive(key === 'ArrowDown' ? 'down' : key === 'ArrowUp' ? 'up' : key === 'ArrowLeft' ? 'left' : 'right', e.shiftKey)
          return
        default:
          return // let copy/cut/paste events through
      }
    }

    switch (key) {
      case 'ArrowDown':
        handled()
        moveActive('down', e.shiftKey)
        return
      case 'ArrowUp':
        handled()
        moveActive('up', e.shiftKey)
        return
      case 'ArrowLeft':
        handled()
        moveActive('left', e.shiftKey)
        return
      case 'ArrowRight':
        handled()
        moveActive('right', e.shiftKey)
        return
      case 'Tab':
        handled()
        moveActive(e.shiftKey ? 'left' : 'right')
        return
      case 'Enter':
        handled()
        if (e.altKey) startEditing(a.row, a.col, 'full')
        else moveActive(e.shiftKey ? 'up' : 'down')
        return
      case 'PageDown':
      case 'PageUp': {
        handled()
        const rowsPerPage = Math.max(1, Math.floor((this.height - this.headerH) / DEFAULT_ROW_HEIGHT) - 1)
        moveActive(key === 'PageDown' ? 'down' : 'up', e.shiftKey, rowsPerPage)
        return
      }
      case 'Home':
        handled()
        state.selectCell(a.row, 0)
        return
      case 'End': {
        handled()
        const used = workbook.sheet.usedRange()
        state.selectCell(a.row, used?.c1 ?? 0)
        return
      }
      case 'F2':
        handled()
        startEditing(a.row, a.col, 'full')
        return
      case 'Delete':
      case 'Backspace':
        handled()
        clearSelection()
        return
      case 'Escape':
        handled()
        state.selectCell(a.row, a.col)
        return
      default:
        break
    }
    // Printable character: start editing in "typing" mode with that character.
    if (key.length === 1 && !e.altKey) {
      handled()
      startEditing(a.row, a.col, 'typing', key)
    }
  }

  // ------------------------------------------------------------- clipboard

  private onClipboard(e: ClipboardEvent, kind: 'copy' | 'cut' | 'paste'): void {
    const active = document.activeElement
    const state = useStore.getState()
    if (state.editing) return // native behaviour inside the editor
    const inGrid = active === this.els.scroller || active === document.body || this.els.root.contains(active)
    if (!inGrid) return
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return
    e.preventDefault()
    if (kind === 'paste') {
      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (text !== '') pasteText(text)
      else {
        const internal = workbook.internalClipboard()
        if (internal) pasteText(internal.text)
      }
      return
    }
    const text = copySelection(kind === 'cut')
    e.clipboardData?.setData('text/plain', text)
  }

}

let measureCanvas: CanvasRenderingContext2D | null = null
function measureText(text: string, font: string): number {
  if (!measureCanvas) measureCanvas = document.createElement('canvas').getContext('2d')
  if (!measureCanvas) return text.length * 7
  measureCanvas.font = font
  return measureCanvas.measureText(text).width
}
