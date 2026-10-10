import { Run } from '@systemfsoftware/stryker-js-contracts'
import { Options } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Bool from 'effect/Boolean'
import * as Argument from 'effect/cli/Argument'
import * as CliError from 'effect/cli/CliError'
import * as Command from 'effect/cli/Command'
import * as Flag from 'effect/cli/Flag'
import * as Console from 'effect/Console'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'
import { type CliAnswer, type CliEnvironment, runRequestCell } from '../run-request.cell.js'

const createSplitter = (separator: string) => (value: string) => value.split(separator).filter(Boolean)

const splitOnComma = createSplitter(',')
const splitOnSpace = createSplitter(' ')

const decodePluginFileUrl = S.decodeOption(Options.PluginFileUrl)

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

const asPluginFileUrls = (specifiers: readonly string[]): Option.Option<readonly string[]> =>
  Option.all(specifiers.map((specifier) => decodePluginFileUrl(specifier)))

const rejectNonFileUrlPlugin = (flagName: string) => (specifiers: readonly string[]): string => {
  const rejected = specifiers.filter((specifier) => Option.isNone(decodePluginFileUrl(specifier)))
  return `--${flagName} takes plugin entrypoints as file URLs or bare package names. Not a plugin specifier: ${
    rejected.join(', ')
  }`
}

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
      "Enable 'incremental mode'. Stryker will store results in a file and use that file to speed up the next --incremental run",
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
  since: Flag.String('since')
    .pipe(
      Flag.withDescription(
        'Scope the run to the lines changed since a git ref. Stryker resolves the merge base, diffs the working tree at `--unified=0`, and intersects the changed lines with the configured `mutate` globs. Falls back to a full run when the Stryker config, a test-runner config, `package.json`, or the lockfile changed.',
      ),
      optional,
    ),
  full: Flag.map(optional(Flag.Boolean('full').pipe(Flag.withAlias('force'))), absentWhenFalse).pipe(
    Flag.withDescription(
      'Re-verify every mutant, ignoring the incremental cache and the persisted dry run. The full run is the backstop for the incremental cache. Aliased by the historical `--force`.',
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
        "With `testFiles` you can limit which test files are executed during mutation testing. When specified, only tests from these files will be run. This allows you to verify that a module's dedicated unit tests can kill all its mutants independently.",
      ),
      Flag.map(splitOnComma),
      optional,
    ),
  buildCommand: Flag.String('buildCommand')
    .pipe(
      Flag.withAlias('b'),
      Flag.withDescription(
        "Configure a build command to run after mutating the code, but before mutants are tested. This is generally used to transpile your code before testing. Only configure this if your test runner doesn't take care of this already and you're not using just-in-time transpiler like `babel/register` or `ts-node`.",
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
        `The coverage analysis strategy you want to use. Default value: "${Options.StrykerCoverageAnalysis.literal}"`,
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
        'A comma separated list of plugin entrypoints, each a file URL or a bare package name resolved from your project.',
      ),
      Flag.map(splitOnComma),
      Flag.filterMap(asPluginFileUrls, rejectNonFileUrlPlugin('plugins')),
      optional,
    ),
  appendPlugins: Flag.String('appendPlugins')
    .pipe(
      Flag.withDescription(
        'A comma separated list of additional plugin entrypoints, each a file URL or a bare package name, loaded without overwriting the (default) `plugins`.',
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
        `Set the log level for the console. Possible values: fatal, error, warn, info, debug, trace and off. Default is "${Options.StrykerLogLevel.literal}"`,
      ),
      optional,
    ),
  fileLogLevel: Flag.Literals('fileLogLevel', ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'off'] as const)
    .pipe(
      Flag.withDescription(
        `Set the log level for the "stryker.log" file. Possible values: fatal, error, warn, info, debug, trace and off. Default is "${Options.StrykerFileLogLevel.literal}"`,
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
        `Choose whether or not to clean the temp dir (which is "${Options.StrykerTempDirName.literal}" inside the current working directory by default) after a run.\n- false: Never delete the temp dir;\n- true: Delete the tmp dir after a successful run;\n- always: Always delete the temp dir, regardless of whether the run was successful.`,
      ),
      Flag.map(parseCleanDirOption),
      optional,
    ),
  survivors: Flag.map(optional(Flag.Boolean('survivors')), absentWhenFalse).pipe(
    Flag.withDescription(
      "Re-run only the mutants that survived a previous run. Admits against the previous run's mutation report (the `survivorsPriorReport` config option, default `reports/mutation-report.json`) and re-tests exactly the survivor set. Exits 2 with a remediation naming a full run when the report is missing, drifted, or the configuration changed; exits 0 with a null score when the report has no survivors.",
    ),
  ),
  mutant: Flag.String('mutant')
    .pipe(
      Flag.withDescription(
        "Re-run one or more mutants by id, comma separated. Admits each id against the previous run's mutation report (`reports/mutation/mutation.json`), restricts the run to those mutants' files, and emits a `mutant-detail` for each with its status, covering tests, killing test, and `stryker run --mutant <id>` reproducer. Exits 2 naming the ids when a report is missing or does not list one of them.",
      ),
      Flag.map(splitOnComma),
      optional,
    ),
  plan: Flag.String('plan')
    .pipe(
      Flag.withDescription(
        'Run one shard of a shard plan JSON produced by `stryker plan`. From a repo root, runs every project the shard lists, each through a child CLI in that project directory.',
      ),
      optional,
    ),
  shard: Flag.String('shard')
    .pipe(
      Flag.withDescription(
        'The shard to run as `k/N`, matching the plan. Exits 2 naming the plan when no such shard exists.',
      ),
      optional,
    ),
  project: Flag.String('project')
    .pipe(
      Flag.withDescription(
        'Internal: run this single planned project in-process. Set by the shard orchestrator for each child CLI.',
      ),
      optional,
    ),
  out: Flag.String('out')
    .pipe(
      Flag.withDescription(
        'The directory the shard orchestrator collects each project shard report into. Defaults to `reports/shards/<k>`.',
      ),
      optional,
    ),
}

