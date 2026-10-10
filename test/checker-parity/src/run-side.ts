import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { Worker } from '@systemfsoftware/stryker-js'
import { Instrument, Mutator } from '@systemfsoftware/stryker-js-instrumenter'
import { Checker, type Mutant, Options, Plugin } from '@systemfsoftware/stryker-js-plugin-interface'
import * as Arr from 'effect/Array'
import * as Boolean from 'effect/Boolean'
import * as Clock from 'effect/Clock'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { dual } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Predicate from 'effect/Predicate'
import type * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner'
import * as Result from 'effect/Result'
import type * as RpcClient from 'effect/rpc/RpcClient'
import type { RpcClientError } from 'effect/rpc/RpcClientError'
import type * as RpcGroup from 'effect/rpc/RpcGroup'
import * as S from 'effect/Schema'
import * as Str from 'effect/String'

import { appendStepSummary, type CiEnvironment } from './ci-environment.js'
import {
  corpusEntries,
  ISOLATED_DECLARATIONS_PROJECT,
  programFilesFromListing,
  tsconfigsNamedByConfig,
} from './corpus.js'
import { DriverFailure } from './DriverFailure.schema.js'
import { execText } from './exec-text.js'
import { changedFiles } from './lane-trigger.js'
import { type OtlpReceiver, startOtlpReceiver } from './otlp-receiver.js'
import {
  CacheEntry,
  CheckCall,
  Counts,
  DigestCall,
  GroupCall,
  LegScope,
  ParityLine,
  PhaseLine,
  ProjectBootFailed,
  ProjectSkipped,
  type RunScopeName,
  ScopeSettings,
  type Shard,
  shardCount,
  shardIndex,
  Side,
  TelemetryMissing,
  Verdict,
} from './Parity.schema.js'
import {
  reuseCachedVerdicts,
  ReuseCachedVerdictsCommand,
  VerdictCacheIdentity,
} from './reuse-cached-verdicts.workflow.js'
import { driftLegOf, sampleFileOrder } from './select-scope.js'
import { selectScope, SelectScopeCommand } from './select-scope.workflow.js'
import { inShard } from './shard.js'
import {
  COUNTS_SCHEMA_VERSION,
  countsOfSpans,
  countsSchemaVersionsOf,
  projectCheckSpans,
  type SpanRecord,
} from './span-counts.js'

const decodeParityLine = S.decodeResult(S.fromJsonString(ParityLine))
const encodeParityLine = S.encodeResult(S.fromJsonString(ParityLine))
const decodeTypescriptPackage = S.decodeResult(
  S.fromJsonString(S.Struct({ bin: S.optional(S.Struct({ tsc: S.optional(S.String) })) })),
)

export interface RunCommand {
  readonly scope: RunScopeName
  readonly base: Option.Option<string>
  readonly settings: Option.Option<string>
  readonly mainWorker: string
  readonly branchWorker: string
  readonly shard: Shard
  readonly cache: string
  readonly out: string
}

export type DriverServices = FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner

const MAIN_SERVICE = 'checker-parity-main'
const BRANCH_SERVICE = 'checker-parity-branch'
const CHECKER_NAME = 'typescript'
const SPAN_POLL = Duration.millis(25)
const SPAN_POLLS = 200

type CheckerRpcsUnion = typeof Plugin.CheckerRpcs extends RpcGroup.RpcGroup<infer Rpcs> ? Rpcs : never
type CheckerClient = RpcClient.RpcClient<CheckerRpcsUnion, RpcClientError>

const ioFailure = (reason: string, nextAction: string): DriverFailure =>
  DriverFailure.make({ schemaVersion: 1, code: 'io-failed', reason, nextAction })

const rpcFailure = (detail: string): DriverFailure =>
  DriverFailure.make({
    schemaVersion: 1,
    code: 'rpc-failed',
    reason: `A checker worker RPC failed: ${detail}`,
    nextAction: 'Rerun the shard; if it repeats, inspect the worker stderr for the failing project.',
  })

const exists = (file: string): Effect.Effect<boolean, never, FileSystem.FileSystem> =>
  FileSystem.FileSystem.use((fs) => Effect.orElseSucceed(fs.exists(file), () => false))

const readText = (file: string): Effect.Effect<string, DriverFailure, FileSystem.FileSystem> =>
  FileSystem.FileSystem.use((fs) => fs.readFileString(file)).pipe(
    Effect.mapError((cause) =>
      ioFailure(`Could not read ${file}: ${cause.message}`, `Check the path ${file} exists and is readable.`)
    ),
  )

const writeText = (file: string, content: string): Effect.Effect<void, DriverFailure, FileSystem.FileSystem> =>
  FileSystem.FileSystem.use((fs) => fs.writeFileString(file, content)).pipe(
    Effect.mapError((cause) =>
      ioFailure(`Could not write ${file}: ${cause.message}`, `Check the directory of ${file} exists and is writable.`)
    ),
  )

const appendText = (file: string, content: string): Effect.Effect<void, DriverFailure, FileSystem.FileSystem> =>
  FileSystem.FileSystem.use((fs) => fs.writeFileString(file, content, { flag: 'a' })).pipe(
    Effect.mapError((cause) =>
      ioFailure(`Could not append to ${file}: ${cause.message}`, `Check the directory of ${file} is writable.`)
    ),
  )

const makeDirectory = (directory: string): Effect.Effect<void, DriverFailure, FileSystem.FileSystem> =>
  FileSystem.FileSystem.use((fs) => fs.makeDirectory(directory, { recursive: true })).pipe(
    Effect.mapError((cause) =>
      ioFailure(
        `Could not create ${directory}: ${cause.message}`,
        `Create ${directory} or point --out/--cache at a writable directory.`,
      )
    ),
  )

