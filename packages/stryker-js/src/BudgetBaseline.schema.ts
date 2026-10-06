import { Report } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export const BudgetBaselineSchemaVersion = S.Literal(1)

export const BudgetBaseline = S.Struct({
  schemaVersion: BudgetBaselineSchemaVersion,
  actualSeconds: Report.NonNegativeFinite,
})

export type BudgetBaseline = typeof BudgetBaseline.Type
