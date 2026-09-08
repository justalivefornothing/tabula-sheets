import { MAX_COLS, MAX_ROWS, parseRangeOrCell, isRangeRef } from './refs.ts'
import { tokenizeLenient, type Token } from './tokenizer.ts'
import { FUNCTIONS, SPECIAL_FORMS } from './functions/index.ts'
import type { Rect } from './types.ts'

export type SpanKind = 'ref' | 'fn' | 'num' | 'str' | 'op' | 'err' | 'plain'

export interface Span {
  text: string
  start: number
  end: number
  kind: SpanKind
  /** Index into the reference colour palette (refs only). */
  colorIndex?: number
  rect?: Rect
}

export interface ReferenceSpan {
  text: string
  start: number
  end: number
  rect: Rect
  colorIndex: number
}

function nextNonWs(tokens: Token[], from: number): number {
  for (let j = from; j < tokens.length; j++) if (tokens[j].type !== 'ws') return j
  return -1
}

function rectOf(text: string): Rect | null {
  const parsed = parseRangeOrCell(text)
  if (!parsed) return null
  if (isRangeRef(parsed)) {
    return {
      r0: parsed.start.row,
      c0: parsed.start.col,
      r1: Math.min(parsed.end.row, MAX_ROWS - 1),
      c1: Math.min(parsed.end.col, MAX_COLS - 1),
    }
  }
  if (parsed.row >= MAX_ROWS || parsed.col >= MAX_COLS) return null
  return { r0: parsed.row, c0: parsed.col, r1: parsed.row, c1: parsed.col }
}

/**
 * Split formula text (including the leading '=') into coloured spans. References
 * that denote the same rectangle share a colour, as in every spreadsheet's editor.
 */
export function highlightFormula(text: string): Span[] {
  if (!text.startsWith('=')) return [{ text, start: 0, end: text.length, kind: 'plain' }]
  const spans: Span[] = [{ text: '=', start: 0, end: 1, kind: 'op' }]
  const body = text.slice(1)
  const tokens = tokenizeLenient(body)
  const colorByRect = new Map<string, number>()
  const colorFor = (rect: Rect): number => {
    const key = `${rect.r0},${rect.c0},${rect.r1},${rect.c1}`
    let idx = colorByRect.get(key)
    if (idx === undefined) {
      idx = colorByRect.size % 5
      colorByRect.set(key, idx)
    }
    return idx
  }
  const off = 1
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    const push = (kind: SpanKind, start: number, end: number, rect?: Rect): void => {
      const span: Span = { text: text.slice(start, end), start, end, kind }
      if (rect) {
        span.rect = rect
        span.colorIndex = colorFor(rect)
      }
      spans.push(span)
    }
    switch (t.type) {
      case 'ident': {
        const nextIdx = nextNonWs(tokens, i + 1)
        const next = nextIdx >= 0 ? tokens[nextIdx] : undefined
        if (next && next.type === 'lparen') {
          const upper = t.text.toUpperCase()
          push(FUNCTIONS.has(upper) || SPECIAL_FORMS.has(upper) ? 'fn' : 'err', t.start + off, t.end + off)
          break
        }
        if (next && next.type === 'colon') {
          const afterIdx = nextNonWs(tokens, nextIdx + 1)
          const after = afterIdx >= 0 ? tokens[afterIdx] : undefined
          if (after && after.type === 'ident') {
            const rect = rectOf(`${t.text}:${after.text}`)
            if (rect) {
              push('ref', t.start + off, after.end + off, rect)
              i = afterIdx
              break
            }
          }
        }
        const rect = rectOf(t.text)
        if (rect) push('ref', t.start + off, t.end + off, rect)
        else {
          const upper = t.text.toUpperCase()
          push(upper === 'TRUE' || upper === 'FALSE' ? 'num' : 'plain', t.start + off, t.end + off)
        }
        break
      }
      case 'number': {
        const nextIdx = nextNonWs(tokens, i + 1)
        const next = nextIdx >= 0 ? tokens[nextIdx] : undefined
        if (next && next.type === 'colon' && /^\d+$/.test(t.text)) {
          const afterIdx = nextNonWs(tokens, nextIdx + 1)
          const after = afterIdx >= 0 ? tokens[afterIdx] : undefined
          if (after && after.type === 'number' && /^\d+$/.test(after.text)) {
            const rect = rectOf(`${t.text}:${after.text}`)
            if (rect) {
              push('ref', t.start + off, after.end + off, rect)
              i = afterIdx
              break
            }
          }
        }
        push('num', t.start + off, t.end + off)
        break
      }
      case 'string':
        push('str', t.start + off, t.end + off)
        break
      case 'error':
      case 'unknown':
        push('err', t.start + off, t.end + off)
        break
      case 'ws':
        push('plain', t.start + off, t.end + off)
        break
      default:
        push('op', t.start + off, t.end + off)
    }
  }
  return spans
}

export function referencesInFormula(text: string): ReferenceSpan[] {
  const out: ReferenceSpan[] = []
  for (const s of highlightFormula(text)) {
    if (s.kind === 'ref' && s.rect && s.colorIndex !== undefined) {
      out.push({ text: s.text, start: s.start, end: s.end, rect: s.rect, colorIndex: s.colorIndex })
    }
  }
  return out
}

/**
 * Can a reference be inserted at `caret` by clicking a cell? True when the text
 * is a formula and the character before the caret is an operator, '(' or ','.
 */
export function canInsertReferenceAt(text: string, caret: number): boolean {
  if (!text.startsWith('=')) return false
  let i = caret - 1
  while (i >= 0 && text[i] === ' ') i--
  if (i < 0) return false
  return '=+-*/^&<>(,:;'.includes(text[i])
}
