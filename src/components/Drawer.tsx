import { useEffect, useMemo } from 'react'
import type { Command } from '../engine/commands.ts'
import { colToLetters, rectToA1 } from '../engine/refs.ts'
import { applySmartFill, computeSmartFill, refreshGhost, setSmartFillFromSelection, type SmartFillView } from '../state/actions.ts'
import { useStore, workbook } from '../state/store.ts'
import { CloseIcon, HistoryIcon, SparkIcon } from './Icons.tsx'

export const SMART_FILL_DISCLAIMER = 'Local pattern inference, no AI model. Tabula searches a small transformation language for the simplest program that reproduces every example, then verifies it on all of them.'

export function Drawer() {
  const panel = useStore((s) => s.panel)
  const setPanel = useStore((s) => s.setPanel)
  if (!panel) return null
  return (
    <aside
      className="absolute inset-y-0 right-0 z-10 w-full max-w-[340px] md:static md:w-[340px] shrink-0 border-l border-line bg-surface flex flex-col shadow-[var(--shadow)] md:shadow-none fade-in"
      aria-label={panel === 'history' ? 'History panel' : 'Smart Fill panel'}
    >
      <div className="flex items-center gap-2 h-10 px-3 border-b border-line">
        {panel === 'history' ? <HistoryIcon className="text-green" /> : <SparkIcon className="text-green" />}
        <h2 className="font-semibold text-[13px] text-ink">{panel === 'history' ? 'History' : 'Smart Fill'}</h2>
        {panel === 'smartfill' ? <span className="text-[10.5px] text-ink-muted hidden sm:inline">local pattern inference · no AI model</span> : null}
        <button type="button" className="tb-btn ml-auto -mr-1" onClick={() => setPanel(null)} aria-label="Close panel">
          <CloseIcon />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto thin-scroll">{panel === 'history' ? <HistoryPanel /> : <SmartFillPanel />}</div>
    </aside>
  )
}

// ------------------------------------------------------------------ history

const KIND_LABEL: Record<Command['kind'], string> = {
  edit: 'Edit',
  clear: 'Clear',
  fill: 'Fill',
  paste: 'Paste',
  cut: 'Move',
  import: 'Import',
  format: 'Format',
  resize: 'Resize',
  smartfill: 'Smart Fill',
  sort: 'Sort',
}

