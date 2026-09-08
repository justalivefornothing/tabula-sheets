import { isErrorCode } from './types.ts'

export type TokenType =
  | 'number'
  | 'string'
  | 'ident' // function names, TRUE/FALSE, cell references, column letters
  | 'op' // + - * / ^ & = <> < > <= >= %
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'colon'
  | 'error' // literal error like #N/A
  | 'ws'
  | 'unknown'

export interface Token {
  type: TokenType
  text: string
  start: number
  end: number
}

export class TokenizeError extends Error {
  readonly position: number
  constructor(message: string, position: number) {
    super(message)
    this.position = position
  }
}

function isDigit(c: number): boolean {
  return c >= 48 && c <= 57
}

function isIdentStart(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36 // A-Z a-z _ $
}

function isIdentPart(c: number): boolean {
  return isIdentStart(c) || isDigit(c) || c === 46 // .
}

/**
 * Tokenize a formula body (text after the leading '='). Whitespace tokens are
 * kept when `keepWhitespace` is true so editors can colour the original text.
 */
export function tokenize(src: string, keepWhitespace = false): Token[] {
  const tokens: Token[] = []
  const n = src.length
  let i = 0
  while (i < n) {
    const c = src.charCodeAt(i)
    const start = i

    // whitespace
    if (c === 32 || c === 9 || c === 10 || c === 13) {
      while (i < n && /\s/.test(src[i])) i++
      if (keepWhitespace) tokens.push({ type: 'ws', text: src.slice(start, i), start, end: i })
      continue
    }

    // numbers: 12, 12.5, .5, 1e3, 1.5E-2
    if (isDigit(c) || (c === 46 && i + 1 < n && isDigit(src.charCodeAt(i + 1)))) {
      while (i < n && isDigit(src.charCodeAt(i))) i++
      if (i < n && src[i] === '.') {
        i++
        while (i < n && isDigit(src.charCodeAt(i))) i++
      }
      if (i < n && (src[i] === 'e' || src[i] === 'E')) {
        let j = i + 1
        if (j < n && (src[j] === '+' || src[j] === '-')) j++
        if (j < n && isDigit(src.charCodeAt(j))) {
          while (j < n && isDigit(src.charCodeAt(j))) j++
          i = j
        }
      }
      tokens.push({ type: 'number', text: src.slice(start, i), start, end: i })
      continue
    }

    // strings with "" escaping
    if (c === 34) {
      i++
      let closed = false
      while (i < n) {
        if (src[i] === '"') {
          if (i + 1 < n && src[i + 1] === '"') {
            i += 2
            continue
          }
          closed = true
          i++
          break
        }
        i++
      }
      if (!closed) throw new TokenizeError('Unterminated string', start)
      tokens.push({ type: 'string', text: src.slice(start, i), start, end: i })
      continue
    }

    // error literals (#N/A, #REF!, ...)
    if (c === 35) {
      let j = i + 1
      while (j < n && /[A-Za-z0-9/!?]/.test(src[j])) j++
      const text = src.slice(start, j)
      if (isErrorCode(text.toUpperCase())) {
        tokens.push({ type: 'error', text: text.toUpperCase(), start, end: j })
        i = j
        continue
      }
      throw new TokenizeError(`Unexpected '#'`, start)
    }

    // identifiers / references
    if (isIdentStart(c)) {
      while (i < n && isIdentPart(src.charCodeAt(i))) i++
      tokens.push({ type: 'ident', text: src.slice(start, i), start, end: i })
      continue
    }

    // punctuation
    const ch = src[i]
    switch (ch) {
      case '(':
        tokens.push({ type: 'lparen', text: ch, start, end: i + 1 })
        i++
        continue
      case ')':
        tokens.push({ type: 'rparen', text: ch, start, end: i + 1 })
        i++
        continue
      case ',':
      case ';':
        tokens.push({ type: 'comma', text: ch, start, end: i + 1 })
        i++
        continue
      case ':':
        tokens.push({ type: 'colon', text: ch, start, end: i + 1 })
        i++
        continue
      case '<': {
        const next = src[i + 1]
        if (next === '>' || next === '=') {
          tokens.push({ type: 'op', text: ch + next, start, end: i + 2 })
          i += 2
        } else {
          tokens.push({ type: 'op', text: ch, start, end: i + 1 })
          i++
        }
        continue
      }
      case '>': {
        if (src[i + 1] === '=') {
          tokens.push({ type: 'op', text: '>=', start, end: i + 2 })
          i += 2
        } else {
          tokens.push({ type: 'op', text: ch, start, end: i + 1 })
          i++
        }
        continue
      }
      case '+':
      case '-':
      case '*':
      case '/':
      case '^':
      case '&':
      case '=':
      case '%':
        tokens.push({ type: 'op', text: ch, start, end: i + 1 })
        i++
        continue
      default:
        throw new TokenizeError(`Unexpected character '${ch}'`, start)
    }
  }
  return tokens
}

/**
 * Lenient variant for editors: never throws, marks anything it cannot lex as
 * an 'unknown' token so the formula bar can still colourise partial input.
 */
export function tokenizeLenient(src: string): Token[] {
  const out: Token[] = []
  let pos = 0
  while (pos < src.length) {
    try {
      const rest = tokenize(src.slice(pos), true)
      for (const t of rest) out.push({ ...t, start: t.start + pos, end: t.end + pos })
      break
    } catch (e) {
      if (e instanceof TokenizeError) {
        const at = pos + e.position
        // Tokenize the good prefix, then emit an unknown token for one char.
        if (e.position > 0) {
          const good = tokenize(src.slice(pos, at), true)
          for (const t of good) out.push({ ...t, start: t.start + pos, end: t.end + pos })
        }
        // Unterminated string: swallow the rest as a string token.
        if (e.message === 'Unterminated string') {
          out.push({ type: 'string', text: src.slice(at), start: at, end: src.length })
          break
        }
        out.push({ type: 'unknown', text: src[at], start: at, end: at + 1 })
        pos = at + 1
      } else {
        throw e
      }
    }
  }
  return out
}
