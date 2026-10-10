import { Worker } from '@systemfsoftware/stryker-js'
import { Instrument, Mutator } from '@systemfsoftware/stryker-js-instrumenter'
import { Checker, Mutant, Options, Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Result from 'effect/Result'
import type * as RpcClient from 'effect/rpc/RpcClient'
import type { RpcClientError } from 'effect/rpc/RpcClientError'
import type * as RpcGroup from 'effect/rpc/RpcGroup'
import * as S from 'effect/Schema'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import {
  type CorpusEntries,
  corpusEntries,
  ISOLATED_DECLARATIONS_PROJECT,
  programFilesFromListing,
  tscBinPath,
  tsconfigsNamedByConfig,
  typescriptPackageJsonPath,
} from './corpus.js'
import {
  COUNTS_SCHEMA_VERSION,
  countsOfSpans,
  countsSchemaVersionsOf,
  type OtlpReceiver,
  projectCheckSpans,
  startOtlpReceiver,
} from './otlp-receiver.js'
import {
  CacheEntry,
  CheckCall,
  Counts,
  decodeParityLine,
  decodeShard,
  DigestCall,
  encodeParityLine,
  type Gates,
  GroupCall,
  ParityLine,
  ProjectBootFailed,
  ProjectSkipped,
  type Shard,
  shardIndex,
  Side,
  TelemetryMissing,
  Verdict,
} from './Parity.schema.js'
import { inShard } from './shard.js'

export const ShellFailureCode = S.Literals([
  'usage-error',
  'refused-outside-ci',
  'shard-incomplete',
  'decode-failed',
  'worker-boot-failed',
  'telemetry-missing',
  'telemetry-version-unsupported',
  'rpc-failed',
  'io-failed',
])
export type ShellFailureCode = typeof ShellFailureCode.Type

export class ShellFailure extends S.TaggedError<ShellFailure>()('ShellFailure', {
  schemaVersion: S.Literal(1),
  code: ShellFailureCode,
  reason: S.String,
  nextAction: S.String,
}) {
  override get message(): string {
    return `${this.code}: ${this.reason}`
  }
}

export const shellFailure = (code: ShellFailureCode, reason: string, nextAction: string): ShellFailure =>
  ShellFailure.make({ schemaVersion: 1, code, reason, nextAction })

export const RunCommand = S.Struct({
  mainWorker: S.String,
  branchWorker: S.String,
  mainSource: S.String,
  branchSource: S.String,
  shard: S.String,
  cache: S.String,
  out: S.String,
  allowLocal: S.Boolean,
})
export type RunCommand = typeof RunCommand.Type

const MAIN_SERVICE = 'checker-parity-main'
const BRANCH_SERVICE = 'checker-parity-branch'
const CHECKER_NAME = 'typescript'
const DRAIN_MILLIS = 500
const GITHUB_ACTIONS_ENV = 'GITHUB_ACTIONS'
const GITHUB_STEP_SUMMARY_ENV = 'GITHUB_STEP_SUMMARY'
const TYPESCRIPT_PACKAGE_SCHEMA = S.Struct({ bin: S.optional(S.Struct({ tsc: S.optional(S.String) })) })

type CheckerRpcsUnion = typeof Plugin.CheckerRpcs extends RpcGroup.RpcGroup<infer Rpcs> ? Rpcs : never
type CheckerClient = RpcClient.RpcClient<CheckerRpcsUnion, RpcClientError>

const execFileAsync = promisify(execFile)

const ioFailure = (reason: string, nextAction: string): ShellFailure => shellFailure('io-failed', reason, nextAction)

const execText = (file: string, args: readonly string[], cwd: string): Effect.Effect<string, ShellFailure> =>
  Effect.tryPromise({
    try: async () => (await execFileAsync(file, [...args], { cwd, maxBuffer: 64 * 1024 * 1024 })).stdout,
    catch: (cause) =>
      ioFailure(
        `Running ${file} ${args.join(' ')} failed: ${String(cause)}`,
        `Run \`${file} ${args.join(' ')}\` in ${cwd} and fix what it reports.`,
      ),
  })

const exists = (file: string): Effect.Effect<boolean, ShellFailure> =>
  Effect.tryPromise({
    try: () => fs.stat(file).then(() => true, () => false),
    catch: (cause) =>
      ioFailure(`Could not stat ${file}: ${String(cause)}`, `Check the path ${file} exists and is readable.`),
  })

const readText = (file: string): Effect.Effect<string, ShellFailure> =>
  Effect.tryPromise({
    try: () => fs.readFile(file, 'utf8'),
    catch: (cause) =>
      ioFailure(`Could not read ${file}: ${String(cause)}`, `Check the path ${file} exists and is readable.`),
  })

const writeText = (file: string, content: string): Effect.Effect<void, ShellFailure> =>
  Effect.tryPromise({
    try: () => fs.writeFile(file, content, 'utf8'),
    catch: (cause) =>
      ioFailure(`Could not write ${file}: ${String(cause)}`, `Check the directory of ${file} exists and is writable.`),
  })

const makeDirectory = (directory: string): Effect.Effect<void, ShellFailure> =>
  Effect.tryPromise({
    try: () => fs.mkdir(directory, { recursive: true }).then(() => undefined),
    catch: (cause) =>
      ioFailure(
        `Could not create ${directory}: ${String(cause)}`,
        `Create ${directory} or point --out/--cache at a writable directory.`,
      ),
  })

const appendSummary = (markdown: string): Effect.Effect<void, ShellFailure> => {
  const summaryPath = process.env[GITHUB_STEP_SUMMARY_ENV]
  return process.env[GITHUB_ACTIONS_ENV] === 'true' && summaryPath !== undefined && summaryPath !== ''
    ? Effect.tryPromise({
      try: () => fs.appendFile(summaryPath, markdown, 'utf8'),
      catch: (cause) =>
        ioFailure(
          `Could not append to $GITHUB_STEP_SUMMARY: ${String(cause)}`,
          'Check the runner exposes GITHUB_STEP_SUMMARY.',
        ),
    })
    : Effect.void
}

const listFilesRecursive = (directory: string): Effect.Effect<readonly string[], ShellFailure> =>
  Effect.tryPromise({
    try: async () => {
      const entries = await fs.readdir(directory, { withFileTypes: true, recursive: true })
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(entry.parentPath, entry.name))
        .sort()
    },
    catch: (cause) =>
      ioFailure(`Could not walk ${directory}: ${String(cause)}`, `Check the directory ${directory} exists.`),
  })

