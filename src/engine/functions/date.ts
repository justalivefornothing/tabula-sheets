import { scalarOf, toNumber, toText } from '../coerce.ts'
import { addMonths, dateToSerial, daysInMonth, parseDateText, serialToYMD, serialWeekday, todaySerial } from '../dates.ts'
import { FormulaError, isError, type Value } from '../types.ts'
import { def, err, toInt, type FnDef } from './helpers.ts'

/** Accept a serial number or a date-looking string. */
function toSerial(v: Value): number {
  const s = scalarOf(v)
  if (isError(s)) throw new FormulaError(s.code, s.message)
  if (typeof s === 'string') {
    const d = parseDateText(s)
    if (d !== null) return d
  }
  return toNumber(s)
}

function datedif(start: number, end: number, unit: string): number {
  if (end < start) return err('#NUM!', 'DATEDIF start is after end')
  const a = serialToYMD(start)
  const b = serialToYMD(end)
  const monthsTotal = (b.year - a.year) * 12 + (b.month - a.month) - (b.day < a.day ? 1 : 0)
  switch (unit.toUpperCase()) {
    case 'D':
      return Math.floor(end) - Math.floor(start)
    case 'M':
      return monthsTotal
    case 'Y':
      return Math.floor(monthsTotal / 12)
    case 'YM':
      return monthsTotal % 12
    case 'MD': {
      if (b.day >= a.day) return b.day - a.day
      const prevMonth = b.month === 1 ? 12 : b.month - 1
      const prevYear = b.month === 1 ? b.year - 1 : b.year
      return daysInMonth(prevYear, prevMonth) - a.day + b.day
    }
    case 'YD': {
      const years = Math.floor(monthsTotal / 12)
      const anniversary = dateToSerial(a.year + years, a.month, a.day)
      return Math.floor(end) - anniversary
    }
    default:
      return err('#NUM!', `Unknown DATEDIF unit "${unit}"`)
  }
}

export const dateFunctions: FnDef[] = [
  def('DATE', 'date', 'DATE(year, month, day)', 'Serial number for a calendar date.', 3, 3, (args) => {
    const y = toInt(args[0])
    const m = toInt(args[1])
    const d = toInt(args[2])
    const serial = dateToSerial(y, m, d)
    if (serial < 0) return err('#NUM!', 'Dates before 1900 are not supported')
    return serial
  }),
  def('TODAY', 'date', 'TODAY()', "Today's date as a serial number.", 0, 0, (_args, ctx) => todaySerial(ctx.now()), true),
  def(
    'NOW',
    'date',
    'NOW()',
    'Current date and time as a fractional serial number.',
    0,
    0,
    (_args, ctx) => {
      const now = ctx.now()
      const frac = (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) / 86400
      return todaySerial(now) + frac
    },
    true,
  ),
  def('YEAR', 'date', 'YEAR(date)', 'Year of a serial date.', 1, 1, (args) => serialToYMD(toSerial(args[0])).year),
  def('MONTH', 'date', 'MONTH(date)', 'Month (1-12) of a serial date.', 1, 1, (args) => serialToYMD(toSerial(args[0])).month),
  def('DAY', 'date', 'DAY(date)', 'Day of month of a serial date.', 1, 1, (args) => serialToYMD(toSerial(args[0])).day),
  def('WEEKDAY', 'date', 'WEEKDAY(date, [type])', 'Day of week (type 1: Sunday = 1, type 2: Monday = 1).', 1, 2, (args) => {
    const wd = serialWeekday(toSerial(args[0]))
    const type = args.length > 1 ? toInt(args[1]) : 1
    if (type === 2) return wd === 0 ? 7 : wd
    if (type === 3) return wd === 0 ? 6 : wd - 1
    return wd + 1
  }),
  def('DATEDIF', 'date', 'DATEDIF(start, end, unit)', 'Difference between dates in Y, M, D, YM, MD or YD.', 3, 3, (args) =>
    datedif(toSerial(args[0]), toSerial(args[1]), toText(args[2])),
  ),
  def('EDATE', 'date', 'EDATE(date, months)', 'Date shifted by a number of months.', 2, 2, (args) =>
    addMonths(toSerial(args[0]), toInt(args[1])),
  ),
  def('EOMONTH', 'date', 'EOMONTH(date, months)', 'Last day of the month, shifted by months.', 2, 2, (args) => {
    const shifted = addMonths(toSerial(args[0]), toInt(args[1]))
    const { year, month } = serialToYMD(shifted)
    return dateToSerial(year, month, daysInMonth(year, month))
  }),
  def('DAYS', 'date', 'DAYS(end, start)', 'Number of days between two dates.', 2, 2, (args) =>
    Math.floor(toSerial(args[0])) - Math.floor(toSerial(args[1])),
  ),
  def('DATEVALUE', 'date', 'DATEVALUE(text)', 'Parses a date string into a serial number.', 1, 1, (args) => {
    const s = toText(args[0])
    const d = parseDateText(s)
    if (d === null) return err('#VALUE!', `Cannot parse date "${s}"`)
    return d
  }),
]
