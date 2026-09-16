import type { ExitClass } from '@systemfsoftware/stryker-js-language'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as S from 'effect/Schema'

const TypeId = '~stryker/mutation-run/StageError' as const

const ExitClassSchema = S.Literals(['VerdictFail', 'ConfigError', 'RuntimeError', 'InternalError'])

const hasExitClass = (value: unknown): value is Record<'exitClass', unknown> =>
  Predicate.hasProperty(value, 'exitClass')

const causeExitClass = (cause: unknown): Option.Option<ExitClass> =>
  Match.value(cause).pipe(
    Match.when(hasExitClass, (carrier: Record<'exitClass', unknown>) =>
      Option.filter(Option.fromUndefinedOr(carrier.exitClass), S.is(ExitClassSchema))),
    Match.orElse(() =>
      Option.none()
    ),
  )

export class StageError extends S.TaggedError<StageError>(TypeId)('StageError', {
  stage: S.Literals(['prepare', 'instrument', 'dryRun', 'dryRunNoTests', 'mutationTest']),
  reason: S.String,
  cause: S.optional(S.Defect()),
  command: S.optional(S.String),
}) {
  readonly [TypeId] = TypeId

  get exitClass(): ExitClass {
    return Option.getOrElse(causeExitClass(this.cause), () => STAGE_PRESENTATION[this.stage].exitClass)
  }

  override get message(): string {
    const failure = `${STAGE_PRESENTATION[this.stage].label} failed: ${this.reason}`
    return Match.value(this.command).pipe(
      Match.when(Match.nonEmptyString, (present) => `${failure} (command: ${present})`),
      Match.orElse(() => failure),
    )
  }
}

const STAGE_PRESENTATION: Record<StageError['stage'], { readonly label: string; readonly exitClass: ExitClass }> = {
  prepare: { label: 'Prepare', exitClass: 'ConfigError' },
  instrument: { label: 'Instrument', exitClass: 'RuntimeError' },
  dryRun: { label: 'Dry run', exitClass: 'RuntimeError' },
  dryRunNoTests: { label: 'Dry run', exitClass: 'ConfigError' },
  mutationTest: { label: 'Mutation testing', exitClass: 'RuntimeError' },
}

export class PrepareError extends S.TaggedError<PrepareError>()('PrepareError', {
  stage: S.Literal('prepare'),
  reason: S.String,
}) {}