const sha256HexOf = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex')

const sha256Tree = (directory: string): Effect.Effect<string, ShellFailure> =>
  Effect.flatMap(listFilesRecursive(directory), (files) =>
    Effect.tryPromise({
      try: async () => {
        const hash = createHash('sha256')
        for (const file of files) {
          hash.update(path.relative(directory, file))
          hash.update('\u0000')
          hash.update(await fs.readFile(file))
          hash.update('\u0000')
        }
        return hash.digest('hex')
      },
      catch: (cause) =>
        ioFailure(
          `Could not hash the tree at ${directory}: ${String(cause)}`,
          `Check every file under ${directory} is readable.`,
        ),
    }))

const gitTrackedFiles = (repoRoot: string): Effect.Effect<readonly string[], ShellFailure> =>
  Effect.map(
    execText('git', ['ls-files', '-z'], repoRoot),
    (stdout) => stdout.split('\u0000').filter((entry) => entry.length > 0),
  )

const decodeOptions = (tsconfigFile: string): Options.StrykerOptions =>
  Result.getOrThrow(S.decodeResult(Options.StrykerOptionsSchema)({ tsconfigFile, typescriptChecker: {} }))

const instrumenterOptions = {
  excludedMutations: [] as readonly string[],
  ignorers: [] as readonly unknown[],
  mutantSetPolicy: 'default' as const,
  mutators: Mutator.selectMutators(Mutator.stockRegistry, []),
}

const toWire = (mutant: Mutant.Mutant): Checker.CheckerMutantWire => ({
  id: mutant.id,
  fileName: mutant.fileName,
  mutatorName: mutant.mutatorName,
  replacement: mutant.replacement,
  location: mutant.location,
})

