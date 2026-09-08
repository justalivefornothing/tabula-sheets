import type { SheetDocument } from '../engine/workbook.ts'
import type { CellFormat } from '../engine/types.ts'

type Row = Array<string | number | null>

interface SampleSpec {
  id: string
  name: string
  blurb: string
  rows: Row[]
  formats?: Array<{ range: [r0: number, c0: number, r1: number, c1: number]; format: CellFormat }>
  colWidths?: Array<[number, number]>
}

export interface SampleInfo {
  id: string
  name: string
  blurb: string
}

function build(spec: SampleSpec): SheetDocument {
  const cells: SheetDocument['cells'] = []
  const fmtFor = (r: number, c: number): CellFormat | undefined => {
    let out: CellFormat | undefined
    for (const f of spec.formats ?? []) {
      const [r0, c0, r1, c1] = f.range
      if (r >= r0 && r <= r1 && c >= c0 && c <= c1) out = { ...out, ...f.format }
    }
    return out
  }
  spec.rows.forEach((row, r) => {
    row.forEach((v, c) => {
      const fmt = fmtFor(r, c)
      if (v === null || v === '') {
        if (fmt) cells.push([r, c, '', fmt])
        return
      }
      const raw = typeof v === 'number' ? String(v) : v
      if (fmt) cells.push([r, c, raw, fmt])
      else cells.push([r, c, raw])
    })
  })
  return {
    version: 1,
    id: `sample:${spec.id}`,
    name: spec.name,
    cells,
    colWidths: spec.colWidths ?? [],
    rowHeights: [],
    updatedAt: 0,
  }
}

const REGIONS = ['North', 'South', 'East', 'West']
const PRODUCTS: Array<[string, number]> = [
  ['Ledger Pro', 129],
  ['Ledger Lite', 49],
  ['Ink Pack', 18.5],
  ['Paper Ream', 6.25],
  ['Desk Pad', 32],
]

function salesLedger(): SampleSpec {
  const rows: Row[] = [['Date', 'Region', 'Product', 'Units', 'Unit price', 'Revenue', 'Large order?', 'Rep']]
  const reps = ['Ada', 'Grace', 'Linus', 'Margaret', 'Ken']
  let seed = 7
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  for (let i = 0; i < 40; i++) {
    const day = 1 + Math.floor(rnd() * 28)
    const month = 1 + (i % 3)
    const [product, price] = PRODUCTS[Math.floor(rnd() * PRODUCTS.length)]
    const units = 1 + Math.floor(rnd() * 24)
    const r = i + 2
    rows.push([
      `=DATE(2024,${month},${day})`,
      REGIONS[Math.floor(rnd() * REGIONS.length)],
      product,
      units,
      price,
      `=D${r}*E${r}`,
      `=IF(F${r}>=500,"yes","")`,
      reps[Math.floor(rnd() * reps.length)],
    ])
  }
  // Summary block
  const last = rows.length
  rows.push([])
  rows.push(['Summary', null, null, null, null, null, null, null])
  rows.push(['Total revenue', null, null, null, null, `=SUM(F2:F${last})`])
  rows.push(['Average order', null, null, null, null, `=AVERAGE(F2:F${last})`])
  rows.push(['Largest order', null, null, null, null, `=MAX(F2:F${last})`])
  rows.push(['Orders', null, null, null, null, `=COUNT(F2:F${last})`])
  rows.push(['Large orders', null, null, null, null, `=COUNTIF(G2:G${last},"yes")`])
  rows.push([])
  rows.push(['By region', 'Revenue', 'Orders', 'Share'])
  const byRegionStart = rows.length + 1
  for (const region of REGIONS) {
    const r = rows.length + 1
    rows.push([region, `=SUMIF($B$2:$B$${last},A${r},$F$2:$F$${last})`, `=COUNTIF($B$2:$B$${last},A${r})`, `=B${r}/$F$${last + 3}`])
  }
  const byRegionEnd = rows.length
  return {
    id: 'sales',
    name: 'Sales ledger',
    blurb: 'Revenue formulas, a summary block with SUM/AVERAGE/MAX and per-region SUMIF and COUNTIF.',
    rows,
    formats: [
      { range: [0, 0, 0, 7], format: { bold: true } },
      { range: [1, 0, last - 1, 0], format: { kind: 'date', pattern: 'mmm d, yyyy' } },
      { range: [1, 4, last - 1, 5], format: { kind: 'currency', decimals: 2 } },
      { range: [last + 1, 0, last + 1, 0], format: { bold: true } },
      { range: [last + 2, 5, last + 4, 5], format: { kind: 'currency', decimals: 2 } },
      { range: [last + 8, 0, last + 8, 3], format: { bold: true } },
      { range: [byRegionStart - 1, 1, byRegionEnd - 1, 1], format: { kind: 'currency', decimals: 2 } },
      { range: [byRegionStart - 1, 3, byRegionEnd - 1, 3], format: { kind: 'percent', decimals: 1 } },
    ],
    colWidths: [
      [0, 112],
      [2, 110],
      [4, 96],
      [5, 104],
      [6, 104],
    ],
  }
}

