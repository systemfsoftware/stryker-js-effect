import { Cell, Sandwich } from '@systemfsoftware/effect-cell-types'
import { Mutant } from '@systemfsoftware/stryker-js-instrumenter'
import { PluginFileUrl, RENDERED_OPTION_DEFAULTS } from '@systemfsoftware/stryker-js-plugin-interface'
import type {
  PartialStrykerOptions,
  StrykerOptions,
} from '@systemfsoftware/stryker-js-plugin-interface'
import cliPkgJson from '@systemfsoftware/stryker-js/package.json' with { type: 'json' }
import * as Bool from 'effect/Boolean'
import * as Config from 'effect/Config'
import * as Console from 'effect/Console'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import type { PlatformError } from 'effect/PlatformError'
import * as Path from 'effect/Path'
import * as Ref from 'effect/Ref'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import type { SchemaError } from 'effect/Schema'
import * as Argument from 'effect/unstable/cli/Argument'
import * as CliError from 'effect/unstable/cli/CliError'
import * as Command from 'effect/unstable/cli/Command'
import * as Flag from 'effect/unstable/cli/Flag'

import { Admitted, NoSurvivors } from './admit-survivors-run.workflow.js'
import { survivorsAdmissionCell } from './Survivors/Survivors.cell.js'
import type { SurvivorsRejection } from './Survivors/mod.js'
import type { CliRequest } from './Cli.schema.js'
import {
  type ConfigFileInvalidError,
  type ConfigFileNotFoundError,
  type ConfigFileUnreadableError,
  type ConfigFileUnsupportedError,
} from './ConfigError.schema.js'
import {
  type RunOutcomeDecision,
  type RunOutcomeError,
} from './classify-run-outcome.workflow.js'
import {
  classifyRunOutcome,
  errorText,
  readCapturedConsole,
  runOutcomeCode,
} from './Envelope.js'
import { type HostServices, type StrykerRun } from './run/host.service.js'
import {
  applyProgressStreamFile,
  hostOptionsOf,
  prepareCommandOf,
  progressStreamFileName,
  runOnHost,
} from './run/host.cell.js'
import {
  routeCliRequest,
} from './route-cli-request.workflow.js'
import { mergeReportsCell } from './merge-reports.cell.js'
import { MergeReportsFailed } from './merge-reports.schema.js'
import { RunExit } from './classify-run-outcome.workflow.js'
import type { RunEventStreamPort } from './run-event-stream.service.js'
import { StrykerError } from './stryker-error.schema.js'
import type { OutputModeProbe } from './output-mode-probe.service.js'
import type { ResolvedMode } from './output-mode.schema.js'

interface CliEnvironment {
  readonly mode: ResolvedMode
  readonly stream: RunEventStream
  readonly host: HostServices
  readonly basePath: string
  readonly pathService: Path.Path
  readonly runMutationTest: StrykerRun | undefined
  readonly runEvents: RunEventStreamPort
}

interface StrykerCliInvocation {
  readonly argv: readonly string[]
  readonly environment: CliEnvironment
}

type CliRead = (typeof CliRouteCommand)['Encoded'] & {
  readonly environment: CliEnvironment
  readonly options: PartialStrykerOptions
}


type CliAnswer = void | MutationTestDone

type CliFailure =
  | SchemaError
  | SurvivorsRejection
  | ConfigFileNotFoundError
  | ConfigFileUnreadableError
  | ConfigFileInvalidError
  | ConfigFileUnsupportedError
  | MergeReportsFailed

type CliRunServices = FileSystem.FileSystem | Path.Path

const createSplitter = (separator: string) => (value: string) => value.split(separator).filter(Boolean)

const splitOnComma = createSplitter(',')
const splitOnSpace = createSplitter(' ')

const decodePluginFileUrl = S.decodeOption(PluginFileUrl)

const asPluginFileUrls = (specifiers: readonly string[]): Option.Option<readonly string[]> =>
  Option.all(specifiers.map((specifier) => decodePluginFileUrl(specifier)))

