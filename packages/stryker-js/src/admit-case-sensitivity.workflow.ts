import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Boolean } from 'effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const CaseSensitivityTypeId = Symbol.for('@systemfsoftware/stryker-js/CaseSensitivityDecision')
type CaseSensitivityTypeId = typeof CaseSensitivityTypeId

const FileIdentity = S.Struct({ dev: S.BigInt, ino: S.Option(S.BigInt) })
type FileIdentity = typeof FileIdentity.Type

const SwappedMissing = S.TaggedStruct('SwappedMissing', {})

const SwappedFound = S.TaggedStruct('SwappedFound', { identity: FileIdentity })

const SwappedName = S.Union([SwappedMissing, SwappedFound])

const CaseProbeResult = S.Struct({ own: FileIdentity, swapped: SwappedName })
type CaseProbeResult = typeof CaseProbeResult.Type

export class CaseSensitivityCommand
  extends S.TaggedClass<CaseSensitivityCommand, { readonly brand: unique symbol }>()('CaseSensitivityCommand', {
    probes: S.Array(CaseProbeResult),
  })
{
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class CaseToldApart
  extends S.TaggedClass<CaseToldApart, { readonly brand: unique symbol }>()('CaseToldApart', {})
{
  readonly [CaseSensitivityTypeId] = CaseSensitivityTypeId
}

export class CaseFolded extends S.TaggedClass<CaseFolded, { readonly brand: unique symbol }>()('CaseFolded', {}) {
  readonly [CaseSensitivityTypeId] = CaseSensitivityTypeId
}

export const CaseSensitivityDecision = S.Union([CaseToldApart, CaseFolded])
export type CaseSensitivityDecision = typeof CaseSensitivityDecision.Type

const distinctFiles = (one: FileIdentity, other: FileIdentity) =>
  Boolean.some([
    one.dev !== other.dev,
    Option.getOrElse(Option.zipWith(one.ino, other.ino, (a, b) => a !== b), () => false),
  ])

const tellsCaseApart = (probe: CaseProbeResult) =>
  Match.value(probe.swapped).pipe(
    Match.tag('SwappedMissing', () => true),
    Match.tag('SwappedFound', (found) => distinctFiles(probe.own, found.identity)),
    Match.exhaustive,
  )

export const admitCaseSensitivity = Workflow.make({
  command: CaseSensitivityCommand,
  decision: CaseSensitivityDecision,
  error: S.Never,
  decide: (command): Result.Result<CaseSensitivityDecision, never> =>
    Result.succeed(
      Boolean.match(command.probes.some(tellsCaseApart), {
        onTrue: () => CaseToldApart.make({}),
        onFalse: () => CaseFolded.make({}),
      }),
    ),
})