const isFile = (file: string): Effect.Effect<boolean, never, FileSystem.FileSystem> =>
  FileSystem.FileSystem.use((fs) =>
    fs.stat(file).pipe(Effect.map((info) => info.type === 'File'), Effect.orElseSucceed(() => false))
  )

const sha256Tree = (directory: string): Effect.Effect<string, DriverFailure, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const entries = yield* fs.readDirectory(directory, { recursive: true }).pipe(
      Effect.mapError((cause) =>
        ioFailure(`Could not walk ${directory}: ${cause.message}`, `Check the directory ${directory} exists.`)
      ),
    )
    const files = yield* Effect.filter(Arr.sort(entries, Str.Order), (entry) => isFile(path.join(directory, entry)))
    const hash = sha256.create()
    yield* Effect.forEach(files, (file) =>
      fs.readFile(path.join(directory, file)).pipe(
        Effect.map((bytes) => hash.update(utf8ToBytes(`${file}\u0000`)).update(bytes).update(utf8ToBytes('\u0000'))),
        Effect.mapError((cause) =>
          ioFailure(`Could not hash ${file} under ${directory}: ${cause.message}`, `Check ${file} is readable.`)
        ),
      ), { discard: true })
    return bytesToHex(hash.digest())
  })

const gitTrackedFiles = (
  repoRoot: string,
): Effect.Effect<ReadonlyArray<string>, DriverFailure, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.map(
    execText({ file: 'git', args: ['ls-files', '-z'], cwd: repoRoot }),
    (stdout) => stdout.split('\u0000').filter(Str.isNonEmpty),
  )

const decodeOptions = (tsconfigFile: string): Options.StrykerOptions =>
  Result.getOrThrow(S.decodeResult(Options.StrykerOptionsSchema)({ tsconfigFile, typescriptChecker: {} }))

const instrumenterOptions: Instrument.InstrumenterOptions = {
  excludedMutations: [],
  ignorers: [],
  mutantSetPolicy: 'default',
  mutators: Mutator.selectMutators(Mutator.stockRegistry, []),
}

const toWire = (mutant: Mutant.Mutant): Checker.CheckerMutantWire => ({
  id: mutant.id,
  fileName: mutant.fileName,
  mutatorName: mutant.mutatorName,
  replacement: mutant.replacement,
  location: mutant.location,
})

const encodeLine = (line: ParityLine): Effect.Effect<string, DriverFailure> =>
  Effect.fromResult(
    Result.mapError(encodeParityLine(line), (issue) =>
      ioFailure(
        `Could not encode a ${line._tag} line: ${issue.message}`,
        'Inspect the line kind in Parity.schema.ts.',
      )),
  )

const ndjsonOf = (lines: ReadonlyArray<ParityLine>): Effect.Effect<string, DriverFailure> =>
  Effect.map(
    Effect.forEach(lines, encodeLine),
    (encoded) => encoded.map((line) => `${line}\n`).join(''),
  )

export const decodeLines: {
  (file: string): (content: string) => Effect.Effect<ReadonlyArray<ParityLine>, DriverFailure>
  (content: string, file: string): Effect.Effect<ReadonlyArray<ParityLine>, DriverFailure>
} = dual(
  2,
  (content: string, file: string): Effect.Effect<ReadonlyArray<ParityLine>, DriverFailure> =>
    Effect.fromResult(
      Result.all(
        content.split('\n').flatMap((raw, index) =>
          Str.isNonEmpty(raw.trim())
            ? [
              Result.mapError(decodeParityLine(raw), () =>
                DriverFailure.make({
                  schemaVersion: 1,
                  code: 'decode-failed',
                  reason: `${file}:${index + 1} is not a parity line`,
                  nextAction: `Fix or delete the malformed line in ${file}.`,
                })),
            ]
            : []
        ),
      ),
    ),
)

interface SideInput {
  readonly side: Side
  readonly project: string
  readonly tsconfigFile: string
  readonly repoRoot: string
  readonly workerPath: string
  readonly bundleHash: string
  readonly cacheDir: string
  readonly wires: ReadonlyArray<Checker.CheckerMutantWire>
  readonly receiver: OtlpReceiver
  readonly serviceName: string
}

interface FileRun {
  readonly lines: ReadonlyArray<ParityLine>
  readonly freshCheckCalls: number
  readonly cached: boolean
}

interface SideRun {
  readonly bootFailed: boolean
  readonly lines: ReadonlyArray<ParityLine>
  readonly expectedCheckSpans: number
  readonly cachedFiles: number
  readonly freshFiles: number
}

const cachedLine = (line: ParityLine): Option.Option<ParityLine> =>
  S.is(Verdict)(line)
    ? Option.some(
      Verdict.make({
        schemaVersion: 1,
        side: line.side,
        project: line.project,
        mutantId: line.mutantId,
        fileName: line.fileName,
        line: line.line,
        status: line.status,
        reason: line.reason,
        cached: true,
      }),
    )
    : Option.liftPredicate(line, S.is(Counts))

const readCacheFile = (file: string): Effect.Effect<ReadonlyArray<ParityLine>, DriverFailure, FileSystem.FileSystem> =>
  Effect.flatMap(
    readText(file),
    (content) => Effect.map(decodeLines(content, file), (lines) => Arr.getSomes(lines.map(cachedLine))),
  )

const answerReasonOf = (answer: Checker.CheckAnswer): string | undefined =>
  Checker.CheckAnswerSchema.match(answer, {
    passed: () => undefined,
    compileError: ({ reason }) => reason,
    ignored: ({ reason }) =>
      Option.getOrElse(Option.liftPredicate(reason, Predicate.isString), () => JSON.stringify(reason)),
  })