const rejectNonFileUrlPlugin = (flagName: string) => (specifiers: readonly string[]): string => {
  const rejected = specifiers.filter((specifier) => Option.isNone(decodePluginFileUrl(specifier)))
  return `--${flagName} takes plugin entrypoints as file URLs. Resolve each one with import.meta.resolve in your config. Not a file URL: ${
    rejected.join(', ')
  }`
}

const CLEAN_TEMP_DIR_DISABLED = ['false', '0'] as const

const parseCleanDirOption = (value: string): 'always' | boolean => {
  const normalized = value.toLocaleLowerCase()
  return Match.value(normalized).pipe(
    Match.when('always', () => 'always' as const),
    Match.orElse(() => !CLEAN_TEMP_DIR_DISABLED.some((disabled) => disabled === normalized)),
  )
}

const parseConcurrency = (value: string): number | string =>
  Match.value(/^\d+$/.test(value)).pipe(
    Match.when(true, () => Number.parseInt(value, 10)),
    Match.orElse(() => value),
  )

const optional = <A>(option: Flag.Flag<A>) => Flag.optional(option)

const absentWhenFalse = (value: Option.Option<boolean>): boolean | undefined =>
  Option.getOrUndefined(Option.filter(value, (present) => present))

const isUnknownArgument = (argument: string | undefined): argument is string =>
  Option.exists(Option.fromUndefinedOr(argument), (text) => text.startsWith('-'))

