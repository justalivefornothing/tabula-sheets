import { useMemo } from 'react'
import { formatGeneralNumber } from '../engine/coerce.ts'
import { keyCol, keyRow, MAX_COLS, MAX_ROWS, rectCellCount, rectToA1 } from '../engine/refs.ts'
import { selectionRect, useStore, workbook } from '../state/store.ts'

interface Stats {
  sum: number
  count: number
  numeric: number
  min: number
  max: number
}

function statsFor(): Stats {
  const sel = useStore.getState().selection
  const rect = selectionRect(sel)
  const sheet = workbook.sheet
  const stats: Stats = { sum: 0, count: 0, numeric: 0, min: Infinity, max: -Infinity }
  const visit = (v: unknown): void => {
    if (v === null || v === undefined || v === '') return
    stats.count++
    if (typeof v === 'number') {
      stats.numeric++
      stats.sum += v
      if (v < stats.min) stats.min = v
      if (v > stats.max) stats.max = v
    }
  }
  if (rectCellCount(rect) > 20_000) {
    for (const [key, cell] of sheet.cells) {
      const r = keyRow(key)
      const c = keyCol(key)
      if (r >= rect.r0 && r <= rect.r1 && c >= rect.c0 && c <= rect.c1) visit(cell.value)
    }
  } else {
    for (let r = rect.r0; r <= rect.r1; r++) for (let c = rect.c0; c <= rect.c1; c++) visit(sheet.getValue(r, c))
  }
  return stats
}

const fmt = (n: number): string => {
  const s = formatGeneralNumber(Math.round(n * 1e6) / 1e6)
  const [i, f] = s.split('.')
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return f ? `${grouped}.${f}` : grouped
}

export function StatusBar() {
  const selection = useStore((s) => s.selection)
  const version = useStore((s) => s.version)
  const status = useStore((s) => s.status)
  const saveState = useStore((s) => s.saveState)
  const stats = useMemo(() => statsFor(), [selection, version])
  const rect = selectionRect(selection)
  const cells = rectCellCount(rect)
  const wide = cells > 1

  return (
    <footer className="flex items-center gap-4 h-7 px-3 border-t border-line bg-surface text-[11.5px] text-ink-soft tabular-nums select-none overflow-hidden" role="status">
      <span className="font-medium text-ink min-w-[60px]">{rectToA1(rect)}</span>
      {wide ? (
        <div className="flex items-center gap-3 overflow-hidden whitespace-nowrap">
          {stats.numeric > 0 ? (
            <>
              <Stat label="Sum" value={fmt(stats.sum)} />
              <Stat label="Avg" value={fmt(stats.sum / stats.numeric)} />
              <Stat label="Min" value={fmt(stats.min)} className="hidden md:inline-flex" />
              <Stat label="Max" value={fmt(stats.max)} className="hidden md:inline-flex" />
            </>
          ) : null}
          <Stat label="Count" value={String(stats.count)} />
        </div>
      ) : null}
      <span className="ml-auto flex items-center gap-3 whitespace-nowrap">
        <span className="hidden sm:inline" title="Only cells downstream of an edit are recomputed (Kahn's algorithm over the dirty subgraph)">
          recomputed <span className="text-ink font-medium">{status.recomputed.toLocaleString('en-US')}</span> cell{status.recomputed === 1 ? '' : 's'} in{' '}
          <span className="text-ink font-medium">{status.ms < 0.05 ? '<0.1' : status.ms.toFixed(status.ms < 10 ? 1 : 0)} ms</span>
        </span>
        <span className="hidden lg:inline text-ink-muted">
          {MAX_ROWS.toLocaleString('en-US')} × {MAX_COLS}
        </span>
        <SaveDot state={saveState} />
      </span>
    </footer>
  )
}

function Stat({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <span className={`inline-flex items-baseline gap-1 ${className}`}>
      <span className="text-ink-muted">{label}</span>
      <span className="text-ink font-medium">{value}</span>
    </span>
  )
}

function SaveDot({ state }: { state: string }) {
  const label = state === 'saved' ? 'Saved locally' : state === 'saving' ? 'Saving…' : state === 'unsaved' ? 'Unsaved changes' : state === 'off' ? 'Storage unavailable' : 'Save failed'
  const color = state === 'saved' ? 'bg-green' : state === 'error' ? 'bg-error' : state === 'off' ? 'bg-ink-muted' : 'bg-amber'
  return (
    <span className="inline-flex items-center gap-1.5" title={label}>
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${color}`} />
      <span className="hidden sm:inline">{label}</span>
    </span>
  )
}