const verdictOf = (input: SideInput, wire: Checker.CheckerMutantWire, answer: Checker.CheckAnswer): Verdict =>
  Verdict.make({
    schemaVersion: 1,
    side: input.side,
    project: input.project,
    mutantId: wire.id,
    fileName: wire.fileName,
    line: wire.location.start.line,
    status: answer.status,
    reason: answerReasonOf(answer),
    cached: false,
  })

const unsupportedVersion = (version: number): DriverFailure =>
  DriverFailure.make({
    schemaVersion: 1,
    code: 'telemetry-version-unsupported',
    reason: `Branch check spans declared counts schema version ${version}, not ${COUNTS_SCHEMA_VERSION}.`,
    nextAction:
      'Align the checker count attributes with this driver (packages/stryker-js-typescript-checker/src/ts-compiler.handle.ts).',
  })

const awaitCheckSpans = (
  input: SideInput,
  mutantIds: HashSet.HashSet<string>,
  expected: number,
  attempts: number,
): Effect.Effect<ReadonlyArray<SpanRecord>> =>
  Effect.flatMap(input.receiver.spans, (spans) => {
    const found = projectCheckSpans(spans, input.serviceName, mutantIds)
    return Boolean.match(Boolean.some([found.length >= expected, attempts <= 0]), {
      onTrue: () => Effect.succeed(found),
      onFalse: () => Effect.andThen(Effect.sleep(SPAN_POLL), awaitCheckSpans(input, mutantIds, expected, attempts - 1)),
    })
  })

const branchCountsOf = (
  input: SideInput,
  checkSpans: ReadonlyArray<SpanRecord>,
): Effect.Effect<Counts, DriverFailure> =>
  Effect.as(
    Option.match(
      Arr.findFirst(countsSchemaVersionsOf(checkSpans), (version) => version !== COUNTS_SCHEMA_VERSION),
      {
        onNone: () => Effect.void,
        onSome: (version) => Effect.fail(unsupportedVersion(version)),
      },
    ),
    Counts.make({ schemaVersion: 1, side: 'branch', project: input.project, ...countsOfSpans(checkSpans) }),
  )

interface CacheSlot {
  readonly key: string
  readonly verdictsFile: string
  readonly identityFile: string
  readonly identity: VerdictCacheIdentity
}

const encodeIdentity = S.encodeResult(S.fromJsonString(VerdictCacheIdentity))
const decodeIdentity = S.decodeResult(S.fromJsonString(VerdictCacheIdentity))

const cacheSlotOf = (
  input: SideInput,
  fileName: string,
  identity: VerdictCacheIdentity,
): Effect.Effect<CacheSlot, never, Path.Path> =>
  Path.Path.useSync((path) => {
    const key = bytesToHex(sha256(utf8ToBytes(`${input.project}\u0000${fileName}`)))
    return {
      key,
      verdictsFile: path.join(input.cacheDir, `${input.side}-${key}.ndjson`),
      identityFile: path.join(input.cacheDir, `${input.side}-${key}.identity.json`),
      identity,
    }
  })

const storedIdentityOf = (slot: CacheSlot): Effect.Effect<VerdictCacheIdentity | null, never, FileSystem.FileSystem> =>
  FileSystem.FileSystem.use((fs) => fs.readFileString(slot.identityFile)).pipe(
    Effect.map((text) =>
      Result.match(decodeIdentity(text), { onFailure: () => null, onSuccess: (identity) => identity })
    ),
    Effect.orElseSucceed(() => null),
  )

const cacheEntry = (input: SideInput, key: string, hit: boolean): CacheEntry =>
  CacheEntry.make({ schemaVersion: 1, side: input.side, project: input.project, key, hit })

const storeFile = (
  input: SideInput,
  slot: CacheSlot,
  lines: ReadonlyArray<ParityLine>,
): Effect.Effect<void, DriverFailure, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const identityText = yield* Effect.fromResult(
      Result.mapError(encodeIdentity(slot.identity), (issue) =>
        ioFailure(`Could not encode the verdict cache identity: ${issue.message}`, 'Inspect VerdictCacheIdentity.')),
    )
    yield* makeDirectory(input.cacheDir)
    yield* FileSystem.FileSystem.use((fs) =>
      fs.remove(slot.identityFile, { force: true })
    ).pipe(
      Effect.mapError((cause) => ioFailure(cause.message, `Check ${input.cacheDir} is writable.`)),
    )
    yield* writeText(slot.verdictsFile, yield* ndjsonOf(lines))
    yield* writeText(slot.identityFile, identityText)
  })

const checkGroup = (
  client: CheckerClient,
  input: SideInput,
  wireById: HashMap.HashMap<string, Checker.CheckerMutantWire>,
) =>
(
  group: ReadonlyArray<string>,
  callIndex: number,
): Effect.Effect<ReadonlyArray<ParityLine>, Checker.CheckerFailed | RpcClientError> =>
  Effect.gen(function*() {
    const groupWires = Arr.getSomes(group.map((id) => HashMap.get(wireById, id)))
    const [checkDuration, results] = yield* Effect.timed(
      client.check({ checkerName: CHECKER_NAME, mutants: [...groupWires] }),
    )
    const call = CheckCall.make({
      schemaVersion: 1,
      side: input.side,
      project: input.project,
      callIndex,
      mutantIds: [...group],
      ms: Duration.toMillis(checkDuration),
      cached: false,
    })
    const verdicts = Arr.getSomes(
      groupWires.map((wire) =>
        Option.map(Option.fromUndefinedOr(results[wire.id]), (result) => verdictOf(input, wire, result))
      ),
    )
    return [call, ...verdicts]
  })

