import * as NodeChildProcessSpawner from '@effect/platform-node-shared/NodeChildProcessSpawner'
import * as NodeFileSystem from '@effect/platform-node-shared/NodeFileSystem'
import * as NodePath from '@effect/platform-node-shared/NodePath'
import * as NodeTerminal from '@effect/platform-node-shared/NodeTerminal'
import * as NodeStdio from '@effect/platform-node/NodeStdio'
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { RENDERED_OPTION_DEFAULTS } from '@systemfsoftware/stryker-js-plugin-interface'
import type { PartialStrykerOptions } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Config from 'effect/Config'
import * as Console from 'effect/Console'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Ref from 'effect/Ref'
import * as Result from 'effect/Result'
import type { SchemaError } from 'effect/Schema'
import * as Argument from 'effect/unstable/cli/Argument'
import * as CliConfig from 'effect/unstable/cli/CliConfig'
import * as CliError from 'effect/unstable/cli/CliError'
import * as Command from 'effect/unstable/cli/Command'
import * as Flag from 'effect/unstable/cli/Flag'
import * as GlobalFlag from 'effect/unstable/cli/GlobalFlag'
import cliPkgJson from '../package.json' with { type: 'json' }
import { SurvivorsRejection } from './admit-survivors-run.workflow.js'
import { RunExit } from './classify-run-outcome.workflow.js'
import type { RunOutcomeDecision, RunOutcomeError } from './classify-run-outcome.workflow.js'
import {
  absentWhenFalse,
  asPluginFileUrls,
  isUnknownArgument,
  optional,
  parseCleanDirOption,
  parseConcurrency,
  rejectNonFileUrlPlugin,
  setIfPresent,
  setLogLevel,
  splitOnComma,
  splitOnSpace,
} from './cli-options.js'
import type { CliRequest } from './Cli.schema.js'
import {
  ConfigFileInvalidError,
  ConfigFileNotFoundError,
  ConfigFileUnreadableError,
  ConfigFileUnsupportedError,
} from './Config.schema.js'
import {
  buildErrorEnvelope,
  classifyRunOutcome,
  collectExitClasses,
  describeFailure,
  type ErrorEnvelope,
  errorText,
  exitClassOf,
  failureValue,
  isExitClass,
  machineConsoleLayer,
  readCapturedConsole,
  remediationFor,
  resetCapturedConsole,
  runOutcomeCode,
  unrecognizedArgumentOf,
} from './Envelope.js'
import { mergeReportsCell } from './merge-reports.cell.js'
import { MergeReportsFailed } from './merge-reports.schema.js'
import type { ResolvedMode } from './output-mode.js'
import { emitMachineModeOutput } from './Output.js'
import type { OutputModeProbe, RunEventStreamPort } from './Output.js'
import { emitNullScoreVerdict } from './Output.js'
import {
  applyProgressStreamFile,
  hostOptionsOf,
  onHost,
  prepareCommandOf,
  progressStreamFileName,
  runOnHost,
} from './run-host.js'
import { STREAM_SCHEMA_VERSION } from './StreamVersion.js'
import type { StrykerRun } from './StrykerRun.js'
import { runSurvivorsAdmission, survivorMutateSpans } from './Survivors.js'

export { type StrykerRun }

const EXPORTABLE_SPAN_ERROR_LIMIT = 1024
export {
  buildErrorEnvelope,
  collectExitClasses,
  describeFailure,
  type ErrorEnvelope,
  exitClassOf,
  failureValue,
  isExitClass,
  machineConsoleLayer,
  readCapturedConsole,
  remediationFor,
  resetCapturedConsole,
  unrecognizedArgumentOf,
}
export { STREAM_SCHEMA_VERSION }

export function resolveCliExitCode(exit: Exit.Exit<unknown, unknown>): number {
  return runOutcomeCode(classifyRunOutcome(exit, []))
}

export type DetectModeCapability = OutputModeProbe['detectMode']

