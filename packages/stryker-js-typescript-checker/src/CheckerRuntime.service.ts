import { Cell } from '@systemfsoftware/effect-cell-types'
import { SpanTaxonomy } from '@systemfsoftware/stryker-js-cli-contract'
import { ErrorText } from '@systemfsoftware/stryker-js-instrumenter'
import { Checker, Mutant, type Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
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
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import type { Diagnostic } from 'typescript/unstable/async'
import type { CheckMutantsAnswer } from './check-mutants.workflow.js'
import { checkCell } from './Checker.cell.js'
import { CheckMutantsCommand } from './Checker.schema.js'
import { type CompilerError, DryRunCompileErrors } from './Compiler.schema.js'
import { make as makeCompilerBlueprint } from './ts-compiler.blueprint.js'
import {
  configDigest,
  describeDiagnostics,
  groups,
  init,
  programDigest,
  type TSCompiler,
} from './ts-compiler.handle.js'
import { TypeScriptCompiler } from './ts-compiler.service.js'

type CheckEvent = CheckMutantsAnswer[number]

const refuse = (
  options: {
    readonly mutantIds: readonly Mutant.MutantId[]
    readonly cause: CompilerError | DryRunCompileErrors
  },
): Checker.CheckerFailed =>
  Checker.CheckerFailed.make({
    checkerName: 'typescript',
    mutantIds: options.mutantIds,
    cause: Option.getOrElse(Option.map(ErrorText.errorTextOf(options.cause), (rendered) => rendered.text), () => ''),
  })

export interface CheckerRuntimeShape {
  readonly checker: Effect.Effect<Checker.Checker['Service'], Cause.Cause<Checker.CheckerFailed>>
}

const toCheckResult = (event: CheckEvent): Checker.CheckResult =>
  Match.value(event).pipe(
    Match.tag('MutantPassed', () => ({ status: 'passed' as const })),
    Match.tag('MutantFailed', (failed) => ({ status: 'compileError' as const, reason: failed.reason })),
    Match.tag('MutantIgnored', (ignored) => ({ status: 'ignored' as const, reason: ignored.reason })),
    Match.exhaustive,
  )

const checkResultsOf = (events: ReadonlyArray<CheckEvent>): HashMap.HashMap<string, Checker.CheckResult> =>
  HashMap.fromIterable(Arr.map(events, (event) => [event.id, toCheckResult(event)] as const))

const makeChecker = Effect.fn(SpanTaxonomy.Spans.typescriptCheckerRuntimeMakeChecker.name)(function*(
  options: Options.StrykerOptions,
  compiler: TSCompiler,
): Effect.fn.Return<Checker.Checker['Service'], Checker.CheckerFailed> {
  const verify = Cell.provideContext(checkCell, Context.make(TypeScriptCompiler, compiler))

  const createErrorText = (errors: readonly Diagnostic[]) =>
    Effect.map(
      describeDiagnostics(compiler, errors),
      (diagnostics) => diagnostics.map((entry) => entry.rendered).join('\n'),
    )

  const service: Checker.Checker['Service'] = {
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
        Effect.map((events) => checkResultsOf(events)),
        Effect.withSpan(SpanTaxonomy.Spans.typescriptCheckerCheck.name, {
          attributes: { 'stryker.mutants.count': mutants.length },
        }),
      ),

    group: (mutants) => groups([...mutants]),

    digest: (scope) =>
      Match.value(scope).pipe(
        Match.when('config', () => configDigest(compiler)),
        Match.when('program', () => programDigest(compiler)),
        Match.exhaustive,
        Effect.mapError((cause) => refuse({ mutantIds: [], cause })),
      ),
  }

  yield* service.init
  return service
})

export class CheckerRuntime extends Context.Service<CheckerRuntime, CheckerRuntimeShape>()(
  '@systemfsoftware/stryker-js-typescript-checker/CheckerRuntime.service/CheckerRuntime',
) {
  static readonly layer = (
    options: Options.StrykerOptions,
  ): Layer.Layer<
    CheckerRuntime | TypeScriptCompiler,
    never,
    FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
  > =>
    Layer.effect(
      CheckerRuntime,
      Effect.gen(function*() {
        const compiler = yield* TypeScriptCompiler
        const checker = yield* makeChecker(options, compiler).pipe(
          Effect.catchCause((cause) => Effect.fail(cause)),
          Effect.cached,
        )
        return CheckerRuntime.of({ checker })
      }),
    ).pipe(Layer.provideMerge(makeCompilerBlueprint(options).layer(TypeScriptCompiler)))
}
