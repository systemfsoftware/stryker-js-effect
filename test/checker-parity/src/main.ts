import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'
import { Engine } from '@systemfsoftware/stryker-js'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Argument from 'effect/cli/Argument'
import * as CliError from 'effect/cli/CliError'
import * as Command from 'effect/cli/Command'
import * as Flag from 'effect/cli/Flag'
import * as Console from 'effect/Console'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Predicate from 'effect/Predicate'
import * as Record from 'effect/Record'
import * as Runtime from 'effect/Runtime'
import * as S from 'effect/Schema'
import * as Stdio from 'effect/Stdio'
import * as Str from 'effect/String'
import type * as Terminal from 'effect/Terminal'

import { appendStepSummary, type CiEnvironment, ciEnvironment } from './ci-environment.js'
import { compareSides, CompareSidesCommand, ComparisonDecision } from './compare-sides.workflow.js'
import { ISOLATED_DECLARATIONS_PROJECT } from './corpus.js'
import { laneTrigger } from './lane-trigger.js'
import { type ParityLine, Shard } from './Parity.schema.js'
import {
  CompareFinished,
  ProjectShard,
  reportParityOutcome,
  ReportParityOutcomeCommand,
} from './report-parity-outcome.workflow.js'
import { decodeLines, runShard, type ShellServices } from './run-side.js'
import { ReportedExit, ShellFailure } from './Shell.schema.js'

const VERSION = '0.0.0'
const SHARD_FILE = /^shard-([1-9][0-9]*)\.ndjson$/u
const encodeDecision = S.encodeResult(S.fromJsonString(ComparisonDecision))

const ioFailure = (reason: string, nextAction: string): ShellFailure =>
  ShellFailure.make({ schemaVersion: 1, code: 'io-failed', reason, nextAction })

interface ShardFile {
  readonly shard: number
  readonly file: string
}

const shardFileOf = (path: Path.Path, dir: string) => (entry: string): Option.Option<ShardFile> =>
  Option.map(
    Option.fromNullishOr(SHARD_FILE.exec(path.basename(entry))),
    (match) => ({ shard: Number(match[1]), file: path.join(dir, entry) }),
  )

const shardFilesIn = (
  dir: string,
): Effect.Effect<ReadonlyArray<ShardFile>, ShellFailure, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const entries = yield* fs.readDirectory(dir, { recursive: true }).pipe(
      Effect.mapError((cause) =>
        ShellFailure.make({
          schemaVersion: 1,
          code: 'shard-incomplete',
          reason: `Could not list the compare directory ${dir}: ${cause.message}`,
          nextAction: 'Check every compare directory exists and is readable.',
        })
      ),
    )
    return Arr.getSomes(entries.map(shardFileOf(path, dir)))
  })

const shardIncomplete = (reason: string, shard: number): ShellFailure =>
  ShellFailure.make({
    schemaVersion: 1,
    code: 'shard-incomplete',
    reason,
    nextAction:
      `Rerun the checker-parity (${shard}) leg, or download artifact checker-parity-$GITHUB_RUN_ID-${shard} (file shard-${shard}.ndjson) and pass its directory.`,
  })

interface ShardLines {
  readonly shard: number
  readonly lines: ReadonlyArray<ParityLine>
}

const loadShard = (
  byShard: Record<string, ReadonlyArray<ShardFile>>,
  count: number,
) =>
(shard: number): Effect.Effect<ShardLines, ShellFailure, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const files = Option.getOrElse(Record.get(byShard, String(shard)), Arr.empty)
    const only = yield* Effect.fromOption(Option.filter(Arr.head(files), () => files.length === 1)).pipe(
      Effect.mapError(() =>
        shardIncomplete(`Shard ${shard}/${count} contributed ${files.length} shard files, expected exactly one.`, shard)
      ),
    )
    const content = yield* FileSystem.FileSystem.use((fs) => fs.readFileString(only.file)).pipe(
      Effect.mapError((cause) => shardIncomplete(`Could not read ${only.file}: ${cause.message}`, shard)),
    )
    yield* Boolean.match(Str.isNonEmpty(content.trim()), {
      onTrue: () => Effect.void,
      onFalse: () => Effect.fail(shardIncomplete(`Shard ${shard}/${count} wrote an empty ${only.file}.`, shard)),
    })
    return { shard, lines: yield* decodeLines(content, only.file) }
  })