const encodeLine = (line: ParityLine): Effect.Effect<string, ShellFailure> =>
  Effect.fromResult(
    Result.mapError(encodeParityLine(line), (issue) =>
      ioFailure(
        `Could not encode a ${line._tag} line: ${issue.message}`,
        'Inspect the line kind in Parity.schema.ts.',
      )),
  )

const decodeLines = (content: string, file: string): Effect.Effect<readonly ParityLine[], ShellFailure> => {
  const decodeAt = (raw: string, index: number): Result.Result<ParityLine, ShellFailure> =>
    Result.mapError(decodeParityLine(raw), () =>
      shellFailure(
        'decode-failed',
        `${file}:${index + 1} is not a parity line`,
        `Fix or delete the malformed line in ${file}.`,
      ))
  const nonEmpty = content.split('\n').flatMap((raw, index) => (raw.trim().length === 0 ? [] : [[raw, index] as const]))
  return Effect.fromResult(Result.all(nonEmpty.map(([raw, index]) => decodeAt(raw, index))))
}

const isBootError = (error: unknown): boolean =>
  S.is(Worker.ChildProcessCrashedError)(error) || S.is(Worker.OutOfMemoryError)(error) ||
  S.is(Worker.WorkerBootTimeoutError)(error)

const describeWorkerError = (error: unknown): string => {
  if (S.is(Worker.WorkerBootTimeoutError)(error)) {
    return `worker did not boot before its boot window closed (pid ${error.pid})`
  }
  if (S.is(Worker.OutOfMemoryError)(error)) return `worker ran out of memory (pid ${error.pid}, exit ${error.exitCode})`
  if (S.is(Worker.ChildProcessCrashedError)(error)) return error.message
  return String(error)
}

const sideShellFailure = (error: unknown): ShellFailure =>
  S.is(ShellFailure)(error)
    ? error
    : shellFailure(
      'rpc-failed',
      `A checker worker RPC failed: ${String(error)}`,
      'Rerun the shard; if it repeats, inspect the worker stderr for the failing project.',
    )

interface SideInput {
  readonly side: typeof Side.Type
  readonly project: string
  readonly tsconfigFile: string
  readonly repoRoot: string
  readonly workerPath: string
  readonly sourceTreeHash: string
  readonly cacheDir: string
  readonly readCache: boolean
  readonly wires: readonly Checker.CheckerMutantWire[]
  readonly receiver: OtlpReceiver
  readonly serviceName: string
}

interface SideRun {
  readonly lines: readonly ParityLine[]
  readonly expectedCheckSpans: number
}

const cacheKeyOf = (sourceTreeHash: string, digest: string, mutantIds: readonly string[]): string =>
  sha256HexOf([sourceTreeHash, digest, [...mutantIds].sort().join(',')].join('\n'))

const cacheLineOf = (line: ParityLine): ParityLine =>
  S.is(Verdict)(line)
    ? Verdict.make({
      schemaVersion: 1,
      side: line.side,
      project: line.project,
      mutantId: line.mutantId,
      fileName: line.fileName,
      line: line.line,
      status: line.status,
      reason: line.reason,
      cached: true,
    })
    : line

const readCacheFile = (file: string): Effect.Effect<readonly ParityLine[], ShellFailure> =>
  Effect.flatMap(
    readText(file),
    (content) =>
      Effect.map(decodeLines(content, file), (lines) =>
        lines.filter((line) => S.is(Verdict)(line) || S.is(Counts)(line)).map(cacheLineOf)),
  )

const verdictOf = (input: SideInput, wire: Checker.CheckerMutantWire, result: Checker.CheckResult): Verdict =>
  Verdict.make({
    schemaVersion: 1,
    side: input.side,
    project: input.project,
    mutantId: wire.id,
    fileName: wire.fileName,
    line: wire.location.start.line,
    status: result.status,
    reason: result.status === 'passed' ? undefined : result.reason,
    cached: false,
  })

