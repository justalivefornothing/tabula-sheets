import type { CellFormat } from './types.ts'

export interface CellSnapshot {
  row: number
  col: number
  raw: string
  format?: CellFormat
}

export interface LayoutChange {
  axis: 'col' | 'row'
  index: number
  /** undefined = default size */
  before: number | undefined
  after: number | undefined
}

export type CommandKind =
  | 'edit'
  | 'clear'
  | 'fill'
  | 'paste'
  | 'cut'
  | 'import'
  | 'format'
  | 'resize'
  | 'smartfill'
  | 'sort'

export interface Command {
  readonly id: number
  readonly kind: CommandKind
  /** Human label shown in the History panel, e.g. "Fill C1:C100". */
  readonly label: string
  readonly time: number
  readonly before: readonly CellSnapshot[]
  readonly after: readonly CellSnapshot[]
  readonly layout?: readonly LayoutChange[]
}

/**
 * Append-only command log with a cursor. Every user action — including a
 * 100-cell fill or a CSV import — is one entry, so it undoes in one step.
 * Undo moves the cursor back; a new command after an undo truncates the
 * redo tail (the classic linear history every spreadsheet uses).
 */
export class CommandLog {
  private readonly entries: Command[] = []
  private cursor = 0
  private nextId = 1

  push(cmd: Omit<Command, 'id' | 'time'>): Command {
    if (this.cursor < this.entries.length) this.entries.length = this.cursor
    const full: Command = { ...cmd, id: this.nextId++, time: Date.now() }
    this.entries.push(full)
    this.cursor = this.entries.length
    return full
  }

  canUndo(): boolean {
    return this.cursor > 0
  }

  canRedo(): boolean {
    return this.cursor < this.entries.length
  }

  /** Step back; returns the command to invert, or undefined. */
  undo(): Command | undefined {
    if (!this.canUndo()) return undefined
    this.cursor--
    return this.entries[this.cursor]
  }

  /** Step forward; returns the command to re-apply, or undefined. */
  redo(): Command | undefined {
    if (!this.canRedo()) return undefined
    const cmd = this.entries[this.cursor]
    this.cursor++
    return cmd
  }

  list(): readonly Command[] {
    return this.entries
  }

  position(): number {
    return this.cursor
  }

  size(): number {
    return this.entries.length
  }

  clear(): void {
    this.entries.length = 0
    this.cursor = 0
  }
}
