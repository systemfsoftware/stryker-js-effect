import { Checker, TypeQuery } from '@systemfsoftware/stryker-js-plugin-interface'
import * as S from 'effect/Schema'

export const RecordedMutant = S.Struct({
  file: S.String,
  line: S.Int,
  column: S.Int,
  mutator: S.String,
  replacement: S.String,
}).pipe(S.brand('~systemfsoftware/stryker-js-typescript-checker/RecordedMutant'))
export type RecordedMutant = typeof RecordedMutant.Type

export const RecordedCheck = S.Struct({
  mutant: RecordedMutant,
  status: Checker.CheckStatus,
}).pipe(S.brand('~systemfsoftware/stryker-js-typescript-checker/RecordedCheck'))
export type RecordedCheck = typeof RecordedCheck.Type

export const RecordedTypeAnswer = S.Struct({
  mutant: RecordedMutant,
  answer: TypeQuery.TypeAnswer,
}).pipe(S.brand('~systemfsoftware/stryker-js-typescript-checker/RecordedTypeAnswer'))
export type RecordedTypeAnswer = typeof RecordedTypeAnswer.Type

export const Recorded = S.Struct({
  checks: S.Array(RecordedCheck),
  typeAnswers: S.Array(RecordedTypeAnswer),
}).pipe(S.brand('~systemfsoftware/stryker-js-typescript-checker/Recorded'))
export type Recorded = typeof Recorded.Type

export const RecordedJson = S.fromJsonString(Recorded)