const branchCountsLine = (
  input: SideInput,
  wires: readonly Checker.CheckerMutantWire[],
): Effect.Effect<Counts, ShellFailure> =>
  Effect.gen(function*() {
    yield* Effect.sleep(Duration.millis(DRAIN_MILLIS))
    const checkSpans = projectCheckSpans(
      input.receiver.spans(),
      input.serviceName,
      new Set(wires.map((wire) => wire.id)),
    )
    const unsupported = countsSchemaVersionsOf(checkSpans).find((version) => version !== COUNTS_SCHEMA_VERSION)
    if (unsupported !== undefined) {
      return yield* Effect.fail(
        shellFailure(
          'telemetry-version-unsupported',
          `Branch check spans declared counts schema version ${unsupported}, not ${COUNTS_SCHEMA_VERSION}.`,
          'Align the checker count attributes with this driver (packages/stryker-js-typescript-checker/src/ts-compiler.handle.ts).',
        ),
      )
    }
    const counts = countsOfSpans(checkSpans)
    return Counts.make({
      schemaVersion: 1,
      side: 'branch',
      project: input.project,
      snapshotUpdates: counts.snapshotUpdates,
      resplices: counts.resplices,
      tceBuilds: counts.tceBuilds,
      tceMs: counts.tceMs,
      importerShortcuts: counts.importerShortcuts,
      fallbacks: counts.fallbacks,
      checkSpans: counts.checkSpans,
    })
  })

const cachedSideRun = (input: SideInput, key: string, cached: readonly ParityLine[]): SideRun => ({
  lines: [CacheEntry.make({ schemaVersion: 1, side: input.side, project: input.project, key, hit: true }), ...cached],
  expectedCheckSpans: 0,
})

const freshSideRun = (
  input: SideInput,
  key: string,
  lines: readonly ParityLine[],
  groups: number,
): Effect.Effect<SideRun, ShellFailure> =>
  Effect.gen(function*() {
    const cacheFile = path.join(input.cacheDir, `${input.side}-${key}.ndjson`)
    yield* makeDirectory(input.cacheDir)
    const encoded = yield* Effect.forEach(lines, encodeLine, { concurrency: 1 })
    yield* writeText(cacheFile, `${encoded.join('\n')}\n`)
    return {
      lines: [
        CacheEntry.make({ schemaVersion: 1, side: input.side, project: input.project, key, hit: false }),
        ...lines,
      ],
      expectedCheckSpans: groups,
    }
  })

const sideBody = (client: CheckerClient, input: SideInput): Effect.Effect<SideRun, ShellFailure> =>
  Effect.gen(function*() {
    const [digestDuration, digest] = yield* Effect.timed(client.digest({ checkerName: CHECKER_NAME }))
    const key = cacheKeyOf(input.sourceTreeHash, digest, input.wires.map((wire) => wire.id))
    const cacheFile = path.join(input.cacheDir, `${input.side}-${key}.ndjson`)
    if (input.readCache && (yield* exists(cacheFile))) {
      return cachedSideRun(input, key, yield* readCacheFile(cacheFile))
    }

    const [groupDuration, groups] = yield* Effect.timed(
      client.group({ checkerName: CHECKER_NAME, mutants: [...input.wires] }),
    )
    const wireById = new Map<string, Checker.CheckerMutantWire>(input.wires.map((wire) => [wire.id, wire]))
    const groupLines = yield* Effect.forEach(
      groups,
      (group, callIndex) => {
        const groupWires = group.flatMap((id) => {
          const wire = wireById.get(id)
          return wire === undefined ? [] : [wire]
        })
        return Effect.map(
          Effect.timed(client.check({ checkerName: CHECKER_NAME, mutants: groupWires })),
          ([checkDuration, results]) =>
            [
              CheckCall.make({
                schemaVersion: 1,
                side: input.side,
                project: input.project,
                callIndex,
                mutantIds: [...group],
                ms: Duration.toMillis(checkDuration),
                cached: false,
              }),
              ...groupWires.flatMap((wire) => {
                const result = results[wire.id]
                return result === undefined ? [] : [verdictOf(input, wire, result)]
              }),
            ] as readonly ParityLine[],
        )
      },
      { concurrency: 1 },
    )
    const branchLines = input.side === 'branch' ? [yield* branchCountsLine(input, input.wires)] : []
    return yield* freshSideRun(
      input,
      key,
      [
        DigestCall.make({
          schemaVersion: 1,
          side: input.side,
          project: input.project,
          ms: Duration.toMillis(digestDuration),
          digest,
          cached: false,
        }),
        GroupCall.make({
          schemaVersion: 1,
          side: input.side,
          project: input.project,
          ms: Duration.toMillis(groupDuration),
          groups: groups.length,
          cached: false,
        }),
        ...groupLines.flat(),
        ...branchLines,
      ],
      groups.length,
    )
  }).pipe(Effect.mapError(sideShellFailure))

