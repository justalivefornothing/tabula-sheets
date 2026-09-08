import { useRef, useState } from 'react'
import type { CellFormat } from '../engine/types.ts'
import {
  changeDecimals,
  copyToSystemClipboard,
  exportCsvDownload,
  importCsvText,
  pasteFromSystemClipboard,
  redo,
  renameSheet,
  setAlign,
  setNumberFormat,
  toggleBold,
  undo,
} from '../state/actions.ts'
import { activeCell, useStore, workbook } from '../state/store.ts'
import {
  AlignIcon,
  BoldIcon,
  CopyIcon,
  ExportIcon,
  HistoryIcon,
  HomeIcon,
  ImportIcon,
  Logo,
  MinusIcon,
  PasteIcon,
  PlusIcon,
  RedoIcon,
  SparkIcon,
  UndoIcon,
} from './Icons.tsx'

const FORMATS: Array<{ value: NonNullable<CellFormat['kind']>; label: string }> = [
  { value: 'general', label: 'General' },
  { value: 'number', label: 'Number' },
  { value: 'currency', label: 'Currency' },
  { value: 'percent', label: 'Percent' },
  { value: 'date', label: 'Date' },
  { value: 'text', label: 'Text' },
]

export function Toolbar() {
  const version = useStore((s) => s.version)
  const selection = useStore((s) => s.selection)
  const panel = useStore((s) => s.panel)
  const setPanel = useStore((s) => s.setPanel)
  const setHome = useStore((s) => s.setHome)
  const sheetName = useStore((s) => s.sheetName)
  const fileRef = useRef<HTMLInputElement>(null)
  void version

  const a = activeCell(selection)
  const fmt = workbook.sheet.getFormat(a.row, a.col)
  const canUndo = workbook.log.canUndo()
  const canRedo = workbook.log.canRedo()

  const onFile = async (file: File | undefined): Promise<void> => {
    if (!file) return
    importCsvText(await file.text(), file.name)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <header className="flex items-center gap-1 px-2 h-11 border-b border-line bg-surface select-none" role="toolbar" aria-label="Toolbar">
      <button type="button" className="tb-btn -ml-1 gap-2 pr-2" onClick={() => setHome(true)} title="Home: open a sample or saved sheet">
        <Logo />
        <span className="font-semibold text-ink tracking-tight text-[14px] hidden sm:inline">Tabula</span>
      </button>
      <SheetName name={sheetName} />
      <span className="tb-sep hidden md:block" />

      <div className="hidden md:flex items-center gap-0.5">
        <button type="button" className="tb-btn" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
          <UndoIcon />
        </button>
        <button type="button" className="tb-btn" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)" aria-label="Redo">
          <RedoIcon />
        </button>
      </div>
      <span className="tb-sep hidden md:block" />

      <div className="hidden lg:flex items-center gap-0.5">
        <button type="button" className="tb-btn" onClick={() => void copyToSystemClipboard()} title="Copy (Ctrl+C)" aria-label="Copy">
          <CopyIcon />
        </button>
        <button type="button" className="tb-btn" onClick={() => void pasteFromSystemClipboard()} title="Paste (Ctrl+V)" aria-label="Paste">
          <PasteIcon />
        </button>
        <span className="tb-sep" />
      </div>

      <button type="button" className="tb-btn" onClick={toggleBold} aria-pressed={!!fmt?.bold} title="Bold (Ctrl+B)" aria-label="Bold">
        <BoldIcon />
      </button>
      <div className="hidden sm:flex items-center gap-0.5">
        {(['left', 'center', 'right'] as const).map((al) => (
          <button
            key={al}
            type="button"
            className="tb-btn"
            onClick={() => setAlign(al)}
            aria-pressed={fmt?.align === al}
            title={`Align ${al}`}
            aria-label={`Align ${al}`}
          >
            <AlignIcon align={al} />
          </button>
        ))}
      </div>
      <span className="tb-sep" />

      <label className="flex items-center gap-1">
        <span className="sr-only">Number format</span>
        <select
          className="h-7 rounded-md border border-line bg-paper px-2 text-[12.5px] text-ink hover:border-line-strong focus-visible:border-green cursor-pointer"
          value={fmt?.kind ?? 'general'}
          onChange={(e) => setNumberFormat(e.target.value as CellFormat['kind'])}
          title="Number format"
        >
          {FORMATS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <div className="hidden sm:flex items-center">
        <button type="button" className="tb-btn" onClick={() => changeDecimals(-1)} title="Fewer decimals" aria-label="Decrease decimals">
          <span className="font-mono text-[11px] leading-none">.0</span>
          <MinusIcon width={10} height={10} />
        </button>
        <button type="button" className="tb-btn" onClick={() => changeDecimals(1)} title="More decimals" aria-label="Increase decimals">
          <span className="font-mono text-[11px] leading-none">.00</span>
          <PlusIcon width={10} height={10} />
        </button>
      </div>
      <span className="tb-sep hidden sm:block" />

      <div className="hidden sm:flex items-center gap-0.5">
        <button type="button" className="tb-btn" onClick={() => fileRef.current?.click()} title="Import CSV (or drop a file on the grid)">
          <ImportIcon />
          <span className="hidden xl:inline">Import</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          className="hidden"
          onChange={(e) => void onFile(e.target.files?.[0])}
          aria-label="Import CSV file"
        />
        <button type="button" className="tb-btn" onClick={exportCsvDownload} title="Export as CSV">
          <ExportIcon />
          <span className="hidden xl:inline">Export</span>
        </button>
      </div>

      <div className="ml-auto flex items-center gap-0.5">
        <button
          type="button"
          className="tb-btn"
          onClick={() => setPanel(panel === 'history' ? null : 'history')}
          aria-pressed={panel === 'history'}
          title="History: every change as an undoable step"
        >
          <HistoryIcon />
          <span className="hidden md:inline">History</span>
        </button>
        <button
          type="button"
          className="tb-btn"
          onClick={() => setPanel(panel === 'smartfill' ? null : 'smartfill')}
          aria-pressed={panel === 'smartfill'}
          title="Smart Fill: infer a transformation from examples"
        >
          <SparkIcon />
          <span className="hidden md:inline">Smart Fill</span>
        </button>
        <button type="button" className="tb-btn sm:hidden" onClick={() => setHome(true)} aria-label="Home">
          <HomeIcon />
        </button>
      </div>
    </header>
  )
}

function SheetName({ name }: { name: string }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  if (!editing) {
    return (
      <button
        type="button"
        className="tb-btn max-w-[160px] sm:max-w-[240px] truncate text-ink text-[13px] font-medium"
        onClick={() => {
          setDraft(name)
          setEditing(true)
        }}
        title="Rename sheet"
      >
        <span className="truncate">{name}</span>
      </button>
    )
  }
  return (
    <input
      autoFocus
      className="h-7 w-[180px] rounded-md border border-green bg-paper px-2 text-[13px] font-medium"
      value={draft}
      aria-label="Sheet name"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false)
        if (draft.trim() && draft !== name) renameSheet(draft)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setDraft(name)
          setEditing(false)
        }
      }}
    />
  )
}
