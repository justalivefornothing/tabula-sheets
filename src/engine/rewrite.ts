import { colToLetters, lettersToCol, MAX_COLS, MAX_ROWS, parseCellRef } from './refs.ts'
import { tokenize, TokenizeError, type Token } from './tokenizer.ts'
import { isFormulaInput } from './sheet.ts'

/**
 * Shift the relative references inside a formula by (dRow, dCol), leaving
 * absolute components ($A, $1) untouched. Used when filling and pasting.
 * References that fall off the sheet become #REF!.
 */
export function shiftFormula(raw: string, dRow: number, dCol: number): string {
  if (!isFormulaInput(raw) || (dRow === 0 && dCol === 0)) return raw
  const body = raw.slice(1)
  let tokens: Token[]
  try {
    tokens = tokenize(body, true)
  } catch (e) {
    if (e instanceof TokenizeError) return raw
    throw e
  }
  const out: string[] = ['=']
  const COL_RE = /^(\$?)([A-Za-z]{1,3})$/
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.type !== 'ident' && t.type !== 'number') {
      out.push(t.text)
      continue
    }
    const nextSignificant = nextNonWs(tokens, i + 1)
    // Function names are never references.
    if (t.type === 'ident' && nextSignificant && nextSignificant.type === 'lparen') {
      out.push(t.text)
      continue
    }
    // Whole-column range A:C
    if (t.type === 'ident' && nextSignificant && nextSignificant.type === 'colon') {
      const m = COL_RE.exec(t.text)
      if (m && !parseCellRef(t.text)) {
        const afterColon = nextNonWs(tokens, tokens.indexOf(nextSignificant) + 1)
        const m2 = afterColon && afterColon.type === 'ident' ? COL_RE.exec(afterColon.text) : null
        if (afterColon && m2) {
          const a = shiftColLetters(m, dCol)
          const b = shiftColLetters(m2, dCol)
          if (a === null || b === null) out.push('#REF!')
          else out.push(`${a}:${b}`)
          i = tokens.indexOf(afterColon)
          continue
        }
      }
    }
    // Whole-row range 1:3
    if (t.type === 'number' && nextSignificant && nextSignificant.type === 'colon' && /^\d+$/.test(t.text)) {
      const afterColon = nextNonWs(tokens, tokens.indexOf(nextSignificant) + 1)
      if (afterColon && afterColon.type === 'number' && /^\d+$/.test(afterColon.text)) {
        const r0 = parseInt(t.text, 10) - 1 + dRow
        const r1 = parseInt(afterColon.text, 10) - 1 + dRow
        if (r0 < 0 || r1 < 0 || r0 >= MAX_ROWS || r1 >= MAX_ROWS) out.push('#REF!')
        else out.push(`${r0 + 1}:${r1 + 1}`)
        i = tokens.indexOf(afterColon)
        continue
      }
    }
    if (t.type === 'ident') {
      const ref = parseCellRef(t.text)
      if (ref) {
        const row = ref.absRow ? ref.row : ref.row + dRow
        const col = ref.absCol ? ref.col : ref.col + dCol
        if (row < 0 || col < 0 || row >= MAX_ROWS || col >= MAX_COLS) {
          out.push('#REF!')
        } else {
          out.push((ref.absCol ? '$' : '') + colToLetters(col) + (ref.absRow ? '$' : '') + String(row + 1))
        }
        continue
      }
    }
    out.push(t.text)
  }
  return out.join('')
}

function shiftColLetters(m: RegExpExecArray, dCol: number): string | null {
  const abs = m[1] === '$'
  const col = lettersToCol(m[2])
  const shifted = abs ? col : col + dCol
  if (shifted < 0 || shifted >= MAX_COLS) return null
  return (abs ? '$' : '') + colToLetters(shifted)
}

function nextNonWs(tokens: Token[], from: number): Token | undefined {
  for (let j = from; j < tokens.length; j++) if (tokens[j].type !== 'ws') return tokens[j]
  return undefined
}