interface SideResult {
  readonly bootFailed: boolean
  readonly lines: readonly ParityLine[]
  readonly expectedCheckSpans: number
}

const runSide = (input: SideInput): Effect.Effect<SideResult, ShellFailure, Worker.WorkerLauncher> =>
  Effect.gen(function*() {
    const opened = yield* Effect.result(
      Effect.scoped(
        Effect.gen(function*() {
          const client = yield* Worker.makeWorkerClient({
            rpcs: Plugin.CheckerRpcs,
            options: decodeOptions(input.tsconfigFile),
            entrypoint: pathToFileURL(input.workerPath).href,
            workingDirectory: input.repoRoot,
            execArgv: [],
            tempDirPrefix: 'stryker-checker-',
            env: {
              OTEL_ENABLED: 'true',
              OTEL_EXPORTER_OTLP_ENDPOINT: input.receiver.endpoint,
              OTEL_SERVICE_NAME: input.serviceName,
            },
          })
          return yield* sideBody(client, input).pipe(Effect.mapError(sideShellFailure))
        }),
      ),
    )
    if (Result.isFailure(opened)) {
      const error = opened.failure
      if (isBootError(error)) {
        const reason = describeWorkerError(error)
        return {
          bootFailed: true,
          lines: [ProjectBootFailed.make({ schemaVersion: 1, side: input.side, project: input.project, reason })],
          expectedCheckSpans: 0,
        }
      }
      return yield* Effect.fail(sideShellFailure(error))
    }
    return { bootFailed: false, lines: opened.success.lines, expectedCheckSpans: opened.success.expectedCheckSpans }
  })

interface ProjectInput {
  readonly project: string
  readonly tsconfigFile: string
  readonly repoRoot: string
  readonly shard: Shard
  readonly cacheDir: string
  readonly readCache: boolean
  readonly mainWorker: string
  readonly branchWorker: string
  readonly mainSourceHash: string
  readonly branchSourceHash: string
  readonly receiver: OtlpReceiver
}

interface ProjectResult {
  readonly lines: readonly ParityLine[]
  readonly status: 'ran' | 'skipped' | 'boot-failed'
  readonly mutants: number
}

const skippedProject = (project: string, reason: string): ProjectResult => ({
  lines: [ProjectSkipped.make({ schemaVersion: 1, project, reason })],
  status: 'skipped',
  mutants: 0,
})

const listProgramFiles = (input: ProjectInput): Effect.Effect<readonly string[], ShellFailure> =>
  Effect.flatMap(readText(typescriptPackageJsonPath()), (packageJson) => {
    const parsed = Result.getOrElse(
      Result.mapError(
        S.decodeResult(S.fromJsonString(TYPESCRIPT_PACKAGE_SCHEMA))(packageJson),
        () => 'unparseable typescript package.json',
      ),
      () => ({ bin: undefined }),
    )
    const tsc = tscBinPath(parsed, typescriptPackageJsonPath())
    return Effect.map(
      execText(process.execPath, [tsc, '--listFilesOnly', '-p', input.tsconfigFile], input.repoRoot),
      (listing) => programFilesFromListing(listing, input.repoRoot),
    )
  })

const sideInputOf = (
  input: ProjectInput,
  side: typeof Side.Type,
  wires: readonly Checker.CheckerMutantWire[],
): SideInput => ({
  side,
  project: input.project,
  tsconfigFile: input.tsconfigFile,
  repoRoot: input.repoRoot,
  workerPath: side === 'main' ? input.mainWorker : input.branchWorker,
  sourceTreeHash: side === 'main' ? input.mainSourceHash : input.branchSourceHash,
  cacheDir: input.cacheDir,
  readCache: input.readCache,
  wires,
  receiver: input.receiver,
  serviceName: side === 'main' ? MAIN_SERVICE : BRANCH_SERVICE,
})

