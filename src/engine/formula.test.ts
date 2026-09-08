import { describe, expect, it } from 'vitest'
import { functionCount } from './functions/index.ts'
import { parseFormula } from './parser.ts'
import { Sheet } from './sheet.ts'
import { isError, type Scalar } from './types.ts'
import { tokenize } from './tokenizer.ts'

function sheetWith(values: Record<string, string>): Sheet {
  const s = new Sheet()
  const edits = Object.entries(values).map(([addr, raw]) => {
    const m = /^([A-Z]+)(\d+)$/.exec(addr)!
    const col = m[1].split('').reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0) - 1
    return { row: parseInt(m[2], 10) - 1, col, raw }
  })
  s.setMany(edits)
  return s
}

/** Evaluate a formula in D1 of a sheet with A1..A3 = 1,2,3. */
function evalIn(formula: string, extra: Record<string, string> = {}): Scalar {
  const s = sheetWith({ A1: '1', A2: '2', A3: '3', ...extra, Z99: formula })
  return s.getValue(98, 25)
}

const code = (v: Scalar): string => (isError(v) ? v.code : String(v))

describe('tokenizer', () => {
  it('lexes numbers, strings, refs, operators', () => {
    const t = tokenize('SUM(A1:B2, "x""y", 1.5e3) <> -A$1%')
    expect(t.map((x) => x.type)).toEqual([
      'ident', 'lparen', 'ident', 'colon', 'ident', 'comma', 'string', 'comma', 'number', 'rparen',
      'op', 'op', 'ident', 'op',
    ])
    expect(t[6].text).toBe('"x""y"')
    expect(t[10].text).toBe('<>')
  })
  it('lexes error literals', () => {
    expect(tokenize('#N/A')[0]).toMatchObject({ type: 'error', text: '#N/A' })
    expect(tokenize('#ref!')[0]).toMatchObject({ type: 'error', text: '#REF!' })
  })
  it('throws on unterminated strings', () => {
    expect(() => tokenize('"abc')).toThrow(/Unterminated/)
  })
})

describe('parser', () => {
  it('builds precedence-correct trees', () => {
    const ast = parseFormula('1+2*3^2')
    expect(ast).toEqual({
      type: 'binary',
      op: '+',
      left: { type: 'number', value: 1 },
      right: {
        type: 'binary',
        op: '*',
        left: { type: 'number', value: 2 },
        right: { type: 'binary', op: '^', left: { type: 'number', value: 3 }, right: { type: 'number', value: 2 } },
      },
    })
  })
  it('parses all reference shapes', () => {
    expect(parseFormula('$A$1')).toEqual({ type: 'ref', ref: { row: 0, col: 0, absRow: true, absCol: true } })
    expect(parseFormula('A$1')).toEqual({ type: 'ref', ref: { row: 0, col: 0, absRow: true, absCol: false } })
    expect(parseFormula('$A1')).toEqual({ type: 'ref', ref: { row: 0, col: 0, absRow: false, absCol: true } })
    const range = parseFormula('B3:A1')
    expect(range.type).toBe('range')
    if (range.type === 'range') {
      expect(range.ref.start).toMatchObject({ row: 0, col: 0 })
      expect(range.ref.end).toMatchObject({ row: 2, col: 1 })
    }
    const col = parseFormula('A:C')
    expect(col.type === 'range' && col.ref.wholeCol).toBe(true)
    const row = parseFormula('SUM(2:2)')
    expect(row.type === 'call' && row.args[0].type === 'range' && row.args[0].ref.wholeRow).toBe(true)
  })
  it('parses nested calls, unary minus, percent, concat and comparisons', () => {
    const ast = parseFormula('IF(A1>=2,"y",-B1%)&"!"')
    expect(ast.type).toBe('binary')
    if (ast.type === 'binary') {
      expect(ast.op).toBe('&')
      expect(ast.left.type).toBe('call')
    }
  })
  it('reports parse errors with positions', () => {
    expect(() => parseFormula('SUM(1,')).toThrow(/end of formula/)
    expect(() => parseFormula('1 +* 2')).toThrow(/Unexpected/)
    expect(() => parseFormula('(1')).toThrow(/Expected '\)'/)
  })
})