const runOptions = {
  ignorePatterns: Flag.String('ignorePatterns')
    .pipe(
      Flag.withDescription(
        'A comma separated list of patterns used for specifying which files need to be ignored. This should only be used in cases where you experience a slow Stryker startup, because too many (or too large) files are copied to the sandbox that are not needed to run the tests. For example, image or movie directories. Note: This option will have NO effect when using the `--inPlace` option. The directories `node_modules`, `.git` and some others are always ignored. Example: `--ignorePatterns dist`. These patterns are ALWAYS ignored: [`node_modules`, `.git`, `/reports`, `*.tsbuildinfo`, `/stryker.log`, `.stryker-tmp`]. Because Stryker always ignores these, you should rarely have to adjust the `ignorePatterns` setting at all. This is useful to speed up Stryker by reducing the size of the sandbox directory which has a positive effect on performance.',
      ),
      Flag.map(splitOnComma),
      optional,
    ),
  ignoreStatic: Flag.map(optional(Flag.Boolean('ignoreStatic')), absentWhenFalse).pipe(
    Flag.withDescription(
      'Ignore static mutants. Static mutants are mutants which are only executed during the loading of a file.',
    ),
  ),
  incremental: Flag.map(optional(Flag.Boolean('incremental')), absentWhenFalse).pipe(
    Flag.withDescription(
      'Enable \'incremental mode\'. Stryker will store results in a file and use that file to speed up the next --incremental run',
    ),
  ),
  allowEmpty: Flag.map(optional(Flag.Boolean('allowEmpty')), absentWhenFalse).pipe(
    Flag.withDescription(
      'Allows stryker to exit without any errors in cases where no tests are found',
    ),
  ),
  incrementalFile: Flag.String('incrementalFile')
    .pipe(
      Flag.withDescription('Specify the file to use for incremental mode.'),
      optional,
    ),
  progressStreamFile: Flag.String('progressStreamFile')
    .pipe(
      Flag.withDescription('Specify the file for the machine-mode progress stream.'),
      optional,
    ),
  force: Flag.map(optional(Flag.Boolean('force')), absentWhenFalse).pipe(
    Flag.withDescription(
      'Run all mutants, even if --incremental is provided and an incremental file exists. Can be used to force a rebuild of the incremental file.',
    ),
  ),
  mutate: Flag.String('mutate')
    .pipe(
      Flag.withAlias('m'),
      Flag.withDescription(
        'With `mutate` you configure the subset of files or just one specific file to be mutated. These should be your _production code files_, and definitely not your test files. (Whereas with `ignorePatterns` you prevent non-relevant files from being copied to the sandbox directory in the first place)\nThe default will try to guess your production code files based on sane defaults. It reads like this:\n- Include all js-like files inside the `src` or `lib` dir\n- Except files inside `__tests__` directories and file names ending with `test` or `spec`.\nIf the defaults are not sufficient for you, for example in a angular project you might want to **exclude** not only the `*.spec.ts` files but other files too, just like the default already does.\nIt is possible to override the defaults by: - supplying one or more [glob patterns](https://github.com/isaacs/minimatch) to include (e.g. `src/**/*.js`) - or one or more comma separated glob patterns preceded with `!` to exclude (e.g. `!src/**/*.spec.js`) - or both (e.g. `src/**/*.js,!src/**/*.spec.js`).\nNote: Stryker will use [minimatch](https://github.com/isaacs/minimatch) for parsing these patterns, see minimatch for the exact syntax.',
      ),
      Flag.map(splitOnComma),
      optional,
    ),
  testFiles: Flag.String('testFiles')
    .pipe(
      Flag.withAlias('t'),
      Flag.withDescription(
        'With `testFiles` you can limit which test files are executed during mutation testing. When specified, only tests from these files will be run. This allows you to verify that a module\'s dedicated unit tests can kill all its mutants independently.',
      ),
      Flag.map(splitOnComma),
      optional,
    ),
  buildCommand: Flag.String('buildCommand')
    .pipe(
      Flag.withAlias('b'),
      Flag.withDescription(
        'Configure a build command to run after mutating the code, but before mutants are tested. This is generally used to transpile your code before testing. Only configure this if your test runner doesn\'t take care of this already and you\'re not using just-in-time transpiler like `babel/register` or `ts-node`.',
      ),
      optional,
    ),
  dryRunOnly: Flag.map(optional(Flag.Boolean('dryRunOnly')), absentWhenFalse).pipe(
    Flag.withDescription(
      'Execute the initial test run only, without doing actual mutation testing. Doing a dry run only can be used to test that StrykerJS can run your test setup, for example, in CI pipelines.',
    ),
  ),
  checkerNodeArgs: Flag.String('checkerNodeArgs')
    .pipe(
      Flag.withDescription(
        'A list of node args to be passed to checker child processes. Split on spaces (commander characterization): `--checkerNodeArgs "--inspect-brk --trace-warnings"`.',
      ),
      Flag.map(splitOnSpace),
      optional,
    ),
  coverageAnalysis: Flag.Literals('coverageAnalysis', ['perTest', 'all', 'off'])
    .pipe(
      Flag.withDescription(
        `The coverage analysis strategy you want to use. Default value: "${RENDERED_OPTION_DEFAULTS.coverageAnalysis}"`,
      ),
      optional,
    ),
  testRunner: Flag.String('testRunner')
    .pipe(
      Flag.withDescription('The name of the test runner you want to use'),
      optional,
    ),
  testRunnerNodeArgs: Flag.String('testRunnerNodeArgs')
    .pipe(
      Flag.withDescription(
        'A list of node args to be passed to test runner child processes. Split on spaces (commander characterization): `--testRunnerNodeArgs "--inspect-brk --trace-warnings"`.',
      ),
      Flag.map(splitOnSpace),
      optional,
    ),
  reporters: Flag.String('reporters')
    .pipe(
      Flag.withDescription(
        'A comma separated list of the names of the reporter(s) you want to use',
      ),
      Flag.map(splitOnComma),
      optional,
    ),
  plugins: Flag.String('plugins')
    .pipe(
      Flag.withDescription(
        'A comma separated list of plugin entrypoints, each a file URL resolved with `import.meta.resolve` in your config.',
      ),
      Flag.map(splitOnComma),
      Flag.filterMap(asPluginFileUrls, rejectNonFileUrlPlugin('plugins')),
      optional,
    ),
  appendPlugins: Flag.String('appendPlugins')
    .pipe(
      Flag.withDescription(
        'A comma separated list of additional plugin entrypoints, each a file URL resolved with `import.meta.resolve` in your config, loaded without overwriting the (default) `plugins`.',
      ),
      Flag.map(splitOnComma),
      Flag.filterMap(asPluginFileUrls, rejectNonFileUrlPlugin('appendPlugins')),
      optional,
    ),
  timeoutMS: Flag.Int('timeoutMS')
    .pipe(
      Flag.withDescription(
        'Tweak the absolute timeout used to wait for a test runner to complete',
      ),
      optional,
    ),
  timeoutFactor: Flag.Finite('timeoutFactor')
    .pipe(
      Flag.withDescription(
        'Tweak the standard deviation relative to the normal test run of a mutated test',
      ),
      optional,
    ),
  dryRunTimeoutMinutes: Flag.Finite('dryRunTimeoutMinutes')
    .pipe(
      Flag.withDescription(
        'Configure an absolute timeout for the initial test run. (It can take a while.)',
      ),
      optional,
    ),
  maxConcurrentTestRunners: Flag.Int('maxConcurrentTestRunners')
    .pipe(
      Flag.withDescription(
        'Set the number of max concurrent test runner to spawn (default: cpuCount)',
      ),
      optional,
    ),
  concurrency: Flag.String('concurrency')
    .pipe(
      Flag.withAlias('c'),
      Flag.withDescription(
        'Set the concurrency of workers. Stryker will always run checkers and test runners in parallel by creating worker processes (default: cpuCount - 1)',
      ),
      Flag.map(parseConcurrency),
      optional,
    ),
  disableBail: Flag.map(optional(Flag.Boolean('disableBail')), absentWhenFalse).pipe(
    Flag.withDescription(
      'Force the test runner to keep running tests, even when a mutant is already killed.',
    ),
  ),
  maxTestRunnerReuse: Flag.Int('maxTestRunnerReuse')
    .pipe(
      Flag.withDescription(
        'Restart each test runner worker process after `n` runs. Not recommended unless you are experiencing memory leaks that you are unable to resolve. Configuring `0` here means infinite reuse.',
      ),
      optional,
    ),
  logLevel: Flag.Literals('logLevel', ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'off'] as const)
    .pipe(
      Flag.withDescription(
        `Set the log level for the console. Possible values: fatal, error, warn, info, debug, trace and off. Default is "${RENDERED_OPTION_DEFAULTS.logLevel}"`,
      ),
      optional,
    ),
  fileLogLevel: Flag.Literals('fileLogLevel', ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'off'] as const)
    .pipe(
      Flag.withDescription(
        `Set the log level for the "stryker.log" file. Possible values: fatal, error, warn, info, debug, trace and off. Default is "${RENDERED_OPTION_DEFAULTS.fileLogLevel}"`,
      ),
      optional,
    ),
  inPlace: Flag.map(optional(Flag.Boolean('inPlace')), absentWhenFalse).pipe(
    Flag.withDescription(
      'Determines whether or not Stryker should mutate your files in place. Note: mutating your files in place is generally not needed for mutation testing, unless you have a dependency in your project that is really dependent on the file locations (like "app-root-path" for example).\nWhen `true`, Stryker will override your files, but it will keep a copy of the originals in the temp directory (using `tempDirName`) and it will place the originals back after it is done. Also with `true` the `ignorePatterns` has no effect any more.\nWhen `false` (default) Stryker will work in the copy of your code inside the temp directory.',
    ),
  ),
  tempDirName: Flag.String('tempDirName')
    .pipe(
      Flag.withDescription(
        'Set the name of the directory that is used by Stryker as a working directory. This directory will be cleaned after a successful run',
      ),
      optional,
    ),
  cleanTempDir: Flag.String('cleanTempDir')
    .pipe(
      Flag.withDescription(
        `Choose whether or not to clean the temp dir (which is "${RENDERED_OPTION_DEFAULTS.tempDirName}" inside the current working directory by default) after a run.\n- false: Never delete the temp dir;\n- true: Delete the tmp dir after a successful run;\n- always: Always delete the temp dir, regardless of whether the run was successful.`,
      ),
      Flag.map(parseCleanDirOption),
      optional,
    ),
  survivors: Flag.map(optional(Flag.Boolean('survivors')), absentWhenFalse).pipe(
    Flag.withDescription(
      'Re-run only the mutants that survived a previous run. Admits against the previous run\'s mutation report (the `survivorsPriorReport` config option, default `reports/mutation-report.json`) and re-tests exactly the survivor set. Exits 2 with a remediation naming a full run when the report is missing, drifted, or the configuration changed; exits 0 with a null score when the report has no survivors.',
    ),
  ),
}