const loadShards = (
  dirs: ReadonlyArray<string>,
  count: number,
): Effect.Effect<ReadonlyArray<ShardLines>, ShellFailure, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const files = (yield* Effect.forEach(dirs, shardFilesIn)).flat()
    const byShard = Arr.groupBy(files, (file) => String(file.shard))
    const extra = Arr.findFirst(Record.keys(byShard), (key) => Number(key) > count)
    yield* Option.match(extra, {
      onNone: () => Effect.void,
      onSome: (key) =>
        Effect.fail(shardIncomplete(`A shard file names shard ${key}, beyond --shards ${count}.`, Number(key))),
    })
    return yield* Effect.forEach(Arr.range(1, count), loadShard(byShard, count))
  })

const projectShardsOf = (shards: ReadonlyArray<ShardLines>): ReadonlyArray<ProjectShard> =>
  Arr.dedupeWith(
    shards.flatMap(({ shard, lines }) => lines.map((line) => ProjectShard.make({ project: line.project, shard }))),
    (left, right) => left.project === right.project,
  )

const FALLBACK_ENVIRONMENT: CiEnvironment = {
  ci: false,
  githubActions: false,
  pushEvent: false,
  stepSummary: Option.none(),
  runId: '<run-id>',
}

const emitReport = (
  outcome: CompareFinished | ShellFailure,
): Effect.Effect<number, never, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const environment = yield* Effect.orElseSucceed(ciEnvironment, () => FALLBACK_ENVIRONMENT)
    const report = yield* Effect.fromResult(
      reportParityOutcome(
        ReportParityOutcomeCommand.make({
          outcome,
          githubActions: environment.githubActions,
          runId: environment.runId,
        }),
      ),
    )
    yield* Effect.forEach([...report.stdout, ...report.annotations], (line) => Console.log(line), { discard: true })
    yield* Effect.forEach(report.stderr, (line) => Console.error(line), { discard: true })
    yield* appendStepSummary(environment, report.stepSummary).pipe(
      Effect.catchTag('ShellFailure', (failure) => Console.error(`${failure.code}: ${failure.reason}`)),
    )
    return report.exitCode
  })

const exitWith = (exitCode: number): Effect.Effect<void, ReportedExit> =>
  Boolean.match(exitCode === 0, {
    onTrue: () => Effect.void,
    onFalse: () => Effect.fail(ReportedExit.make({ exitCode })),
  })

interface CompareInput {
  readonly shards: number
  readonly summary: string
  readonly shortcutGate: boolean
  readonly speedGate: boolean
  readonly dirs: ReadonlyArray<string>
}

const compare = (input: CompareInput): Effect.Effect<void, ShellFailure | ReportedExit, ShellServices> =>
  Effect.gen(function*() {
    const shards = yield* loadShards(input.dirs, input.shards)
    const lines = shards.flatMap((shard) => shard.lines)
    const decision = yield* Effect.fromResult(
      compareSides(
        CompareSidesCommand.make({
          lines: [...lines],
          gates: { shortcutCount: input.shortcutGate, speed: input.speedGate },
          isolatedDeclarationsProject: ISOLATED_DECLARATIONS_PROJECT,
        }),
      ),
    )
    const encoded = yield* Effect.fromResult(encodeDecision(decision)).pipe(
      Effect.mapError((issue) =>
        ioFailure(`Could not encode the compare summary: ${issue.message}`, 'Inspect the compare decision schema.')
      ),
    )
    yield* FileSystem.FileSystem.use((fs) => fs.writeFileString(input.summary, encoded)).pipe(
      Effect.mapError((cause) =>
        ioFailure(
          `Could not write ${input.summary}: ${cause.message}`,
          `Check the directory of ${input.summary} is writable.`,
        )
      ),
    )
    const finished = CompareFinished.make({
      decision,
      lineCount: lines.length,
      shards: input.shards,
      summaryFile: input.summary,
      projectShards: [...projectShardsOf(shards)],
    })
    yield* Effect.flatMap(emitReport(finished), exitWith)
  })

const refusedOutsideCi = ShellFailure.make({
  schemaVersion: 1,
  code: 'refused-outside-ci',
  reason: 'run instruments and type-checks the corpus with real workers, so it refuses to start outside CI.',
  nextAction: 'Set CI=true or pass --allow-local when you really mean to run a shard locally.',
})