const branchCountsLines = (
  input: SideInput,
  fileWires: ReadonlyArray<Checker.CheckerMutantWire>,
  groups: number,
): Effect.Effect<{ readonly lines: ReadonlyArray<Counts>; readonly complete: boolean }, DriverFailure> =>
  Effect.gen(function*() {
    const spans = yield* awaitCheckSpans(
      input,
      HashSet.fromIterable(fileWires.map((wire) => wire.id)),
      groups,
      SPAN_POLLS,
    )
    return { lines: [yield* branchCountsOf(input, spans)], complete: spans.length >= groups }
  })

const freshlyCheckedFile = (
  client: CheckerClient,
  input: SideInput,
  slot: CacheSlot,
  fileWires: ReadonlyArray<Checker.CheckerMutantWire>,
): Effect.Effect<FileRun, DriverFailure | Checker.CheckerFailed | RpcClientError, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const [groupDuration, groups] = yield* Effect.timed(
      client.group({ checkerName: CHECKER_NAME, mutants: [...fileWires] }),
    )
    const wireById = HashMap.fromIterable(fileWires.map((wire) => [wire.id, wire] as const))
    const groupLines = yield* Effect.forEach(groups, checkGroup(client, input, wireById))
    const counts = yield* Boolean.match(input.side === 'branch', {
      onTrue: () => branchCountsLines(input, fileWires, groups.length),
      onFalse: () => Effect.succeed({ lines: Arr.empty<Counts>(), complete: true }),
    })
    const groupLine = GroupCall.make({
      schemaVersion: 1,
      side: input.side,
      project: input.project,
      ms: Duration.toMillis(groupDuration),
      groups: groups.length,
      cached: false,
    })
    const lines = [groupLine, ...groupLines.flat(), ...counts.lines]
    yield* Boolean.match(counts.complete, {
      onTrue: () => storeFile(input, slot, lines),
      onFalse: () => Effect.void,
    })
    return { lines: [cacheEntry(input, slot.key, false), ...lines], freshCheckCalls: groups.length, cached: false }
  })

const fileRunOf = (
  client: CheckerClient,
  input: SideInput,
  digest: Checker.ProgramDigest,
) =>
(
  fileWires: ReadonlyArray<Checker.CheckerMutantWire>,
): Effect.Effect<FileRun, DriverFailure | Checker.CheckerFailed | RpcClientError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const slot = yield* cacheSlotOf(
      input,
      Option.getOrElse(Option.map(Arr.head(fileWires), (wire) => wire.fileName), () => ''),
      VerdictCacheIdentity.make({
        schemaVersion: 1,
        bundleHash: input.bundleHash,
        programDigest: digest,
        wires: [...fileWires],
      }),
    )
    const reuse = yield* Effect.fromResult(
      reuseCachedVerdicts(
        ReuseCachedVerdictsCommand.make({ current: slot.identity, stored: yield* storedIdentityOf(slot) }),
      ),
    )
    return yield* Match.valueTags(reuse, {
      VerdictsReused: () =>
        Effect.map(readCacheFile(slot.verdictsFile), (lines) => ({
          lines: [cacheEntry(input, slot.key, true), ...lines],
          freshCheckCalls: 0,
          cached: true,
        })),
      CheckFreshly: () => freshlyCheckedFile(client, input, slot, fileWires),
    })
  })

const wiresByFile = (
  wires: ReadonlyArray<Checker.CheckerMutantWire>,
): ReadonlyArray<ReadonlyArray<Checker.CheckerMutantWire>> =>
  Arr.sortWith(
    Object.values(Arr.groupBy(wires, (wire) => wire.fileName)),
    (fileWires) => fileWires[0].fileName,
    Str.Order,
  )

const sideBody = (
  client: CheckerClient,
  input: SideInput,
): Effect.Effect<
  SideRun,
  DriverFailure | Checker.CheckerFailed | RpcClientError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*() {
    const [digestDuration, digest] = yield* Effect.timed(client.digest({ checkerName: CHECKER_NAME }))
    const digestLine = DigestCall.make({
      schemaVersion: 1,
      side: input.side,
      project: input.project,
      ms: Duration.toMillis(digestDuration),
      digest,
      cached: false,
    })
    const files = yield* Effect.forEach(wiresByFile(input.wires), fileRunOf(client, input, digest))
    return {
      bootFailed: false,
      lines: [digestLine, ...files.flatMap((file) => file.lines)],
      expectedCheckSpans: files.reduce((total, file) => total + file.freshCheckCalls, 0),
      cachedFiles: files.filter((file) => file.cached).length,
      freshFiles: files.filter((file) => !file.cached).length,
    }
  })

const bootFailedRun = (input: SideInput, error: Worker.WorkerBootError): Effect.Effect<SideRun> =>
  Effect.succeed({
    bootFailed: true,
    lines: [
      ProjectBootFailed.make({ schemaVersion: 1, side: input.side, project: input.project, reason: error.message }),
    ],
    expectedCheckSpans: 0,
    cachedFiles: 0,
    freshFiles: 0,
  })

const runSide = (
  input: SideInput,
): Effect.Effect<SideRun, DriverFailure, Worker.WorkerLauncher | FileSystem.FileSystem | Path.Path> =>
  Effect.scoped(
    Effect.gen(function*() {
      const path = yield* Path.Path
      const entrypoint = yield* path.toFileUrl(input.workerPath).pipe(
        Effect.mapError((cause) => ioFailure(cause.message, `Pass an absolute worker path, not ${input.workerPath}.`)),
      )
      const client = yield* Worker.makeWorkerClient({
        rpcs: Plugin.CheckerRpcs,
        options: decodeOptions(input.tsconfigFile),
        entrypoint: entrypoint.href,
        workingDirectory: input.repoRoot,
        execArgv: [],
        tempDirPrefix: `stryker-checker-${input.side}-`,
        env: {
          OTEL_ENABLED: 'true',
          OTEL_EXPORTER_OTLP_ENDPOINT: input.receiver.endpoint,
          OTEL_SERVICE_NAME: input.serviceName,
        },
      })
      return yield* sideBody(client, input)
    }),
  ).pipe(
    Effect.catchTags({
      ChildProcessCrashedError: (error) => bootFailedRun(input, error),
      OutOfMemoryError: (error) => bootFailedRun(input, error),
      WorkerBootTimeoutError: (error) => bootFailedRun(input, error),
      CheckerFailed: (error) => Effect.fail(rpcFailure(error.message)),
      RpcClientError: (error) => Effect.fail(rpcFailure(error.message)),
    }),
  )

