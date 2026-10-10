import type { Mutant, TestRunner } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'

const spanRunStatuses = {
  killed: 'failure',
  survived: 'success',
  timeout: 'timed_out',
  error: 'aborted',
} as const satisfies Readonly<Record<TestRunner.MutantRunStatus, string>>

export type SpanRunStatus = (typeof spanRunStatuses)[TestRunner.MutantRunStatus]

export const spanRunStatusOf = (status: TestRunner.MutantRunStatus): SpanRunStatus => spanRunStatuses[status]

export const mutantStatusOfRunResult = (status: TestRunner.MutantRunStatus): Mutant.MutantStatus =>
  Match.value(status).pipe(
    Match.when('killed', (): Mutant.MutantStatus => 'Killed'),
    Match.when('survived', (): Mutant.MutantStatus => 'Survived'),
    Match.when('timeout', (): Mutant.MutantStatus => 'Timeout'),
    Match.when('error', (): Mutant.MutantStatus => 'RuntimeError'),
    Match.exhaustive,
  )

export const testSuiteNameOf = (mutant: Pick<Mutant.Mutant, 'fileName' | 'mutatorName'>): string =>
  `${mutant.fileName}#${mutant.mutatorName}`

export interface CiPipeline {
  readonly runId?: string | undefined
  readonly name?: string | undefined
}

const attributeOf = (key: string, value: string | undefined): Readonly<Record<string, string>> =>
  Option.match(
    Option.filter(Option.fromUndefinedOr(value), (present) => present.length > 0),
    { onNone: () => ({}), onSome: (present) => ({ [key]: present }) },
  )

export const cicdAttributesOf = (pipeline: CiPipeline): Readonly<Record<string, string>> => ({
  ...attributeOf('cicd.pipeline.run.id', pipeline.runId),
  ...attributeOf('cicd.pipeline.name', pipeline.name),
})