const telemetryLineOf = (
  input: ProjectInput,
  side: typeof Side.Type,
  expectedCheckSpans: number,
  mutantIds: ReadonlySet<string>,
): readonly TelemetryMissing[] => {
  const received =
    projectCheckSpans(input.receiver.spans(), side === 'main' ? MAIN_SERVICE : BRANCH_SERVICE, mutantIds).length
  return received < expectedCheckSpans
    ? [
      TelemetryMissing.make({
        schemaVersion: 1,
        side,
        project: input.project,
        expectedSpans: expectedCheckSpans,
        receivedSpans: received,
      }),
    ]
    : []
}

const processProject = (input: ProjectInput): Effect.Effect<ProjectResult, ShellFailure, Worker.WorkerLauncher> =>
  Effect.gen(function*() {
    const programFiles = yield* listProgramFiles(input)
    const shardFiles = programFiles.filter((file) => inShard(file, input.shard))
    if (shardFiles.length === 0) return skippedProject(input.project, 'no program files in this shard')
    const files = yield* Effect.forEach(
      shardFiles,
      (file) => Effect.map(readText(path.resolve(input.repoRoot, file)), (content) => ({ name: file, content })),
      { concurrency: 1 },
    )
    const wires = yield* Instrument.instrument(
      files.map((file) => ({ ...file, mutate: true })),
      instrumenterOptions,
    ).pipe(
      Effect.mapError((cause) =>
        ioFailure(
          `Instrumenting ${files.length} file(s) of ${input.project} failed: ${cause.message}`,
          'Fix what the branch instrumenter reports for this project.',
        )
      ),
      Effect.map((result) => result.mutants.map(toWire)),
    )
    if (wires.length === 0) return skippedProject(input.project, 'no mutants produced in this shard')

    const outcomes = yield* Effect.forEach(
      (['main', 'branch'] as const).map((side) => sideInputOf(input, side, wires)),
      (sideInput) => Effect.map(runSide(sideInput), (result) => ({ sideInput, result })),
      { concurrency: 1 },
    )
    const mutantIds = new Set(wires.map((wire) => wire.id))
    const telemetry = outcomes.flatMap(({ sideInput, result }) =>
      result.bootFailed ? [] : telemetryLineOf(input, sideInput.side, result.expectedCheckSpans, mutantIds)
    )
    return {
      lines: [...outcomes.flatMap(({ result }) => result.lines), ...telemetry],
      status: outcomes.some(({ result }) => result.bootFailed) ? 'boot-failed' : 'ran',
      mutants: wires.length,
    }
  })

const phaseMsOf = (lines: readonly ParityLine[], side: typeof Side.Type): number =>
  lines.reduce((total, line) => {
    if (!(S.is(CheckCall)(line) || S.is(GroupCall)(line) || S.is(DigestCall)(line))) return total
    return line.side === side && !line.cached ? total + line.ms : total
  }, 0)

const shardSummary = (command: RunCommand, results: readonly ProjectResult[]): string => {
  const run = results.filter((result) => result.status !== 'skipped').length
  const skipped = results.filter((result) => result.status === 'skipped').length
  const bootFailed = results.filter((result) => result.status === 'boot-failed').length
  const mutants = results.reduce((total, result) => total + result.mutants, 0)
  const mainMs = results.reduce((total, result) => total + phaseMsOf(result.lines, 'main'), 0)
  const branchMs = results.reduce((total, result) => total + phaseMsOf(result.lines, 'branch'), 0)
  return [
    `### checker-parity shard ${command.shard}`,
    '',
    '| projects run | skipped | boot-failed | mutants | main check ms | branch check ms |',
    '| --- | --- | --- | --- | --- | --- |',
    `| ${run} | ${skipped} | ${bootFailed} | ${mutants} | ${mainMs} | ${branchMs} |`,
    '',
  ].join('\n')
}

const cacheReadEnabled = (): boolean => process.env['CI'] === undefined || process.env['GITHUB_EVENT_NAME'] !== 'push'

