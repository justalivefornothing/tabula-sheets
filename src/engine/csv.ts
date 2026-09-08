/**
 * RFC 4180 CSV codec (and TSV for the clipboard).
 *
 *  - Fields containing the delimiter, a double quote, CR or LF are quoted.
 *  - Double quotes inside quoted fields are escaped by doubling them.
 *  - Records end with CRLF on output; CRLF, LF and CR are all accepted on input.
 *  - Quoted fields may contain embedded line breaks.
 */

export interface CsvOptions {
  delimiter?: string
  /** Record terminator for output; RFC 4180 specifies CRLF. */
  newline?: string
}

export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let i = 0
  const n = text.length
  let quoted = false
  // Ignore a UTF-8 BOM
  if (text.charCodeAt(0) === 0xfeff) i = 1
  let fieldStarted = false

  while (i < n) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"' && !fieldStarted) {
      quoted = true
      fieldStarted = true
      i++
      continue
    }
    if (ch === delimiter) {
      row.push(field)
      field = ''
      fieldStarted = false
      i++
      continue
    }
    if (ch === '\r' || ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      fieldStarted = false
      if (ch === '\r' && text[i + 1] === '\n') i += 2
      else i++
      continue
    }
    field += ch
    fieldStarted = true
    i++
  }
  // Final record (no trailing newline) — but do not emit a phantom empty row
  // after a terminating newline.
  if (field !== '' || row.length > 0 || fieldStarted || quoted) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

export function parseCsv(text: string, options: CsvOptions = {}): string[][] {
  return parseDelimited(text, options.delimiter ?? ',')
}

export function parseTsv(text: string): string[][] {
  return parseDelimited(text, '\t')
}

function needsQuoting(field: string, delimiter: string): boolean {
  return field.includes(delimiter) || field.includes('"') || field.includes('\n') || field.includes('\r')
}

export function encodeField(field: string, delimiter: string): string {
  if (!needsQuoting(field, delimiter)) return field
  return '"' + field.replace(/"/g, '""') + '"'
}

export function toDelimited(rows: readonly (readonly string[])[], delimiter: string, newline: string): string {
  let out = ''
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    for (let c = 0; c < row.length; c++) {
      if (c > 0) out += delimiter
      out += encodeField(row[c], delimiter)
    }
    out += newline
  }
  return out
}

export function toCsv(rows: readonly (readonly string[])[], options: CsvOptions = {}): string {
  return toDelimited(rows, options.delimiter ?? ',', options.newline ?? '\r\n')
}

export function toTsv(rows: readonly (readonly string[])[]): string {
  // Clipboard TSV: LF terminated, no trailing newline so a single cell pastes cleanly.
  return toDelimited(rows, '\t', '\n').replace(/\n$/, '')
}