function grades(): SampleSpec {
  const students: Array<[string, number, number, number]> = [
    ['Amara Okafor', 92, 88, 95],
    ['Ben Carter', 78, 82, 74],
    ['Chloe Dubois', 85, 91, 89],
    ['Dev Patel', 64, 70, 68],
    ['Elena Rossi', 97, 94, 99],
    ['Farid Haddad', 55, 61, 58],
    ['Grace Kim', 88, 84, 90],
    ['Hugo Silva', 71, 75, 69],
    ['Isla McKay', 83, 79, 86],
    ['Jonas Weber', 90, 93, 87],
    ['Keiko Tanaka', 76, 80, 78],
    ['Liam Byrne', 68, 66, 72],
    ['Maya Singh', 94, 96, 92],
    ['Noah Fischer', 59, 63, 60],
    ['Olivia Brown', 81, 85, 83],
    ['Pavel Novak', 73, 77, 70],
    ['Quinn Adler', 86, 82, 88],
    ['Rosa Alvarez', 91, 89, 93],
    ['Sam Whitfield', 62, 58, 65],
    ['Tara Nguyen', 79, 83, 81],
  ]
  const rows: Row[] = [['Student', 'Test 1', 'Test 2', 'Final', 'Average', 'Grade', 'Rank', 'Passed?']]
  const n = students.length
  students.forEach(([name, a, b, c], i) => {
    const r = i + 2
    rows.push([
      name,
      a,
      b,
      c,
      `=ROUND(AVERAGE(B${r}:D${r}),1)`,
      `=VLOOKUP(E${r},$J$3:$K$7,2,TRUE)`,
      `=RANK(E${r},$E$2:$E$${n + 1})`,
      `=IF(E${r}>=$K$10,"pass","fail")`,
    ])
  })
  // Grade scale table at J2:K7 and stats
  rows[1] = [...rows[1], null, 'Score', 'Grade']
  const scale: Array<[number, string]> = [
    [0, 'F'],
    [60, 'D'],
    [70, 'C'],
    [80, 'B'],
    [90, 'A'],
  ]
  scale.forEach(([score, grade], i) => {
    const row = rows[i + 2]
    while (row.length < 9) row.push(null)
    row[9] = score
    row[10] = grade
  })
  const statsRow = 8
  const put = (r: number, c: number, v: string | number): void => {
    while (rows[r].length <= c) rows[r].push(null)
    rows[r][c] = v
  }
  put(statsRow, 9, 'Class stats')
  put(statsRow + 1, 9, 'Pass mark')
  put(statsRow + 1, 10, 70)
  put(statsRow + 2, 9, 'Class average')
  put(statsRow + 2, 10, `=ROUND(AVERAGE(E2:E${n + 1}),1)`)
  put(statsRow + 3, 9, 'Median')
  put(statsRow + 3, 10, `=MEDIAN(E2:E${n + 1})`)
  put(statsRow + 4, 9, 'Std deviation')
  put(statsRow + 4, 10, `=ROUND(STDEV(E2:E${n + 1}),2)`)
  put(statsRow + 5, 9, 'Top student')
  put(statsRow + 5, 10, `=INDEX(A2:A${n + 1},MATCH(1,G2:G${n + 1},0))`)
  put(statsRow + 6, 9, 'Passed')
  put(statsRow + 6, 10, `=COUNTIF(H2:H${n + 1},"pass")&" of "&COUNTA(A2:A${n + 1})`)
  return {
    id: 'grades',
    name: 'Grades',
    blurb: 'VLOOKUP against a grade scale, RANK, INDEX/MATCH for the top student and a pass mark you can change.',
    rows,
    formats: [
      { range: [0, 0, 0, 7], format: { bold: true } },
      { range: [1, 9, 1, 10], format: { bold: true } },
      { range: [statsRow, 9, statsRow, 9], format: { bold: true } },
      { range: [1, 4, n, 4], format: { kind: 'number', decimals: 1 } },
      { range: [1, 5, n, 6], format: { align: 'center' } },
    ],
    colWidths: [
      [0, 130],
      [9, 110],
    ],
  }
}

