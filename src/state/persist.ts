import { openDB, type IDBPDatabase } from 'idb'
import type { SheetDocument } from '../engine/workbook.ts'
import { useStore, workbook } from './store.ts'

const DB_NAME = 'tabula'
const STORE = 'sheets'
const LAST_KEY = 'tabula:last-sheet'

export interface SavedSheetInfo {
  id: string
  name: string
  updatedAt: number
  cellCount: number
}

let dbPromise: Promise<IDBPDatabase> | null = null

function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE, { keyPath: 'id' })
      },
    })
  }
  return dbPromise
}

export function storageAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

export async function saveDocument(doc: SheetDocument): Promise<void> {
  const d = await db()
  await d.put(STORE, doc)
}

export async function loadDocument(id: string): Promise<SheetDocument | undefined> {
  const d = await db()
  return (await d.get(STORE, id)) as SheetDocument | undefined
}

export async function deleteDocument(id: string): Promise<void> {
  const d = await db()
  await d.delete(STORE, id)
  if (getLastSheetId() === id) localStorage.removeItem(LAST_KEY)
}

export async function listDocuments(): Promise<SavedSheetInfo[]> {
  const d = await db()
  const all = (await d.getAll(STORE)) as SheetDocument[]
  return all
    .map((doc) => ({ id: doc.id, name: doc.name, updatedAt: doc.updatedAt, cellCount: doc.cells.length }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getLastSheetId(): string | null {
  try {
    return localStorage.getItem(LAST_KEY)
  } catch {
    return null
  }
}

export function setLastSheetId(id: string): void {
  try {
    localStorage.setItem(LAST_KEY, id)
  } catch {
    /* private mode */
  }
}

/**
 * Debounced autosave: every workbook change schedules a write ~800 ms later.
 * Returns an unsubscribe function.
 */
export function startAutosave(): () => void {
  if (!storageAvailable()) {
    useStore.getState().setSaveState('off')
    return () => {}
  }
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = async (): Promise<void> => {
    timer = null
    const store = useStore.getState()
    store.setSaveState('saving')
    try {
      const doc = workbook.toDocument()
      await saveDocument(doc)
      setLastSheetId(doc.id)
      store.setSaveState('saved')
    } catch {
      store.setSaveState('error')
    }
  }
  const unsubscribe = workbook.subscribe((ev) => {
    if (ev.kind === 'load') {
      // A freshly loaded document is already persisted (or is a sample about to be).
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, 400)
      return
    }
    useStore.getState().setSaveState('unsaved')
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, 800)
  })
  return () => {
    unsubscribe()
    if (timer) clearTimeout(timer)
  }
}
