import * as S from 'effect/Schema'

import { LocationSchema } from './Location.js'

export const MutantStatusSchema = S.Literals([
  'Killed',
  'Survived',
  'NoCoverage',
  'CompileError',
  'RuntimeError',
  'Timeout',
  'Ignored',
  'Pending',
])
export type MutantStatus = typeof MutantStatusSchema.Type

export class Mutant extends S.TaggedClass<Mutant>()('Mutant', {
  id: S.NonEmptyString,
  fileName: S.NonEmptyString,
  mutatorName: S.NonEmptyString,
  replacement: S.String,
  location: LocationSchema,
  status: S.optional(MutantStatusSchema),
  statusReason: S.optional(S.String),
  coveredBy: S.optional(S.Array(S.String)),
  static: S.optional(S.Boolean),
  testsCompleted: S.optional(S.Finite),
  description: S.optional(S.String),
}) {}

export const RunOptionsFields = {
  timeout: S.Finite,
  disableBail: S.Boolean,
}

export const MutantActivationSchema = S.Literals(['runtime', 'static'])
export type MutantActivation = typeof MutantActivationSchema.Type

export const MutantRunOptionsSchema = S.Struct({
  ...RunOptionsFields,
  activeMutant: Mutant,
  sandboxFileName: S.String,
  mutantActivation: MutantActivationSchema,
  reloadEnvironment: S.Boolean,
  testFilter: S.optionalKey(S.Array(S.String)),
  hitLimit: S.optionalKey(S.Finite),
})
