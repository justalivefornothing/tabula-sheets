import { describe, expect, it } from 'vitest'
import { describeProgram, inferSmartFill, runProgram, type Program } from './smartfill.ts'

function infer(examples: Array<[string, string]>, remaining: string[]) {
  return inferSmartFill(
    examples.map(([input, output]) => ({ input, output })),
    remaining,
  )
}

describe('Smart Fill: programming by example', () => {
  it('infers "text after @" from two email examples', () => {
    const r = infer([['alice@example.com', 'example.com'], ['bob@test.org', 'test.org']], ['carol@site.net', 'dan@corp.io'])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.result.preview).toEqual(['site.net', 'corp.io'])
    expect(runProgram(r.result.program, 'carol@site.net')).toBe('site.net')
    expect(r.result.description).toMatch(/after '@'/)
    expect(r.result.confidence).toBe('high')
  })

  it('infers title case', () => {
    const r = infer([['john smith', 'John Smith']], ['ada lovelace', 'GRACE HOPPER'])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.result.preview).toEqual(['Ada Lovelace', 'Grace Hopper'])
    expect(r.result.description).toMatch(/Title Case/)
  })

  it('infers a date reformat from MM/DD/YYYY to YYYY-MM-DD', () => {
    const r = infer([['03/04/2024', '2024-03-04'], ['12/25/2023', '2023-12-25']], ['07/01/2022'])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.result.preview).toEqual(['2022-07-01'])
    expect(r.result.program).toEqual({ op: 'date', inputFormat: 'MM/DD/YYYY', outputFormat: 'YYYY-MM-DD' })
    expect(r.result.description).toMatch(/MM\/DD\/YYYY.*YYYY-MM-DD/)
  })

  it('handles mixed messy date shapes when one output format is requested', () => {
    const r = infer([['March 4, 2024', '2024-03-04'], ['Dec 25, 2023', '2023-12-25']], ['Jan 2, 2021'])
    expect(r.ok && r.result.preview[0]).toBe('2021-01-02')
  })

  it('returns null with a reason for conflicting examples', () => {
    const r = infer([['a@b.com', 'b.com'], ['a@b.com', 'a']], [])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/Conflicting/)
  })

  it('returns null with a reason when nothing in the DSL fits', () => {
    const r = infer([['alice', 'zzzz1'], ['bob', 'qq77']], [])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/No single program/)
  })

  it('composes concat programs: "Last, First" from "first last"', () => {
    const r = infer([['john smith', 'Smith, John'], ['ada lovelace', 'Lovelace, Ada']], ['grace hopper'])
    expect(r.ok && r.result.preview[0]).toBe('Hopper, Grace')
    if (r.ok) expect(r.result.description).toMatch(/last word.*Title Case.*', '.*1st word/)
  })

  it('extracts tokens, initials and fixed windows', () => {
    const initials = infer([['john smith', 'JS'], ['ada lovelace', 'AL']], ['grace hopper'])
    expect(initials.ok && initials.result.preview[0]).toBe('GH')

    const area = infer([['(415) 555-1234', '415'], ['(212) 555-9876', '212']], ['(650) 555-0000'])
    expect(area.ok && area.result.preview[0]).toBe('650')

    const sku = infer([['SKU-00123-BLU', '00123'], ['SKU-98765-RED', '98765']], ['SKU-11111-GRN'])
    expect(sku.ok && sku.result.preview[0]).toBe('11111')

    const url = infer([['https://www.example.com/path', 'example.com'], ['https://www.test.org/x/y', 'test.org']], ['https://www.site.net/'])
    expect(url.ok && url.result.preview[0]).toBe('site.net')
  })

  it('reformats numbers', () => {
    const r = infer([['1234.5', '$1,234.50'], ['7', '$7.00']], ['99.999'])
    expect(r.ok && r.result.preview[0]).toBe('$100.00')
  })

  it('lowers confidence when programs disagree or rows fail', () => {
    const r = infer([['a-b', 'a']], ['c-d', 'e'])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.result.confidence).toBe('low')
    expect(r.result.reason).toMatch(/Only one example/)
  })

  it('describes programs in plain English', () => {
    const p: Program = { op: 'concat', parts: [{ op: 'case', mode: 'upper', inner: { op: 'split', delimiter: ' ', index: -1 } }, { op: 'const', text: ' / ' }, { op: 'before', anchor: '@', occurrence: 1 }] }
    expect(describeProgram(p)).toBe("[the last word in UPPER CASE] + ' / ' + [the text before '@']")
    expect(describeProgram({ op: 'split', delimiter: ',', index: 1 })).toBe("the 2nd part split by ','")
    expect(describeProgram({ op: 'substr', start: 0, length: 3 })).toBe('the first 3 characters')
  })
})