function contacts(): SampleSpec {
  const people: Array<[string, string, string, string, string]> = [
    ['ada lovelace', 'ada.lovelace@analytical.org', '03/04/2024', '(415) 555-0142', 'London, UK'],
    ['GRACE HOPPER', 'grace.hopper@navy.mil', '12/25/2023', '(212) 555-0199', 'New York, USA'],
    ['linus torvalds', 'linus@kernel.org', '07/01/2022', '(503) 555-0170', 'Portland, USA'],
    ['margaret hamilton', 'mhamilton@apollo.nasa.gov', '11/09/2021', '(617) 555-0133', 'Boston, USA'],
    ['ken thompson', 'ken@bell-labs.com', '01/15/2024', '(908) 555-0187', 'Murray Hill, USA'],
    ['barbara liskov', 'liskov@csail.mit.edu', '05/30/2023', '(617) 555-0104', 'Cambridge, USA'],
    ['dennis ritchie', 'dmr@bell-labs.com', '09/09/2022', '(908) 555-0111', 'Berkeley Heights, USA'],
    ['radia perlman', 'radia@spanning-tree.net', '02/14/2024', '(206) 555-0176', 'Seattle, USA'],
    ['guido van rossum', 'guido@python.org', '10/31/2023', '(650) 555-0122', 'Palo Alto, USA'],
    ['anita borg', 'anita@systers.org', '04/22/2022', '(408) 555-0155', 'San Jose, USA'],
    ['tim berners-lee', 'timbl@w3.org', '08/06/2021', '(617) 555-0168', 'Cambridge, USA'],
    ['frances allen', 'fallen@ibm.com', '06/18/2023', '(914) 555-0139', 'Yorktown, USA'],
    ['alan kay', 'alan.kay@viewpoints.org', '03/03/2022', '(310) 555-0193', 'Los Angeles, USA'],
    ['hedy lamarr', 'hedy@frequency-hop.io', '11/11/2023', '(213) 555-0107', 'Los Angeles, USA'],
    ['john carmack', 'john.carmack@id.software', '12/10/2021', '(972) 555-0148', 'Dallas, USA'],
    ['sophie wilson', 'sophie@acorn.co.uk', '07/07/2023', '(122) 555-0181', 'Cambridge, UK'],
  ]
  const rows: Row[] = [['Name', 'Email', 'Signed up', 'Phone', 'Location', 'Proper name', 'Domain', 'ISO date', 'Area code']]
  for (const p of people) rows.push([...p])
  // Two hand-typed examples per target column: Smart Fill infers the rest.
  rows[1].push('Ada Lovelace', 'analytical.org', '2024-03-04', '415')
  rows[2].push('Grace Hopper', 'navy.mil', '2023-12-25', '212')
  rows.push([])
  rows.push(['Smart Fill demo: select A2:A17, open the Smart Fill panel, click "Use selection as inputs" and choose column F as the output. Columns G–I work the same way from B and C.'])
  return {
    id: 'contacts',
    name: 'Contacts',
    blurb: 'Messy names, emails and dates — the playground for Smart Fill: type two examples, get a verified program.',
    rows,
    formats: [
      { range: [0, 0, 0, 8], format: { bold: true } },
      { range: [people.length + 2, 0, people.length + 2, 0], format: { align: 'left' } },
    ],
    colWidths: [
      [0, 150],
      [1, 230],
      [2, 100],
      [3, 130],
      [4, 170],
      [5, 140],
      [6, 150],
      [7, 110],
    ],
  }
}

const SPECS: SampleSpec[] = [salesLedger(), grades(), contacts()]

export const SAMPLES: SampleInfo[] = SPECS.map(({ id, name, blurb }) => ({ id, name, blurb }))

export function loadSample(id: string): SheetDocument | null {
  const spec = SPECS.find((s) => s.id === id)
  if (!spec) return null
  const doc = build(spec)
  // Give each opened copy its own identity so it saves as a separate sheet.
  doc.id = `${spec.id}-${Date.now().toString(36)}`
  return doc
}