const decodeShardOrFail = (value: string): Result.Result<Shard, ShellFailure> =>
  Result.mapError(
    decodeShard(value),
    () => shellFailure('usage-error', `--shard ${value} is not a k/N shard`, 'Pass --shard <k>/<N> with 1 ≤ k ≤ N.'),
  )

const projectIdsOf = (entries: CorpusEntries, e2eProjects: readonly (readonly string[])[]): readonly string[] =>
  [...new Set([...entries.workspaceTsconfigs, ...e2eProjects.flat(), ISOLATED_DECLARATIONS_PROJECT])].sort()

const requireWorkers = (command: RunCommand): Effect.Effect<void, ShellFailure> =>
  Effect.gen(function*() {
    for (
      const [flag, workerPath] of [
        ['--main-worker', command.mainWorker],
        ['--branch-worker', command.branchWorker],
      ] as const
    ) {
      if (!(yield* exists(workerPath))) {
        return yield* Effect.fail(
          shellFailure(
            'worker-boot-failed',
            `${flag} ${workerPath} does not exist`,
            `Build the checker so ${workerPath} exists.`,
          ),
        )
      }
    }
  })

export const runShard = (command: RunCommand): Effect.Effect<void, ShellFailure, Worker.WorkerLauncher> =>
  Effect.scoped(
    Effect.gen(function*() {
      const shard = yield* Effect.fromResult(decodeShardOrFail(command.shard))
      const repoRoot = process.cwd()
      const outDir = path.resolve(repoRoot, command.out)
      const cacheDir = path.resolve(repoRoot, command.cache)
      yield* requireWorkers(command)
      const receiver = yield* Effect.acquireRelease(
        Effect.promise(startOtlpReceiver),
        (open) => Effect.promise(() => open.close()),
      )
      const mainSourceHash = yield* sha256Tree(command.mainSource)
      const branchSourceHash = yield* sha256Tree(command.branchSource)
      const entries = corpusEntries(yield* gitTrackedFiles(repoRoot))
      const e2eProjects = yield* Effect.forEach(
        entries.e2eConfigs,
        (configPath) =>
          Effect.map(
            readText(path.resolve(repoRoot, configPath)),
            (configText) => tsconfigsNamedByConfig(configText, path.posix.dirname(configPath)),
          ),
        { concurrency: 1 },
      )
      const projectIds = projectIdsOf(entries, e2eProjects)
      const readCache = cacheReadEnabled()
      const results = yield* Effect.forEach(
        projectIds,
        (project) => {
          const tsconfigFile = path.resolve(repoRoot, project)
          return Effect.flatMap(exists(tsconfigFile), (present) =>
            present
              ? processProject({
                project,
                tsconfigFile,
                repoRoot,
                shard,
                cacheDir,
                readCache,
                mainWorker: command.mainWorker,
                branchWorker: command.branchWorker,
                mainSourceHash,
                branchSourceHash,
                receiver,
              })
              : Effect.succeed(skippedProject(project, `tsconfig not found at ${project}`)))
        },
        { concurrency: 1 },
      )
      const lines = results.flatMap((result) => result.lines)
      yield* makeDirectory(outDir)
      const encoded = yield* Effect.forEach(lines, encodeLine, { concurrency: 1 })
      const shardFile = path.join(outDir, `shard-${shardIndex(shard)}.ndjson`)
      yield* writeText(shardFile, encoded.length === 0 ? '' : `${encoded.join('\n')}\n`)
      yield* appendSummary(shardSummary(command, results))
    }),
  )

export interface ParsedRun {
  readonly _tag: 'run'
  readonly command: RunCommand
}

export interface ParsedCompare {
  readonly _tag: 'compare'
  readonly shards: number
  readonly summary: string
  readonly gates: Gates
  readonly dirs: readonly string[]
}

export type ParsedCommand = ParsedRun | ParsedCompare

const RUN_FLAGS = ['main-worker', 'branch-worker', 'main-source', 'branch-source', 'shard', 'cache', 'out'] as const
const COMPARE_FLAGS = ['shards', 'summary'] as const
const SWITCH_FLAGS: Record<string, true> = { 'allow-local': true, 'shortcut-gate': true, 'speed-gate': true }