describe('evaluator: acceptance formulas', () => {
  it('SUM(A1:A3) = 6', () => expect(evalIn('=SUM(A1:A3)')).toBe(6))
  it('AVERAGE(A1:A3) = 2', () => expect(evalIn('=AVERAGE(A1:A3)')).toBe(2))
  it('IF(A1>0,"yes","no") = yes', () => expect(evalIn('=IF(A1>0,"yes","no")')).toBe('yes'))
  it('A1/0 = #DIV/0!', () => expect(code(evalIn('=A1/0'))).toBe('#DIV/0!'))
  it('FOO(1) = #NAME?', () => expect(code(evalIn('=FOO(1)'))).toBe('#NAME?'))
  it('-2^2 = -4 (unary minus binds looser than ^)', () => expect(evalIn('=-2^2')).toBe(-4))
  it('2^-1 = 0.5 and 2^3^2 = 64 (left-assoc)', () => {
    expect(evalIn('=2^-1')).toBe(0.5)
    expect(evalIn('=2^3^2')).toBe(64)
  })
  it('50% = 0.5', () => expect(evalIn('=50%')).toBe(0.5))
  it('"a"&1 = a1', () => expect(evalIn('="a"&1')).toBe('a1'))
  it('parse errors surface as #ERROR! with a message', () => {
    const v = evalIn('=SUM(1,')
    expect(isError(v) && v.code).toBe('#ERROR!')
    expect(isError(v) && v.message).toMatch(/end of formula/)
  })
  it('error literals and propagation through operators and functions', () => {
    expect(code(evalIn('=#N/A+1'))).toBe('#N/A')
    expect(code(evalIn('=SUM(A1,B1)', { B1: '=1/0' }))).toBe('#DIV/0!')
    expect(code(evalIn('="x"+1'))).toBe('#VALUE!')
    expect(code(evalIn('=SQRT(-1)'))).toBe('#NUM!')
    expect(code(evalIn('=IFERROR(1/0,"fallback")'))).toBe('fallback')
    expect(evalIn('=ISERROR(A1/0)')).toBe(true)
  })
  it('coercion: numeric strings, booleans, blanks', () => {
    expect(evalIn('="12"+1')).toBe(13)
    expect(evalIn('=TRUE+1')).toBe(2)
    expect(evalIn('=B7+5')).toBe(5)
    expect(evalIn('=B7&"x"')).toBe('x')
    expect(evalIn('="abc"="ABC"')).toBe(true)
    expect(evalIn('=1<"a"')).toBe(true)
  })
})

