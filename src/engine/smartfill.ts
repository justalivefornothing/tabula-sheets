/**
 * Smart Fill: deterministic programming-by-example over a small string
 * transformation DSL. Given (input -> output) examples it searches for the
 * simplest program consistent with every example, explains it in plain
 * English and previews it on the remaining rows. No model, no network:
 * local pattern inference only.
 *
 * DSL
 *   identity                    the input unchanged
 *   split(delim, index)         nth token after splitting (negative = from end)
 *   after(anchor, occurrence)   text after the first/last occurrence of anchor
 *   before(anchor, occurrence)  text before the first/last occurrence of anchor
 *   between(left, right)        text between two anchors
 *   substr(start, length)       fixed character window from the left
 *   suffix(length)              last N characters
 *   firstChar(inner)            first character of a sub-result (initials)
 *   case(mode, inner)           UPPER / lower / Title / Sentence
 *   trim(inner)                 strip surrounding whitespace
 *   date(inFmt, outFmt)         parse a date shape and re-format it
 *   number(spec)                parse a number and re-format it
 *   const(text)                 a literal
 *   concat(parts...)            join sub-programs and literals
 */

import { formatDate, monthFromName, dateToSerial, daysInMonth } from './dates.ts'
import { properCase } from './functions/text.ts'
import { formatNumber } from './format.ts'
import { parseNumericString } from './coerce.ts'

export interface Example {
  input: string
  output: string
}

export type CaseMode = 'upper' | 'lower' | 'title' | 'sentence'

export type Program =
  | { op: 'identity' }
  | { op: 'const'; text: string }
  | { op: 'split'; delimiter: string; index: number }
  | { op: 'after'; anchor: string; occurrence: 1 | -1 }
  | { op: 'before'; anchor: string; occurrence: 1 | -1 }
  | { op: 'between'; left: string; right: string }
  | { op: 'substr'; start: number; length: number }
  | { op: 'suffix'; length: number }
  | { op: 'firstChar'; inner: Program }
  | { op: 'case'; mode: CaseMode; inner: Program }
  | { op: 'trim'; inner: Program }
  | { op: 'date'; inputFormat: string; outputFormat: string }
  | { op: 'number'; pattern: string }
  | { op: 'concat'; parts: Program[] }

export type Confidence = 'high' | 'medium' | 'low'

export interface SmartFillResult {
  program: Program
  description: string
  confidence: Confidence
  reason: string
  /** Outputs for the remaining inputs; null where the program does not apply. */
  preview: (string | null)[]
  alternatives: string[]
}

export type SmartFillOutcome = { ok: true; result: SmartFillResult } | { ok: false; reason: string }

// ------------------------------------------------------------------ dates

interface DateShape {
  name: string
  re: RegExp
  build: (m: RegExpExecArray) => { y: number; m: number; d: number } | null
}

function year2(yy: string): number {
  const n = parseInt(yy, 10)
  return n < 70 ? 2000 + n : 1900 + n
}

const DATE_SHAPES: DateShape[] = [
  { name: 'MM/DD/YYYY', re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, build: (m) => ({ y: +m[3], m: +m[1], d: +m[2] }) },
  { name: 'DD/MM/YYYY', re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, build: (m) => ({ y: +m[3], m: +m[2], d: +m[1] }) },
  { name: 'YYYY-MM-DD', re: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, build: (m) => ({ y: +m[1], m: +m[2], d: +m[3] }) },
  { name: 'YYYY/MM/DD', re: /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, build: (m) => ({ y: +m[1], m: +m[2], d: +m[3] }) },
  { name: 'MM-DD-YYYY', re: /^(\d{1,2})-(\d{1,2})-(\d{4})$/, build: (m) => ({ y: +m[3], m: +m[1], d: +m[2] }) },
  { name: 'DD-MM-YYYY', re: /^(\d{1,2})-(\d{1,2})-(\d{4})$/, build: (m) => ({ y: +m[3], m: +m[2], d: +m[1] }) },
  { name: 'DD.MM.YYYY', re: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, build: (m) => ({ y: +m[3], m: +m[2], d: +m[1] }) },
  { name: 'MM/DD/YY', re: /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/, build: (m) => ({ y: year2(m[3]), m: +m[1], d: +m[2] }) },
  { name: 'DD/MM/YY', re: /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/, build: (m) => ({ y: year2(m[3]), m: +m[2], d: +m[1] }) },
  { name: 'YYYYMMDD', re: /^(\d{4})(\d{2})(\d{2})$/, build: (m) => ({ y: +m[1], m: +m[2], d: +m[3] }) },
  {
    name: 'Month D, YYYY',
    re: /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/,
    build: (m) => {
      const mo = monthFromName(m[1])
      return mo ? { y: +m[3], m: mo, d: +m[2] } : null
    },
  },
  {
    name: 'D Month YYYY',
    re: /^(\d{1,2})[\s-]([A-Za-z]{3,9})\.?[\s-,]+(\d{4})$/,
    build: (m) => {
      const mo = monthFromName(m[2])
      return mo ? { y: +m[3], m: mo, d: +m[1] } : null
    },
  },
]