export type CreateRunEventStreamCapability = RunEventStreamPort['createRunEventStream']

export interface RunStrykerCliInput {
  readonly program: Effect.Effect<void, CliError.CliError, never>
  readonly requestRef: Ref.Ref<Option.Option<CliRequest>>
  readonly mode: ResolvedMode
  readonly runMutationTest: StrykerRun | undefined
  readonly argv: readonly string[]
}

const runOptions = {
  ignorePatterns: Flag.string('ignorePatterns')
    .pipe(
      Flag.withDescription(
        'A comma separated list of patterns used for specifying which files need to be ignored. This should only be used in cases where you experience a slow Stryker startup, because too many (or too large) files are copied to the sandbox that are not needed to run the tests. For example, image or movie directories. Note: This option will have NO effect when using the `--inPlace` option. The directories `node_modules`, `.git` and some others are always ignored. Example: `--ignorePatterns dist`. These patterns are ALWAYS ignored: [`node_modules`, `.git`, `/reports`, `*.tsbuildinfo`, `/stryker.log`, `.stryker-tmp`]. Because Stryker always ignores these, you should rarely have to adjust the `ignorePatterns` setting at all. This is useful to speed up Stryker by reducing the size of the sandbox directory which has a positive effect on performance.',
      ),
      Flag.map(splitOnComma),
      optional,
    ),
  ignoreStatic: Flag.map(optional(Flag.boolean('ignoreStatic')), absentWhenFalse).pipe(
    Flag.withDescription(
      'Ignore static mutants. Static mutants are mutants which are only executed during the loading of a file.',
    ),
  ),
  incremental: Flag.map(optional(Flag.boolean('incremental')), absentWhenFalse).pipe(
    Flag.withDescription(
      "Enable 'incremental mode'. Stryker will store results in a file and use that file to speed up the next --incremental run",
    ),
  ),
  allowEmpty: Flag.map(optional(Flag.boolean('allowEmpty')), absentWhenFalse).pipe(
    Flag.withDescription(
      'Allows stryker to exit without any errors in cases where no tests are found',
    ),
  ),
  incrementalFile: Flag.string('incrementalFile')
    .pipe(
      Flag.withDescription('Specify the file to use for incremental mode.'),
      optional,
    ),
  progressStreamFile: Flag.string('progressStreamFile')
    .pipe(
      Flag.withDescription('Specify the file for the machine-mode progress stream.'),
      optional,
    ),
  force: Flag.map(optional(Flag.boolean('force')), absentWhenFalse).pipe(
    Flag.withDescription(
      'Run all mutants, even if --incremental is provided and an incremental file exists. Can be used to force a rebuild of the incremental file.',
    ),
  ),
  mutate: Flag.string('mutate')
    .pipe(
      Flag.withAlias('m'),
      Flag.withDescription(
        'With `mutate` you configure the subset of files or just one specific file to be mutated. These should be your _production code files_, and definitely not your test files. (Whereas with `ignorePatterns` you prevent non-relevant files from being copied to the sandbox directory in the first place)\nThe default will try to guess your production code files based on sane defaults. It reads like this:\n- Include all js-like files inside the `src` or `lib` dir\n- Except files inside `__tests__` directories and file names ending with `test` or `spec`.\nIf the defaults are not sufficient for you, for example in a angular project you might want to **exclude** not only the `*.spec.ts` files but other files too, just like the default already does.\nIt is possible to override the defaults by: - supplying one or more [glob patterns](https://github.com/isaacs/minimatch) to include (e.g. `src/**/*.js`) - or one or more comma separated glob patterns preceded with `!` to exclude (e.g. `!src/**/*.spec.js`) - or both (e.g. `src/**/*.js,!src/**/*.spec.js`).\nNote: Stryker will use [minimatch](https://github.com/isaacs/minimatch) for parsing these patterns, see minimatch for the exact syntax.',
      ),
      Flag.map(splitOnComma),
      optional,
    ),
  testFiles: Flag.string('testFiles')
    .pipe(
      Flag.withAlias('t'),
      Flag.withDescription(
        "With `testFiles` you can limit which test files are executed during mutation testing. When specified, only tests from these files will be run. This allows you to verify that a module's dedicated unit tests can kill all its mutants independently.",
      ),
      Flag.map(splitOnComma),
      optional,
    ),
  buildCommand: Flag.string('buildCommand')
    .pipe(
      Flag.withAlias('b'),
      Flag.withDescription(
        'Configure a build command to run after mutating the code, but before mutants are tested. This is generally used to transpile your code before testing.' +
          " Only configure this if your test runner doesn't take care of this already and you're not using just-in-time transpiler like `babel/register` or `ts-node`.",
      ),
      optional,
    ),
  dryRunOnly: Flag.map(optional(Flag.boolean('dryRunOnly')), absentWhenFalse).pipe(
    Flag.withDescription(
      'Execute the initial test run only, without doing actual mutation testing. Doing a dry run only can be used to test that StrykerJS can run your test setup, for example, in CI pipelines.',
    ),
  ),
  checkerNodeArgs: Flag.string('checkerNodeArgs')
    .pipe(
      Flag.withDescription(
        'A list of node args to be passed to checker child processes. Split on spaces (commander characterization): `--checkerNodeArgs "--inspect-brk --trace-warnings"`.',
      ),
      Flag.map(splitOnSpace),
      optional,
    ),
  coverageAnalysis: Flag.choice('coverageAnalysis', ['perTest', 'all', 'off'])
    .pipe(
      Flag.withDescription(
        `The coverage analysis strategy you want to use. Default value: "${RENDERED_OPTION_DEFAULTS.coverageAnalysis}"`,
      ),
      optional,
    ),
  testRunner: Flag.string('testRunner')
    .pipe(
      Flag.withDescription('The name of the test runner you want to use'),
      optional,
    ),
  testRunnerNodeArgs: Flag.string('testRunnerNodeArgs')
    .pipe(
      Flag.withDescription(
        'A list of node args to be passed to test runner child processes. Split on spaces (commander characterization): `--testRunnerNodeArgs "--inspect-brk --trace-warnings"`.',
      ),
      Flag.map(splitOnSpace),
      optional,
    ),
  reporters: Flag.string('reporters')
    .pipe(
      Flag.withDescription(
        'A comma separated list of the names of the reporter(s) you want to use',
      ),
      Flag.map(splitOnComma),
      optional,
    ),
  plugins: Flag.string('plugins')
    .pipe(
      Flag.withDescription(
        'A comma separated list of plugin entrypoints, each a file URL resolved with `import.meta.resolve` in your config.',
      ),
      Flag.map(splitOnComma),
      Flag.filterMap(asPluginFileUrls, rejectNonFileUrlPlugin('plugins')),
      optional,
    ),
  appendPlugins: Flag.string('appendPlugins')
    .pipe(
      Flag.withDescription(
        'A comma separated list of additional plugin entrypoints, each a file URL resolved with `import.meta.resolve` in your config, loaded without overwriting the (default) `plugins`.',
      ),
      Flag.map(splitOnComma),
      Flag.filterMap(asPluginFileUrls, rejectNonFileUrlPlugin('appendPlugins')),
      optional,
    ),
  timeoutMS: Flag.integer('timeoutMS')
    .pipe(
      Flag.withDescription(
        'Tweak the absolute timeout used to wait for a test runner to complete',
      ),
      optional,
    ),
  timeoutFactor: Flag.float('timeoutFactor')
    .pipe(
      Flag.withDescription(
        'Tweak the standard deviation relative to the normal test run of a mutated test',
      ),
      optional,
    ),
  dryRunTimeoutMinutes: Flag.float('dryRunTimeoutMinutes')
    .pipe(
      Flag.withDescription(
        'Configure an absolute timeout for the initial test run. (It can take a while.)',
      ),
      optional,
    ),
  maxConcurrentTestRunners: Flag.integer('maxConcurrentTestRunners')
    .pipe(
      Flag.withDescription(
        'Set the number of max concurrent test runner to spawn (default: cpuCount)',
      ),
      optional,
    ),
  concurrency: Flag.string('concurrency')
    .pipe(
      Flag.withAlias('c'),
      Flag.withDescription(
        'Set the concurrency of workers. Stryker will always run checkers and test runners in parallel by creating worker processes (default: cpuCount - 1)',
      ),
      Flag.map(parseConcurrency),
      optional,
    ),
  disableBail: Flag.map(optional(Flag.boolean('disableBail')), absentWhenFalse).pipe(
    Flag.withDescription(
      'Force the test runner to keep running tests, even when a mutant is already killed.',
    ),
  ),
  maxTestRunnerReuse: Flag.integer('maxTestRunnerReuse')
    .pipe(
      Flag.withDescription(
        'Restart each test runner worker process after `n` runs. Not recommended unless you are experiencing memory leaks that you are unable to resolve. Configuring `0` here means infinite reuse.',
      ),
      optional,
    ),
  logLevel: Flag.choice('logLevel', ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'off'] as const)
    .pipe(
      Flag.withDescription(
        `Set the log level for the console. Possible values: fatal, error, warn, info, debug, trace and off. Default is "${RENDERED_OPTION_DEFAULTS.logLevel}"`,
      ),
      optional,
    ),
  fileLogLevel: Flag.choice('fileLogLevel', ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'off'] as const)
    .pipe(
      Flag.withDescription(
        `Set the log level for the "stryker.log" file. Possible values: fatal, error, warn, info, debug, trace and off. Default is "${RENDERED_OPTION_DEFAULTS.fileLogLevel}"`,
      ),
      optional,
    ),
  inPlace: Flag.map(optional(Flag.boolean('inPlace')), absentWhenFalse).pipe(
    Flag.withDescription(
      'Determines whether or not Stryker should mutate your files in place. Note: mutating your files in place is generally not needed for mutation testing, unless you have a dependency in your project that is really dependent on the file locations (like "app-root-path" for example).\nWhen `true`, Stryker will override your files, but it will keep a copy of the originals in the temp directory (using `tempDirName`) and it will place the originals back after it is done. Also with `true` the `ignorePatterns` has no effect any more.\nWhen `false` (default) Stryker will work in the copy of your code inside the temp directory.',
    ),
  ),
  tempDirName: Flag.string('tempDirName')
    .pipe(
      Flag.withDescription(
        'Set the name of the directory that is used by Stryker as a working directory. This directory will be cleaned after a successful run',
      ),
      optional,
    ),
  cleanTempDir: Flag.string('cleanTempDir')
    .pipe(
      Flag.withDescription(
        `Choose whether or not to clean the temp dir (which is "${RENDERED_OPTION_DEFAULTS.tempDirName}" inside the current working directory by default) after a run.\n- false: Never delete the temp dir;\n- true: Delete the tmp dir after a successful run;\n- always: Always delete the temp dir, regardless of whether the run was successful.`,
      ),
      Flag.map(parseCleanDirOption),
      optional,
    ),
  survivors: Flag.map(optional(Flag.boolean('survivors')), absentWhenFalse).pipe(
    Flag.withDescription(
      "Re-run only the mutants that survived a previous run. Admits against the previous run's mutation report (the `survivorsPriorReport` config option, default `reports/mutation-report.json`) and re-tests exactly the survivor set. Exits 2 with a remediation naming a full run when the report is missing, drifted, or the configuration changed; exits 0 with a null score when the report has no survivors.",
    ),
  ),
} satisfies Record<string, Flag.Flag<unknown>>