function HistoryPanel() {
  const version = useStore((s) => s.version)
  void version
  const entries = workbook.log.list()
  const cursor = workbook.log.position()

  const jumpTo = (target: number): void => {
    // Undo or redo until the cursor sits at `target`.
    let guard = 0
    while (workbook.log.position() > target && guard++ < 10_000) workbook.undo()
    while (workbook.log.position() < target && guard++ < 10_000) workbook.redo()
  }

  if (entries.length === 0) {
    return (
      <div className="p-4 text-[12.5px] text-ink-soft leading-relaxed">
        <p>Every change you make is appended to a command log. Multi-cell operations — a fill, a paste, a CSV import — are a single entry, so they undo in one step.</p>
        <p className="mt-2 text-ink-muted">
          <span className="kbd">Ctrl</span> + <span className="kbd">Z</span> undo · <span className="kbd">Ctrl</span> + <span className="kbd">Y</span> redo
        </p>
      </div>
    )
  }

  return (
    <div className="py-2">
      <div className="px-3 pb-2 text-[11.5px] text-ink-muted flex items-center justify-between">
        <span>
          {entries.length} step{entries.length === 1 ? '' : 's'} · position {cursor}
        </span>
        <button type="button" className="text-green hover:underline disabled:opacity-40 disabled:no-underline" onClick={() => jumpTo(0)} disabled={cursor === 0}>
          Undo all
        </button>
      </div>
      <ol className="flex flex-col-reverse">
        {entries.map((cmd, i) => {
          const applied = i < cursor
          const current = i === cursor - 1
          const cells = Math.max(cmd.before.length, cmd.after.length)
          return (
            <li key={cmd.id}>
              <button
                type="button"
                onClick={() => jumpTo(i + 1)}
                className={`w-full text-left px-3 py-1.5 flex items-start gap-2.5 transition-colors hover:bg-surface-2 ${applied ? '' : 'opacity-45'} ${current ? 'bg-green-tint' : ''}`}
                title={applied ? 'Click to undo back to this step' : 'Click to redo up to this step'}
              >
                <span className={`mt-[3px] w-2 h-2 rounded-full shrink-0 ${current ? 'bg-green' : applied ? 'bg-line-strong' : 'border border-line-strong'}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] text-ink truncate">{cmd.label}</span>
                  <span className="block text-[11px] text-ink-muted">
                    {KIND_LABEL[cmd.kind]}
                    {cells > 0 ? ` · ${cells} cell${cells === 1 ? '' : 's'}` : ''}
                    {' · '}
                    {new Date(cmd.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </span>
                <span className="text-[10.5px] text-ink-muted tabular-nums">#{cmd.id}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

// --------------------------------------------------------------- smart fill

function SmartFillPanel() {
  const version = useStore((s) => s.version)
  const cfg = useStore((s) => s.smartFill)
  const selection = useStore((s) => s.selection)
  void version
  void selection
  const view = useMemo(() => computeSmartFill(), [version, cfg])

  useEffect(() => {
    refreshGhost(view)
    return () => refreshGhost(null)
  }, [view])

  return (
    <div className="p-3 flex flex-col gap-3 text-[12.5px]">
      <p className="text-ink-soft leading-relaxed rounded-lg bg-surface-2 px-3 py-2 border border-line">
        <span className="font-semibold text-ink">{SMART_FILL_DISCLAIMER.split('.')[0]}.</span>
        {SMART_FILL_DISCLAIMER.slice(SMART_FILL_DISCLAIMER.indexOf('.') + 1)}
      </p>

      <ol className="flex flex-col gap-2">
        <Step n={1} title="Pick the input column">
          <p className="text-ink-soft">Select the cells to transform, then</p>
          <button type="button" className="tb-btn mt-1.5 border-line bg-paper text-ink" onClick={() => setSmartFillFromSelection('inputs')}>
            Use selection as inputs
          </button>
          {cfg.inputs ? (
            <p className="mt-1.5 font-mono text-[12px] text-green">
              {rectToA1(cfg.inputs)} · {cfg.inputs.r1 - cfg.inputs.r0 + 1} rows
            </p>
          ) : null}
        </Step>
        <Step n={2} title="Type 2–3 example outputs">
          <p className="text-ink-soft">
            In column{' '}
            <span className="font-mono text-green">{cfg.outputCol !== null ? colToLetters(cfg.outputCol) : '?'}</span>, next to a few inputs, type what you want.{' '}
            <button type="button" className="text-green hover:underline" onClick={() => setSmartFillFromSelection('output')}>
              Use selected column instead
            </button>
          </p>
          {view && view.examples.length > 0 ? (
            <ul className="mt-1.5 flex flex-col gap-0.5 font-mono text-[11.5px]">
              {view.examples.slice(0, 4).map((e) => (
                <li key={e.row} className="flex gap-2 min-w-0">
                  <span className="text-ink-muted truncate">{e.input}</span>
                  <span className="text-ink-muted">→</span>
                  <span className="text-ink truncate">{e.output}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Step>
        <Step n={3} title="Review and apply">
          <Result view={view} />
        </Step>
      </ol>
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="panel-card p-3">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="w-5 h-5 rounded-full bg-green text-white text-[11px] font-semibold grid place-items-center">{n}</span>
        <h3 className="font-semibold text-ink">{title}</h3>
      </div>
      {children}
    </li>
  )
}

function Result({ view }: { view: SmartFillView | null }) {
  if (!view) return <p className="text-ink-muted">Waiting for an input range.</p>
  if (view.examples.length === 0) return <p className="text-ink-muted">Waiting for example outputs.</p>
  const outcome = view.outcome
  if (!outcome) return null
  if (!outcome.ok) {
    return (
      <div className="rounded-md bg-error-soft text-error px-2.5 py-2 leading-relaxed">
        <span className="font-semibold">No consistent program.</span> {outcome.reason}
      </div>
    )
  }
  const r = outcome.result
  const applicable = r.preview.filter((p) => p !== null).length
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className={`badge badge-${r.confidence}`}>{r.confidence} confidence</span>
        <span className="text-ink-muted text-[11.5px]">
          {view.examples.length} example{view.examples.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="rounded-md bg-paper border border-line px-2.5 py-2">
        <div className="text-[10.5px] uppercase tracking-wide text-ink-muted font-semibold mb-0.5">Inferred program</div>
        <div className="font-mono text-[12px] text-ink leading-snug">{r.description}</div>
      </div>
      <p className="text-ink-soft leading-relaxed text-[12px]">{r.reason}</p>
      {r.alternatives.length > 0 ? (
        <details className="text-[12px]">
          <summary className="cursor-pointer text-ink-soft hover:text-ink">Other programs that also fit</summary>
          <ul className="mt-1 flex flex-col gap-1 font-mono text-[11.5px] text-ink-soft">
            {r.alternatives.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <div>
        <div className="text-[10.5px] uppercase tracking-wide text-ink-muted font-semibold mb-1">Preview</div>
        <ul className="flex flex-col gap-0.5 font-mono text-[11.5px] max-h-[160px] overflow-y-auto thin-scroll">
          {view.remainingRows.slice(0, 40).map((row, i) => {
            const input = workbook.sheet.getRaw(row, view.inputs.c0)
            const out = r.preview[i]
            return (
              <li key={row} className="flex gap-2 min-w-0">
                <span className="text-ink-muted w-9 shrink-0 text-right tabular-nums">{row + 1}</span>
                <span className="text-ink-soft truncate flex-1">{input}</span>
                <span className="text-ink-muted">→</span>
                <span className={`truncate flex-1 ${out === null ? 'text-error italic' : 'text-ink'}`}>{out ?? 'no match'}</span>
              </li>
            )
          })}
          {view.remainingRows.length > 40 ? <li className="text-ink-muted">… {view.remainingRows.length - 40} more</li> : null}
        </ul>
      </div>
      <button
        type="button"
        className="h-8 rounded-md bg-green text-white font-medium text-[12.5px] hover:bg-green-strong active:translate-y-px transition disabled:opacity-40"
        disabled={applicable === 0}
        onClick={() => applySmartFill(view)}
      >
        Apply to {applicable} row{applicable === 1 ? '' : 's'} as values
      </button>
    </div>
  )
}