const DATE_OUTPUTS: Array<{ name: string; pattern: string }> = [
  { name: 'YYYY-MM-DD', pattern: 'yyyy-mm-dd' },
  { name: 'MM/DD/YYYY', pattern: 'mm/dd/yyyy' },
  { name: 'DD/MM/YYYY', pattern: 'dd/mm/yyyy' },
  { name: 'M/D/YYYY', pattern: 'm/d/yyyy' },
  { name: 'DD.MM.YYYY', pattern: 'dd.mm.yyyy' },
  { name: 'YYYY/MM/DD', pattern: 'yyyy/mm/dd' },
  { name: 'DD-Mon-YYYY', pattern: 'dd-mmm-yyyy' },
  { name: 'D Mon YYYY', pattern: 'd mmm yyyy' },
  { name: 'Mon D, YYYY', pattern: 'mmm d, yyyy' },
  { name: 'Month D, YYYY', pattern: 'mmmm d, yyyy' },
  { name: 'MM/DD/YY', pattern: 'mm/dd/yy' },
  { name: 'YYYY', pattern: 'yyyy' },
  { name: 'Month', pattern: 'mmmm' },
  { name: 'Mon', pattern: 'mmm' },
  { name: 'Weekday', pattern: 'dddd' },
]

function parseDateShape(text: string, shapeName: string): number | null {
  const shape = DATE_SHAPES.find((s) => s.name === shapeName)
  if (!shape) return null
  const m = shape.re.exec(text.trim())
  if (!m) return null
  const ymd = shape.build(m)
  if (!ymd) return null
  if (ymd.m < 1 || ymd.m > 12 || ymd.d < 1 || ymd.d > daysInMonth(ymd.y, ymd.m)) return null
  return dateToSerial(ymd.y, ymd.m, ymd.d)
}

// --------------------------------------------------------------- execution

function nthIndex(hay: string, needle: string, occurrence: 1 | -1): number {
  return occurrence === 1 ? hay.indexOf(needle) : hay.lastIndexOf(needle)
}

function applyCase(s: string, mode: CaseMode): string {
  switch (mode) {
    case 'upper':
      return s.toUpperCase()
    case 'lower':
      return s.toLowerCase()
    case 'title':
      return properCase(s)
    case 'sentence':
      return s.length ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s
  }
}

/** Run a program; null means "does not apply to this input". */
export function runProgram(p: Program, input: string): string | null {
  switch (p.op) {
    case 'identity':
      return input
    case 'const':
      return p.text
    case 'split': {
      if (p.delimiter === '') return null
      const parts = input.split(p.delimiter)
      const idx = p.index >= 0 ? p.index : parts.length + p.index
      if (idx < 0 || idx >= parts.length) return null
      return parts[idx]
    }
    case 'after': {
      const i = nthIndex(input, p.anchor, p.occurrence)
      return i < 0 ? null : input.slice(i + p.anchor.length)
    }
    case 'before': {
      const i = nthIndex(input, p.anchor, p.occurrence)
      return i < 0 ? null : input.slice(0, i)
    }
    case 'between': {
      const i = input.indexOf(p.left)
      if (i < 0) return null
      const j = input.indexOf(p.right, i + p.left.length)
      return j < 0 ? null : input.slice(i + p.left.length, j)
    }
    case 'substr':
      if (p.start + p.length > input.length) return null
      return input.slice(p.start, p.start + p.length)
    case 'suffix':
      if (p.length > input.length) return null
      return input.slice(input.length - p.length)
    case 'firstChar': {
      const inner = runProgram(p.inner, input)
      return inner === null || inner.length === 0 ? null : inner[0]
    }
    case 'case': {
      const inner = runProgram(p.inner, input)
      return inner === null ? null : applyCase(inner, p.mode)
    }
    case 'trim': {
      const inner = runProgram(p.inner, input)
      return inner === null ? null : inner.trim()
    }
    case 'date': {
      const serial = parseDateShape(input, p.inputFormat)
      if (serial === null) return null
      const out = DATE_OUTPUTS.find((o) => o.name === p.outputFormat)
      return out ? formatDate(serial, out.pattern) : null
    }
    case 'number': {
      const n = parseNumericString(input)
      return n === null ? null : formatNumber(n, p.pattern)
    }
    case 'concat': {
      let out = ''
      for (const part of p.parts) {
        const s = runProgram(part, input)
        if (s === null) return null
        out += s
      }
      return out
    }
  }
}