const runArgs = {
  configFile: Argument.optional(Argument.String('configFile')),
}

const formatOptions = {
  json: Flag.map(optional(Flag.Boolean('json')), absentWhenFalse).pipe(
    Flag.withDescription('Write the machine-readable NDJSON event stream to stdout, and nothing else'),
  ),
  format: Flag.Literals('format', ['text']).pipe(
    Flag.withDescription('Write human-readable output on stdout (the only supported format)'),
    optional,
  ),
}

const runConfig = {
  ...runOptions,
  ...formatOptions,
  ...runArgs,
}

const mergeOptions = {
  plan: Flag.String('plan').pipe(
    Flag.withDescription('The shard plan JSON produced by `stryker plan`.'),
  ),
  out: Flag.String('out').pipe(
    Flag.withDescription(
      'The directory to write the merged report and incremental report into. Defaults to `reports/mutation`.',
    ),
    optional,
  ),
}

const mergeArgs = {
  shardDirs: Argument.String('shardOutputDir').pipe(
    Argument.withDescription("One directory per shard, in plan order, holding that shard's per-project reports."),
    Argument.variadic(),
  ),
}

const compareOptions = {
  baseline: Flag.String('baseline').pipe(
    Flag.withDescription(
      'The report of record to compare against: `reports/mutation-report.json` or the incremental cache file.',
    ),
  ),
  fresh: Flag.String('fresh').pipe(
    Flag.withDescription('The report to compare with the baseline, in the same format.'),
  ),
  noise: Flag.String('noise').pipe(
    Flag.withDescription(
      'A JSON array of mutant ids whose statuses the current engine already disagrees with itself on; the comparison subtracts them.',
    ),
    optional,
  ),
}

