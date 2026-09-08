import { useEffect } from 'react'
import { Drawer } from './components/Drawer.tsx'
import { FormulaBar } from './components/FormulaBar.tsx'
import { StartScreen } from './components/StartScreen.tsx'
import { StatusBar } from './components/StatusBar.tsx'
import { Toolbar } from './components/Toolbar.tsx'
import { Grid } from './grid/Grid.tsx'
import { isRangeRef, lettersToCol, parseRangeOrCell, rangeRect } from './engine/refs.ts'
import { openSample, openSaved, setSmartFillFromSelection } from './state/actions.ts'
import { getLastSheetId, startAutosave, storageAvailable } from './state/persist.ts'
import { useStore } from './state/store.ts'

let booted = false

/**
 * Open the last sheet worked on, or the Sales ledger sample on a first visit.
 * Query parameters allow deep links: ?sample=contacts&panel=smartfill&select=F2:F17&home=1
 */
async function boot(): Promise<void> {
  const params = new URLSearchParams(window.location.search)
  const sample = params.get('sample')
  const panel = params.get('panel')
  const select = params.get('select')
  const store = useStore.getState()

  if (sample) {
    openSample(sample)
  } else {
    const last = storageAvailable() ? getLastSheetId() : null
    let opened = false
    if (last) {
      try {
        opened = await openSaved(last)
      } catch {
        opened = false
      }
    }
    if (!opened) openSample('sales')
  }
  if (panel === 'smartfill' || panel === 'history') store.setPanel(panel)
  if (select) {
    const parsed = parseRangeOrCell(select)
    if (parsed) {
      const rect = isRangeRef(parsed) ? rangeRect(parsed) : { r0: parsed.row, c0: parsed.col, r1: parsed.row, c1: parsed.col }
      store.setSelection({ anchor: { row: rect.r0, col: rect.c0 }, focus: { row: rect.r1, col: rect.c1 }, mode: 'cells' })
      if (panel === 'smartfill') {
        setSmartFillFromSelection('inputs')
        const output = params.get('output')
        const outCol = output ? lettersToCol(output) : -1
        if (outCol >= 0) store.setSmartFill({ outputCol: outCol })
      }
    }
  }
  if (params.get('home') === '1') store.setHome(true)
}

export default function App() {
  const toast = useStore((s) => s.toast)

  useEffect(() => {
    if (booted) return
    booted = true
    void boot()
    const stop = startAutosave()
    return () => {
      stop()
      booted = false
    }
  }, [])

  return (
    <div className="h-full flex flex-col bg-paper text-ink overflow-hidden">
      <Toolbar />
      <FormulaBar />
      <div className="flex-1 min-h-0 flex relative">
        <main className="flex-1 min-w-0 relative">
          <Grid />
        </main>
        <Drawer />
      </div>
      <StatusBar />
      <StartScreen />
      {toast ? (
        <div className="pointer-events-none absolute left-1/2 bottom-10 -translate-x-1/2 z-40 toast-enter" role="status" aria-live="polite">
          <div className="rounded-full bg-ink text-paper text-[12.5px] px-4 py-1.5 shadow-[var(--shadow)]">{toast.text}</div>
        </div>
      ) : null}
    </div>
  )
}
