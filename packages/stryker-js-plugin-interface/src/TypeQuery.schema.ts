import * as S from 'effect/Schema'

import { Location } from './Location.schema.js'

export const TypeQueryVersion = S.Literal(1)
export type TypeQueryVersion = typeof TypeQueryVersion.Type

export const TypeQueryCandidate = S.Struct({
  candidateId: S.String,
  text: S.String,
})
export type TypeQueryCandidate = typeof TypeQueryCandidate.Type

export const TypeQuerySite = S.Struct({
  siteId: S.String,
  location: Location,
  candidates: S.Array(TypeQueryCandidate),
})
export type TypeQuerySite = typeof TypeQuerySite.Type

export const TypeQueryFile = S.Struct({
  fileName: S.String,
  content: S.String,
  sites: S.Array(TypeQuerySite),
})
export type TypeQueryFile = typeof TypeQueryFile.Type

export const TypeQueryRequest = S.Struct({
  version: S.Int,
  tsconfigFile: S.String,
  files: S.NonEmptyArray(TypeQueryFile),
})
export type TypeQueryRequest = typeof TypeQueryRequest.Type

export const UnknownReason = S.Literals([
  'candidate-not-context-free',
  'candidate-not-found',
  'site-not-found',
  'site-not-expression',
  'no-contextual-type',
  'error-type',
  'instantiable-target',
  'overloaded-or-generic-call',
])
export type UnknownReason = typeof UnknownReason.Type

export const TypeAnswerTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js-plugin-interface/TypeAnswer')
export type TypeAnswerTypeId = typeof TypeAnswerTypeId

export class Assignable extends S.TaggedClass<Assignable>()('Assignable', { candidateType: S.String }) {
  readonly [TypeAnswerTypeId] = TypeAnswerTypeId
}

export class NotAssignable extends S.TaggedClass<NotAssignable>()('NotAssignable', {
  candidateType: S.String,
  contextualType: S.String,
}) {
  readonly [TypeAnswerTypeId] = TypeAnswerTypeId
}

export class Unknown extends S.TaggedClass<Unknown>()('Unknown', { reason: UnknownReason }) {
  readonly [TypeAnswerTypeId] = TypeAnswerTypeId
}

export const TypeAnswer = S.Union([Assignable, NotAssignable, Unknown])
export type TypeAnswer = typeof TypeAnswer.Type

export const CandidateAnswer = S.Struct({
  candidateId: S.String,
  answer: TypeAnswer,
})
export type CandidateAnswer = typeof CandidateAnswer.Type

export const SiteAnswer = S.Struct({
  siteId: S.String,
  siteType: S.OptionFromNullOr(S.String),
  contextualType: S.OptionFromNullOr(S.String),
  candidates: S.Array(CandidateAnswer),
})
export type SiteAnswer = typeof SiteAnswer.Type

export const FileAnswered = S.TaggedStruct('FileAnswered', {
  fileName: S.String,
  sites: S.Array(SiteAnswer),
})
export type FileAnswered = typeof FileAnswered.Type

export const FileRefusedReason = S.Literals(['not-in-project', 'server-crashed'])
export type FileRefusedReason = typeof FileRefusedReason.Type

export const FileRefused = S.TaggedStruct('FileRefused', {
  fileName: S.String,
  reason: FileRefusedReason,
  nextAction: S.String,
})
export type FileRefused = typeof FileRefused.Type

export const FileOutcome = S.Union([FileAnswered, FileRefused])
export type FileOutcome = typeof FileOutcome.Type

export const TypeQueryResponse = S.Struct({
  version: TypeQueryVersion,
  files: S.Array(FileOutcome),
})
export type TypeQueryResponse = typeof TypeQueryResponse.Type

export const TypeQueryRefusedReason = S.Literals(['unsupported-version', 'project-open-failed'])
export type TypeQueryRefusedReason = typeof TypeQueryRefusedReason.Type

export class TypeQueryRefused extends S.TaggedError<TypeQueryRefused>()('TypeQueryRefused', {
  version: TypeQueryVersion,
  reason: TypeQueryRefusedReason,
  nextAction: S.String,
}) {
  override get message(): string {
    return `${this.reason}: ${this.nextAction}`
  }
}