const runArgs = {
  configFile: Argument.optional(Argument.string('configFile')),
}

const runConfig = {
  ...runOptions,
  ...runArgs,
}

const mergeReportsOptions = {
  parts: Flag.string('parts').pipe(
    Flag.withDescription('The directory holding the downloaded mutation report parts (any download layout).'),
  ),
  out: Flag.string('out').pipe(
    Flag.withDescription('The directory to write the merged report, its html view, and the summary into.'),
  ),
  packages: Flag.string('packages')
    .pipe(
      Flag.withDescription(
        'A JSON array of the package names the run expected, falling back to the PACKAGES environment variable.',
      ),
      optional,
    ),
} satisfies Record<string, Flag.Flag<unknown>>

function makeStrykerCommand(requestRef: Ref.Ref<Option.Option<CliRequest>>) {
  const runCommand = Command.make(
    'run',
    runConfig,
    (config): Effect.Effect<void, CliError.CliError, never> => {
      const configFile = Option.getOrUndefined(config.configFile)
      if (isUnknownArgument(configFile)) {
        return Console.error(`Received unknown argument: '${configFile}'`).pipe(
          Effect.andThen(Effect.failSync(() => CliError.UnexpectedArgument.make({ arguments: [configFile] }))),
        )
      }
      return Ref.set(
        requestRef,
        Option.some({
          _tag: 'run',
          options: readStrykerOptions(config),
          survivors: config.survivors === true,
        }),
      )
    },
  ).pipe(Command.withDescription('Run mutation testing'))

  type ParsedConfigValue<A> = A extends Argument.Argument<infer Value> ? Value
    : A extends Flag.Flag<infer Value> ? Value
    : never
  type RunParsedConfig = {
    readonly [Key in keyof typeof runConfig]: ParsedConfigValue<(typeof runConfig)[Key]>
  }

  function readStrykerOptions(config: RunParsedConfig): PartialStrykerOptions {
    const options: PartialStrykerOptions = {}
    setIfPresent(options, 'ignorePatterns', config.ignorePatterns)
    setIfPresent(options, 'ignoreStatic', config.ignoreStatic)
    setIfPresent(options, 'incremental', config.incremental)
    setIfPresent(options, 'allowEmpty', config.allowEmpty)
    setIfPresent(options, 'incrementalFile', config.incrementalFile)
    setIfPresent(options, 'progressStreamFile', config.progressStreamFile)
    setIfPresent(options, 'force', config.force)
    setIfPresent(options, 'mutate', config.mutate)
    setIfPresent(options, 'testFiles', config.testFiles)
    setIfPresent(options, 'buildCommand', config.buildCommand)
    setIfPresent(options, 'dryRunOnly', config.dryRunOnly)
    setIfPresent(options, 'checkerNodeArgs', config.checkerNodeArgs)
    setIfPresent(options, 'coverageAnalysis', config.coverageAnalysis)
    setIfPresent(options, 'testRunner', config.testRunner)
    setIfPresent(options, 'testRunnerNodeArgs', config.testRunnerNodeArgs)
    setIfPresent(options, 'reporters', config.reporters)
    setIfPresent(options, 'plugins', config.plugins)
    setIfPresent(options, 'appendPlugins', config.appendPlugins)
    setIfPresent(options, 'timeoutMS', config.timeoutMS)
    setIfPresent(options, 'timeoutFactor', config.timeoutFactor)
    setIfPresent(options, 'dryRunTimeoutMinutes', config.dryRunTimeoutMinutes)
    setIfPresent(options, 'maxConcurrentTestRunners', config.maxConcurrentTestRunners)
    setIfPresent(options, 'concurrency', config.concurrency)
    setIfPresent(options, 'disableBail', config.disableBail)
    setIfPresent(options, 'maxTestRunnerReuse', config.maxTestRunnerReuse)
    setLogLevel(options, 'logLevel', config.logLevel)
    setLogLevel(options, 'fileLogLevel', config.fileLogLevel)
    setIfPresent(options, 'inPlace', config.inPlace)
    setIfPresent(options, 'tempDirName', config.tempDirName)
    setIfPresent(options, 'cleanTempDir', config.cleanTempDir)
    if (Option.isSome(config['configFile'])) {
      options['configFile'] = config['configFile'].value
    }
    return options
  }

  const mergeReportsCommand = Command.make(
    'merge-reports',
    mergeReportsOptions,
    (config): Effect.Effect<void, CliError.CliError, never> =>
      Effect.gen(function*() {
        const fromEnvironment = yield* Config.string('PACKAGES').pipe(Effect.option)
        yield* Ref.set(
          requestRef,
          Option.some({
            _tag: 'merge-reports',
            parts: config.parts,
            out: config.out,
            packages: Option.getOrUndefined(config.packages) ?? Option.getOrUndefined(fromEnvironment),
          }),
        )
      }),
  ).pipe(Command.withDescription('Merge per-package mutation reports into one report'))

  const root: Command.Command<
    'stryker',
    {},
    {},
    CliError.CliError,
    never
  > = Command
    .make('stryker', {}, (_config) => Effect.fail(CliError.ShowHelp.make({ commandPath: ['stryker'], errors: [] })))

  const strykerCommand = root.pipe(Command.withSubcommands([runCommand, mergeReportsCommand]))
  return strykerCommand
}
const terminalLayer = NodeTerminal.layer