export function programSize(p: Program): number {
  switch (p.op) {
    case 'identity':
    case 'const':
      return 1
    case 'split':
    case 'after':
    case 'before':
    case 'date':
    case 'number':
      return 2
    case 'between':
    case 'substr':
    case 'suffix':
      return 3
    case 'firstChar':
    case 'case':
    case 'trim':
      return 1 + programSize(p.inner)
    case 'concat':
      return p.parts.reduce((a, b) => a + programSize(b), 1)
  }
}

// ------------------------------------------------------------- description

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th']

function ordinal(n: number): string {
  return ORDINALS[n] ?? `${n + 1}th`
}

function quote(s: string): string {
  if (s === ' ') return 'a space'
  if (s === '  ') return 'two spaces'
  return `'${s}'`
}

function tokenNoun(delim: string): string {
  return delim === ' ' ? 'word' : delim === '\n' ? 'line' : `part split by ${quote(delim)}`
}

export function describeProgram(p: Program): string {
  switch (p.op) {
    case 'identity':
      return 'the text unchanged'
    case 'const':
      return quote(p.text)
    case 'split': {
      const noun = tokenNoun(p.delimiter)
      if (p.index === -1) return `the last ${noun}`
      if (p.index < -1) return `the ${ordinal(-p.index - 1)}-to-last ${noun}`
      return `the ${ordinal(p.index)} ${noun}`
    }
    case 'after':
      return p.occurrence === 1 ? `the text after ${quote(p.anchor)}` : `the text after the last ${quote(p.anchor)}`
    case 'before':
      return p.occurrence === 1 ? `the text before ${quote(p.anchor)}` : `the text before the last ${quote(p.anchor)}`
    case 'between':
      return `the text between ${quote(p.left)} and ${quote(p.right)}`
    case 'substr':
      if (p.start === 0) return `the first ${p.length} character${p.length === 1 ? '' : 's'}`
      return `characters ${p.start + 1} to ${p.start + p.length}`
    case 'suffix':
      return `the last ${p.length} character${p.length === 1 ? '' : 's'}`
    case 'firstChar':
      return `the first letter of ${describeProgram(p.inner)}`
    case 'case': {
      const mode = { upper: 'UPPER CASE', lower: 'lower case', title: 'Title Case', sentence: 'Sentence case' }[p.mode]
      return `${describeProgram(p.inner)} in ${mode}`
    }
    case 'trim':
      return `${describeProgram(p.inner)}, trimmed`
    case 'date':
      return `the date read as ${p.inputFormat}, written as ${p.outputFormat}`
    case 'number':
      return `the number formatted as ${p.pattern}`
    case 'concat':
      return p.parts.map((part) => (part.op === 'const' ? quote(part.text) : `[${describeProgram(part)}]`)).join(' + ')
  }
}

// ------------------------------------------------------------- synthesis

interface Extractor {
  prog: Program
  cost: number
  /** Output on the first example. */
  out: string
}

const COMMON_ANCHORS = [', ', ' - ', ': ', ' / ', ' | ', '://', 'www.', ' (', ') ']

function anchorsIn(input: string): string[] {
  const set = new Set<string>()
  for (const ch of input) if (!/[\p{L}\p{N}]/u.test(ch)) set.add(ch)
  for (const a of COMMON_ANCHORS) if (input.includes(a)) set.add(a)
  return [...set]
}

/**
 * Tie-breaking preferences between equally-sized programs: structural
 * operations (split on a space, text after an anchor) read better and
 * generalise better than fixed character windows or interior token indices.
 */