interface PullRequestScope {
  readonly changedFiles: HashSet.HashSet<string>
  readonly settings: ScopeSettings
  readonly driftLegs: HashMap.HashMap<string, number>
}

interface ProjectInput {
  readonly project: string
  readonly tsconfigFile: string
  readonly repoRoot: string
  readonly shard: Shard
  readonly pullRequest: Option.Option<PullRequestScope>
  readonly cacheDir: string
  readonly mainWorker: string
  readonly branchWorker: string
  readonly mainBundleHash: string
  readonly branchBundleHash: string
  readonly receiver: OtlpReceiver
}

type ProjectStatus = 'ran' | 'skipped' | 'boot-failed' | 'out-of-scope'

interface ProjectResult {
  readonly lines: ReadonlyArray<ParityLine>
  readonly status: ProjectStatus
  readonly mutants: number
  readonly changedFiles: number
  readonly changedMutants: number
  readonly sampledMutants: number
  readonly cachedFiles: number
  readonly freshFiles: number
  readonly listAndInstrumentMs: number
  readonly workersMs: number
}

const EMPTY_RESULT: ProjectResult = {
  lines: [],
  status: 'out-of-scope',
  mutants: 0,
  changedFiles: 0,
  changedMutants: 0,
  sampledMutants: 0,
  cachedFiles: 0,
  freshFiles: 0,
  listAndInstrumentMs: 0,
  workersMs: 0,
}

const skippedProject = (project: string, reason: string): ProjectResult => ({
  ...EMPTY_RESULT,
  lines: [ProjectSkipped.make({ schemaVersion: 1, project, reason })],
  status: 'skipped',
})

const tscBinPath: Effect.Effect<string, DriverFailure, FileSystem.FileSystem | Path.Path> = Effect.gen(function*() {
  const path = yield* Path.Path
  const packageJsonPath = yield* path.fromFileUrl(new URL(import.meta.resolve('typescript/package.json'))).pipe(
    Effect.mapError((cause) => ioFailure(cause.message, 'Install the workspace so typescript resolves.')),
  )
  const packageJson = Result.getOrElse(
    decodeTypescriptPackage(yield* readText(packageJsonPath)),
    () => ({ bin: undefined }),
  )
  const tsc = Option.getOrElse(
    Option.flatMap(Option.fromUndefinedOr(packageJson.bin), (bin) => Option.fromUndefinedOr(bin.tsc)),
    () => 'bin/tsc',
  )
  return path.resolve(path.dirname(packageJsonPath), tsc)
})

const listProgramFiles = (input: ProjectInput): Effect.Effect<ReadonlyArray<string>, DriverFailure, DriverServices> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const tsc = yield* tscBinPath
    const listing = yield* execText({
      file: globalThis.process.execPath,
      args: [tsc, '--listFilesOnly', '-p', input.tsconfigFile],
      cwd: input.repoRoot,
    })
    return programFilesFromListing({
      listing,
      repoRoot: input.repoRoot,
      projectRoot: path.dirname(input.tsconfigFile),
      path,
    })
  })

const bySide = <A>(side: Side, main: A, branch: A): A => side === 'main' ? main : branch

const serviceOf = (side: Side): string => bySide(side, MAIN_SERVICE, BRANCH_SERVICE)

const sideInputOf =
  (input: ProjectInput, wires: ReadonlyArray<Checker.CheckerMutantWire>) => (side: Side): SideInput => ({
    side,
    project: input.project,
    tsconfigFile: input.tsconfigFile,
    repoRoot: input.repoRoot,
    workerPath: bySide(side, input.mainWorker, input.branchWorker),
    bundleHash: bySide(side, input.mainBundleHash, input.branchBundleHash),
    cacheDir: input.cacheDir,
    wires,
    receiver: input.receiver,
    serviceName: serviceOf(side),
  })

const telemetryLineOf = (
  input: ProjectInput,
  run: { readonly side: Side; readonly expectedCheckSpans: number },
  mutantIds: HashSet.HashSet<string>,
): Effect.Effect<ReadonlyArray<TelemetryMissing>> =>
  Effect.map(input.receiver.spans, (spans) => {
    const received = projectCheckSpans(spans, serviceOf(run.side), mutantIds).length
    return received < run.expectedCheckSpans
      ? [
        TelemetryMissing.make({
          schemaVersion: 1,
          side: run.side,
          project: input.project,
          expectedSpans: run.expectedCheckSpans,
          receivedSpans: received,
        }),
      ]
      : []
  })

const instrumentFiles = (
  input: ProjectInput,
  files: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<Checker.CheckerMutantWire>, DriverFailure, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const sources = yield* Effect.forEach(
      files,
      (file) =>
        Effect.map(readText(path.resolve(input.repoRoot, file)), (content) => ({ name: file, content, mutate: true })),
    )
    const instrumented = yield* Instrument.instrument(sources, instrumenterOptions).pipe(
      Effect.mapError((cause) =>
        ioFailure(
          `Instrumenting ${sources.length} file(s) of ${input.project} failed: ${cause.message}`,
          'Fix what the branch instrumenter reports for this project.',
        )
      ),
    )
    return instrumented.mutants.map(toWire)
  })