const cliLayer = Layer.mergeAll(
  CliConfig.layer({
    builtIns: [
      GlobalFlag.Help,
      GlobalFlag.action({
        flag: Flag.boolean('version').pipe(Flag.withAlias('v'), Flag.withDescription('Show version information')),
        run: () => Console.log(cliPkgJson.version),
      }),
      GlobalFlag.Wizard,
      GlobalFlag.Completions,
      GlobalFlag.LogLevel,
    ],
  }),
  Path.layer,
  NodeFileSystem.layer,
  terminalLayer,
  NodeStdio.layer,
  NodeChildProcessSpawner.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
  ),
)
export function strykerCliEffect(
  argv: string[],
  runMutationTest: StrykerRun | undefined,
  detectMode: DetectModeCapability,
  createRunEventStream: CreateRunEventStreamCapability,
) {
  return Effect.gen(function*() {
    const mode = yield* detectMode
    const requestRef = yield* Ref.make<Option.Option<CliRequest>>(Option.none())
    const command = makeStrykerCommand(requestRef)
    const consoleLayer = (() => {
      if (mode.mode === 'machine') {
        return machineConsoleLayer
      }
      return Layer.empty
    })()
    const cliEffect = Command.runWith(command, { version: cliPkgJson.version })(argv).pipe(
      Effect.provide(Layer.mergeAll(consoleLayer, cliLayer)),
    )
    yield* runStrykerCli(
      { program: cliEffect, requestRef, mode, runMutationTest, argv },
      createRunEventStream,
    )
  })
}