interface RawArgs {
  readonly flags: ReadonlyMap<string, string>
  readonly positionals: readonly string[]
}

const readArgs = (tokens: readonly string[]): RawArgs => {
  const flags = new Map<string, string>()
  const positionals: string[] = []
  let index = 0
  while (index < tokens.length) {
    const token = tokens[index] ?? ''
    if (token === '--') {
      positionals.push(...tokens.slice(index + 1))
      break
    }
    if (!token.startsWith('--')) {
      positionals.push(token)
      index += 1
      continue
    }
    const equals = token.indexOf('=')
    if (equals >= 0) {
      flags.set(token.slice(2, equals), token.slice(equals + 1))
      index += 1
      continue
    }
    const name = token.slice(2)
    const next = tokens[index + 1]
    if (SWITCH_FLAGS[name] === true || next === undefined || next.startsWith('--')) {
      flags.set(name, '')
      index += 1
    } else {
      flags.set(name, next)
      index += 2
    }
  }
  return { flags, positionals }
}

const missingFlag = (flag: string, command: string): ShellFailure =>
  shellFailure('usage-error', `${command} needs --${flag}`, `Pass --${flag} <value> to ${command}.`)

const parsedRun = (args: RawArgs): Result.Result<ParsedRun, ShellFailure> => {
  const missing = RUN_FLAGS.find((flag) => args.flags.get(flag) === undefined || args.flags.get(flag) === '')
  if (missing !== undefined) return Result.fail(missingFlag(missing, 'run'))
  return Result.succeed({
    _tag: 'run',
    command: {
      mainWorker: args.flags.get('main-worker') ?? '',
      branchWorker: args.flags.get('branch-worker') ?? '',
      mainSource: args.flags.get('main-source') ?? '',
      branchSource: args.flags.get('branch-source') ?? '',
      shard: args.flags.get('shard') ?? '',
      cache: args.flags.get('cache') ?? '',
      out: args.flags.get('out') ?? '',
      allowLocal: args.flags.has('allow-local'),
    },
  })
}

const parsedCompare = (args: RawArgs): Result.Result<ParsedCompare, ShellFailure> => {
  const missing = COMPARE_FLAGS.find((flag) => args.flags.get(flag) === undefined || args.flags.get(flag) === '')
  if (missing !== undefined) return Result.fail(missingFlag(missing, 'compare'))
  const shards = Number(args.flags.get('shards'))
  if (!Number.isSafeInteger(shards) || shards < 1) {
    return Result.fail(
      shellFailure(
        'usage-error',
        `--shards ${args.flags.get('shards')} is not a positive integer`,
        'Pass --shards <N> with N ≥ 1.',
      ),
    )
  }
  if (args.positionals.length === 0) return Result.fail(missingFlag('dir', 'compare'))
  return Result.succeed({
    _tag: 'compare',
    shards,
    summary: args.flags.get('summary') ?? '',
    gates: { shortcutCount: args.flags.has('shortcut-gate'), speed: args.flags.has('speed-gate') },
    dirs: args.positionals,
  })
}

export const parseArgs = (tokens: readonly string[]): Result.Result<ParsedCommand, ShellFailure> => {
  const command = tokens[0]
  const args = readArgs(tokens.slice(1))
  return command === 'run'
    ? parsedRun(args)
    : command === 'compare'
    ? parsedCompare(args)
    : Result.fail(shellFailure('usage-error', `Unknown command ${command ?? '<none>'}`, 'Pass `run` or `compare`.'))
}

const isCiUnset = (env: Readonly<Record<string, string | undefined>>): boolean =>
  env['CI'] === undefined || env['CI'] === ''

export const refusalOutsideCi = (
  command: ParsedCommand,
  env: Readonly<Record<string, string | undefined>>,
): ShellFailure | undefined =>
  command._tag === 'run' && isCiUnset(env) && !command.command.allowLocal
    ? shellFailure(
      'refused-outside-ci',
      'run instruments and type-checks the corpus with real workers, so it refuses to start outside CI.',
      'Set CI=true or pass --allow-local when you really mean to run a shard locally.',
    )
    : undefined