const runArgs = {
  configFile: Argument.optional(Argument.String('configFile')),
}

const runConfig = {
  ...runOptions,
  ...runArgs,
}

const mergeReportsOptions = {
  parts: Flag.String('parts').pipe(
    Flag.withDescription('The directory holding the downloaded mutation report parts (any download layout).'),
  ),
  out: Flag.String('out').pipe(
    Flag.withDescription('The directory to write the merged report, its html view, and the summary into.'),
  ),
  packages: Flag.String('packages')
    .pipe(
      Flag.withDescription(
        'A JSON array of the package names the run expected, falling back to the PACKAGES environment variable.',
      ),
      optional,
    ),
}

const makeStrykerCommand = (requestRef: Ref.Ref<Option.Option<CliRequest>>) => {
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

  const readStrykerOptions = (config: RunParsedConfig): PartialStrykerOptions => {
    const entryOf = <K extends keyof StrykerOptions>(key: K, value: Option.Option<StrykerOptions[K]>) =>
      Option.match(value, {
        onNone: () => ({}),
        onSome: (present) => ({ [key]: present }),
      })
    const trueEntryOf = <K extends keyof StrykerOptions>(key: K, value: StrykerOptions[K] | undefined) =>
      Bool.match(value === true, {
        onTrue: () => ({ [key]: true }),
        onFalse: () => ({}),
      })
    return {
      ...entryOf('ignorePatterns', config.ignorePatterns),
      ...trueEntryOf('ignoreStatic', config.ignoreStatic),
      ...trueEntryOf('incremental', config.incremental),
      ...trueEntryOf('allowEmpty', config.allowEmpty),
      ...entryOf('incrementalFile', config.incrementalFile),
      ...entryOf('progressStreamFile', config.progressStreamFile),
      ...trueEntryOf('force', config.force),
      ...entryOf('mutate', config.mutate),
      ...entryOf('testFiles', config.testFiles),
      ...entryOf('buildCommand', config.buildCommand),
      ...trueEntryOf('dryRunOnly', config.dryRunOnly),
      ...entryOf('checkerNodeArgs', config.checkerNodeArgs),
      ...entryOf('coverageAnalysis', config.coverageAnalysis),
      ...entryOf('testRunner', config.testRunner),
      ...entryOf('testRunnerNodeArgs', config.testRunnerNodeArgs),
      ...entryOf('reporters', config.reporters),
      ...entryOf('plugins', config.plugins),
      ...entryOf('appendPlugins', config.appendPlugins),
      ...entryOf('timeoutMS', config.timeoutMS),
      ...entryOf('timeoutFactor', config.timeoutFactor),
      ...entryOf('dryRunTimeoutMinutes', config.dryRunTimeoutMinutes),
      ...entryOf('maxConcurrentTestRunners', config.maxConcurrentTestRunners),
      ...entryOf('concurrency', config.concurrency),
      ...trueEntryOf('disableBail', config.disableBail),
      ...entryOf('maxTestRunnerReuse', config.maxTestRunnerReuse),
      ...entryOf('logLevel', config.logLevel),
      ...entryOf('fileLogLevel', config.fileLogLevel),
      ...trueEntryOf('inPlace', config.inPlace),
      ...entryOf('tempDirName', config.tempDirName),
      ...entryOf('cleanTempDir', config.cleanTempDir),
      ...entryOf('configFile', config.configFile),
    }
  }

  const mergeReportsCommand = Command.make(
    'merge-reports',
    mergeReportsOptions,
    (config): Effect.Effect<void, CliError.CliError, never> =>
      Effect.gen(function*() {
        const fromEnvironment = yield* Config.String('PACKAGES').pipe(Effect.option)
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

const EMPTY_OPTIONS: PartialStrykerOptions = {}

const routeOf = (request: Option.Option<CliRequest>): CliRouteCommand =>
  Option.match(request, {
    onNone: () => new CliRouteCommand({ route: { _tag: 'help' } }),
    onSome: (cliRequest) =>
      Match.value(cliRequest).pipe(
        Match.tag('merge-reports', (merge) =>
          new CliRouteCommand({
            route: { _tag: 'merge-reports', parts: merge.parts, out: merge.out, packages: merge.packages },
          })),
        Match.tag('run', (run) => new CliRouteCommand({ route: { _tag: 'run', survivors: run.survivors } })),
        Match.exhaustive,
      ),
  })

const optionsOf = (request: Option.Option<CliRequest>): PartialStrykerOptions =>
  Option.match(request, {
    onNone: () => EMPTY_OPTIONS,
    onSome: (cliRequest) =>
      Match.value(cliRequest).pipe(
        Match.tag('merge-reports', () => EMPTY_OPTIONS),
        Match.tag('run', (run) => run.options),
        Match.exhaustive,
      ),
  })

const readCliRoute = (
  invocation: StrykerCliInvocation,
): Effect.Effect<
  CliRead,
  CliError.CliError,
  Command.Environment | RunEventDrain
> =>
  Effect.gen(function*() {
    const requestRef = yield* Ref.make<Option.Option<CliRequest>>(Option.none())
    const command = makeStrykerCommand(requestRef)
    const parsed = yield* Effect.result(Command.runWith(command, { version: cliPkgJson.version })(invocation.argv))
    const request = yield* Ref.get(requestRef)
    yield* request.pipe(progressStreamFileName, applyProgressStreamFile)
    yield* invocation.environment.stream.open
    return yield* Result.match(parsed, {
      onFailure: (failure) => Effect.fail(failure),
      onSuccess: () =>
        Effect.succeed({
          ...routeOf(request),
          environment: invocation.environment,
          options: optionsOf(request),
        }),
    })
  })

const runMutationTestOf = (environment: CliEnvironment): StrykerRun =>
  environment.runMutationTest ??
    ((options, targetMutatePatterns) => runOnHost(environment.host, prepareCommandOf(options, targetMutatePatterns)))

const runEffectOf = (environment: CliEnvironment, options: PartialStrykerOptions) =>
  Effect.orDie(runMutationTestOf(environment)(options, undefined))

const restrictedOptionsOf = (
  resolvedOptions: StrykerOptions,
  priorReportPath: string,
  admitted: Admitted,
): PartialStrykerOptions & {
  readonly survivors?: ReadonlyArray<Mutant>
  readonly survivorsPriorReport?: string
  readonly mutate?: string[]
  readonly incremental?: boolean
} => {
  const admittedMutants = admitted.survivors.map((survivor) => Mutant.make(survivor))
  return {
    ...resolvedOptions,
    survivors: admittedMutants,
    mutate: [...admitted.mutateSpans],
    survivorsPriorReport: priorReportPath,
    incremental: false,
  }
}

const admissionOf = (
  answer: { readonly admission: Admitted | NoSurvivors; readonly resolvedOptions: StrykerOptions; readonly priorReportPath: string },
  channel: CliRead,
): Cell.Cell<typeof answer, CliAnswer, CliFailure, CliRunServices> =>
  Match.value(answer.admission).pipe(
    Match.tag('NoSurvivors', () =>
      Cell.fromEffect(
        channel.environment.runEvents.emitNullScoreVerdict({
          stream: channel.environment.stream,
          mode: channel.environment.mode,
          thresholds: answer.resolvedOptions.thresholds,
          config: answer.resolvedOptions,
          basePath: channel.environment.basePath,
          pathService: channel.environment.pathService,
        }),
      )),
    Match.tag('Admitted', (admitted) =>
      Cell.fromEffect(
        runEffectOf(channel.environment, restrictedOptionsOf(answer.resolvedOptions, answer.priorReportPath, admitted)),
      )),
    Match.exhaustive,
  )

const cliRouteCell = Sandwich.named('stryker.cli')(readCliRoute)
  .decide(routeCliRequest)
  .write({
    CliHelpRequested: () => Cell.succeed<CliAnswer, CliRead>(undefined),
    CliMergeReportsRequested: (merge) =>
      Cell.succeed({ _tag: 'merge-reports', parts: merge.parts, out: merge.out, packages: merge.packages }).pipe(
        Cell.andThen(mergeReportsCell),
      ),
    CliRunRequested: (_outcome, channel) =>
      Cell.fromEffect(runEffectOf(channel.environment, channel.options)),
    CliSurvivorsRequested: (_outcome, channel) =>
      Cell.succeed({ cliOptions: channel.options, mode: channel.environment.mode.mode, basePath: channel.environment.basePath })
        .pipe(
          Cell.andThen(survivorsAdmissionCell),
          Cell.andThen((answer) => admissionOf(answer, channel)),
        ),
    CommandRejected: ({ issue }) =>
      Cell.fail(new StrykerError({ message: `the CLI read resolved a command the route schema rejects: ${issue}` })),
  })

export const strykerCliCell = cliRouteCell

export interface StrykerCliEffectOptions {
  readonly argv: readonly string[]
  readonly runMutationTest: StrykerRun | undefined
  readonly detectMode: OutputModeProbe['detectMode']
  readonly runEvents: RunEventStreamPort
}

const outcomeOf = (result: Result.Result<RunOutcomeDecision, RunOutcomeError>): string =>
  Result.match(result, {
    onSuccess: (decision) => decision._tag,
    onFailure: (error) => error._tag,
  })

const EXPORTABLE_SPAN_ERROR_LIMIT = 1024

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

export const strykerCliEffect = (options: StrykerCliEffectOptions): Effect.Effect<
  void,
  PlatformError | RunExit | CliError.CliError,
  Command.Environment | RunEventDrain
> =>
  Effect.gen(function*() {
    const mode = yield* options.detectMode
    const stream = yield* options.runEvents.createRunEventStream(mode)
    const noColor = yield* Config.String('NO_COLOR').pipe(Effect.option)
    const hostOptions = yield* hostOptionsOf(mode, stream, Option.getOrUndefined(noColor))
    const pathService = yield* Path.Path
    const environment: CliEnvironment = {
      mode,
      stream,
      host: { env: hostOptions, events: stream.queue },
      basePath: hostOptions.basePath,
      pathService,
      runMutationTest: options.runMutationTest,
      runEvents: options.runEvents,
    }
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.withSpan('stryker.cli.run')(
        Effect.gen(function*() {
          const exit = yield* Effect.exit(
            restore(
              strykerCliCell.run({ argv: options.argv, environment }),
            ),
          )
          const outcome = classifyRunOutcome(exit, options.argv)
          const code = runOutcomeCode(outcome)
          yield* Effect.annotateCurrentSpan({
            'stryker.run.outcome': outcomeOf(outcome),
            'stryker.run.exit_code': code,
            'stryker.run.error': errorTextOf(outcome),
          })
          yield* Bool.match(mode.mode === 'machine', {
            onTrue: () =>
              options.runEvents.emitMachineModeOutput({
                stream,
                mode,
                outcome,
                basePath: hostOptions.basePath,
                pathService,
              }),
            onFalse: () => Effect.void,
          })
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