interface ScopedWires {
  readonly wires: ReadonlyArray<Checker.CheckerMutantWire>
  readonly changedFiles: number
  readonly changedMutants: number
  readonly sampledMutants: number
}

const instrumentNonEmpty = (
  input: ProjectInput,
  files: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<Checker.CheckerMutantWire>, DriverFailure, FileSystem.FileSystem | Path.Path> =>
  Boolean.match(Arr.isReadonlyArrayNonEmpty(files), {
    onTrue: () => instrumentFiles(input, files),
    onFalse: () => Effect.succeed(Arr.empty<Checker.CheckerMutantWire>()),
  })

const fullScope = (
  input: ProjectInput,
  owned: ReadonlyArray<string>,
): Effect.Effect<ScopedWires, DriverFailure, FileSystem.FileSystem | Path.Path> =>
  Effect.map(
    instrumentNonEmpty(input, owned.filter((file) => inShard(file, input.shard))),
    (wires) => ({ wires, changedFiles: 0, changedMutants: 0, sampledMutants: 0 }),
  )

interface SampleFile {
  readonly file: string
  readonly wires: ReadonlyArray<Checker.CheckerMutantWire>
}

const firstFileWithMutants = (
  input: ProjectInput,
  candidates: ReadonlyArray<string>,
): Effect.Effect<Option.Option<SampleFile>, DriverFailure, FileSystem.FileSystem | Path.Path> =>
  Arr.match(candidates, {
    onEmpty: () => Effect.succeedNone,
    onNonEmpty: ([file, ...rest]) =>
      Effect.flatMap(instrumentFiles(input, [file]), (wires) =>
        Boolean.match(Arr.isReadonlyArrayNonEmpty(wires), {
          onTrue: () => Effect.succeedSome({ file, wires }),
          onFalse: () => firstFileWithMutants(input, rest),
        })),
  })

const samplesOnThisLeg = (input: ProjectInput): boolean =>
  Option.exists(
    input.pullRequest,
    (pullRequest) => Option.contains(HashMap.get(pullRequest.driftLegs, input.project), shardIndex(input.shard)),
  )

const changedOnThisLeg = (input: ProjectInput, pullRequest: PullRequestScope) => (file: string): boolean =>
  HashSet.has(pullRequest.changedFiles, file) && inShard(file, input.shard)

const pullRequestScope = (
  input: ProjectInput,
  owned: ReadonlyArray<string>,
  pullRequest: PullRequestScope,
): Effect.Effect<ScopedWires, DriverFailure, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*() {
    const changed = owned.filter(changedOnThisLeg(input, pullRequest))
    const changedWires = yield* instrumentNonEmpty(input, changed)
    const sample = yield* Boolean.match(samplesOnThisLeg(input), {
      onTrue: () => firstFileWithMutants(input, sampleFileOrder(pullRequest.settings.seed, owned)),
      onFalse: () => Effect.succeedNone,
    })
    const mutants = Arr.dedupeWith(
      [
        ...changedWires,
        ...Option.match(sample, {
          onNone: () => Arr.empty<Checker.CheckerMutantWire>(),
          onSome: (found) => found.wires,
        }),
      ],
      (left: Checker.CheckerMutantWire, right: Checker.CheckerMutantWire) => left.id === right.id,
    )
    const selected = yield* Effect.fromResult(
      selectScope(
        SelectScopeCommand.make({
          changedFiles: changed,
          sampleFile: Option.getOrNull(Option.map(sample, (found) => found.file)),
          mutants,
          settings: pullRequest.settings,
        }),
      ),
    )
    return Match.valueTags(selected, {
      ScopeSelected: (scope): ScopedWires => ({
        wires: scope.wires,
        changedFiles: changed.length,
        changedMutants: scope.changed.length,
        sampledMutants: scope.sampled.length,
      }),
      NothingSelected: (): ScopedWires => ({
        wires: [],
        changedFiles: changed.length,
        changedMutants: 0,
        sampledMutants: 0,
      }),
    })
  })

const checkBothSides = (
  input: ProjectInput,
  wires: ReadonlyArray<Checker.CheckerMutantWire>,
): Effect.Effect<
  Pick<ProjectResult, 'lines' | 'status' | 'cachedFiles' | 'freshFiles'>,
  DriverFailure,
  Worker.WorkerLauncher | FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*() {
    const sideInputs = Side.literals.map(sideInputOf(input, wires))
    const runs = yield* Effect.forEach(
      sideInputs,
      (sideInput) => Effect.map(runSide(sideInput), (run) => ({ ...run, side: sideInput.side })),
      { concurrency: 'unbounded' },
    )
    const mutantIds = HashSet.fromIterable(wires.map((wire) => wire.id))
    const telemetry = yield* Effect.forEach(
      runs.filter((run) => !run.bootFailed),
      (run) => telemetryLineOf(input, run, mutantIds),
    )
    return {
      lines: [...runs.flatMap((run) => run.lines), ...telemetry.flat()],
      status: runs.some((run) => run.bootFailed) ? 'boot-failed' : 'ran',
      cachedFiles: runs.reduce((total, run) => total + run.cachedFiles, 0),
      freshFiles: runs.reduce((total, run) => total + run.freshFiles, 0),
    }
  })

const projectDirectoryOf = (project: string): string => project.slice(0, project.lastIndexOf('/') + 1)

const inScopeOf = (input: ProjectInput): boolean =>
  Option.match(input.pullRequest, {
    onNone: () => true,
    onSome: (pullRequest) =>
      samplesOnThisLeg(input) ||
      HashSet.some(
        pullRequest.changedFiles,
        (file) => file.startsWith(projectDirectoryOf(input.project)) && inShard(file, input.shard),
      ),
  })

