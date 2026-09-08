import { useEffect, useState } from 'react'
import { SAMPLES } from '../data/samples.ts'
import { newSheet, openSample, openSaved } from '../state/actions.ts'
import { deleteDocument, listDocuments, storageAvailable, type SavedSheetInfo } from '../state/persist.ts'
import { useStore, workbook } from '../state/store.ts'
import { CloseIcon, GridIcon, Logo, PlusIcon, TrashIcon } from './Icons.tsx'

const SAMPLE_ART: Record<string, string> = {
  sales: 'M2 14 6 9l3 3 5-7',
  grades: 'M3 13V6M7 13V3M11 13V8M15 13v-3',
  contacts: 'M8 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM3 14c.6-2.6 2.5-4 5-4s4.4 1.4 5 4',
}

/** Home overlay: samples, saved sheets and a blank sheet. Dismissable when a sheet is open. */
export function StartScreen() {
  const home = useStore((s) => s.home)
  const setHome = useStore((s) => s.setHome)
  const [saved, setSaved] = useState<SavedSheetInfo[]>([])

  useEffect(() => {
    if (!home || !storageAvailable()) return
    let alive = true
    listDocuments()
      .then((docs) => {
        if (alive) setSaved(docs)
      })
      .catch(() => setSaved([]))
    return () => {
      alive = false
    }
  }, [home])

  useEffect(() => {
    if (!home) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setHome(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [home, setHome])

  if (!home) return null

  const remove = async (id: string): Promise<void> => {
    await deleteDocument(id)
    setSaved((list) => list.filter((d) => d.id !== id))
  }

  return (
    <div className="absolute inset-0 z-30 bg-paper/85 backdrop-blur-sm flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-y-auto fade-in" role="dialog" aria-modal="true" aria-labelledby="home-title">
      <div className="w-full max-w-[860px] bg-surface border border-line rounded-2xl shadow-[var(--shadow)] p-5 sm:p-8 relative">
        <button type="button" className="tb-btn absolute right-3 top-3" onClick={() => setHome(false)} aria-label="Close">
          <CloseIcon />
        </button>
        <div className="flex items-center gap-3">
          <Logo size={34} />
          <div>
            <h1 id="home-title" className="text-[22px] font-semibold tracking-tight text-ink leading-tight">
              Tabula
            </h1>
            <p className="text-ink-soft text-[13px]">A spreadsheet built from first principles — formula engine, dependency graph, canvas grid and offline Smart Fill.</p>
          </div>
        </div>

        <h2 className="mt-7 mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Sample sheets</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {SAMPLES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => openSample(s.id)}
              className="group text-left panel-card p-4 hover:border-green hover:shadow-[var(--shadow)] transition-all duration-150 flex flex-col gap-2 bg-paper"
            >
              <span className="w-9 h-9 rounded-lg bg-green-tint text-green grid place-items-center group-hover:bg-green group-hover:text-white transition-colors">
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={SAMPLE_ART[s.id]} />
                </svg>
              </span>
              <span className="font-semibold text-ink text-[14px]">{s.name}</span>
              <span className="text-ink-soft text-[12px] leading-relaxed">{s.blurb}</span>
            </button>
          ))}
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-[1fr_260px] gap-4">
          <section>
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Saved on this device</h2>
            {!storageAvailable() ? (
              <p className="text-ink-muted text-[12.5px]">IndexedDB is unavailable in this browser, so sheets live only in memory.</p>
            ) : saved.length === 0 ? (
              <p className="text-ink-muted text-[12.5px]">Nothing saved yet. Sheets autosave to IndexedDB as you edit.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line border border-line rounded-lg overflow-hidden max-h-[220px] overflow-y-auto thin-scroll">
                {saved.map((d) => (
                  <li key={d.id} className={`flex items-center gap-2 px-3 py-2 hover:bg-surface-2 ${d.id === workbook.id ? 'bg-green-tint' : ''}`}>
                    <GridIcon className="text-ink-muted shrink-0" />
                    <button type="button" className="flex-1 min-w-0 text-left" onClick={() => void openSaved(d.id)}>
                      <span className="block text-[13px] text-ink truncate font-medium">{d.name}</span>
                      <span className="block text-[11px] text-ink-muted">
                        {d.cellCount.toLocaleString('en-US')} cells · {new Date(d.updatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                        {d.id === workbook.id ? ' · open' : ''}
                      </span>
                    </button>
                    <button type="button" className="tb-btn" onClick={() => void remove(d.id)} aria-label={`Delete ${d.name}`} title="Delete">
                      <TrashIcon />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Start fresh</h2>
            <button
              type="button"
              onClick={newSheet}
              className="h-10 rounded-lg bg-green text-white font-medium text-[13px] flex items-center justify-center gap-2 hover:bg-green-strong active:translate-y-px transition"
            >
              <PlusIcon /> New blank sheet
            </button>
            <p className="text-[11.5px] text-ink-muted leading-relaxed">
              100,000 rows × 52 columns. Drop a CSV onto the grid to import it. Everything runs locally; nothing leaves your browser.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