function nuance(p: Program): number {
  switch (p.op) {
    case 'split':
      return (p.delimiter === ' ' ? 0 : 0.3) + 0.1 * (p.index >= 0 ? p.index : -p.index - 1)
    case 'after':
    case 'before':
      return p.occurrence === 1 ? 0 : 0.2
    case 'between':
      return 0.2
    case 'substr':
    case 'suffix':
      return 0.6
    default:
      return 0
  }
}

function withVariants(base: Program, input: string, push: (p: Program, extra: number) => void): void {
  const baseOut = runProgram(base, input)
  if (baseOut === null) return
  const n = nuance(base)
  push(base, n)
  const trimmed = baseOut.trim()
  if (trimmed !== baseOut && trimmed !== '') push({ op: 'trim', inner: base }, n + 0.5)
  for (const mode of ['upper', 'lower', 'title', 'sentence'] as const) {
    const cased = applyCase(baseOut, mode)
    if (cased !== baseOut) push({ op: 'case', mode, inner: base }, n + 1)
    if (trimmed !== baseOut && applyCase(trimmed, mode) !== trimmed) push({ op: 'case', mode, inner: { op: 'trim', inner: base } }, n + 1.5)
  }
  if (baseOut.length > 1) {
    push({ op: 'firstChar', inner: base }, n + 1.5)
    const first = baseOut[0]
    if (first.toUpperCase() !== first) push({ op: 'case', mode: 'upper', inner: { op: 'firstChar', inner: base } }, n + 2)
  }
}

/** Enumerate every atomic extractor for the first input, tagged with its output. */
function buildExtractors(first: Example, allInputs: string[]): Extractor[] {
  const input = first.input
  const list: Extractor[] = []
  const seen = new Set<string>()
  const push = (prog: Program, extra: number): void => {
    const out = runProgram(prog, input)
    if (out === null || out === '') return
    const key = JSON.stringify(prog)
    if (seen.has(key)) return
    seen.add(key)
    list.push({ prog, cost: programSize(prog) + extra, out })
  }

  withVariants({ op: 'identity' }, input, push)

  const anchors = anchorsIn(input)
  for (const d of anchors) {
    const parts = input.split(d)
    if (parts.length > 1) {
      const maxIdx = Math.min(parts.length, 8)
      for (let i = 0; i < maxIdx; i++) withVariants({ op: 'split', delimiter: d, index: i }, input, push)
      for (let i = 1; i <= maxIdx; i++) withVariants({ op: 'split', delimiter: d, index: -i }, input, push)
    }
    withVariants({ op: 'after', anchor: d, occurrence: 1 }, input, push)
    withVariants({ op: 'before', anchor: d, occurrence: 1 }, input, push)
    if (input.indexOf(d) !== input.lastIndexOf(d)) {
      withVariants({ op: 'after', anchor: d, occurrence: -1 }, input, push)
      withVariants({ op: 'before', anchor: d, occurrence: -1 }, input, push)
    }
    for (const e of anchors) {
      if (e === d) continue
      withVariants({ op: 'between', left: d, right: e }, input, push)
    }
  }

  // Fixed windows — kept small: prefixes, suffixes and short interior windows.
  const n = input.length
  for (let len = 1; len <= Math.min(n, 12); len++) {
    withVariants({ op: 'substr', start: 0, length: len }, input, push)
    withVariants({ op: 'suffix', length: len }, input, push)
  }
  for (let start = 1; start < Math.min(n, 10); start++) {
    for (let len = 1; start + len <= Math.min(n, 12); len++) withVariants({ op: 'substr', start, length: len }, input, push)
  }

  // Dates: only shapes that parse every example input.
  for (const shape of DATE_SHAPES) {
    if (!allInputs.every((s) => parseDateShape(s, shape.name) !== null)) continue
    for (const out of DATE_OUTPUTS) push({ op: 'date', inputFormat: shape.name, outputFormat: out.name }, 0)
  }

  // Numbers
  if (allInputs.every((s) => parseNumericString(s) !== null)) {
    for (const pattern of ['0', '0.0', '0.00', '0.000', '#,##0', '#,##0.00', '$#,##0.00', '$#,##0', '0%', '0.0%', '0.00%']) {
      push({ op: 'number', pattern }, 0)
    }
  }

  list.sort((a, b) => a.cost - b.cost)
  return list
}