const runCommand = Command.make('run', {
  mainWorker: Flag.String('main-worker'),
  branchWorker: Flag.String('branch-worker'),
  shard: Flag.String('shard').pipe(Flag.withSchema(Shard)),
  cache: Flag.String('cache'),
  out: Flag.String('out'),
  allowLocal: Flag.Boolean('allow-local').pipe(Flag.withDefault(false)),
}, (config) =>
  Effect.gen(function*() {
    const environment = yield* ciEnvironment
    yield* Boolean.match(environment.ci || config.allowLocal, {
      onTrue: () => Effect.void,
      onFalse: () => Effect.fail(refusedOutsideCi),
    })
    yield* runShard(config, environment).pipe(Effect.provide(Engine.nodePlatformLayer))
  }))

const compareCommand = Command.make('compare', {
  shards: Flag.Int('shards').pipe(Flag.filter((count) => count >= 1, (count) => `--shards ${count} is not ≥ 1`)),
  summary: Flag.String('summary'),
  shortcutGate: Flag.Boolean('shortcut-gate').pipe(Flag.withDefault(false)),
  speedGate: Flag.Boolean('speed-gate').pipe(Flag.withDefault(false)),
  dirs: Argument.String('dir').pipe(Argument.variadic({ min: 1 })),
}, compare)

const triggerCommand = Command.make('trigger', {
  base: Flag.String('base'),
}, (config) =>
  Effect.gen(function*() {
    const environment = yield* ciEnvironment
    const path = yield* Path.Path
    const trigger = yield* laneTrigger({
      base: config.base,
      pushEvent: environment.pushEvent,
      repoRoot: path.resolve('.'),
    })
    const outputs = Match.valueTags(trigger, {
      RunLane: (run) => ({
        run: true,
        detail: `${run.reason}: ${run.matchedCount} file(s)${run.matched.map((file) => `\n- \`${file}\``).join('')}`,
      }),
      SkipLane: (skip) => ({
        run: false,
        detail: `${skip.reason}: none of ${skip.changedCount} changed file(s) is an input`,
      }),
    })
    yield* Console.log(`run=${outputs.run}\nreason=${trigger.reason}`)
    yield* appendStepSummary(
      environment,
      `### checker-parity trigger: ${outputs.run ? 'run' : 'skip'}\n\n${outputs.detail}\n`,
    )
  }))

const cli = Command.make('checker-parity').pipe(Command.withSubcommands([runCommand, compareCommand, triggerCommand]))

const usageReasonsOf = (cause: CliError.CliError): ReadonlyArray<string> =>
  Match.valueTags(cause, {
    ShowHelp: (help) => help.errors.map((error) => error.message),
    DuplicateOption: (error) => [error.message],
    InvalidValue: (error) => [error.message],
    MissingArgument: (error) => [error.message],
    MissingOption: (error) => [error.message],
    UnexpectedArgument: (error) => [error.message],
    UnknownSubcommand: (error) => [error.message],
    UnrecognizedOption: (error) => [error.message],
    UserError: (error) => [error.message],
  })

const usageOutcome = (cause: CliError.CliError): Effect.Effect<number, ShellFailure> =>
  Arr.match(usageReasonsOf(cause), {
    onEmpty: () => Effect.succeed(0),
    onNonEmpty: (reasons) =>
      Effect.fail(
        ShellFailure.make({
          schemaVersion: 1,
          code: 'usage-error',
          reason: reasons.join('; '),
          nextAction: 'Pass `run`, `compare` or `trigger` with the flags `--help` lists.',
        }),
      ),
  })

const checkerParity = (
  args: ReadonlyArray<string>,
): Effect.Effect<number, never, ShellServices | Stdio.Stdio | Terminal.Terminal> =>
  Command.runWith(cli, { version: VERSION })(args).pipe(
    Effect.as(0),
    Effect.catchIf(CliError.isCliError, usageOutcome),
    Effect.catchTags({
      ShellFailure: emitReport,
      ReportedExit: (exit) => Effect.succeed(exit.exitCode),
    }),
  )

const teardown: Runtime.Teardown = (exit, onExit) =>
  Exit.match(exit, {
    onSuccess: (code) => onExit(Predicate.isNumber(code) ? code : 0),
    onFailure: () => Runtime.defaultTeardown(exit, onExit),
  })

const program = Effect.flatMap(Stdio.Stdio.use((stdio) => stdio.args), checkerParity)

NodeRuntime.runMain({ disableErrorReporting: true, teardown })(program.pipe(Effect.provide(NodeServices.layer)))
