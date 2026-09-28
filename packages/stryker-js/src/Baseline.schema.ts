import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export const BaselineSchemaVersion = S.Literal(1)

export const Baseline = S.Struct({
  schemaVersion: BaselineSchemaVersion,
  survivors: S.Array(Mutant.MutantId),
})

export type Baseline = typeof Baseline.Type