type Piece = { kind: 'lit'; text: string } | { kind: 'ext'; out: string }

interface SearchNode {
  pos: number
  pieces: Piece[]
  cost: number
}

// Literals are deliberately pricey so "copy the example output verbatim" never
// beats a real transformation, while short joiners like ", " stay cheap.
const LITERAL_BASE = 1.5
const LITERAL_PER_CHAR = 0.15
const MAX_EXPANSIONS = 40_000

/** Minimal binary heap keyed on cost. */
class Heap {
  private readonly items: SearchNode[] = []
  get size(): number {
    return this.items.length
  }
  push(n: SearchNode): void {
    const a = this.items
    a.push(n)
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p].cost <= a[i].cost) break
      ;[a[p], a[i]] = [a[i], a[p]]
      i = p
    }
  }
  pop(): SearchNode | undefined {
    const a = this.items
    if (a.length === 0) return undefined
    const top = a[0]
    const last = a.pop()!
    if (a.length > 0) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < a.length && a[l].cost < a[m].cost) m = l
        if (r < a.length && a[r].cost < a[m].cost) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i], a[m]]
        i = m
      }
    }
    return top
  }
}

/** Resolve a piece sequence to concrete programs consistent with every example. */
function verify(pieces: Piece[], examples: Example[], classes: Map<string, Extractor[]>): Program[] | null {
  const outputs = examples.map((e) => e.output)
  const inputs = examples.map((e) => e.input)
  const positions = new Array<number>(examples.length).fill(0)
  const chosen: Program[] = []

  const rec = (i: number): boolean => {
    if (i === pieces.length) return positions.every((p, j) => p === outputs[j].length)
    const piece = pieces[i]
    if (piece.kind === 'lit') {
      for (let j = 0; j < outputs.length; j++) if (!outputs[j].startsWith(piece.text, positions[j])) return false
      for (let j = 0; j < outputs.length; j++) positions[j] += piece.text.length
      chosen.push({ op: 'const', text: piece.text })
      if (rec(i + 1)) return true
      chosen.pop()
      for (let j = 0; j < outputs.length; j++) positions[j] -= piece.text.length
      return false
    }
    const candidates = classes.get(piece.out) ?? []
    for (const cand of candidates) {
      const outs: string[] = []
      let ok = true
      for (let j = 0; j < inputs.length; j++) {
        const o = j === 0 ? cand.out : runProgram(cand.prog, inputs[j])
        if (o === null || o === '' || !outputs[j].startsWith(o, positions[j])) {
          ok = false
          break
        }
        outs.push(o)
      }
      if (!ok) continue
      for (let j = 0; j < outputs.length; j++) positions[j] += outs[j].length
      chosen.push(cand.prog)
      if (rec(i + 1)) return true
      chosen.pop()
      for (let j = 0; j < outputs.length; j++) positions[j] -= outs[j].length
    }
    return false
  }

  return rec(0) ? chosen.slice() : null
}

function toProgram(parts: Program[]): Program {
  return parts.length === 1 ? parts[0] : { op: 'concat', parts }
}

interface Candidate {
  program: Program
  cost: number
}

/** Best-first search over segmentations of the first output, verified on all examples. */
function synthesise(examples: Example[], maxResults: number): Candidate[] {
  const first = examples[0]
  const extractors = buildExtractors(first, examples.map((e) => e.input))
  const classes = new Map<string, Extractor[]>()
  for (const e of extractors) {
    const arr = classes.get(e.out)
    if (arr) arr.push(e)
    else classes.set(e.out, [e])
  }
  const target = first.output
  // matches[p] = class strings that occur at position p of the target
  const matches: Array<Array<{ out: string; cost: number }>> = Array.from({ length: target.length }, () => [])
  for (const [out, list] of classes) {
    let idx = target.indexOf(out)
    while (idx >= 0) {
      matches[idx].push({ out, cost: list[0].cost })
      idx = target.indexOf(out, idx + 1)
    }
  }

  const heap = new Heap()
  heap.push({ pos: 0, pieces: [], cost: 0 })
  const results: Candidate[] = []
  const seenPrograms = new Set<string>()
  let expansions = 0

  while (heap.size > 0 && expansions < MAX_EXPANSIONS) {
    const node = heap.pop()!
    expansions++
    if (node.pos === target.length) {
      if (node.pieces.length === 0) continue
      const resolved = verify(node.pieces, examples, classes)
      if (resolved) {
        const program = toProgram(resolved)
        const key = JSON.stringify(program)
        if (!seenPrograms.has(key)) {
          seenPrograms.add(key)
          results.push({ program, cost: node.cost })
          if (results.length >= maxResults) break
        }
      }
      continue
    }
    // Only the cheapest few results matter; stop once we are far past the best.
    if (results.length > 0 && node.cost > results[0].cost + 3) break

    for (const m of matches[node.pos]) {
      heap.push({ pos: node.pos + m.out.length, pieces: [...node.pieces, { kind: 'ext', out: m.out }], cost: node.cost + 1 + m.cost * 0.35 })
    }
    const last = node.pieces[node.pieces.length - 1]
    if (!last || last.kind !== 'lit') {
      const maxLit = Math.min(target.length - node.pos, 24)
      for (let len = 1; len <= maxLit; len++) {
        heap.push({
          pos: node.pos + len,
          pieces: [...node.pieces, { kind: 'lit', text: target.slice(node.pos, node.pos + len) }],
          cost: node.cost + LITERAL_BASE + LITERAL_PER_CHAR * len,
        })
      }
    }
  }
  return results
}

