import type { CellRef, ErrorCode, RangeRef } from './types.ts'
import { lettersToCol, normaliseRange, parseCellRef, wholeColumnRange, wholeRowRange } from './refs.ts'
import { tokenize, TokenizeError, type Token } from './tokenizer.ts'

export type BinaryOp = '+' | '-' | '*' | '/' | '^' | '&' | '=' | '<>' | '<' | '>' | '<=' | '>='

export type Node =
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'boolean'; value: boolean }
  | { type: 'error'; code: ErrorCode }
  | { type: 'ref'; ref: CellRef }
  | { type: 'range'; ref: RangeRef }
  | { type: 'name'; name: string }
  | { type: 'unary'; op: '-' | '+'; operand: Node }
  | { type: 'percent'; operand: Node }
  | { type: 'binary'; op: BinaryOp; left: Node; right: Node }
  | { type: 'call'; name: string; args: Node[] }

export class ParseError extends Error {
  readonly position: number
  constructor(message: string, position: number) {
    super(message)
    this.position = position
  }
}

/**
 * Operator precedence, lowest to highest (higher number binds tighter):
 *   1  comparison  = <> < > <= >=
 *   2  concat      &
 *   3  additive    + -
 *   4  multiplicative * /
 *   5  unary minus  -x        (so -2^2 = -(2^2) = -4, matching mathematics)
 *   6  power       ^          (left-associative, as in Excel: 2^3^2 = 64)
 *   7  percent     x%         (postfix)
 *   8  primary     literals, refs, ranges, calls, (expr)
 */
const BINARY_PRECEDENCE: Record<string, number> = {
  '=': 1,
  '<>': 1,
  '<': 1,
  '>': 1,
  '<=': 1,
  '>=': 1,
  '&': 2,
  '+': 3,
  '-': 3,
  '*': 4,
  '/': 4,
  '^': 6,
}

const UNARY_PRECEDENCE = 5

class Parser {
  private readonly tokens: Token[]
  private pos = 0
  private readonly src: string

  constructor(tokens: Token[], src: string) {
    this.tokens = tokens
    this.src = src
  }

