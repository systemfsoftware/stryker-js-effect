import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as S from 'effect/Schema'

import { Location } from './Location.schema.js'

export const TypeQueryVersion = S.Literals([1, 2])
export type TypeQueryVersion = typeof TypeQueryVersion.Type

export const TYPE_QUERY_VERSIONS: ReadonlyArray<TypeQueryVersion> = TypeQueryVersion.literals

export const TypeQueryCandidate = S.Struct({
  candidateId: S.String,
  text: S.String,
})
export type TypeQueryCandidate = typeof TypeQueryCandidate.Type

export const TypeQuerySiteKind = S.Literals(['expression', 'function-body'])
export type TypeQuerySiteKind = typeof TypeQuerySiteKind.Type

export const TypeQuerySite = S.Struct({
  siteId: S.String,
  kind: S.optionalKey(TypeQuerySiteKind),
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
  'context-not-enforced',
  'site-not-function-body',
  'candidate-not-empty-body',
  'return-type-not-declared',
  'generator-body',
  'constructor-body',
  'getter-requires-return',
  'implicit-return-rejected',
  'async-return-not-promise',
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

export const CheckerCapabilities = S.Struct({ typeQuery: S.Array(S.Int) })
export type CheckerCapabilities = typeof CheckerCapabilities.Type

export const TypeQueryServed = S.TaggedStruct('TypeQueryServed', { version: TypeQueryVersion })
export type TypeQueryServed = typeof TypeQueryServed.Type

export const TypeQueryNotServed = S.TaggedStruct('TypeQueryNotServed', {
  version: TypeQueryVersion,
  declared: S.Array(S.Int),
  nextAction: S.String,
})
export type TypeQueryNotServed = typeof TypeQueryNotServed.Type

export const TypeQueryServing = S.Union([TypeQueryServed, TypeQueryNotServed])
export type TypeQueryServing = typeof TypeQueryServing.Type

const notServed = (capabilities: CheckerCapabilities, version: TypeQueryVersion): TypeQueryServing =>
  TypeQueryNotServed.make({
    version,
    declared: capabilities.typeQuery,
    nextAction: `Keep every mutant: this checker declares type-query versions [${
      capabilities.typeQuery.join(', ')
    }], not ${version}. Use a checker that declares version ${version}, or send a version it declares.`,
  })

export const typeQueryServingOf = (capabilities: CheckerCapabilities, version: TypeQueryVersion): TypeQueryServing =>
  Boolean.match(Arr.contains(capabilities.typeQuery, version), {
    onTrue: () => TypeQueryServed.make({ version }),
    onFalse: () => notServed(capabilities, version),
  })

const requestDecodes = (version: number, fileCount: number): boolean =>
  S.is(TypeQueryRequest)({
    version,
    tsconfigFile: 'tsconfig.json',
    files: Array.from({ length: fileCount }, (_, index) => ({ fileName: `src/${index}.ts`, content: '', sites: [] })),
  })

if (import.meta.vitest !== void 0) {
  const { it } = await import('@systemfsoftware/vitest')

  const versionSeeds = [-1, 0, 1, 2, 1.5, Number.NaN, Number.POSITIVE_INFINITY]
  const fileCountSeeds = [0, 1, 2]
  const namesWholeVersionAndAFile = (version: number, fileCount: number): boolean =>
    Number.isSafeInteger(version) && fileCount >= 1

  it.prop(
    '∀v,n_TypeQueryRequestRefusal_≡IntegerVersionAndAtLeastOneFile',
    { of: [S.Finite, S.Int.check(S.isBetween({ minimum: 0, maximum: 4 }))], subject: requestDecodes },
    (subject, [version, fileCount]) =>
      Arr.every(
        Arr.append(versionSeeds, version),
        (v) =>
          Arr.every(Arr.append(fileCountSeeds, fileCount), (n) => subject(v, n) === namesWholeVersionAndAFile(v, n)),
      ),
  )

  const SmallVersions = S.Struct({ typeQuery: S.Array(S.Int.check(S.isBetween({ minimum: 0, maximum: 3 }))) })

  it.prop(
    '∀c,v_TypeQueryServing_≡ServedExactlyWhenTheDeclarationNamesTheVersion',
    { of: [SmallVersions, TypeQueryVersion], subject: typeQueryServingOf },
    (subject, [capabilities, version]) => {
      const serving = subject(capabilities, version)
      const declares = capabilities.typeQuery.includes(version)
      return S.is(TypeQueryServed)(serving)
        ? declares && serving.version === version
        : !declares && serving.version === version && serving.declared.join() === capabilities.typeQuery.join()
    },
  )
}