const checkedProject = (
  input: ProjectInput,
  scoped: ScopedWires,
  listAndInstrumentMs: number,
): Effect.Effect<ProjectResult, DriverFailure, Worker.WorkerLauncher | FileSystem.FileSystem | Path.Path> => {
  const counted: ProjectResult = {
    ...EMPTY_RESULT,
    mutants: scoped.wires.length,
    changedFiles: scoped.changedFiles,
    changedMutants: scoped.changedMutants,
    sampledMutants: scoped.sampledMutants,
    listAndInstrumentMs,
  }
  return Boolean.match(Arr.isReadonlyArrayNonEmpty(scoped.wires), {
    onTrue: () =>
      Effect.map(
        Effect.timed(checkBothSides(input, scoped.wires)),
        ([elapsed, checked]): ProjectResult => ({ ...counted, ...checked, workersMs: Duration.toMillis(elapsed) }),
      ),
    onFalse: () =>
      Effect.succeed({
        ...counted,
        lines: skippedProject(input.project, 'no mutants in scope on this leg').lines,
        status: 'skipped',
      }),
  })
}

const processProject = (
  input: ProjectInput,
): Effect.Effect<ProjectResult, DriverFailure, Worker.WorkerLauncher | DriverServices> =>
  Boolean.match(inScopeOf(input), {
    onFalse: () => Effect.succeed(EMPTY_RESULT),
    onTrue: () =>
      Effect.gen(function*() {
        const [prepared, scoped] = yield* Effect.timed(
          Effect.flatMap(listProgramFiles(input), (owned) =>
            Option.match(input.pullRequest, {
              onNone: () => fullScope(input, owned),
              onSome: (pullRequest) => pullRequestScope(input, owned, pullRequest),
            })),
        )
        return yield* checkedProject(input, scoped, Duration.toMillis(prepared))
      }),
  })

const isPhaseLine = S.is(PhaseLine)

const phaseMsOf = (lines: ReadonlyArray<ParityLine>, side: Side): number =>
  lines.filter(isPhaseLine)
    .filter((line) => line.side === side && !line.cached)
    .reduce((total, line) => total + line.ms, 0)

const countWith = (results: ReadonlyArray<ProjectResult>, status: ProjectStatus): number =>
  results.filter((result) => result.status === status).length

