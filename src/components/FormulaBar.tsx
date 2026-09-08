import { useEffect, useState, type KeyboardEvent } from 'react'
import { isRangeRef, parseRangeOrCell, rectToA1 } from '../engine/refs.ts'
import { cancelEditing, commitEditing, setEditingCaret, startEditing, updateEditing } from '../state/actions.ts'
import { activeCell, selectionRect, useStore, workbook } from '../state/store.ts'
import { ColoredInput } from './ColoredInput.tsx'

export function FormulaBar() {
  const selection = useStore((s) => s.selection)
  const editing = useStore((s) => s.editing)
  const version = useStore((s) => s.version)
  const setSelection = useStore((s) => s.setSelection)
  void version

  const a = activeCell(selection)
  const rect = selectionRect(selection)
  const address = rectToA1(rect)
  const [nameDraft, setNameDraft] = useState(address)
  const [nameFocused, setNameFocused] = useState(false)
  useEffect(() => {
    if (!nameFocused) setNameDraft(address)
  }, [address, nameFocused])

  const raw = workbook.sheet.getRaw(a.row, a.col)
  const text = editing ? editing.text : raw
  const cell = workbook.sheet.getCell(a.row, a.col)
  const errorMessage = cell && typeof cell.value === 'object' && cell.value !== null ? cell.value.message : undefined

  const jumpTo = (): void => {
    const parsed = parseRangeOrCell(nameDraft.trim())
    if (!parsed) {
      setNameDraft(address)
      return
    }
    if (isRangeRef(parsed)) {
      setSelection({
        anchor: { row: parsed.start.row, col: parsed.start.col },
        focus: { row: parsed.end.row, col: parsed.end.col },
        mode: parsed.wholeCol ? 'cols' : parsed.wholeRow ? 'rows' : 'cells',
      })
    } else {
      setSelection({ anchor: { row: parsed.row, col: parsed.col }, focus: { row: parsed.row, col: parsed.col }, mode: 'cells' })
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitEditing(e.shiftKey ? 'up' : 'down')
    } else if (e.key === 'Tab') {
      e.preventDefault()
      commitEditing(e.shiftKey ? 'left' : 'right')
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelEditing()
    }
  }

  return (
    <div className="flex items-stretch h-8 border-b border-line bg-surface" data-keep-editing>
      <input
        className="w-[92px] sm:w-[110px] shrink-0 border-r border-line bg-transparent px-2 text-[12.5px] font-medium text-ink tabular-nums outline-none focus-visible:bg-green-tint"
        value={nameDraft}
        aria-label="Cell name box"
        title="Name box: type a cell or range and press Enter"
        spellCheck={false}
        onFocus={(e) => {
          setNameFocused(true)
          e.target.select()
        }}
        onBlur={() => {
          setNameFocused(false)
          setNameDraft(address)
        }}
        onChange={(e) => setNameDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            jumpTo()
            ;(e.target as HTMLInputElement).blur()
          }
          if (e.key === 'Escape') (e.target as HTMLInputElement).blur()
        }}
      />
      <div className="flex items-center px-2 border-r border-line text-ink-muted font-mono text-[12px] italic select-none" aria-hidden="true">
        fx
      </div>
      <div className="flex-1 min-w-0 relative">
        <ColoredInput
          value={text}
          caret={editing?.source === 'bar' ? editing.caret : undefined}
          placeholder={editing ? '' : 'Type a value or a formula starting with ='}
          aria-label="Formula bar"
          className="h-8 [&_input]:h-8 [&_.mirror]:leading-8 [&_input]:leading-8"
          inputProps={{ 'data-formula-bar-input': 'true' }}
          onFocus={() => {
            if (!useStore.getState().editing) startEditing(a.row, a.col, 'full', raw, 'bar')
            else {
              const ed = useStore.getState().editing
              if (ed && ed.source !== 'bar') useStore.getState().setEditing({ ...ed, source: 'bar' })
            }
          }}
          onChange={(t, caret) => {
            if (!useStore.getState().editing) startEditing(a.row, a.col, 'full', t, 'bar')
            else updateEditing(t, caret)
          }}
          onCaret={(c) => {
            if (useStore.getState().editing) setEditingCaret(c)
          }}
          onKeyDown={onKeyDown}
          onBlur={(e) => {
            const next = e.relatedTarget as HTMLElement | null
            if (next && next.closest('.grid-editor')) return
            if (!document.hasFocus()) return
            const ed = useStore.getState().editing
            if (ed && ed.source === 'bar' && !(next && next.closest('.grid-scroller'))) commitEditing()
          }}
        />
        {errorMessage && !editing ? (
          <div className="absolute right-2 top-0 h-8 flex items-center text-[11.5px] text-error truncate max-w-[50%] pointer-events-none" title={errorMessage}>
            {errorMessage}
          </div>
        ) : null}
      </div>
    </div>
  )
}
