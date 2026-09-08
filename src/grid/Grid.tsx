import { useEffect, useRef, type KeyboardEvent } from 'react'
import { ColoredInput } from '../components/ColoredInput.tsx'
import { cancelEditing, commitEditing, importCsvText, setEditingCaret, updateEditing } from '../state/actions.ts'
import { useStore } from '../state/store.ts'
import { GridController } from './controller.ts'

/**
 * The spreadsheet grid: a canvas for cells and headers, a transparent native
 * scroller on top for wheel/scrollbar/touch scrolling and mouse input, and a
 * DOM overlay hosting the in-cell editor.
 */
export function Grid() {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const spacerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<GridController | null>(null)
  const editing = useStore((s) => s.editing)

  useEffect(() => {
    const root = rootRef.current
    const canvas = canvasRef.current
    const scroller = scrollerRef.current
    const spacer = spacerRef.current
    const editor = editorRef.current
    if (!root || !canvas || !scroller || !spacer || !editor) return
    const controller = new GridController({ root, canvas, scroller, spacer, editor })
    controllerRef.current = controller
    scroller.focus({ preventScroll: true })
    return () => {
      controller.destroy()
      controllerRef.current = null
    }
  }, [])

  // Return focus to the grid when editing ends.
  useEffect(() => {
    if (!editing) {
      const active = document.activeElement
      if (!active || active === document.body || editorRef.current?.contains(active)) scrollerRef.current?.focus({ preventScroll: true })
    }
  }, [editing])

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    file.text().then((text) => importCsvText(text, file.name))
  }

  return (
    <div ref={rootRef} className="grid-root h-full w-full" onDrop={onDrop} data-testid="grid-root">
      <canvas ref={canvasRef} className="grid-canvas" aria-hidden="true" />
      <div
        ref={scrollerRef}
        className="grid-scroller"
        tabIndex={0}
        role="grid"
        aria-label="Spreadsheet grid, 100,000 rows by 52 columns"
        aria-rowcount={100000}
        aria-colcount={52}
      >
        <div ref={spacerRef} />
      </div>
      <div ref={editorRef} className="grid-editor" style={{ display: 'none' }}>
        {editing ? <CellEditor /> : null}
      </div>
    </div>
  )
}

function CellEditor() {
  const editing = useStore((s) => s.editing)
  if (!editing) return null

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    switch (e.key) {
      case 'Enter':
        e.preventDefault()
        commitEditing(e.shiftKey ? 'up' : 'down')
        return
      case 'Tab':
        e.preventDefault()
        commitEditing(e.shiftKey ? 'left' : 'right')
        return
      case 'Escape':
        e.preventDefault()
        cancelEditing()
        return
      case 'ArrowUp':
      case 'ArrowDown':
        if (editing.mode === 'typing') {
          e.preventDefault()
          commitEditing(e.key === 'ArrowUp' ? 'up' : 'down')
        }
        return
      case 'ArrowLeft':
      case 'ArrowRight':
        if (editing.mode === 'typing') {
          e.preventDefault()
          commitEditing(e.key === 'ArrowLeft' ? 'left' : 'right')
        }
        return
      default:
        return
    }
  }

  return (
    <ColoredInput
      value={editing.text}
      caret={editing.caret}
      autoFocus
      aria-label="Cell editor"
      className="h-full"
      onChange={updateEditing}
      onCaret={setEditingCaret}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        const next = e.relatedTarget as HTMLElement | null
        if (next && (next.hasAttribute('data-formula-bar-input') || next.closest('[data-keep-editing]'))) return
        if (!document.hasFocus()) return // window lost focus; keep the edit in progress
        // Clicking anywhere else commits, like a spreadsheet.
        if (useStore.getState().editing) commitEditing()
      }}
    />
  )
}