const gateOptions = {
  baseline: Flag.String('baseline')
    .pipe(
      Flag.withDescription(
        'The committed baseline of accepted survivor ids. `stryker gate` fails on survivors absent from it and passes every survivor it already holds. Optional when a budget baseline is given.',
      ),
      optional,
    ),
  updateBaseline: Flag.map(optional(Flag.Boolean('update-baseline')), absentWhenFalse).pipe(
    Flag.withDescription(
      'Rewrite the baseline file with exactly the survivors of the finished report and exit 0, instead of gating against it.',
    ),
  ),
  budgetBaseline: Flag.String('budget-baseline')
    .pipe(
      Flag.withDescription(
        'A committed budget baseline of one run duration. `stryker gate` fails when the finished report took longer than that baseline plus the tolerance.',
      ),
      optional,
    ),
  budgetTolerance: Flag.map(
    optional(Flag.Finite('budget-tolerance')),
    (value) => Option.getOrElse(value, () => 0.25),
  ).pipe(
    Flag.withDescription(
      'The fractional slack allowed over the budget baseline before gating fails. Default 0.25 (25%).',
    ),
  ),
  updateBudgetBaseline: Flag.map(optional(Flag.Boolean('update-budget-baseline')), absentWhenFalse).pipe(
    Flag.withDescription(
      'Rewrite the budget baseline file with the finished run duration and exit 0, instead of gating against it.',
    ),
  ),
}

const annotateOptions = {
  baseline: Flag.String('baseline').pipe(
    Flag.withDescription(
      'The committed baseline of accepted survivor ids. When set, only survivors absent from it are annotated; without it every surfaced survivor is annotated.',
    ),
    optional,
  ),
}

const planOptions = {
  targetSeconds: Flag.Finite('target-seconds').pipe(
    Flag.withDescription(
      'The wall-clock budget each shard is planned to fit; shard count = min(--max-shards, ceil(total predicted seconds / target)).',
    ),
  ),
  maxShards: Flag.Int('max-shards').pipe(
    Flag.withDescription('The greatest number of shards the plan may use.'),
    optional,
  ),
  projects: Flag.String('projects').pipe(
    Flag.withDescription(
      'A comma separated list of project directories to plan; defaults to the current working directory.',
    ),
    Flag.map(splitOnComma),
    optional,
  ),
  out: Flag.String('out').pipe(
    Flag.withDescription('Write the shard plan JSON to this file instead of stdout.'),
    optional,
  ),
  full: Flag.map(optional(Flag.Boolean('full')), absentWhenFalse).pipe(
    Flag.withDescription('Plan every discovered mutant, ignoring the incremental report.'),
  ),
}

const serveOptions = {
  port: Flag.Int('port').pipe(
    Flag.withDescription('The port the socket channel listens on. Required for the `socket` channel.'),
    optional,
  ),
  address: Flag.String('address').pipe(
    Flag.withDescription('The host address the socket channel listens on. Defaults to `localhost`.'),
    optional,
  ),
}

const serveArgs = {
  channel: Argument.Literals('channel', ['stdio', 'socket'] as const).pipe(
    Argument.withDescription('The transport to speak the Mutation Server Protocol over.'),
  ),
}

type ParsedConfigValue<A> = A extends Argument.Argument<infer Value> ? Value
  : A extends Flag.Flag<infer Value> ? Value
  : never
type RunParsedConfig = {
  readonly [Key in keyof typeof runConfig]: ParsedConfigValue<(typeof runConfig)[Key]>
}