// ------------------------------------------------------------------ public

/**
 * Infer a program from examples and preview it on the remaining inputs.
 * Returns `{ ok: false, reason }` when the examples conflict or no program in
 * the DSL explains them all.
 */
export function inferSmartFill(examples: Example[], remaining: string[]): SmartFillOutcome {
  const cleaned = examples.filter((e) => e.output !== '')
  if (cleaned.length === 0) return { ok: false, reason: 'Type at least one example output next to an input.' }
  if (cleaned.some((e) => e.input === '')) return { ok: false, reason: 'Every example needs a non-empty input.' }

  const byInput = new Map<string, string>()
  for (const e of cleaned) {
    const prev = byInput.get(e.input)
    if (prev !== undefined && prev !== e.output) {
      return { ok: false, reason: `Conflicting examples: '${e.input}' maps to both '${prev}' and '${e.output}'.` }
    }
    byInput.set(e.input, e.output)
  }
  const unique = [...byInput.entries()].map(([input, output]) => ({ input, output }))

  const candidates = synthesise(unique, 6)
  if (candidates.length === 0) {
    return {
      ok: false,
      reason:
        unique.length === 1
          ? `No program in the DSL turns '${unique[0].input}' into '${unique[0].output}'.`
          : 'No single program in the DSL explains all the examples. Check for a typo, or add a clearer example.',
    }
  }

  const best = candidates[0]
  const preview = remaining.map((s) => (s === '' ? null : runProgram(best.program, s)))
  const failures = preview.filter((p, i) => p === null && remaining[i] !== '').length

  // Alternatives of similar simplicity that behave differently on the remaining
  // rows reveal genuine ambiguity; far more complex coincidences do not count.
  const disagreeing: string[] = []
  for (const alt of candidates.slice(1)) {
    if (alt.cost > best.cost + 1.0) continue
    const altPreview = remaining.map((s) => (s === '' ? null : runProgram(alt.program, s)))
    const differs = altPreview.some((v, i) => v !== preview[i])
    if (differs) disagreeing.push(describeProgram(alt.program))
  }

  let confidence: Confidence
  let reason: string
  if (unique.length >= 2 && disagreeing.length === 0) {
    confidence = 'high'
    reason = `${unique.length} examples agree and every other consistent program gives the same result on the remaining rows.`
  } else if (unique.length >= 2) {
    confidence = 'medium'
    reason = `${unique.length} examples agree, but ${disagreeing.length} other program${disagreeing.length === 1 ? '' : 's'} also fit${disagreeing.length === 1 ? 's' : ''} them and would give different results on some rows. Add an example that distinguishes them.`
  } else {
    confidence = disagreeing.length === 0 ? 'medium' : 'low'
    reason = 'Only one example was given; a second example makes the inference much more reliable.'
  }
  if (failures > 0) {
    if (confidence === 'high') confidence = 'medium'
    else confidence = 'low'
    reason += ` The program does not apply to ${failures} of the remaining rows (left blank).`
  }

  return {
    ok: true,
    result: {
      program: best.program,
      description: describeProgram(best.program),
      confidence,
      reason,
      preview,
      alternatives: disagreeing.slice(0, 3),
    },
  }
}
