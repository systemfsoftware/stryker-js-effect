import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const MutantRerunTypeId: unique symbol = Symbol.for('@systemfsoftware/stryker-js/MutantRerunAdmission')
type MutantRerunTypeId = typeof MutantRerunTypeId

export const PriorMutantShape = S.Struct({
  ...Mutant.Mutant.fields,
  relativeFileName: S.String,
})

export class AdmitMutantRerunCommand extends S.Class<AdmitMutantRerunCommand>('AdmitMutantRerunCommand')({
  ids: S.Array(Mutant.MutantId),
  priorMutants: S.Array(PriorMutantShape),
  priorReportPath: S.String,
}) {
  static readonly [Workflow.InstrumentationBrand] = {} as const
}

export class RerunAdmitted extends S.TaggedClass<RerunAdmitted>()('RerunAdmitted', {
  ids: S.Array(Mutant.MutantId),
  mutateSpans: S.Array(S.String),
}) {
  readonly [MutantRerunTypeId] = MutantRerunTypeId
}

export class RerunRefused extends S.TaggedClass<RerunRefused>()('RerunRefused', {
  exitClass: S.Literal('ConfigError'),
  unknownIds: S.Array(Mutant.MutantId),
  reason: S.String,
}) {
  readonly [MutantRerunTypeId] = MutantRerunTypeId
}

export const MutantRerunAdmission = S.Union([RerunAdmitted, RerunRefused])
export type MutantRerunAdmission = typeof MutantRerunAdmission.Type

const spanOf = (mutant: typeof PriorMutantShape.Type): string =>
  `${mutant.relativeFileName}:${mutant.location.start.line}:${mutant.location.start.column}-${mutant.location.end.line}:${mutant.location.end.column}`

const requestedIdsOf = (command: AdmitMutantRerunCommand): ReadonlyArray<Mutant.MutantId> => Arr.dedupe(command.ids)

const priorMutantOf = (command: AdmitMutantRerunCommand, id: Mutant.MutantId) =>
  Arr.findFirst(command.priorMutants, (mutant) => mutant.id === id)

const unknownIdsOf = (command: AdmitMutantRerunCommand): ReadonlyArray<Mutant.MutantId> =>
  Arr.filter(requestedIdsOf(command), (id) => Option.isNone(priorMutantOf(command, id)))

const mutateSpansOf = (command: AdmitMutantRerunCommand): ReadonlyArray<string> =>
  Arr.dedupe(
    Arr.getSomes(Arr.map(requestedIdsOf(command), (id) => Option.map(priorMutantOf(command, id), spanOf))),
  )

const refusalOf = (command: AdmitMutantRerunCommand, unknownIds: ReadonlyArray<Mutant.MutantId>): RerunRefused =>
  RerunRefused.make({
    exitClass: 'ConfigError',
    unknownIds,
    reason: `Unknown mutant id(s): ${
      Arr.join(unknownIds, ', ')
    }. None of them appears in the prior mutation report at ${command.priorReportPath}; run \`stryker run\` to write a report that lists the ids you can re-run.`,
  })

const admittedOf = (command: AdmitMutantRerunCommand): RerunAdmitted =>
  RerunAdmitted.make({ ids: requestedIdsOf(command), mutateSpans: mutateSpansOf(command) })

const decidedOf = (command: AdmitMutantRerunCommand): MutantRerunAdmission => {
  const unknownIds = unknownIdsOf(command)
  return Option.match(Arr.head(unknownIds), {
    onNone: () => admittedOf(command),
    onSome: () => refusalOf(command, unknownIds),
  })
}

export const admitMutantRerun = Workflow.make({
  command: AdmitMutantRerunCommand,
  decision: MutantRerunAdmission,
  error: S.Never,
  decide: (command): Result.Result<MutantRerunAdmission, never> => Result.succeed(decidedOf(command)),
})