export const runStrykerCli = (
  input: RunStrykerCliInput,
  createRunEventStream: CreateRunEventStreamCapability,
) =>
  Effect.gen(function*() {
    const stream = yield* createRunEventStream(input.mode)
    const noColor = yield* Config.string('NO_COLOR').pipe(Effect.option)
    const hostOptions = yield* hostOptionsOf(input.mode, stream, Option.getOrUndefined(noColor))
    const hostBinding = { env: hostOptions, events: stream.queue }
    const runMutationTestImpl: StrykerRun = input.runMutationTest ??
      ((options, targetMutatePatterns) => runOnHost(hostBinding, prepareCommandOf(options, targetMutatePatterns)))
    const basePath = hostOptions.basePath
    const pathService = yield* Path.Path

    const dispatch = (
      request: CliRequest,
    ): Effect.Effect<
      unknown,
      | SchemaError
      | SurvivorsRejection
      | ConfigFileNotFoundError
      | ConfigFileUnreadableError
      | ConfigFileInvalidError
      | ConfigFileUnsupportedError
      | MergeReportsFailed,
      FileSystem.FileSystem | Path.Path
    > =>
      Match.value(request).pipe(
        Match.tag(
          'merge-reports',
          (mergeRequest) => mergeReportsCell.run(mergeRequest),
        ),
        Match.tag('run', (runRequest) =>
          (() => {
            if (runRequest.survivors) {
              return Effect.gen(function*() {
                const { admission, resolvedOptions, priorReportPath } = yield* onHost(
                  hostBinding,
                  runSurvivorsAdmission(runRequest.options, input.mode.mode),
                )
                return yield* Match.value(admission).pipe(
                  Match.tag('NoSurvivors', () =>
                    emitNullScoreVerdict(
                      stream,
                      input.mode,
                      resolvedOptions.thresholds,
                      resolvedOptions,
                      basePath,
                      pathService,
                    )),
                  Match.tag('Admitted', (admitted) => {
                    const admittedMutants = admitted.survivors.map((s) => Mutant.make(s))
                    const restricted: PartialStrykerOptions & {
                      readonly survivors?: readonly Mutant[]
                      readonly survivorsPriorReport?: string
                      readonly mutate?: string[]
                      readonly incremental?: boolean
                    } = {
                      ...resolvedOptions,
                      survivors: admittedMutants,
                      mutate: survivorMutateSpans(admittedMutants, basePath),
                      survivorsPriorReport: priorReportPath,
                      incremental: false,
                    }
                    return runMutationTestImpl(restricted).pipe(Effect.orDie)
                  }),
                  Match.exhaustive,
                )
              })
            }
            return runMutationTestImpl(runRequest.options).pipe(Effect.orDie)
          })()),
        Match.exhaustive,
      )

    const use = Effect.gen(function*() {
      const parsed = yield* Effect.result(input.program)
      const request = yield* Ref.get(input.requestRef)
      yield* applyProgressStreamFile(stream, progressStreamFileName(request))
      yield* stream.open
      if (Result.isFailure(parsed)) {
        return yield* parsed.failure
      }
      return yield* Option.match(request, {
        onNone: () => Effect.void,
        onSome: (cliRequest) => dispatch(cliRequest),
      })
    })

    const outcomeOf = (result: Result.Result<RunOutcomeDecision, RunOutcomeError>): string =>
      Result.match(result, {
        onSuccess: (decision) => decision._tag,
        onFailure: (error) => error._tag,
      })

    const errorTextOf = (result: Result.Result<RunOutcomeDecision, RunOutcomeError>): string =>
      Result.match(result, {
        onSuccess: () => '',
        onFailure: (failure) => {
          const text = errorText(failure, readCapturedConsole())
          return Match.value(text.length > EXPORTABLE_SPAN_ERROR_LIMIT).pipe(
            Match.when(true, () => `${text.slice(0, EXPORTABLE_SPAN_ERROR_LIMIT)}…[truncated]`),
            Match.orElse(() => text),
          )
        },
      })

    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.withSpan('stryker.cli.run')(
        Effect.gen(function*() {
          const exit = yield* Effect.exit(restore(use))
          const outcome = classifyRunOutcome(exit, input.argv)
          const code = runOutcomeCode(outcome)
          yield* Effect.annotateCurrentSpan({
            'stryker.run.outcome': outcomeOf(outcome),
            'stryker.run.exit_code': code,
            'stryker.run.error': errorTextOf(outcome),
          })
          if (input.mode.mode === 'machine') {
            yield* emitMachineModeOutput(stream, input.mode, outcome, basePath, pathService)
          }
          yield* stream.closeAndDrain
          yield* Result.match(outcome, {
            onSuccess: (decision) =>
              Match.value(decision).pipe(
                Match.tag('RunOk', () => Effect.void),
                Match.orElse(() => Effect.fail(RunExit.make({ code }))),
              ),
            onFailure: (interrupted) => Effect.fail(RunExit.make({ code: interrupted.code })),
          })
        }),
      )
    )
  })
