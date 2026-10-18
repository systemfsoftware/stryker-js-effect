import { Workflow } from '@systemfsoftware/effect-cell-types'
import * as Arr from 'effect/Array'
import * as Match from 'effect/Match'
import * as Order from 'effect/Order'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

import {
  type CheckerComponents,
  type TestedComponents,
  type VerdictComponents,
  VerdictComponentsSchema,
} from './VerdictEntry.schema.js'
import {
  schemeDirectoryOf,
  schemeNameOf,
  type VerdictKeyScheme,
  VerdictKeySchemeSchema,
} from './VerdictKeyScheme.schema.js'

const EncodeVerdictKeyTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/EncodeVerdictKey')
type EncodeVerdictKeyTypeId = typeof EncodeVerdictKeyTypeId

export class EncodeVerdictKeyCommand extends S.TaggedClass<EncodeVerdictKeyCommand>()('EncodeVerdictKeyCommand', {
  scheme: VerdictKeySchemeSchema,
  components: VerdictComponentsSchema,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class TestedKeyEncoded extends S.TaggedClass<TestedKeyEncoded>()('TestedKeyEncoded', {
  encoding: S.String,
  directory: S.String,
}) {
  readonly [EncodeVerdictKeyTypeId] = EncodeVerdictKeyTypeId
}

export class CheckerKeyEncoded extends S.TaggedClass<CheckerKeyEncoded>()('CheckerKeyEncoded', {
  encoding: S.String,
  directory: S.String,
}) {
  readonly [EncodeVerdictKeyTypeId] = EncodeVerdictKeyTypeId
}

export type VerdictKeyEncoded = TestedKeyEncoded | CheckerKeyEncoded

const lengthPrefixed = (value: string): string => `${value.length}:${value}`

const encodingOf = (parts: ReadonlyArray<string>): string => parts.map(lengthPrefixed).join('')

const sharedPartsOf = (scheme: VerdictKeyScheme, components: VerdictComponents): ReadonlyArray<string> => [
  schemeNameOf(scheme),
  components._tag,
  components.engineDigest,
  components.runInputsDigest,
  components.mutantSetPolicy,
  components.mutantId,
  components.fileName,
  components.mutatorName,
  components.replacementDigest,
  `${components.location.start.line}.${components.location.start.column}`,
  `${components.location.end.line}.${components.location.end.column}`,
  components.fileContentDigest,
]

const coveringTestIdsOf = (ids: ReadonlyArray<string>): ReadonlyArray<string> => Arr.sort(Arr.dedupe(ids), Order.String)

const testedEncodingOf = (scheme: VerdictKeyScheme, components: TestedComponents): TestedKeyEncoded => {
  const covering = coveringTestIdsOf(components.coveringTestIds)
  return TestedKeyEncoded.make({
    directory: schemeDirectoryOf(scheme)(components.mutantId),
    encoding: encodingOf([
      ...sharedPartsOf(scheme, components),
      String(covering.length),
      ...covering,
      components.closureDigest,
      components.checkerConfigDigest,
    ]),
  })
}

const checkerEncodingOf = (scheme: VerdictKeyScheme, components: CheckerComponents): CheckerKeyEncoded =>
  CheckerKeyEncoded.make({
    directory: schemeDirectoryOf(scheme)(components.mutantId),
    encoding: encodingOf([...sharedPartsOf(scheme, components), components.programDigest]),
  })

const encodedOf = ({ scheme, components }: EncodeVerdictKeyCommand): VerdictKeyEncoded =>
  Match.valueTags(components, {
    tested: (tested) => testedEncodingOf(scheme, tested),
    checker: (checker) => checkerEncodingOf(scheme, checker),
  })

export const encodeVerdictKey = Workflow.make({
  command: EncodeVerdictKeyCommand,
  decision: S.Union([TestedKeyEncoded, CheckerKeyEncoded]),
  error: S.Never,
  decide: (command): Result.Result<VerdictKeyEncoded, never> => Result.succeed(encodedOf(command)),
})
