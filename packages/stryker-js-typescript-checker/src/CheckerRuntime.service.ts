import { Cell } from '@systemfsoftware/effect-cell-types'
import { ErrorText } from '@systemfsoftware/stryker-js-instrumenter'
import { Checker, CheckerFailed, CheckerMutantWire } from '@systemfsoftware/stryker-js-plugin-interface'
import type { CheckResult, StrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Boolean from 'effect/Boolean'
import type * as Cause from 'effect/Cause'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as S from 'effect/Schema'
import { DiagnosticCategory } from 'typescript/unstable/sync'
import type { Diagnostic } from 'typescript/unstable/sync'
import type { CheckMutantsAnswer } from './check-mutants.workflow.js'
import { checkCell } from './Checker.cell.js'
import { CheckMutantsCommand } from './Checker.schema.js'
import { type CompilerError, DryRunCompileErrors, NodeNotInGraph } from './Compiler.schema.js'
import { getLineAndCharacterOfPosition, groups, init, type TSCompiler } from './ts-compiler.handle.js'
import { layer as compilerLayer } from './ts-compiler.resource.js'
import { TypeScriptCompiler } from './ts-compiler.service.js'

type RunAnswers = CheckMutantsAnswer['results']

const refuse = (
  options: {
    readonly mutantIds: readonly string[]
    readonly cause: CompilerError | DryRunCompileErrors | NodeNotInGraph
  },
): CheckerFailed =>
  CheckerFailed.make({
    checkerName: 'typescript',
    mutantIds: options.mutantIds,
    cause: Option.getOrElse(Option.map(ErrorText.fromCause(options.cause), (rendered) => rendered.text), () => ''),
  })

export interface CheckerRuntimeShape {
  readonly checker: Effect.Effect<Checker['Service'], Cause.Cause<CheckerFailed>>
}

const getPrioritize = (options: StrykerOptions) =>
  Match.value(options.checkers[0]).pipe(
    Match.when(Match.undefined, () => false),
    Match.orElse((first) =>
      Match.value(first.options).pipe(
        Match.when(Match.undefined, () => false),
        Match.orElse((checkerOptions) => checkerOptions['prioritizePerformanceOverAccuracy'] === true),
      )
    ),
  )

const severityOf = (category: Diagnostic['category']) =>
  Match.value(category).pipe(
    Match.when(DiagnosticCategory.Warning, () => 'warning'),
    Match.when(DiagnosticCategory.Error, () => 'error'),
    Match.when(DiagnosticCategory.Suggestion, () => 'suggestion'),
    Match.orElse(() => 'message'),
  )

const toCheckResult = (answer: RunAnswers[string]) =>
  Match.value(answer).pipe(
    Match.discriminator('status')('passed', () => ({ status: 'passed' as const })),
    Match.discriminator('status')(
      'compileError',
      (failed) => ({ status: 'compileError' as const, reason: failed.reason }),
    ),
    Match.exhaustive,
  )

const mergeAnswers = (runs: ReadonlyArray<RunAnswers>) =>
  runs.reduce(
    (merged, answers) =>
      Object.entries(answers).reduce((into, [id, answer]) => HashMap.set(into, id, toCheckResult(answer)), merged),
    HashMap.empty<string, CheckResult>(),
  )

const makeChecker = (options: StrykerOptions, compiler: TSCompiler): Checker['Service'] => {
  const verify = Cell.provideContext(checkCell, Context.make(TypeScriptCompiler, compiler))

  const positionOf = (error: Diagnostic) =>
    Option.match(Option.filter(Option.fromUndefinedOr(error.fileName), (fileName) => fileName !== ''), {
      onNone: () => Effect.succeed(''),
      onSome: (fileName) =>
        getLineAndCharacterOfPosition(compiler, fileName, error.pos).pipe(
          Effect.orElseSucceed(() => undefined),
          Effect.map((at) =>
            Option.match(Option.fromUndefinedOr(at), {
              onNone: () => fileName + '(1,1): ',
              onSome: (position) => fileName + '(' + (position.line + 1) + ',' + (position.character + 1) + '): ',
            })
          ),
        ),
    })

  const formatDiagnostic = (error: Diagnostic) =>
    positionOf(error).pipe(
      Effect.map((position) => position + severityOf(error.category) + ' TS' + error.code + ': ' + error.text),
    )

  const createErrorText = (errors: readonly Diagnostic[]) =>
    Effect.map(Effect.forEach(errors, formatDiagnostic), (parts) => parts.join('\n'))

  const soloRound = (mutant: (typeof CheckerMutantWire)['Encoded']) =>
    S.decodeEffect(CheckerMutantWire)(mutant).pipe(
      Effect.orDie,
      Effect.flatMap((decoded) => verify.run(CheckMutantsCommand.make({ mutants: [decoded] }))),
      Effect.withSpan('typescript-checker.soloRound', { attributes: { 'stryker.mutant.id': mutant.id } }),
      Effect.map((decision) => decision.results),
    )

  const soloRounds = (decision: CheckMutantsAnswer) =>
    Match.value(decision).pipe(
      Match.tag('CheckFinished', () => Effect.succeed<ReadonlyArray<RunAnswers>>([])),
      Match.tag('RetestRequired', (retest) =>
        verify.run(CheckMutantsCommand.make({ mutants: [] })).pipe(
          Effect.flatMap(() => Effect.forEach(retest.needsRetest, soloRound)),
        )),
      Match.exhaustive,
    )

  return {
    init: init(compiler).pipe(
      Effect.mapError((cause) => refuse({ mutantIds: [], cause })),
      Effect.flatMap((errors) =>
        Boolean.match(errors.length === 0, {
          onTrue: () => Effect.void,
          onFalse: () =>
            createErrorText(errors).pipe(
              Effect.map((text) =>
                refuse({
                  mutantIds: [],
                  cause: DryRunCompileErrors.make({ text }),
                })
              ),
              Effect.flatMap(Effect.fail),
            ),
        })
      ),
    ),

    check: (mutants) =>
      verify.run(CheckMutantsCommand.make({ mutants: [...mutants] })).pipe(
        Effect.flatMap((first) => Effect.map(soloRounds(first), (rounds) => mergeAnswers([first.results, ...rounds]))),
        Effect.withSpan('typescript-checker.check', { attributes: { 'stryker.mutants.count': mutants.length } }),
      ),

    group: (mutants) =>
      groups(compiler, mutants, getPrioritize(options)).pipe(
        Effect.mapError((cause) => refuse({ mutantIds: mutants.map((mutant) => mutant.id), cause })),
      ),
  }
}

export class CheckerRuntime extends Context.Service<CheckerRuntime, CheckerRuntimeShape>()(
  '@systemfsoftware/stryker-js-typescript-checker/CheckerRuntime.service/CheckerRuntime',
) {
  static readonly layer = (
    options: StrykerOptions,
  ): Layer.Layer<CheckerRuntime, never, FileSystem.FileSystem | Path.Path> =>
    Layer.effect(
      CheckerRuntime,
      Effect.gen(function*() {
        const compiler = yield* TypeScriptCompiler
        const checker = Effect.gen(function*() {
          const service = makeChecker(options, compiler)
          yield* service.init
          return service
        }).pipe(
          Effect.catchCause((cause) => Effect.fail(cause)),
          Effect.cached,
          Effect.flatten,
        )
        return CheckerRuntime.of({ checker })
      }),
    ).pipe(Layer.provide(compilerLayer(TypeScriptCompiler, options)))
}