describe('function library', () => {
  it('has at least 45 functions', () => {
    expect(functionCount()).toBeGreaterThanOrEqual(45)
  })
  it('VLOOKUP exact and approximate', () => {
    const table = { D1: 'apple', E1: '1', D2: 'pear', E2: '2', D3: 'plum', E3: '3' }
    expect(evalIn('=VLOOKUP("pear",D1:E3,2,FALSE)', table)).toBe(2)
    expect(code(evalIn('=VLOOKUP("kiwi",D1:E3,2,FALSE)', table))).toBe('#N/A')
    const grades = { D1: '0', E1: 'F', D2: '60', E2: 'D', D3: '70', E3: 'C', D4: '80', E4: 'B', D5: '90', E5: 'A' }
    expect(evalIn('=VLOOKUP(85,D1:E5,2,TRUE)', grades)).toBe('B')
    expect(evalIn('=VLOOKUP(59,D1:E5,2)', grades)).toBe('F')
  })
  it('HLOOKUP, INDEX/MATCH and XLOOKUP', () => {
    const data = { D1: 'north', E1: 'south', F1: 'east', D2: '10', E2: '20', F2: '30' }
    expect(evalIn('=HLOOKUP("south",D1:F2,2,FALSE)', data)).toBe(20)
    expect(evalIn('=INDEX(D2:F2,MATCH("east",D1:F1,0))', data)).toBe(30)
    expect(evalIn('=INDEX(D1:F2,2,1)', data)).toBe(10)
    expect(evalIn('=MATCH(20,D2:F2,0)', data)).toBe(2)
    expect(evalIn('=XLOOKUP("north",D1:F1,D2:F2)', data)).toBe(10)
    expect(evalIn('=XLOOKUP("west",D1:F1,D2:F2,"none")', data)).toBe('none')
  })
  it('text functions', () => {
    expect(evalIn('=PROPER("john o\'neil smith-jones")')).toBe("John O'Neil Smith-Jones")
    expect(evalIn('=UPPER("abc")&LOWER("DEF")')).toBe('ABCdef')
    expect(evalIn('=LEFT("hello",2)&RIGHT("hello",2)&MID("hello",2,3)')).toBe('heloell')
    expect(evalIn('=LEN(TRIM("  a  b  "))')).toBe(3)
    expect(evalIn('=SUBSTITUTE("a-b-c","-","+")')).toBe('a+b+c')
    expect(evalIn('=SUBSTITUTE("a-b-c","-","+",2)')).toBe('a-b+c')
    expect(evalIn('=FIND("b","abc")')).toBe(2)
    expect(code(evalIn('=FIND("z","abc")'))).toBe('#VALUE!')
    expect(evalIn('=TEXTBEFORE("alice@example.com","@")')).toBe('alice')
    expect(evalIn('=TEXTAFTER("alice@example.com","@")')).toBe('example.com')
    expect(evalIn('=TEXTAFTER("a.b.c",".",-1)')).toBe('c')
    expect(evalIn('=CONCAT("a",1,TRUE)')).toBe('a1TRUE')
    expect(evalIn('=TEXTJOIN(", ",TRUE,A1:A3)')).toBe('1, 2, 3')
  })
  it('TEXT with number and date formats', () => {
    expect(evalIn('=TEXT(1234.567,"#,##0.00")')).toBe('1,234.57')
    expect(evalIn('=TEXT(0.256,"0.0%")')).toBe('25.6%')
    expect(evalIn('=TEXT(-5,"$#,##0.00")')).toBe('-$5.00')
    expect(evalIn('=TEXT(7,"000")')).toBe('007')
    expect(evalIn('=TEXT(DATE(2024,3,4),"yyyy-mm-dd")')).toBe('2024-03-04')
    expect(evalIn('=TEXT(DATE(2024,3,4),"mmm d, yyyy")')).toBe('Mar 4, 2024')
    expect(evalIn('=TEXT(DATE(2024,3,4),"dddd")')).toBe('Monday')
  })
  it('DATE serial round-trips through YEAR/MONTH/DAY', () => {
    expect(evalIn('=DATE(2024,3,4)')).toBe(45355)
    expect(evalIn('=YEAR(DATE(2024,3,4))')).toBe(2024)
    expect(evalIn('=MONTH(DATE(2024,3,4))')).toBe(3)
    expect(evalIn('=DAY(DATE(2024,3,4))')).toBe(4)
    expect(evalIn('=DATE(2024,13,1)')).toBe(evalIn('=DATE(2025,1,1)'))
    expect(evalIn('=DATEDIF(DATE(2020,1,15),DATE(2024,3,4),"Y")')).toBe(4)
    expect(evalIn('=DATEDIF(DATE(2024,1,1),DATE(2024,3,4),"D")')).toBe(63)
    expect(evalIn('=DATEDIF(DATE(2023,11,20),DATE(2024,3,4),"M")')).toBe(3)
    expect(evalIn('=EDATE(DATE(2024,1,31),1)')).toBe(evalIn('=DATE(2024,2,29)'))
    expect(evalIn('=WEEKDAY(DATE(2024,3,4))')).toBe(2)
  })
  it('TODAY uses the sheet clock', () => {
    const s = new Sheet()
    s.setClock(() => new Date(2024, 2, 4, 10, 0, 0))
    s.set(0, 0, '=TODAY()')
    expect(s.getValue(0, 0)).toBe(45355)
  })
  it('math and stats', () => {
    expect(evalIn('=ROUND(2.675,2)')).toBe(2.68)
    expect(evalIn('=ROUND(-1.5)')).toBe(-2)
    expect(evalIn('=MOD(-7,3)')).toBe(2)
    expect(evalIn('=POWER(2,10)')).toBe(1024)
    expect(evalIn('=SQRT(16)')).toBe(4)
    expect(evalIn('=ABS(-3)')).toBe(3)
    expect(evalIn('=SUMIF(A1:A3,">1")')).toBe(5)
    expect(evalIn('=COUNTIF(A1:A3,"<3")')).toBe(2)
    expect(evalIn('=SUMIF(D1:D3,"a",A1:A3)', { D1: 'a', D2: 'b', D3: 'A' })).toBe(4)
    expect(evalIn('=COUNTIF(D1:D3,"a*")', { D1: 'apple', D2: 'banana', D3: 'avocado' })).toBe(2)
    expect(evalIn('=SUMPRODUCT(A1:A3,A1:A3)')).toBe(14)
    expect(evalIn('=MEDIAN(A1:A3,10)')).toBe(2.5)
    expect(evalIn('=ROUND(STDEV(2,4,4,4,5,5,7,9),4)')).toBe(2.1381)
    expect(evalIn('=STDEVP(2,4,4,4,5,5,7,9)')).toBe(2)
    expect(evalIn('=RANK(A2,A1:A3)')).toBe(2)
    expect(evalIn('=RANK(A1,A1:A3,1)')).toBe(1)
    expect(evalIn('=COUNT(A1:A3,"x")')).toBe(3)
    expect(evalIn('=COUNTA(A1:A5)')).toBe(3)
    expect(evalIn('=MAX(A1:A3)-MIN(A1:A3)')).toBe(2)
  })
  it('logic', () => {
    expect(evalIn('=AND(A1>0,A2>1,A3>2)')).toBe(true)
    expect(evalIn('=OR(FALSE,A1>5)')).toBe(false)
    expect(evalIn('=NOT(TRUE)')).toBe(false)
    expect(evalIn('=IFS(A1>5,"big",A1>0,"small")')).toBe('small')
    expect(code(evalIn('=IFS(A1>5,"big")'))).toBe('#N/A')
    expect(evalIn('=IF(A1>0,"yes")')).toBe('yes')
    expect(evalIn('=SWITCH(2,1,"one",2,"two","other")')).toBe('two')
  })
  it('ranges cannot be displayed directly', () => {
    expect(code(evalIn('=A1:A3'))).toBe('#VALUE!')
    expect(evalIn('=A1:A1')).toBe(1)
  })
  it('ROW and COLUMN', () => {
    expect(evalIn('=ROW()')).toBe(99)
    expect(evalIn('=COLUMN(B7)')).toBe(2)
  })
})
