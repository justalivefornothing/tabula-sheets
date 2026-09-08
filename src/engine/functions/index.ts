import { dateFunctions } from './date.ts'
import type { FnDef } from './helpers.ts'
import { logicFunctions } from './logic.ts'
import { lookupFunctions } from './lookup.ts'
import { mathFunctions } from './math.ts'
import { statsFunctions } from './stats.ts'
import { textFunctions } from './text.ts'

export type { FnDef, FnContext, FnCategory } from './helpers.ts'
export { seedRandom } from './math.ts'
export { properCase } from './text.ts'

const ALL: FnDef[] = [
  ...mathFunctions,
  ...logicFunctions,
  ...lookupFunctions,
  ...textFunctions,
  ...dateFunctions,
  ...statsFunctions,
]

export const FUNCTIONS: ReadonlyMap<string, FnDef> = new Map(ALL.map((f) => [f.name, f]))

/** Names handled directly by the evaluator because they need reference metadata. */
export const SPECIAL_FORMS: ReadonlySet<string> = new Set(['ROW', 'COLUMN'])

export const VOLATILE_FUNCTIONS: ReadonlySet<string> = new Set(ALL.filter((f) => f.volatile).map((f) => f.name))

export function functionNames(): string[] {
  return [...FUNCTIONS.keys(), ...SPECIAL_FORMS].sort()
}

export function functionCount(): number {
  return FUNCTIONS.size + SPECIAL_FORMS.size
}