  parse(): Node {
    if (this.tokens.length === 0) throw new ParseError('Empty formula', 0)
    const node = this.parseExpression(0)
    if (this.pos < this.tokens.length) {
      const t = this.tokens[this.pos]
      throw new ParseError(`Unexpected '${t.text}'`, t.start)
    }
    return node
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos]
  }

  private next(): Token {
    const t = this.tokens[this.pos]
    if (!t) throw new ParseError('Unexpected end of formula', this.src.length)
    this.pos++
    return t
  }

  private expect(type: Token['type'], what: string): Token {
    const t = this.peek()
    if (!t) throw new ParseError(`Expected ${what} but reached end of formula`, this.src.length)
    if (t.type !== type) throw new ParseError(`Expected ${what} but found '${t.text}'`, t.start)
    this.pos++
    return t
  }

  /** Precedence climbing over binary operators. */
  private parseExpression(minPrec: number): Node {
    let left = this.parseUnary()
    for (;;) {
      const t = this.peek()
      if (!t || t.type !== 'op' || t.text === '%') break
      const prec = BINARY_PRECEDENCE[t.text]
      if (prec === undefined || prec < minPrec) break
      this.pos++
      // All binary operators are left-associative (2^3^2 = 64, as in Excel).
      const right = this.parseExpression(prec + 1)
      left = { type: 'binary', op: t.text as BinaryOp, left, right }
    }
    return left
  }

  private parseUnary(): Node {
    const t = this.peek()
    if (t && t.type === 'op' && (t.text === '-' || t.text === '+')) {
      this.pos++
      // Unary binds looser than ^ but tighter than * and /: -2^2 -> -(2^2).
      const operand = this.parseExpression(UNARY_PRECEDENCE + 1)
      return { type: 'unary', op: t.text, operand }
    }
    return this.parsePostfix()
  }

  private parsePostfix(): Node {
    let node = this.parsePrimary()
    for (;;) {
      const t = this.peek()
      if (t && t.type === 'op' && t.text === '%') {
        this.pos++
        node = { type: 'percent', operand: node }
        continue
      }
      break
    }
    return node
  }

  private parsePrimary(): Node {
    const t = this.next()
    switch (t.type) {
      case 'number': {
        // Whole-row range: 1:1, 3:10
        const after = this.peek()
        if (after && after.type === 'colon' && /^\d+$/.test(t.text)) {
          const rowTok = this.tokens[this.pos + 1]
          if (rowTok && rowTok.type === 'number' && /^\d+$/.test(rowTok.text)) {
            this.pos += 2
            return {
              type: 'range',
              ref: wholeRowRange(parseInt(t.text, 10) - 1, parseInt(rowTok.text, 10) - 1),
            }
          }
        }
        const value = Number(t.text)
        if (!Number.isFinite(value)) throw new ParseError(`Bad number '${t.text}'`, t.start)
        return { type: 'number', value }
      }
      case 'string':
        return { type: 'string', value: t.text.slice(1, -1).replace(/""/g, '"') }
      case 'error':
        return { type: 'error', code: t.text as ErrorCode }
      case 'lparen': {
        const inner = this.parseExpression(0)
        this.expect('rparen', "')'")
        return inner
      }
      case 'ident':
        return this.parseIdent(t)
      case 'colon': {
        // Whole-row range written as 1:1 (numbers) arrives here via parseRowRange.
        throw new ParseError(`Unexpected ':'`, t.start)
      }
      default:
        throw new ParseError(`Unexpected '${t.text}'`, t.start)
    }
  }

  private parseIdent(t: Token): Node {
    const upper = t.text.toUpperCase()
    const following = this.peek()

    // Function call
    if (following && following.type === 'lparen') {
      this.pos++
      const args: Node[] = []
      if (this.peek()?.type === 'rparen') {
        this.pos++
        return { type: 'call', name: upper, args }
      }
      for (;;) {
        // Allow empty arguments like IF(A1,,B1)? Keep strict: require expression.
        args.push(this.parseExpression(0))
        const sep = this.next()
        if (sep.type === 'comma') continue
        if (sep.type === 'rparen') break
        throw new ParseError(`Expected ',' or ')' but found '${sep.text}'`, sep.start)
      }
      return { type: 'call', name: upper, args }
    }

    if (upper === 'TRUE') return { type: 'boolean', value: true }
    if (upper === 'FALSE') return { type: 'boolean', value: false }

    // Whole column range A:A / $A:$C
    if (following && following.type === 'colon') {
      const colMatch = /^(\$?)([A-Za-z]{1,3})$/.exec(t.text)
      const cell = parseCellRef(t.text)
      if (colMatch && !cell) {
        this.pos++
        const other = this.expect('ident', 'column letter')
        const m2 = /^(\$?)([A-Za-z]{1,3})$/.exec(other.text)
        if (!m2) throw new ParseError(`Bad column range '${t.text}:${other.text}'`, other.start)
        const c0 = lettersToCol(colMatch[2])
        const c1 = lettersToCol(m2[2])
        if (c0 < 0 || c1 < 0) throw new ParseError('Bad column range', t.start)
        return { type: 'range', ref: wholeColumnRange(c0, c1, colMatch[1] === '$', m2[1] === '$') }
      }
      if (cell) {
        this.pos++
        const other = this.expect('ident', 'cell reference')
        const cell2 = parseCellRef(other.text)
        if (!cell2) throw new ParseError(`Bad range end '${other.text}'`, other.start)
        return { type: 'range', ref: normaliseRange(cell, cell2) }
      }
    }

    const cell = parseCellRef(t.text)
    if (cell) return { type: 'ref', ref: cell }

    // Bare identifier: unknown name (resolved at evaluation -> #NAME?)
    return { type: 'name', name: upper }
  }
}

/** Parse a formula body (without the leading '='). Throws ParseError / TokenizeError. */
export function parseFormula(body: string): Node {
  let tokens: Token[]
  try {
    tokens = tokenize(body)
  } catch (e) {
    if (e instanceof TokenizeError) throw new ParseError(e.message, e.position)
    throw e
  }
  return new Parser(tokens, body).parse()
}

/** Collect every cell and range reference in an AST (deduplicated by text). */
export function collectRefs(node: Node, cells: CellRef[] = [], ranges: RangeRef[] = []): { cells: CellRef[]; ranges: RangeRef[] } {
  switch (node.type) {
    case 'ref':
      cells.push(node.ref)
      break
    case 'range':
      ranges.push(node.ref)
      break
    case 'unary':
    case 'percent':
      collectRefs(node.operand, cells, ranges)
      break
    case 'binary':
      collectRefs(node.left, cells, ranges)
      collectRefs(node.right, cells, ranges)
      break
    case 'call':
      for (const a of node.args) collectRefs(a, cells, ranges)
      break
    default:
      break
  }
  return { cells, ranges }
}

/** Does the AST contain a call to any of the given (upper-case) function names? */
export function callsAny(node: Node, names: ReadonlySet<string>): boolean {
  switch (node.type) {
    case 'call':
      if (names.has(node.name)) return true
      return node.args.some((a) => callsAny(a, names))
    case 'unary':
    case 'percent':
      return callsAny(node.operand, names)
    case 'binary':
      return callsAny(node.left, names) || callsAny(node.right, names)
    default:
      return false
  }
}