const readStrykerOptions = (config: RunParsedConfig): Options.PartialStrykerOptions => {
  const entryOf = <K extends keyof Options.StrykerOptions>(key: K, value: Option.Option<Options.StrykerOptions[K]>) =>
    Option.match(value, {
      onNone: () => ({}),
      onSome: (present) => ({ [key]: present }),
    })
  const trueEntryOf = <K extends keyof Options.StrykerOptions>(
    key: K,
    value: Options.StrykerOptions[K] | undefined,
  ) =>
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
    ...entryOf('since', config.since),
    ...trueEntryOf('force', config.full),
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

const makeStrykerCommand = ({ environment, recordAnswer }: {
  readonly environment: CliEnvironment
  readonly recordAnswer: (answer: CliAnswer) => Effect.Effect<void>
}) => {
  const runCommand = Command.make('run', runConfig, (config) => {
    const configFile = Option.getOrUndefined(config.configFile)
    return Option.match(Option.filter(Option.fromUndefinedOr(configFile), isUnknownArgument), {
      onSome: (unknown) =>
        Console.error(`Received unknown argument: '${unknown}'`).pipe(
          Effect.andThen(Effect.failSync(() => CliError.UnexpectedArgument.make({ arguments: [unknown] }))),
        ),
      onNone: () =>
        runRequestCell.run({
          route: Run.CliRouteCommand.make({
            route: {
              _tag: 'run',
              survivors: config.survivors === true,
              mutants: Option.getOrUndefined(config.mutant),
              plan: Option.getOrUndefined(config.plan),
              shard: Option.getOrUndefined(config.shard),
              project: Option.getOrUndefined(config.project),
              out: Option.getOrUndefined(config.out),
            },
          }),
          options: readStrykerOptions(config),
          environment,
        }).pipe(Effect.provideService(Console.Console, environment.console), Effect.flatMap(recordAnswer)),
    })
  }).pipe(Command.withDescription('Run mutation testing'))

  const mergeCommand = Command.make(
    'merge',
    { ...mergeOptions, ...mergeArgs, ...formatOptions },
    (config) =>
      runRequestCell.run({
        route: Run.CliRouteCommand.make({
          route: {
            _tag: 'merge',
            plan: config.plan,
            out: Option.getOrUndefined(config.out),
            shards: [...config.shardDirs],
          },
        }),
        options: {},
        environment,
      }).pipe(Effect.provideService(Console.Console, environment.console), Effect.flatMap(recordAnswer)),
  ).pipe(Command.withDescription('Merge shard mutation reports into one mutation report and one incremental report'))

  const compareCommand = Command.make('compare', compareOptions, (config) =>
    runRequestCell.run({
      route: Run.CliRouteCommand.make({
        route: {
          _tag: 'compare',
          baseline: config.baseline,
          fresh: config.fresh,
          noise: Option.getOrUndefined(config.noise),
        },
      }),
      options: {},
      environment,
    }).pipe(Effect.provideService(Console.Console, environment.console), Effect.flatMap(recordAnswer))).pipe(
      Command.withDescription(
        'Compare a fresh mutation report with the baseline of record, naming every mutant whose status differs',
      ),
    )

  const gateCommand = Command.make('gate', gateOptions, (config) =>
    runRequestCell.run({
      route: Run.CliRouteCommand.make({
        route: {
          _tag: 'gate',
          baseline: Option.getOrUndefined(config.baseline),
          updateBaseline: config.updateBaseline === true,
          budgetBaseline: Option.getOrUndefined(config.budgetBaseline),
          budgetTolerance: config.budgetTolerance,
          updateBudgetBaseline: config.updateBudgetBaseline === true,
        },
      }),
      options: {},
      environment,
    }).pipe(Effect.provideService(Console.Console, environment.console), Effect.flatMap(recordAnswer))).pipe(
      Command.withDescription(
        'Fail on survivors absent from the committed baseline, tallying the mutants the run did not settle',
      ),
    )

  const annotateCommand = Command.make('annotate', annotateOptions, (config) =>
    runRequestCell.run({
      route: Run.CliRouteCommand.make({
        route: {
          _tag: 'annotate',
          baseline: Option.getOrUndefined(config.baseline),
        },
      }),
      options: {},
      environment,
    }).pipe(Effect.provideService(Console.Console, environment.console), Effect.flatMap(recordAnswer))).pipe(
      Command.withDescription(
        'Print GitHub workflow annotations at the location of every surfaced survivor of the finished mutation report',
      ),
    )

  const planCommand = Command.make('plan', planOptions, (config) =>
    runRequestCell.run({
      route: Run.CliRouteCommand.make({
        route: {
          _tag: 'plan',
          targetSeconds: config.targetSeconds,
          maxShards: Option.getOrUndefined(config.maxShards),
          projects: Option.getOrUndefined(config.projects),
          out: Option.getOrUndefined(config.out),
          full: config.full === true,
        },
      }),
      options: {},
      environment,
    }).pipe(Effect.provideService(Console.Console, environment.console), Effect.flatMap(recordAnswer))).pipe(
      Command.withDescription(
        'Discover mutants without running tests, decide reuse against the incremental report, and pack them into deterministically LPT-scheduled shards',
      ),
    )

  const serveCommand = Command.make('serve', { ...serveOptions, ...serveArgs }, (config) =>
    runRequestCell.run({
      route: Run.CliRouteCommand.make({
        route: {
          _tag: 'serve',
          channel: config.channel,
          port: Option.getOrUndefined(config.port),
          address: Option.getOrUndefined(config.address),
        },
      }),
      options: {},
      environment,
    }).pipe(Effect.provideService(Console.Console, environment.console), Effect.flatMap(recordAnswer))).pipe(
      Command.withDescription(
        'Serve the Mutation Server Protocol: framed JSON-RPC (`configure`, `discover`, `mutationTest`) over stdio or a socket',
      ),
    )

  const feedbackOptions = {
    useful: Flag.map(optional(Flag.Boolean('useful')), absentWhenFalse).pipe(
      Flag.withDescription('Judge the survivor worth acting on.'),
    ),
    notUseful: Flag.map(optional(Flag.Boolean('not-useful')), absentWhenFalse).pipe(
      Flag.withDescription('Judge the survivor not worth acting on.'),
    ),
    reason: Flag.String('reason').pipe(
      Flag.withDescription('Why the survivor was or was not worth acting on.'),
      optional,
    ),
  }

  const feedbackArgs = {
    id: Argument.String('id').pipe(
      Argument.withDescription('The id of a surfaced survivor of the finished mutation report.'),
    ),
  }

  const feedbackJudgmentOf = (
    useful: boolean | undefined,
    notUseful: boolean | undefined,
  ): Option.Option<'useful' | 'not-useful'> =>
    Bool.match(useful === notUseful, {
      onTrue: () => Option.none(),
      onFalse: () =>
        Option.some(
          Bool.match(useful === true, { onTrue: () => 'useful' as const, onFalse: () => 'not-useful' as const }),
        ),
    })

  const root = Command
    .make('stryker', {}, (_config) => Effect.fail(CliError.ShowHelp.make({ commandPath: ['stryker'], errors: [] })))

  const feedbackCommand = Command.make(
    'feedback',
    { ...feedbackOptions, ...feedbackArgs },
    (config) =>
      Option.match(feedbackJudgmentOf(config.useful, config.notUseful), {
        onNone: () =>
          Console.error('stryker feedback takes exactly one of --useful or --not-useful').pipe(
            Effect.andThen(
              Effect.failSync(() => CliError.UnexpectedArgument.make({ arguments: ['--useful', '--not-useful'] })),
            ),
          ),
        onSome: (judgment) =>
          runRequestCell.run({
            route: Run.CliRouteCommand.make({
              route: { _tag: 'feedback', id: config.id, judgment, reason: Option.getOrUndefined(config.reason) },
            }),
            options: {},
            environment,
          }).pipe(Effect.provideService(Console.Console, environment.console), Effect.flatMap(recordAnswer)),
      }),
  ).pipe(
    Command.withDescription(
      'Record whether one surfaced survivor was worth acting on, appending one `feedback` stream line to the report directory',
    ),
  )

  const mcpCommand = Command.make('mcp', {}, (_config) =>
    runRequestCell.run({
      route: Run.CliRouteCommand.make({ route: { _tag: 'mcp' } }),
      options: {},
      environment,
    }).pipe(Effect.provideService(Console.Console, environment.console), Effect.flatMap(recordAnswer))).pipe(
      Command.withDescription(
        'Serve the Model Context Protocol over stdio: tools to list survivors, show and re-run a mutant, and record usefulness',
      ),
    )

  return root.pipe(
    Command.withSubcommands([
      runCommand,
      mergeCommand,
      compareCommand,
      gateCommand,
      annotateCommand,
      planCommand,
      serveCommand,
      feedbackCommand,
      mcpCommand,
    ]),
  )
}

type RunRequest = ReturnType<typeof runRequestCell.run>

export const runStrykerCommand = (input: {
  readonly environment: CliEnvironment
  readonly recordAnswer: (answer: CliAnswer) => Effect.Effect<void>
  readonly version: string
  readonly args: ReadonlyArray<string>
}): Effect.Effect<
  void,
  Effect.Error<RunRequest> | CliError.CliError,
  Exclude<Effect.Services<RunRequest>, Console.Console> | Command.Environment
> => Command.runWith(makeStrykerCommand(input), { version: input.version })(input.args)