const sumOf = (results: ReadonlyArray<ProjectResult>, of: (result: ProjectResult) => number): number =>
  results.reduce((total, result) => total + of(result), 0)

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`

const shardSummary = (scope: LegScope, results: ReadonlyArray<ProjectResult>): string =>
  [
    `### checker-parity leg ${scope.shard} (${scope.scope === 'pr' ? 'pull request scope' : 'full corpus'})`,
    '',
    ...Option.match(Option.fromNullishOr(scope.settings), {
      onNone: Arr.empty<string>,
      onSome: (settings) => [
        `Scope settings: seed \`${settings.seed}\`; drift ${settings.perProject} mutant(s) per project over ${settings.driftProjects} project(s); at most ${settings.perChangedFile} mutant(s) per changed file.`,
        '',
      ],
    }),
    '| projects run | skipped | boot-failed | changed files | changed mutants | sampled mutants | checked mutants | files from cache | files checked | discovery | list + instrument | workers | main check | branch check | wall |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    `| ${scope.projects} | ${countWith(results, 'skipped')} | ${
      countWith(results, 'boot-failed')
    } | ${scope.changedFiles} | ${scope.changedMutants} | ${scope.sampledMutants} | ${scope.checkedMutants} | ${scope.cachedFiles} | ${scope.freshFiles} | ${
      seconds(scope.corpusDiscoveryMs)
    } | ${seconds(scope.listAndInstrumentMs)} | ${seconds(scope.workersMs)} | ${
      seconds(sumOf(results, (result) => phaseMsOf(result.lines, 'main')))
    } | ${seconds(sumOf(results, (result) => phaseMsOf(result.lines, 'branch')))} | ${seconds(scope.wallMs)} |`,
    '',
  ].join('\n')

const requireWorker = (
  [flag, workerPath]: readonly [string, string],
): Effect.Effect<void, DriverFailure, FileSystem.FileSystem> =>
  Effect.flatMap(exists(workerPath), (present) =>
    Boolean.match(present, {
      onTrue: () => Effect.void,
      onFalse: () =>
        Effect.fail(
          DriverFailure.make({
            schemaVersion: 1,
            code: 'worker-boot-failed',
            reason: `${flag} ${workerPath} does not exist`,
            nextAction: `Build the checker so ${workerPath} exists.`,
          }),
        ),
    }))

const corpusProjects = (repoRoot: string): Effect.Effect<ReadonlyArray<string>, DriverFailure, DriverServices> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const entries = corpusEntries(yield* gitTrackedFiles(repoRoot))
    const e2eProjects = yield* Effect.forEach(
      entries.e2eConfigs,
      (configPath) =>
        Effect.map(
          readText(path.resolve(repoRoot, configPath)),
          (configText) => tsconfigsNamedByConfig({ configText, configDirectory: path.dirname(configPath), path }),
        ),
    )
    return Arr.sort(
      Arr.dedupe([...entries.workspaceTsconfigs, ...e2eProjects.flat(), ISOLATED_DECLARATIONS_PROJECT]),
      Str.Order,
    )
  })

const usageFailure = (reason: string, nextAction: string): DriverFailure =>
  DriverFailure.make({ schemaVersion: 1, code: 'usage-error', reason, nextAction })

const decodeSettings = S.decodeResult(S.fromJsonString(ScopeSettings))

const driftLegsOf = (
  settings: ScopeSettings,
  projects: ReadonlyArray<string>,
  shards: number,
): HashMap.HashMap<string, number> =>
  HashMap.fromIterable(
    Arr.take(sampleFileOrder(settings.seed, projects), settings.driftProjects).map((project, rank) =>
      [project, driftLegOf(rank, shards)] as const
    ),
  )

const pullRequestScopeOf = (
  command: RunCommand,
  repoRoot: string,
  projects: ReadonlyArray<string>,
): Effect.Effect<Option.Option<PullRequestScope>, DriverFailure, DriverServices> =>
  Match.value(command.scope).pipe(
    Match.when('full', () => Effect.succeedNone),
    Match.when('pr', () =>
      Effect.gen(function*() {
        const base = yield* Effect.fromOption(command.base).pipe(
          Effect.mapError(() => usageFailure('--scope pr needs --base', 'Pass --base <merge-base sha>.')),
        )
        const settingsFile = yield* Effect.fromOption(command.settings).pipe(
          Effect.mapError(() =>
            usageFailure('--scope pr needs --settings', 'Pass --settings test/checker-parity/pr-scope.json.')
          ),
        )
        const settings = yield* Effect.fromResult(
          Result.mapError(
            decodeSettings(yield* readText(settingsFile)),
            (issue) =>
              usageFailure(`${settingsFile} is not a scope settings file: ${issue.message}`, `Fix ${settingsFile}.`),
          ),
        )
        const changed = yield* changedFiles({ base, repoRoot })
        return Option.some({
          changedFiles: HashSet.fromIterable(changed),
          settings,
          driftLegs: driftLegsOf(settings, projects, shardCount(command.shard)),
        })
      })),
    Match.exhaustive,
  )

const legScopeOf = (
  command: RunCommand,
  pullRequest: Option.Option<PullRequestScope>,
  results: ReadonlyArray<ProjectResult>,
  timings: { readonly corpusDiscoveryMs: number; readonly wallMs: number },
): LegScope =>
  LegScope.make({
    schemaVersion: 1,
    shard: command.shard,
    scope: command.scope,
    settings: Option.getOrNull(Option.map(pullRequest, (scope) => scope.settings)),
    changedFiles: sumOf(results, (result) => result.changedFiles),
    changedMutants: sumOf(results, (result) => result.changedMutants),
    sampledMutants: sumOf(results, (result) => result.sampledMutants),
    checkedMutants: sumOf(results, (result) => result.mutants),
    projects: countWith(results, 'ran') + countWith(results, 'boot-failed'),
    cachedFiles: sumOf(results, (result) => result.cachedFiles),
    freshFiles: sumOf(results, (result) => result.freshFiles),
    corpusDiscoveryMs: timings.corpusDiscoveryMs,
    listAndInstrumentMs: sumOf(results, (result) => result.listAndInstrumentMs),
    workersMs: sumOf(results, (result) => result.workersMs),
    wallMs: timings.wallMs,
  })

const encodeLegScope = S.encodeResult(S.fromJsonString(LegScope))

type ShardRun = Effect.Effect<void, DriverFailure, Worker.WorkerLauncher | DriverServices>

export const runShard: {
  (environment: CiEnvironment): (command: RunCommand) => ShardRun
  (command: RunCommand, environment: CiEnvironment): ShardRun
} = dual(2, (command: RunCommand, environment: CiEnvironment): ShardRun =>
  Effect.scoped(
    Effect.gen(function*() {
      const started = yield* Clock.currentTimeMillis
      const path = yield* Path.Path
      const repoRoot = path.resolve('.')
      yield* Effect.forEach(
        [['--main-worker', command.mainWorker], ['--branch-worker', command.branchWorker]] as const,
        requireWorker,
        { discard: true },
      )
      const receiver = yield* startOtlpReceiver
      const [discovery, { mainBundleHash, branchBundleHash, projects, pullRequest }] = yield* Effect.timed(
        Effect.gen(function*() {
          const projects = yield* corpusProjects(repoRoot)
          return {
            mainBundleHash: yield* sha256Tree(path.dirname(command.mainWorker)),
            branchBundleHash: yield* sha256Tree(path.dirname(command.branchWorker)),
            projects,
            pullRequest: yield* pullRequestScopeOf(command, repoRoot, projects),
          }
        }),
      )
      const cacheDir = path.resolve(repoRoot, command.cache)
      const outDir = path.resolve(repoRoot, command.out)
      const shardFile = path.join(outDir, `shard-${shardIndex(command.shard)}.ndjson`)
      yield* makeDirectory(outDir)
      yield* writeText(shardFile, '')
      const results = yield* Effect.forEach(projects, (project) => {
        const tsconfigFile = path.resolve(repoRoot, project)
        return Effect.flatMap(exists(tsconfigFile), (present) =>
          Boolean.match(present, {
            onTrue: () =>
              processProject({
                project,
                tsconfigFile,
                repoRoot,
                shard: command.shard,
                pullRequest,
                cacheDir,
                mainWorker: command.mainWorker,
                branchWorker: command.branchWorker,
                mainBundleHash,
                branchBundleHash,
                receiver,
              }),
            onFalse: () => Effect.succeed(skippedProject(project, `tsconfig not found at ${project}`)),
          })).pipe(
            Effect.tap((result) => Effect.flatMap(ndjsonOf(result.lines), (ndjson) => appendText(shardFile, ndjson))),
          )
      })
      const finished = yield* Clock.currentTimeMillis
      const scope = legScopeOf(command, pullRequest, results, {
        corpusDiscoveryMs: Duration.toMillis(discovery),
        wallMs: finished - started,
      })
      const scopeText = yield* Effect.fromResult(
        Result.mapError(encodeLegScope(scope), (issue) =>
          ioFailure(`Could not encode the leg scope: ${issue.message}`, 'Inspect LegScope in Parity.schema.ts.')),
      )
      yield* writeText(path.join(outDir, `scope-${shardIndex(command.shard)}.json`), scopeText)
      yield* appendStepSummary(environment, shardSummary(scope, results))
    }),
  ))
